/**
 * Bridge: normalized Trace_Events -> existing TraceGroup structures + flow events.
 *
 * This adapts the AgentCore normalized trace stream (Req 7) onto the React Flow
 * rendering the demo already uses, so the migration reuses the trace UI instead
 * of rewriting it. `buildTraceGroups` is pure and property/unit-testable;
 * `dispatchNormalizedTrace` emits the same CustomEvents the flow already listens
 * for (`agentNodeUpdate`, `agentProcessingUpdate`).
 *
 * Requirements: 8.2, 8.4, 8.6, 8.8, 8.10
 */

import { Task, TraceGroup } from "./trace.types";
import {
    eventTypeLabel,
    isConformantTraceEvent,
    NormalizedTraceEvent,
    processTraceEvents,
    selectedSpecialists,
} from "./normalizedTrace";

/** One-line human summary of an event's payload for the trace task content. */
export function summarizeEvent(event: NormalizedTraceEvent): string {
    const p = event.payload ?? {};
    switch (event.eventType) {
        case "routing_decision": {
            const sel = selectedSpecialists(event);
            return `Selected: ${sel.length ? sel.join(", ") : "none"}`;
        }
        case "gateway_tool_call": {
            const name = (p as { toolName?: string }).toolName ?? "tool";
            const err = (p as { error?: string }).error;
            return err ? `Called ${name} — error: ${err}` : `Called ${name}`;
        }
        case "kb_retrieval": {
            const cnt = (p as { passageCount?: number }).passageCount ?? 0;
            const q = (p as { query?: string }).query ?? "";
            return `Retrieved ${cnt} passage(s)${q ? ` for "${q}"` : ""}`;
        }
        case "memory_read":
        case "memory_write": {
            const scope = (p as { scope?: string }).scope ?? "STM";
            const n = (p as { itemCount?: number }).itemCount ?? 0;
            return `${scope} memory · ${n} item(s)`;
        }
        case "code_interpreter_run": {
            const status = (p as { status?: string }).status ?? "ok";
            return `Code execution (${status})`;
        }
        case "agent_reasoning": {
            const text = (p as { text?: string }).text ?? "";
            const firstLine = text.trim().split("\n")[0] ?? "";
            return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "Reasoning";
        }
        case "guardrail_check": {
            const action = (p as { action?: string }).action ?? "checked";
            const policies = (p as { policies?: string[] }).policies ?? [];
            return `${action}${policies.length ? ` · ${policies.join(", ")}` : ""}`;
        }
        case "evaluation": {
            const verdict = (p as { verdict?: string }).verdict ?? "";
            const overall = (p as { scores?: Record<string, number> }).scores?.overall;
            return `${verdict || "evaluated"}${typeof overall === "number" ? ` · score ${overall.toFixed(2)}` : ""}`;
        }
        default:
            return eventTypeLabel(event.eventType);
    }
}

/**
 * Extract Athena result rows (from a gateway_tool_call result payload) into a
 * readable pipe-delimited text table. Tolerates several nesting shapes and
 * returns null when no tabular data can be found.
 */
function formatToolResult(result: unknown): string | null {
    const r = result as Record<string, any> | undefined;
    // The gateway/Athena response can be nested a few different ways.
    const candidates = [
        r?.resultSet?.ResultSet,
        r?.ResultSet,
        r?.resultSet,
        r?.result?.ResultSet,
        r,
    ];
    for (const c of candidates) {
        const rows = (c as any)?.Rows;
        if (Array.isArray(rows) && rows.length > 0) {
            const lines = rows.slice(0, 25).map((row: any) => {
                const cells = Array.isArray(row?.Data)
                    ? row.Data.map((d: any) => (d?.VarCharValue ?? d?.varCharValue ?? "").toString())
                    : [];
                return cells.join(" | ");
            });
            if (rows.length > 25) lines.push(`… (${rows.length - 25} more row(s))`);
            return lines.join("\n");
        }
    }
    return null;
}

/**
 * A rich, human-readable description of an event's payload — the actual
 * reasoning/data behind each step (SQL query + returned rows, KB query +
 * passages, executed code + output). Shown when a trace step is expanded.
 */
