"""Per-invocation trace bus.

Tools (gateway/KB/code-interpreter) and the specialist wrappers emit normalized
Trace_Events through this module so `app.py` can stream them to the resolver as
`{"type":"trace","event":...}` items (Req 5.3, 7, 8).

The current emitter and the "current agent" attribution stack are process-level
globals. AgentCore Runtime processes one invocation per request; the emitter is
installed at the start of `_invoke` and cleared at the end. Globals (rather than
contextvars) are used deliberately so attribution still works when Strands runs
tool calls on worker threads. Concurrent invocations on a single instance could
interleave attribution — acceptable for this demo.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

_emitter: Optional[Callable[[Any], None]] = None
_agent_stack: list[str] = []


def set_emitter(fn: Callable[[Any], None]) -> None:
    """Install the trace sink for the current invocation and reset attribution."""
    global _emitter, _agent_stack
    _emitter = fn
    _agent_stack = []


def clear_emitter() -> None:
    """Remove the trace sink (end of invocation)."""
    global _emitter, _agent_stack
    _emitter = None
    _agent_stack = []


def emit(event: Any) -> None:
    """Emit a Trace_Event to the current sink; a no-op when none is installed."""
    fn = _emitter
    if fn is None:
        return
    try:
        fn(event)
    except Exception:  # noqa: BLE001 - tracing must never break the turn
        pass


def push_agent(node_id: str) -> None:
    """Mark `node_id` as the currently executing agent (for tool attribution)."""
    _agent_stack.append(node_id)


def pop_agent() -> None:
    """Leave the current agent scope."""
    if _agent_stack:
        _agent_stack.pop()


def current_agent(default: str) -> str:
    """Return the innermost executing agent id, or `default` when none is set."""
    return _agent_stack[-1] if _agent_stack else default
