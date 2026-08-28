/**
 * Trace Storage
 * 
 * This module manages the persistent storage of agent trace data
 * and provides methods to access and update it.
 */

import { TraceGroup, AgentTraceCache, ExtendedWindow, TraceGroupCacheEntry } from './trace.types';
import { validateTraceOwnership } from './trace.utils';

// Extend the window object to include our global cache
declare const window: ExtendedWindow;

// Storage constants
const TRACE_STORAGE_KEY = 'agent-trace-cache';
const SESSION_TRACE_KEY = 'current-session-traces';

// Constants for storage management
const MAX_TRACE_AGE_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const IDLE_CLEANUP_THRESHOLD_MS = 30 * 1000; // 30 seconds
const ESTIMATED_MAX_STORAGE_BYTES = 4 * 1024 * 1024; // ~4MB safe limit
const CLEANUP_QUOTA_THRESHOLD = 0.8; // Clean when at 80% of quota
const MAX_TRACES_PER_NODE = 5; // Maximum traces to keep per node

// Track cleanup state
let lastCleanupTime = 0;
let cleanupInProgress = false;

// Counter for storage errors to implement circuit breaker pattern
let storageErrorCount = 0;
const MAX_STORAGE_ERRORS = 3;

/**
 * Initialize the agent trace storage
 * Clears existing data on page load/reload
 */
export function initTraceStorage(): void {
  // Clear all existing storage on page load/reload to prevent stale data
  localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify({}));
  sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify({}));
  
  // Reset the in-memory cache
  window.__agentTraceCache = {};
  
  // Initialize cleanup timers
  setupPeriodicCleanup();
  
  console.log('🧹 Agent trace storage cleared on page load/reload');
}

/**
 * Set up periodic cleanup of trace data to prevent quota issues
 */
function setupPeriodicCleanup(): void {
  // Don't set up multiple cleanup timers
  if (window.__traceCleanupTimerActive) {
    return;
  }

  // Set a cleanup timer that runs periodically
  const timer = setInterval(() => {
    // Only run cleanup if not already in progress
    if (!cleanupInProgress) {
      cleanupOldTraces();
    }
  }, CLEANUP_INTERVAL_MS);
  
  // Mark cleanup as active and store timer reference for cleanup
  window.__traceCleanupTimerActive = true;
  window.__traceCleanupTimer = timer;
  
  // Clean up the timer when the window is closed/refreshed
  window.addEventListener('beforeunload', () => {
    if (window.__traceCleanupTimer) {
      clearInterval(window.__traceCleanupTimer);
      window.__traceCleanupTimerActive = false;
    }
  });

  // Also set up idle time detection for cleanup
  setupIdleCleanup();
}

/**
 * Set up cleanup during user idle time
 */
function setupIdleCleanup(): void {
  // Track user activity
  let lastActivityTime = Date.now();
  const trackActivity = () => {
    lastActivityTime = Date.now();
  };
  
  // Add basic activity listeners
  ['mousemove', 'keypress', 'scroll', 'click'].forEach(eventName => {
    window.addEventListener(eventName, trackActivity, { passive: true });
  });
  
  // Check for idle state periodically
  const idleTimer = setInterval(() => {
    const idleTime = Date.now() - lastActivityTime;
    if (idleTime > IDLE_CLEANUP_THRESHOLD_MS && !cleanupInProgress) {
      // User is idle - good time to clean up
      console.log(`🕒 User idle for ${Math.round(idleTime/1000)}s - running cleanup`);
      cleanupAllButCurrentSession();
    }
  }, IDLE_CLEANUP_THRESHOLD_MS);
  
  // Store timer reference for cleanup
  window.__traceIdleCleanupTimer = idleTimer;
  
  // Clean up the timer when the window is closed/refreshed
  window.addEventListener('beforeunload', () => {
    if (window.__traceIdleCleanupTimer) {
      clearInterval(window.__traceIdleCleanupTimer);
    }
  });
}

/**
 * Clean up old trace data to prevent quota issues
 * Removes trace data older than MAX_TRACE_AGE_MS
 */
