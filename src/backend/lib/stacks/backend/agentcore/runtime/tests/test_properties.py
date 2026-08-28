"""Property-based tests for the AgentCore runtime pure-logic modules.

Feature: agentcore-migration. Each correctness property from the design is
implemented as a single property-based test (>=100 iterations via Hypothesis).
"""

from __future__ import annotations

import string

from hypothesis import given, settings
from hypothesis import strategies as st

import config
import kb
import normalize
import profiles
import session
import trace_schema
from agents import UNAVAILABLE_SENTINEL, consolidate_responses
from gateway import is_authorized
from memory import LtmWriteError, apply_preference_write, memory_plan

SETTINGS = settings(max_examples=100)

_text = st.text(alphabet=string.printable, max_size=200)


# Feature: agentcore-migration, Property 1: Session_Id resolution — non-empty
# passes through unchanged; empty yields a fresh unique non-empty id.
@SETTINGS
@given(st.one_of(st.none(), _text))
def test_property_1_session_resolution(raw):
    resolved = session.resolve_session_id(raw)
    assert isinstance(resolved, str) and resolved.strip() != ""
    if isinstance(raw, str) and raw.strip() != "":
        assert resolved == raw
    else:
        assert resolved != (raw or "")


# Feature: agentcore-migration, Property 2: Specialist failure isolation —
# consolidated response includes all successes, excludes all failures, and flags
# each failing specialist unavailable.
@SETTINGS
@given(
    st.dictionaries(
        st.sampled_from(list(config.NODE_IDS)),
        st.booleans(),  # True => this specialist failed
        min_size=0,
        max_size=5,
    )
)
def test_property_2_specialist_failure_isolation(fail_map):
    results = {
        node_id: (f"{UNAVAILABLE_SENTINEL}:{node_id}" if failed else f"answer from {node_id}")
        for node_id, failed in fail_map.items()
    }
    consolidated = consolidate_responses(results)
    expected_failures = {n for n, f in fail_map.items() if f}
    expected_successes = {n for n, f in fail_map.items() if not f}
    assert set(consolidated.unavailable) == expected_failures
    assert set(consolidated.succeeded) == expected_successes
    for node_id in expected_successes:
        assert f"answer from {node_id}" in consolidated.text
    for node_id in expected_failures:
        assert f"{UNAVAILABLE_SENTINEL}:{node_id}" not in consolidated.text


# Feature: agentcore-migration, Property 16: Long-term memory write atomicity —
# a failed write leaves stored state equal to prior (no partial update) and
# raises an error; a successful write merges the updates.
@SETTINGS
@given(
    st.dictionaries(st.text(max_size=8), st.integers(), max_size=6),
    st.dictionaries(st.text(max_size=8), st.integers(), max_size=6),
    st.booleans(),
)
def test_property_16_ltm_write_atomicity(prior, updates, will_fail):
    prior_snapshot = dict(prior)

    def _commit(_updates):
        if will_fail:
            raise RuntimeError("store unavailable")

    if will_fail:
        try:
            apply_preference_write(prior, updates, _commit)
            assert False, "expected LtmWriteError"
        except LtmWriteError:
            pass
        assert prior == prior_snapshot  # no partial update; prior not mutated
    else:
        result = apply_preference_write(prior, updates, _commit)
        assert result == {**prior_snapshot, **updates}
        assert prior == prior_snapshot  # prior never mutated


# Feature: agentcore-migration, Property 4: KB retrieval is bounded and
# score-ordered — <=5 passages, non-increasing score, highest-scoring subset;
# empty input -> empty output.
@SETTINGS
@given(st.lists(st.fixed_dictionaries({"id": st.integers(), "score": st.floats(-1e6, 1e6)}), max_size=40))
def test_property_4_kb_bounded_ordered(results):
    ranked = kb.rank_passages(results)
    assert len(ranked) <= kb.MAX_PASSAGES
    scores = [r["score"] for r in ranked]
    assert scores == sorted(scores, reverse=True)
    all_sorted = sorted((r["score"] for r in results), reverse=True)
    assert scores == all_sorted[: kb.MAX_PASSAGES]
    if not results:
        assert ranked == []


_event_kwargs = st.fixed_dictionaries(
    {
        "agent_id": st.sampled_from(list(config.NODE_IDS)),
        "selected": st.lists(st.sampled_from(list(config.NODE_IDS)), max_size=4),
    }
)


# Feature: agentcore-migration, Property 7: Trace_Event schema conformance —
# exactly one of six types, non-empty agent id, timestamp, non-empty version.
@SETTINGS
@given(_event_kwargs)
def test_property_7_schema_conformance(kw):
    ev = trace_schema.routing_decision(kw["agent_id"], kw["selected"])
    assert trace_schema.is_conformant(ev)
    d = ev.to_dict()
    assert d["eventType"] in trace_schema.EVENT_TYPES
    assert isinstance(d["agentId"], str) and d["agentId"]
    assert isinstance(d["timestamp"], int)
    assert isinstance(d["schemaVersion"], str) and d["schemaVersion"]


