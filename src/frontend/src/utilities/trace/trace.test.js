/**
 * Trace System Test Utilities
 * 
 * This file provides helpers for testing the new trace system directly in the browser console.
 * It should not be imported into the application code, only used for development and testing.
 */

// Import the trace system
import * as TraceSystem from './index';

// Export for direct use in browser console
window.TraceSystemTest = {
  // Core system
  init: TraceSystem.initTrace,
  store: TraceSystem.storeAgentTrace,
  get: TraceSystem.getAgentTrace,
  getAll: TraceSystem.getAllNodeTraces,
  clear: TraceSystem.clearAgentTrace,
  clearAll: TraceSystem.clearAllAgentTraces,
  
  // Debug tools
  analyze: {
    timing: TraceSystem.analyzeTraceTiming,
    longTasks: TraceSystem.findLongRunningTasks,
    modelInvocations: TraceSystem.extractModelInvocations,
    conversation: TraceSystem.extractConversation,
    issues: TraceSystem.analyzeTraceIssues
  },
  
  // Utilities
  enableDebug: TraceSystem.enableTraceDebugMode,
  
  // Comparison with old system
  compareWith: (nodeId) => {
    try {
      // Import the old trace system modules
      import('../agentTraceStorage').then(oldStorage => {
        import('./trace.core').then(newCore => {
          // Get trace from both systems
          const oldTrace = oldStorage.getAgentTrace(nodeId);
          const newTrace = newCore.getAgentTrace(nodeId);
          
          // Compare results
          console.group('Trace System Comparison');
          console.log('Old system trace:', oldTrace);
          console.log('New system trace:', newTrace);
          
          // Check for equality
          const oldJSON = JSON.stringify(oldTrace);
          const newJSON = JSON.stringify(newTrace);
          const isEqual = oldJSON === newJSON;
          
          console.log(`Traces are ${isEqual ? 'identical' : 'different'}`);
          
          if (!isEqual) {
            console.log('Differences:');
            // Show size difference
            console.log(`Old size: ${oldJSON.length} bytes`);
            console.log(`New size: ${newJSON.length} bytes`);
            console.log(`Size difference: ${((newJSON.length - oldJSON.length) / oldJSON.length * 100).toFixed(2)}%`);
            
            // Check for missing properties
            if (oldTrace && newTrace) {
              const oldKeys = new Set(Object.keys(oldTrace));
              const newKeys = new Set(Object.keys(newTrace));
              
              console.log('Properties only in old trace:', 
                [...oldKeys].filter(key => !newKeys.has(key)));
                
              console.log('Properties only in new trace:', 
                [...newKeys].filter(key => !oldKeys.has(key)));
            }
          }
          
          console.groupEnd();
        });
      });
    } catch (error) {
      console.error('Failed to compare trace systems:', error);
    }
  }
};

// Add an initialization function
window.initTraceTest = () => {
  console.log('%c Trace System Test Utilities Loaded', 'background: #4a148c; color: white; padding: 4px 8px; border-radius: 4px;');
  console.log('Access trace test utilities with window.TraceSystemTest');
  console.log('Initialize the trace system with window.TraceSystemTest.init()');
  console.log('Example: window.TraceSystemTest.analyze.conversation(traceGroup)');
  
  // Initialize the trace system in development mode
  TraceSystem.initTrace(true);
  
  return window.TraceSystemTest;
};

// Auto-initialize if in development mode
if (process.env.NODE_ENV === 'development') {
  window.initTraceTest();
}

/**
 * Usage in browser console:
 * 
 * // Initialize
 * TraceSystemTest.init(true);
 * 
 * // Get a trace
 * const trace = TraceSystemTest.get('supervisor-agent');
 * 
 * // Analyze trace timing
 * TraceSystemTest.analyze.timing(trace);
 * 
 * // Extract conversation
 * TraceSystemTest.analyze.conversation(trace);
 * 
 * // Compare with old system
 * TraceSystemTest.compareWith('supervisor-agent');
 */