export function cleanupOldTraces(): void {
  // Set flag to prevent recursive calls
  cleanupInProgress = true;
  const now = Date.now();
  
  // Don't clean up too frequently
  if (now - lastCleanupTime < 15000) { // 15 seconds minimum between cleanups
    cleanupInProgress = false;
    return;
  }
  
  console.log('🧹 Running trace cleanup for old traces');
  
  try {
    // Clean up localStorage
    const cachedData = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    let modified = false;
    const cutoffTime = now - MAX_TRACE_AGE_MS;
    
    // Check each node
    Object.keys(cachedData).forEach(nodeId => {
      if (cachedData[nodeId] && cachedData[nodeId].traces) {
        const traces = cachedData[nodeId].traces;
        const traceIds = Object.keys(traces);
        
        // Filter out old traces
        const oldTraceIds = traceIds.filter(id => traces[id].lastUpdated < cutoffTime);
        if (oldTraceIds.length > 0) {
          oldTraceIds.forEach(id => {
            delete traces[id];
            modified = true;
          });
          
          console.log(`🗑️ Removed ${oldTraceIds.length} old traces for ${nodeId}`);
        }
      }
    });
    
    // Save changes if any were made
    if (modified) {
      localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(cachedData));
    }
    
    // Also clean up session storage
    const sessionData = JSON.parse(sessionStorage.getItem(SESSION_TRACE_KEY) || '{}');
    modified = false;
    
    // Remove old sessions and traces
    Object.keys(sessionData).forEach(sessionId => {
      const session = sessionData[sessionId];
      let sessionModified = false;
      
      // Check each node in this session
      Object.keys(session).forEach(nodeId => {
        if (session[nodeId] && session[nodeId].traces) {
          const traces = session[nodeId].traces;
          const traceIds = Object.keys(traces);
          
          // Filter out old traces
          const oldTraceIds = traceIds.filter(id => traces[id].lastUpdated < cutoffTime);
          if (oldTraceIds.length > 0) {
            oldTraceIds.forEach(id => {
              delete traces[id];
              modified = true;
              sessionModified = true;
            });
          }
        }
      });
      
      // If the session now has no traces, remove it entirely
      if (sessionModified) {
        let hasTraces = false;
        Object.keys(session).forEach(nodeId => {
          if (session[nodeId]?.traces && Object.keys(session[nodeId].traces).length > 0) {
            hasTraces = true;
          }
        });
        
        if (!hasTraces) {
          delete sessionData[sessionId];
          console.log(`🗑️ Removed empty session ${sessionId}`);
          modified = true;
        }
      }
    });
    
    // Save changes if any were made
    if (modified) {
      sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(sessionData));
    }
    
    // Update memory cache to match localStorage
    window.__agentTraceCache = cachedData;
    
  } catch (error) {
    console.error('Error during trace cleanup:', error);
  }
  
  // Update last cleanup time
  lastCleanupTime = now;
  cleanupInProgress = false;
}

/**
 * Clean up all trace data except for the current session
 * This is used to clean up traces after sending a message
 */
export function cleanupAllButCurrentSession(): void {
  // Set flag to prevent recursive calls
  cleanupInProgress = true;
  console.log('🧹 Running cleanup - preserving only current session data');
  
  try {
    // Get current session ID
    const currentSessionId = window.__currentSessionId;
    if (!currentSessionId) {
      console.log('No current session ID found - skipping cleanup');
      cleanupInProgress = false;
      return;
    }
    
    // Clean localStorage - keep only traces from current session
    const cachedData = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    const nodesToKeep: AgentTraceCache = {};
    
    // Only keep nodes from the current session
    Object.keys(cachedData).forEach(nodeId => {
      if (cachedData[nodeId].sessionId === currentSessionId) {
        nodesToKeep[nodeId] = cachedData[nodeId];
      }
    });
    
    // Save reduced data
    localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(nodesToKeep));
    
    // Clean sessionStorage - keep only current session
    const sessionData = JSON.parse(sessionStorage.getItem(SESSION_TRACE_KEY) || '{}');
    if (sessionData[currentSessionId]) {
      const reducedSessionData = { [currentSessionId]: sessionData[currentSessionId] };
      sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(reducedSessionData));
    }
    
    // Update in-memory cache to match localStorage
    window.__agentTraceCache = nodesToKeep;
    
    // Log cleanup stats
    const originalNodeCount = Object.keys(cachedData).length;
    const keptNodeCount = Object.keys(nodesToKeep).length;
    console.log(`🗑️ Cleaned up ${originalNodeCount - keptNodeCount} nodes, keeping ${keptNodeCount} from current session`);
  } catch (error) {
    console.error('Error during session cleanup:', error);
  }
  
  // Update last cleanup time and reset flag
  lastCleanupTime = Date.now();
  cleanupInProgress = false;
}