# Feature: agentcore-migration, Property 8: Trace_Event JSON round-trip —
# serialize then parse yields identical field names and values.
@SETTINGS
@given(
    st.sampled_from(list(config.NODE_IDS)),
    _text,
    _text,
    st.sampled_from(["ok", "error", "timeout"]),
)
def test_property_8_json_round_trip(agent_id, code, output, status):
    ev = trace_schema.code_interpreter_run(agent_id, code, output, status)
    rt = trace_schema.TraceEvent.from_json(ev.to_json())
    assert rt.to_dict() == ev.to_dict()


# Feature: agentcore-migration, Property 9: Unmappable source records are
# filtered — emits exactly mappable-derived events, records unmapped, no raise.
_source_record = st.one_of(
    st.fixed_dictionaries(
        {"eventType": st.sampled_from(sorted(trace_schema.EVENT_TYPES)), "agentId": st.sampled_from(list(config.NODE_IDS))}
    ),
    st.fixed_dictionaries({"eventType": st.sampled_from(["bogus", ""]), "agentId": _text}),
    st.none(),
    st.integers(),
    st.text(max_size=10),
)


@SETTINGS
@given(st.lists(_source_record, max_size=30))
def test_property_9_unmappable_filtered(records):
    events, unmapped = normalize.normalize_records(records)
    assert len(events) + len(unmapped) == len(records)
    assert all(trace_schema.is_conformant(e) for e in events)


# Feature: agentcore-migration, Property 14: Memory toggle invariant — disabled
# => no reads/writes; enabled + available => read before and write after.
@SETTINGS
@given(st.booleans(), st.booleans())
def test_property_14_memory_toggle(enabled, available):
    plan = memory_plan(enabled, available)
    if not enabled:
        assert not plan.read_before and not plan.write_after
    elif enabled and available:
        assert plan.read_before and plan.write_after
    else:  # enabled but unavailable -> stateless (Req 6.7)
        assert not plan.read_before and not plan.write_after


# Feature: agentcore-migration, Property 15: Code interpreter trace truncation —
# code unchanged; output length <=10000 and equals leading 10000 chars if longer.
@SETTINGS
@given(_text, st.text(alphabet="ab", max_size=20000), st.sampled_from(["ok", "error", "timeout"]))
def test_property_15_code_truncation(code, output, status):
    ev = trace_schema.code_interpreter_run("product-rec-agent", code, output, status)
    assert ev.payload["code"] == code
    assert len(ev.payload["output"]) <= trace_schema.CODE_OUTPUT_MAX_CHARS
    assert ev.payload["output"] == output[: trace_schema.CODE_OUTPUT_MAX_CHARS]


# Feature: agentcore-migration, Property 17: authorization rejection — any
# missing/expired/invalid token is rejected; only a valid unexpired token passes.
_token = st.one_of(
    st.none(),
    st.integers(),
    st.fixed_dictionaries({"access_token": st.text(max_size=5), "expires_at": st.floats(-1e9, 1e9)}),
    st.fixed_dictionaries({"access_token": st.just(""), "expires_at": st.just(1e18)}),
)


@SETTINGS
@given(_token)
def test_property_17_authorization_rejection(token):
    now = 1_000_000.0
    result = is_authorized(token, now=now)
    valid = (
        isinstance(token, dict)
        and isinstance(token.get("access_token"), str)
        and token.get("access_token") != ""
        and isinstance(token.get("expires_at"), (int, float))
        and token["expires_at"] > now
    )
    assert result == valid


# Feature: agentcore-migration, Property 19: Browser tool flag defaults to
# disabled — enabled only when explicitly truthy; disabled otherwise/absent.
@SETTINGS
@given(st.one_of(st.none(), st.sampled_from(["true", "1", "yes", "on", "false", "0", "no", "", "maybe", "TRUE"])))
def test_property_19_browser_flag_default(value):
    import os

    key = "BROWSER_TOOL_ENABLED"
    prior = os.environ.get(key)
    try:
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
        result = config._env_flag(key, default=False)
        expected = value is not None and value.strip().lower() in {"1", "true", "yes", "on"}
        assert result == expected
    finally:
        if prior is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = prior


# Feature: agentcore-migration, Property 20: Agent profile completeness and
# secret exclusion — required non-empty fields; no credential/secret/token keys.
@SETTINGS
@given(st.sampled_from(list(config.NODE_IDS)))
def test_property_20_profile_completeness_no_secrets(node_id):
    profile = profiles.build_agent_profile(node_id)
    assert profile["displayName"]
    assert profile["modelId"]
    assert profile["systemPrompt"].strip()
    assert isinstance(profile["tools"], list)
    assert isinstance(profile["knowledgeBases"], list)
    assert not profiles.contains_secret_field(profile)
