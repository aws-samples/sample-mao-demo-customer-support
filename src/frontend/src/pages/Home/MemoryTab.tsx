import React, { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/api";
import Box from "@cloudscape-design/components/box";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";
import { useMemory, STM_RETENTION_DAYS } from "../../common/contexts/MemoryContext";

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

// Inline query (AWSJSON payload) — reads history straight from AgentCore Memory.
const GET_MEMORY_HISTORY = /* GraphQL */ `
  query GetMemoryHistory($limit: Int) {
    getMemoryHistory(limit: $limit)
  }
`;

const client = generateClient();

/**
 * Memory tab — renders conversation history sourced directly from AgentCore
 * short-term Memory (via the getMemoryHistory query → ListSessions/ListEvents),
 * not localStorage. Gated on the STM toggle.
 */
const MemoryTab: React.FC = () => {
    const { memoryEnabled } = useMemory();
    const [sessions, setSessions] = useState<SessionHistory[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = (await client.graphql({
                query: GET_MEMORY_HISTORY,
                variables: { limit: 15 },
            })) as { data?: { getMemoryHistory?: string } };
            const raw = resp.data?.getMemoryHistory;
            const parsed = raw ? JSON.parse(raw) : {};
            if (parsed.error) setError(String(parsed.error));
            setSessions(Array.isArray(parsed.sessions) ? parsed.sessions : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load memory history");
            setSessions([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (memoryEnabled) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memoryEnabled]);

    if (!memoryEnabled) {
        return (
            <Box padding={{ vertical: "xxl" }} textAlign="center">
                <div style={{ opacity: 0.6, filter: "grayscale(1)" }}>
                    <SpaceBetween size="s">
                        <Box variant="h3">Memory is turned off</Box>
                        <Box variant="p" color="text-body-secondary">
                            Conversation history is powered by short-term memory, which is
                            currently disabled. Enable short-term memory in the Capabilities tab to
                            view and keep your conversation history.
                        </Box>
                    </SpaceBetween>
                </div>
            </Box>
        );
    }

    const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString() : "");
    const fmtTime = (ts?: number) =>
        ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

    // The most recent turn's timestamp = when the user last interacted in this
    // session. Prefer it for the header (the session's own createdAt can be
    // hours older since a session is reused across turns).
    const lastActivity = (session: SessionHistory): number | undefined => {
        const times = session.turns
            .map((t) => t.timestamp)
            .filter((t): t is number => typeof t === "number");
        return times.length ? Math.max(...times) : session.createdAt;
    };

    return (
        <Box padding={{ top: "s" }}>
            <SpaceBetween size="l">
                <Alert type="info" header="Powered by AgentCore short-term memory">
                    This history is read directly from the agents' AgentCore short-term memory
                    (ListSessions / ListEvents) for your identity — not from browser storage.
                    Stored turns are retained for up to {STM_RETENTION_DAYS} days and give the
                    agents conversational context; disabling short-term memory hides and stops
                    adding to this history.
                </Alert>

                <Container
                    header={
                        <Header
                            variant="h3"
                            actions={
                                <Button iconName="refresh" onClick={load} loading={loading}>
                                    Refresh
                                </Button>
                            }
                        >
                            Conversation history
                        </Header>
                    }
                >
                    {loading ? (
                        <Box padding="l" textAlign="center">
                            <SpaceBetween size="s">
                                <Spinner size="large" />
                                <Box color="text-body-secondary">Reading short-term memory…</Box>
                            </SpaceBetween>
                        </Box>
                    ) : error ? (
                        <Alert type="error" header="Couldn't load memory history">
                            {error}
                        </Alert>
                    ) : sessions.length === 0 ? (
                        <Box padding="m" textAlign="center" color="text-body-secondary">
                            <SpaceBetween size="xs">
                                <Box variant="h4">No conversations in memory yet</Box>
                                <Box variant="p">
                                    Ask a question in the Chat tab and it will be stored in
                                    short-term memory and appear here.
                                </Box>
                            </SpaceBetween>
                        </Box>
                    ) : (
                        <SpaceBetween size="l">
                            {[...sessions]
                                .sort((a, b) => (lastActivity(b) ?? 0) - (lastActivity(a) ?? 0))
                                .map((session) => (
                                <div
                                    key={session.sessionId}
                                    style={{
                                        padding: "16px",
                                        border: "1px solid #e2e8f0",
                                        borderRadius: "10px",
                                        backgroundColor: "#f8fafc",
                                    }}
                                >
                                    <Box
                                        variant="small"
                                        color="text-body-secondary"
                                        margin={{ bottom: "s" }}
                                    >
                                        Session {session.sessionId.slice(0, 8)}… · last activity{" "}
                                        {fmt(lastActivity(session))}
                                        {session.createdAt ? ` · started ${fmt(session.createdAt)}` : ""}
                                    </Box>
                                    <SpaceBetween size="m">
                                        {session.turns.map((turn, i) => (
                                            <div key={`${session.sessionId}-${i}`}>
                                                <ChatBubble
                                                    ariaLabel={`${
                                                        turn.role === "user" ? "You" : "Assistant"
                                                    }${turn.timestamp ? ` at ${fmt(turn.timestamp)}` : ""}`}
                                                    type={
                                                        turn.role === "user" ? "outgoing" : "incoming"
                                                    }
                                                    avatar={
                                                        turn.role === "user" ? (
                                                            <Avatar ariaLabel="You" />
                                                        ) : (
                                                            <Avatar
                                                                color="gen-ai"
                                                                iconName="gen-ai"
                                                                ariaLabel="Assistant"
                                                            />
                                                        )
                                                    }
                                                >
                                                    {turn.text}
                                                </ChatBubble>
                                                {turn.timestamp && (
                                                    <Box
                                                        variant="small"
                                                        color="text-body-secondary"
                                                        textAlign={
                                                            turn.role === "user" ? "right" : "left"
                                                        }
                                                        margin={{ top: "xxs" }}
                                                    >
                                                        {fmtTime(turn.timestamp)}
                                                    </Box>
                                                )}
                                            </div>
                                        ))}
                                    </SpaceBetween>
                                </div>
                            ))}
                        </SpaceBetween>
                    )}
                </Container>
            </SpaceBetween>
        </Box>
    );
};

export default MemoryTab;
