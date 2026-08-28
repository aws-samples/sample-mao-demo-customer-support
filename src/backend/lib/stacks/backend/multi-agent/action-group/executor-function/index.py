"""Athena query tool — AgentCore Gateway Lambda target.

Reworked from the former Bedrock action group (`POST /athenaQuery`) to the
Gateway Lambda-target contract. AgentCore Gateway invokes this Lambda with the
tool's arguments as the event body (`{"query": "<sql>"}`); the explicit
`{"tool_name", "arguments"}` envelope is also accepted for direct/test calls.
The handler returns plain JSON.

Behavior (Req 3.3-3.5, 3.8):
- Reject malformed/invalid or non-read-only SQL before executing (validation error).
- Execute with a 60s deadline; on timeout call StopQueryExecution and return a
  timeout error with NO partial data.
- On execution failure return a cause-identifying error with NO partial data.
"""

import os
from time import monotonic, sleep

import boto3
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
athena_client = boto3.client("athena")

TOOL_NAME = "athena_query"
QUERY_TIMEOUT_SECONDS = 60

# Read-only statement keywords the tool is permitted to run. Anything else
# (INSERT/UPDATE/DELETE/DDL) is rejected without execution (Req 3.5).
_ALLOWED_PREFIXES = (
    "select",
    "show",
    "describe",
    "with",
)


def is_syntactically_valid(query) -> bool:
    """Pure validation: is `query` a non-empty, single, allowed SQL statement?

    Rejects non-strings, blank strings, multi-statement inputs, and statements
    that do not start with an allowed keyword (Req 3.5). Kept pure for testing.
    """
    if not isinstance(query, str):
        return False
    stripped = query.strip().rstrip(";").strip()
    if stripped == "":
        return False
    # Disallow stacked statements (a ';' remaining inside the body).
    if ";" in stripped:
        return False
    lowered = stripped.lower()
    return any(lowered.startswith(prefix) for prefix in _ALLOWED_PREFIXES)


# --------------------------------------------------------------------------- #
# Athena execution helpers                                                    #
# --------------------------------------------------------------------------- #


def execute_athena_query(query, s3_output):  # nosec
    response = athena_client.start_query_execution(
        QueryString=query, ResultConfiguration={"OutputLocation": s3_output}
    )
    return response["QueryExecutionId"]


def _query_status(execution_id) -> dict:
    """Return the full Athena Status object (State + StateChangeReason + …)."""
    response = athena_client.get_query_execution(QueryExecutionId=execution_id)
    return response["QueryExecution"]["Status"]


def check_query_status(execution_id):
    return _query_status(execution_id)["State"]


class QueryTimeout(Exception):
    """Raised when a query exceeds QUERY_TIMEOUT_SECONDS."""


class QueryExecutionError(Exception):
    """Raised when Athena reports FAILED/CANCELLED, carrying the actual cause.

    `reason` is Athena's StateChangeReason (e.g. "TABLE_NOT_FOUND: … Table
    'x.y' does not exist" or "COLUMN_NOT_FOUND: …"), which is actionable enough
    for the calling agent to correct the query and retry.
    """

    def __init__(self, state: str, reason: str):
        self.state = state
        self.reason = reason
        super().__init__(f"{state}: {reason}")


def get_query_results(execution_id, timeout_seconds=QUERY_TIMEOUT_SECONDS):  # nosec
    """Poll until the query completes or the deadline passes.

    On deadline, cancels the query (StopQueryExecution) and raises QueryTimeout
    so the caller can return a timeout error with no partial data (Req 3.4). On
    FAILED/CANCELLED, raises QueryExecutionError carrying Athena's actual
    StateChangeReason so the caller can surface a self-correctable error.
    """
    deadline = monotonic() + timeout_seconds
    while True:
        status = _query_status(execution_id)
        state = status["State"]
        if state in ("SUCCEEDED", "FAILED", "CANCELLED"):
            break
        if monotonic() >= deadline:
            try:
                athena_client.stop_query_execution(QueryExecutionId=execution_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"stop_query_execution failed: {exc}")
            raise QueryTimeout(f"Query exceeded {timeout_seconds}s and was cancelled")
        sleep(1)  # nosemgrep: arbitrary-sleep
    if state == "SUCCEEDED":
        return athena_client.get_query_results(QueryExecutionId=execution_id)
    reason = status.get("StateChangeReason") or f"Query {state}"
    raise QueryExecutionError(state, reason)


