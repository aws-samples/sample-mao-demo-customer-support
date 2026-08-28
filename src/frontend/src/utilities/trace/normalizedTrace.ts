/**
 * Normalized trace event handling (frontend side of the Trace_Schema).
 *
 * Mirrors the backend `trace_schema.py`: six event types, each with a producing
 * agent id, timestamp, and schema version. These pure helpers are the core of
 * the Trace_Engine adaptation (Req 8) — mapping events to React Flow nodes,
 * labeling event types, and validating conformance — and are property-tested.
 *
 * Requirements: 7.x, 8.2, 8.3, 8.4, 8.5, 8.8, 8.10
 */

import { ALL_NODE_IDS, NodeId } from "../runtimeConfig";

export const TRACE_EVENT_TYPES = [
    "routing_decision",
    "gateway_tool_call",
    "kb_retrieval",
    "memory_read",
    "memory_write",
    "code_interpreter_run",
    "agent_reasoning",
    "guardrail_check",
    "evaluation",
] as const;

// Governance components that participate in the trace stream + workflow diagram
// but are NOT agents. Kept separate from ALL_NODE_IDS so runtime-config
// validation (which requires the five agent nodes) is unaffected.
export const GOVERNANCE_NODE_IDS = ["guardrail-node", "evaluation-node"] as const;

// Node ids the trace flow can attribute events to = the five agents + the two
// governance components.
export const FLOW_NODE_IDS: readonly string[] = [...ALL_NODE_IDS, ...GOVERNANCE_NODE_IDS];

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export interface NormalizedTraceEvent {
    schemaVersion: string;
    eventType: string;
    agentId: string;
    timestamp: number;
    payload: Record<string, unknown>;
}

const EVENT_TYPE_LABELS: Record<TraceEventType, string> = {
    routing_decision: "Routing decision",
    gateway_tool_call: "Tool call (gateway)",
    kb_retrieval: "Knowledge base retrieval",
    memory_read: "Memory read",
    memory_write: "Memory write",
    code_interpreter_run: "Code interpreter run",
    agent_reasoning: "Reasoning",
    guardrail_check: "Guardrail policy check",
    evaluation: "Response evaluation",
};

const FALLBACK_LABEL = "Agent step";

/**
 * Human-readable label for an event type. Total: the six known types map to
 * distinct labels; any other value maps to a generic fallback (Req 8.4, 8.5).
 */
export function eventTypeLabel(eventType: string): string {
    return (EVENT_TYPE_LABELS as Record<string, string>)[eventType] ?? FALLBACK_LABEL;
}

/** Conformance check for a normalized trace event (Req 7.1-7.3, 7.7). */
export function isConformantTraceEvent(value: unknown): value is NormalizedTraceEvent {
    if (!value || typeof value !== "object") return false;
    const e = value as Record<string, unknown>;
    if (!TRACE_EVENT_TYPES.includes(e.eventType as TraceEventType)) return false;
    if (typeof e.agentId !== "string" || e.agentId === "") return false;
    if (typeof e.timestamp !== "number") return false;
    if (typeof e.schemaVersion !== "string" || e.schemaVersion === "") return false;
    if (e.payload !== undefined && (typeof e.payload !== "object" || e.payload === null))
        return false;
    return true;
}

/**
 * Map a trace event to the React Flow node of its producing agent. Returns the
 * node id when the producing agent is one of the five known nodes, otherwise
 * null (a skip result). Never throws (Req 8.2, 8.3).
 */
export function traceEventToNodeId(
    event: Pick<NormalizedTraceEvent, "agentId">,
    knownNodeIds: readonly string[] = FLOW_NODE_IDS
): NodeId | null {
    if (!event || typeof event.agentId !== "string") return null;
    return knownNodeIds.includes(event.agentId) ? (event.agentId as NodeId) : null;
}

/**
 * The specialists selected by the orchestrator in a routing_decision event,
 * including the empty case (Req 8.8).
 */
export function selectedSpecialists(event: NormalizedTraceEvent): string[] {
    if (event.eventType !== "routing_decision") return [];
    const selected = (event.payload as { selectedSpecialists?: unknown })?.selectedSpecialists;
    return Array.isArray(selected) ? selected.map(String) : [];
}

export interface ProcessedTrace {
    /** Conforming events grouped by producing node id, preserving receipt order. */
    groups: Map<string, NormalizedTraceEvent[]>;
    /** Records that were skipped (non-conforming or unmappable), in input order. */
    skipped: unknown[];
}

/**
 * Group a stream of trace records by producing agent node, preserving the order
 * in which events were received within each group (a stable partition). Records
 * that do not conform to the schema or cannot be mapped to a node are skipped
 * and collected, and processing continues (Req 8.6, 8.7, 8.3).
 */
export function processTraceEvents(records: readonly unknown[]): ProcessedTrace {
    const groups = new Map<string, NormalizedTraceEvent[]>();
    const skipped: unknown[] = [];
    for (const record of records) {
        if (!isConformantTraceEvent(record)) {
            skipped.push(record);
            continue;
        }
        const nodeId = traceEventToNodeId(record);
        if (nodeId === null) {
            skipped.push(record);
            continue;
        }
        const bucket = groups.get(nodeId);
        if (bucket) {
            bucket.push(record);
        } else {
            groups.set(nodeId, [record]);
        }
    }
    return { groups, skipped };
}
