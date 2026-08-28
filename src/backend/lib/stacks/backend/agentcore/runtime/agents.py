"""Strands agents: orchestrator + four specialists ("Agents as Tools").

Each of the five agents wraps a distinct BedrockModel (the multi-model mix), and
each specialist is exposed to the orchestrator as an @tool with failure isolation
(Req 1.2, 1.8). The orchestrator selects zero or more specialists and consolidates
a single response (Req 1.1, 1.3, 1.4, 1.7).

Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.7, 2.8
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable

import config
from prompts import load_agent_prompt

UNAVAILABLE_SENTINEL = "__specialist_unavailable__"


@dataclass
class AgentHandle:
    """A built agent plus the metadata needed for AgentProfile/UI (Req 2.8)."""

    node_id: str
    display_name: str
    model_id: str
    system_prompt: str
    tool_names: list[str]
    agent: Any  # strands.Agent


def _build_bedrock_model(model_id: str):
    from strands.models import BedrockModel

    return BedrockModel(model_id=model_id, region_name=config.REGION)


def build_specialist(node_id: str, tools: list[Any]) -> AgentHandle:
    """Build one specialist agent with its assigned model and verbatim prompt."""
    from strands import Agent

    model_id = config.AGENT_MODELS[node_id]
    system_prompt = load_agent_prompt(node_id)
    agent = Agent(
        model=_build_bedrock_model(model_id),
        system_prompt=system_prompt,
        tools=tools,
    )
    return AgentHandle(
        node_id=node_id,
        display_name=config.AGENT_DISPLAY_NAMES[node_id],
        model_id=model_id,
        system_prompt=system_prompt,
        tool_names=[getattr(t, "__name__", str(t)) for t in tools],
        agent=agent,
    )


def make_specialist_tool(handle: AgentHandle, on_trace: Callable[[Any], None] | None = None):
    """Wrap a specialist as an @tool with failure isolation (Req 1.8).

    On specialist exception, returns an "unavailable" sentinel instead of raising,
    so the orchestrator can consolidate the remaining specialists' output.

    Emits a `routing_decision` Trace_Event when the orchestrator delegates to this
    specialist, and marks it as the currently executing agent so the tools it runs
    (gateway/KB/code-interpreter) are attributed to it (Req 8.2, 8.8).
    """
    from strands import tool

    import trace_bus
    import trace_schema

    @tool(name=f"{handle.node_id.replace('-', '_')}")
    def _specialist_tool(query: str) -> str:
        """Delegate a sub-question to the specialist and return its answer."""
        trace_bus.emit(
            trace_schema.routing_decision(
                config.NODE_ORCHESTRATOR, [handle.node_id], query=query
            )
        )
        trace_bus.push_agent(handle.node_id)
        started = time.perf_counter()
        try:
            answer = str(handle.agent(query))
            # Surface the specialist's own reasoning AND its authoritative total
            # wall-clock time (agentTotalMs) so its trace dropdown shows a real
            # duration rather than 0.00s (single tool-call agents otherwise have
            # no timestamp gap to measure). Best-effort: never break the answer.
            try:
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                reasoning = _extract_agent_reasoning(handle.agent)
                trace_bus.emit(
                    trace_schema.agent_reasoning(
                        handle.node_id, reasoning, total_ms=elapsed_ms
                    )
                )
            except Exception:  # noqa: BLE001 - tracing must never break the answer
                pass
            return answer
        except Exception as exc:  # noqa: BLE001 - isolate specialist failure
            if on_trace is not None:
                on_trace({"agentId": handle.node_id, "unavailable": True, "error": str(exc)})
            return f"{UNAVAILABLE_SENTINEL}:{handle.display_name}"
        finally:
            trace_bus.pop_agent()

    return _specialist_tool


def _extract_agent_reasoning(agent: Any) -> str:
    """Collect an agent's assistant-side text (its reasoning) from message history.

    Strands messages are `{"role", "content": [{"text"|"toolUse"|...}]}`; we keep
    the text blocks from assistant turns and drop tool-use/tool-result blocks.
    Fully defensive: returns "" on any unexpected shape.
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


@dataclass
class ConsolidatedResult:
    text: str
    succeeded: list[str]
    unavailable: list[str]


def consolidate_responses(results: dict[str, str]) -> ConsolidatedResult:
    """Combine specialist outputs into a single response (Req 1.3, 1.8).

    Any output carrying the unavailable sentinel is excluded from the combined
    text and reported as unavailable; all successful outputs are included in
    input order.
    """
    succeeded: list[str] = []
    unavailable: list[str] = []
    parts: list[str] = []
    for node_id, output in results.items():
        if isinstance(output, str) and output.startswith(UNAVAILABLE_SENTINEL):
            unavailable.append(node_id)
        else:
            succeeded.append(node_id)
            parts.append(output)
    text = "\n".join(parts)
    if unavailable:
        names = ", ".join(unavailable)
        text = (text + f"\n\n(Note: {names} was unavailable.)").strip()
    return ConsolidatedResult(text=text, succeeded=succeeded, unavailable=unavailable)


def build_orchestrator(specialist_tools: list[Any], session_manager: Any = None) -> AgentHandle:
    """Build the Nova Premier orchestrator wired to the specialist tools.

    When a `session_manager` is provided it is passed to the Agent constructor so
    Strands wires its persistence hooks up front (assigning it after construction
    does not reliably persist conversation turns to AgentCore Memory).
    """
    from strands import Agent

    node_id = config.NODE_ORCHESTRATOR
    model_id = config.AGENT_MODELS[node_id]
    system_prompt = load_agent_prompt(node_id)
    agent_kwargs: dict[str, Any] = {
        "model": _build_bedrock_model(model_id),
        "system_prompt": system_prompt,
        "tools": specialist_tools,
    }
    if session_manager is not None:
        agent_kwargs["session_manager"] = session_manager
    agent = Agent(**agent_kwargs)
    return AgentHandle(
        node_id=node_id,
        display_name=config.AGENT_DISPLAY_NAMES[node_id],
        model_id=model_id,
        system_prompt=system_prompt,
        tool_names=[getattr(t, "__name__", str(t)) for t in specialist_tools],
        agent=agent,
    )
