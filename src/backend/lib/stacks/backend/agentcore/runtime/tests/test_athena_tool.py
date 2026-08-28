"""Unit tests for the reworked Athena Gateway tool validation (Req 3.5, 3.8)."""

import importlib.util
import os
import sys

import pytest

# Load the executor module by path (it lives outside the runtime package).
_EXECUTOR_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "multi-agent", "action-group", "executor-function", "index.py",
    )
)

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("aws_lambda_powertools") is None,
    reason="aws_lambda_powertools not installed",
)


def _load_executor():
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    spec = importlib.util.spec_from_file_location("athena_executor", _EXECUTOR_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["athena_executor"] = module
    spec.loader.exec_module(module)
    return module


def test_valid_select_accepted():
    ex = _load_executor()
    assert ex.is_syntactically_valid("SELECT * FROM order_management.orders")
    assert ex.is_syntactically_valid("  describe order_management.orders  ")


@pytest.mark.parametrize(
    "bad",
    [
        None,
        123,
        "",
        "   ",
        "DELETE FROM orders",          # not an allowed statement
        "DROP DATABASE order_management",
        "SELECT 1; DROP TABLE orders", # stacked statements
        "UPDATE orders SET x=1",
    ],
)
def test_invalid_sql_rejected(bad):
    ex = _load_executor()
    assert ex.is_syntactically_valid(bad) is False


def test_malformed_query_returns_validation_error_without_executing():
    ex = _load_executor()
    result = ex.run_athena_query("DELETE FROM orders")
    assert result["error"] == "validation_error"
    assert "resultSet" not in result  # no partial data


def test_explain_failure_returns_actionable_validation_error(monkeypatch):
    """A query that fails EXPLAIN is rejected with the real reason, not executed."""
    ex = _load_executor()
    reason = "TABLE_NOT_FOUND: line 1:15: Table 'mac_personalization.personalization' does not exist"
    monkeypatch.setattr(ex, "validate_query", lambda q, s3: reason)

    def _should_not_run(*a, **k):  # pragma: no cover - must not be called
        raise AssertionError("query executed despite failing EXPLAIN validation")

    monkeypatch.setattr(ex, "execute_athena_query", _should_not_run)
    result = ex.run_athena_query("SELECT * FROM mac_personalization.personalization")
    assert result["error"] == "validation_error"
    assert reason in result["detail"]
    assert "resultSet" not in result


def test_execution_failure_surfaces_real_reason(monkeypatch):
    """When Athena FAILS at run time, the tool returns its StateChangeReason."""
    ex = _load_executor()
    monkeypatch.setattr(ex, "validate_query", lambda q, s3: None)  # passes EXPLAIN
    monkeypatch.setattr(ex, "execute_athena_query", lambda q, s3: "exec-123")

    def _raise(*a, **k):
        raise ex.QueryExecutionError("FAILED", "SYNTAX_ERROR: column 'foo' cannot be resolved")

    monkeypatch.setattr(ex, "get_query_results", _raise)
    result = ex.run_athena_query("SELECT foo FROM order_management.orders")
    assert result["error"] == "execution_error"
    assert result["detail"] == "SYNTAX_ERROR: column 'foo' cannot be resolved"


def test_valid_query_executes_and_returns_results(monkeypatch):
    ex = _load_executor()
    monkeypatch.setattr(ex, "validate_query", lambda q, s3: None)
    monkeypatch.setattr(ex, "execute_athena_query", lambda q, s3: "exec-123")
    monkeypatch.setattr(ex, "get_query_results", lambda eid: {"Rows": [{"Data": []}]})
    result = ex.run_athena_query("SELECT * FROM order_management.orders")
    assert result.get("resultSet") == {"Rows": [{"Data": []}]}
    assert "error" not in result
