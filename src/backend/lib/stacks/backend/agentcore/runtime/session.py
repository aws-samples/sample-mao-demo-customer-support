"""Session_Id resolution.

A non-empty payload `sessionId` passes through unchanged; an absent/empty value
yields a freshly generated unique, non-empty id (Req 1.5, 1.6).
"""

from __future__ import annotations

import uuid


def resolve_session_id(session_id: str | None) -> str:
    """Return the given non-empty session id, else a fresh unique one."""
    if isinstance(session_id, str) and session_id.strip() != "":
        return session_id
    return f"sess-{uuid.uuid4()}"
