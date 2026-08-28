"""AgentCore Gateway MCP client + OAuth2 token provider + auth guard.

`is_authorized` is a pure guard so authorization rejection can be property-tested
without a live gateway (Req 3.6, 11.2). `GatewayToolClient` performs the MCP call
using a cached client-credentials bearer token; if outbound credentials cannot be
obtained the call is skipped with an error returned to the caller and the overall
invocation is not terminated (Req 11.4).

Requirements: 3.2, 3.6, 3.7, 11.4
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable


def is_authorized(token: dict[str, Any] | None, now: float | None = None) -> bool:
    """Return True iff `token` is a present, unexpired, valid bearer token.

    Rejects missing, malformed, or expired tokens (Req 3.6, 11.2). A token is a
    mapping with a non-empty string `access_token` and an `expires_at` epoch
    seconds value strictly in the future.
    """
    if not isinstance(token, dict):
        return False
    access = token.get("access_token")
    if not isinstance(access, str) or access == "":
        return False
    expires_at = token.get("expires_at")
    if not isinstance(expires_at, (int, float)):
        return False
    current = time.time() if now is None else now
    return expires_at > current


class OutboundCredentialsError(RuntimeError):
    """Raised when outbound OAuth2 credentials cannot be obtained (Req 11.4)."""


def extract_tool_result(result: Any) -> dict[str, Any]:
    """Normalize a Strands MCPToolResult into a plain dict for the agent.

    Prefers `structuredContent` (the JSON the Athena tool returns), falling back
    to parsing the text content. Application-level tool errors are surfaced as an
    `{"error": ...}` dict without raising.
    """
    if not isinstance(result, dict):
        return {"error": "gateway_returned_no_result"}

    # Gather any text content up front (used for both errors and success).
    text_parts: list[str] = []
    for item in result.get("content") or []:
        if isinstance(item, dict):
            if isinstance(item.get("text"), str):
                text_parts.append(item["text"])
            elif "json" in item and isinstance(item["json"], dict):
                return item["json"]
    joined_text = "\n".join(text_parts).strip()

    if result.get("status") == "error" or result.get("isError"):
        return {"error": f"tool_error: {joined_text or 'unknown tool error'}"}

    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured

    if joined_text:
        try:
            parsed = json.loads(joined_text)
            return parsed if isinstance(parsed, dict) else {"result": parsed}
        except Exception:  # noqa: BLE001 - return raw text if not JSON
            return {"result": joined_text}

    return {"result": None}


class GatewayToolClient:
    """Calls Gateway MCP tools with a cached OAuth2 client-credentials token."""

    def __init__(self, mcp_url: str, token_provider: Callable[[], str]):
        self._mcp_url = mcp_url
        self._token_provider = token_provider

    def call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke an MCP tool. On credential/transport failure, return an error
        dict rather than raising, so the calling agent degrades gracefully."""
        try:
            token = self._token_provider()
        except Exception as exc:  # noqa: BLE001 - degrade, don't crash (Req 11.4)
            return {"error": f"gateway_credentials_unavailable: {exc}"}

        # Deferred imports keep this module importable without the MCP SDK.
        import uuid

        from mcp.client.streamable_http import streamablehttp_client
        from strands.tools.mcp.mcp_client import MCPClient

        client = MCPClient(
            lambda: streamablehttp_client(
                self._mcp_url, headers={"Authorization": f"Bearer {token}"}
            )
        )
        try:
            with client:
                # AgentCore Gateway exposes each Lambda-target tool under a
                # target-prefixed MCP name (e.g. "athena-query___athena_query"),
                # so resolve the actual registered name before invoking.
                resolved_name = _resolve_tool_name(client, tool_name)
                result = client.call_tool_sync(
                    tool_use_id=str(uuid.uuid4()),
                    name=resolved_name,
                    arguments=arguments,
                )
        except Exception as exc:  # noqa: BLE001 - transport/protocol failure
            return {"error": f"gateway_call_failed: {exc}"}

        return extract_tool_result(result)


def _resolve_tool_name(client: Any, requested: str) -> str:
    """Resolve a short tool name to the Gateway's registered MCP tool name.

    AgentCore Gateway prefixes Lambda-target tools with "<targetName>___". We
    match the requested short name against the live tool list, preferring an
    exact match, then a "___<name>" suffix, then any suffix. Falls back to the
    requested name if listing fails.
    """
    try:
        tools = client.list_tools_sync()
    except Exception:  # noqa: BLE001 - fall back to the requested name
        return requested
    names: list[str] = []
    for tool in tools:
        name = getattr(tool, "tool_name", None) or getattr(tool, "name", None)
        if isinstance(name, str):
            names.append(name)
    if requested in names:
        return requested
    for name in names:
        if name.endswith(f"___{requested}"):
            return name
    for name in names:
        if name.endswith(requested):
            return name
    return requested
