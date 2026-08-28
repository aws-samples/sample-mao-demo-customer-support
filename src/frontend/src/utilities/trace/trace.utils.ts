/**
 * Trace Utilities
 * 
 * Common utility functions for working with trace data.
 * This module provides helper functions for trace groups and tasks.
 */

import { TraceGroup, isTraceGroup, Task, SubTask } from './trace.types';

/**
 * Safely get all actual trace groups from a messages array
 * @param messages Array that may contain both TraceGroup and other message types
 * @returns Array of only valid TraceGroup objects
 */
export function getSafeTraceGroups(messages: any[]): TraceGroup[] {
  return messages.filter(isTraceGroup);
}

/**
 * Find a trace group by agent ID
 * @param messages Array of messages that may include trace groups
 * @param agentId Agent ID to search for
 * @returns The matching trace group or undefined if not found
 */
export function findTraceGroupByAgentId(messages: any[], agentId: string): TraceGroup | undefined {
  return getSafeTraceGroups(messages)
    .find(group => group.agentId === agentId);
}

/**
 * Get the start time for a trace group by agent ID
 * @param messages Array of messages that may include trace groups
 * @param agentId Agent ID to search for
 * @param fallback Fallback time if no trace group is found (defaults to current time)
 * @returns The start time of the trace group or the fallback time
 */
export function getTraceGroupStartTime(messages: any[], agentId: string, fallback?: number): number {
  const traceGroup = findTraceGroupByAgentId(messages, agentId);
  return traceGroup?.startTime || fallback || Date.now();
}

/**
 * Find the newest trace group based on lastUpdateTime
 * @param messages Array of messages that may include trace groups
 * @returns The most recently updated trace group or undefined if no trace groups exist
 */
export function getNewestTraceGroup(messages: any[]): TraceGroup | undefined {
  const traceGroups = getSafeTraceGroups(messages);
  if (traceGroups.length === 0) return undefined;
  
  return traceGroups.reduce((newest, current) => {
    return (newest.lastUpdateTime || 0) > (current.lastUpdateTime || 0) ? newest : current;
  });
}

/**
 * Normalize a trace group for consistent display
 * @param traceGroup The trace group to normalize
 * @returns Normalized trace group with consistent structure
 */
