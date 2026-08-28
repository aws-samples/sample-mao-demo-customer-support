# Trace System

A consolidated system for working with agent trace data.

## Overview

This trace system provides a unified API for processing, storing, and analyzing agent trace data in the application. It replaces the previous implementation that was spread across multiple files with a more organized, type-safe, and efficient approach.

## Features

- **Unified API**: All trace-related functions in one place
- **Type Safety**: Comprehensive TypeScript types for all operations
- **Optimized Storage**: Efficient storage management with automatic cleanup
- **Debug Utilities**: Enhanced debugging tools for trace analysis
- **Modular Design**: Clear separation of concerns

## Architecture

The system is organized into the following modules:

- **trace.types.ts**: Core type definitions
- **trace.utils.ts**: Common utility functions
- **trace.storage.ts**: Storage management
- **trace.parser.ts**: Trace parsing and processing
- **trace.core.ts**: Main API for components
- **trace.debug.ts**: Debug utilities
- **index.ts**: Re-exports and initialization

## Quick Start

### Installation

The trace system is included as part of the project. No separate installation is required.

### Initialization

Initialize the trace system in your application entry point:

```typescript
import { initTrace } from '../utilities/trace';

// In your app initialization code:
initTrace(process.env.NODE_ENV === 'development');
```

### Basic Usage

```typescript
import { 
  storeAgentTrace, 
  getAgentTrace, 
  processTraceMessage 
} from '../utilities/trace';

// Process a trace message
processTraceMessage(
  { type: 'trace', content: traceData },
  currentState,
  (newState) => setState(newState)
);

// Store trace data
storeAgentTrace(nodeId, traceGroup, sessionId);

// Retrieve trace data
const traceGroup = getAgentTrace(nodeId);
if (traceGroup) {
  // Use the trace group
}
```

### Debug Tools

```typescript
import { 
  analyzeTraceTiming,
  findLongRunningTasks,
  extractConversation
} from '../utilities/trace';

// Analyze trace timing
const timing = analyzeTraceTiming(traceGroup);
console.log(`Total execution time: ${timing.totalTime}`);

// Extract conversation
const conversation = extractConversation(traceGroup);
console.log('User query:', conversation.userQuery);
console.log('System response:', conversation.systemResponse);
```

## API Reference

### Core API

- `initTrace(enableDebug?: boolean): void` - Initialize the trace system
- `processTraceMessage(message, state, callback): void` - Process a trace message
- `storeAgentTrace(nodeId, traceGroup, sessionId?, preserveExistingTraces?): void` - Store trace data
- `getAgentTrace(nodeId, traceId?, strictOwnership?): TraceGroup | null` - Get trace data
- `getAllNodeTraces(nodeId): TraceGroup[]` - Get all traces for a node
- `clearAgentTrace(nodeId): void` - Clear traces for a node
- `clearAllAgentTraces(sessionId?): void` - Clear all traces

### Debug API

- `analyzeTraceTiming(traceGroup): object` - Analyze trace timing
- `findLongRunningTasks(traceGroup, threshold?): object[]` - Find long-running tasks
- `extractModelInvocations(traceGroup): object[]` - Extract model invocations
- `extractConversation(traceGroup): object` - Extract conversation details
- `analyzeTraceIssues(traceGroup): object[]` - Identify issues in trace data

## Migration

For details on migrating from the old implementation, see [MIGRATION.md](./MIGRATION.md).

## Implementation Plan

For the implementation and rollout plan, see [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).