export function describeEvent(event: NormalizedTraceEvent): string {
    const p = (event.payload ?? {}) as Record<string, any>;
    switch (event.eventType) {
        case "routing_decision": {
            const sel = selectedSpecialists(event);
            const header = sel.length
                ? `Supervisor selected specialist(s): ${sel.join(", ")}`
                : "Supervisor selected no specialists";
            const query = typeof p.query === "string" ? p.query.trim() : "";
            return query
                ? `${header}\n\nPrompt sent to specialist:\n${query}`
                : header;
        }
        case "gateway_tool_call": {
            const toolName = p.toolName ?? "tool";
            const args = (p.arguments ?? {}) as Record<string, any>;
            const query = args.query;
            const sections: string[] = [`Tool: ${toolName}`];
            if (query) {
                sections.push(`Query:\n${String(query).trim()}`);
            } else if (Object.keys(args).length) {
                sections.push(`Arguments:\n${JSON.stringify(args, null, 2)}`);
            }
            if (p.error) {
                sections.push(`Error:\n${p.error}`);
            } else if (p.result !== undefined) {
                const table = formatToolResult(p.result);
                sections.push(
                    table
                        ? `Result:\n${table}`
                        : `Result:\n${JSON.stringify(p.result, null, 2).slice(0, 2000)}`
                );
            }
            return sections.join("\n\n");
        }
        case "kb_retrieval": {
            const q = p.query ?? "";
            const cnt = p.passageCount ?? 0;
            const kb = p.knowledgeBaseId ?? "";
            const passages = Array.isArray(p.passages) ? (p.passages as Array<Record<string, any>>) : [];
            const lines: string[] = [
                q ? `Query: ${q}` : "",
                `Passages retrieved: ${cnt}`,
                kb ? `Knowledge base: ${kb}` : "",
            ].filter(Boolean);
            passages.forEach((pw, i) => {
                const score = typeof pw.score === "number" ? ` (score ${pw.score.toFixed(3)})` : "";
                const srcRaw = typeof pw.source === "string" ? pw.source : "";
                const src = srcRaw ? ` — ${srcRaw.split("/").pop()}` : "";
                const text = String(pw.text ?? "").trim();
                lines.push("", `Passage ${i + 1}${score}${src}:`, text || "(empty)");
            });
            return lines.join("\n");
        }
        case "memory_read":
        case "memory_write": {
            const scope = p.scope ?? "STM";
            const n = p.itemCount ?? 0;
            const verb = event.eventType === "memory_read" ? "Read" : "Wrote";
            return `${verb} ${n} item(s) from ${scope} memory`;
        }
        case "code_interpreter_run": {
            const status = p.status ?? "ok";
            const code = p.code ?? "";
            const output = p.output ?? "";
            return [
                `Status: ${status}`,
                code ? `Code:\n${code}` : "",
                output ? `Output:\n${output}` : "",
            ]
                .filter(Boolean)
                .join("\n\n");
        }
        case "agent_reasoning": {
            return (p.text ?? "").trim() || "(no reasoning captured)";
        }
        case "guardrail_check": {
            const action = p.action ?? "checked";
            const policies = Array.isArray(p.policies) ? p.policies : [];
            return [
                `Action: ${action}`,
                policies.length ? `Policies checked: ${policies.join(", ")}` : "",
                p.detail ? `Detail: ${p.detail}` : "",
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "evaluation": {
            const scores = (p.scores ?? {}) as Record<string, number>;
            const lines = Object.entries(scores).map(
                ([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(2) : v}`
            );
            return [
                p.verdict ? `Verdict: ${p.verdict}` : "",
                lines.length ? `Scores:\n${lines.join("\n")}` : "",
                p.rationale ? `\n${p.rationale}` : "",
            ]
                .filter(Boolean)
                .join("\n");
        }
        default:
            return Object.keys(p).length ? JSON.stringify(p, null, 2) : summarizeEvent(event);
    }
}

export function traceEventToTask(
    event: NormalizedTraceEvent,
    stepNumber: number,
    durationMs = 0
): Task {
    // Embed the step duration as "(X.XXs)" in the title so the TraceGroup's
    // existing time accounting (which parses that pattern) reports real
    // per-step and accumulated processing time instead of a static 0.00s.
    const secs = (Math.max(0, durationMs) / 1000).toFixed(2);
    return {
        stepNumber,
        // Keep a concise one-line summary on the (collapsed) step header, and the
        // full reasoning/data in the expandable content.
        title: `${eventTypeLabel(event.eventType)} — ${summarizeEvent(event)} (${secs}s)`,
        content: describeEvent(event),
        fullJson: JSON.stringify(event, null, 2),
        timestamp: event.timestamp,
        _agentId: event.agentId,
    };
}

// Friendly display names for the five stable node ids (used as dropdown titles).
const NODE_DISPLAY_NAMES: Record<string, string> = {
    "supervisor-agent": "Supervisor Agent",
    "personalization-agent": "Personalization",
    "order-mgmt-agent": "Order Management",
    "product-rec-agent": "Product Recommendation",
    "ts-agent": "Troubleshooting",
    "guardrail-node": "Guardrail (Policy)",
    "evaluation-node": "Evaluation",
};

function nodeDisplayName(nodeId: string): string {
    return NODE_DISPLAY_NAMES[nodeId] ?? nodeId;
}

/** Build one TraceGroup per producing node from a batch of normalized events. */
export function buildTraceGroups(events: readonly unknown[]): Map<string, TraceGroup> {
    const { groups } = processTraceEvents(events);
    const result = new Map<string, TraceGroup>();
    for (const [nodeId, evs] of groups) {
        // Per-step duration = gap to the next event from the same agent; the
        // final step has no successor so it contributes 0. Summed, these equal
        // the agent's first→last span (its total processing time).
        // Per-step duration: prefer an explicit, backend-measured `durationMs`
        // (real tool/KB/code wall-clock time); otherwise fall back to the gap to
        // this agent's next event (0 for the final event — the old behavior that
        // made single-event agents read 0.00s).
        const durations = evs.map((e, i) => {
            const explicit = (e.payload as { durationMs?: number })?.durationMs;
            if (typeof explicit === "number" && explicit >= 0) return explicit;
            const next = evs[i + 1];
            return next ? Math.max(0, next.timestamp - e.timestamp) : 0;
        });
        // If the backend supplied an authoritative per-agent total (`agentTotalMs`
        // on the reasoning event = the agent's full wall-clock incl. model
        // inference), make the summed step times equal it by assigning the
        // remainder (total − already-measured steps) to that step. This gives an
        // accurate dropdown total without double-counting the measured tool time.
        const totalIdx = evs.findIndex(
            (e) => typeof (e.payload as { agentTotalMs?: number })?.agentTotalMs === "number"
        );
        if (totalIdx >= 0) {
            const total = (evs[totalIdx].payload as { agentTotalMs: number }).agentTotalMs;
            const others = durations.reduce((s, d, i) => (i === totalIdx ? s : s + d), 0);
            durations[totalIdx] = Math.max(0, total - others);
        }
        const tasks = evs.map((e, i) => traceEventToTask(e, i + 1, durations[i]));
        const displayName = nodeDisplayName(nodeId);
        const startTime = evs[0]?.timestamp ?? Date.now();
        const lastUpdateTime = evs[evs.length - 1]?.timestamp ?? Date.now();
        result.set(nodeId, {
            id: `normalized-${nodeId}`,
            type: "trace-group",
            sender: "bot",
            dropdownTitle: `${displayName} (${tasks.length} step${tasks.length === 1 ? "" : "s"})`,
            originalAgentType: displayName,
            startTime,
            lastUpdateTime,
            finalElapsedTime: (Math.max(0, lastUpdateTime - startTime) / 1000).toFixed(2),
            tasks,
            text: "",
            agentId: nodeId,
            isComplete: true,
        });
    }
    return result;
}

/** Parse a Chat.trace payload into normalized events (single object or array). */
export function parseTracePayload(raw: string | null | undefined): NormalizedTraceEvent[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    return candidates.filter(isConformantTraceEvent);
}

interface DispatchTarget {
    dispatchEvent: (event: Event) => boolean;
}

/** Delay between consecutive agent activations when replaying a batch (ms). */
export const NODE_ANIMATION_STAGGER_MS = 650;

// Nodes already animated during the current turn. AppSync coalesces the trace
// stream, so a single update can carry every event at once; without this we
// would re-light every node on each update. Cleared per query via
// `resetFlowAnimationSchedule()`.
let _animatedNodes = new Set<string>();

/** Reset the per-turn animation schedule so the next turn staggers from scratch. */
export function resetFlowAnimationSchedule(): void {
    _animatedNodes = new Set<string>();
}

/**
 * Convert a Chat.trace payload to TraceGroups and drive the flow by dispatching
 * the CustomEvents the React Flow nodes already consume. Newly-seen agents are
 * revealed one at a time in call order (earliest event first), staggered by
 * `NODE_ANIMATION_STAGGER_MS`, so the diagram lights up sequentially as each
 * agent is invoked instead of all at once. Returns the node ids scheduled this
 * call. `target` is injectable for testing.
 */
export function dispatchNormalizedTrace(
    raw: string | null | undefined,
    target: DispatchTarget = document
): string[] {
    const events = parseTracePayload(raw);
    const groups = buildTraceGroups(events);

    // Order nodes by the timestamp of their first event = the order in which
    // the agents were actually called during the turn.
    const ordered = Array.from(groups.entries()).sort(
        (a, b) => (a[1].startTime ?? 0) - (b[1].startTime ?? 0)
    );

    const scheduled: string[] = [];
    let position = 0; // stagger index among the newly-seen nodes this call
    for (const [nodeId, traceGroup] of ordered) {
        if (_animatedNodes.has(nodeId)) continue; // already lit this turn
        _animatedNodes.add(nodeId);
        scheduled.push(nodeId);

        const fire = () => {
            target.dispatchEvent(
                new CustomEvent("agentNodeUpdate", {
                    detail: { nodeId, traceGroup, isProcessing: true, timestamp: Date.now() },
                })
            );
            target.dispatchEvent(
                new CustomEvent("agentProcessingUpdate", {
                    detail: { nodeId, isProcessing: true, processingComplete: false, timestamp: Date.now() },
                })
            );
        };

        const delay = position * NODE_ANIMATION_STAGGER_MS;
        position += 1;
        if (delay === 0) {
            fire();
        } else {
            setTimeout(fire, delay);
        }
    }
    return scheduled;
}