export function normalizeTraceGroup(traceGroup: TraceGroup): TraceGroup {
  if (!traceGroup) return traceGroup;
  
  // Create a deep copy to avoid modifying the original
  const normalizedTraceGroup = JSON.parse(JSON.stringify(traceGroup)) as TraceGroup;
  
  // Process tasks - organize subtasks consistently
  if (normalizedTraceGroup.tasks && Array.isArray(normalizedTraceGroup.tasks)) {
    normalizedTraceGroup.tasks = normalizedTraceGroup.tasks.map(task => {
      // Group related subtasks under their parent tasks
      if (task.subTasks && task.subTasks.length > 0) {
        // Organize knowledge base subtasks
        if (task.title.includes('Knowledge Base')) {
          const kbInputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('knowledge base query') || 
            st.title.toLowerCase().includes('knowledge base input'));
            
          const kbOutputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('knowledge base result') || 
            st.title.toLowerCase().includes('knowledge base output'));
            
          // Ensure input tasks come before output tasks
          task.subTasks = [...kbInputTasks, ...kbOutputTasks];
        }
        
        // Organize action group subtasks
        else if (task.title.includes('Action Group')) {
          const agInputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('action group input'));
            
          const agOutputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('action group output') || 
            st.title.toLowerCase().includes('action group result'));
            
          // Ensure input tasks come before output tasks
          task.subTasks = [...agInputTasks, ...agOutputTasks];
        }
        
        // Organize model invocation subtasks
        else if (task.title.includes('Invoking Model')) {
          const modelInputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('model input'));
            
          const modelOutputTasks = task.subTasks.filter(st => 
            st.title.toLowerCase().includes('model output'));
            
          // Ensure input tasks come before output tasks
          task.subTasks = [...modelInputTasks, ...modelOutputTasks];
        }
        
        // Sort subtasks by timestamp for other task types
        else {
          task.subTasks.sort((a, b) => a.timestamp - b.timestamp);
        }
      }
      
      return task;
    });
    
    // Identify Final Response tasks that should go at the very end
    const finalResponseTasks = normalizedTraceGroup.tasks.filter(task =>
      task.title?.includes('Final Response'));

    // Get all other tasks (including Rationale and Observation)
    const otherTasks = normalizedTraceGroup.tasks.filter(task =>
      !task.title?.includes('Final Response'));
    
    // Find any Rationale task
    const rationaleTasks = otherTasks.filter(task =>
      task.title?.includes('Rationale'));
    
    // Find any Observation tasks
    const observationTasks = otherTasks.filter(task =>
      task.title?.includes('Observation'));
    
    // Get regular processing tasks (excluding Rationale and Observation)
    const processingTasks = otherTasks.filter(task =>
      !task.title?.includes('Rationale') && !task.title?.includes('Observation'));
    
    // Sort processing tasks by step number and timestamp
    processingTasks.sort((a, b) => {
      // First sort by step number
      if (a.stepNumber !== b.stepNumber) {
        return a.stepNumber - b.stepNumber;
      }
      
      // If step numbers are the same, sort by timestamp
      return a.timestamp - b.timestamp;
    });

    // Position the Rationale task after Step 1
    // Find if we have a Step 1 task
    const step1Index = processingTasks.findIndex(task => 
      task.title?.includes('Step 1:') || 
      task.stepNumber === 1);

    // Create initial ordered tasks with Rationale after Step 1 if applicable
    let orderedTasks = [];
    
    if (step1Index >= 0 && rationaleTasks.length > 0) {
      // Add Step 1
      orderedTasks = [
        ...processingTasks.slice(0, step1Index + 1),
        ...rationaleTasks, // Add Rationale after Step 1
        ...processingTasks.slice(step1Index + 1) // Add remaining steps
      ];
    } else {
      // If no Step 1 or no Rationale, just keep processing tasks in order
      orderedTasks = [...processingTasks, ...rationaleTasks];
    }
    
    // Now insert Observation tasks in proper chronological order
    if (observationTasks.length > 0) {
      // First, we need to determine where to place each Observation task
      // Sort Observation tasks by timestamp to maintain their relative order
      const sortedObservationTasks = [...observationTasks].sort((a, b) => a.timestamp - b.timestamp);
      
      const finalOrderedTasks: Task[] = [];
      
      // If we have agent invocation steps, place observations after their corresponding agent
      let lastAgentInvocationIndex = -1;
      
      for (let i = 0; i < orderedTasks.length; i++) {
        const currentTask = orderedTasks[i];
        finalOrderedTasks.push(currentTask);
        
        // Check if this is an agent invocation step
        if (currentTask.title?.includes('Agent Invocation')) {
          lastAgentInvocationIndex = finalOrderedTasks.length - 1;
          
          // If we have observation tasks that were recorded after this agent invocation
          // but before the next step, insert them right after this agent invocation
          const agentTimestamp = currentTask.timestamp;
          const nextTaskTimestamp = orderedTasks[i + 1]?.timestamp ?? Infinity;
          
          // Find observations that occurred after this agent and before the next step
          const matchingObservations = sortedObservationTasks.filter(task => 
            task.timestamp > agentTimestamp && task.timestamp < nextTaskTimestamp
          );
          
          // Add these observations after the current task
          if (matchingObservations.length > 0) {
            finalOrderedTasks.push(...matchingObservations);
            
            // Remove these observations from our sorted list
            for (const observation of matchingObservations) {
              const index = sortedObservationTasks.indexOf(observation);
              if (index >= 0) {
                sortedObservationTasks.splice(index, 1);
              }
            }
          }
        }
      }
      
      // Add any remaining observations at their closest chronological position
      if (sortedObservationTasks.length > 0) {
        // For any remaining observations, insert them at the appropriate timestamp position
        for (const observation of sortedObservationTasks) {
          let inserted = false;
          
          for (let i = 0; i < finalOrderedTasks.length - 1; i++) {
            if (
              observation.timestamp >= finalOrderedTasks[i].timestamp &&
              observation.timestamp < finalOrderedTasks[i + 1].timestamp
            ) {
              finalOrderedTasks.splice(i + 1, 0, observation);
              inserted = true;
              break;
            }
          }
          
          if (!inserted) {
            // If we couldn't find a specific place, add to the end of the main tasks
            finalOrderedTasks.push(observation);
          }
        }
      }
      
      orderedTasks = finalOrderedTasks;
    }
    
    // Put the tasks back together with Final Response at the end
    normalizedTraceGroup.tasks = [...orderedTasks, ...finalResponseTasks];
  }
  
  return normalizedTraceGroup;
}

