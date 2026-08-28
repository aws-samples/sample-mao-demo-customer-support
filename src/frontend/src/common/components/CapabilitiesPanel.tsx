/**
 * Capabilities panel — surfaces which AgentCore primitives are active, lets the
 * user click any agent for details, hosts the short-term Memory toggle +
 * identity indicator, and lists every agent in the workflow with its model,
 * tools, knowledge bases, memory, and instructions.
 *
 * Requirements: 6.2, 6.6, 10.7, 11.5, 11.6, 12.1-12.6, 16.x
 */
import React, { useState } from "react";
import Toggle from "@cloudscape-design/components/toggle";
import {
    FiServer,
    FiShare2,
    FiHardDrive,
    FiBookOpen,
    FiCode,
    FiActivity,
    FiGlobe,
    FiShield,
    FiCheckCircle,
} from "react-icons/fi";
import { getRuntimeConfig, NODE_IDS, AgentProfile } from "../../utilities/runtimeConfig";
import "./CapabilitiesPanel.css";

export type CapabilityStatus = "active" | "inactive" | "indeterminate";

export interface CapabilitiesState {
    runtime: CapabilityStatus;
    gateway: CapabilityStatus;
    memory: CapabilityStatus;
    s3VectorsKb: CapabilityStatus;
    codeInterpreter: CapabilityStatus;
    observability: CapabilityStatus;
    guardrail?: CapabilityStatus;
    evaluation?: CapabilityStatus;
    browser?: CapabilityStatus;
}

export interface CapabilitiesPanelProps {
    capabilities: CapabilitiesState;
    memoryEnabled: boolean;
    onMemoryToggle: (enabled: boolean) => void;
    ltmActive?: boolean;
    actorId?: string | null;
    memoryUnavailable?: boolean;
}

type CapabilityKey = keyof CapabilitiesState;

// Project-specific explanation + icon for each AgentCore capability.
const CAPABILITY_INFO: Record<
    CapabilityKey,
    { label: string; detail: string; icon: React.ReactNode }
> = {
    runtime: {
        label: "Runtime",
        icon: <FiServer />,
        detail:
            "AgentCore Runtime hosts the Strands multi-agent app (a Supervisor orchestrator plus four specialists) in a single ARM64 container. It authorizes each request with the caller's Cognito token, then streams the response and trace events back to the chat.",
    },
    gateway: {
        label: "Gateway (MCP)",
        icon: <FiShare2 />,
        detail:
            "AgentCore Gateway exposes two Lambda-backed MCP tools — athena_query (read-only SQL over orders, inventory, product catalog, purchase history, customer profiles) and kb_retrieve (semantic search over the S3 Vectors knowledge bases) — secured with Cognito OAuth2 machine-to-machine auth. Specialists call them through the Gateway.",
    },
    memory: {
        label: "Memory",
        icon: <FiHardDrive />,
        detail:
            "AgentCore Memory provides short-term (per-session) conversation memory, plus long-term user-preference and semantic strategies used by the Personalization agent for cross-session recall. Short-term memory is on by default and can be toggled per conversation below.",
    },
    s3VectorsKb: {
        label: "Knowledge Base (S3 Vectors)",
        icon: <FiBookOpen />,
        detail:
            "Three Amazon S3 Vectors knowledge bases (personalization, product, troubleshooting) back semantic search over unstructured content — customer feedback, product reviews, FAQs, and troubleshooting guides. Agents retrieve passages via the kb_retrieve tool exposed through the AgentCore Gateway.",
    },
    codeInterpreter: {
        label: "Code Interpreter",
        icon: <FiCode />,
        detail:
            "The AgentCore Code Interpreter sandbox lets the Product Recommendation and Order Management agents run short Python snippets (calculations, filtering, data shaping) with a 30-second execution bound, without affecting the rest of the conversation.",
    },
    observability: {
        label: "Observability",
        icon: <FiActivity />,
        detail:
            "X-Ray tracing with CloudWatch Transaction Search captures each agent step. The normalized trace stream (routing decisions, tool calls, KB retrievals, code runs) powers the Agent Traces view and the animated workflow diagram.",
    },
    guardrail: {
        label: "Guardrail (Policy)",
        icon: <FiShield />,
        detail:
            "A content-policy guardrail screens every turn — content safety (denied topics), PII detection, and prompt-attack checks — before the response is returned. The outcome (passed / redacted / blocked) is emitted to the trace stream and shown as the Guardrail node in the workflow diagram.",
    },
    evaluation: {
        label: "Evaluation",
        icon: <FiCheckCircle />,
        detail:
            "Each final response is automatically scored for relevance, completeness, and safety, producing an overall quality verdict (pass / review). Scores are emitted to the trace stream and surfaced as the Evaluation node in the workflow diagram — an inline quality gate for agent output.",
    },
    browser: {
        label: "Browser (preview)",
        icon: <FiGlobe />,
        detail:
            "The AgentCore Browser built-in tool (stretch feature) lets an agent fetch live web content. It is disabled by default and only appears when explicitly enabled.",
    },
};

