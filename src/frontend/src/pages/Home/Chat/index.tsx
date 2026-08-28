import React, { useContext, useEffect, useRef, useState, useMemo } from "react";

import Avatar from "@cloudscape-design/chat-components/avatar";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import { Spinner, StatusIndicator, Table, Cards, Badge, TextContent, Tabs } from "@cloudscape-design/components";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import PromptInput from "@cloudscape-design/components/prompt-input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import { generateClient } from "aws-amplify/api";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { v4 as uuidv4 } from "uuid";
import { FlashbarContext } from "../../../common/contexts/Flashbar";
import { onUpdateChat } from "../../../common/graphql/subscriptions";
import { sendMessage } from "./api";
import { AgentFlowPanel } from '../../../common/components/react_flow/AgentFlowPanel';
import SampleQuestions from "./SampleQuestions";
import HowToUseDemo from "./HowToUseDemo";
import { DemoDisclaimer } from "../../../common/components/DemoDisclaimer";
import InitialWorkflowImage from "./InitialWorkflowImage";
import DataTabs from "../Data";
import { parseTraceData, registerMessageHandler, unregisterMessageHandler, generateConnectionId } from '../../../utilities/multiWebsocket';
// Import from compatibility layer instead of old files (same API, new implementation)
import { 
  TraceGroup as TraceGroupType, 
  TraceState,
  storeAgentTrace, 
  clearAllAgentTraces,
  getTraceGroupStartTime
} from '../../../utilities/trace/compatibility';
import TraceGroup from '../../../common/components/react_flow/TraceGroup';
import { dispatchNormalizedTrace, buildTraceGroups, parseTracePayload, resetFlowAnimationSchedule } from '../../../utilities/trace/normalizedBridge';
import CapabilitiesPanel, { CapabilitiesState } from '../../../common/components/CapabilitiesPanel';
import { getRuntimeConfig } from '../../../utilities/runtimeConfig';
import { useMemory } from '../../../common/contexts/MemoryContext';

// Deterministic JSON with recursively-sorted object keys. Used to build a
// key-order-independent signature of a trace event's payload so the same event
// delivered via different fields (or after an AWSJSON round-trip that re-orders
// keys) produces one identity instead of phantom duplicates.
const canonicalize = (value: unknown): string => {
    const seen = new WeakSet<object>();
    const walk = (v: unknown): unknown => {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v as object)) return null; // guard against cycles
        seen.add(v as object);
        if (Array.isArray(v)) return v.map(walk);
        return Object.keys(v as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
                acc[k] = walk((v as Record<string, unknown>)[k]);
                return acc;
            }, {});
    };
    try {
        return JSON.stringify(walk(value ?? {}));
    } catch {
        return '';
    }
};

// Derive Capabilities-panel status from the runtime config (best-effort).
const deriveCapabilities = (memoryEnabled: boolean): CapabilitiesState => {
    try {
        const cfg = getRuntimeConfig();
        return {
            runtime: cfg.runtimeArn ? 'active' : 'indeterminate',
            gateway: cfg.gatewayUrl ? 'active' : 'indeterminate',
            memory: memoryEnabled ? 'active' : 'inactive',
            s3VectorsKb: 'active',
            codeInterpreter: 'active',
            observability: 'active',
            guardrail: 'active',
            evaluation: 'active',
        };
    } catch {
        return {
            runtime: 'indeterminate',
            gateway: 'indeterminate',
            memory: memoryEnabled ? 'active' : 'inactive',
            s3VectorsKb: 'indeterminate',
            codeInterpreter: 'indeterminate',
            observability: 'indeterminate',
            guardrail: 'active',
            evaluation: 'active',
        };
    }
};
import { FinalMessageStreaming } from '../../../utilities/finalMessageStreaming';
import { containsProductContent, forceCompleteAllMessages } from '../../../utilities/messageRenderingTools';
import { performSessionRecovery } from '../../../utilities/sessionRecoveryUtils';
import { resetFlowAnimations } from '../../../common/components/react_flow/FlowReset';
import { resetProcessingState, toggleFlowAnimations, areFlowAnimationsFrozen, setFlowAnimationsFrozen, resetChatSession } from '../../../utilities/killSwitch';
import { isSigningOutInProgress } from '../../../utilities/authSubscriptionCleanup';
import { useTraceTimer } from './timerEffect';
import ActivityStatusLoader from './ActivityStatusLoader';

type Message = { 
    id: string; 
    type: string; 
    content: React.ReactNode; 
    timestamp: string; 
    sortKey?: number; // Optional numeric field for consistent sorting 
};

// Type guard to check if an object is a TraceGroup
const isTraceGroup = (msg: any): msg is TraceGroupType => (
    msg?.type === 'trace-group' && 
    'tasks' in msg && 
    Array.isArray(msg.tasks) &&
    'dropdownTitle' in msg
);

const AUTHORS: { 
    user: { type: "user"; name: string; initials?: string }; 
    assistant: { type: "gen-ai"; name: string; initials?: string }; 
} = { 
    user: { type: "user", name: "You", }, 
    assistant: { type: "gen-ai", name: "Assistant", }, 
};

// Helper function to get model ID for AgentFlowPanel
const getModelId = (_model: string) => {
    return "us.amazon.nova-micro-v1:0"; // Default model
};


// Helper function to format duration in milliseconds to a human-readable format
const formatDuration = (ms: number): string => {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
};

interface ChatProps {
  onLoadingStateChange?: (isLoading: boolean) => void;
  initialMessage?: string;
}

// AgentCore short-term memory is keyed by (memoryId, actorId, sessionId). The
// backend already scopes actorId to the caller's Cognito identity, so memory is
// isolated per individual. To make that memory *coherent* (accumulate across a
// person's turns) rather than fragment into a new session per message, we derive
// a session id that is stable and unique per authenticated user, persisted so it
// survives reloads. A different user on the same browser gets a different key —
// so no one ever inherits another person's short-term memory.
const STM_SESSION_PREFIX = "mac_stm_session::";

const getUserScopedSessionId = (userKey: string | undefined): string => {
    // Until the identity resolves, use a throwaway id (never cached).
    if (!userKey) return uuidv4();
    const key = `${STM_SESSION_PREFIX}${userKey}`;
    try {
        const existing = localStorage.getItem(key);
        if (existing) return existing;
        const created = uuidv4();
        localStorage.setItem(key, created);
        return created;
    } catch {
        return uuidv4();
    }
};

