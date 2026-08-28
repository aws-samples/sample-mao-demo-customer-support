/**
 * Trace Debug Utilities
 * 
 * Tools for debugging trace data in the browser console.
 * These functions help with analyzing trace data, finding issues,
 * and extracting useful information.
 */

import { TraceGroup, Task, SubTask } from './trace.types';

// Extend Console interface to include our custom methods
declare global {
  interface Console {
    traceInfo(message: string, data: any): void;
    traceStep(step: number, data: any): void;
    traceWarning(message: string, data: any): void;
    traceError(message: string, data: any): void;
  }
}


/**
 * Format and colorize trace data output in console
 * @param type Type of trace data for styling
 * @param data The data to display
 * @param options Additional display options
 */
export function logTrace(type: string, data: any, options: any = {}): void {
  const colors: Record<string, string> = {
    trace: 'background: #4a148c; color: white; padding: 2px 5px; border-radius: 3px;',
    step: 'background: #1565c0; color: white; padding: 2px 5px; border-radius: 3px;',
    task: 'background: #2e7d32; color: white; padding: 2px 5px; border-radius: 3px;',
    subtask: 'background: #ef6c00; color: white; padding: 2px 5px; border-radius: 3px;',
    warning: 'background: #f57f17; color: white; padding: 2px 5px; border-radius: 3px;',
    error: 'background: #b71c1c; color: white; padding: 2px 5px; border-radius: 3px;',
    success: 'background: #1b5e20; color: white; padding: 2px 5px; border-radius: 3px;',
  };
  
  const color = colors[type] || colors.trace;
  const label = options.label || type.toUpperCase();
  
  console.group(`%c ${label}`, color);
  
  // If data is a trace group, format it specially
  if (data && data.type === 'trace-group') {
    console.log('Trace Group ID:', data.id);
    console.log('Agent Type:', data.originalAgentType || data.agentId);
    console.log('Task Count:', data.tasks?.length || 0);
    
    // Log task titles if available
    if (data.tasks && data.tasks.length > 0) {
      console.groupCollapsed('Tasks');
      data.tasks.forEach((task: Task, index: number) => {
        console.log(`${index + 1}. ${task.title || 'Untitled Task'}`);
      });
      console.groupEnd();
    }
    
    // Log raw data if requested
    if (options.showRaw) {
      console.groupCollapsed('Raw Data');
      console.log(data);
      console.groupEnd();
    }
  } else {
    // For regular data, just log it
    console.log(data);
  }
  
  console.groupEnd();
}

/**
 * Extract specific tasks from a trace group based on criteria
 * @param traceGroup The trace group to extract tasks from
 * @param filterFn Filter function for tasks
 * @returns Array of tasks matching the filter
 */
export function extractTasks(
  traceGroup: TraceGroup, 
  filterFn?: (task: Task) => boolean
): Task[] {
  if (!traceGroup?.tasks || !Array.isArray(traceGroup.tasks)) {
    console.warn('Invalid trace group provided to extractTasks');
    return [];
  }
  
  return filterFn ? traceGroup.tasks.filter(filterFn) : [...traceGroup.tasks];
}

/**
 * Find tasks by step number
 * @param traceGroup The trace group to search in
 * @param stepNumber The step number to find
 * @returns Array of tasks with the given step number
 */
export function findTasksByStep(traceGroup: TraceGroup, stepNumber: number): Task[] {
  return extractTasks(traceGroup, task => task.stepNumber === stepNumber);
}

/**
 * Find tasks by title pattern
 * @param traceGroup The trace group to search in
 * @param pattern String or regex pattern to match
 * @returns Array of tasks with matching titles
 */
export function findTasksByTitle(
  traceGroup: TraceGroup, 
  pattern: string | RegExp
): Task[] {
  return extractTasks(traceGroup, task => {
    if (!task.title) return false;
    
    if (pattern instanceof RegExp) {
      return pattern.test(task.title);
    }
    
    return task.title.includes(pattern);
  });
}