/**
 * Generate a unique trace hash to prevent duplicate updates
 * @param nodeId The node ID
 * @param traceGroupId The trace group ID
 * @param timestamp The timestamp
 * @returns A unique hash string
 */
export function generateTraceHash(nodeId: string, traceGroupId: string, timestamp: number): string {
  return `${nodeId}-${traceGroupId}-${timestamp}`;
}

/**
 * Helper function to add a subtask to a parent task
 * @param parentTask The parent task to add the subtask to
 * @param subTaskTitle Title for the subtask
 * @param subTaskContent Content for the subtask
 * @param subTaskJson Optional JSON data for the subtask
 * @param currentTime Current timestamp
 */
export function addSubTask(
  parentTask: Task,
  subTaskTitle: string,
  subTaskContent: string | object,
  subTaskJson: string | null,
  currentTime: number
): void {
  if (!parentTask.subTasks) {
    parentTask.subTasks = [];
  }
  
  // Special handling for content - make sure it's visible as a property
  if (!parentTask.content) {
    // If the parent task doesn't have content but the subtask does,
    // add a placeholder to ensure the dropdown displays properly
    parentTask.content = "This step contains multiple substeps...";
  }
  
  // For model invocation parent tasks, always use a specific content
  if (parentTask.title.includes("Invoking Model")) {
    parentTask.content = "Model invocation details in subtasks below";
  }
  
  // Check if we already have a subtask with a similar title (ignoring timing info)
  const normalizedTitle = subTaskTitle.replace(/\(\d+\.?\d* seconds\)/, '').trim();
  const existingSubtaskIndex = parentTask.subTasks.findIndex(subtask => 
    subtask.title.includes(normalizedTitle)
  );
  
  // Calculate elapsed time from parent task start
  const subTimeDifference = (
    (currentTime - parentTask.timestamp) /
    1000
  ).toFixed(2);

  const formattedSubTaskTime = parseFloat(subTimeDifference).toFixed(2);
  
  if (existingSubtaskIndex >= 0) {
    // Update existing subtask with new timing
    const existingSubtask = parentTask.subTasks[existingSubtaskIndex];
    // Calculate time since last update for this subtask
    const timeSinceUpdate = ((currentTime - existingSubtask.timestamp) / 1000).toFixed(2);
    
    const stepMatch = existingSubtask.title.match(/Step (\d+\.\d+)/);
    if (stepMatch) {
      // Update the subtask with new content and timestamp
      parentTask.subTasks[existingSubtaskIndex] = {
        ...existingSubtask,
        content: subTaskContent,
        fullJson: subTaskJson,
        timestamp: currentTime,
        title: `${stepMatch[0]} (${formattedSubTaskTime}s, +${timeSinceUpdate}s): ${normalizedTitle}`
      };
    } else {
      // No step number in title, just update with new timing
      parentTask.subTasks[existingSubtaskIndex] = {
        ...existingSubtask,
        content: subTaskContent,
        fullJson: subTaskJson,
        timestamp: currentTime,
        title: `${normalizedTitle} (${formattedSubTaskTime}s, +${timeSinceUpdate}s)`
      };
    }
  } else {
    // Add new subtask
    const newSubTask: SubTask = {
      title: `${normalizedTitle} (${formattedSubTaskTime}s)`,
      content: subTaskContent,
      fullJson: subTaskJson,
      timestamp: currentTime
    };
    parentTask.subTasks.push(newSubTask);
  }
}

// Track unmapped collaborators to avoid flood of console warnings
const unmappedCollaborators = new Set<string>();

/**
 * Map a collaborator name to a node ID
 * @param collaboratorName The name of the collaborator from trace data
 * @param strictMapping If true, returns null instead of fallback when no mapping is found
 * @returns The corresponding node ID or null if no mapping found and strictMapping is true
 */
