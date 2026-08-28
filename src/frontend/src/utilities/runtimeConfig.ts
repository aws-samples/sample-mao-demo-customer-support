/**
 * Runtime configuration (replaces the per-agent VITE_*_AGENT_ID model).
 *
 * The backend injects `VITE_RUNTIME_CONFIG` at build time — a JSON blob with the
 * AgentCore runtime/gateway/memory identifiers, the five stable topology node IDs,
 * and one AgentProfile per agent. The frontend resolves all agent identity from
 * this config and never falls back to legacy `VITE_*_AGENT_ID`/`ALIAS_ID` values
 * (Req 15.1). Missing/incomplete config halts initialization (Req 15.4).
 *
 * Requirements: 2.8, 15.1, 15.2, 15.4, 16.1
 */

// The five stable node IDs (must match the backend config.py + CDK construct).
export const NODE_IDS = {
    orchestrator: "supervisor-agent",
    personalization: "personalization-agent",
    orderManagement: "order-mgmt-agent",
    productRecommendation: "product-rec-agent",
    troubleshoot: "ts-agent",
} as const;

export type NodeId = (typeof NODE_IDS)[keyof typeof NODE_IDS];

export const ALL_NODE_IDS: NodeId[] = Object.values(NODE_IDS);

// Human-facing agent types (retained for trace styling / labels).
export const AGENT_TYPES = {
    SUPERVISOR: "Supervisor",
    PERSONALIZATION: "Personalization",
    ORDER_MANAGEMENT: "OrderManagement",
    PRODUCT_RECOMMENDATION: "ProductRecommendation",
    TROUBLESHOOT: "Troubleshoot",
} as const;

export interface AgentProfile {
    nodeId: string;
    displayName: string;
    modelId: string;
    systemPrompt: string;
    tools: string[];
    knowledgeBases: string[];
    memory: { stm: boolean; ltm: boolean };
}

export interface RuntimeConfig {
    runtimeArn: string;
    gatewayUrl: string;
    memoryId: string;
    nodes: Record<string, string>;
    agentProfiles: Record<string, AgentProfile>;
}

export class RuntimeConfigError extends Error {}

/**
 * Pure parser for the runtime config JSON. Throws RuntimeConfigError when the
 * config is absent, unparseable, or missing any of the five topology node
 * identity entries (Req 15.4). Kept pure for property testing.
 */
export function parseRuntimeConfig(raw: string | undefined | null): RuntimeConfig {
    if (!raw || raw.trim() === "") {
        throw new RuntimeConfigError("VITE_RUNTIME_CONFIG is missing or empty");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new RuntimeConfigError(`VITE_RUNTIME_CONFIG is not valid JSON: ${String(e)}`);
    }
    const cfg = parsed as Partial<RuntimeConfig>;
    if (!cfg || typeof cfg !== "object" || !cfg.nodes || typeof cfg.nodes !== "object") {
        throw new RuntimeConfigError("VITE_RUNTIME_CONFIG is missing the `nodes` map");
    }
    // All five topology nodes must be present and non-empty (Req 15.2, 15.4).
    for (const nodeId of ALL_NODE_IDS) {
        const present = Object.values(cfg.nodes).includes(nodeId);
        if (!present) {
            throw new RuntimeConfigError(
                `VITE_RUNTIME_CONFIG is incomplete: missing node identity "${nodeId}"`
            );
        }
    }
    return {
        runtimeArn: cfg.runtimeArn ?? "",
        gatewayUrl: cfg.gatewayUrl ?? "",
        memoryId: cfg.memoryId ?? "",
        nodes: cfg.nodes as Record<string, string>,
        agentProfiles: (cfg.agentProfiles ?? {}) as Record<string, AgentProfile>,
    };
}

// --- Vite build-time singleton ---------------------------------------------

let _config: RuntimeConfig | null = null;

/**
 * Resolve the runtime config from the Vite build-time env. Halts (throws) on
 * missing/incomplete config with no legacy fallback (Req 15.1, 15.4).
 */
export function getRuntimeConfig(): RuntimeConfig {
    if (_config) return _config;
    const raw = import.meta.env.VITE_RUNTIME_CONFIG as string | undefined;
    _config = parseRuntimeConfig(raw);
    return _config;
}

/** The foundation model backing a given node (for per-agent UI display, Req 2.8). */
export function getModelForNode(nodeId: string, config?: RuntimeConfig): string | undefined {
    const cfg = config ?? getRuntimeConfig();
    return cfg.agentProfiles[nodeId]?.modelId;
}

/** The full AgentProfile for a node (transparency view, Req 16). */
export function getAgentProfile(nodeId: string, config?: RuntimeConfig): AgentProfile | undefined {
    const cfg = config ?? getRuntimeConfig();
    return cfg.agentProfiles[nodeId];
}

/**
 * Map a free-text agent/collaborator name to its agent type (retained pattern
 * matching so trace styling keeps working with the new event stream).
 */
export function getAgentTypeFromName(name?: string): string | undefined {
    if (!name) return undefined;
    const n = name.toLowerCase();
    if (n.includes("supervisor") || n.includes("orchestrat") || n.includes("main"))
        return AGENT_TYPES.SUPERVISOR;
    if (n.includes("personal") || n.includes("preference")) return AGENT_TYPES.PERSONALIZATION;
    if (n.includes("order") || n.includes("shipping")) return AGENT_TYPES.ORDER_MANAGEMENT;
    if (n.includes("product") || n.includes("recommend"))
        return AGENT_TYPES.PRODUCT_RECOMMENDATION;
    if (n.includes("trouble") || n.includes("issue") || n.includes("support"))
        return AGENT_TYPES.TROUBLESHOOT;
    return undefined;
}
