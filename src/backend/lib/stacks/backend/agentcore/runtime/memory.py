"""Memory control flow: STM toggle + LTM strategies.

`memory_plan` is a pure decision function capturing the toggle invariant so it
can be property-tested (Req 6.3, 6.4): when disabled, no reads/writes occur; when
enabled and available, a read precedes the response and a write follows it.
`build_session_manager` constructs the actual AgentCore Strands session manager.

Requirements: 6.1, 6.3, 6.4, 6.7, 10.1, 10.6
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class MemoryPlan:
    """Whether the runtime should read/write memory for a turn."""

    read_before: bool
    write_after: bool


class LtmWriteError(RuntimeError):
    """Raised when a long-term preference write fails (Req 10.3)."""


def apply_preference_write(
    prior: dict[str, Any], updates: dict[str, Any], commit: Callable[[dict[str, Any]], None]
) -> dict[str, Any]:
    """Atomically apply a preference write (Req 10.3).

    If `commit` fails, the stored state is left exactly equal to `prior` (no
    partial update) and LtmWriteError is raised. On success, returns the merged
    state. `prior` is never mutated.
    """
    try:
        commit(updates)
    except Exception as exc:  # noqa: BLE001
        raise LtmWriteError(str(exc)) from exc
    return {**prior, **updates}


def memory_plan(memory_enabled: bool, memory_available: bool) -> MemoryPlan:
    """Decide memory operations for a turn.

    - disabled            -> no read, no write (Req 6.4)
    - enabled + available -> read before, write after (Req 6.3)
    - enabled + unavailable -> no read, no write; respond without context (Req 6.7)
    """
    if memory_enabled and memory_available:
        return MemoryPlan(read_before=True, write_after=True)
    return MemoryPlan(read_before=False, write_after=False)


def build_session_manager(
    session_id: str,
    actor_id: str,
    memory_enabled: bool,
    memory_id: str,
    region: str,
    ltm_retrieval_config: dict[str, Any] | None = None,
):
    """Build an AgentCore memory session manager, or None when disabled.

    Returns None when memory is disabled (no reads/writes, Req 6.4). On memory
    unavailability the caller should degrade to a stateless response (Req 6.7).
    Deferred imports keep this module importable without the SDK.
    """
    if not memory_enabled:
        return None

    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import (
        AgentCoreMemorySessionManager,
    )

    config_kwargs: dict[str, Any] = {
        "memory_id": memory_id,
        "session_id": session_id,
        "actor_id": actor_id,
    }
    if ltm_retrieval_config:
        config_kwargs["retrieval_config"] = ltm_retrieval_config

    return AgentCoreMemorySessionManager(
        agentcore_memory_config=AgentCoreMemoryConfig(**config_kwargs),
        region_name=region,
    )