const Chat: React.FC<ChatProps> = ({ onLoadingStateChange, initialMessage }) => {
    // The current Cognito user. Its username matches the backend memory actorId,
    // guaranteeing per-individual scoping.
    const { user } = useAuthenticator((context) => [context.user]);
    const sessionId = useMemo(
        () => getUserScopedSessionId(user?.username),
        [user?.username]
    );
    const [message, setMessage] = useState(initialMessage || "");
    // Initialize with empty messages array
    const [messages, setMessages] = useState<Message[]>([]);
    
    // Track if this is the initial load
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    
    // Message history state for the drawer
    const [messagePairs, setMessagePairs] = useState<{
        user: Message;
        assistant: Message;
        date: string;
        time: string;
    }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    // Mirror of isLoading for use inside timers/subscription callbacks, whose
    // closures would otherwise capture a stale isLoading value.
    const isLoadingRef = useRef(false);

    // Custom setter to update loading state
    const updateLoadingState = (newLoadingState: boolean) => {
        isLoadingRef.current = newLoadingState;
        setIsLoading(newLoadingState);
        // Call the parent's onLoadingStateChange if provided
        if (onLoadingStateChange) {
            onLoadingStateChange(newLoadingState);
        }
    };
    const [currentResponseId, setCurrentResponseId] = useState<string | null>(null);
    const [selectedModel] = useState("default"); // Default model selection
    const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected">("disconnected");
    const [showTrace, setShowTrace] = useState(true); // Toggle for showing/hiding trace data (default: enabled)
    const [showWorkflow, setShowWorkflow] = useState(true); // Toggle for showing/hiding workflow diagram (default: enabled)
    const [animationsFrozen, setAnimationsFrozen] = useState(areFlowAnimationsFrozen()); // Track if animations are frozen
    // Short-term memory toggle is shared across Chat, the Capabilities tab, and
    // the Memory tab via context (default ON so Memory is populated).
    const { memoryEnabled, setMemoryEnabled } = useMemory();
    const [showCapabilities, setShowCapabilities] = useState(false); // Retractable capabilities side panel (off by default)

    // Trace state for organized dropdowns
    const [traceState, setTraceState] = useState<TraceState>({
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
    });
    
    // State to track the currently selected agent node
    const [selectedAgentNode, setSelectedAgentNode] = useState<string | null>(null);

    // Track trace state changes without excessive logging
    const prevTraceStateRef = useRef<TraceState | null>(null);
    useEffect(() => {
        // Skip logging on initial render
        if (!prevTraceStateRef.current) {
            prevTraceStateRef.current = traceState;
            return;
        }
        
        // Compare current with previous state to log only meaningful changes
        const prevCount = prevTraceStateRef.current.messages.length;
        const currCount = traceState.messages.length;
        
        if (currCount !== prevCount) {
            console.log(`Trace state updated - now has ${currCount} trace groups (was ${prevCount})`);
        }
        
        // Update the ref to current state
        prevTraceStateRef.current = traceState;
    }, [traceState]);

    // Use the fixed trace timer implementation
    useTraceTimer(showTrace, traceState, setTraceState);

    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Accumulates the normalized trace events seen during the current turn so the
    // chat-side trace dropdowns build up (one group per agent) instead of each
    // subscription update overwriting the last. Keyed for de-duplication. Reset
    // when a new query is submitted.
    const accumulatedTraceEventsRef = useRef<Map<string, unknown>>(new Map());
    const promptInputRef = useRef<HTMLTextAreaElement>(null);

    // Access the Flashbar context
    const { addFlashbarItem } = useContext(FlashbarContext);
    
    // Display workflow image in the middle on initial load
    // Only hide the initial image when there are messages in the chat
    useEffect(() => {
        if (isInitialLoad && messages.length > 1) { // > 1 because there's always an initial greeting
            setIsInitialLoad(false);
        }
    }, [isInitialLoad, messages.length]);

    const client = generateClient();

    // Subscribe to chat updates
    useEffect(() => {
        // Set connection status to connected when subscription starts
        setConnectionStatus("connected");
        
        // Generate a connection ID for AgentFlow
        const connId = generateConnectionId(sessionId);
        
        const subscription = client
            .graphql({
                query: onUpdateChat,
            })
            .subscribe({
                next: ({ data }) => {
                    console.log("Received chat update:", data);
                    // Log raw data with special prefix for easy filtering
                    console.log("%cRAW DATA: AppSync/GraphQL Response", "background: #333; color: #bada55; padding: 2px;", data);
                    // Ensure connection status is set to connected on receiving data
                    setConnectionStatus("connected");
                    
                    if (data.onUpdateChat) {
                        // Always look for trace data first, even if there's no assistant message yet
                        const traceData = parseTraceData(data);
                        
                        // If we have a valid trace with collaborator information
                        if (traceData && traceData.collaboratorName) {
                            console.log('Extracted trace data in Chat component:', traceData);

                            // Notify the AgentFlowPanel of the trace update by triggering a trace event
                            const traceEvent = new CustomEvent('agentTraceEvent', {
                                detail: {
                                    type: 'trace',
                                    connectionId: connId,
                                    content: traceData
                                }
                            });
                            document.dispatchEvent(traceEvent);

                            // For better visibility, log the trace event
                            console.log(`📣 Dispatched trace event for ${traceData.collaboratorName || 'Unknown'} with connectionId ${connId}`);
                            
                            // If we have a selected agent node, check if this trace data is related to it
                            if (selectedAgentNode) {
                                // Enhanced mapping of collaborator names to node IDs
                                const nodeMapping: Record<string, string> = {
                                    'OrderManagement': 'order-mgmt-agent',
                                    'ProductRecommendation': 'product-rec-agent',
                                    'Personalization': 'personalization-agent',
                                    'Troubleshoot': 'ts-agent',
                                    'ROUTING_CLASSIFIER': 'routing-classifier',
                                    'Supervisor': 'supervisor-agent',
                                    // Add more flexible mappings
                                    'OrderManagementAgent': 'order-mgmt-agent',
                                    'ProductRecommendationAgent': 'product-rec-agent',
                                    'PersonalizationAgent': 'personalization-agent',
                                    'TroubleshootAgent': 'ts-agent'
                                };
                                
                                const collaboratorName = traceData.collaboratorName || '';
                                const mappedNodeId = nodeMapping[collaboratorName] || '';
                                
                                // Check if this trace data belongs to the selected agent node with more flexible matching
                                if (mappedNodeId === selectedAgentNode || 
                                    (collaboratorName && selectedAgentNode.includes(collaboratorName.toLowerCase())) ||
                                    (collaboratorName.toLowerCase().includes(selectedAgentNode.replace('-agent', '').toLowerCase()))) {
                                    
                                    console.log(`🔄 Updating selected agent node ${selectedAgentNode} with trace group`);
                                    
                                    // Find the corresponding trace group for this trace data
                                                // Use a type guard to ensure we only work with TraceGroup objects
                                                // Use the existing isTraceGroup type guard
                                                const traceGroupMessages = traceState.messages.filter(
                                                    (msg): msg is TraceGroupType => isTraceGroup(msg)
                                                );
                                                
                                                const matchingTraceGroups = traceGroupMessages.filter(msg => 
                                                    msg.originalAgentType && (
                                                        msg.originalAgentType === collaboratorName ||
                                                        (collaboratorName.toLowerCase().includes(msg.originalAgentType.toLowerCase())) ||
                                                        (msg.originalAgentType.toLowerCase().includes(collaboratorName.toLowerCase()))
                                                    )
                                                );
                                    
                                    // If we found a matching trace group, send it to the agent node
                                    if (matchingTraceGroups.length > 0) {
                                        // Use the first matching trace group
                                        const traceGroup = matchingTraceGroups[0];
                                        console.log(`Found matching trace group for ${collaboratorName}:`, traceGroup);
                                        
                                        // Dispatch an event to update the agent node with the full trace group
                                        const nodeUpdateEvent = new CustomEvent('agentNodeUpdate', {
                                            detail: {
                                                nodeId: selectedAgentNode,
                                                traceData: traceData,
                                                traceGroup: traceGroup,
                                                connId: connId
                                            }
                                        });
                                        document.dispatchEvent(nodeUpdateEvent);
                                    } else {
                                        console.log(`No matching trace group found for ${collaboratorName}`);
                                        
                                        // Send just the trace data for now
                                        const nodeUpdateEvent = new CustomEvent('agentNodeUpdate', {
                                            detail: {
                                                nodeId: selectedAgentNode,
                                                traceData: traceData,
                                                connId: connId
                                            }
                                        });
                                        document.dispatchEvent(nodeUpdateEvent);
                                    }
                                }
                            }
                        } // end legacy collaboratorName-gated handling (agentTraceEvent + selectedAgentNode)

            // Process trace data for the chat dropdowns AND the workflow diagram.
            // IMPORTANT: this runs INDEPENDENTLY of the legacy parseTraceData() result.
            // The normalized event format (agentId/eventType/payload) has NO
            // `collaboratorName`, so nesting this under `if (traceData.collaboratorName)`
            // silently skipped every trace in the browser (the isolated test bypassed
            // that gate, which is why it appeared to work).
            // AWSJSON fields (trace/traceMetadata) may arrive as either a JSON string
            // or an already-parsed object depending on the client, so we normalize
            // both to a string before parsing.
            const rawTraceField = (data.onUpdateChat as any).trace;
            const rawTraceMetaField = (data.onUpdateChat as any).traceMetadata;
            if (rawTraceField != null || rawTraceMetaField != null) {
                                const toJsonString = (v: unknown): string | null =>
                                    v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
                                const traceStr = toJsonString(rawTraceField);
                                const metaStr = toJsonString(rawTraceMetaField);

                                // Drive the flow diagram from the fullest payload available
                                // (traceMetadata carries every event for the turn, so a single
                                // update can light up all the nodes that participated).
                                try { dispatchNormalizedTrace(metaStr ?? traceStr ?? undefined); } catch { /* not a normalized trace */ }

                                // Build the chat-side trace dropdowns from the normalized events.
                                // We ACCUMULATE every event seen this turn (de-duplicated) so each
                                // agent keeps its own dropdown instead of the latest update
                                // overwriting the previous one.
                                //
                                // Source: prefer `traceMetadata` — it is the CUMULATIVE, authoritative
                                // list of every event so far. `trace` only ever carries the single
                                // latest event, which is already contained in `traceMetadata`. Reading
                                // both and concatenating them double-counts every step (the same event
                                // arrives once from each field, and an AWSJSON round-trip can re-order
                                // payload keys so the two copies no longer collapse under a
                                // payload-sensitive key). Use one source of truth instead.
                                try {
                                    const incoming =
                                        metaStr != null ? parseTracePayload(metaStr) : parseTracePayload(traceStr);
                                    if (incoming.length > 0) {
                                        const acc = accumulatedTraceEventsRef.current;
                                        for (const ev of incoming) {
                                            const e = ev as { eventType?: string; agentId?: string; timestamp?: number; payload?: unknown };
                                            // Stable identity for an event: type + producing agent +
                                            // construction timestamp (assigned once on the backend) + a
                                            // CANONICAL payload signature (keys sorted recursively). The
                                            // canonical form makes the two copies of an event that arrive
                                            // via `trace` vs `traceMetadata` collapse even when an AWSJSON
                                            // round-trip re-orders payload keys, while still keeping two
                                            // genuinely different calls distinct.
                                            const key = `${e.eventType}|${e.agentId}|${e.timestamp}|${canonicalize(e.payload)}`;
                                            acc.set(key, ev);
                                        }
                                        const allEvents = Array.from(acc.values());
                                        const groupMap = buildTraceGroups(allEvents);
                                        // Keep ALL groups (including the governance guardrail/
                                        // evaluation nodes) in trace state so clicking those nodes
                                        // in the workflow diagram can show their trace data. They
                                        // are only hidden from the chat dropdown LIST at render
                                        // time (see GOVERNANCE_NODE_IDS filter below).
                                        const groups = Array.from(groupMap.values()) as unknown as TraceGroupType[];
                                        // Persist every group into the agent-trace cache keyed by
                                        // node id. The workflow diagram's node-click handler reads
                                        // from this cache (getAgentTrace), so storing here makes a
                                        // node's data available on click INDEPENDENTLY of the
                                        // animation/dispatch path — which could otherwise skip the
                                        // guardrail/evaluation nodes (they arrive last, and dispatch
                                        // de-dups already-animated nodes), leaving their modal blank.
                                        groups.forEach((g) => {
                                            const nid = (g as { agentId?: string }).agentId;
                                            if (nid) {
                                                try { storeAgentTrace(nid, g); } catch { /* best-effort cache */ }
                                            }
                                        });
                                        setTraceState(prev => {
                                            const nonGroups = prev.messages.filter(m => m.type !== 'trace-group');
                                            return { ...prev, messages: [...nonGroups, ...groups] };
                                        });
                                    }
                                } catch (e) {
                                    console.error('Error building normalized trace groups:', e);
                                }

                            }
                        
                        // Update the assistant's message if available
                        if (data.onUpdateChat.assistant && currentResponseId) {
                            // IMPORTANT: Always store to localStorage immediately for recovery
                            const storageKey = `complete_message_${currentResponseId}`;
                            localStorage.setItem(storageKey, data.onUpdateChat.assistant);
                            
                            // If this is product-related content, create additional backup
                            if (containsProductContent(data.onUpdateChat.assistant)) {
                                const productKey = `product_message_${Date.now()}`;
                                localStorage.setItem(productKey, data.onUpdateChat.assistant);
                                console.log(`⚠️ Product content detected, created backup: ${productKey}`);
                            }
                            
                            // If it's the first time we're getting content, make sure the message is at the end
                            const currentContent = messages.find(msg => msg.id === currentResponseId)?.content;

                            if (!currentContent || currentContent === '') {
                                // This is the first content for this message, ensure it appears at the end
                                setMessages((prev) => {
                                    // First filter out the placeholder empty message
                                    const filteredMessages = prev.filter(msg => msg.id !== currentResponseId);

                                    // Then add it back at the end with content
                                    return [
                                        ...filteredMessages,
                                        {
                                            id: currentResponseId,
                                            type: "assistant",
                                            content: data.onUpdateChat.assistant,
                                            timestamp: new Date().toLocaleTimeString(),
                                        }
                                    ];
                                });
                                
                                // Set failsafe timeout - ensure message gets fully displayed after delay
                                const messageTimeout = setTimeout(() => {
                                    console.log("🔄 Failsafe: Ensuring message completion after initial render");
                                    document.dispatchEvent(new Event('forceCompleteTextContent'));
                                    
                                    // Also set loading to false after a reasonable timeout
                                    setTimeout(() => {
                                        if (isLoading) {
                                            console.log("⚠️ Timeout: Forcing loading state off after delay");
                                            updateLoadingState(false);
                                        }
                                    }, 5000);
                                }, 10000);
                                
                                // Track the timeout for cleanup
                                if (window.__activeTimers) {
                                    window.__activeTimers.push(messageTimeout);
                                }
                            } else {
                                // Check if the content has significantly changed to avoid unnecessary updates
                                const existingMessage = messages.find(msg => msg.id === currentResponseId);
                                const existingContent = existingMessage?.content || '';
                                const currentContent = typeof existingContent === 'string' ? existingContent : '';
                                const newContent = data.onUpdateChat.assistant;
                                
                                // Check for final response indicators more thoroughly
                                const isFinalResponse = 
                                    newContent.includes("Can I help you with anything else?") ||
                                    newContent.includes("Is there anything else") ||
                                    newContent.includes("In conclusion") ||
                                    newContent.includes("To summarize") ||
                                    newContent.includes("I hope this helps") ||
                                    newContent.includes("Please let me know if you have any questions") ||
                                    newContent.includes("Let me know if you") ||
                                    newContent.includes("Hope that helps") ||
                                    newContent.includes("Recommended Products:") ||
                                    newContent.includes("Troubleshooting Tips:") || 
                                    (newContent.includes("ThunderBolt Speaker") && newContent.length > 300) ||
                                    (newContent.includes("SonicWave") && newContent.length > 300) ||
                                    (newContent.includes("VitaFit Smartwatch") && newContent.length > 300) ||
                                    (containsProductContent(newContent) && newContent.length > 500) ||
                                    newContent.length > 1500; // Any very long message is likely final
                                                
                                                // For final messages:
                                                // 1. Always update to ensure complete content is displayed
                                                // 2. Force immediate rendering with a synchronous update
                                                // 3. Explicitly stop loading state
                                                if (isFinalResponse) {
                                                    console.log("Final response detected in subscription update, forcing immediate display");
                                                    
                                                    // Stop any active streaming
                                                    document.dispatchEvent(new Event('stopAllTextAnimations'));
                                                    
                                                    // Update synchronously rather than with setTimeout
                                                    setMessages((prev) =>
                                                        prev.map((msg) =>
                                                            msg.id === currentResponseId
                                                                ? { ...msg, content: newContent }
                                                                : msg
                                                        )
                                                    );
                                                    
                                                    // Explicitly end loading state - ensure Data tab is enabled
                                                    updateLoadingState(false); // This properly updates both local state and parent component
                                                    setCurrentResponseId(null);
                                                    
                                                    return; // Skip the delayed update below
                                                }
                                                // For non-final messages, use original logic
                                                else if (Math.abs(newContent.length - currentContent.length) >= 15) {
                                    // Update with a small delay to avoid render conflicts
                                    setTimeout(() => {
                                        setMessages((prev) =>
                                            prev.map((msg) =>
                                                msg.id === currentResponseId
                                                    ? { ...msg, content: newContent }
                                                    : msg
                                            )
                                        );
                                    }, 10);
                                }
                            }
                        }

                        // Check if we have a final response and should stop the loading state.
                        // The runtime delivers the assistant answer as a single terminal chunk
                        // (trace events stream first, then the full text), so any non-empty
                        // assistant value means the turn is complete. Relying on this instead of
                        // content heuristics guarantees the input/tabs re-enable every time.
                        if (data.onUpdateChat.assistant && data.onUpdateChat.assistant.trim().length > 0) {
                            console.log("Final response detected, ending loading state");
                            
                            // Important: Save the complete message to localStorage for reliable rendering
                            if (currentResponseId) {
                                console.log("💾 Saving complete message to localStorage:", currentResponseId);
                                localStorage.setItem(`complete_message_${currentResponseId}`, data.onUpdateChat.assistant);
                            }
                            
                            // Clear any active response timeout since we got a complete response
                            if (window.__activeTimers) {
                                window.__activeTimers.forEach(timerId => clearTimeout(timerId));
                                window.__activeTimers = [];
                            }
                            
                            // Immediately end the loading state to enable the input field
                            updateLoadingState(false);
                            setCurrentResponseId(null);
                            
                            // Create a trace for the browser node showing the final response
                            // Get the trace group start time safely using our utility function
                            const customerStartTime = getTraceGroupStartTime(traceState.messages, 'customer');
                            const elapsedTime = ((Date.now() - customerStartTime) / 1000).toFixed(2);

                            const browserFinalResponseTrace: TraceGroupType = {
                                id: `browser-trace-response-${Date.now()}`,
                                type: 'trace-group',
                                sender: 'bot',
                                dropdownTitle: 'Browser - Final Response',
                                agentId: 'customer', // This matches the browser node ID
                                originalAgentType: 'Browser',
                                tasks: [{
                                    stepNumber: 2,
                                    title: `Step 2 - Final Response (${elapsedTime} seconds)`,
                                    content: data.onUpdateChat.assistant,
                                    timestamp: Date.now()
                                }],
                                text: "Final response from agents",
                                startTime: customerStartTime,
                                lastUpdateTime: Date.now(),
                                isComplete: true
                            };

                            // Store the browser trace with preserve flag to ensure it doesn't overwrite user message trace
                            storeAgentTrace('customer', browserFinalResponseTrace, sessionId, true);

                            // Activate the browser node with the final response trace
                            const browserNodeUpdateEvent = new CustomEvent('agentNodeUpdate', {
                                detail: {
                                    nodeId: 'customer',
                                    traceGroup: browserFinalResponseTrace
                                }
                            });
                            document.dispatchEvent(browserNodeUpdateEvent);
                            
                            // Notify any registered complete handlers by triggering a complete event
                            const completeEvent = new CustomEvent('agentTraceEvent', {
                                detail: {
                                    type: 'complete',
                                    connectionId: connId,
                                    content: data.onUpdateChat
                                }
                            });
                            document.dispatchEvent(completeEvent);

                            // We no longer need to add a new message here since we're always
                            // using the streaming effect which adds it earlier in the process
                            console.log("Response complete, relying on the existing message with streaming effect");
                            
                        }
                        
                        // Enhanced fallback mechanism to detect response completion
                        // If the response hasn't been marked as complete but looks substantial, enable the input
                        if (data.onUpdateChat.assistant && 
                            data.onUpdateChat.assistant.length > 100 && 
                            isLoading) {
                            // Track elapsed time from when the trace started
                            const foundGroup = traceState.messages.find(m => isTraceGroup(m) && m.agentId === 'customer') as TraceGroupType | undefined;
                            const elapsedTime = Date.now() - (foundGroup?.startTime || Date.now());
                            
                            // More aggressive completion detection for better UX
                            const shouldComplete = 
                                elapsedTime > 3000 || // 3 seconds elapsed
                                data.onUpdateChat.assistant.length > 500 || // Long response
                                data.onUpdateChat.assistant.includes('$') && data.onUpdateChat.assistant.length > 200 || // Product info
                                data.onUpdateChat.assistant.includes('Recommended') && data.onUpdateChat.assistant.length > 150; // Recommendations
                                
                            if (shouldComplete) {
                                console.log("Response appears complete based on enhanced criteria");
                                
                                // Clear any active response timeout
                                if (window.__activeTimers) {
                                    window.__activeTimers.forEach(timerId => clearTimeout(timerId));
                                    window.__activeTimers = [];
                                }
                                
                                updateLoadingState(false);
                                setCurrentResponseId(null);
                                
                                // Force a completion event to ensure proper cleanup
                                setTimeout(() => {
                                    document.dispatchEvent(new Event('forceCompleteTextContent'));
                                }, 100);
                            }
                        }
                    }
                },
                error: (error) => {
                    console.error("Error in chat subscription:", error);
                    
                    // Reset loading state and current response ID
                    updateLoadingState(false);
                    setCurrentResponseId(null);
                    setConnectionStatus("disconnected");
                    
                    // Check if the error occurred during sign-out process
                    // If so, suppress the error notification
                    if (isSigningOutInProgress()) {
                        console.log("Subscription error during sign-out - suppressing notification");
                        return;
                    }
                    
                    // Only show error message if not during sign-out
                    addFlashbarItem("error", "Error in chat subscription. Please try again.");
                    
                    // Attempt automatic reconnection if applicable
                    // This helps recover from temporary network issues
                    setTimeout(() => {
                        if (sessionId && document.visibilityState === 'visible') {
                            console.log("Attempting automatic reconnection after subscription error");
                            const connId = generateConnectionId(sessionId);
                            
                            // Dispatch reconnection event
                            const reconnectEvent = new CustomEvent('subscriptionReconnect', {
                                detail: { connId, timestamp: Date.now() }
                            });
                            document.dispatchEvent(reconnectEvent);
                        }
                    }, 3000); // Wait 3 seconds before attempting reconnection
                },
            });

        // Set up a heartbeat to detect disconnections
        const connectionCheckInterval = setInterval(() => {
            // If the subscription is closed, update the connection status
            if (subscription.closed) {
                setConnectionStatus("disconnected");
            }
        }, 5000); // Check every 5 seconds

        return () => {
            subscription.unsubscribe();
            clearInterval(connectionCheckInterval);
            setConnectionStatus("disconnected");
        };
    }, [currentResponseId, addFlashbarItem, sessionId, showTrace]);

    useEffect(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Handle toggling trace visibility
    useEffect(() => {
        console.log(`Trace visibility ${showTrace ? 'enabled' : 'disabled'}`);

        // Keep trace messages in state even when traces are hidden,
        // just don't display them. This ensures all traces are accumulated properly.
        // Only clear them when starting a new conversation.
    }, [showTrace]);
    
    // Listen for agent node selection events from AgentFlowPanel
    useEffect(() => {
        const handleAgentNodeSelection = (event: Event) => {
            const customEvent = event as CustomEvent;
            if (customEvent.detail && customEvent.detail.nodeId) {
                const nodeId = customEvent.detail.nodeId;
                const noAnimation = customEvent.detail.noAnimation === true;
                console.log(`Agent node selected in flow panel: ${nodeId}${noAnimation ? ' (no animation)' : ''}`);
                setSelectedAgentNode(nodeId);
                
                // Immediately send any existing trace data for this node
                // This ensures the node shows trace data as soon as it's selected
                if (traceState.messages.length > 0) {
                    console.log(`Checking for existing trace data for node ${nodeId}`);
                    
                    // Enhanced node mapping for flexibility
                    const nodeMapping: Record<string, string[]> = {
                        'order-mgmt-agent': ['OrderManagement', 'Order', 'OrderAgent'],
                        'product-rec-agent': ['ProductRecommendation', 'Product', 'ProductAgent'],
                        'personalization-agent': ['Personalization', 'Personal'],
                        'ts-agent': ['Troubleshoot', 'Trouble', 'Support'],
                        'routing-classifier': ['ROUTING_CLASSIFIER', 'Classifier', 'Router'],
                        'supervisor-agent': ['Supervisor', 'SupervisorAgent']
                    };
                    
                    // Find potential agent names that could match this node
                    const potentialAgentNames = nodeMapping[nodeId] || [];
                    
                    // Get only trace group messages
                    const traceGroupMessages = traceState.messages.filter(msg => msg.type === 'trace-group') as TraceGroupType[];
                    
                    // Look for trace groups with any of these agent names
                    const matchingTraceGroups = traceGroupMessages.filter(msg => {
                        if (!msg.originalAgentType) return false;
                        
                        const agentType = msg.originalAgentType;
                        // Check if the agent type matches any of our potential names
                        return potentialAgentNames.some(name => 
                            agentType.toLowerCase().includes(name.toLowerCase()) ||
                            name.toLowerCase().includes(agentType.toLowerCase())
                        );
                    });
                        
                if (matchingTraceGroups.length > 0) {
                    // Use the first matching trace group
                    const traceGroup = matchingTraceGroups[0];
                    console.log(`Found existing trace group for ${nodeId}:`, traceGroup);
                    
                    // Check if the trace group has actual content before animating
                    const hasValidTraceData = traceGroup && 
                                            traceGroup.tasks && 
                                            Array.isArray(traceGroup.tasks) && 
                                            traceGroup.tasks.length > 0;
                    
                    if (hasValidTraceData) {
                        console.log(`Trace group has valid data with ${traceGroup.tasks.length} tasks - animating node`);
                        
                        // Get the connection ID
                        const connId = generateConnectionId(sessionId);
                        
                        // Dispatch an event to update the node with the trace data
                        const nodeUpdateEvent = new CustomEvent('agentNodeUpdate', {
                            detail: {
                                nodeId: nodeId,
                                traceData: { collaboratorName: traceGroup.originalAgentType },
                                traceGroup: traceGroup,
                                connId: connId
                            }
                        });
                        document.dispatchEvent(nodeUpdateEvent);
                    } else {
                        console.log(`Trace group for ${nodeId} has no tasks - skipping animation`);
                        
                        // Dispatch an event just to select the node without animation
                        const selectOnlyEvent = new CustomEvent('agentNodeSelected', {
                            detail: {
                                nodeId: nodeId,
                                noAnimation: true,
                                timestamp: Date.now()
                            }
                        });
                        document.dispatchEvent(selectOnlyEvent);
                    }
                } else {
                    console.log(`No matching trace group found for ${nodeId} - skipping animation`);
                }
                }
            }
        };
        
        // Add event listener for agent node selection
        document.addEventListener('agentNodeSelected', handleAgentNodeSelection);
        
        return () => {
            // Remove event listener on cleanup
            document.removeEventListener('agentNodeSelected', handleAgentNodeSelection);
        };
    }, [traceState.messages, sessionId]);
    
    // No duplicate timer effect needed - we're using useTraceTimer hook now

    // Effect to update messagePairs whenever a user message gets an assistant response
    useEffect(() => {
        // Find all user messages and assistant responses (excluding the initial greeting)
        const userMessages = messages.filter(msg => msg.type === "user");
        const assistantMessages = messages.filter(msg => msg.type === "assistant" && msg.id !== "1");
        
        // Look for potential new message pairs
        if (userMessages.length > 0 && assistantMessages.length > 0) {
            // Create a map of existing pairs for quick lookup
            const existingPairMap = new Map();
            messagePairs.forEach(pair => {
                if (pair.user && pair.assistant) {
                    const pairKey = `${pair.user.id}-${pair.assistant.id}`;
                    existingPairMap.set(pairKey, true);
                }
            });
            
            // Find new message pairs
            const newPairs = [];
            
            // Try to match each user message with an assistant response
            for (const userMsg of userMessages) {
                // Find assistant messages that came after this user message
                const matchingAssistantMsgs = assistantMessages.filter(assistantMsg => {
                    const userTime = new Date(`1/1/2023 ${userMsg.timestamp}`).getTime();
                    const assistantTime = new Date(`1/1/2023 ${assistantMsg.timestamp}`).getTime();
                    return assistantTime > userTime;
                }).sort((a, b) => {
                    const timeA = new Date(`1/1/2023 ${a.timestamp}`).getTime();
                    const timeB = new Date(`1/1/2023 ${b.timestamp}`).getTime();
                    return timeA - timeB;
                });
                
                if (matchingAssistantMsgs.length > 0) {
                    const matchingAssistantMsg = matchingAssistantMsgs[0]; // Take the earliest matching response
                    
                    // Check if this pair already exists in our history
                    const pairKey = `${userMsg.id}-${matchingAssistantMsg.id}`;
                    
                    if (!existingPairMap.has(pairKey) && 
                        typeof userMsg.content === 'string' && 
                        typeof matchingAssistantMsg.content === 'string') {
                        
                        // *** IMPORTANT: Check for a complete message version in localStorage first before using the potentially truncated one
                        let assistantContent = matchingAssistantMsg.content;
                        const storageKey = `complete_message_${matchingAssistantMsg.id}`;
                        const savedMessage = localStorage.getItem(storageKey);
                        
                        if (savedMessage && savedMessage.length >= (assistantContent?.length || 0)) {
                            console.log(`Using complete message from localStorage for chat history: ${storageKey}, length=${savedMessage.length}`);
                            assistantContent = savedMessage;
                        }
                        
                        // Look for product backup messages if this is a product-related message
                        if (assistantContent && 
                            (assistantContent.includes("Recommended Products:") || 
                             assistantContent.includes("Troubleshooting Tips:") ||
                             assistantContent.includes("VitaFit Smartwatch") ||
                             assistantContent.includes("ThunderBolt Speaker"))) {
                            // Find any product backups that might be more complete
                            const productBackupKeys = Object.keys(localStorage).filter(key => 
                                key.startsWith('product_message_') && localStorage.getItem(key)?.length > assistantContent.length);
                            
                            if (productBackupKeys.length > 0) {
                                // Use the longest one
                                const longestBackup = productBackupKeys.reduce((longest, key) => {
                                    const content = localStorage.getItem(key) || '';
                                    return content.length > longest.length ? content : longest;
                                }, assistantContent);
                                
                                if (longestBackup.length > assistantContent.length) {
                                    console.log(`Using product backup message for chat history: length=${longestBackup.length} (original: ${assistantContent.length})`);
                                    assistantContent = longestBackup;
                                }
                            }
                        }
                        
                        const currentDate = new Date();
                        const date = currentDate.toLocaleDateString();
                        const time = userMsg.timestamp;
                        
                        // Create the message pair with the complete assistant content
                        const completePair = {
                            id: pairKey,
                            user: userMsg,
                            assistant: {
                                ...matchingAssistantMsg,
                                content: assistantContent // Use the complete content
                            },
                            date,
                            time
                        };
                        
                        // This is a new pair we don't have yet
                        newPairs.push(completePair);
                    }
                }
            }
            
            // If we found any new pairs, add them to our history
            if (newPairs.length > 0) {
                console.log(`Found ${newPairs.length} new message pairs to add to history`);
                
                // Use the saveMessagePair function from chatHistoryService.ts for each new pair
                // to ensure consistent history management
                import('./chatHistoryService').then(({ saveMessagePair }) => {
                    // Process each pair one by one to ensure consistent saving
                    newPairs.forEach(pair => {
                        saveMessagePair(pair);
                    });
                    
                    // Then reload the history from localStorage to ensure we're showing the latest data
                    import('./loadChatHistory').then(({ loadChatHistoryFromLocalStorage }) => {
                        const latestHistory = loadChatHistoryFromLocalStorage();
                        console.log(`Updated message history: now ${latestHistory.length} pairs total`);
                        setMessagePairs(latestHistory);
                    });
                });
            }
        }
    }, [messages, messagePairs]);

    // Handle message submission
    const submitMessageForm = async () => {
        if (!message.trim()) return;

    // First, clean up localStorage to prevent quota exceeded errors
    try {
        const { triggerMessageCleanup } = await import('../../../utilities/localStorageCleanup');
        triggerMessageCleanup(); // This will clean up localStorage before sending new messages
        console.log('🧹 Triggered localStorage cleanup before sending new message');
    } catch (error) {
        console.error('Failed to clean up localStorage:', error);
    }

    // Reuse this user's stable session id so AgentCore short-term memory
    // accumulates across their turns (and stays scoped to them) instead of
    // starting a brand-new, disconnected session on every message.
    const newSessionId = sessionId;
    console.log(`🔄 Using session: ${newSessionId}`);
    
    // Call our comprehensive session reset function to clean up the state
    resetChatSession();
    
    // Reset all flow animations for the new message
    resetFlowAnimations();
    
    // Explicitly set animations state back to unfrozen for new message
    setAnimationsFrozen(false);
    setFlowAnimationsFrozen(false);
    
    // Force reset all DOM animation classes
    const activeEdges = document.querySelectorAll('.react-flow__edge-path.active, .react-flow__edge-path.solid-blue');
    activeEdges.forEach((edge) => {
      edge.classList.remove('active', 'solid-blue');
    });
    
    // Dispatch a custom event to ensure complete animation reset
    const flowResetEvent = new CustomEvent('flowAnimationReset', {
      detail: { 
        timestamp: Date.now(),
        resetCompletedStates: true
      }
    });
    document.dispatchEvent(flowResetEvent);
        
    // ALWAYS force remove ALL previous messages except the initial greeting
    // This ensures a clean slate for the new conversation
    console.log("Removing ALL previous messages before sending new message");
    setMessages(prev => prev.filter(msg => 
        msg.id === "1" && msg.type === "assistant" // Keep ONLY the initial greeting
    ));

        // Add user message to chat
        const userMessage: Message = {
            id: Date.now().toString(),
            type: "user",
            content: message,
            timestamp: new Date().toLocaleTimeString(),
        };

        // Create a unique ID for the assistant's response
        const responseId = (Date.now() + 1).toString();

        // Store the message to send
        const messageToSend = message;

        // First update with just the user message
        setMessages((prev) => [...prev, userMessage]);

    // Clear any previous trace data when starting a new conversation
    setTraceState({
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
    });
    
    // Clear all stored agent traces to ensure complete cleanup
    clearAllAgentTraces();
    // Reset the per-turn normalized trace accumulator so dropdowns start fresh.
    accumulatedTraceEventsRef.current = new Map();
    // Reset the staggered flow-animation schedule so agents light up one at a
    // time (in call order) for this new turn instead of all at once.
    resetFlowAnimationSchedule();

    // Set loading state and store the response ID for later updates
        setCurrentResponseId(responseId);
        updateLoadingState(true);
        setMessage(""); // Clear input immediately for better UX

        // Set up a safety timeout to prevent hanging responses (15 seconds).
        // Reads isLoadingRef (not the stale isLoading closure) so it reliably
        // fires as a backstop when a turn errors or never reports completion.
        const responseTimeout = setTimeout(() => {
            if (isLoadingRef.current) {
                console.log('⏰ Response timeout reached - forcing completion');
                updateLoadingState(false);
                setCurrentResponseId(null);
                
                // Force any pending messages to complete
                document.dispatchEvent(new Event('stopAllTextAnimations'));
                document.dispatchEvent(new Event('forceCompleteTextContent'));
            }
        }, 15000);
        
        // Store the timeout for potential cleanup
        if (window.__activeTimers) {
            window.__activeTimers.push(responseTimeout);
        }

        // Add empty assistant message to ensure the loader is shown
        setMessages((prev) => [
            ...prev,
            {
                id: responseId,
                type: "assistant",
                content: "", // Empty content initially
                timestamp: new Date().toLocaleTimeString(),
            }
        ]);

        // Explicitly dispatch event to reactivate animations
        document.dispatchEvent(new CustomEvent('reactivateAnimations', {
            detail: { timestamp: Date.now() }
        }));

        // Create a unique user message trace ID linked to the current message ID
        const userMessageTraceId = `browser-trace-user-${userMessage.id}`;
        
        // Create a trace specifically for the browser node showing the user's message
        const browserUserMessageTrace: TraceGroupType = {
            id: userMessageTraceId,
            type: 'trace-group',
            sender: 'bot',
            dropdownTitle: 'Browser - User Message',
            agentId: 'customer', // This matches the browser node ID
            originalAgentType: 'Browser',
            tasks: [{
                stepNumber: 1,
                title: `Step 1 - User Message (0.00 seconds)`,
                content: messageToSend,
                timestamp: Date.now()
            }],
            text: "User's message",
            startTime: Date.now(),
            lastUpdateTime: Date.now()
        };

        // Store the browser trace with explicit 'preserve' flag to ensure it doesn't overwrite other traces
        storeAgentTrace('customer', browserUserMessageTrace, newSessionId, true);

        // Activate the browser node with the user message trace
        const browserNodeUpdateEvent = new CustomEvent('agentNodeUpdate', {
            detail: {
                nodeId: 'customer',
                traceGroup: browserUserMessageTrace
            }
        });
        document.dispatchEvent(browserNodeUpdateEvent);
        
        // Ensure the user message is sent after a slight delay to properly initialize animations
        setTimeout(() => {
            // Dispatch a custom event to notify that a user message was sent
            document.dispatchEvent(new CustomEvent('userMessageSent', {
                detail: { 
                    message: messageToSend,
                    timestamp: Date.now()
                }
            }));
            
            // Store the current session ID for cleanup functionality
            window.__currentSessionId = newSessionId;
            
            // Run storage cleanup to prevent quota issues
            import('./chatHistoryService').then(({ cleanupChatStorage }) => {
                setTimeout(() => cleanupChatStorage(false), 500);
            });
            
            // Also clean up agent trace storage
            if (window.__agentTraceCache) {
                setTimeout(() => {
                    try {
                        import('../../../utilities/agentTraceStorage').then(({ cleanupAllButCurrentSession }) => {
                            if (typeof cleanupAllButCurrentSession === 'function') {
                                cleanupAllButCurrentSession();
                            }
                        });
                    } catch (error) {
                        console.error("Error importing cleanupAllButCurrentSession:", error);
                    }
                }, 1000);
            }
        }, 10);

        // Send message to backend
        try {
            // Enhanced logging for user messages
            console.log(`💬 USER MESSAGE SENT:`, {
                message: messageToSend,
                sessionId: sessionId,
                timestamp: new Date().toISOString()
            });
            
            await sendMessage(newSessionId, messageToSend, undefined, memoryEnabled);

            // We'll maintain loading state until we get a complete response
            // or explicitly handle a timeout through subscription updates
            // Don't reset the loading state automatically here
            
            // Notify the AgentFlowPanel that a new question has been asked
            const connId = generateConnectionId(newSessionId);
            const questionEvent = new CustomEvent('agentTraceEvent', {
                detail: { 
                    type: 'question', 
                    connectionId: connId,
                    content: { message: messageToSend } 
                }
            });
            document.dispatchEvent(questionEvent);
        } catch (error) {
            console.error("Error sending message:", error);
            
            // Special handling for Lambda timeout errors
            const isLambdaTimeout = 
                error?.errors?.[0]?.errorType === "Lambda:ExecutionTimeoutException" ||
                error?.message?.includes("Execution timed out");
                
            if (isLambdaTimeout) {
                console.log("Lambda execution timed out, but processing continues asynchronously");
                // Don't show an error to the user - the Lambda is still processing
                // and results will come through the subscription
                
                // Add a status message to let the user know processing is continuing
                addFlashbarItem(
                    "info",
                    "Your request is being processed. Results will appear shortly."
                );
                
                // Keep the loading state active as processing continues
                return;
            }
            
            // For other errors, show error message and reset state
            updateLoadingState(false);
            setCurrentResponseId(null);

            // Display error in Flashbar instead of in chat UI
            addFlashbarItem(
                "error",
                "Failed to send message. There was an error processing your request. Please try again."
            );

            // Remove the empty assistant message since we're not going to fill it
            setMessages((prev) => prev.filter((msg) => msg.id !== responseId));
        }
    };

// ChatBubble Avatar component
const ChatBubbleAvatar = ({
    type,
    name,
    initials,
}: {
    type: "user" | "gen-ai";
    name: string;
    initials?: string;
}) => {
    if (type === "gen-ai") {
        return (
            <Avatar
              ariaLabel="Avatar of generative AI assistant"
              color="gen-ai"
              iconName="gen-ai"
              tooltipText="Generative AI assistant"
            />
        );
    }
    return <Avatar initials={initials} tooltipText={name} ariaLabel={name} />;
};

    // Helper to detect final response markers in content
    const isFinalResponseContent = (content: string): boolean => {
        return (
            content.includes("Can I help you with anything else?") ||
            content.includes("Is there anything else") ||
            content.includes("In conclusion") ||
            content.includes("To summarize")
        );
    };
    


    const MemoizedScrollableContainer = React.useMemo(() => {
        const ScrollableContainer = React.forwardRef(function ScrollableContainer(
            { children }: { children: React.ReactNode },
            ref: React.Ref<HTMLDivElement>
        ) {
            return (
                <div style={{ height: "100%", position: "relative" }}>
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            overflowY: "auto",
                            padding: "20px",
                        }}
                        ref={ref}
                    >
                        {children}
                    </div>
                </div>
            );
        });
        return ScrollableContainer;
    }, []);