/**
 * Find tasks by agent ID
 * @param traceGroup The trace group to search in
 * @param agentId The agent ID to find
 * @returns Array of tasks with the given agent ID
 */
export function findTasksByAgent(traceGroup: TraceGroup, agentId: string): Task[] {
  return extractTasks(traceGroup, task => task._agentId === agentId);
}

/**
 * Analyze trace timing information
 * @param traceGroup The trace group to analyze
 * @returns Timing information for the trace
 */
export function analyzeTraceTiming(traceGroup: TraceGroup): Record<string, any> {
  if (!traceGroup?.tasks || !Array.isArray(traceGroup.tasks)) {
    console.warn('Invalid trace group provided to analyzeTraceTiming');
    return { totalTime: 0, stepTimes: [] };
  }
  
  // Calculate total execution time
  const totalTime = traceGroup.isComplete && traceGroup.finalElapsedTime 
    ? parseFloat(traceGroup.finalElapsedTime)
    : (traceGroup.lastUpdateTime! - traceGroup.startTime) / 1000;
  
  // Calculate time per step
  const stepTimes: Array<Record<string, any>> = [];
  let lastTimestamp = traceGroup.startTime;
  
  traceGroup.tasks.forEach(task => {
    if (task.timestamp) {
      const elapsedTime = (task.timestamp - lastTimestamp) / 1000;
      stepTimes.push({
        step: task.stepNumber || 'Special',
        title: task.title || 'Untitled Task',
        timeElapsed: elapsedTime.toFixed(2) + 's',
        timestamp: task.timestamp
      });
      
      lastTimestamp = task.timestamp;
    }
  });
  
  return {
    totalTime: totalTime.toFixed(2) + 's',
    stepTimes,
    startTime: new Date(traceGroup.startTime).toISOString(),
    endTime: new Date(traceGroup.lastUpdateTime || Date.now()).toISOString()
  };
}

/**
 * Find long-running tasks
 * @param traceGroup The trace group to analyze
 * @param threshold Time threshold in seconds
 * @returns Array of tasks that took longer than the threshold
 */
export function findLongRunningTasks(
  traceGroup: TraceGroup, 
  threshold = 1.0
): Array<Record<string, any>> {
  if (!traceGroup?.tasks || !Array.isArray(traceGroup.tasks)) {
    return [];
  }
  
  const longTasks: Array<Record<string, any>> = [];
  
  // Group tasks by step number
  const tasksByStep: Record<string, Task[]> = {};
  traceGroup.tasks.forEach(task => {
    const stepNumber = task.stepNumber?.toString() || '0';
    if (!tasksByStep[stepNumber]) {
      tasksByStep[stepNumber] = [];
    }
    tasksByStep[stepNumber].push(task);
  });
  
  // For each step, find the time difference between first and last task
  Object.keys(tasksByStep).forEach(stepNumber => {
    const stepTasks = tasksByStep[stepNumber];
    
    // Sort tasks by timestamp
    stepTasks.sort((a, b) => a.timestamp - b.timestamp);
    
    if (stepTasks.length >= 2) {
      const firstTask = stepTasks[0];
      const lastTask = stepTasks[stepTasks.length - 1];
      
      const duration = (lastTask.timestamp - firstTask.timestamp) / 1000;
      
      if (duration > threshold) {
        longTasks.push({
          step: stepNumber,
          title: firstTask.title,
          duration: duration.toFixed(2) + 's',
          tasks: stepTasks
        });
      }
    }
    
    // Also check subtasks for long-running operations
    stepTasks.forEach(task => {
      if (task.subTasks && Array.isArray(task.subTasks) && task.subTasks.length >= 2) {
        const firstSubtask = task.subTasks[0];
        const lastSubtask = task.subTasks[task.subTasks.length - 1];
        
        if (firstSubtask.timestamp && lastSubtask.timestamp) {
          const duration = (lastSubtask.timestamp - firstSubtask.timestamp) / 1000;
          
          if (duration > threshold) {
            longTasks.push({
              step: stepNumber,
              title: task.title + ' (subtasks)',
              duration: duration.toFixed(2) + 's',
              subtasks: task.subTasks
            });
          }
        }
      }
    });
  });
  
  return longTasks;
}

