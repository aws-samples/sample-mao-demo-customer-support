/**
 * Unit tests for trace debug utilities
 */
import * as TraceDebug from './trace.debug';
import { TraceGroup, Task, ExtendedWindow } from './trace.types';

// Cast window to extended type
const extendedWindow = window as ExtendedWindow;

describe('TraceDebug', () => {
  // Save original console methods before mocking
  const originalConsoleGroup = console.group;
  const originalConsoleGroupCollapsed = console.groupCollapsed;
  const originalConsoleLog = console.log;
  const originalConsoleGroupEnd = console.groupEnd;
  const originalConsoleWarn = console.warn;
  
  beforeEach(() => {
    // Mock console methods
    console.group = jest.fn();
    console.groupCollapsed = jest.fn();
    console.log = jest.fn();
    console.groupEnd = jest.fn();
    console.warn = jest.fn();
    
    // Clear window debug properties
    extendedWindow.__traceDebugMode = undefined;
    extendedWindow.__traceDebug = undefined;
  });
  
  afterEach(() => {
    // Restore original console methods
    console.group = originalConsoleGroup;
    console.groupCollapsed = originalConsoleGroupCollapsed;
    console.log = originalConsoleLog;
    console.groupEnd = originalConsoleGroupEnd;
    console.warn = originalConsoleWarn;
  });

  describe('logTrace', () => {
    it('should log trace data with correct styling', () => {
      const data = { key: 'value' };
      
      TraceDebug.logTrace('trace', data);
      
      // Verify console methods called with correct arguments
      expect(console.group).toHaveBeenCalledWith(
        expect.stringContaining('TRACE'),
        expect.stringContaining('background:')
      );
      expect(console.log).toHaveBeenCalledWith(data);
      expect(console.groupEnd).toHaveBeenCalled();
    });
    
    it('should handle trace group data specially', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Task 1', timestamp: 1100 },
          { stepNumber: 2, title: 'Task 2', timestamp: 1200 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      TraceDebug.logTrace('trace', traceGroup);
      
      // Should log special info for trace groups
      expect(console.log).toHaveBeenCalledWith('Trace Group ID:', 'trace-1');
      expect(console.log).toHaveBeenCalledWith('Agent Type:', 'test-agent');
      expect(console.log).toHaveBeenCalledWith('Task Count:', 2);
      
      // Should create a nested group for tasks
      expect(console.groupCollapsed).toHaveBeenCalledWith('Tasks');
    });
  });

  describe('extractTasks', () => {
    it('should extract tasks from trace group', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Task 1', timestamp: 1100 },
          { stepNumber: 2, title: 'Task 2', timestamp: 1200 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      const result = TraceDebug.extractTasks(traceGroup);
      
      expect(result.length).toBe(2);
      expect(result[0].title).toBe('Task 1');
      expect(result[1].title).toBe('Task 2');
    });
    
    it('should filter tasks by provided filter function', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Task 1', timestamp: 1100 },
          { stepNumber: 2, title: 'Task 2', timestamp: 1200 },
          { stepNumber: 3, title: 'Special Task', timestamp: 1300 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      const result = TraceDebug.extractTasks(traceGroup, task => task.title.includes('Special'));
      
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Special Task');
    });
    
    it('should handle invalid input', () => {
      console.warn = jest.fn();
      
      const result = TraceDebug.extractTasks(null as unknown as TraceGroup);
      
      expect(result).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid trace group'));
    });
  });

  describe('findTasksByStep', () => {
    it('should find tasks by step number', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Step 1', timestamp: 1100 },
          { stepNumber: 2, title: 'Step 2', timestamp: 1200 },
          { stepNumber: 2, title: 'Another Step 2', timestamp: 1300 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      const result = TraceDebug.findTasksByStep(traceGroup, 2);
      
      expect(result.length).toBe(2);
      expect(result[0].title).toBe('Step 2');
      expect(result[1].title).toBe('Another Step 2');
    });
  });

  describe('findTasksByTitle', () => {
    it('should find tasks by title string pattern', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Model Input', timestamp: 1100 },
          { stepNumber: 2, title: 'Model Output', timestamp: 1200 },
          { stepNumber: 3, title: 'Final Response', timestamp: 1300 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      const result = TraceDebug.findTasksByTitle(traceGroup, 'Model');
      
      expect(result.length).toBe(2);
      expect(result[0].title).toBe('Model Input');
      expect(result[1].title).toBe('Model Output');
    });
    
    it('should find tasks by regex pattern', () => {
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          { stepNumber: 1, title: 'Model Input', timestamp: 1100 },
          { stepNumber: 2, title: 'Model Output', timestamp: 1200 },
          { stepNumber: 3, title: 'Final Response', timestamp: 1300 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent'
      };
      
      const result = TraceDebug.findTasksByTitle(traceGroup, /Model (Input|Output)/);
      
      expect(result.length).toBe(2);
      expect(result[0].title).toBe('Model Input');
      expect(result[1].title).toBe('Model Output');
    });
  });

  describe('analyzeTraceTiming', () => {
    it('should calculate timing information', () => {
      const startTime = 1000;
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: startTime,
        tasks: [
          { stepNumber: 1, title: 'Step 1', timestamp: startTime + 500 },
          { stepNumber: 2, title: 'Step 2', timestamp: startTime + 1000 },
          { stepNumber: 3, title: 'Step 3', timestamp: startTime + 2000 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent',
        lastUpdateTime: startTime + 3000
      };
      
      const result = TraceDebug.analyzeTraceTiming(traceGroup);
      
      expect(result.totalTime).toBe('3.00s');
      expect(result.stepTimes.length).toBe(3);
      
      // First step time should be 0.5s
      expect(result.stepTimes[0].timeElapsed).toBe('0.50s');
      
      // Second step time should be 0.5s (1000ms from step 1 to step 2)
      expect(result.stepTimes[1].timeElapsed).toBe('0.50s');
      
      // Third step time should be 1.0s (2000ms from step 2 to step 3)
      expect(result.stepTimes[2].timeElapsed).toBe('1.00s');
    });
    
    it('should handle completed traces', () => {
      const startTime = 1000;
      const traceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: startTime,
        tasks: [
          { stepNumber: 1, title: 'Step 1', timestamp: startTime + 1000 }
        ],
        text: 'Test trace content',
        agentId: 'test-agent',
        lastUpdateTime: startTime + 3000,
        isComplete: true,
        finalElapsedTime: '4.50'
      };
      
      const result = TraceDebug.analyzeTraceTiming(traceGroup);
      
      // Should use finalElapsedTime for completed trace
      expect(result.totalTime).toBe('4.50s');
    });
    
    it('should handle invalid input', () => {
      console.warn = jest.fn();
      
      const result = TraceDebug.analyzeTraceTiming(null as unknown as TraceGroup);
      
      expect(result.totalTime).toBe('0s');
      expect(result.stepTimes).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid trace group'));
    });
  });

  describe('enableTraceDebugMode', () => {
    it('should enable debug mode with console helpers', () => {
      const disableDebug = TraceDebug.enableTraceDebugMode();
      
      // Debug mode should be enabled
      expect(extendedWindow.__traceDebugMode).toBe(true);
      
      // Console helpers should be added
      expect(console.traceInfo).toBeDefined();
      expect(console.traceStep).toBeDefined();
      expect(console.traceWarning).toBeDefined();
      expect(console.traceError).toBeDefined();
      
      // Should return a function to disable debug mode
      expect(typeof disableDebug).toBe('function');
      
      // Test disable function
      disableDebug();
      
      // Debug mode should be disabled
      expect(extendedWindow.__traceDebugMode).toBe(false);
      
      // Console helpers should be removed
      expect(console.traceInfo).toBeUndefined();
      expect(console.traceStep).toBeUndefined();
      expect(console.traceWarning).toBeUndefined();
      expect(console.traceError).toBeUndefined();
    });
  });

  describe('initGlobalTraceDebugHelpers', () => {
    it('should initialize global debug helpers', () => {
      TraceDebug.initGlobalTraceDebugHelpers();
      
      // Global debug object should be initialized
      expect(extendedWindow.__traceDebug).toBeDefined();
      
      // Debug functions should be added
      expect(extendedWindow.__traceDebug?.logTrace).toBeDefined();
      expect(extendedWindow.__traceDebug?.extractTasks).toBeDefined();
      expect(extendedWindow.__traceDebug?.findTasksByStep).toBeDefined();
      expect(extendedWindow.__traceDebug?.analyzeTraceTiming).toBeDefined();
      
      // Console should log initialization message
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Trace Debug Helper Initialized'),
        expect.any(String)
      );
    });
  });

  // Additional tests for other debug functions can be added here
});