// Global function to stop all text streaming animations
const stopAllTextAnimations = () => {
  // Find all assistant messages that might be streaming
  const messages = document.querySelectorAll('.cloudscape-chat-bubble-content');
  if (messages.length > 0) {
    console.log('🛑 Stopping all text animations due to input focus');
    
    // Dispatch a custom event that can be listened for by animation components
    // Include a flag that specifies this is a user-triggered interruption which should be respected
    document.dispatchEvent(new CustomEvent('stopAllTextAnimations', {
      detail: { source: 'user_interaction', allowOverrideProtection: true }
    }));
    
    // Ensure the full content is still displayed after animation stops
    setTimeout(() => {
      // Force any final content updates after animation stops
      document.dispatchEvent(new Event('forceCompleteTextContent'));
    }, 100);
  }
};
    
    // Handle quick link click
    const handleQuickLinkClick = (text: string) => {
        // Use our comprehensive session reset function
        resetChatSession();
        
        // Set the new message text from the quick link
        setMessage(text);
        if (promptInputRef.current) {
            promptInputRef.current.focus();
        }
    };

// Local implementation of resetEdgeAnimations to avoid import issues
const resetEdgeAnimations = (): void => {
  console.log('🔄 Locally resetting edge animations only');
  
  // Reset all active edge paths
  const activeEdges = document.querySelectorAll('.react-flow__edge-path.active');
  
  activeEdges.forEach((edge) => {
    edge.classList.remove('active');
  });
  
  // Also find any edge container elements that might have custom classes
  const edgeElements = document.querySelectorAll('.react-flow__edge');
  
  edgeElements.forEach((edge) => {
    // Remove any animation-related classes
    edge.classList.remove('animated-edge');
    edge.classList.remove('active-edge');
    edge.classList.remove('highlighted-edge');
    edge.removeAttribute('data-animated');
    edge.removeAttribute('data-active');
  });
  
  // Dispatch a custom event just for edge resets
  const resetEvent = new CustomEvent('flowEdgesReset', {
    detail: { 
      timestamp: Date.now(),
    }
  });
  document.dispatchEvent(resetEvent);
  
  console.log('✅ Edge animations reset complete');
};