/**
 * Extract model invocation information from trace data
 * @param traceGroup The trace group to analyze
 * @returns Array of model invocation data
 */
export function extractModelInvocations(
  traceGroup: TraceGroup
): Array<Record<string, any>> {
  const modelInvocations: Array<Record<string, any>> = [];
  
  if (!traceGroup?.tasks || !Array.isArray(traceGroup.tasks)) {
    return modelInvocations;
  }
  
  traceGroup.tasks.forEach(task => {
    // Look for model invocation tasks
    if (task.title && task.title.includes('Invoking Model')) {
      const invocation: Record<string, any> = {
        step: task.stepNumber,
        title: task.title,
        timestamp: task.timestamp,
        input: null,
        output: null,
        stats: {}
      };
      
      // Extract input and output from subtasks
      if (task.subTasks && Array.isArray(task.subTasks)) {
        task.subTasks.forEach(subtask => {
          if (subtask.title && subtask.title.includes('Model Input')) {
            invocation.input = subtask.content;
            invocation.stats.inputTime = subtask.timestamp;
          } else if (subtask.title && subtask.title.includes('Model Output')) {
            invocation.output = subtask.content;
            invocation.stats.outputTime = subtask.timestamp;
            
            // Calculate processing time if we have both timestamps
            if (invocation.stats.inputTime && subtask.timestamp) {
              invocation.stats.processingTime = 
                ((subtask.timestamp - invocation.stats.inputTime) / 1000).toFixed(2) + 's';
            }
          }
        });
      }
      
      modelInvocations.push(invocation);
    }
  });
  
  return modelInvocations;
}

/**
 * Extract conversation information from trace
 * @param traceGroup The trace group to analyze
 * @returns Object containing user query and system response
 */
export function extractConversation(
  traceGroup: TraceGroup
): Record<string, any> | null {
  if (!traceGroup?.tasks || !Array.isArray(traceGroup.tasks)) {
    return null;
  }
  
  let userQuery: string | null = null;
  let systemResponse: string | null = null;
  
  // Try to find user query in step 1 or model input
  const step1Tasks = findTasksByStep(traceGroup, 1);
  if (step1Tasks.length > 0) {
    // Look for model input subtasks
    const task = step1Tasks[0];
    if (task.subTasks && Array.isArray(task.subTasks)) {
      const inputSubtask = task.subTasks.find(st => 
        st.title && st.title.includes('Model Input')
      );
      
      if (inputSubtask && inputSubtask.content) {
        // Try to extract user message from model input
        try {
          const content = typeof inputSubtask.content === 'string'
            ? JSON.parse(inputSubtask.content)
            : inputSubtask.content;
            
          // Look for user message in common patterns
          if (content?.messages) {
            // Find the first user message
            const userMessage = content.messages.find((m: any) => m.role === 'user');
            if (userMessage) {
              userQuery = userMessage.content;
            }
          } else if (content?.text) {
            userQuery = content.text;
          } else {
            userQuery = inputSubtask.content as string;
          }
        } catch (e) {
          userQuery = inputSubtask.content as string;
        }
      }
    }
  }
  
  // Try to find system response in final response tasks
  const finalResponseTasks = traceGroup.tasks.filter(task => 
    task.title && task.title.includes('Final Response')
  );
  
  if (finalResponseTasks.length > 0) {
    systemResponse = finalResponseTasks[0].content as string;
  } else {
    // Look in all tasks for observation
    const observationTask = traceGroup.tasks.find(task =>
      task.title && task.title.includes('Observation')
    );
    
    if (observationTask) {
      systemResponse = observationTask.content as string;
    }
  }
  
  return {
    userQuery,
    systemResponse,
    hasUserQuery: !!userQuery,
    hasSystemResponse: !!systemResponse
  };
}

