"""Centralized configuration for the AgentCore runtime.

Model identifiers are cross-region inference profile IDs. Bedrock enables access to
foundation models by default, so these normally need no per-model opt-in; Anthropic
models do require the one-time first-time-use details on the account. Keeping the
IDs here as constants means a model tier can be swapped for an agent without
touching agent logic.

Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 15.2, 13.1
"""

from __future__ import annotations

import os

# --- AWS / region -----------------------------------------------------------

REGION: str = os.environ.get("AWS_REGION", "us-east-1")

# --- Model inference-profile IDs (verified ACTIVE in us-east-1) --------------
# Each of the five agents is backed by a distinct current-generation model,
# spanning both Bedrock providers to showcase multi-model support (Req 2.4).

NOVA_PRO: str = "us.amazon.nova-pro-v1:0"                  # Orchestrator
CLAUDE_SONNET_5: str = "us.anthropic.claude-sonnet-5"       # Personalization
NOVA_2_LITE: str = "us.amazon.nova-2-lite-v1:0"            # ProductRecommendation
CLAUDE_HAIKU_4_5: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"  # OrderManagement
NOVA_MICRO: str = "us.amazon.nova-micro-v1:0"              # Troubleshoot

# --- Stable node IDs (must match the frontend Trace_Engine) ------------------
# These five identifiers are unique and stable across sessions/reloads (Req 15.2).

NODE_ORCHESTRATOR: str = "supervisor-agent"
NODE_PERSONALIZATION: str = "personalization-agent"
NODE_ORDER_MANAGEMENT: str = "order-mgmt-agent"
NODE_PRODUCT_RECOMMENDATION: str = "product-rec-agent"
NODE_TROUBLESHOOT: str = "ts-agent"

NODE_IDS: tuple[str, ...] = (
    NODE_ORCHESTRATOR,
    NODE_PERSONALIZATION,
    NODE_ORDER_MANAGEMENT,
    NODE_PRODUCT_RECOMMENDATION,
    NODE_TROUBLESHOOT,
)

# --- Per-agent model assignment ---------------------------------------------
# node_id -> model inference-profile ID. Enforces the distinct-model invariant
# (Req 2.4): the set of values below has exactly five unique entries.

AGENT_MODELS: dict[str, str] = {
    NODE_ORCHESTRATOR: NOVA_PRO,
    NODE_PERSONALIZATION: CLAUDE_SONNET_5,
    NODE_PRODUCT_RECOMMENDATION: NOVA_2_LITE,
    NODE_ORDER_MANAGEMENT: CLAUDE_HAIKU_4_5,
    NODE_TROUBLESHOOT: NOVA_MICRO,
}

# --- Human-readable display names (used in AgentProfile / UI) ----------------

AGENT_DISPLAY_NAMES: dict[str, str] = {
    NODE_ORCHESTRATOR: "Supervisor",
    NODE_PERSONALIZATION: "Personalization",
    NODE_ORDER_MANAGEMENT: "OrderManagement",
    NODE_PRODUCT_RECOMMENDATION: "ProductRecommendation",
    NODE_TROUBLESHOOT: "Troubleshoot",
}

# --- Feature flags -----------------------------------------------------------


def _env_flag(name: str, default: bool = False) -> bool:
    """Interpret an environment variable as a boolean flag.

    Treated as enabled ONLY when explicitly set to a truthy string; disabled in
    every other case, including when unset (Req 13.1).
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Browser built-in tool (Stretch) is disabled unless explicitly enabled (Req 13.1).
BROWSER_ENABLED_DEFAULT: bool = _env_flag("BROWSER_TOOL_ENABLED", default=False)


def assert_distinct_models() -> None:
    """Fail fast if the five agents do not each use a distinct model (Req 2.4)."""
    models = list(AGENT_MODELS.values())
    if len(set(models)) != len(models):
        raise ValueError(
            f"Each agent must use a distinct model (Req 2.4); got: {models}"
        )
    if set(AGENT_MODELS.keys()) != set(NODE_IDS):
        raise ValueError("AGENT_MODELS keys must match the five stable node IDs")
