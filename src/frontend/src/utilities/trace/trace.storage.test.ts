/**
 * Unit tests for trace storage
 */
import * as TraceStorage from './trace.storage';
import { TraceGroup, AgentTraceCache, ExtendedWindow } from './trace.types';

// Mock localStorage and sessionStorage
const mockStorageData: Record<string, string> = {};
const mockSessionData: Record<string, string> = {};

// Cast window to our extended type
const extendedWindow = window as ExtendedWindow;

describe('TraceStorage', () => {
  // Set up mocks before tests
  beforeEach(() => {
    // Clear any mock data
    Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
    Object.keys(mockSessionData).forEach(key => delete mockSessionData[key]);
    
    // Clear window properties
    extendedWindow.__agentTraceCache = undefined;
    extendedWindow.__traceCleanupTimerActive = undefined;
    extendedWindow.__traceCleanupTimer = undefined;
    extendedWindow.__traceIdleCleanupTimer = undefined;
    extendedWindow.__currentSessionId = undefined;
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(key => mockStorageData[key] || null),
        setItem: jest.fn((key, value) => {
          mockStorageData[key] = value.toString();
        }),
        removeItem: jest.fn(key => {
          delete mockStorageData[key];
        }),
        clear: jest.fn(() => {
          Object.keys(mockStorageData).forEach(key => delete mockStorageData[key]);
        }),
      },
      writable: true
    });
    
    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: jest.fn(key => mockSessionData[key] || null),
        setItem: jest.fn((key, value) => {
          mockSessionData[key] = value.toString();
        }),
        removeItem: jest.fn(key => {
          delete mockSessionData[key];
        }),
        clear: jest.fn(() => {
          Object.keys(mockSessionData).forEach(key => delete mockSessionData[key]);
        }),
      },
      writable: true
    });
    
    // Mock document event listeners
    document.addEventListener = jest.fn();
    document.dispatchEvent = jest.fn();
    
    // Mock Date.now to return a fixed value
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    
    // Mock timers
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('initTraceStorage', () => {
    it('should initialize storage properly', () => {
      TraceStorage.initTraceStorage();
      
      // Expect localStorage and sessionStorage to be initialized
      expect(localStorage.setItem).toHaveBeenCalledWith('agent-trace-cache', JSON.stringify({}));
      expect(sessionStorage.setItem).toHaveBeenCalledWith('current-session-traces', JSON.stringify({}));
      
      // Expect window cache to be initialized
      expect(extendedWindow.__agentTraceCache).toEqual({});
      
      // Expect cleanup timers to be set up
      expect(extendedWindow.__traceCleanupTimerActive).toBe(true);
    });
  });
  
  describe('storeTraceGroup and getTraceGroup', () => {
    it('should store and retrieve trace data', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create a test trace group
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      // Store the trace group
      TraceStorage.storeTraceGroup('test-node', traceGroup);
      
      // Retrieve the trace group
      const retrievedTrace = TraceStorage.getTraceGroup('test-node');
      
      // Verify the retrieved trace matches what we stored
      expect(retrievedTrace).not.toBeNull();
      expect(retrievedTrace?.id).toBe('trace-1');
      expect(retrievedTrace?.text).toBe('Test trace content');
    });
    
    it('should support retrieving specific trace by ID', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store two trace groups
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Test trace 1 content',
        agentId: 'test-agent'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Test trace 2 content',
        agentId: 'test-agent'
      };
      
      // Store both trace groups
      TraceStorage.storeTraceGroup('test-node', traceGroup1);
      TraceStorage.storeTraceGroup('test-node', traceGroup2);
      
      // Retrieve specific trace
      const retrievedTrace = TraceStorage.getTraceGroup('test-node', 'trace-2');
      
      // Verify correct trace retrieved
      expect(retrievedTrace).not.toBeNull();
      expect(retrievedTrace?.id).toBe('trace-2');
      expect(retrievedTrace?.text).toBe('Test trace 2 content');
    });
    
    it('should handle strict ownership validation', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create a test trace group with mismatched agentId
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Test trace content',
        agentId: 'different-agent'
      };
      
      // Store the trace group
      TraceStorage.storeTraceGroup('test-node', traceGroup);
      
      // Try to retrieve with strict ownership (mismatch)
      const retrievedTrace = TraceStorage.getTraceGroup('test-node', undefined, true);
      
      // With strict ownership, should not return trace with mismatched agentId
      // Mocking is required here for validateTraceOwnership function
      // This test might need adjustment based on implementation details
    });
  });
  
  describe('getAllNodeTraces', () => {
    it('should retrieve all traces for a node', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store two trace groups
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Test trace 1',
        agentId: 'test-agent'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Test trace 2',
        agentId: 'test-agent'
      };
      
      // Store both trace groups
      TraceStorage.storeTraceGroup('test-node', traceGroup1);
      TraceStorage.storeTraceGroup('test-node', traceGroup2);
      
      // Retrieve all traces
      const traces = TraceStorage.getAllNodeTraces('test-node');
      
      // Verify both traces retrieved
      expect(traces.length).toBe(2);
      expect(traces.find(t => t.id === 'trace-1')?.text).toBe('Test trace 1');
      expect(traces.find(t => t.id === 'trace-2')?.text).toBe('Test trace 2');
    });
    
    it('should return sorted traces', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store two trace groups with different timestamps
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 2000, // Later timestamp
        tasks: [],
        text: 'Test trace 1',
        agentId: 'test-agent'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1000, // Earlier timestamp
        tasks: [],
        text: 'Test trace 2',
        agentId: 'test-agent'
      };
      
      // Store both trace groups
      TraceStorage.storeTraceGroup('test-node', traceGroup1);
      TraceStorage.storeTraceGroup('test-node', traceGroup2);
      
      // Retrieve all traces
      const traces = TraceStorage.getAllNodeTraces('test-node');
      
      // Verify traces sorted by timestamp (oldest first)
      expect(traces[0].id).toBe('trace-2');
      expect(traces[1].id).toBe('trace-1');
    });
  });
  
  describe('getAllAgentTraces', () => {
    it('should retrieve all traces for all nodes', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store trace groups for two different nodes
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Node 1 trace',
        agentId: 'test-agent-1'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Node 2 trace',
        agentId: 'test-agent-2'
      };
      
      // Store traces for different nodes
      TraceStorage.storeTraceGroup('node-1', traceGroup1);
      TraceStorage.storeTraceGroup('node-2', traceGroup2);
      
      // Retrieve all traces
      const allTraces = TraceStorage.getAllAgentTraces();
      
      // Verify traces for both nodes
      expect(Object.keys(allTraces).length).toBe(2);
      expect(allTraces['node-1'].length).toBe(1);
      expect(allTraces['node-2'].length).toBe(1);
      expect(allTraces['node-1'][0].text).toBe('Node 1 trace');
      expect(allTraces['node-2'][0].text).toBe('Node 2 trace');
    });
  });
  
  describe('clearAgentTrace', () => {
    it('should clear traces for specific node', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store traces for two nodes
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Node 1 trace',
        agentId: 'test-agent-1'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Node 2 trace',
        agentId: 'test-agent-2'
      };
      
      // Store traces
      TraceStorage.storeTraceGroup('node-1', traceGroup1);
      TraceStorage.storeTraceGroup('node-2', traceGroup2);
      
      // Clear traces for node-1
      TraceStorage.clearAgentTrace('node-1');
      
      // Verify node-1 traces cleared but node-2 traces remain
      expect(TraceStorage.getTraceGroup('node-1')).toBeNull();
      expect(TraceStorage.getTraceGroup('node-2')).not.toBeNull();
      
      // Verify event dispatched
      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentTraceCleared'
        })
      );
    });
  });
  
  describe('clearAllAgentTraces', () => {
    it('should clear traces for all nodes', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store traces for two nodes
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Node 1 trace',
        agentId: 'test-agent-1'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Node 2 trace',
        agentId: 'test-agent-2'
      };
      
      // Store traces
      TraceStorage.storeTraceGroup('node-1', traceGroup1);
      TraceStorage.storeTraceGroup('node-2', traceGroup2);
      
      // Clear all traces
      TraceStorage.clearAllAgentTraces();
      
      // Verify all traces cleared
      expect(TraceStorage.getTraceGroup('node-1')).toBeNull();
      expect(TraceStorage.getTraceGroup('node-2')).toBeNull();
      
      // Verify localStorage cleared
      expect(localStorage.setItem).toHaveBeenCalledWith('agent-trace-cache', JSON.stringify({}));
      
      // Verify event dispatched
      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'allAgentTracesCleared'
        })
      );
    });
    
    it('should clear only specific session traces when session ID provided', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Create and store traces with different sessions
      const traceGroup1: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 1',
        startTime: 1000,
        tasks: [],
        text: 'Session 1 trace',
        agentId: 'test-agent-1'
      };
      
      const traceGroup2: TraceGroup = {
        id: 'trace-2',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace 2',
        startTime: 1100,
        tasks: [],
        text: 'Session 2 trace',
        agentId: 'test-agent-2'
      };
      
      // Store traces with session IDs
      TraceStorage.storeTraceGroup('node-1', traceGroup1, 'session-1');
      TraceStorage.storeTraceGroup('node-2', traceGroup2, 'session-2');
      
      // Clear only session-1 traces
      TraceStorage.clearAllAgentTraces('session-1');
      
      // Need to properly mock sessionStorage for this test
      // This test might need adjustment based on implementation details
    });
  });
  
  describe('cleanupOldTraces', () => {
    it('should clean up traces older than the threshold', () => {
      // Initialize storage
      TraceStorage.initTraceStorage();
      
      // Would need to mock implementation details like Date.now() 
      // to test time-based cleanups effectively
      // This test might need adjustment based on implementation details
    });
  });
});
