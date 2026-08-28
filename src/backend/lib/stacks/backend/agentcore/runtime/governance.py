"""Lightweight, inline governance for a turn: a policy/guardrail check and an
automated quality evaluation of the final response.

These are deterministic, dependency-free heuristics (no extra model call) so
they are fast and reliable in the demo. They surface the *concepts* — content
policy enforcement and response evaluation — in the trace stream and workflow
diagram. They can later be swapped for a managed Bedrock Guardrail and an
LLM-as-judge / Bedrock Evaluations backend without changing the trace contract.
"""

from __future__ import annotations

import re

# --- Policy / guardrail -----------------------------------------------------

# The policy dimensions this guardrail screens for (shown as "checked").
POLICY_DIMENSIONS = ["content-safety", "pii", "prompt-attack"]

_PII_PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    "phone": re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
}

# A tiny denied-topic list (illustrative content-safety policy).
_DENIED_TERMS = ("weapon", "malware", "explosive")


def policy_check(prompt: str, response: str) -> tuple[str, list[str], str]:
    """Screen a turn against content policy.

    Returns (action, policies, detail) where action is
    "passed" | "redacted" | "blocked". Reporting-only: it never mutates the
    response (redaction here means "PII was detected and would be redacted").
    """
    text = response or ""
    lowered = f"{prompt or ''}\n{text}".lower()

    blocked = [t for t in _DENIED_TERMS if t in lowered]
    if blocked:
        return "blocked", ["content-safety"], f"Denied topic(s): {', '.join(blocked)}"

    pii_hits = [name for name, pat in _PII_PATTERNS.items() if pat.search(text)]
    if pii_hits:
        return "redacted", ["pii"], f"PII detected: {', '.join(sorted(pii_hits))}"

    return "passed", list(POLICY_DIMENSIONS), "No policy violations detected."


# --- Evaluation -------------------------------------------------------------

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "the a an and or of to for in on with is are was were be been do does did "
    "how what why when where which who i you your my our can could would should "
    "please help me about into from at as it this that".split()
)


def _keywords(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall((text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def _round(x: float) -> float:
    return round(max(0.0, min(1.0, x)), 2)


def evaluate_response(
    prompt: str,
    response: str,
    policy_action: str = "passed",
) -> tuple[dict[str, float], str, str]:
    """Heuristically score the final response.

    Dimensions (0-1): relevance (keyword coverage of the prompt), completeness
    (substantive length), safety (from the policy action). Returns
    (scores, verdict, rationale).
    """
    resp = response or ""
    q_words = _keywords(prompt)
    r_words = _keywords(resp)

    relevance = _round(len(q_words & r_words) / len(q_words)) if q_words else 0.75
    # Completeness: a substantive answer (~60+ words) scores well; scale up to 1.
    completeness = _round(len(resp.split()) / 60.0)
    safety = 1.0 if policy_action == "passed" else (0.5 if policy_action == "redacted" else 0.0)

    scores = {"relevance": relevance, "completeness": completeness, "safety": safety}
    overall = _round((relevance + completeness + safety) / 3.0)
    scores["overall"] = overall

    verdict = "pass" if overall >= 0.6 and safety >= 0.5 else "review"
    rationale = (
        f"relevance {relevance:.2f}, completeness {completeness:.2f}, "
        f"safety {safety:.2f} -> overall {overall:.2f} ({verdict})."
    )
    return scores, verdict, rationale
