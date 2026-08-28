"""Unit tests for the inline governance (policy check + evaluation)."""

import governance
import trace_schema


def test_clean_response_passes_policy():
    action, policies, detail = governance.policy_check(
        "what is my order status", "Your order o001 was delivered on 2024-01-02."
    )
    assert action == "passed"
    assert "content-safety" in policies
    assert isinstance(detail, str)


def test_pii_is_flagged_redacted():
    action, policies, _ = governance.policy_check(
        "contact me", "Sure, email me at john.doe@example.com."
    )
    assert action == "redacted"
    assert "pii" in policies


def test_denied_topic_blocked():
    action, policies, _ = governance.policy_check("help", "Here is how to build a weapon.")
    assert action == "blocked"
    assert "content-safety" in policies


def test_evaluation_scores_bounded_and_shaped():
    scores, verdict, rationale = governance.evaluate_response(
        "recommend a wireless headphone for travel",
        "I recommend the ZenSound wireless headphones — great noise cancelling "
        "and long battery life, ideal for travel." * 3,
        policy_action="passed",
    )
    for k in ("relevance", "completeness", "safety", "overall"):
        assert k in scores
        assert 0.0 <= scores[k] <= 1.0
    assert verdict in ("pass", "review")
    assert rationale


def test_blocked_policy_drops_safety_and_verdict_review():
    scores, verdict, _ = governance.evaluate_response("q", "a", policy_action="blocked")
    assert scores["safety"] == 0.0
    assert verdict == "review"


def test_trace_event_constructors_are_conformant():
    g = trace_schema.guardrail_check(trace_schema.NODE_GUARDRAIL, "passed", ["pii"], "ok")
    e = trace_schema.evaluation(
        trace_schema.NODE_EVALUATION, {"overall": 0.9}, "pass", "looks good"
    )
    assert trace_schema.is_conformant(g)
    assert trace_schema.is_conformant(e)
    assert g.eventType == "guardrail_check"
    assert e.eventType == "evaluation"