# Dry-run validation: EXPLAIN resolves tables/columns and type-checks the query
# WITHOUT scanning any data, so it catches the common failure modes (wrong table
# or column names) cheaply before we run the real query.
EXPLAIN_TIMEOUT_SECONDS = 30


def validate_query(query, s3_output) -> str | None:  # nosec
    """Return None if the query passes EXPLAIN, else Athena's failure reason.

    A None result means the query's tables/columns resolve and it can run. A
    non-None result is the actionable reason the query is invalid (surfaced to
    the agent so it can fix the names and retry).
    """
    try:
        execution_id = execute_athena_query(f"EXPLAIN {query}", s3_output)
        get_query_results(execution_id, timeout_seconds=EXPLAIN_TIMEOUT_SECONDS)
        return None
    except QueryExecutionError as exc:
        return exc.reason
    except QueryTimeout:
        return "validation (EXPLAIN) timed out"


# --------------------------------------------------------------------------- #
# Tool entrypoint                                                             #
# --------------------------------------------------------------------------- #


def run_athena_query(query):
    """Validate a read-only query, dry-run it (EXPLAIN), execute, return JSON.

    Flow: syntactic check -> EXPLAIN dry-run (resolves tables/columns without
    scanning data) -> execute. Validation and execution failures return the
    actual Athena reason so the calling agent can correct the query and retry.
    """
    if not is_syntactically_valid(query):
        return {"error": "validation_error", "detail": "Query rejected: invalid or unsupported SQL."}

    normalized = query.strip().rstrip(";")
    s3_output = os.getenv("ATHENA_RESULTS_BUCKET_PATH")

    # Dry-run the query with EXPLAIN first: this resolves tables/columns without
    # scanning data, so a wrong table/column name is caught here and returned as
    # an actionable, self-correctable message instead of an opaque failure.
    invalid_reason = validate_query(normalized, s3_output)
    if invalid_reason is not None:
        return {
            "error": "validation_error",
            "detail": f"Query did not validate against the schema: {invalid_reason}",
        }

    try:
        execution_id = execute_athena_query(normalized, s3_output)
        result = get_query_results(execution_id)
        return {"resultSet": result}
    except QueryTimeout as exc:
        return {"error": "timeout", "detail": str(exc)}  # no partial data (Req 3.4)
    except QueryExecutionError as exc:
        # Surface Athena's real StateChangeReason so the agent can self-correct.
        return {"error": "execution_error", "detail": exc.reason}  # no partial data (Req 3.8)
    except Exception as exc:  # noqa: BLE001
        return {"error": "execution_error", "detail": str(exc)}  # no partial data (Req 3.8)


def extract_query(event: dict) -> str | None:
    """Extract the SQL `query` argument from either invocation contract.

    AgentCore Gateway invokes a Lambda target with the tool's ARGUMENTS as the
    event body (the tool name is carried in the Lambda client context), i.e.
    `{"query": "<sql>"}`. Direct/test invocations use the explicit envelope
    `{"tool_name": ..., "arguments": {"query": "<sql>"}}`. Support both.
    """
    if not isinstance(event, dict):
        return None
    arguments = event.get("arguments")
    if isinstance(arguments, dict) and "query" in arguments:
        return arguments.get("query")
    return event.get("query")


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext):
    """AgentCore Gateway Lambda-target entrypoint."""
    logger.info({"event_keys": list(event.keys()) if isinstance(event, dict) else None})
    return run_athena_query(extract_query(event))
