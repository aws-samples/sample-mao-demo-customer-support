"""AgentProfile assembly for the transparency (details) view.

Builds one profile per agent from the same instructions.txt + model constants
used to construct the agents, deliberately excluding any credential/secret/token
fields (Req 16.1, 16.3, 16.5). Delivered to the frontend inside the runtime
configuration (VITE_RUNTIME_CONFIG).

Requirements: 16.1, 16.3, 16.5
"""

from __future__ import annotations

from typing import Any

import config
from prompts import load_agent_prompt

# node_id -> tools available to that agent (mirrors the app.py tool matrix).
AGENT_TOOLS: dict[str, list[str]] = {
    config.NODE_ORCHESTRATOR: [],  # orchestrates via specialist tools
    config.NODE_PERSONALIZATION: ["athena_query", "kb_retrieve"],
    config.NODE_PRODUCT_RECOMMENDATION: ["athena_query", "kb_retrieve", "run_code"],
    config.NODE_ORDER_MANAGEMENT: ["athena_query", "run_code"],
    config.NODE_TROUBLESHOOT: ["kb_retrieve"],
}

# node_id -> associated knowledge bases (pre-migration KB consumers).
AGENT_KNOWLEDGE_BASES: dict[str, list[str]] = {
    config.NODE_ORCHESTRATOR: [],
    config.NODE_PERSONALIZATION: ["personalization"],
    config.NODE_PRODUCT_RECOMMENDATION: ["prod_rec"],
    config.NODE_ORDER_MANAGEMENT: [],
    config.NODE_TROUBLESHOOT: ["troubleshoot"],
}

# Personalization is the only agent with long-term memory strategies (Req 10).
_LTM_AGENTS = {config.NODE_PERSONALIZATION}

# Keys that must never appear in a profile (secret exclusion, Req 16.5).
_FORBIDDEN_KEYS = {"credential", "credentials", "secret", "token", "password", "apikey", "api_key"}


def build_agent_profile(node_id: str, base_dir: str | None = None) -> dict[str, Any]:
    """Build a single AgentProfile dict for the given agent node id."""
    return {
        "nodeId": node_id,
        "displayName": config.AGENT_DISPLAY_NAMES[node_id],
        "modelId": config.AGENT_MODELS[node_id],
        "systemPrompt": load_agent_prompt(node_id, base_dir=base_dir),
        "tools": list(AGENT_TOOLS[node_id]),
        "knowledgeBases": list(AGENT_KNOWLEDGE_BASES[node_id]),
        "memory": {"stm": True, "ltm": node_id in _LTM_AGENTS},
    }


def build_agent_profiles(base_dir: str | None = None) -> dict[str, dict[str, Any]]:
    """Build all five AgentProfiles keyed by node id."""
    return {nid: build_agent_profile(nid, base_dir=base_dir) for nid in config.NODE_IDS}


def contains_secret_field(profile: dict[str, Any]) -> bool:
    """Return True if any key in the profile looks like a secret (Req 16.5)."""
    for key in profile:
        normalized = key.lower().replace("_", "")
        if any(bad.replace("_", "") in normalized for bad in _FORBIDDEN_KEYS):
            return True
    return False
