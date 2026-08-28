"""Outbound OAuth2 (client-credentials) token provider for the AgentCore Gateway.

Fetches and caches an M2M access token from the gateway's Cognito token endpoint
so the agent's MCP client can call gateway tools (Req 3.2, 11.3). The HTTP call
and clock are injectable so the caching logic is unit-testable without network.

Requirements: 3.2, 11.3, 11.4
"""

from __future__ import annotations

import time
from typing import Any, Callable

# Refresh a little before actual expiry to avoid edge-of-expiry failures.
EXPIRY_BUFFER_SECONDS = 300


class TokenFetchError(RuntimeError):
    """Raised when the token endpoint does not return a usable token (Req 11.4)."""


class GatewayTokenProvider:
    def __init__(
        self,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        scope: str,
        http_post: Callable[..., dict[str, Any]],
        now_fn: Callable[[], float] = time.time,
    ):
        self._endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._http_post = http_post
        self._now = now_fn
        self._token: str | None = None
        self._expires_at: float = 0.0

    def get_token(self) -> str:
        """Return a cached token if still valid, else fetch and cache a new one."""
        now = self._now()
        if self._token is not None and now < self._expires_at:
            return self._token

        data = self._http_post(
            self._endpoint,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "scope": self._scope,
            },
        )
        token = data.get("access_token") if isinstance(data, dict) else None
        if not token or not isinstance(token, str):
            raise TokenFetchError("token endpoint did not return an access_token")

        expires_in = int(data.get("expires_in", 3600))
        self._token = token
        self._expires_at = now + max(0, expires_in - EXPIRY_BUFFER_SECONDS)
        return token