/**
 * Function to optimize trace data by removing redundant information
 * to reduce storage size
 * 
 * @param traceGroup The trace group to optimize
 * @returns Optimized trace group with reduced size
 */
function optimizeTraceData(traceGroup: TraceGroup): TraceGroup {
  // Create a deep copy to avoid modifying the original
  const optimizedTrace = JSON.parse(JSON.stringify(traceGroup)) as TraceGroup;
  
  // Remove redundant fullJson content which often contains duplicate data
  if (optimizedTrace.tasks && Array.isArray(optimizedTrace.tasks)) {
    optimizedTrace.tasks.forEach(task => {
      // Remove fullJson to reduce storage size
      if (task.fullJson) {
        task.fullJson = null;
      }
      
      // Handle subtasks
      if (task.subTasks && Array.isArray(task.subTasks)) {
        task.subTasks.forEach(subtask => {
          if (subtask.fullJson) {
            subtask.fullJson = null;
          }
        });
      }
    });
  }
  
  return optimizedTrace;
}

/**
 * Prunes trace storage to keep only recent traces and reduce storage size
 * 
 * @param existingData Current trace cache data
 * @returns Pruned trace cache data
 */
function pruneTraceStorage(existingData: AgentTraceCache): AgentTraceCache {
  try {
    const nodeIds = Object.keys(existingData);
    
    // Keep only the MAX_TRACES_PER_NODE most recent traces per node
    nodeIds.forEach(nodeId => {
      if (existingData[nodeId] && existingData[nodeId].traces) {
        const traces = existingData[nodeId].traces;
        const traceIds = Object.keys(traces);
        
        // If we have more than the max number of traces, sort by lastUpdated and keep only the most recent
        if (traceIds.length > MAX_TRACES_PER_NODE) {
          const sortedTraceIds = traceIds.sort((a, b) => {
            return traces[b].lastUpdated - traces[a].lastUpdated;
          });
          
          // Keep only the most recent traces
          const traceIdsToKeep = sortedTraceIds.slice(0, MAX_TRACES_PER_NODE);
          
          // Create new traces object with only the traces to keep
          const prunedTraces: Record<string, TraceGroupCacheEntry> = {};
          traceIdsToKeep.forEach(id => {
            prunedTraces[id] = traces[id];
          });
          
          // Replace with pruned traces
          existingData[nodeId].traces = prunedTraces;
          console.log(`📦 Pruned traces for ${nodeId}: kept ${traceIdsToKeep.length} of ${traceIds.length} traces`);
        }
      }
    });
    
    return existingData;
  } catch (error) {
    console.warn('Error pruning trace storage:', error);
    // Return original data on error - this is a best-effort operation
    return existingData;
  }
}

/**
 * Store trace data for an agent node
 * 
 * @param nodeId The ID of the agent node
 * @param traceGroup The trace group data to store
 * @param sessionId Optional session ID to associate with this trace
 * @param preserveExistingTraces Whether to preserve other traces for this node (default: true for browser node, false otherwise)
 */