const CAPABILITY_ORDER: CapabilityKey[] = [
    "runtime",
    "gateway",
    "memory",
    "s3VectorsKb",
    "codeInterpreter",
    "observability",
    "guardrail",
    "evaluation",
    "browser",
];

const AGENT_ORDER: string[] = [
    NODE_IDS.orchestrator,
    NODE_IDS.personalization,
    NODE_IDS.orderManagement,
    NODE_IDS.productRecommendation,
    NODE_IDS.troubleshoot,
];

// Accent color per agent node — matches the workflow diagram palette.
const AGENT_ACCENT: Record<string, string> = {
    [NODE_IDS.orchestrator]: "#7c3aed",
    [NODE_IDS.personalization]: "#db2777",
    [NODE_IDS.orderManagement]: "#2563eb",
    [NODE_IDS.productRecommendation]: "#0891b2",
    [NODE_IDS.troubleshoot]: "#f59e0b",
};

function statusText(status: CapabilityStatus): string {
    return status === "active" ? "Active" : status === "inactive" ? "Inactive" : "Unknown";
}

function shortenModelId(modelId: string): string {
    const withoutRegion = modelId.replace(/^[a-z]{2}\./, "");
    const parts = withoutRegion.split(".");
    const name = parts[parts.length - 1] || withoutRegion;
    // Strip the inference-profile version ("-v1:0") and any trailing 8-digit
    // date stamp ("-20251001") so e.g. "claude-haiku-4-5-20251001-v1:0" reads as
    // "claude-haiku-4-5", matching the other agent badges.
    return name.replace(/-v\d+:\d+$/, "").replace(/-\d{8}$/, "");
}

const StatusPill: React.FC<{ status: CapabilityStatus }> = ({ status }) => (
    <span className={`cap-pill cap-pill--${status}`}>
        <span className="cap-pill__dot" aria-hidden />
        {statusText(status)}
    </span>
);

const ToolChips: React.FC<{ items: string[] }> = ({ items }) =>
    items.length ? (
        <span>
            {items.map((t) => (
                <span key={t} className="cap-chip">
                    {t}
                </span>
            ))}
        </span>
    ) : (
        <span className="cap-chip cap-chip--muted">none</span>
    );

