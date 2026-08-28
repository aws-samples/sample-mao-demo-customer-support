/**
 * Unit tests for trace utilities
 */
import { 
  getSafeTraceGroups, 
  findTraceGroupByAgentId, 
  getTraceGroupStartTime, 
  getNewestTraceGroup,
  normalizeTraceGroup,
  generateTraceHash,
  addSubTask,
  collaboratorToNodeId,
  validateTraceOwnership,
  formatResultSetData,
  parseTraceJson
} from './trace.utils';
import { TraceGroup, Task, isTraceGroup } from './trace.types';

describe('TraceUtils', () => {
  describe('getSafeTraceGroups', () => {
    it('should filter out non-trace group items', () => {
      const mockItems = [
        { type: 'trace-group', tasks: [], dropdownTitle: 'Trace 1' },
        { type: 'message' },
        { type: 'trace-group', tasks: [], dropdownTitle: 'Trace 2' }
      ];

      const result = getSafeTraceGroups(mockItems);
      expect(result.length).toBe(2);
      expect(result[0].dropdownTitle).toBe('Trace 1');
      expect(result[1].dropdownTitle).toBe('Trace 2');
    });
    
    it('should return empty array for empty input', () => {
      const result = getSafeTraceGroups([]);
      expect(result).toEqual([]);
    });
  });

  describe('findTraceGroupByAgentId', () => {
    it('should find trace group with matching agent ID', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          agentId: 'agent-1'
        },
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 2',
          agentId: 'agent-2'
        }
      ];

      const result = findTraceGroupByAgentId(mockTraces, 'agent-2');
      expect(result?.dropdownTitle).toBe('Trace 2');
    });
    
    it('should return undefined if no matching agent ID found', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          agentId: 'agent-1'
        }
      ];

      const result = findTraceGroupByAgentId(mockTraces, 'agent-not-exists');
      expect(result).toBeUndefined();
    });
  });

  describe('getTraceGroupStartTime', () => {
    it('should return start time of matching trace group', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          agentId: 'agent-1',
          startTime: 1000
        }
      ];

      const result = getTraceGroupStartTime(mockTraces, 'agent-1');
      expect(result).toBe(1000);
    });
    
    it('should return fallback time if no matching trace group', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          agentId: 'agent-1',
          startTime: 1000
        }
      ];

      const fallbackTime = 2000;
      const result = getTraceGroupStartTime(mockTraces, 'agent-not-exists', fallbackTime);
      expect(result).toBe(fallbackTime);
    });
    
    it('should return current time if no matching trace and no fallback', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          agentId: 'agent-1',
          startTime: 1000
        }
      ];

      // Mock Date.now() to return a fixed value
      const originalDateNow = Date.now;
      const mockedTime = 3000;
      Date.now = jest.fn(() => mockedTime);
      
      const result = getTraceGroupStartTime(mockTraces, 'agent-not-exists');
      expect(result).toBe(mockedTime);
      
      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('getNewestTraceGroup', () => {
    it('should return trace group with most recent lastUpdateTime', () => {
      const mockTraces = [
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 1',
          lastUpdateTime: 1000
        },
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 2',
          lastUpdateTime: 2000
        },
        { 
          type: 'trace-group', 
          tasks: [], 
          dropdownTitle: 'Trace 3',
          lastUpdateTime: 1500
        }
      ];

      const result = getNewestTraceGroup(mockTraces);
      expect(result?.dropdownTitle).toBe('Trace 2');
    });
    
    it('should return undefined for empty array', () => {
      const result = getNewestTraceGroup([]);
      expect(result).toBeUndefined();
    });
  });

  describe('normalizeTraceGroup', () => {
    it('should handle null input', () => {
      const result = normalizeTraceGroup(null as unknown as TraceGroup);
      expect(result).toBeNull();
    });
    
    it('should organize subtasks properly', () => {
      const mockTraceGroup: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [
          {
            stepNumber: 1,
            title: 'Knowledge Base',
            timestamp: 1000,
            subTasks: [
              {
                title: 'Knowledge Base Result',
                content: 'Result data',
                fullJson: null,
                timestamp: 1200
              },
              {
                title: 'Knowledge Base Query',
                content: 'Query data',
                fullJson: null,
                timestamp: 1100
              }
            ]
          }
        ],
        text: 'Trace text',
        agentId: 'agent-1'
      };

      const result = normalizeTraceGroup(mockTraceGroup);
      
      // Knowledge Base Query should come before Knowledge Base Result
      expect(result.tasks[0].subTasks![0].title).toContain('Knowledge Base Query');
      expect(result.tasks[0].subTasks![1].title).toContain('Knowledge Base Result');
    });
  });

  describe('generateTraceHash', () => {
    it('should generate unique hash string', () => {
      const nodeId = 'node-1';
      const traceGroupId = 'trace-1';
      const timestamp = 1000;
      
      const result = generateTraceHash(nodeId, traceGroupId, timestamp);
      expect(result).toBe('node-1-trace-1-1000');
    });
  });

  describe('addSubTask', () => {
    it('should add a subtask to a parent task', () => {
      const parentTask: Task = {
        stepNumber: 1,
        title: 'Test Task',
        timestamp: 1000
      };
      
      addSubTask(
        parentTask,
        'Subtask Title',
        'Subtask content',
        null,
        1100
      );
      
      expect(parentTask.subTasks).toBeDefined();
      expect(parentTask.subTasks?.length).toBe(1);
      expect(parentTask.subTasks![0].title).toContain('Subtask Title');
      expect(parentTask.subTasks![0].content).toBe('Subtask content');
    });
    
    it('should update existing subtask with similar title', () => {
      const parentTask: Task = {
        stepNumber: 1,
        title: 'Test Task',
        timestamp: 1000,
        subTasks: [
          {
            title: 'Existing Subtask (0.10s)',
            content: 'Old content',
            fullJson: null,
            timestamp: 1100
          }
        ]
      };
      
      addSubTask(
        parentTask,
        'Existing Subtask',
        'New content',
        null,
        1200
      );
      
      expect(parentTask.subTasks?.length).toBe(1);
      expect(parentTask.subTasks![0].content).toBe('New content');
      expect(parentTask.subTasks![0].timestamp).toBe(1200);
    });
  });

  describe('collaboratorToNodeId', () => {
    it('should map exact matches correctly', () => {
      expect(collaboratorToNodeId('ROUTING_CLASSIFIER')).toBe('supervisor-agent');
      expect(collaboratorToNodeId('Supervisor')).toBe('supervisor-agent');
      expect(collaboratorToNodeId('Unknown')).toBe('supervisor-agent');
    });
    
    it('should map pattern-based matches correctly', () => {
      expect(collaboratorToNodeId('OrderManagement')).toBe('order-mgmt-agent');
      expect(collaboratorToNodeId('ProductRecommendation')).toBe('product-rec-agent');
      expect(collaboratorToNodeId('Personalization')).toBe('personalization-agent');
      expect(collaboratorToNodeId('Troubleshoot')).toBe('ts-agent');
    });
    
    it('should handle strictMapping mode', () => {
      expect(collaboratorToNodeId('Unknown', true)).toBeNull();
      expect(collaboratorToNodeId('SomeUnknownAgent', true)).toBeNull();
      expect(collaboratorToNodeId('Supervisor', true)).toBe('supervisor-agent');
    });
  });

  describe('validateTraceOwnership', () => {
    it('should validate ownership based on agentId', () => {
      const mockTrace: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Trace text',
        agentId: 'order-mgmt-agent'
      };
      
      expect(validateTraceOwnership('order-mgmt-agent', mockTrace)).toBe(true);
      expect(validateTraceOwnership('product-rec-agent', mockTrace)).toBe(false);
    });
    
    it('should validate ownership based on originalAgentType', () => {
      const mockTrace: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Test Trace',
        startTime: 1000,
        tasks: [],
        text: 'Trace text',
        agentId: 'some-id',
        originalAgentType: 'OrderManagement'
      };
      
      expect(validateTraceOwnership('order-mgmt-agent', mockTrace)).toBe(true);
    });
    
    it('should handle special cases for customer node', () => {
      const mockTrace: TraceGroup = {
        id: 'trace-1',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Browser',
        startTime: 1000,
        tasks: [],
        text: 'Trace text',
        agentId: 'some-id',
        originalAgentType: 'Browser'
      };
      
      expect(validateTraceOwnership('customer', mockTrace)).toBe(true);
    });
  });

  describe('parseTraceJson', () => {
    it('should parse valid JSON', () => {
      const json = '{"key": "value"}';
      const result = parseTraceJson(json);
      expect(result).toEqual({ key: 'value' });
    });
    
    it('should handle invalid JSON', () => {
      const invalid = 'not json';
      const result = parseTraceJson(invalid);
      expect(result).toBeNull();
    });
    
    it('should extract JSON from string', () => {
      const mixed = 'some text {"key": "value"} more text';
      const result = parseTraceJson(mixed);
      expect(result).toEqual({ key: 'value' });
    });
  });
});