// Handle input focus using React's approach rather than direct DOM events
const handleInputFocus = () => {
    // NOTE: do NOT reset the flow animations here. The workflow diagram should
    // keep showing the last run's result until the user submits a NEW prompt
    // (submitMessageForm resets it). Resetting on focus made the diagram clear
    // whenever the user merely clicked the message box after a run.

    // Stop any in-progress text animations so typing a new message is smooth.
    // (This only finalizes streaming text; it does not reset the diagram.)
    stopAllTextAnimations();
};
    
    // State for active tab and history loading
    const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    
    // Load chat history from DynamoDB on mount or when activeTab changes to 'history'
    useEffect(() => {
        const fetchChatHistory = async () => {
            // Always fetch chat history on component mount for console display
            setHistoryLoading(true);
            setHistoryError(null);
            
            try {
                // Use our enhanced chat history loader that logs to console
                const { loadAndLogChatHistory } = await import('./loadChatHistory');
                const historyData = await loadAndLogChatHistory();
                
                // Only update UI if we're on the history tab
                if (activeTab === 'history') {
                    setMessagePairs(historyData);
                }
            } catch (error) {
                console.error('Error loading chat history from DynamoDB:', error);
                setHistoryError(error instanceof Error ? error.message : 'Failed to load chat history');
                
                // Try to fall back to localStorage if DynamoDB fetch fails
                const { loadChatHistoryFromLocalStorage } = await import('./loadChatHistory');
                const localStorageHistory = loadChatHistoryFromLocalStorage();
                
                // Only update UI if we're on the history tab
                if (activeTab === 'history' && localStorageHistory.length > 0) {
                    setMessagePairs(localStorageHistory);
                }
            } finally {
                setHistoryLoading(false);
            }
        };
        
        fetchChatHistory();
    }, [activeTab]);
    
    // Function to refresh chat history
    const refreshChatHistory = async () => {
        if (activeTab === 'history') {
            setHistoryLoading(true);
            setHistoryError(null);
            
            try {
                // Use our enhanced chat history loader for refreshing too
                const { loadAndLogChatHistory } = await import('./loadChatHistory');
                const historyData = await loadAndLogChatHistory();
                setMessagePairs(historyData);
            } catch (error) {
                console.error('Error refreshing chat history:', error);
                setHistoryError(error instanceof Error ? error.message : 'Failed to refresh chat history');
                
                // Try fallback to localStorage here too
                const { loadChatHistoryFromLocalStorage } = await import('./loadChatHistory');
                const localStorageHistory = loadChatHistoryFromLocalStorage();
                if (localStorageHistory.length > 0) {
                    setMessagePairs(localStorageHistory);
                }
            } finally {
                setHistoryLoading(false);
            }
        }
    };
    
    // Use the chat history service to manage the history
    useEffect(() => {
        // Load chat history on component mount
        import('./loadChatHistory').then(({ loadChatHistoryFromLocalStorage }) => {
            const history = loadChatHistoryFromLocalStorage();
            if (history && history.length > 0) {
                setMessagePairs(history);
            }
        });
    }, []); // Empty dependency array means this runs once on component mount
    
    // Setup emergency message recovery (without session timeout manager)
    useEffect(() => {
        // Function to handle message recovery 
        const handleMessageRecovery = (id: string, content: string) => {
            setMessages(prevMessages =>
                prevMessages.map(msg =>
                    msg.id === id ? { ...msg, content } : msg
                )
            );
        };

        // Keyboard shortcut handler (Ctrl+Shift+R)
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
                e.preventDefault();
                
                console.log('🚑 Emergency message recovery requested (Ctrl+Shift+R)');
                addFlashbarItem('info', 'Attempting to recover any incomplete messages...');
                
                // Perform session recovery with current messages
                performSessionRecovery(messages, handleMessageRecovery);
                
                // Also ensure all trace data is marked complete
                setTraceState(prevState => {
                    const newState = JSON.parse(JSON.stringify(prevState));
                    newState.messages = newState.messages.map((msg: any) => {
                        if (msg.type === 'trace-group') {
                            return { ...msg, isComplete: true };
                        }
                        return msg;
                    });
                    return newState;
                });
            }
        };
        
        // Add event listeners
        window.addEventListener('keydown', handleKeyDown);
        
        // Remove on cleanup
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [messages, addFlashbarItem]);

    // State to manage the active tab
    const [activeTabId, setActiveTabId] = useState("chat");
    
    // Content for the Chat tab
    const chatContent = (
        <Grid
                gridDefinition={[
                    { colspan: { default: 12, xxs: showWorkflow ? 6 : 12 } },
                    { colspan: { default: 12, xxs: showWorkflow ? 6 : 0 } }
                ]}
            >
            {/* Chat Panel - Left Side */}

            <Box padding="s">
                <Container
                    header={
                        <Header 
                            variant="h2"
                            actions={
                                <StatusIndicator
                                    type={connectionStatus === "connected" ? "success" : "error"}
                                >
                                    {connectionStatus === "connected" ? "Connected" : "Disconnected"}
                                </StatusIndicator>
                            }
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <span>Chat</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <label style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '6px', 
                                        fontSize: '13px', 
                                        fontWeight: 500,
                                        padding: '5px 12px',
                                        color: showTrace ? '#1d4ed8' : '#475569',
                                        backgroundColor: showTrace ? '#ebf8ff' : '#f1f5f9',
                                        border: `1px solid ${showTrace ? '#4299e1' : '#e2e8f0'}`,
                                        borderRadius: '999px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}>
                                        <input 
                                            type="checkbox" 
                                            checked={showTrace} 
                                            onChange={(e) => setShowTrace(e.target.checked)}
                                            style={{ margin: 0 }}
                                        />
                                        {showTrace ? '👁️ Agent Traces' : '🔍 Show Agent Traces'}
                                    </label>
                                    <label style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '6px', 
                                        fontSize: '13px', 
                                        fontWeight: 500,
                                        padding: '5px 12px',
                                        color: showWorkflow ? '#0f766e' : '#475569',
                                        backgroundColor: showWorkflow ? '#e6fffa' : '#f1f5f9',
                                        border: `1px solid ${showWorkflow ? '#38b2ac' : '#e2e8f0'}`,
                                        borderRadius: '999px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}>
                                        <input 
                                            type="checkbox" 
                                            checked={showWorkflow} 
                                            onChange={(e) => setShowWorkflow(e.target.checked)}
                                            style={{ margin: 0 }}
                                        />
                                        {showWorkflow ? '📊 Workflow' : '📊 Show Workflow'}
                                    </label>
                                </div>
                            </div>
                        </Header>
                    }
                    disableContentPaddings
                    footer={
                        <SpaceBetween size="s">
                            {/* Sample Questions Section - spans full width at the bottom of the chat */}
                            <SampleQuestions onQuestionClick={handleQuickLinkClick} />
                            <PromptInput
                                ref={promptInputRef}
                                disabled={isLoading}
                                onFocus={handleInputFocus}
                                onChange={({ detail }) => {
                                    // First time user types, remove any final responses
                                    if (detail.value && !message) {
                                        // Remove any final response messages before user starts typing
                                        setMessages(prev => prev.filter(msg => 
                                            !(msg.type === "assistant" && 
                                            msg.id !== "1" &&
                                            typeof msg.content === 'string' &&
                                            isFinalResponseContent(msg.content))
                                        ));
                                    }
                                    
                                    setMessage(detail.value);
                                }}
                                onAction={() => {
                                    submitMessageForm();
                                }}
                                value={message}
                                actionButtonAriaLabel={
                                    isLoading ? "Send message button disabled" : "Send message"
                                }
                                actionButtonIconName="send"
                                ariaLabel={isLoading ? "Prompt input - suppressed" : "Prompt input"}
                                placeholder="Type your message here..."
                                autoFocus
                            />
                        </SpaceBetween>
                    }
                >
                    <div style={{ height: "clamp(240px, calc(100vh - 440px), 560px)" }}>
                        {activeTab === 'chat' ? (
                            <MemoizedScrollableContainer ref={messagesContainerRef}>
                                <SpaceBetween size="l">
                                    {/* Display the workflow image in the center on initial load 
                                        or when there are no messages */}
                                    {(isInitialLoad || messages.length <= 1) && (
                                        <div style={{ marginBottom: '20px' }}>
                                            <InitialWorkflowImage />
                                        </div>
                                    )}
                                    {/* All combined messages in reversed order (newest first) */}
                                    {[
                                        // User messages (always at the top)
                                        ...messages
                                            .filter(message => message.type === "user")
                                            .reverse() // Reverse the order to show newer messages first
                                            .map((message) => (
                                                <ChatBubble
                                                    key={message.id}
                                                    avatar={<ChatBubbleAvatar {...AUTHORS.user} />}
                                                    ariaLabel={`You at ${message.timestamp}`}
                                                    type="outgoing"
                                                >
                                                    <SpaceBetween size="xs">
                                                        <div>
                                                            <div dangerouslySetInnerHTML={{ __html: message.content as string }} />
                                                        </div>
                                                    </SpaceBetween>
                                                </ChatBubble>
                                            )),
                                        
                                        // Trace data section (appears between user message and assistant response)
                                        ...(showTrace && traceState.messages.length > 0 ? [
                                            <Box key="trace-section" padding="s" margin="m">
                                                <div style={{ borderTop: '1px solid var(--color-border-divider-default)' }}>
                                                    {/* Display trace groups in vertical layout instead of grid */}
                                                    <SpaceBetween size="m">
                                                    {traceState.messages
                                                        .filter((msg): msg is TraceGroupType => isTraceGroup(msg))  // Use our type guard with proper type assertion
                                                        // Hide governance nodes (guardrail/evaluation) from the chat
                                                        // dropdown list — they are surfaced in the workflow diagram
                                                        // (and still clickable there). Their trace data remains in
                                                        // trace state so the diagram node click can display it.
                                                        .filter((msg) => msg.agentId !== 'guardrail-node' && msg.agentId !== 'evaluation-node')
                                                        .sort((a, b) => {
                                                            const getAgentType = (msg: TraceGroupType) => {
                                                                // First check for routing classifier by different methods - highest priority
                                                                if (msg.originalAgentType === 'ROUTING_CLASSIFIER' || 
                                                                    (msg.agentName === 'ROUTING_CLASSIFIER') ||
                                                                    (msg._debug?.detectedType === 'ROUTING_CLASSIFIER')) {
                                                                    return 'ROUTING_CLASSIFIER';
                                                                }
                                                                
                                                                // Then check for Supervisor - second priority
                                                                if (msg.originalAgentType === 'Supervisor' || 
                                                                    (msg.agentName === 'Supervisor') || 
                                                                    (msg.collaborationConfig?.supervisorWithRouting) || 
                                                                    (msg._debug?.detectedType === 'Supervisor')) {
                                                                    return 'Supervisor';
                                                                }

                                                                // Unknown should be treated as Supervisor
                                                                if (msg.originalAgentType === 'Unknown') {
                                                                    return 'Supervisor';
                                                                }

                                                                // Then check the dropdown title
                                                                const titleParts = msg.dropdownTitle.split(' ');
                                                                if (titleParts[0] === 'ROUTING_CLASSIFIER' || 
                                                                    titleParts[0].toLowerCase().includes('routing')) {
                                                                    return 'ROUTING_CLASSIFIER';
                                                                }
                                                                
                                                                if (titleParts[0] === 'Supervisor' || 
                                                                    titleParts[0].toLowerCase().includes('supervisor')) {
                                                                    return 'Supervisor';
                                                                }
                                                                
                                                                if (titleParts[0] === 'Unknown') {
                                                                    // Put Unknown agent under Supervisor category
                                                                    return 'Supervisor';
                                                                }

                                                                // Extract agent base names without unique identifiers
                                                                return titleParts[0].split('-')[0];
                                                            };

                                                            const aType = getAgentType(a);
                                                            const bType = getAgentType(b);

                                                            // Define the strict order for trace groups - ensuring supervisor is first, routing classifier second
                                                            const agentOrder = [
                                                                'Supervisor',          // Always first
                                                                'ROUTING_CLASSIFIER',  // Always second
                                                                'Troubleshoot',
                                                                'Personalization',
                                                                'ProductRecommendation',
                                                                'OrderManagement'
                                                            ];
                                                            
                                                            // Get the index of each agent in the order array
                                                            const aIndex = agentOrder.indexOf(aType);
                                                            const bIndex = agentOrder.indexOf(bType);
                                                            
                                                            // Use the index for sorting (agents not in the list go to the end)
                                                            if (aIndex === -1 && bIndex === -1) return aType.localeCompare(bType);
                                                            if (aIndex === -1) return 1;
                                                            if (bIndex === -1) return -1;
                                                            return aIndex - bIndex;
                                                        })
                                                        .map((traceMsg: TraceGroupType) => (
                                                            <div
                                                                key={`trace-group-container-${traceMsg.id}`}
                                                            >
                                                                <TraceGroup
                                                                    key={`trace-group-${traceMsg.id}`}
                                                                    traceGroup={traceMsg}
                                                                />
                                                            </div>
                                                        ))
                                                    }
                                                    </SpaceBetween>
                                                </div>
                                            </Box>
                                        ] : []),
                                        
        // We'll display the ActivityStatusLoader next to the response symbol, not here
                                        
                                        // Assistant responses (excluding greeting)
                                        ...messages
                                            .filter(message => message.id !== "1" && message.type === "assistant")
                                            .map((message) => {
                                                // Check if this is a completed response or still in progress
                                                const isProcessing = message.id === currentResponseId && 
                                                                    (!message.content || message.content === '');
                                                
                                                // Only show spinner for empty messages that are still processing
                                                if (isProcessing) {
                                                    return (
                                                        <ChatBubble
                                                            key={message.id}
                                                            avatar={<ChatBubbleAvatar {...AUTHORS.assistant} />}
                                                            ariaLabel={`Assistant at ${message.timestamp}`}
                                                            type="incoming"
                                                        >
                                                            <Box color="text-status-inactive">
                                                                {/* Add the ActivityStatusLoader here to show the dynamic agent trace title */}
                                                                <ActivityStatusLoader
                                                                    key={`loading-indicator-${currentResponseId}`}
                                                                    traceState={traceState}
                                                                    isLoading={isLoading}
                                                                    responseId={currentResponseId}
                                                                />
                                                            </Box>
                                                        </ChatBubble>
                                                    );
                                                }
                                                
                                                // Only show messages with actual content
                                                if (message.content && message.content !== '') {
                                                    return (
                                                        <ChatBubble
                                                            key={message.id}
                                                            avatar={<ChatBubbleAvatar {...AUTHORS.assistant} />}
                                                            ariaLabel={`Assistant at ${message.timestamp}`}
                                                            type="incoming"
                                                        >
                                                            <SpaceBetween size="xs">
                                                                <div>
                                                                    {typeof message.content === 'string' ? (
                                                                        <div className="markdown-response">
                                                                <FinalMessageStreaming 
                                                                    content={message.content} 
                                                                    messageId={message.id}
                                                                    onAnimationStart={() => {
                                                                        // Enable Data tab when response begins rendering
                                                                        updateLoadingState(false);
                                                                    }}
                                                                    onAnimationComplete={(isDone) => {
                                                                                    if (isDone) {
                                                                                        console.log('🔓 Animation complete, ensuring input field is enabled');
                                                                                        
                                                                                        console.log('🧹 Animation complete, cleaning up all processes');
                                                                                        // Force mark all trace groups as complete to stop any background processes
                                                                                        setTraceState(prevState => {
                                                                                            // Create deep copy of state
                                                                                            const newState = JSON.parse(JSON.stringify(prevState));
                                                                                            
                                                                                            // Mark all trace groups as complete
                                                                                            newState.messages = newState.messages.map(msg => {
                                                                                                if (msg.type === 'trace-group') {
                                                                                                    return { ...msg, isComplete: true };
                                                                                                }
                                                                                                return msg;
                                                                                            });
                                                                                            
                                                                                            console.log('🛑 Marked all trace groups as complete to stop background processes');
                                                                                            return newState;
                                                                                        });
                                                                                        
                                                                                        // For final messages, ensure immediate completion
                                                                                        if (typeof message.content === 'string' && isFinalResponseContent(message.content)) {
                                                                                            console.log('⚡ Final message detected in animation completion, forcing immediate completion');
                                                                                            // Force clear any global timers/intervals with higher priority
                                                                                            document.dispatchEvent(new Event('stopAllTextAnimations'));
                                                                                            document.dispatchEvent(new CustomEvent('clearAllTimers'));
                                                                                            
                                                                                            // Reset the processing state to enable input field
                                                                                            resetProcessingState();
                                                                                            
                                                                                            // Enable input field immediately for final messages
                                                                                            updateLoadingState(false); // Use updateLoadingState to ensure Data tab is enabled
                                                                                            setCurrentResponseId(null);
                                                                                        } else {
                                                                                            // Force clear any global timers/intervals
                                                                                            document.dispatchEvent(new CustomEvent('clearAllTimers'));
                                                                                            
                                                                                            // Add a small timeout to ensure state updates propagate
                                                                                            setTimeout(() => {
                                                                                                // Enable input field
                                                                                                updateLoadingState(false); // Use updateLoadingState to ensure Data tab is enabled
                                                                                                setCurrentResponseId(null);
                                                                                            }, 50);
                                                                                        }
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        message.content
                                                                    )}
                                                                </div>
                                                            </SpaceBetween>
                                                        </ChatBubble>
                                                    );
                                                }
                                                
                                                return null;
                                            }),
                                            
                                        // Initial greeting (moves to the bottom since it's the oldest)
                                        ...messages
                                            .filter(message => message.id === "1" && message.type === "assistant")
                                            .map((message) => (
                                                <ChatBubble
                                                    key={message.id}
                                                    avatar={<ChatBubbleAvatar {...AUTHORS.assistant} />}
                                                    ariaLabel={`Assistant at ${message.timestamp}`}
                                                    type="incoming"
                                                >
                                                    <SpaceBetween size="xs">
                                                        <div>
                                                            {typeof message.content === 'string' && (
                                                                <FinalMessageStreaming 
                                                                    content={message.content}
                                                                    messageId={message.id} 
                                                                />
                                                            )}
                                                        </div>
                                                    </SpaceBetween>
                                                </ChatBubble>
                                            ))
                                    ]}
                                </SpaceBetween>
                            </MemoizedScrollableContainer>
                        ) : (
                            /* History Tab Content */
                            <MemoizedScrollableContainer>
                                <Box margin={{ top: 'l' }}>
                                    <SpaceBetween size="l">
                                        <Header variant="h3">Chat History</Header>
                                        {!memoryEnabled ? (
                                            /* History is backed by short-term memory: when the
                                               user turns STM off, grey it out and prompt them to
                                               re-enable it. */
                                            <div style={{ opacity: 0.55, pointerEvents: 'none', filter: 'grayscale(1)' }}>
                                                <Box padding="xl" textAlign="center">
                                                    <SpaceBetween size="s">
                                                        <Box variant="h4">History is unavailable</Box>
                                                        <Box variant="p" color="text-body-secondary">
                                                            Conversation history is powered by short-term memory,
                                                            which is currently turned off. Enable short-term memory
                                                            to view and keep your conversation history.
                                                        </Box>
                                                    </SpaceBetween>
                                                </Box>
                                            </div>
                                        ) : messagePairs.length > 0 ? (
                                            <SpaceBetween size="l">
                                                {[...messagePairs].reverse().map((pair, index) => (
                                                    <div key={`history-${index}`} 
                                                        style={{
                                                            padding: '16px',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            backgroundColor: '#f8fafc',
                                                            marginBottom: '16px'
                                                        }}>
                                                        <SpaceBetween size="m">
                                                            <div>
                                                                <Box variant="small" color="text-body-secondary" margin={{ bottom: 'xs' }}>
                                                                    {pair.date} at {pair.time}
                                                                </Box>
                                                                <ChatBubble
                                                                    avatar={<ChatBubbleAvatar {...AUTHORS.user} />}
                                                                    ariaLabel="You"
                                                                    type="outgoing"
                                                                >
                                                                    <div dangerouslySetInnerHTML={{ __html: pair.user.content as string }} />
                                                                </ChatBubble>
                                                            </div>
                                                            <ChatBubble
                                                                avatar={<ChatBubbleAvatar {...AUTHORS.assistant} />}
                                                                ariaLabel="Assistant"
                                                                type="incoming"
                                                            >
                                                                {typeof pair.assistant.content === 'string' && (
                                                                    <div>{pair.assistant.content}</div>
                                                                )}
                                                            </ChatBubble>
                                                        </SpaceBetween>
                                                    </div>
                                                ))}
                                            </SpaceBetween>
                                        ) : (
                                            <Box padding="m" textAlign="center">
                                                <SpaceBetween size="xs">
                                                    <Box variant="h4">No chat history yet</Box>
                                                    <Box variant="p">
                                                        Previous conversations will appear here
                                                    </Box>
                                                </SpaceBetween>
                                            </Box>
                                        )}
                                    </SpaceBetween>
                                </Box>
                            </MemoizedScrollableContainer>
                        )}
                    </div>
                </Container>
            </Box>

            {/* Agent Flow Panel - Right Side */}
            {showWorkflow && (
                <Box padding="s">
                    <Container
                        header={<Header variant="h2">Agentic Workflow</Header>}
                        disableContentPaddings={true}
                    >
                        <div style={{ height: "clamp(360px, calc(100vh - 300px), 620px)" }}>
                            <AgentFlowPanel 
                                height="100%" 
                                sessionId={sessionId} 
                                modelId={getModelId(selectedModel)} 
                            />
                        </div>
                    </Container>

                    {/* Demonstration disclaimer — placed under the workflow panel
                        to make use of the empty space in the right column. */}
                    <Box margin={{ top: 'm' }}>
                        <DemoDisclaimer />
                    </Box>
                </Box>
            )}
            </Grid>
    );
    
    return (
        <>
            {/* Chat content directly without tabs */}
            {chatContent}

            {/* Retractable Capabilities side panel (slides in from the left) */}
            <div
                aria-hidden={!showCapabilities}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    pointerEvents: showCapabilities ? 'auto' : 'none',
                }}
            >
                {/* Backdrop */}
                <div
                    onClick={() => setShowCapabilities(false)}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.35)',
                        opacity: showCapabilities ? 1 : 0,
                        transition: 'opacity 0.25s ease',
                    }}
                />
                {/* Sliding panel */}
                <div
                    role="dialog"
                    aria-label="Capabilities"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: '100%',
                        width: '440px',
                        maxWidth: '92vw',
                        backgroundColor: '#f8fafc',
                        boxShadow: '4px 0 24px rgba(15, 23, 42, 0.18)',
                        transform: showCapabilities ? 'translateX(0)' : 'translateX(-100%)',
                        transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '14px 16px',
                            borderBottom: '1px solid #e2e8f0',
                            position: 'sticky',
                            top: 0,
                            backgroundColor: '#f8fafc',
                            zIndex: 1,
                        }}
                    >
                        <span style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>
                            🧩 Capabilities
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowCapabilities(false)}
                            aria-label="Close capabilities panel"
                            style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: '18px',
                                lineHeight: 1,
                                color: '#64748b',
                                padding: '4px 8px',
                                borderRadius: '6px',
                            }}
                        >
                            ✕
                        </button>
                    </div>
                    <div style={{ padding: '12px' }}>
                        <CapabilitiesPanel
                            capabilities={deriveCapabilities(memoryEnabled)}
                            memoryEnabled={memoryEnabled}
                            onMemoryToggle={setMemoryEnabled}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chat;
