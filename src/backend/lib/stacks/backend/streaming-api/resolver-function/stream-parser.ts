/**
 * Parser for the AgentCore Runtime response stream.
 *
 * The runtime (BedrockAgentCoreApp) frames generator output as Server-Sent
 * Events (`data: {json}`), while other paths may emit raw NDJSON (`{json}`).
 * This module normalizes both framings so the resolver can accumulate the
 * assistant completion and the ordered trace stream regardless of transport.
 *
 * Kept dependency-free so it can be unit-tested in isolation.
 */

export interface StreamItem {
    type?: string;
    text?: string;
    event?: unknown;
}

/**
 * Parse one line from the runtime response stream into a stream item.
 *
 * Strips an optional `data:` (SSE) prefix, skips SSE control lines (comments
 * starting with `:`, and `event:` lines) plus the `[DONE]` sentinel, and returns
 * the parsed item — or null when the line carries no JSON payload (so streaming
 * continues uninterrupted).
 */
export function parseStreamLine(line: string): StreamItem | null {
    let trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith(":")) return null; // SSE comment / heartbeat
    if (trimmed.startsWith("event:")) return null; // SSE event-name line
    if (trimmed.startsWith("data:")) {
        trimmed = trimmed.slice("data:".length).trim();
    }
    if (!trimmed || trimmed === "[DONE]") return null;
    try {
        return JSON.parse(trimmed) as StreamItem;
    } catch {
        return null; // non-conforming line — keep streaming (Req 8.7 analog)
    }
}
