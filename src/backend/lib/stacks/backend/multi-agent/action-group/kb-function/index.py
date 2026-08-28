"""Knowledge Base retrieval tool — AgentCore Gateway Lambda target.

Exposes `kb_retrieve` as an MCP tool behind the AgentCore Gateway (mirroring the
Athena tool). AgentCore Gateway invokes this Lambda with the tool arguments as
the event body (`{"knowledge_base": "<name>", "query": "<text>"}`); the explicit
`{"tool_name", "arguments"}` envelope is also accepted for direct/test calls.

It maps a knowledge-base NAME to its KB id (env), runs a Bedrock `retrieve`, and
returns up to 5 score-ordered passage previews `{text, score, source}`. Errors
are returned as `{"error", "detail"}` with no partial data.
"""

import os

import boto3
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")

MAX_PASSAGES = 5

# knowledge_base name -> environment variable holding that KB's id.
_KB_ENV = {
    "personalization": "KB_PERSONALIZATION_ID",
    "prod_rec": "KB_PRODUCT_REC_ID",
    "troubleshoot": "KB_TROUBLESHOOT_ID",
}


def rank_passages(results, limit=MAX_PASSAGES):
    """Return at most `limit` passages ordered by descending relevance score.

    Empty input yields empty output; missing scores are treated as 0.0; ordering
    is stable for equal scores. Kept pure for unit testing.
    """
    ordered = sorted(results, key=lambda r: r.get("score", 0.0), reverse=True)
    return ordered[:limit]


def _preview(passage):
    """Compact {text, score, source} view of a Bedrock retrieval result."""
    content = passage.get("content")
    text = content.get("text", "") if isinstance(content, dict) else ""
    location = passage.get("location")
    source = ""
    if isinstance(location, dict):
        s3 = location.get("s3Location")
        if isinstance(s3, dict):
            source = s3.get("uri", "")
    return {"text": text, "score": passage.get("score"), "source": source}


def resolve_kb_id(name):
    """Map a knowledge-base name to its configured KB id ("" if unknown)."""
    env_key = _KB_ENV.get((name or "").strip().lower())
    return os.getenv(env_key, "") if env_key else ""


def run_kb_retrieve(knowledge_base, query):
    """Validate, run Bedrock retrieve for the named KB, return ranked previews."""
    if not isinstance(query, str) or not query.strip():
        return {"error": "validation_error", "detail": "query is required."}
    kb_id = resolve_kb_id(knowledge_base)
    if not kb_id:
        return {
            "error": "validation_error",
            "detail": f"Unknown knowledge_base '{knowledge_base}'. "
            f"Expected one of: {', '.join(sorted(_KB_ENV))}.",
        }
    try:
        resp = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": MAX_PASSAGES}
            },
        )
    except Exception as exc:  # noqa: BLE001 - surface cause, no partial data
        return {"error": "execution_error", "detail": f"kb_retrieve failed: {exc}"}

    ranked = rank_passages(resp.get("retrievalResults", []))
    return {"passages": [_preview(p) for p in ranked]}


def extract_args(event):
    """Extract (knowledge_base, query) from either invocation contract."""
    if not isinstance(event, dict):
        return "", ""
    arguments = event.get("arguments")
    if isinstance(arguments, dict):
        return arguments.get("knowledge_base", ""), arguments.get("query", "")
    return event.get("knowledge_base", ""), event.get("query", "")


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext):
    """AgentCore Gateway Lambda-target entrypoint."""
    knowledge_base, query = extract_args(event)
    logger.info({"knowledge_base": knowledge_base, "has_query": bool(query)})
    return run_kb_retrieve(knowledge_base, query)
