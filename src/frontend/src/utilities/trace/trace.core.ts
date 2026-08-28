/**
 * Trace Core
 * 
 * This module provides the main API for the trace system.
 * It serves as the central point for other components to interact with trace data.
 */

import { TraceGroup, TraceState } from './trace.types';
import * as TraceParser from './trace.parser';
import * as TraceStorage from './trace.storage';
import * as TraceUtils from './trace.utils';

/**
 * Initialize the trace system
 * This should be called when the application starts
 */
export function initTraceSystem(): void {
  TraceStorage.initTraceStorage();
}

/**
 * Process an incoming trace message
 * @param message The message containing trace data
 * @param state The current trace state
 * @param callback Callback function to update state
 */
export function processTraceMessage(
  message: { type: string; content: any },
  state: TraceState,
  callback: (state: TraceState) => TraceState
): void {
  TraceParser.handleTraceMessage(message, state, callback);
}

/**
 * Store a trace group for an agent node
 * @param nodeId The ID of the agent node
 * @param traceGroup The trace group to store
 * @param sessionId Optional session ID
 * @param preserveExistingTraces Whether to preserve existing traces
 */
export function storeAgentTrace(
  nodeId: string, 
  traceGroup: TraceGroup, 
  sessionId?: string,
  preserveExistingTraces?: boolean
): void {
  TraceStorage.storeTraceGroup(nodeId, traceGroup, sessionId, preserveExistingTraces);
  
  // Dispatch update event
  dispatchTraceUpdatedEvent(nodeId, traceGroup);
}

/**
 * Get a trace group for an agent node
 * @param nodeId The ID of the agent node
 * @param traceId Optional specific trace ID
 * @param strictOwnership Whether to enforce ownership validation
 * @returns The trace group or null if not found
 */
export function getAgentTrace(
  nodeId: string,
  traceId?: string,
  strictOwnership?: boolean
): TraceGroup | null {
  return TraceStorage.getTraceGroup(nodeId, traceId, strictOwnership);
}

/**
 * Get all traces for an agent node
 * @param nodeId The ID of the agent node
 * @returns Array of trace groups
 */
export function getAllNodeTraces(nodeId: string): TraceGroup[] {
  return TraceStorage.getAllNodeTraces(nodeId);
}

/**
 * Get all stored agent traces
 * @returns Object mapping node IDs to trace groups
 */
export function getAllAgentTraces(): Record<string, TraceGroup[]> {
  return TraceStorage.getAllAgentTraces();
}

/**
 * Clear trace data for an agent node
 * @param nodeId The ID of the agent node
 */
export function clearAgentTrace(nodeId: string): void {
  TraceStorage.clearAgentTrace(nodeId);
}

/**
 * Clear all stored agent traces
 * @param sessionId Optional session ID to only clear specific session
 */
export function clearAllAgentTraces(sessionId?: string): void {
  TraceStorage.clearAllAgentTraces(sessionId);
}

/**
 * Clean up old trace data
 * This can be called periodically to prevent storage issues
 */
export function cleanupOldTraces(): void {
  TraceStorage.cleanupOldTraces();
}

/**
 * Clean up all trace data except for the current session
 */
export function cleanupAllButCurrentSession(): void {
  TraceStorage.cleanupAllButCurrentSession();
}

/**
 * Prepare a trace group for display
 * @param traceGroup The trace group to prepare
 * @returns Normalized trace group ready for display
 */
export function prepareTraceGroupForDisplay(traceGroup: TraceGroup): TraceGroup {
  return TraceUtils.normalizeTraceGroup(traceGroup);
}

/**
 * Generate a trace hash to prevent duplicate updates
 * @param nodeId The node ID
 * @param traceGroupId The trace group ID
 * @param timestamp The timestamp
 * @returns A unique hash string
 */
export function generateTraceHash(nodeId: string, traceGroupId: string, timestamp: number): string {
  return TraceUtils.generateTraceHash(nodeId, traceGroupId, timestamp);
}

/**
 * Dispatch a trace updated event
 * @param nodeId The node ID
 * @param traceGroup The updated trace group
 */
function dispatchTraceUpdatedEvent(nodeId: string, traceGroup: TraceGroup): void {
  // Use a hash to identify this exact trace data to prevent redundant events
  const traceHash = generateTraceHash(nodeId, traceGroup.id, traceGroup.lastUpdateTime || Date.now());
  
  // Check if we've already dispatched an event for this exact trace state
  if (!window.__lastTraceEventHash || window.__lastTraceEventHash !== traceHash) {
    window.__lastTraceEventHash = traceHash;
    
    // Only log for significant events, not routine updates
    if (traceGroup.isComplete) {
      console.log(`✅ Stored final trace data for agent node ${nodeId}`);
    }
    
    // Dispatch an event to notify components that trace data has been updated
    const traceUpdateEvent = new CustomEvent('agentTraceUpdated', {
      detail: {
        nodeId,
        traceGroup,
        timestamp: Date.now(),
        source: 'core',
        traceHash
      }
    });
    
    // Use requestAnimationFrame to prevent rapid redundant updates
    window.requestAnimationFrame(() => {
      document.dispatchEvent(traceUpdateEvent);
    });
  }
}

/**
 * Set the current session ID
 * @param sessionId The session ID to set
 */
export function setCurrentSessionId(sessionId: string): void {
  window.__currentSessionId = sessionId;
}

/**
 * Get the current session ID
 * @returns The current session ID or undefined
 */
export function getCurrentSessionId(): string | undefined {
  return window.__currentSessionId;
}

// Re-export key utility functions for convenience
export { 
  collaboratorToNodeId,
  validateTraceOwnership,
  formatResultSetData,
  parseTraceJson
} from './trace.utils';

// Re-export parser functions for convenience
export {
  getAgentTypeFromTrace,
  extractTraceContent
} from './trace.parser';
