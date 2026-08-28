import {
    parseStreamLine,
    StreamItem,
} from "../lib/stacks/backend/streaming-api/resolver-function/stream-parser";

/**
 * Simulate the resolver's accumulation loop over a full response stream so the
 * test asserts the user-visible outcome (assistant text + ordered traces), not
 * just single-line parsing.
 */
function accumulate(stream: string): { assistant: string; traces: unknown[] } {
    let assistant = "";
    const traces: unknown[] = [];
    for (const line of stream.split("\n")) {
        const item: StreamItem | null = parseStreamLine(line);
        if (!item) continue;
        if (item.type === "chunk" && typeof item.text === "string") {
            assistant += item.text;
        } else if (item.type === "trace" && item.event !== undefined) {
            traces.push(item.event);
        }
    }
    return { assistant, traces };
}

describe("parseStreamLine", () => {
    it("parses an SSE `data:` framed chunk (the runtime's actual framing)", () => {
        const item = parseStreamLine('data: {"type":"chunk","text":"Hello"}');
        expect(item).toEqual({ type: "chunk", text: "Hello" });
    });

    it("parses raw NDJSON (no `data:` prefix)", () => {
        const item = parseStreamLine('{"type":"chunk","text":"Hi"}');
        expect(item).toEqual({ type: "chunk", text: "Hi" });
    });

    it("parses a trace item", () => {
        const item = parseStreamLine('data: {"type":"trace","event":{"nodeId":"supervisor-agent"}}');
        expect(item).toEqual({ type: "trace", event: { nodeId: "supervisor-agent" } });
    });

    it.each([
        ["", "blank line"],
        ["   ", "whitespace-only line"],
        [": keep-alive", "SSE comment / heartbeat"],
        ["event: message", "SSE event-name line"],
        ["data: [DONE]", "SSE done sentinel"],
        ["data:", "empty data line"],
        ["data: not-json{", "malformed JSON payload"],
    ])("returns null for %s (%s)", (line) => {
        expect(parseStreamLine(line)).toBeNull();
    });

    it("tolerates extra whitespace after the data prefix", () => {
        expect(parseStreamLine('data:    {"type":"chunk","text":"x"}')).toEqual({
            type: "chunk",
            text: "x",
        });
    });
});

describe("resolver stream accumulation", () => {
    it("reconstructs the assistant completion from an SSE stream (regression: the stall)", () => {
        // Exactly how BedrockAgentCoreApp frames generator output: `data: {json}\n\n`.
        const stream =
            'data: {"type":"chunk","text":"Hello! "}\n\n' +
            'data: {"type":"chunk","text":"How can I help?"}\n\n';
        const { assistant } = accumulate(stream);
        expect(assistant).toBe("Hello! How can I help?");
    });

    it("collects ordered trace events and assistant text together", () => {
        const stream =
            'data: {"type":"trace","event":{"seq":1}}\n\n' +
            'data: {"type":"chunk","text":"answer"}\n\n' +
            'data: {"type":"trace","event":{"seq":2}}\n\n';
        const { assistant, traces } = accumulate(stream);
        expect(assistant).toBe("answer");
        expect(traces).toEqual([{ seq: 1 }, { seq: 2 }]);
    });

    it("would have produced an empty completion under the old NDJSON-only parser", () => {
        // Guard: prove the SSE frames are non-trivial (they carry a `data:` prefix
        // that a bare JSON.parse would reject), so this test meaningfully covers
        // the bug that left the UI hanging.
        const line = 'data: {"type":"chunk","text":"x"}';
        expect(() => JSON.parse(line)).toThrow();
        expect(parseStreamLine(line)).toEqual({ type: "chunk", text: "x" });
    });
});
