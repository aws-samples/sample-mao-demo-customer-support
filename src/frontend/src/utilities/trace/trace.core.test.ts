/**
 * Unit tests for trace core
 */
import * as TraceCore from './trace.core';
import * as TraceStorage from './trace.storage';
import * as TraceParser from './trace.parser';
import { TraceGroup, TraceState } from './trace.types';
import { ExtendedWindow } from './trace.types';

// Mock dependencies
jest.mock('./trace.storage');
jest.mock('./trace.parser');

// Cast window to our extended type
const extendedWindow = window as ExtendedWindow;

describe('TraceCore', () => {
  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks();
    
    // Reset window properties
    extendedWindow.__lastTraceEventHash = undefined;
    extendedWindow.__currentSessionId = undefined;
    
    // Mock document events
    document.dispatchEvent = jest.fn();
    
    // Mock CustomEvent constructor
    global.CustomEvent = jest.fn(
      (eventType, options) => ({ type: eventType, detail: options?.detail }) as unknown as CustomEvent
    );
  });

  describe('initTraceSystem', () => {
    it('should initialize the trace system', () => {
      TraceCore.initTraceSystem();
      
      // Verify that storage was initialized
      expect(TraceStorage.initTraceStorage).toHaveBeenCalled();
    });
  });

  describe('processTraceMessage', () => {
    it('should delegate trace message processing to parser', () => {
      const message = { type: 'trace', content: { text: 'Sample trace' } };
      const state = {
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      } as TraceState;
      const callback = jest.fn();
      
      TraceCore.processTraceMessage(message, state, callback);
      
      // Verify parser was called correctly
      expect(TraceParser.handleTraceMessage).toHaveBeenCalledWith(message, state, callback);
    });
  });

  describe('storeAgentTrace', () => {
    it('should store trace group and dispatch event', () => {
      const nodeId = 'test-node';
      const traceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Test trace content',
        agentId: 'test-agent',
        lastUpdateTime: 1100
      } as TraceGroup;
      
      // Mock the storage store function
      TraceCore.storeAgentTrace(nodeId, traceGroup);
      
      // Verify storage was called correctly
      expect(TraceStorage.storeTraceGroup).toHaveBeenCalledWith(nodeId, traceGroup, undefined, undefined);
      
      // Verify event dispatch 
      // The event dispatch is asynchronous (using requestAnimationFrame), we need to trigger it
      window.requestAnimationFrame = jest.fn(cb => {
        cb(0);
        return 0;
      });
      
      expect(document.dispatchEvent).toHaveBeenCalled();
    });
    
    it('should include session ID when provided', () => {
      const nodeId = 'test-node';
      const sessionId = 'test-session';
      const traceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Test trace content',
        agentId: 'test-agent',
        lastUpdateTime: 1100
      } as TraceGroup;
      
      TraceCore.storeAgentTrace(nodeId, traceGroup, sessionId);
      
      // Verify storage was called with session ID
      expect(TraceStorage.storeTraceGroup).toHaveBeenCalledWith(nodeId, traceGroup, sessionId, undefined);
    });
    
    it('should log completion when trace is marked as complete', () => {
      const nodeId = 'test-node';
      const completeTraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Test trace content',
        agentId: 'test-agent',
        lastUpdateTime: 1100,
        isComplete: true
      } as TraceGroup;
      
      // Mock console.log to verify its call
      const originalConsoleLog = console.log;
      console.log = jest.fn();
      
      TraceCore.storeAgentTrace(nodeId, completeTraceGroup);
      
      // Verify console log was called for trace completion
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Stored final trace data')
      );
      
      // Restore console.log
      console.log = originalConsoleLog;
    });
  });

  describe('getAgentTrace', () => {
    it('should retrieve trace from storage', () => {
      const nodeId = 'test-node';
      const mockTraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        text: 'Content'
      } as TraceGroup;
      
      // Mock storage to return our trace
      (TraceStorage.getTraceGroup as jest.Mock).mockReturnValue(mockTraceGroup);
      
      const result = TraceCore.getAgentTrace(nodeId);
      
      // Verify storage was called correctly
      expect(TraceStorage.getTraceGroup).toHaveBeenCalledWith(nodeId, undefined, undefined);
      
      // Verify correct trace was returned
      expect(result).toEqual(mockTraceGroup);
    });
    
    it('should handle specific trace ID', () => {
      const nodeId = 'test-node';
      const traceId = 'specific-trace';
      
      TraceCore.getAgentTrace(nodeId, traceId);
      
      // Verify storage was called with specific trace ID
      expect(TraceStorage.getTraceGroup).toHaveBeenCalledWith(nodeId, traceId, undefined);
    });
    
    it('should handle strict ownership flag', () => {
      const nodeId = 'test-node';
      
      TraceCore.getAgentTrace(nodeId, undefined, true);
      
      // Verify storage was called with strict ownership
      expect(TraceStorage.getTraceGroup).toHaveBeenCalledWith(nodeId, undefined, true);
    });
  });

  describe('getAllNodeTraces', () => {
    it('should retrieve all traces for a node', () => {
      const nodeId = 'test-node';
      const mockTraces = [
        { id: 'trace-1' } as TraceGroup,
        { id: 'trace-2' } as TraceGroup
      ];
      
      // Mock storage to return our traces
      (TraceStorage.getAllNodeTraces as jest.Mock).mockReturnValue(mockTraces);
      
      const result = TraceCore.getAllNodeTraces(nodeId);
      
      // Verify storage was called correctly
      expect(TraceStorage.getAllNodeTraces).toHaveBeenCalledWith(nodeId);
      
      // Verify correct traces were returned
      expect(result).toEqual(mockTraces);
      expect(result.length).toBe(2);
    });
  });

  describe('getAllAgentTraces', () => {
    it('should retrieve all traces for all nodes', () => {
      const mockTraces = {
        'node1': [{ id: 'trace-1' } as TraceGroup],
        'node2': [{ id: 'trace-2' } as TraceGroup]
      };
      
      // Mock storage to return our traces
      (TraceStorage.getAllAgentTraces as jest.Mock).mockReturnValue(mockTraces);
      
      const result = TraceCore.getAllAgentTraces();
      
      // Verify storage was called correctly
      expect(TraceStorage.getAllAgentTraces).toHaveBeenCalled();
      
      // Verify correct traces were returned
      expect(Object.keys(result).length).toBe(2);
      expect(result).toEqual(mockTraces);
    });
  });

  describe('clearAgentTrace', () => {
    it('should clear traces for a node', () => {
      const nodeId = 'test-node';
      
      TraceCore.clearAgentTrace(nodeId);
      
      // Verify storage was called correctly
      expect(TraceStorage.clearAgentTrace).toHaveBeenCalledWith(nodeId);
    });
  });

  describe('clearAllAgentTraces', () => {
    it('should clear all traces', () => {
      TraceCore.clearAllAgentTraces();
      
      // Verify storage was called correctly
      expect(TraceStorage.clearAllAgentTraces).toHaveBeenCalledWith(undefined);
    });
    
    it('should clear traces for specific session', () => {
      const sessionId = 'test-session';
      
      TraceCore.clearAllAgentTraces(sessionId);
      
      // Verify storage was called correctly with session ID
      expect(TraceStorage.clearAllAgentTraces).toHaveBeenCalledWith(sessionId);
    });
  });

  describe('cleanupOldTraces and cleanupAllButCurrentSession', () => {
    it('should call storage cleanup functions', () => {
      TraceCore.cleanupOldTraces();
      
      // Verify storage was called correctly
      expect(TraceStorage.cleanupOldTraces).toHaveBeenCalled();
      
      TraceCore.cleanupAllButCurrentSession();
      
      // Verify storage was called correctly
      expect(TraceStorage.cleanupAllButCurrentSession).toHaveBeenCalled();
    });
  });

  describe('prepareTraceGroupForDisplay', () => {
    // This would test the integration with TraceUtils.normalizeTraceGroup
    // But we'd need to mock it separately or create a separate test
  });

  describe('session management', () => {
    it('should set and get current session ID', () => {
      const sessionId = 'test-session';
      
      // Test setting session ID
      TraceCore.setCurrentSessionId(sessionId);
      
      // Verify session ID was set
      expect(extendedWindow.__currentSessionId).toBe(sessionId);
      
      // Test getting session ID
      const result = TraceCore.getCurrentSessionId();
      
      // Verify correct session ID was returned
      expect(result).toBe(sessionId);
    });
  });

  describe('utility re-exports', () => {
    // These tests might be redundant if the underlying implementations are tested separately
    // But could be useful for verifying the exports work correctly
  });
});
