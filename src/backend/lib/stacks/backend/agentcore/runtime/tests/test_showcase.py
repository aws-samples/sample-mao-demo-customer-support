"""Unit tests for the Code Interpreter tool and Gateway token provider.

Covers Req 9.5/9.6 (code interpreter error/timeout) and Req 3.2/11.3/11.4
(OAuth2 token caching, refresh, and fetch failure).
"""

import pytest

import trace_schema
from code_interpreter import SandboxTimeout, run_code_impl
from gateway_token import GatewayTokenProvider, TokenFetchError


class _Collector:
    def __init__(self):
        self.events = []

    def __call__(self, event):
        self.events.append(event)


def test_code_success_emits_ok_trace_and_returns_output():
    emit = _Collector()
    out = run_code_impl("product-rec-agent", "print(2+2)", lambda c, t: "4", emit)
    assert out == "4"
    assert len(emit.events) == 1
    assert emit.events[0].payload["status"] == "ok"
    assert emit.events[0].payload["code"] == "print(2+2)"


def test_code_timeout_emits_timeout_trace_without_crashing():
    emit = _Collector()

    def _slow(_code, _t):
        raise SandboxTimeout()

    out = run_code_impl("product-rec-agent", "while True: pass", _slow, emit)
    assert "timed out" in out.lower()
    assert emit.events[0].payload["status"] == "timeout"


def test_code_error_emits_error_trace_without_crashing():
    emit = _Collector()

    def _boom(_code, _t):
        raise ValueError("boom")

    out = run_code_impl("order-mgmt-agent", "1/0", _boom, emit)
    assert "failed" in out.lower()
    assert emit.events[0].payload["status"] == "error"


def test_code_output_truncated_in_trace():
    emit = _Collector()
    run_code_impl("product-rec-agent", "x", lambda c, t: "z" * 50000, emit)
    assert len(emit.events[0].payload["output"]) == trace_schema.CODE_OUTPUT_MAX_CHARS


# --- Gateway token provider -------------------------------------------------


def _make_clock(start=1000.0):
    state = {"t": start}
    return state, (lambda: state["t"])


def test_token_is_cached_within_validity_window():
    calls = {"n": 0}

    def _post(_url, data):  # noqa: ARG001
        calls["n"] += 1
        return {"access_token": f"tok{calls['n']}", "expires_in": 3600}

    _state, clock = _make_clock()
    p = GatewayTokenProvider("ep", "cid", "sec", "scope", _post, now_fn=clock)
    assert p.get_token() == "tok1"
    assert p.get_token() == "tok1"  # cached
    assert calls["n"] == 1


def test_token_refreshes_after_expiry():
    calls = {"n": 0}

    def _post(_url, data):  # noqa: ARG001
        calls["n"] += 1
        return {"access_token": f"tok{calls['n']}", "expires_in": 3600}

    state, clock = _make_clock()
    p = GatewayTokenProvider("ep", "cid", "sec", "scope", _post, now_fn=clock)
    assert p.get_token() == "tok1"
    state["t"] += 3600  # advance past (expires_in - buffer)
    assert p.get_token() == "tok2"
    assert calls["n"] == 2


def test_token_fetch_failure_raises():
    def _post(_url, data):  # noqa: ARG001
        return {"error": "invalid_client"}

    p = GatewayTokenProvider("ep", "cid", "sec", "scope", _post)
    with pytest.raises(TokenFetchError):
        p.get_token()
