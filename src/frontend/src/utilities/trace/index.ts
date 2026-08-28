/**
 * Trace System - Main Entry Point
 * 
 * This file re-exports all the trace modules for easier access.
 * Import from this file to get access to the full trace system API.
 */

// Re-export types
export * from './trace.types';

// Re-export from utilities - specify exports to avoid conflicts
export { 
  getSafeTraceGroups,
  findTraceGroupByAgentId,
  getTraceGroupStartTime,
  getNewestTraceGroup,
  normalizeTraceGroup,
  addSubTask,
  collaboratorToNodeId,
  validateTraceOwnership,
  formatResultSetData,
  parseTraceJson
} from './trace.utils';

// Use the utils implementation of generateTraceHash
export { generateTraceHash } from './trace.utils';

// Re-export parser functions
export * from './trace.parser';

// Re-export core API except for functions with name conflicts
export {
  initTraceSystem,
  processTraceMessage,
  storeAgentTrace,
  getAgentTrace,
  getAllNodeTraces,
  getAllAgentTraces,
  clearAgentTrace,
  clearAllAgentTraces,
  cleanupOldTraces,
  cleanupAllButCurrentSession,
  prepareTraceGroupForDisplay,
  setCurrentSessionId,
  getCurrentSessionId
} from './trace.core';

// Import initialization functions
import { initTraceSystem } from './trace.core';
import { initGlobalTraceDebugHelpers } from './trace.debug';

// Export debug utilities but mark them as debug-only
export * from './trace.debug';

/**
 * Initialize the entire trace system
 * This should be called when the application starts
 * @param enableDebug Whether to enable debug helpers
 */
export function initTrace(enableDebug = false): void {
  // Initialize the core trace system
  initTraceSystem();
  
  // Conditionally initialize debug helpers
  if (enableDebug || process.env.NODE_ENV === 'development') {
    initGlobalTraceDebugHelpers();
  }
}

// Export a default object for direct imports
export default {
  init: initTrace,
  // Core API
  initTraceSystem,
  // Debug API
  initGlobalTraceDebugHelpers
};
