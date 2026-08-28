"""Prompt-loader property + unit tests (Req 2.4, 2.5)."""

import os
import string
import tempfile

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import prompts

SETTINGS = settings(max_examples=100)


# Feature: agentcore-migration, Property 3: System prompt loaded verbatim —
# non-empty content returns byte-for-byte; missing/unreadable/empty raises an
# init error and never substitutes a default.
@SETTINGS
@given(st.text(alphabet=string.printable, min_size=1).filter(lambda s: s.strip() != ""))
def test_property_3_prompt_loaded_verbatim(content):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "instructions.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        assert prompts.read_instructions(path) == content


def test_missing_file_raises():
    with pytest.raises(prompts.PromptLoadError):
        prompts.read_instructions("/no/such/instructions.txt")


@pytest.mark.parametrize("blank", ["", "   ", "\n\t  \n"])
def test_empty_or_whitespace_file_raises(blank):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "instructions.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(blank)
        with pytest.raises(prompts.PromptLoadError):
            prompts.read_instructions(path)


def test_all_five_real_prompts_load():
    for node_id in (
        "supervisor-agent",
        "personalization-agent",
        "order-mgmt-agent",
        "product-rec-agent",
        "ts-agent",
    ):
        assert prompts.load_agent_prompt(node_id).strip()
