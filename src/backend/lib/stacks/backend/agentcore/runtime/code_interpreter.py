"""Code Interpreter tool wiring.

`run_code_impl` is a pure orchestration function around a sandbox invoke: it
enforces a 30s bound, emits a `code_interpreter_run` Trace_Event (with the code
and truncated output), and on error/timeout returns an error message without
terminating the calling specialist session (Req 9.2, 9.3, 9.5, 9.6). The sandbox
invoke is injected so this is unit-testable without AgentCore.

Requirements: 9.1, 9.2, 9.3, 9.5, 9.6
"""

from __future__ import annotations

import time
from typing import Any, Callable

import config
import trace_schema

CODE_TIMEOUT_SECONDS = 30


class SandboxTimeout(Exception):
    """Raised by a sandbox invoke when execution exceeds the time bound."""


def run_code_impl(
    agent_id: str,
    code: str,
    sandbox_invoke: Callable[[str, int], str],
    emit_trace: Callable[[trace_schema.TraceEvent], None],
    timeout_s: int = CODE_TIMEOUT_SECONDS,
) -> str:
    """Execute `code` via `sandbox_invoke`, emit a trace, and return output/error.

    - success -> emits a code_interpreter_run event (status "ok"), returns output
    - timeout -> emits status "timeout", returns a timeout error message (Req 9.6)
    - error   -> emits status "error", returns an error message (Req 9.5)
    The calling session is never terminated; errors are returned as strings.
    """
    started = time.perf_counter()
    try:
        output = sandbox_invoke(code, timeout_s)
    except SandboxTimeout:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        emit_trace(
            trace_schema.code_interpreter_run(agent_id, code, "", "timeout", duration_ms=elapsed_ms)
        )
        return f"Code execution timed out after {timeout_s}s."
    except Exception as exc:  # noqa: BLE001 - return error, do not crash (Req 9.5)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        emit_trace(
            trace_schema.code_interpreter_run(agent_id, code, str(exc), "error", duration_ms=elapsed_ms)
        )
        return f"Code execution failed: {exc}"

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    emit_trace(
        trace_schema.code_interpreter_run(agent_id, code, output, "ok", duration_ms=elapsed_ms)
    )
    return output


def build_run_code_tool(agent_id: str, emit_trace: Callable[[trace_schema.TraceEvent], None]):
    """Build the `run_code` Strands tool bound to the AgentCore Code Interpreter.

    Deferred imports keep this module importable/testable without the SDK.
    """
    from strands import tool

    def _sandbox_invoke(code: str, timeout_s: int) -> str:
        from bedrock_agentcore.tools.code_interpreter import CodeInterpreter  # type: ignore

        with CodeInterpreter(region=config.REGION) as ci:
            result = ci.invoke(code, timeout_s=timeout_s)
            return getattr(result, "output", str(result))

    @tool
    def run_code(code: str) -> str:
        """Execute Python code in a secure sandbox and return its output."""
        return run_code_impl(agent_id, code, _sandbox_invoke, emit_trace)

    return run_code