const AgentCard: React.FC<{ profile: AgentProfile; open: boolean; onToggle: () => void }> = ({
    profile,
    open,
    onToggle,
}) => {
    const accent = AGENT_ACCENT[profile.nodeId] ?? "#4f46e5";
    const initial = (profile.displayName || "?").trim().charAt(0).toUpperCase();
    return (
        <div className="cap-agent" style={{ ["--accent" as string]: accent }}>
            <div className="cap-agent__bar" />
            <button
                type="button"
                className="cap-agent__btn"
                aria-expanded={open}
                onClick={onToggle}
            >
                <span className="cap-agent__avatar" aria-hidden>
                    {initial}
                </span>
                <span className="cap-agent__meta">
                    <span className="cap-agent__name">{profile.displayName}</span>
                    <br />
                    <span className="cap-agent__model">{shortenModelId(profile.modelId)}</span>
                </span>
                <span className={`cap-agent__chev${open ? " is-open" : ""}`} aria-hidden>
                    ▶
                </span>
            </button>
            {open && (
                <div className="cap-agent__body">
                    <div className="cap-kv">
                        <span className="cap-kv__k">Model</span>
                        <span className="cap-kv__v">{profile.modelId}</span>
                    </div>
                    <div className="cap-kv">
                        <span className="cap-kv__k">Tools</span>
                        <span className="cap-kv__v">
                            <ToolChips items={profile.tools} />
                        </span>
                    </div>
                    <div className="cap-kv">
                        <span className="cap-kv__k">Knowledge bases</span>
                        <span className="cap-kv__v">
                            <ToolChips items={profile.knowledgeBases} />
                        </span>
                    </div>
                    <div className="cap-kv">
                        <span className="cap-kv__k">Memory</span>
                        <span className="cap-kv__v">
                            STM {profile.memory.stm ? "on" : "off"} · LTM{" "}
                            {profile.memory.ltm ? "on" : "off"}
                        </span>
                    </div>
                    <div className="cap-kv" style={{ display: "block" }}>
                        <span className="cap-kv__k">Instructions</span>
                        <div className="cap-prompt">
                            {profile.systemPrompt || "(instructions unavailable)"}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const CapabilitiesPanel: React.FC<CapabilitiesPanelProps> = ({
    capabilities,
    memoryEnabled,
    onMemoryToggle,
    ltmActive,
    actorId,
    memoryUnavailable,
}) => {
    const [openAgent, setOpenAgent] = useState<string | null>(null);

    const [profiles] = useState<AgentProfile[]>(() => {
        try {
            const cfg = getRuntimeConfig();
            return AGENT_ORDER.map((id) => cfg.agentProfiles[id]).filter(
                (p): p is AgentProfile => !!p
            );
        } catch {
            return [];
        }
    });

    return (
        <div className="cap-panel">
            <div className="cap-head">
                <div>
                    <h2 className="cap-head__title">Capabilities</h2>
                    <p className="cap-head__sub">AWS Bedrock AgentCore primitives in use</p>
                </div>
                {actorId ? (
                    <span className="cap-identity cap-identity--ok">
                        <span className="cap-identity__dot" aria-hidden />
                        Secured · acting as {actorId}
                    </span>
                ) : (
                    <span className="cap-identity cap-identity--off">
                        <span className="cap-identity__dot" aria-hidden />
                        Identity unresolved
                    </span>
                )}
            </div>

            <div className="cap-grid">
                {CAPABILITY_ORDER.map((capKey) => {
                    const status = capabilities[capKey];
                    if (status === undefined) return null;
                    const info = CAPABILITY_INFO[capKey];
                    return (
                        <div className="cap-card" key={capKey}>
                            <div className="cap-card__top">
                                <span className="cap-card__icon" aria-hidden>
                                    {info.icon}
                                </span>
                                <span className="cap-card__name">{info.label}</span>
                                <StatusPill status={status} />
                            </div>
                            <p className="cap-card__detail">{info.detail}</p>
                            {capKey === "memory" && (
                                <div className="cap-card__memory">
                                    <Toggle
                                        checked={memoryEnabled}
                                        onChange={({ detail }) => onMemoryToggle(detail.checked)}
                                    >
                                        Short-term memory {memoryEnabled ? "on" : "off"}
                                    </Toggle>
                                    {memoryUnavailable && (
                                        <div className="cap-card__note cap-card__note--warn">
                                            Memory temporarily unavailable — responding without
                                            prior context.
                                        </div>
                                    )}
                                    {ltmActive !== undefined && (
                                        <div className="cap-card__note">
                                            Long-term memory (Personalization):{" "}
                                            {ltmActive ? "active" : "inactive"}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {profiles.length > 0 && (
                <>
                    <div className="cap-section-label">Agents in this workflow</div>
                    <div className="cap-agent-grid">
                        {profiles.map((p) => (
                            <AgentCard
                                key={p.nodeId}
                                profile={p}
                                open={openAgent === p.nodeId}
                                onToggle={() =>
                                    setOpenAgent((prev) => (prev === p.nodeId ? null : p.nodeId))
                                }
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default CapabilitiesPanel;
