/**
 * Unit tests for trace parser
 */
import * as TraceParser from './trace.parser';
import { TraceState, ExtractedTraceContent, TraceGroup } from './trace.types';

describe('TraceParser', () => {
  describe('getModelInvocationType', () => {
    it('should identify model input', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            modelInvocationInput: { text: 'Model input' }
          }
        }
      };
      
      expect(TraceParser.getModelInvocationType(traceContent)).toBe('Model Input');
    });
    
    it('should identify model output', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            modelInvocationOutput: { rawResponse: { content: 'Model output' } }
          }
        }
      };
      
      expect(TraceParser.getModelInvocationType(traceContent)).toBe('Model Output');
    });
    
    it('should return null for non-model invocations', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            someOtherProperty: 'Not a model invocation'
          }
        }
      };
      
      expect(TraceParser.getModelInvocationType(traceContent)).toBeNull();
    });
    
    it('should return null for invalid input', () => {
      const invalidInput = { trace: { somethingElse: {} } };
      expect(TraceParser.getModelInvocationType(invalidInput)).toBeNull();
      
      expect(TraceParser.getModelInvocationType(null as any)).toBeNull();
    });
  });

  describe('getKnowledgeBaseOperationType', () => {
    it('should identify knowledge base lookup input', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            invocationInput: {
              knowledgeBaseLookupInput: { text: 'KB input' }
            }
          }
        }
      };
      
      expect(TraceParser.getKnowledgeBaseOperationType(traceContent)).toBe('Knowledge Base Query');
    });
    
    it('should identify knowledge base lookup output', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            observation: {
              knowledgeBaseLookupOutput: { result: 'KB output' }
            }
          }
        }
      };
      
      expect(TraceParser.getKnowledgeBaseOperationType(traceContent)).toBe('Knowledge Base Result');
    });
    
    it('should return null for non-KB operations', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            invocationInput: {
              somethingElse: {}
            }
          }
        }
      };
      
      expect(TraceParser.getKnowledgeBaseOperationType(traceContent)).toBeNull();
    });
    
    it('should return null for invalid input', () => {
      expect(TraceParser.getKnowledgeBaseOperationType(null as any)).toBeNull();
    });
  });
  
  describe('getActionGroupOperationType', () => {
    it('should identify action group invocation input', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            invocationInput: {
              actionGroupInvocationInput: { param: 'value' }
            }
          }
        }
      };
      
      expect(TraceParser.getActionGroupOperationType(traceContent)).toBe('Action Group Input');
    });
    
    it('should identify action group invocation output', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            observation: {
              actionGroupInvocationOutput: { result: 'success' }
            }
          }
        }
      };
      
      expect(TraceParser.getActionGroupOperationType(traceContent)).toBe('Action Group Output');
    });
    
    it('should return null for non-action-group operations', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            invocationInput: {
              somethingElse: {}
            }
          }
        }
      };
      
      expect(TraceParser.getActionGroupOperationType(traceContent)).toBeNull();
    });
    
    it('should return null for invalid input', () => {
      expect(TraceParser.getActionGroupOperationType(null as any)).toBeNull();
    });
  });
  
  describe('extractTraceContent', () => {
    it('should extract model invocation output', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            modelInvocationOutput: {
              rawResponse: {
                content: 'Model generated response'
              }
            }
          }
        }
      };
      
      const result = TraceParser.extractTraceContent(traceContent);
      expect(result.displayContent).toBe('Model generated response');
      expect(result.fullJsonContent).not.toBeNull();
    });
    
    it('should extract knowledge base query input', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            invocationInput: {
              knowledgeBaseLookupInput: {
                text: 'How do I reset my password?'
              }
            }
          }
        }
      };
      
      const result = TraceParser.extractTraceContent(traceContent);
      expect(result.displayContent).toBe('How do I reset my password?');
    });
    
    it('should extract knowledge base results', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            observation: {
              knowledgeBaseLookupOutput: {
                retrievedReferences: [
                  {
                    source: 'FAQ',
                    content: {
                      text: 'Password reset instructions'
                    }
                  }
                ]
              }
            }
          }
        }
      };
      
      const result = TraceParser.extractTraceContent(traceContent);
      expect(result.displayContent).toContain('Password reset instructions');
    });
    
    it('should extract final response', () => {
      const traceContent = {
        trace: {
          orchestrationTrace: {
            observation: {
              finalResponse: {
                text: 'Final answer to user query'
              }
            }
          }
        }
      };
      
      const result = TraceParser.extractTraceContent(traceContent);
      expect(result.displayContent).toBe('Final answer to user query');
    });
    
    it('should handle null content', () => {
      const result = TraceParser.extractTraceContent(null as any);
      expect(result.displayContent).toBeNull();
      expect(result.fullJsonContent).toBeNull();
    });
  });

  describe('getAgentTypeFromTrace', () => {
    it('should identify supervisor agent', () => {
      const traceData = {
        agentName: 'Supervisor'
      };
      
      expect(TraceParser.getAgentTypeFromTrace(traceData)).toBe('Supervisor');
    });
    
    it('should identify routing classifier as supervisor', () => {
      const traceData = {
        agentName: 'ROUTING_CLASSIFIER'
      };
      
      expect(TraceParser.getAgentTypeFromTrace(traceData)).toBe('Supervisor');
    });
    
    it('should identify product recommendation agent', () => {
      const traceData = {
        agentName: 'ProductRecommendation'
      };
      
      expect(TraceParser.getAgentTypeFromTrace(traceData)).toBe('ProductRecommendation');
    });
    
    it('should identify troubleshoot agent', () => {
      const traceData = {
        agentName: 'Troubleshoot'
      };
      
      expect(TraceParser.getAgentTypeFromTrace(traceData)).toBe('Troubleshoot');
    });
    
    it('should handle null input', () => {
      expect(TraceParser.getAgentTypeFromTrace(null as any)).toBe('Supervisor');
    });
    
    it('should identify by trace type patterns', () => {
      const routingClassifierTrace = {
        trace: {
          trace_type: 'routing_classifier'
        }
      };
      
      expect(TraceParser.getAgentTypeFromTrace(routingClassifierTrace)).toBe('Supervisor');
    });
    
    it('should fall back to supervisor for unknown agents', () => {
      const unknownAgent = {
        agentName: 'UnknownAgentType'
      };
      
      expect(TraceParser.getAgentTypeFromTrace(unknownAgent)).toBe('Supervisor');
    });
  });

  describe('processTraceData', () => {
    it('should process trace data and update state', () => {
      // Create an initial state
      const initialState: TraceState = {
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      };
      
      // Create sample trace data for a supervisor agent
      const traceData = {
        agentId: 'agent-123',
        trace: {
          orchestrationTrace: {
            modelInvocationInput: {
              text: 'Model input text'
            }
          }
        }
      };
      
      const traceId = 'trace-123';
      const message = 'Processing input';
      const currentTime = 1000;
      
      // Process the trace data
      const newState = TraceParser.processTraceData(
        initialState,
        traceId,
        traceData,
        message,
        currentTime
      );
      
      // Verify state was updated
      expect(newState.messages.length).toBe(1);
      
      const traceGroup = newState.messages[0] as any;
      expect(traceGroup.type).toBe('trace-group');
      expect(traceGroup.id).toBe(traceId);
      expect(traceGroup.agentId).toBe('agent-123');
      expect(traceGroup.startTime).toBe(currentTime);
    });
    
    it('should handle invalid or missing data', () => {
      const initialState: TraceState = {
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      };
      
      // Test with null trace ID
      let newState = TraceParser.processTraceData(
        initialState,
        null as any,
        {},
        '',
        1000
      );
      
      // State should remain unchanged
      expect(newState).toEqual(initialState);
      
      // Test with null trace data
      newState = TraceParser.processTraceData(
        initialState,
        'trace-id',
        null as any,
        '',
        1000
      );
      
      // State should remain unchanged
      expect(newState).toEqual(initialState);
    });
    
    it('should update existing trace group when trace ID matches', () => {
      // Create initial state with an existing trace group
      const existingTraceGroup: TraceGroup = {
        id: 'trace-123',
        type: 'trace-group',
        sender: 'bot',
        dropdownTitle: 'Existing Trace',
        startTime: 500,
        tasks: [],
        text: 'Initial trace',
        agentId: 'agent-123',
        lastUpdateTime: 500
      };
      
      const initialState: TraceState = {
        messages: [existingTraceGroup],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      };
      
      // Create new trace data with matching ID
      const traceData = {
        agentId: 'agent-123',
        trace: {
          orchestrationTrace: {
            observation: {
              finalResponse: {
                text: 'Final answer'
              }
            }
          }
        }
      };
      
      const currentTime = 1000;
      
      // Process the trace data
      const newState = TraceParser.processTraceData(
        initialState,
        'trace-123',
        traceData,
        'Final response',
        currentTime
      );
      
      // Verify existing trace group was updated
      expect(newState.messages.length).toBe(1);
      
      const updatedTraceGroup = newState.messages[0] as any;
      expect(updatedTraceGroup.id).toBe('trace-123');
      expect(updatedTraceGroup.lastUpdateTime).toBe(currentTime);
      expect(updatedTraceGroup.text).toBe('Final answer');
      expect(updatedTraceGroup.isComplete).toBe(true);
      expect(updatedTraceGroup.hasFinalResponse).toBe(true);
    });
  });
  
  describe('handleTraceMessage', () => {
    it('should process trace message and update state', () => {
      // Create an initial state
      const initialState: TraceState = {
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      };
      
      // Create a trace message
      const message = {
        type: 'trace',
        content: {
          sessionId: 'session-123',
          agentId: 'agent-123',
          text: 'Processing trace',
          trace: {
            orchestrationTrace: {
              modelInvocationInput: {
                text: 'Model input'
              }
            }
          }
        }
      };
      
      // Mock callback
      const callback = jest.fn((state: TraceState) => state);
      
      // Handle trace message
      TraceParser.handleTraceMessage(message, initialState, callback);
      
      // Verify callback was called with updated state
      expect(callback).toHaveBeenCalled();
      
      // Verify the state passed to callback was updated
      const calledWithState = callback.mock.calls[0][0];
      expect(calledWithState.messages.length).toBe(1);
    });
    
    it('should not process non-trace messages', () => {
      // Create an initial state
      const initialState: TraceState = {
        messages: [],
        currentTrace: '',
        currentSubTrace: '',
        traceStepCounter: {}
      };
      
      // Create a non-trace message
      const message = {
        type: 'not-trace',
        content: {}
      };
      
      // Mock callback
      const callback = jest.fn((state: TraceState) => state);
      
      // Handle message
      TraceParser.handleTraceMessage(message, initialState, callback);
      
      // Verify callback was not called
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
