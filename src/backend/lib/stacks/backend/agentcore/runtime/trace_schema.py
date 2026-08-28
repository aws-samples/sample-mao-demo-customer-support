"""Normalized Trace_Schema for the AgentCore runtime.

The runtime emits Trace_Event records that the frontend Trace_Engine renders as
clean, per-agent reasoning. Each event carries exactly one of six event types,
a non-empty producing-agent id, a timestamp, and a non-empty schema version
(Req 7.1-7.3, 7.7). Records are JSON round-trippable (Req 7.6).

Requirements: 7.1, 7.2, 7.3, 7.6, 7.7
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any

SCHEMA_VERSION: str = "1.0"

# The event types defined by the schema (Req 7.2). Exactly one per event.
EVENT_TYPES: frozenset[str] = frozenset(
    {
        "routing_decision",
        "gateway_tool_call",
        "kb_retrieval",
        "memory_read",
        "memory_write",
        "code_interpreter_run",
        "agent_reasoning",
        "guardrail_check",
        "evaluation",
    }
)

# Stable node ids for the two governance components surfaced in the workflow
# diagram (they are not agents, but they participate in the trace stream).
NODE_GUARDRAIL: str = "guardrail-node"
NODE_EVALUATION: str = "evaluation-node"

# The orchestrator's reasoning text can be long; cap it so trace payloads stay
# bounded (mirrors CODE_OUTPUT_MAX_CHARS).
REASONING_MAX_CHARS: int = 8000


@dataclass
class TraceEvent:
    """A single normalized trace record.

    `payload` is an event-type-specific dict (see the design's payload shapes).
    Keeping it a plain dict keeps JSON round-trip trivial and total (Req 7.6).
    """

    eventType: str
    agentId: str
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))
    schemaVersion: str = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TraceEvent":
        return cls(
            eventType=data["eventType"],
            agentId=data["agentId"],
            payload=dict(data.get("payload", {})),
            timestamp=int(data["timestamp"]),
            schemaVersion=data["schemaVersion"],
        )

    @classmethod
    def from_json(cls, raw: str) -> "TraceEvent":
        return cls.from_dict(json.loads(raw))


def is_conformant(event: Any) -> bool:
    """Return True iff `event` (TraceEvent or dict) conforms to the Trace_Schema.

    Conformance requires exactly one of the six event types, a non-empty agent
    id, an integer timestamp, and a non-empty schema version (Req 7.1-7.3, 7.7).
    """
    data = event.to_dict() if isinstance(event, TraceEvent) else event
    if not isinstance(data, dict):
        return False
    if data.get("eventType") not in EVENT_TYPES:
        return False
    agent_id = data.get("agentId")
    if not isinstance(agent_id, str) or agent_id == "":
        return False
    if not isinstance(data.get("timestamp"), int):
        return False
    version = data.get("schemaVersion")
    if not isinstance(version, str) or version == "":
        return False
    if not isinstance(data.get("payload", {}), dict):
        return False
    return True


# --- Payload constructors (event-type-specific shapes from the design) -------


def routing_decision(
    agent_id: str,
    selected_specialists: list[str],
    query: str | None = None,
) -> TraceEvent:
    """Orchestrator routing decision; selected list may be empty (Req 8.8).

    When provided, `query` is the sub-question the orchestrator delegated to the
    selected specialist — surfaced in the trace so the routing step shows the
    actual prompt sent to the sub-agent, not just the specialist name.
    """
    payload: dict[str, Any] = {"selectedSpecialists": list(selected_specialists)}
    if query:
        payload["query"] = query[:REASONING_MAX_CHARS]
    return TraceEvent(
        eventType="routing_decision",
        agentId=agent_id,
        payload=payload,
    )


def agent_reasoning(agent_id: str, text: str, total_ms: int | None = None) -> TraceEvent:
    """An agent's natural-language reasoning/synthesis narrative (truncated).

    Used to surface the orchestrator's own thinking (how it decomposed the
    request and synthesized specialists' output), which is otherwise invisible
    because the orchestrator only emits routing decisions.

    When provided, `total_ms` is the agent's total wall-clock time for the turn
    (`agentTotalMs`) — an authoritative per-agent duration the UI can display as
    the dropdown's total time instead of inferring it from event-timestamp gaps
    (which under-count single-event agents and model-inference time).
    """
    payload: dict[str, Any] = {"text": (text or "")[:REASONING_MAX_CHARS]}
    if total_ms is not None:
        payload["agentTotalMs"] = int(max(0, total_ms))
    return TraceEvent(
        eventType="agent_reasoning",
        agentId=agent_id,
        payload=payload,
    )


def gateway_tool_call(
    agent_id: str,
    tool_name: str,
    arguments: dict[str, Any],
    result: dict[str, Any] | None = None,
    error: str | None = None,
    duration_ms: int | None = None,
) -> TraceEvent:
    payload: dict[str, Any] = {"toolName": tool_name, "arguments": arguments}
    if result is not None:
        payload["result"] = result
    if error is not None:
        payload["error"] = error
    if duration_ms is not None:
        payload["durationMs"] = int(max(0, duration_ms))
    return TraceEvent(eventType="gateway_tool_call", agentId=agent_id, payload=payload)


# A KB passage preview is truncated so the trace payload stays bounded, and we
# include at most this many passages in the trace event.
KB_PASSAGE_PREVIEW_MAX_CHARS: int = 700
KB_MAX_TRACE_PASSAGES: int = 5


def kb_retrieval(
    agent_id: str,
    knowledge_base_id: str,
    query: str,
    passages: list[dict[str, Any]],
    duration_ms: int | None = None,
) -> TraceEvent:
    """KB retrieval event including truncated passage previews.

    `passages` is a list of `{text, score, source}` previews (already filtered to
    successful results). The retrieved text is surfaced so the UI can show what
    the knowledge base actually returned, not just the count.
    """
    passages = list(passages or [])
    trimmed: list[dict[str, Any]] = []
    for p in passages[:KB_MAX_TRACE_PASSAGES]:
        trimmed.append(
            {
                "text": str(p.get("text", ""))[:KB_PASSAGE_PREVIEW_MAX_CHARS],
                "score": p.get("score"),
                "source": p.get("source", ""),
            }
        )
    payload: dict[str, Any] = {
        "knowledgeBaseId": knowledge_base_id,
        "query": query,
        "passageCount": len(passages),
        "passages": trimmed,
    }
    if duration_ms is not None:
        payload["durationMs"] = int(max(0, duration_ms))
    return TraceEvent(
        eventType="kb_retrieval",
        agentId=agent_id,
        payload=payload,
    )


def memory_read(agent_id: str, scope: str, item_count: int) -> TraceEvent:
    return TraceEvent(
        eventType="memory_read",
        agentId=agent_id,
        payload={"scope": scope, "itemCount": item_count},
    )


def memory_write(agent_id: str, scope: str, item_count: int) -> TraceEvent:
    return TraceEvent(
        eventType="memory_write",
        agentId=agent_id,
        payload={"scope": scope, "itemCount": item_count},
    )


CODE_OUTPUT_MAX_CHARS: int = 10_000


GUARDRAIL_DETAIL_MAX_CHARS: int = 500
EVAL_RATIONALE_MAX_CHARS: int = 1000


def guardrail_check(
    agent_id: str,
    action: str,
    policies: list[str],
    detail: str = "",
) -> TraceEvent:
    """AgentCore policy / guardrail evaluation of a turn.

    `action` is one of "passed" | "blocked" | "redacted". `policies` names the
    policy dimensions checked (or the ones that fired). Surfaces content-safety
    governance in the trace + workflow diagram.
    """
    return TraceEvent(
        eventType="guardrail_check",
        agentId=agent_id,
        payload={
            "action": action,
            "policies": list(policies),
            "detail": (detail or "")[:GUARDRAIL_DETAIL_MAX_CHARS],
        },
    )


def evaluation(
    agent_id: str,
    scores: dict[str, float],
    verdict: str,
    rationale: str = "",
) -> TraceEvent:
    """Automated quality evaluation of the final response.

    `scores` maps a dimension (e.g. "relevance", "faithfulness", "safety") to a
    0-1 score; `verdict` is a short overall label ("pass"/"review"/etc.).
    """
    return TraceEvent(
        eventType="evaluation",
        agentId=agent_id,
        payload={
            "scores": {k: float(v) for k, v in dict(scores).items()},
            "verdict": verdict,
            "rationale": (rationale or "")[:EVAL_RATIONALE_MAX_CHARS],
        },
    )


def code_interpreter_run(
    agent_id: str,
    code: str,
    output: str,
    status: str,
    duration_ms: int | None = None,
) -> TraceEvent:
    """Code interpreter run; output is truncated to 10,000 chars (Req 9.3)."""
    payload: dict[str, Any] = {
        "code": code,
        "output": output[:CODE_OUTPUT_MAX_CHARS],
        "status": status,
    }
    if duration_ms is not None:
        payload["durationMs"] = int(max(0, duration_ms))
    return TraceEvent(
        eventType="code_interpreter_run",
        agentId=agent_id,
        payload=payload,
    )