export function collaboratorToNodeId(collaboratorName: string, strictMapping = false): string | null {
  // Handle null or undefined case
  if (!collaboratorName) {
    return strictMapping ? null : 'supervisor-agent';
  }

  // EXACT MATCHES - highest priority for specific values
  // Routing classifier has been merged into supervisor, so direct these to supervisor-agent
  if (collaboratorName === 'ROUTING_CLASSIFIER' || 
      collaboratorName === 'routing_classifier' ||
      collaboratorName === 'RoutingClassifier') {
    return 'supervisor-agent';
  }
  
  if (collaboratorName === 'Supervisor' ||
      collaboratorName === 'SupervisorAgent' ||
      collaboratorName === 'SUPERVISOR') {
    return 'supervisor-agent';
  }
  
  if (collaboratorName === 'Unknown') {
    // Map "Unknown" to supervisor agent (or null if strictMapping)
    return strictMapping ? null : 'supervisor-agent';
  }
  
  // Pattern-based matching for other cases
  // Standardize collaborator name
  const normalizedName = collaboratorName.toLowerCase();

  // Map collaborator names to node IDs
  if (normalizedName.includes('order') || normalizedName === 'ordermanagement') {
    return 'order-mgmt-agent';
  } else if (normalizedName.includes('product') || normalizedName === 'productrecommendation') {
    return 'product-rec-agent';
  } else if (normalizedName.includes('personal') || normalizedName === 'personalization') {
    return 'personalization-agent';
  } else if (normalizedName.includes('trouble') || normalizedName === 'troubleshoot') {
    return 'ts-agent';
  } else if (normalizedName.includes('rout') || normalizedName.includes('class')) {
    return 'supervisor-agent'; // Routing classifier is now merged into supervisor
  } else if (normalizedName.includes('super')) {
    return 'supervisor-agent';
  }

  // For any other collaborator, either return null (strict mode) or supervisor-agent (fallback mode)
  if (strictMapping) {
    // Only log unmapped collaborators once to avoid console spam
    if (!unmappedCollaborators.has(collaboratorName)) {
      unmappedCollaborators.add(collaboratorName);
      console.warn(`No strict mapping found for collaborator: ${collaboratorName}`);
    }
    return null;
  }

  return 'supervisor-agent';
}

/**
 * Check if a trace belongs to the specified node based on agentId,
 * originalAgentType, or other identifiers
 * @param nodeId The node ID to check
 * @param traceGroup The trace group to validate
 * @returns True if the trace belongs to this node, false otherwise
 */
