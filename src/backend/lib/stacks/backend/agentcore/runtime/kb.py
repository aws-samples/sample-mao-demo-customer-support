"""Knowledge Base retrieval tool — proxied through the AgentCore Gateway.

KB retrieval now runs in a Gateway Lambda target (registered as the `kb_retrieve`
MCP tool), mirroring the Athena tool. This module builds each agent's Strands
`kb_retrieve(query)` tool that PROXIES to that Gateway tool via the shared
`GatewayToolClient`, injecting the agent's knowledge-base NAME so the model's
tool interface stays `kb_retrieve(query)` and the KB choice is not left to the
LLM. Emits a `kb_retrieval` Trace_Event (with timing) for each call.

`rank_passages` is retained here as a pure helper (a copy also lives in the
Lambda) so Property 4 (bounded + score-ordered) can be tested without AWS.

Requirements: 4.4, 4.5, 4.7, 4.8, 8.2
"""

from __future__ import annotations

from typing import Any

MAX_PASSAGES: int = 5


def rank_passages(results: list[dict[str, Any]], limit: int = MAX_PASSAGES) -> list[dict[str, Any]]:
    """Return at most `limit` passages ordered by descending relevance score.

    An empty input yields an empty output (Req 4.7). Ordering is stable for
    equal scores. Missing scores are treated as 0.0.
    """
    ordered = sorted(results, key=lambda r: r.get("score", 0.0), reverse=True)
    return ordered[:limit]


def build_kb_retrieve_tool(gateway_client: Any, knowledge_base: str, agent_id: str = ""):
    """Build a `kb_retrieve` Strands tool that proxies to the Gateway KB tool.

    `knowledge_base` (e.g. "personalization" | "prod_rec" | "troubleshoot") is
    closed over so the agent calls `kb_retrieve(query)` without choosing a KB.
    Deferred `strands` import keeps this testable. Emits a `kb_retrieval`
    Trace_Event for each call (Req 8.2).
    """
    from strands import tool  # noqa: WPS433 (deferred import by design)

    import time

    import trace_bus
    import trace_schema

    @tool
    def kb_retrieve(query: str) -> list[dict[str, Any]]:
        """Retrieve up to 5 relevant passages from this agent's knowledge base.

        Args:
            query: The natural-language search query.

        Returns:
            Up to 5 passages ({text, score, source}) ordered by descending
            relevance; empty on no match. A single-element `[{"error": ...}]`
            list is returned if retrieval fails (Req 4.8).
        """
        started = time.perf_counter()
        result = gateway_client.call(
            "kb_retrieve", {"knowledge_base": knowledge_base, "query": query}
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)

        if isinstance(result, dict) and result.get("error"):
            error = f"{result.get('error')}: {result.get('detail', '')}".strip(": ")
            # Still emit a (0-passage) trace so the workflow reflects the attempt.
            trace_bus.emit(
                trace_schema.kb_retrieval(
                    agent_id or trace_bus.current_agent("supervisor-agent"),
                    knowledge_base,
                    query,
                    [],
                    duration_ms=elapsed_ms,
                )
            )
            return [{"error": f"kb_retrieve failed: {error}"}]

        passages = result.get("passages", []) if isinstance(result, dict) else []
        previews: list[dict[str, Any]] = [
            {
                "text": p.get("text", ""),
                "score": p.get("score"),
                "source": p.get("source", ""),
            }
            for p in passages
            if isinstance(p, dict)
        ]
        trace_bus.emit(
            trace_schema.kb_retrieval(
                agent_id or trace_bus.current_agent("supervisor-agent"),
                knowledge_base,
                query,
                previews,
                duration_ms=elapsed_ms,
            )
        )
        return previews

    return kb_retrieve
