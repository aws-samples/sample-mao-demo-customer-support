"""Verbatim system-prompt loader.

Reads each agent's `instructions.txt` byte-for-byte and refuses to substitute a
default prompt: a missing, unreadable, or empty file is a hard initialization
error (Req 2.5). The prompt returned is the complete, unmodified file content
(Req 2.4).

Requirements: 2.5, 2.6
"""

from __future__ import annotations

import os

# Prompt files are resolved from one of two locations:
#   * In the built container image, the CDK asset stages copies of the agent
#     instruction files into a `agent_instructions/` directory next to this file
#     (the multi-agent source tree is outside the Docker build context).
#   * In local dev / unit tests, they are read from the sibling
#     .../backend/multi-agent/ source directory.
_RUNTIME_DIR = os.path.dirname(os.path.abspath(__file__))
_BUNDLED_DIR = os.path.join(_RUNTIME_DIR, "agent_instructions")
_SIBLING_MULTI_AGENT_DIR = os.path.abspath(
    os.path.join(_RUNTIME_DIR, "..", "..", "multi-agent")
)
_MULTI_AGENT_DIR = _BUNDLED_DIR if os.path.isdir(_BUNDLED_DIR) else _SIBLING_MULTI_AGENT_DIR

# node_id -> instructions.txt path (relative to the multi-agent directory).
INSTRUCTION_FILES: dict[str, str] = {
    "supervisor-agent": "instructions.txt",
    "personalization-agent": os.path.join("personalization", "instructions.txt"),
    "order-mgmt-agent": os.path.join("order_management", "instructions.txt"),
    "product-rec-agent": os.path.join("product_recommendation", "instructions.txt"),
    "ts-agent": os.path.join("troubleshoot", "instructions.txt"),
}


class PromptLoadError(RuntimeError):
    """Raised when an agent's instruction file cannot be loaded verbatim."""


def read_instructions(path: str) -> str:
    """Return the complete, unmodified content of an instructions file.

    Raises PromptLoadError if the file is missing, unreadable, or empty. Never
    substitutes a default prompt (Req 2.5).
    """
    if not os.path.isfile(path):
        raise PromptLoadError(f"Instruction file not found: {path}")
    try:
        # newline="" disables universal-newline translation so the content is
        # returned byte-for-byte (verbatim), satisfying Req 2.4.
        with open(path, "r", encoding="utf-8", newline="") as fh:
            content = fh.read()
    except OSError as exc:  # unreadable (permissions, IO error, etc.)
        raise PromptLoadError(f"Instruction file unreadable: {path}: {exc}") from exc

    if content.strip() == "":
        raise PromptLoadError(f"Instruction file is empty: {path}")

    return content


def load_agent_prompt(node_id: str, base_dir: str | None = None) -> str:
    """Load the verbatim system prompt for one of the five agents by node id."""
    if node_id not in INSTRUCTION_FILES:
        raise PromptLoadError(f"Unknown agent node id: {node_id}")
    base = base_dir if base_dir is not None else _MULTI_AGENT_DIR
    return read_instructions(os.path.join(base, INSTRUCTION_FILES[node_id]))
