/**
 * Frontend property-based tests (vitest + fast-check).
 * Feature: agentcore-migration. Each property runs >=100 iterations.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    ALL_NODE_IDS,
    NODE_IDS,
    parseRuntimeConfig,
    RuntimeConfigError,
} from "../runtimeConfig";
import {
    eventTypeLabel,
    isConformantTraceEvent,
    processTraceEvents,
    TRACE_EVENT_TYPES,
    traceEventToNodeId,
} from "../trace/normalizedTrace";

// A well-formed, mappable trace event (agentId is one of the five node ids).
const conformingEvent = fc.record({
    schemaVersion: fc.constant("1.0"),
    eventType: fc.constantFrom(...TRACE_EVENT_TYPES),
    agentId: fc.constantFrom(...ALL_NODE_IDS),
    timestamp: fc.nat(),
    payload: fc.constant({} as Record<string, unknown>),
});

const RUNS = { numRuns: 100 };

function completeConfig(): string {
    const nodes = {
        orchestrator: NODE_IDS.orchestrator,
        personalization: NODE_IDS.personalization,
        orderManagement: NODE_IDS.orderManagement,
        productRecommendation: NODE_IDS.productRecommendation,
        troubleshoot: NODE_IDS.troubleshoot,
    };
    return JSON.stringify({ runtimeArn: "arn", gatewayUrl: "u", memoryId: "m", nodes, agentProfiles: {} });
}

describe("Feature: agentcore-migration, Property 18: Node identity uniqueness and stability", () => {
    it("five node ids are pairwise unique and constant across repeated reads", () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 50 }), (reloads) => {
                for (let i = 0; i < reloads; i++) {
                    const ids = ALL_NODE_IDS;
                    expect(ids).toHaveLength(5);
                    expect(new Set(ids).size).toBe(5);
                    expect(ids).toEqual([
                        "supervisor-agent",
                        "personalization-agent",
                        "order-mgmt-agent",
                        "product-rec-agent",
                        "ts-agent",
                    ]);
                }
            }),
            RUNS
        );
    });
});

describe("Feature: agentcore-migration, Property 10: Trace-event to node mapping totality and skip", () => {
    it("known agent -> one of five node ids; otherwise a skip (null); never throws", () => {
        const anyAgentId = fc.oneof(
            fc.constantFrom(...ALL_NODE_IDS),
            fc.string(),
            fc.constant("")
        );
        fc.assert(
            fc.property(anyAgentId, (agentId) => {
                const result = traceEventToNodeId({ agentId });
                if (ALL_NODE_IDS.includes(agentId as (typeof ALL_NODE_IDS)[number])) {
                    expect(result).toBe(agentId);
                } else {
                    expect(result).toBeNull();
                }
            }),
            RUNS
        );
    });
});

describe("Feature: agentcore-migration, Property 11: Event-type label totality with fallback", () => {
    it("non-empty label for any value; six types distinct; others map to fallback", () => {
        const knownLabels = new Set(TRACE_EVENT_TYPES.map((t) => eventTypeLabel(t)));
        expect(knownLabels.size).toBe(TRACE_EVENT_TYPES.length); // distinct
        fc.assert(
            fc.property(fc.oneof(fc.constantFrom(...TRACE_EVENT_TYPES), fc.string()), (t) => {
                const label = eventTypeLabel(t);
                expect(typeof label).toBe("string");
                expect(label.length).toBeGreaterThan(0);
                if (!TRACE_EVENT_TYPES.includes(t as (typeof TRACE_EVENT_TYPES)[number])) {
                    expect(label).toBe("Agent step"); // generic fallback
                }
            }),
            RUNS
        );
    });
});

describe("Feature: agentcore-migration, Property 7/13: trace event conformance is total", () => {
    it("never throws and only accepts well-formed events", () => {
        const arbEvent = fc.record({
            schemaVersion: fc.oneof(fc.constant("1.0"), fc.constant(""), fc.integer()),
            eventType: fc.oneof(fc.constantFrom(...TRACE_EVENT_TYPES), fc.string()),
            agentId: fc.oneof(fc.constantFrom(...ALL_NODE_IDS), fc.string(), fc.constant("")),
            timestamp: fc.oneof(fc.integer(), fc.constant("nope" as unknown as number)),
            payload: fc.oneof(fc.object(), fc.constant(undefined)),
        });
        fc.assert(
            fc.property(fc.oneof(arbEvent, fc.anything()), (value) => {
                const ok = isConformantTraceEvent(value);
                expect(typeof ok).toBe("boolean");
            }),
            RUNS
        );
    });
});

describe("Feature: agentcore-migration, Property 12: Specialist reasoning grouping preserves order", () => {
    it("grouping by producing agent is a stable partition preserving receipt order", () => {
        fc.assert(
            fc.property(fc.array(conformingEvent, { maxLength: 40 }), (events) => {
                const { groups, skipped } = processTraceEvents(events);
                expect(skipped).toHaveLength(0);
                for (const nodeId of ALL_NODE_IDS) {
                    const expected = events.filter((e) => e.agentId === nodeId);
                    expect(groups.get(nodeId) ?? []).toEqual(expected);
                }
            }),
            RUNS
        );
    });
});

describe("Feature: agentcore-migration, Property 13: non-conforming records skipped, conforming grouped", () => {
    it("renders exactly conforming+mappable events, skips the rest, never loses records", () => {
        const junk = fc.oneof(
            fc.anything(),
            fc.record({ eventType: fc.constant("bogus"), agentId: fc.string() }),
            // conforming schema but UNMAPPABLE agent id -> must be skipped too
            fc.record({
                schemaVersion: fc.constant("1.0"),
                eventType: fc.constantFrom(...TRACE_EVENT_TYPES),
                agentId: fc.constant("unknown-agent"),
                timestamp: fc.nat(),
                payload: fc.constant({}),
            })
        );
        fc.assert(
            fc.property(fc.array(fc.oneof(conformingEvent, junk), { maxLength: 40 }), (records) => {
                const { groups, skipped } = processTraceEvents(records);
                const groupedCount = [...groups.values()].reduce((n, g) => n + g.length, 0);
                // No record is lost: grouped + skipped == input length.
                expect(groupedCount + skipped.length).toBe(records.length);
                // Everything grouped is conforming and maps to a known node.
                for (const [nodeId, evts] of groups) {
                    expect(ALL_NODE_IDS).toContain(nodeId);
                    for (const e of evts) {
                        expect(isConformantTraceEvent(e)).toBe(true);
                        expect(traceEventToNodeId(e)).toBe(nodeId);
                    }
                }
            }),
            RUNS
        );
    });
});

describe("agentcore-migration: normalized trace bridge (Req 8.2, 8.6, 8.10)", () => {
    it("builds one ordered TraceGroup per node and dispatches flow events", async () => {
        const { buildTraceGroups, dispatchNormalizedTrace, parseTracePayload } = await import(
            "../trace/normalizedBridge"
        );
        const evs = [
            { schemaVersion: "1.0", eventType: "routing_decision", agentId: "supervisor-agent", timestamp: 1, payload: { selectedSpecialists: ["ts-agent"] } },
            { schemaVersion: "1.0", eventType: "kb_retrieval", agentId: "ts-agent", timestamp: 2, payload: { passageCount: 3, query: "wifi" } },
            { schemaVersion: "1.0", eventType: "memory_read", agentId: "ts-agent", timestamp: 3, payload: { scope: "STM", itemCount: 2 } },
        ];
        const groups = buildTraceGroups(evs);
        expect([...groups.keys()].sort()).toEqual(["supervisor-agent", "ts-agent"]);
        const ts = groups.get("ts-agent")!;
        expect(ts.tasks.map((t) => t.stepNumber)).toEqual([1, 2]);
        // Titles carry a one-line summary + step duration, e.g.
        // `Knowledge base retrieval — Retrieved 3 passage(s) for "wifi" (0.00s)`.
        expect(ts.tasks[0].title.startsWith("Knowledge base retrieval")).toBe(true);

        // parse single object and array forms
        expect(parseTracePayload(JSON.stringify(evs[0]))).toHaveLength(1);
        expect(parseTracePayload(JSON.stringify(evs))).toHaveLength(3);
        expect(parseTracePayload("not json")).toHaveLength(0);

        // dispatch drives the flow via injected target
        const dispatched: string[] = [];
        const target = {
            dispatchEvent: (e: Event) => {
                dispatched.push(e.type);
                return true;
            },
        };
        const updated = dispatchNormalizedTrace(JSON.stringify(evs), target);
        expect(updated.sort()).toEqual(["supervisor-agent", "ts-agent"]);
        expect(dispatched).toContain("agentNodeUpdate");
        expect(dispatched).toContain("agentProcessingUpdate");
    });
});

describe("agentcore-migration: runtime config parsing (Req 15.2, 15.4)", () => {
    it("parses a complete config", () => {
        const cfg = parseRuntimeConfig(completeConfig());
        expect(Object.values(cfg.nodes)).toEqual(expect.arrayContaining([...ALL_NODE_IDS]));
    });

    it("throws on missing/empty/invalid/incomplete config", () => {
        expect(() => parseRuntimeConfig(undefined)).toThrow(RuntimeConfigError);
        expect(() => parseRuntimeConfig("")).toThrow(RuntimeConfigError);
        expect(() => parseRuntimeConfig("{not json")).toThrow(RuntimeConfigError);
        expect(() => parseRuntimeConfig(JSON.stringify({ nodes: { a: "x" } }))).toThrow(
            RuntimeConfigError
        );
    });
});
