"""Unit tests for the KB Gateway tool Lambda (kb-function)."""

import importlib.util
import os
import sys

import pytest

# Load the KB Lambda module by path (it lives outside the runtime package).
_KB_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "multi-agent", "action-group", "kb-function", "index.py",
    )
)

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("aws_lambda_powertools") is None,
    reason="aws_lambda_powertools not installed",
)


def _load_kb():
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    os.environ["KB_PERSONALIZATION_ID"] = "kb-personal-123"
    os.environ["KB_PRODUCT_REC_ID"] = "kb-prod-456"
    os.environ["KB_TROUBLESHOOT_ID"] = "kb-ts-789"
    spec = importlib.util.spec_from_file_location("kb_executor", _KB_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["kb_executor"] = module
    spec.loader.exec_module(module)
    return module


def test_rank_passages_bounded_and_ordered():
    kb = _load_kb()
    results = [{"score": 0.1}, {"score": 0.9}, {"score": 0.5}] + [{"score": 0.0}] * 10
    ranked = kb.rank_passages(results)
    assert len(ranked) <= kb.MAX_PASSAGES
    scores = [r.get("score", 0.0) for r in ranked]
    assert scores == sorted(scores, reverse=True)


def test_rank_passages_empty():
    kb = _load_kb()
    assert kb.rank_passages([]) == []


def test_resolve_kb_id_maps_names_case_insensitively():
    kb = _load_kb()
    assert kb.resolve_kb_id("personalization") == "kb-personal-123"
    assert kb.resolve_kb_id("PROD_REC") == "kb-prod-456"
    assert kb.resolve_kb_id(" troubleshoot ") == "kb-ts-789"
    assert kb.resolve_kb_id("nope") == ""


def test_run_kb_retrieve_rejects_empty_query():
    kb = _load_kb()
    out = kb.run_kb_retrieve("personalization", "  ")
    assert out["error"] == "validation_error"


def test_run_kb_retrieve_rejects_unknown_kb():
    kb = _load_kb()
    out = kb.run_kb_retrieve("does-not-exist", "hello")
    assert out["error"] == "validation_error"
    assert "unknown knowledge_base" in out["detail"].lower()


def test_extract_args_supports_both_contracts():
    kb = _load_kb()
    assert kb.extract_args({"knowledge_base": "prod_rec", "query": "x"}) == ("prod_rec", "x")
    assert kb.extract_args({"arguments": {"knowledge_base": "troubleshoot", "query": "y"}}) == (
        "troubleshoot",
        "y",
    )


def test_run_kb_retrieve_returns_ranked_previews(monkeypatch):
    kb = _load_kb()

    class _FakeClient:
        def retrieve(self, **_kwargs):
            return {
                "retrievalResults": [
                    {"score": 0.2, "content": {"text": "low"}, "location": {"s3Location": {"uri": "s3://b/low"}}},
                    {"score": 0.8, "content": {"text": "high"}, "location": {"s3Location": {"uri": "s3://b/high"}}},
                ]
            }

    monkeypatch.setattr(kb, "bedrock_agent_runtime", _FakeClient())
    out = kb.run_kb_retrieve("personalization", "find something")
    assert "passages" in out
    assert out["passages"][0]["text"] == "high"  # ordered by descending score
    assert out["passages"][0]["source"] == "s3://b/high"