/**
 * Analyze trace issues
 * @param traceGroup The trace group to analyze
 * @returns Array of identified issues
 */
export function analyzeTraceIssues(
  traceGroup: TraceGroup
): Array<Record<string, string>> {
  const issues: Array<Record<string, string>> = [];
  
  if (!traceGroup) {
    issues.push({
      severity: 'error',
      message: 'Invalid trace group: null or undefined'
    });
    return issues;
  }
  
  // Check for missing essential trace data
  if (!traceGroup.tasks || !Array.isArray(traceGroup.tasks)) {
    issues.push({
      severity: 'error',
      message: 'Trace group has no tasks array'
    });
    return issues;
  }
  
  // Check for missing timestamps
  if (!traceGroup.startTime) {
    issues.push({
      severity: 'warning',
      message: 'Trace group missing startTime'
    });
  }
  
  if (!traceGroup.lastUpdateTime) {
    issues.push({
      severity: 'warning',
      message: 'Trace group missing lastUpdateTime'
    });
  }
  
  // Check for empty tasks array
  if (traceGroup.tasks.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'Trace group has empty tasks array'
    });
    return issues;
  }
  
  // Check for tasks with missing required properties
  traceGroup.tasks.forEach((task, index) => {
    if (!task.title) {
      issues.push({
        severity: 'warning',
        message: `Task at index ${index} missing title`
      });
    }
    
    if (!task.timestamp) {
      issues.push({
        severity: 'warning',
        message: `Task at index ${index} missing timestamp`
      });
    }
  });
  
  // Check for final response if trace is complete
  const hasFinalResponse = traceGroup.tasks.some(task => 
    task.title && task.title.includes('Final Response')
  );
  
  if (traceGroup.isComplete && !hasFinalResponse) {
    issues.push({
      severity: 'warning',
      message: 'Trace is marked as complete but has no final response task'
    });
  }
  
  return issues;
}

/**
 * Enable trace debug mode with console helpers
 * @returns Function to disable debug mode
 */
export function enableTraceDebugMode(): () => void {
  (window as any).__traceDebugMode = true;
  
  // Add console helpers
  console.traceInfo = (message: string, data: any) => 
    logTrace('trace', data, { label: message });
    
  console.traceStep = (step: number, data: any) => 
    logTrace('step', data, { label: `Step ${step}` });
    
  console.traceWarning = (message: string, data: any) => 
    logTrace('warning', data, { label: message });
    
  console.traceError = (message: string, data: any) => 
    logTrace('error', data, { label: message });
  
  // Listen for trace events
  document.addEventListener('agentTraceUpdated', (event: any) => {
    if ((window as any).__traceDebugMode) {
      console.traceInfo(`Trace Updated: ${event.detail.nodeId}`, event.detail.traceGroup);
    }
  });
  
  // Return disable function
  return () => {
    (window as any).__traceDebugMode = false;
    delete (console as any).traceInfo;
    delete (console as any).traceStep;
    delete (console as any).traceWarning;
    delete (console as any).traceError;
  };
}

/**
 * Initialize global trace debug helpers
 */
export function initGlobalTraceDebugHelpers(): void {
  // Make helper functions available globally for console debugging
  (window as any).__traceDebug = {
    logTrace,
    extractTasks,
    findTasksByStep,
    findTasksByTitle,
    findTasksByAgent,
    analyzeTraceTiming,
    findLongRunningTasks,
    extractModelInvocations,
    extractConversation,
    analyzeTraceIssues,
    enableDebugMode: enableTraceDebugMode
  };
  
  console.log('%c Trace Debug Helper Initialized', 'background: #4a148c; color: white; padding: 2px 5px; border-radius: 3px;');
  console.log('Access trace debug functions with window.__traceDebug');
  console.log('Example: window.__traceDebug.extractConversation(traceGroup)');
}