export function storeTraceGroup(
  nodeId: string, 
  traceGroup: TraceGroup, 
  sessionId?: string,
  preserveExistingTraces?: boolean
): void {
  try {
    // Special handling for browser node - always preserve its traces
    const shouldPreserveTraces = preserveExistingTraces !== undefined ? 
      preserveExistingTraces : (nodeId === 'customer');
      
    // Update the in-memory cache first
    if (!window.__agentTraceCache) {
      window.__agentTraceCache = {};
    }

    // Initialize the node entry if it doesn't exist
    if (!window.__agentTraceCache[nodeId]) {
      window.__agentTraceCache[nodeId] = {
        traces: {},
        lastUpdated: Date.now()
      };
    }

    // Optimize trace data before storing to reduce size
    const optimizedTraceGroup = optimizeTraceData(traceGroup);

    // Add to the in-memory cache
    window.__agentTraceCache[nodeId].traces[traceGroup.id] = {
      traceGroup: optimizedTraceGroup,
      lastUpdated: Date.now()
    };
    window.__agentTraceCache[nodeId].lastUpdated = Date.now();

    // Also update local storage for persistence across page reloads
    let existingData: AgentTraceCache = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    
    // Check if this trace is marked as complete to stop continuous processing
    if (traceGroup.isComplete) {
      console.log(`🛑 Storing completed trace for agent ${nodeId} - stopping further processing`);
    }
    
    // Initialize the node entry in local storage if it doesn't exist
    if (!existingData[nodeId] || !shouldPreserveTraces) {
      existingData[nodeId] = {
        traces: {},
        lastUpdated: Date.now(),
        sessionId
      };
    }
    
    // Add the optimized trace group
    existingData[nodeId].traces[traceGroup.id] = {
      traceGroup: optimizedTraceGroup,
      lastUpdated: Date.now(),
      isComplete: optimizedTraceGroup.isComplete || false
    };
    
    // Prune storage to keep only recent traces
    existingData = pruneTraceStorage(existingData);
    
    try {
      // Attempt to save to localStorage
      localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(existingData));
      // Reset error count on success
      storageErrorCount = 0;
    } catch (storageError) {
      storageErrorCount++;
      console.error(`Error storing agent trace data (${storageErrorCount}/${MAX_STORAGE_ERRORS}):`, storageError);
      
      if (storageErrorCount >= MAX_STORAGE_ERRORS) {
        // Attempt emergency cleanup
        try {
          // Keep only the essential data - clear everything else
          const emergencyData: AgentTraceCache = {};
          
          // Only keep current node data
          if (existingData[nodeId]) {
            emergencyData[nodeId] = {
              traces: {},
              lastUpdated: Date.now()
            };
            
            // Just keep this single trace
            emergencyData[nodeId].traces[traceGroup.id] = {
              traceGroup: optimizedTraceGroup,
              lastUpdated: Date.now()
            };
          }
          
          localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(emergencyData));
          console.log('🚨 Emergency storage cleanup performed - deleted all but current trace');
        } catch (emergencyError) {
          // If that fails too, try wiping clean
          localStorage.removeItem(TRACE_STORAGE_KEY);
          console.error('‼️ Storage completely cleared due to persistent errors');
        }
      }
    }

    // For the current session, also store in sessionStorage
    if (sessionId) {
      const sessionData = JSON.parse(sessionStorage.getItem(SESSION_TRACE_KEY) || '{}');
      if (!sessionData[sessionId]) {
        sessionData[sessionId] = {};
      }
      
      // Initialize node entry if it doesn't exist
      if (!sessionData[sessionId][nodeId] || !shouldPreserveTraces) {
        sessionData[sessionId][nodeId] = {
          traces: {},
          lastUpdated: Date.now()
        };
      }
      
      // Add the optimized trace
      sessionData[sessionId][nodeId].traces[traceGroup.id] = {
        traceGroup: optimizedTraceGroup,
        lastUpdated: Date.now()
      };
      
      // Session storage is typically smaller than local storage
      // We should prune this too to prevent issues
      if (sessionData[sessionId][nodeId].traces) {
        const traceIds = Object.keys(sessionData[sessionId][nodeId].traces);
        if (traceIds.length > MAX_TRACES_PER_NODE) {
          const sortedTraceIds = traceIds.sort((a, b) => {
            const aData = sessionData[sessionId][nodeId].traces[a];
            const bData = sessionData[sessionId][nodeId].traces[b];
            return bData.lastUpdated - aData.lastUpdated;
          });
          
          // Keep only the most recent traces
          const prunedTraces: Record<string, TraceGroupCacheEntry> = {};
          sortedTraceIds.slice(0, MAX_TRACES_PER_NODE).forEach(id => {
            prunedTraces[id] = sessionData[sessionId][nodeId].traces[id];
          });
          
          sessionData[sessionId][nodeId].traces = prunedTraces;
        }
      }
      
      try {
        sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(sessionData));
      } catch (sessionError) {
        console.warn('Session storage error, clearing older session data:', sessionError);
        
        // If this fails, just clear all session data
        try {
          // Keep only current session
          const reducedSessionData = { [sessionId]: sessionData[sessionId] };
          sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(reducedSessionData));
        } catch (e) {
          // If that still fails, clear everything
          sessionStorage.removeItem(SESSION_TRACE_KEY);
        }
      }
    }
  } catch (error) {
    console.error('Error storing agent trace data:', error);
  }
}

