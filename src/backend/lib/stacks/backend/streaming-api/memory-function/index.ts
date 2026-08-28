import {
    BedrockAgentCoreClient,
    ListSessionsCommand,
    ListEventsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";

/**
 * getMemoryHistory resolver — reads the caller's conversation history directly
 * from AgentCore short-term Memory (NOT localStorage/DynamoDB). It lists the
 * actor's recent sessions and their conversational events for this memory
 * resource. actorId is the caller's Cognito identity (the same value the chat
 * resolver writes STM under), so a user only ever sees their own history.
 */
interface Args {
    limit?: number;
}

interface Turn {
    role: "user" | "assistant" | "other";
    text: string;
    timestamp?: number;
}
interface SessionHistory {
    sessionId: string;
    createdAt?: number;
    turns: Turn[];
}

const REGION = process.env.AWS_REGION!;
const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID ?? "";
const client = new BedrockAgentCoreClient({ region: REGION });

const normalizeRole = (role?: string): Turn["role"] => {
    const r = (role ?? "").toLowerCase();
    if (r === "user") return "user";
    if (r === "assistant") return "assistant";
    return "other";
};

const stripThinking = (s: string) =>
    s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

// Extract conversational turns from an event's payload array.
// Payload items look like { conversational: { role, content: { text } } }, but
// the Strands session manager stores the FULL message envelope as that text,
// e.g. '{"message":{"role":"user","content":[{"text":"..."} | {"toolUse":...}]}}'.
// We unwrap it to the human-readable text and skip tool-only (no-text) messages.
const extractTurns = (event: any): Turn[] => {
    const turns: Turn[] = [];
    const payload = Array.isArray(event?.payload) ? event.payload : [];
    const ts =
        typeof event?.eventTimestamp === "number"
            ? event.eventTimestamp
            : event?.eventTimestamp
              ? new Date(event.eventTimestamp).getTime()
              : undefined;

    for (const item of payload) {
        const conv = item?.conversational;
        if (!conv) continue;
        const raw =
            typeof conv?.content?.text === "string"
                ? conv.content.text
                : typeof conv?.content === "string"
                  ? conv.content
                  : "";
        if (!raw) continue;

        let role = normalizeRole(conv.role);
        let text = raw;
        try {
            const parsed = JSON.parse(raw);
            const msg = parsed?.message ?? parsed;
            if (msg && Array.isArray(msg.content)) {
                role = normalizeRole(msg.role ?? conv.role);
                // Only keep text content blocks; drop toolUse/toolResult blocks.
                const texts = msg.content
                    .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
                    .filter(Boolean);
                if (texts.length === 0) continue; // tool-only message, not user-facing
                text = texts.join("\n");
            }
        } catch {
            /* plain text, not an envelope — use as-is */
        }

        text = stripThinking(text);
        if (!text.trim()) continue;
        turns.push({ role, text, timestamp: ts });
    }
    return turns;
};

export const handler = async (event: AppSyncResolverEvent<Args>) => {
    const identity = event.identity as AppSyncIdentityCognito | undefined;
    const actorId = identity?.username;
    const limit = Math.min(Math.max(event.arguments?.limit ?? 10, 1), 25);

    // Return plain objects: the field is AWSJSON, so AppSync serializes the
    // object to a JSON string once. (Returning a pre-stringified string would
    // double-encode it.)
    if (!actorId) return { sessions: [], error: "unauthenticated" };
    if (!MEMORY_ID) return { sessions: [], error: "memory not configured" };

    try {
        const sessionsResp = await client.send(
            new ListSessionsCommand({ memoryId: MEMORY_ID, actorId, maxResults: limit })
        );
        const summaries = (sessionsResp.sessionSummaries ?? []) as any[];

        const sessions: SessionHistory[] = [];
        for (const s of summaries) {
            const sessionId = s.sessionId as string;
            if (!sessionId) continue;
            const eventsResp = await client.send(
                new ListEventsCommand({
                    memoryId: MEMORY_ID,
                    actorId,
                    sessionId,
                    includePayloads: true,
                    maxResults: 100,
                })
            );
            const events = (eventsResp.events ?? []) as any[];
            events.sort(
                (a, b) => Number(a?.eventTimestamp ?? 0) - Number(b?.eventTimestamp ?? 0)
            );
            const turns = events.flatMap(extractTurns).filter((t) => t.role !== "other");
            if (turns.length === 0) continue;
            const createdAt =
                typeof s.createdAt === "number"
                    ? s.createdAt
                    : s.createdAt
                      ? new Date(s.createdAt).getTime()
                      : turns[0]?.timestamp;
            sessions.push({ sessionId, createdAt, turns });
        }

        // Most recent session first.
        sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        console.log(
            `getMemoryHistory: actor=${actorId} sessionsFound=${summaries.length} withTurns=${sessions.length}`
        );
        return { sessions, source: "agentcore-memory", actorId };
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        console.error("getMemoryHistory failed:", message);
        return { sessions: [], error: message, actorId };
    }
};
