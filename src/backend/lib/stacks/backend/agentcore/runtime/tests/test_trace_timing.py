"""Tests for the optional per-step / per-agent timing fields on trace events.

These durations let the UI show real processing time per dropdown instead of
inferring it from event-timestamp gaps (which read 0.00s for single-event
agents). All timing params are optional and omitted from the payload when not
provided, keeping the schema backward compatible.
"""

import trace_schema


def test_gateway_tool_call_includes_duration_when_provided():
    ev = trace_schema.gateway_tool_call(
        "order-mgmt-agent", "athena_query", {"query": "select 1"}, result={"ok": True}, duration_ms=1234
    )
    assert ev.payload["durationMs"] == 1234
    assert trace_schema.is_conformant(ev)


def test_gateway_tool_call_omits_duration_by_default():
    ev = trace_schema.gateway_tool_call("order-mgmt-agent", "athena_query", {"query": "select 1"})
    assert "durationMs" not in ev.payload


def test_kb_retrieval_includes_duration():
    ev = trace_schema.kb_retrieval("ts-agent", "kb-1", "how to reset", [], duration_ms=567)
    assert ev.payload["durationMs"] == 567


def test_code_interpreter_run_includes_duration():
    ev = trace_schema.code_interpreter_run("product-rec-agent", "print(1)", "1", "ok", duration_ms=42)
    assert ev.payload["durationMs"] == 42


def test_agent_reasoning_includes_agent_total_when_provided():
    ev = trace_schema.agent_reasoning("personalization-agent", "thinking...", total_ms=8900)
    assert ev.payload["agentTotalMs"] == 8900
    assert ev.payload["text"] == "thinking..."
    assert trace_schema.is_conformant(ev)


def test_agent_reasoning_omits_agent_total_by_default():
    ev = trace_schema.agent_reasoning("supervisor-agent", "thinking...")
    assert "agentTotalMs" not in ev.payload


def test_negative_durations_are_clamped_to_zero():
    ev = trace_schema.gateway_tool_call(
        "order-mgmt-agent", "athena_query", {"query": "x"}, duration_ms=-5
    )
    assert ev.payload["durationMs"] == 0