/**
 * Get trace data for an agent node
 * 
 * @param nodeId The ID of the agent node
 * @param traceId Optional specific trace ID to retrieve (if not provided, returns most recent)
 * @param strictOwnership Whether to strictly enforce trace ownership validation (default: true)
 * @returns The stored trace group data, or null if not found
 */
export function getTraceGroup(
  nodeId: string,
  traceId?: string,
  strictOwnership = true
): TraceGroup | null {
  try {
    // First check the in-memory cache for the most up-to-date data
    if (window.__agentTraceCache && window.__agentTraceCache[nodeId]) {
      const nodeData = window.__agentTraceCache[nodeId];
      
      // If a specific traceId is requested, return that trace
      if (traceId && nodeData.traces[traceId]) {
        const traceGroup = nodeData.traces[traceId].traceGroup;
        
        // Validate that this trace belongs to this node
        if (strictOwnership && !validateTraceOwnership(nodeId, traceGroup)) {
          console.warn(`Requested trace ${traceId} doesn't belong to node ${nodeId}`);
          return null;
        }
        
        return traceGroup;
      }
      
      // Otherwise, find the most recent trace
      const traceEntries = Object.entries(nodeData.traces);
      if (traceEntries.length === 0) return null;
      
      // Sort by lastUpdated timestamp (most recent first)
      traceEntries.sort((a, b) => {
        const aData = a[1] as TraceGroupCacheEntry;
        const bData = b[1] as TraceGroupCacheEntry;
        return bData.lastUpdated - aData.lastUpdated;
      });
      
      // For browser node, try to find a user message trace first
      if (nodeId === 'customer') {
        // Look for a trace with "User Message" in the dropdownTitle
        const userMessageTrace = traceEntries.find(([_, data]) => {
          const traceData = data as TraceGroupCacheEntry;
          return traceData.traceGroup.dropdownTitle?.includes('User Message');
        });
        
        // If found, return that
        if (userMessageTrace) {
          const traceData = userMessageTrace[1] as TraceGroupCacheEntry;
          
          // No need to validate browser traces - they're special
          return traceData.traceGroup;
        }
      }
      
      // Filter traces by ownership if strict mode is enabled
      let validTraceEntries = traceEntries;
      if (strictOwnership) {
        validTraceEntries = traceEntries.filter(([_, data]) => {
          const traceData = data as TraceGroupCacheEntry;
          return validateTraceOwnership(nodeId, traceData.traceGroup);
        });
        
        // If we filtered out all traces, fall back to using any traces only if we're in a special case
        if (validTraceEntries.length === 0) {
          if (nodeId === 'customer' || nodeId === 'supervisor-agent') {
            // For these special nodes, we can be less strict
            validTraceEntries = traceEntries;
          } else {
            // For other nodes, respect the strict ownership
            return null;
          }
        }
      }
      
      // If we have valid traces, return the most recent one
      if (validTraceEntries.length > 0) {
        const mostRecentData = validTraceEntries[0][1] as TraceGroupCacheEntry;
        return mostRecentData.traceGroup;
      }
      
      return null;
    }

    // Then check local storage
    const cachedData: AgentTraceCache = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    if (cachedData[nodeId]) {
      // If found in local storage but not in memory, update the memory cache
      if (!window.__agentTraceCache) {
        window.__agentTraceCache = {};
      }
      
      window.__agentTraceCache[nodeId] = cachedData[nodeId];
      
      // Similar logic as above for local storage data
      if (traceId && cachedData[nodeId].traces && cachedData[nodeId].traces[traceId]) {
        const traceGroup = cachedData[nodeId].traces[traceId].traceGroup;
        
        // Validate that this trace belongs to this node
        if (strictOwnership && !validateTraceOwnership(nodeId, traceGroup)) {
          console.warn(`Requested trace ${traceId} from storage doesn't belong to node ${nodeId}`);
          return null;
        }
        
        return traceGroup;
      }
      
      // Find most recent trace
      if (cachedData[nodeId].traces) {
        const traceEntries = Object.entries(cachedData[nodeId].traces);
        if (traceEntries.length === 0) return null;
        
        // Sort by lastUpdated timestamp (most recent first)
        traceEntries.sort((a, b) => {
          const aData = a[1] as TraceGroupCacheEntry;
          const bData = b[1] as TraceGroupCacheEntry;
          return bData.lastUpdated - aData.lastUpdated;
        });
        
        // For browser node, try to find a user message trace first
        if (nodeId === 'customer') {
          // Look for a trace with "User Message" in the dropdownTitle
          const userMessageTrace = traceEntries.find(([_, data]) => {
            const traceData = data as TraceGroupCacheEntry;
            return traceData.traceGroup.dropdownTitle?.includes('User Message');
          });
          
          // If found, return that
          if (userMessageTrace) {
            const traceData = userMessageTrace[1] as TraceGroupCacheEntry;
            return traceData.traceGroup;
          }
        }
        
        // Filter traces by ownership if strict mode is enabled
        let validTraceEntries = traceEntries;
        if (strictOwnership) {
          validTraceEntries = traceEntries.filter(([_, data]) => {
            const traceData = data as TraceGroupCacheEntry;
            return validateTraceOwnership(nodeId, traceData.traceGroup);
          });
          
          // If we filtered out all traces, fall back to any traces only for special cases
          if (validTraceEntries.length === 0) {
            if (nodeId === 'customer' || nodeId === 'supervisor-agent') {
              // For these special nodes, we can be less strict
              validTraceEntries = traceEntries;
            } else {
              // For other nodes, respect the strict ownership
              return null;
            }
          }
        }
        
        // If we have valid traces, return the most recent one
        if (validTraceEntries.length > 0) {
          const mostRecentData = validTraceEntries[0][1] as TraceGroupCacheEntry;
          return mostRecentData.traceGroup;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error retrieving agent trace data:', error);
    return null;
  }
}

/**
 * Get all traces for an agent node
 * 
 * @param nodeId The ID of the agent node
 * @returns Array of trace groups, or empty array if not found
 */
export function getAllNodeTraces(nodeId: string): TraceGroup[] {
  try {
    const traces: TraceGroup[] = [];
    
    // First check in-memory cache
    if (window.__agentTraceCache && window.__agentTraceCache[nodeId]) {
      const nodeData = window.__agentTraceCache[nodeId];
      
      // Collect all traces for this node
      Object.values(nodeData.traces).forEach(traceData => {
        traces.push(traceData.traceGroup);
      });
    }
    
    // If no traces found in memory cache, check local storage
    if (traces.length === 0) {
      const cachedData: AgentTraceCache = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
      if (cachedData[nodeId] && cachedData[nodeId].traces) {
        Object.values(cachedData[nodeId].traces).forEach((traceData) => {
          traces.push(traceData.traceGroup);
        });
      }
    }
    
    // Sort by timestamp (oldest first) to maintain chronological order
    return traces.sort((a, b) => {
      const aTime = a.startTime || 0;
      const bTime = b.startTime || 0;
      return aTime - bTime;
    });
  } catch (error) {
    console.error('Error retrieving all node traces:', error);
    return [];
  }
}

/**
 * Get all stored agent traces
 * 
 * @returns An object mapping node IDs to arrays of their trace groups
 */
export function getAllAgentTraces(): Record<string, TraceGroup[]> {
  try {
    const traces: Record<string, TraceGroup[]> = {};
    
    // First check in-memory cache
    if (window.__agentTraceCache) {
      Object.keys(window.__agentTraceCache).forEach(nodeId => {
        const nodeData = window.__agentTraceCache![nodeId];
        if (nodeData && nodeData.traces) {
          traces[nodeId] = [];
          
          // Collect all traces for this node
          Object.values(nodeData.traces).forEach(traceData => {
            if (traceData && traceData.traceGroup) {
              traces[nodeId].push(traceData.traceGroup);
            }
          });
          
          // Sort by timestamp
          traces[nodeId].sort((a, b) => {
            const aTime = a.startTime || 0;
            const bTime = b.startTime || 0;
            return aTime - bTime;
          });
        }
      });
    }
    
    // Then add any additional data from local storage
    const cachedData: AgentTraceCache = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    Object.keys(cachedData).forEach(nodeId => {
      if (!traces[nodeId] && cachedData[nodeId].traces) {
        traces[nodeId] = [];
        
        // Collect all traces for this node
        Object.values(cachedData[nodeId].traces).forEach((traceData) => {
          traces[nodeId].push(traceData.traceGroup);
        });
        
        // Sort by timestamp
        traces[nodeId].sort((a, b) => {
          const aTime = a.startTime || 0;
          const bTime = b.startTime || 0;
          return aTime - bTime;
        });
      }
    });
    
    return traces;
  } catch (error) {
    console.error('Error retrieving all agent traces:', error);
    return {};
  }
}

/**
 * Clear trace data for an agent node
 * 
 * @param nodeId The ID of the agent node
 */
export function clearAgentTrace(nodeId: string): void {
  try {
    // Clear from in-memory cache
    if (window.__agentTraceCache && window.__agentTraceCache[nodeId]) {
      delete window.__agentTraceCache[nodeId];
    }
    
    // Clear from local storage
    const cachedData = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
    if (cachedData[nodeId]) {
      delete cachedData[nodeId];
      localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(cachedData));
    }
    
    // Dispatch an event to notify components
    const traceClearedEvent = new CustomEvent('agentTraceCleared', {
      detail: {
        nodeId,
        timestamp: Date.now()
      }
    });
    document.dispatchEvent(traceClearedEvent);
  } catch (error) {
    console.error('Error clearing agent trace data:', error);
  }
}

/**
 * Clear all stored agent traces
 * 
 * @param sessionId Optional session ID to only clear traces for a specific session
 */
export function clearAllAgentTraces(sessionId?: string): void {
  try {
    if (sessionId) {
      // Clear just for this session
      const sessionData = JSON.parse(sessionStorage.getItem(SESSION_TRACE_KEY) || '{}');
      if (sessionData[sessionId]) {
        delete sessionData[sessionId];
        sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(sessionData));
      }
      
      // Update the main storage to remove this session's traces
      const cachedData = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '{}');
      Object.keys(cachedData).forEach(nodeId => {
        if (cachedData[nodeId].sessionId === sessionId) {
          delete cachedData[nodeId];
        }
      });
      localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(cachedData));
      
      // Update in-memory cache
      if (window.__agentTraceCache) {
        Object.keys(window.__agentTraceCache).forEach(nodeId => {
          if (window.__agentTraceCache![nodeId].sessionId === sessionId) {
            delete window.__agentTraceCache![nodeId];
          }
        });
      }
    } else {
      // Clear everything
      localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify({}));
      sessionStorage.removeItem(SESSION_TRACE_KEY);
      window.__agentTraceCache = {};
    }
    
    // Dispatch an event to notify components
    const allClearedEvent = new CustomEvent('allAgentTracesCleared', {
      detail: {
        sessionId,
        timestamp: Date.now()
      }
    });
    document.dispatchEvent(allClearedEvent);
  } catch (error) {
    console.error('Error clearing all agent trace data:', error);
  }
}
