"""AgentCore Runtime entrypoint (BedrockAgentCoreApp).

Hosts the Strands orchestrator + four specialists in one process. Streams the
final response incrementally and emits normalized Trace_Events (Req 5.2, 5.3).
Memory is toggle-driven (Req 6.3, 6.4); deployed NO_MEMORY first, then STM/LTM.

Requirements: 1.1, 1.3, 5.2, 5.3, 6.3, 6.4
"""

from __future__ import annotations

import os
from typing import Any

import boto3

import queue
import threading
import time

import config
import governance
import trace_bus
import trace_schema
from agents import build_orchestrator, build_specialist, make_specialist_tool
from code_interpreter import build_run_code_tool
from gateway import GatewayToolClient
from gateway_token import GatewayTokenProvider
from kb import build_kb_retrieve_tool
from memory import build_session_manager, memory_plan
from session import resolve_session_id

try:
    from bedrock_agentcore import BedrockAgentCoreApp
    app = BedrockAgentCoreApp()
except Exception:  # noqa: BLE001 - allow import without the SDK for tooling/tests
    app = None  # type: ignore[assignment]

# --- Shared clients / tools -------------------------------------------------
# KB retrieval + Athena both run behind the AgentCore Gateway now, so the runtime
# no longer needs a direct bedrock-agent-runtime client.


