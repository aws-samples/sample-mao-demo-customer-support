/**
 * Consolidated Trace Types
 * 
 * This file centralizes all type definitions related to agent trace data.
 * It serves as the foundation for the trace system, providing type safety
 * and clear interfaces for all trace-related operations.
 */

import { ReactNode } from 'react';

// Core trace data types
export interface SubTask {
  title: string;
  content: string | object;
  fullJson: string | null;
  timestamp: number;
}

export interface Task {
  stepNumber: number;
  title: string;
  content?: string | object;
  fullJson?: string | null;
  timestamp: number;
  subTasks?: SubTask[];
  // Internal properties to track related tasks
  _groupId?: string;
  _parentTaskIndex?: number;
  _agentId?: string;  // Track which agent this task belongs to
  _modelInvocationId?: string;  // For identifying paired model input/output operations
  _sequenceNumber?: number;  // Track the chronological sequence of tasks regardless of stepNumber
  _isRoutingClassifierParent?: boolean;  // Marks a task as a routing classifier parent
  _finalResponseDispatched?: boolean; // Tracks if a final response has been dispatched for this task
}

export interface TraceGroup {
  id: string;
  type: 'trace-group';
  sender: 'bot';
  dropdownTitle: string;
  startTime: number;
  tasks: Task[];
  text: string;
  agentId: string; // Specific agent identifier for exact matching
  originalAgentType?: string; // Original agent type from the trace data
  orchestrationTraceType?: string; // Type of orchestration trace
  lastUpdateTime?: number; // Last time this trace group was updated
  isComplete?: boolean; // Whether this trace group has completed its work
  finalElapsedTime?: string; // Final elapsed time when trace is completed
  agentName?: string; // Agent name for routing classifier filtering
  hasFinalResponse?: boolean; // Generic flag for any agent with a final response
  isSupervisorFinalResponse?: boolean; // Whether this trace group contains a Supervisor final response
  finalResponseTimestamp?: number; // Timestamp when the final response was detected
  finalResponseContent?: string; // Content of the final response
  finalResponseProcessed?: boolean; // Whether the final response has been processed and displayed
  collaborationConfig?: { // Configuration for collaboration between agents
    supervisorWithRouting?: boolean;
    enabled?: boolean;
  };
  _debug?: { // Debug information for troubleshooting
    detectedType?: string;
    rawAgentId?: string;
    rawCollaborator?: string;
    rawAgentName?: string;
    [key: string]: any; // Allow any additional debug information
  };
}

// Storage types
export interface TraceGroupCacheEntry {
  traceGroup: TraceGroup;
  lastUpdated: number;
  isComplete?: boolean;
}

export interface AgentTraceCache {
  [nodeId: string]: {
    traces: {
      [traceId: string]: TraceGroupCacheEntry
    };
    lastUpdated: number;
    sessionId?: string;
  };
}

// Message types for UI display
export interface Message {
  id: string;
  type: string;
  content: ReactNode;
  timestamp: string;
  sortKey?: number;
}

// State for trace processing
export interface TraceState {
  messages: (Message | TraceGroup)[];
  currentTrace: string;
  currentSubTrace: string;
  traceStepCounter: { [key: string]: number };
}

// Agent type definitions
export enum AgentType {
  ROUTING_CLASSIFIER = 'ROUTING_CLASSIFIER',
  SUPERVISOR = 'Supervisor',
  PRODUCT_RECOMMENDATION = 'ProductRecommendation',
  TROUBLESHOOT = 'Troubleshoot',
  PERSONALIZATION = 'Personalization',
  ORDER_MANAGEMENT = 'OrderManagement'
}

// Type guards for runtime type checking

/**
 * Type guard to check if an object is a TraceGroup
 */
export const isTraceGroup = (msg: any): msg is TraceGroup => (
  msg?.type === 'trace-group' && 
  'tasks' in msg && 
  Array.isArray(msg.tasks) &&
  'dropdownTitle' in msg
);

/**
 * Trace event interfaces for custom events
 */
export interface TraceUpdatedEvent extends CustomEvent {
  detail: {
    nodeId: string;
    traceGroup: TraceGroup;
    timestamp: number;
    source: string;
    traceHash: string;
  };
}

export interface SupervisorFinalResponseEvent extends CustomEvent {
  detail: {
    content: string;
    traceId: string;
    timestamp: number;
    traceGroup: TraceGroup;
  };
}

// Result types for trace operations
export interface ExtractedTraceContent {
  displayContent: string | null;
  fullJsonContent: string | null;
}

// Config key types
export interface AgentConfigKeys {
  ROUTING_CLASSIFIER_AGENT_ID: string;
  ROUTING_CLASSIFIER_ALIAS_ID: string;
  SUPERVISOR_AGENT_ID: string;
  SUPERVISOR_ALIAS_ID: string;
  PRODUCT_RECOMMENDATION_AGENT_ID: string;
  PRODUCT_RECOMMENDATION_ALIAS_ID: string;
  PERSONALIZATION_AGENT_ID: string;
  PERSONALIZATION_ALIAS_ID: string;
  TROUBLESHOOT_AGENT_ID: string;
  TROUBLESHOOT_ALIAS_ID: string;
  ORDER_MANAGEMENT_AGENT_ID: string;
  ORDER_MANAGEMENT_ALIAS_ID: string;
}

// Common agent types
export const AGENT_TYPES = {
  ROUTING_CLASSIFIER: 'ROUTING_CLASSIFIER',
  SUPERVISOR: 'Supervisor',
  PRODUCT_RECOMMENDATION: 'ProductRecommendation',
  TROUBLESHOOT: 'Troubleshoot',
  PERSONALIZATION: 'Personalization',
  ORDER_MANAGEMENT: 'OrderManagement'
} as const;

// Extended window interface
export interface ExtendedWindow extends Window {
  __agentTraceCache?: AgentTraceCache;
  __lastTraceEventHash?: string;
  __traceCleanupTimerActive?: boolean;
  __traceCleanupTimer?: ReturnType<typeof setInterval>;
  __traceIdleCleanupTimer?: ReturnType<typeof setInterval>;
  __currentSessionId?: string;
  __traceDebugMode?: boolean;
  __traceDebug?: Record<string, any>;
}
