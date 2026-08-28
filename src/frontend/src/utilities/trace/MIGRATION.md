# Trace System Migration Guide

This document provides instructions for migrating from the old trace implementation to the new consolidated trace system.

## Overview

The new trace system consolidates previously scattered code into a more organized structure with clear separation of concerns:

- **trace.types.ts**: All type definitions
- **trace.utils.ts**: Common utility functions
- **trace.storage.ts**: Storage management
- **trace.parser.ts**: Trace parsing and processing
- **trace.core.ts**: Main API for components
- **trace.debug.ts**: Debug utilities
- **index.ts**: Re-exports and initialization

This structure replaces the following legacy files:
- agentTraceStorage.ts
- traceParser.ts
- safeTraceUtils.ts
- trace-debug-helper.js
- trace-step-debugger.js

## Benefits

The new system offers several advantages:
- **Reduced code duplication**: Common functions are centralized
- **Better type safety**: Comprehensive TypeScript types
- **Cleaner API**: More intuitive and consistent interface
- **Improved performance**: Optimized storage and processing
- **Better organization**: Clear separation of concerns
- **Smaller bundle size**: Debug utilities can be tree-shaken in production

## Migration Steps

### 1. Update Imports

Replace imports from old files with imports from the new consolidated module.

**Before:**
```typescript
import { storeAgentTrace, getAgentTrace } from '../utilities/agentTraceStorage';
import { handleTraceMessage } from '../utilities/traceParser';
import { getSafeTraceGroups } from '../utilities/safeTraceUtils';
```

**After:**
```typescript
import { storeAgentTrace, getAgentTrace, handleTraceMessage, getSafeTraceGroups } from '../utilities/trace';
```

### 2. Initialize the Trace System

Add initialization code to your application entry point.

```typescript
import { initTrace } from '../utilities/trace';

// In your app initialization code:
initTrace(process.env.NODE_ENV === 'development');
```

### 3. Update API Usage

Most API functions maintain the same signatures, but some have been improved for better type safety and performance.

**Before:**
```typescript
// Store a trace
storeAgentTrace(nodeId, traceGroup, sessionId, preserveExistingTraces);

// Get a trace
const trace = getAgentTrace(nodeId, traceId);

// Process a trace message
handleTraceMessage(message, state, updateState);
```

**After:**
```typescript
// Store a trace (same signature)
storeAgentTrace(nodeId, traceGroup, sessionId, preserveExistingTraces);

// Get a trace (added type safety)
const trace = getAgentTrace(nodeId, traceId, strictOwnership);

// Process a trace message (same signature)
handleTraceMessage(message, state, updateState);
```

### 4. Use the Enhanced Debug Tools

The debug tools have been enhanced with TypeScript support and better organization.

**Before:**
```javascript
// Enable trace debug mode
window.__traceDebug.enableDebugMode();

// Extract conversation data
const conversation = window.__traceDebug.extractConversation(traceGroup);
```

**After:**
```typescript
// Import debug utilities directly
import { enableTraceDebugMode, extractConversation } from '../utilities/trace';

// Enable trace debug mode
enableTraceDebugMode();

// Extract conversation data with type safety
const conversation = extractConversation(traceGroup);
```

## Comparison of Common Tasks

### Processing a Trace Message

**Before:**
```typescript
import { handleTraceMessage } from '../utilities/traceParser';

handleTraceMessage(
  { type: 'trace', content: traceData },
  state,
  (newState) => setState(newState)
);
```

**After:**
```typescript
import { processTraceMessage } from '../utilities/trace';

processTraceMessage(
  { type: 'trace', content: traceData },
  state,
  (newState) => setState(newState)
);
```

### Getting a Trace Group

**Before:**
```typescript
import { getAgentTrace } from '../utilities/agentTraceStorage';

const traceGroup = getAgentTrace(nodeId);
if (traceGroup) {
  // Use the trace group
}
```

**After:**
```typescript
import { getAgentTrace } from '../utilities/trace';

const traceGroup = getAgentTrace(nodeId);
if (traceGroup) {
  // Use the trace group
}
```

### Storing a Trace Group

**Before:**
```typescript
import { storeAgentTrace } from '../utilities/agentTraceStorage';

storeAgentTrace(nodeId, traceGroup, sessionId);
```

**After:**
```typescript
import { storeAgentTrace } from '../utilities/trace';

storeAgentTrace(nodeId, traceGroup, sessionId);
```

## Working with Debugging Tools

The debug tools are now properly typed and better organized:

```typescript
import { 
  analyzeTraceTiming, 
  findLongRunningTasks,
  extractModelInvocations
} from '../utilities/trace';

// Analyze trace timing
const timing = analyzeTraceTiming(traceGroup);
console.log(`Total execution time: ${timing.totalTime}`);

// Find long-running tasks
const longTasks = findLongRunningTasks(traceGroup, 2.0);
console.log(`Found ${longTasks.length} tasks taking more than 2 seconds`);

// Extract model invocations
const modelInvocations = extractModelInvocations(traceGroup);
console.log(`Found ${modelInvocations.length} model invocations`);
```

## Removing Old Files

After migrating all usages of the old files, you can safely remove them:

- agentTraceStorage.ts
- traceParser.ts
- safeTraceUtils.ts
- trace-debug-helper.js
- trace-step-debugger.js

## Need Help?

If you encounter issues during migration or need additional information, refer to the inline documentation in each module or file an issue in the project repository.