def _oauth_http_post(url: str, data: dict) -> dict:
    import httpx

    resp = httpx.post(
        url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    return resp.json()


_gateway_token_provider = GatewayTokenProvider(
    token_endpoint=os.environ.get("GATEWAY_TOKEN_ENDPOINT", ""),
    client_id=os.environ.get("GATEWAY_CLIENT_ID", ""),
    client_secret=os.environ.get("GATEWAY_CLIENT_SECRET", ""),
    scope=os.environ.get("GATEWAY_SCOPE", ""),
    http_post=_oauth_http_post,
)

_gateway_client = GatewayToolClient(
    mcp_url=os.environ.get("GATEWAY_MCP_URL", ""),
    token_provider=_gateway_token_provider.get_token,
)


def _athena_tool_factory():
    from strands import tool

    @tool
    def athena_query(query: str) -> dict[str, Any]:
        """Run a SQL query against the customer-support Athena databases."""
        agent_id = trace_bus.current_agent(config.NODE_ORCHESTRATOR)
        started = time.perf_counter()
        try:
            result = _gateway_client.call("athena_query", {"query": query})
        except Exception as exc:  # noqa: BLE001 - trace the failure, then re-raise
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            trace_bus.emit(
                trace_schema.gateway_tool_call(
                    agent_id, "athena_query", {"query": query},
                    error=str(exc), duration_ms=elapsed_ms,
                )
            )
            raise
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        result_payload = result if isinstance(result, dict) else {"result": result}
        trace_bus.emit(
            trace_schema.gateway_tool_call(
                agent_id, "athena_query", {"query": query},
                result=result_payload, duration_ms=elapsed_ms,
            )
        )
        return result

    return athena_query


def _extract_agent_reasoning(agent: Any) -> str:
    """Collect an agent's assistant-side text (its reasoning) from message history.

    Strands messages are `{"role", "content": [{"text"|"toolUse"|...}]}`. We keep
    the text blocks from assistant turns — the model's natural-language reasoning
    and final synthesis — and drop tool-use/tool-result blocks. Fully defensive:
    returns "" on any unexpected shape.
    """
    parts: list[str] = []
    try:
        for message in getattr(agent, "messages", []) or []:
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            for block in message.get("content", []) or []:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    text = block["text"].strip()
                    if text:
                        parts.append(text)
    except Exception:  # noqa: BLE001 - never let extraction raise
        return ""
    return "\n\n".join(parts)


def _build_agent_system():
    """Build specialists (per the tool matrix) and the orchestrator."""
    athena = _athena_tool_factory()

    # KB retrieve tools now proxy to the Gateway `kb_retrieve` MCP tool (a Lambda
    # target that performs the Bedrock retrieve). Each agent's tool injects its
    # knowledge-base NAME so the model interface stays `kb_retrieve(query)`.
    kb_personalization = build_kb_retrieve_tool(
        _gateway_client, "personalization", config.NODE_PERSONALIZATION
    )
    kb_product_rec = build_kb_retrieve_tool(
        _gateway_client, "prod_rec", config.NODE_PRODUCT_RECOMMENDATION
    )
    kb_troubleshoot = build_kb_retrieve_tool(
        _gateway_client, "troubleshoot", config.NODE_TROUBLESHOOT
    )

    # Tool matrix (design §Components/Runtime). Code Interpreter is attributed to
    # the invoking specialist so its trace events carry the right agent id.
    specialists = [
        build_specialist(config.NODE_PERSONALIZATION, [athena, kb_personalization]),
        build_specialist(
            config.NODE_PRODUCT_RECOMMENDATION,
            [athena, kb_product_rec, build_run_code_tool(config.NODE_PRODUCT_RECOMMENDATION, trace_bus.emit)],
        ),
        build_specialist(
            config.NODE_ORDER_MANAGEMENT,
            [athena, build_run_code_tool(config.NODE_ORDER_MANAGEMENT, trace_bus.emit)],
        ),
        build_specialist(config.NODE_TROUBLESHOOT, [kb_troubleshoot]),
    ]
    specialist_tools = [make_specialist_tool(h) for h in specialists]
    orchestrator = build_orchestrator(specialist_tools)
    return orchestrator, specialists, specialist_tools


_ORCHESTRATOR, _SPECIALISTS, _SPECIALIST_TOOLS = _build_agent_system()


def _invoke(payload: dict[str, Any]):
    """Core invoke logic; yields {"type":"chunk"|"trace", ...} stream items.

    The orchestrator runs on a worker thread while tools emit normalized
    Trace_Events onto a queue via `trace_bus`; this generator drains the queue so
    trace events surface live in the UI, then yields the final completion chunk
    (Req 5.2, 5.3, 8).
    """
    prompt = payload.get("prompt", "")
    session_id = resolve_session_id(payload.get("sessionId"))
    actor_id = payload.get("actorId", "anonymous")
    memory_enabled = bool(payload.get("memoryEnabled", False))

    memory_id = os.environ.get("AGENTCORE_MEMORY_ID", "")
    memory_available = bool(memory_id)
    plan = memory_plan(memory_enabled, memory_available)

    session_manager = None
    if plan.read_before or plan.write_after:
        try:
            session_manager = build_session_manager(
                session_id=session_id,
                actor_id=actor_id,
                memory_enabled=True,
                memory_id=memory_id,
                region=config.REGION,
            )
        except Exception:  # noqa: BLE001 - degrade to stateless (Req 6.7)
            session_manager = None

    # When memory is active, build a fresh orchestrator WITH the session manager
    # so Strands persists this turn's conversation to AgentCore Memory (attaching
    # it post-construction does not reliably persist). Otherwise reuse the shared
    # stateless orchestrator.
    if session_manager is not None:
        orchestrator = build_orchestrator(_SPECIALIST_TOOLS, session_manager=session_manager).agent
    else:
        orchestrator = _ORCHESTRATOR.agent

    trace_queue: "queue.Queue[Any]" = queue.Queue()
    _DONE = object()
    result_holder: dict[str, Any] = {}

    def _worker() -> None:
        trace_bus.set_emitter(trace_queue.put)
        try:
            if plan.read_before:
                trace_bus.emit(
                    trace_schema.memory_read(config.NODE_ORCHESTRATOR, "stm", 0)
                )
            result_holder["text"] = str(orchestrator(prompt))
            # Surface the orchestrator's own reasoning (its planning + synthesis
            # narrative), which is otherwise invisible since it only emits routing
            # decisions. Best-effort: never let trace extraction break the turn.
            try:
                reasoning = _extract_agent_reasoning(orchestrator)
                if reasoning:
                    trace_bus.emit(
                        trace_schema.agent_reasoning(config.NODE_ORCHESTRATOR, reasoning)
                    )
            except Exception:  # noqa: BLE001 - tracing must never break the answer
                pass
            # Governance: screen the turn against content policy, then evaluate
            # the final response quality. Both surface in the trace stream and
            # the workflow diagram (Guardrail + Evaluation nodes). Best-effort.
            try:
                answer = result_holder.get("text", "")
                action, policies, detail = governance.policy_check(prompt, answer)
                trace_bus.emit(
                    trace_schema.guardrail_check(
                        trace_schema.NODE_GUARDRAIL, action, policies, detail
                    )
                )
                scores, verdict, rationale = governance.evaluate_response(
                    prompt, answer, policy_action=action
                )
                trace_bus.emit(
                    trace_schema.evaluation(
                        trace_schema.NODE_EVALUATION, scores, verdict, rationale
                    )
                )
            except Exception:  # noqa: BLE001 - governance must never break the answer
                pass
            if plan.write_after:
                trace_bus.emit(
                    trace_schema.memory_write(config.NODE_ORCHESTRATOR, "stm", 1)
                )
        except Exception as exc:  # noqa: BLE001 - surface as an error completion
            result_holder["error"] = str(exc)
        finally:
            trace_bus.clear_emitter()
            trace_queue.put(_DONE)

    worker = threading.Thread(target=_worker, name="agent-invoke", daemon=True)
    worker.start()

    # Drain trace events as they are produced, then emit the final completion.
    while True:
        item = trace_queue.get()
        if item is _DONE:
            break
        event = item.to_dict() if hasattr(item, "to_dict") else item
        yield {"type": "trace", "event": event}

    worker.join(timeout=1)
    if "error" in result_holder:
        yield {"type": "chunk", "text": f"error: {result_holder['error']}"}
    else:
        yield {"type": "chunk", "text": result_holder.get("text", "")}


if app is not None:

    @app.entrypoint
    def invoke(payload: dict[str, Any]):  # noqa: D401
        """AgentCore Runtime entrypoint."""
        return _invoke(payload)


if __name__ == "__main__" and app is not None:
    app.run()