export function validateTraceOwnership(nodeId: string, traceGroup: TraceGroup): boolean {
  // Always allow 'customer' node to access any trace with browser-related identifiers
  if (nodeId === 'customer' && 
     (traceGroup.originalAgentType === 'Browser' || 
      traceGroup.dropdownTitle?.includes('Browser') ||
      traceGroup.dropdownTitle?.includes('User Message'))) {
    return true;
  }
  
  // For agent nodes, check if the trace explicitly belongs to this agent
  // Check direct agentId match
  if (traceGroup.agentId === nodeId) {
    return true;
  }
  
  // Check originalAgentType mapping to nodeId
  const mappedNodeId = collaboratorToNodeId(traceGroup.originalAgentType || '', true);
  if (mappedNodeId === nodeId) {
    return true;
  }
  
  // For certain special nodes, be more lenient
  if (nodeId === 'supervisor-agent' && 
     (traceGroup.originalAgentType?.toLowerCase()?.includes('supervisor') ||
      !traceGroup.originalAgentType)) {
    return true;
  }
  
  // Special handling for personalization agent - be more permissive
  if (nodeId === 'personalization-agent') {
    // Look for any task or trace content containing personalization terms
    const hasPersonalizationContent = traceGroup.tasks?.some(task => {
      // Check task title
      if (task.title?.toLowerCase().includes('personal')) return true;
      
      // Check task content
      if (typeof task.content === 'string' && 
          task.content.toLowerCase().includes('personalization')) return true;
      
      // Check subtasks
      if (task.subTasks?.some(subtask => 
        subtask.title?.toLowerCase().includes('personal') || 
        (typeof subtask.content === 'string' && 
         subtask.content.toLowerCase().includes('personalization'))
      )) {
        return true;
      }
      
      return false;
    });
    
    if (hasPersonalizationContent) {
      return true;
    }
    
    // Check if any text in the trace group includes personalization terms
    if (traceGroup.text?.toLowerCase().includes('personal')) {
      return true;
    }
    
    // For personalization agent specifically, be extra permissive with any supervisor trace
    if (traceGroup.originalAgentType?.toLowerCase()?.includes('supervisor')) {
      return true;
    }
  }
  
  // Check for explicit node name in dropdownTitle
  const formattedNodeName = nodeId.replace('-agent', '').replace('-', ' ');
  if (traceGroup.dropdownTitle?.toLowerCase()?.includes(formattedNodeName.toLowerCase())) {
    return true;
  }
  
  // Check for content in task titles matching node name for special agents
  if ((nodeId === 'personalization-agent' || nodeId === 'product-rec-agent' || 
       nodeId === 'ts-agent' || nodeId === 'order-mgmt-agent') && 
      traceGroup.tasks && traceGroup.tasks.length > 0) {
    
    // Extract node name without '-agent' suffix
    const agentBaseName = nodeId.replace('-agent', '');
    
    // Check if any task title contains this node name
    const hasMatchingTask = traceGroup.tasks.some(task => {
      if (!task.title) return false;
      
      // For personalization agent, check for 'personal'
      if (agentBaseName === 'personalization' && 
          task.title.toLowerCase().includes('personal')) {
        return true;
      }
      
      // For product recommendation agent, check for 'product'
      if (agentBaseName === 'product-rec' && 
          task.title.toLowerCase().includes('product')) {
        return true;
      }
      
      // For troubleshooting agent, check for 'trouble'
      if (agentBaseName === 'ts' && 
          task.title.toLowerCase().includes('trouble')) {
        return true;
      }
      
      // For order management agent, check for 'order'
      if (agentBaseName === 'order-mgmt' && 
          task.title.toLowerCase().includes('order')) {
        return true;
      }
      
      return false;
    });
    
    if (hasMatchingTask) {
      return true;
    }
  }
  
  return false;
}

/**
 * Format ResultSet data from action group output into a readable table format
 * @param result The result data containing a ResultSet
 * @returns A formatted string representation of the data
 */
export function formatResultSetData(result: any): string {
  if (!result || !result.ResultSet || !result.ResultSet.Rows || !Array.isArray(result.ResultSet.Rows)) {
    return JSON.stringify(result, null, 2);
  }
  
  const rows = result.ResultSet.Rows;
  if (rows.length < 2) {
    return JSON.stringify(result, null, 2);
  }
  
  try {
    // Extract headers from first row
    const headers = rows[0].Data.map((item: any) => item.VarCharValue);
    
    // Create a markdown table
    let table = "### Query Result\n\n";
    
    // Add header row
    table += "| " + headers.join(" | ") + " |\n";
    
    // Add separator row
    table += "| " + headers.map(() => "---").join(" | ") + " |\n";
    
    // Add data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const values = row.Data.map((item: any) => item.VarCharValue || "");
      table += "| " + values.join(" | ") + " |\n";
    }
    
    // Add metadata information
    if (result.UpdateCount !== undefined) {
      table += "\n**Update Count:** " + result.UpdateCount;
    }
    
    if (result.ResultSet.ResultSetMetadata?.ColumnInfo) {
      const columnInfo = result.ResultSet.ResultSetMetadata.ColumnInfo;
      table += "\n\n### Column Metadata\n\n";
      columnInfo.forEach((col: any) => {
        table += `- **${col.Name}** (${col.Type})\n`;
      });
    }
    
    return table;
  } catch (e) {
    console.error("Error formatting ResultSet data:", e);
    return JSON.stringify(result, null, 2);
  }
}

/**
 * Parse JSON trace data from string
 * @param traceString The trace data as a string
 * @returns Parsed trace data object or null if parsing fails
 */
export function parseTraceJson(traceString: string): any {
  try {
    return JSON.parse(traceString);
  } catch (e) {
    try {
      // Try to extract JSON from the string if direct parsing fails
      const jsonMatch = traceString.match(/\{.*\}/s);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e2) {
      console.error('Failed to parse trace JSON:', e2);
    }
    console.error('Failed to parse trace JSON:', e);
    return null;
  }
}
