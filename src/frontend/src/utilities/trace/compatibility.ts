/**
 * Trace System Compatibility Layer
 * 
 * This module provides compatibility with the old trace system APIs.
 * It re-exports functions from the new trace system with the same signatures
 * to ensure existing code continues to work while migration is in progress.
 */

// Import from the new trace system
import * as TraceSystem from './index';

// Re-export core functionality
export const storeAgentTrace = TraceSystem.storeAgentTrace;
export const getAgentTrace = TraceSystem.getAgentTrace;
export const getAllNodeTraces = TraceSystem.getAllNodeTraces;
export const clearAgentTrace = TraceSystem.clearAgentTrace;
export const clearAllAgentTraces = TraceSystem.clearAllAgentTraces;

// Re-export trace message handling
export const handleTraceMessage = TraceSystem.processTraceMessage;

// Re-export trace parsing
export const parseTraceJson = TraceSystem.parseTraceJson;
export const getAgentTypeFromTrace = TraceSystem.getAgentTypeFromTrace;
export const extractTraceContent = TraceSystem.extractTraceContent;

// Re-export utility functions
export const collaboratorToNodeId = TraceSystem.collaboratorToNodeId;
export const validateTraceOwnership = TraceSystem.validateTraceOwnership;
export const formatResultSetData = TraceSystem.formatResultSetData;
export const findTraceGroupByAgentId = TraceSystem.findTraceGroupByAgentId;
export const getTraceGroupStartTime = TraceSystem.getTraceGroupStartTime;
export const getSafeTraceGroups = TraceSystem.getSafeTraceGroups;
export const getNewestTraceGroup = TraceSystem.getNewestTraceGroup;

// Re-export types
export type { 
  TraceGroup, 
  TraceState, 
  Task, 
  SubTask,
  ExtractedTraceContent,
  Message
} from './trace.types';

// Re-export the isTraceGroup type guard
export { isTraceGroup } from './trace.types';

// Helper function for legacy code that might expect to parse attributes as numbers
export const parseAttributeAsNumber = (value: string | number | null | undefined, defaultValue: number = 0): number => {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  
  if (typeof value === 'number') {
    return value;
  }
  
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * Logs a deprecated API usage warning
 * @param oldApi The old API name
 * @param newApi The recommended new API name
 */
const logDeprecationWarning = (oldApi: string, newApi: string): void => {
  console.warn(
    `Deprecation warning: '${oldApi}' is deprecated and will be removed in a future version. ` +
    `Use '${newApi}' from '../utilities/trace' instead.`
  );
};

/**
 * Setup deprecation warnings to encourage migration
 */
export const setupDeprecationWarnings = (): void => {
  const apis = [
    { old: 'storeAgentTrace', new: 'storeAgentTrace' },
    { old: 'getAgentTrace', new: 'getAgentTrace' },
    { old: 'handleTraceMessage', new: 'processTraceMessage' },
    { old: 'parseTraceJson', new: 'parseTraceJson' },
    { old: 'collaboratorToNodeId', new: 'collaboratorToNodeId' },
    { old: 'clearAllAgentTraces', new: 'clearAllAgentTraces' },
    { old: 'findTraceGroupByAgentId', new: 'findTraceGroupByAgentId' },
    { old: 'getTraceGroupStartTime', new: 'getTraceGroupStartTime' },
    { old: 'getSafeTraceGroups', new: 'getSafeTraceGroups' }
  ];

  // Log warnings when importing from this file
  console.warn(
    'You are using the trace compatibility layer. ' +
    'Please migrate to the new trace system by importing from "../utilities/trace" instead.'
  );
  
  // Log specific API warnings
  apis.forEach(({ old, new: newApi }) => {
    logDeprecationWarning(old, newApi);
  });
};

// Automatically log deprecation warnings when this module is imported
// Uncomment this when ready to notify developers about the migration
// setupDeprecationWarnings();
