import { describe, it, expect } from 'vitest';
import {
  validateAIAgent,
  validateChatTrigger,
  validateBasicLLMChain,
  buildReverseConnectionMap,
  getAIConnections,
  validateAISpecificNodes,
  type WorkflowNode,
  type WorkflowJson
} from '@/services/ai-node-validator';
import {
  validateHTTPRequestTool,
  validateCodeTool,
  validateVectorStoreTool,
  validateWorkflowTool,
  validateAIAgentTool,
  validateMCPClientTool,
  validateCalculatorTool,
  validateThinkTool,
  validateSerpApiTool,
  validateWikipediaTool,
  validateSearXngTool,
  validateWolframAlphaTool,
} from '@/services/ai-tool-validators';

describe('AI Node Validator', () => {
  describe('buildReverseConnectionMap', () => {
    it('should build reverse connections for AI language model', () => {
      const workflow: WorkflowJson = {
        nodes: [],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);

      expect(reverseMap.get('AI Agent')).toEqual([
        {
          sourceName: 'OpenAI',
          sourceType: 'ai_languageModel',
          type: 'ai_languageModel',
          index: 0
        }
      ]);
    });

    it('should handle multiple AI connections to same node', () => {
      const workflow: WorkflowJson = {
        nodes: [],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'HTTP Request Tool': {
            'ai_tool': [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]]
          },
          'Window Buffer Memory': {
            'ai_memory': [[{ node: 'AI Agent', type: 'ai_memory', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const agentConnections = reverseMap.get('AI Agent');

      expect(agentConnections).toHaveLength(3);
      expect(agentConnections).toContainEqual(
        expect.objectContaining({ type: 'ai_languageModel' })
      );
      expect(agentConnections).toContainEqual(
        expect.objectContaining({ type: 'ai_tool' })
      );
      expect(agentConnections).toContainEqual(
        expect.objectContaining({ type: 'ai_memory' })
      );
    });

    it('should skip empty source names', () => {
      const workflow: WorkflowJson = {
        nodes: [],
        connections: {
          '': {
            'main': [[{ node: 'Target', type: 'main', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);

      expect(reverseMap.has('Target')).toBe(false);
    });

    it('should skip empty target node names', () => {
      const workflow: WorkflowJson = {
        nodes: [],
        connections: {
          'Source': {
            'main': [[{ node: '', type: 'main', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);

      expect(reverseMap.size).toBe(0);
    });
  });

  describe('getAIConnections', () => {
    it('should filter AI connections from all incoming connections', () => {
      const reverseMap = new Map();
      reverseMap.set('AI Agent', [
        { sourceName: 'Chat Trigger', type: 'main', index: 0 },
        { sourceName: 'OpenAI', type: 'ai_languageModel', index: 0 },
        { sourceName: 'HTTP Tool', type: 'ai_tool', index: 0 }
      ]);

      const aiConnections = getAIConnections('AI Agent', reverseMap);

      expect(aiConnections).toHaveLength(2);
      expect(aiConnections).not.toContainEqual(
        expect.objectContaining({ type: 'main' })
      );
    });

    it('should filter by specific AI connection type', () => {
      const reverseMap = new Map();
      reverseMap.set('AI Agent', [
        { sourceName: 'OpenAI', type: 'ai_languageModel', index: 0 },
        { sourceName: 'Tool1', type: 'ai_tool', index: 0 },
        { sourceName: 'Tool2', type: 'ai_tool', index: 1 }
      ]);

      const toolConnections = getAIConnections('AI Agent', reverseMap, 'ai_tool');

      expect(toolConnections).toHaveLength(2);
      expect(toolConnections.every(c => c.type === 'ai_tool')).toBe(true);
    });

    it('should return empty array for node with no connections', () => {
      const reverseMap = new Map();

      const connections = getAIConnections('Unknown Node', reverseMap);

      expect(connections).toEqual([]);
    });
  });

  describe('validateAIAgent', () => {
    it('should error on missing language model connection', () => {
      const node: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [node],
        connections: {}
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(node, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('language model')
        })
      );
    });

    it('should accept single language model connection', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: { promptType: 'auto' }
      };

      const model: WorkflowNode = {
        id: 'llm1',
        name: 'OpenAI',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        position: [0, -100],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [agent, model],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      const languageModelErrors = issues.filter(i =>
        i.severity === 'error' && i.message.includes('language model')
      );
      expect(languageModelErrors).toHaveLength(0);
    });

    it('should accept dual language model connection for fallback', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: { promptType: 'auto' },
        typeVersion: 1.7
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI GPT-4': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'OpenAI GPT-3.5': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 1 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      const excessModelErrors = issues.filter(i =>
        i.severity === 'error' && i.message.includes('more than 2')
      );
      expect(excessModelErrors).toHaveLength(0);
    });

    it('should error on more than 2 language model connections', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'Model1': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'Model2': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 1 }]]
          },
          'Model3': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 2 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'TOO_MANY_LANGUAGE_MODELS'
        })
      );
    });

    it('should error on streaming mode with main output connections', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          promptType: 'auto',
          options: { streamResponse: true }
        }
      };

      const responseNode: WorkflowNode = {
        id: 'response1',
        name: 'Response Node',
        type: 'n8n-nodes-base.respondToWebhook',
        position: [200, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [agent, responseNode],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'AI Agent': {
            'main': [[{ node: 'Response Node', type: 'main', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'STREAMING_WITH_MAIN_OUTPUT'
        })
      );
    });

    it('should error on missing prompt text for define promptType', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          promptType: 'define'
        }
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_PROMPT_TEXT'
        })
      );
    });

    it('should info on short systemMessage', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          promptType: 'auto',
          systemMessage: 'Help user'
        }
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('systemMessage is very short')
        })
      );
    });

    it('should error on multiple memory connections', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: { promptType: 'auto' }
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'Memory1': {
            'ai_memory': [[{ node: 'AI Agent', type: 'ai_memory', index: 0 }]]
          },
          'Memory2': {
            'ai_memory': [[{ node: 'AI Agent', type: 'ai_memory', index: 1 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MULTIPLE_MEMORY_CONNECTIONS'
        })
      );
    });

    it('should warn on high maxIterations', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          promptType: 'auto',
          maxIterations: 60
        }
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('maxIterations')
        })
      );
    });

    it('should validate output parser with hasOutputParser flag', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          promptType: 'auto',
          hasOutputParser: true
        }
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateAIAgent(agent, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('output parser')
        })
      );
    });
  });

  describe('validateChatTrigger', () => {
    it('should error on streaming mode to non-AI-Agent target', () => {
      const trigger: WorkflowNode = {
        id: 'chat1',
        name: 'Chat Trigger',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        position: [0, 0],
        parameters: {
          options: { responseMode: 'streaming' }
        }
      };

      const codeNode: WorkflowNode = {
        id: 'code1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        position: [200, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [trigger, codeNode],
        connections: {
          'Chat Trigger': {
            'main': [[{ node: 'Code', type: 'main', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateChatTrigger(trigger, workflow, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'STREAMING_WRONG_TARGET'
        })
      );
    });

    it('should pass valid Chat Trigger with streaming to AI Agent', () => {
      const trigger: WorkflowNode = {
        id: 'chat1',
        name: 'Chat Trigger',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        position: [0, 0],
        parameters: {
          options: { responseMode: 'streaming' }
        }
      };

      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [200, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [trigger, agent],
        connections: {
          'Chat Trigger': {
            'main': [[{ node: 'AI Agent', type: 'main', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateChatTrigger(trigger, workflow, reverseMap);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should error on missing outgoing connections', () => {
      const trigger: WorkflowNode = {
        id: 'chat1',
        name: 'Chat Trigger',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        position: [0, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [trigger],
        connections: {}
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateChatTrigger(trigger, workflow, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_CONNECTIONS'
        })
      );
    });
  });

  describe('validateBasicLLMChain', () => {
    it('should error on missing language model connection', () => {
      const chain: WorkflowNode = {
        id: 'chain1',
        name: 'LLM Chain',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        position: [0, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [chain],
        connections: {}
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateBasicLLMChain(chain, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('language model')
        })
      );
    });

    it('should pass valid LLM Chain', () => {
      const chain: WorkflowNode = {
        id: 'chain1',
        name: 'LLM Chain',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        position: [0, 0],
        parameters: {
          prompt: 'Summarize the following text: {{$json.text}}'
        }
      };

      const workflow: WorkflowJson = {
        nodes: [chain],
        connections: {
          'OpenAI': {
            'ai_languageModel': [[{ node: 'LLM Chain', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const reverseMap = buildReverseConnectionMap(workflow);
      const issues = validateBasicLLMChain(chain, reverseMap);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateAISpecificNodes', () => {
    it('should validate complete AI Agent workflow', () => {
      const chatTrigger: WorkflowNode = {
        id: 'chat1',
        name: 'Chat Trigger',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        position: [0, 0],
        parameters: {}
      };

      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [200, 0],
        parameters: {
          promptType: 'auto'
        }
      };

      const model: WorkflowNode = {
        id: 'llm1',
        name: 'OpenAI',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        position: [200, -100],
        parameters: {}
      };

      const httpTool: WorkflowNode = {
        id: 'tool1',
        name: 'Weather API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [200, 100],
        parameters: {
          toolDescription: 'Get current weather for a city',
          method: 'GET',
          url: 'https://api.weather.com/v1/current?city={city}',
          placeholderDefinitions: {
            values: [
              { name: 'city', description: 'City name' }
            ]
          }
        }
      };

      const workflow: WorkflowJson = {
        nodes: [chatTrigger, agent, model, httpTool],
        connections: {
          'Chat Trigger': {
            'main': [[{ node: 'AI Agent', type: 'main', index: 0 }]]
          },
          'OpenAI': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'Weather API': {
            'ai_tool': [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]]
          }
        }
      };

      const issues = validateAISpecificNodes(workflow);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should detect missing language model in workflow', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [agent],
        connections: {}
      };

      const issues = validateAISpecificNodes(workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('language model')
        })
      );
    });

    it('should validate all AI tool sub-nodes in workflow', () => {
      const agent: WorkflowNode = {
        id: 'agent1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: { promptType: 'auto' }
      };

      const invalidTool: WorkflowNode = {
        id: 'tool1',
        name: 'Bad Tool',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 100],
        parameters: {}
      };

      const workflow: WorkflowJson = {
        nodes: [agent, invalidTool],
        connections: {
          'Model': {
            'ai_languageModel': [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          },
          'Bad Tool': {
            'ai_tool': [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]]
          }
        }
      };

      const issues = validateAISpecificNodes(workflow);

      expect(issues.filter(i => i.severity === 'error').length).toBeGreaterThan(0);
    });
  });
});

describe('AI Tool Validators', () => {
  describe('validateHTTPRequestTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'Weather API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          method: 'GET',
          url: 'https://api.weather.com/data'
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should warn on short toolDescription', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'Weather API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          method: 'GET',
          url: 'https://api.weather.com/data',
          toolDescription: 'Weather'
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('toolDescription is too short')
        })
      );
    });

    it('should error on missing URL', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'API Tool',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Fetches data from an API endpoint',
          method: 'GET'
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_URL'
        })
      );
    });

    it('should error on invalid URL protocol', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'FTP Tool',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Downloads files via FTP',
          url: 'ftp://files.example.com/data.txt'
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'INVALID_URL_PROTOCOL'
        })
      );
    });

    it('should allow expressions in URL', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'Dynamic API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Fetches data from dynamic endpoint',
          url: '={{$json.apiUrl}}/users'
        }
      };

      const issues = validateHTTPRequestTool(node);

      const urlErrors = issues.filter(i => i.code === 'INVALID_URL_FORMAT');
      expect(urlErrors).toHaveLength(0);
    });

    it('should warn on missing placeholderDefinitions for parameterized URL', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'User API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Fetches user data by ID',
          url: 'https://api.example.com/users/{userId}'
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('placeholderDefinitions')
        })
      );
    });

    it('should validate placeholder definitions match URL', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'User API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Fetches user data',
          url: 'https://api.example.com/users/{userId}',
          placeholderDefinitions: {
            values: [
              { name: 'wrongName', description: 'User identifier' }
            ]
          }
        }
      };

      const issues = validateHTTPRequestTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('Placeholder "userId" in URL')
        })
      );
    });

    it('should pass valid HTTP Request Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'http1',
        name: 'Weather API',
        type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
        position: [0, 0],
        parameters: {
          toolDescription: 'Get current weather conditions for a specified city',
          method: 'GET',
          url: 'https://api.weather.com/v1/current?city={city}',
          placeholderDefinitions: {
            values: [
              { name: 'city', description: 'City name (e.g. London, Tokyo)' }
            ]
          }
        }
      };

      const issues = validateHTTPRequestTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateCodeTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'code1',
        name: 'Calculate Tax',
        type: '@n8n/n8n-nodes-langchain.toolCode',
        position: [0, 0],
        parameters: {
          language: 'javaScript',
          jsCode: 'return { tax: price * 0.1 };'
        }
      };

      const issues = validateCodeTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should error on missing code', () => {
      const node: WorkflowNode = {
        id: 'code1',
        name: 'Empty Code',
        type: '@n8n/n8n-nodes-langchain.toolCode',
        position: [0, 0],
        parameters: {
          toolDescription: 'Performs calculations',
          language: 'javaScript'
        }
      };

      const issues = validateCodeTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('code is empty')
        })
      );
    });

    it('should warn on missing schema for outputs', () => {
      const node: WorkflowNode = {
        id: 'code1',
        name: 'Calculate',
        type: '@n8n/n8n-nodes-langchain.toolCode',
        position: [0, 0],
        parameters: {
          toolDescription: 'Calculates shipping cost based on weight and distance',
          language: 'javaScript',
          jsCode: 'return { cost: weight * distance * 0.5 };'
        }
      };

      const issues = validateCodeTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('schema')
        })
      );
    });

    it('should pass valid Code Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'code1',
        name: 'Shipping Calculator',
        type: '@n8n/n8n-nodes-langchain.toolCode',
        position: [0, 0],
        parameters: {
          toolDescription: 'Calculates shipping cost based on weight (kg) and distance (km)',
          language: 'javaScript',
          jsCode: `const { weight, distance } = $input;
const baseCost = 5.00;
const costPerKg = 2.50;
const costPerKm = 0.15;
const cost = baseCost + (weight * costPerKg) + (distance * costPerKm);
return { cost: cost.toFixed(2) };`,
          specifyInputSchema: true,
          inputSchema: '{ "weight": "number", "distance": "number" }'
        }
      };

      const issues = validateCodeTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateVectorStoreTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'vector1',
        name: 'Product Search',
        type: '@n8n/n8n-nodes-langchain.toolVectorStore',
        position: [0, 0],
        parameters: {
          topK: 5
        }
      };

      const reverseMap = new Map();
      const workflow = { nodes: [node], connections: {} };
      const issues = validateVectorStoreTool(node, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should warn on high topK value', () => {
      const node: WorkflowNode = {
        id: 'vector1',
        name: 'Document Search',
        type: '@n8n/n8n-nodes-langchain.toolVectorStore',
        position: [0, 0],
        parameters: {
          toolDescription: 'Search through product documentation',
          topK: 25
        }
      };

      const reverseMap = new Map();
      const workflow = { nodes: [node], connections: {} };
      const issues = validateVectorStoreTool(node, reverseMap, workflow);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('topK')
        })
      );
    });

    it('should pass valid Vector Store Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'vector1',
        name: 'Knowledge Base',
        type: '@n8n/n8n-nodes-langchain.toolVectorStore',
        position: [0, 0],
        parameters: {
          toolDescription: 'Search company knowledge base for relevant documentation',
          topK: 5
        }
      };

      const reverseMap = new Map();
      const workflow = { nodes: [node], connections: {} };
      const issues = validateVectorStoreTool(node, reverseMap, workflow);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateWorkflowTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'workflow1',
        name: 'Approval Process',
        type: '@n8n/n8n-nodes-langchain.toolWorkflow',
        position: [0, 0],
        parameters: {}
      };

      const reverseMap = new Map();
      const issues = validateWorkflowTool(node, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should error on missing workflowId', () => {
      const node: WorkflowNode = {
        id: 'workflow1',
        name: 'Data Processor',
        type: '@n8n/n8n-nodes-langchain.toolWorkflow',
        position: [0, 0],
        parameters: {
          toolDescription: 'Process data through specialized workflow'
        }
      };

      const reverseMap = new Map();
      const issues = validateWorkflowTool(node, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('workflowId')
        })
      );
    });

    it('should pass valid Workflow Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'workflow1',
        name: 'Email Approval',
        type: '@n8n/n8n-nodes-langchain.toolWorkflow',
        position: [0, 0],
        parameters: {
          toolDescription: 'Send email and wait for approval response',
          workflowId: '123'
        }
      };

      const reverseMap = new Map();
      const issues = validateWorkflowTool(node, reverseMap);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateAIAgentTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'agent1',
        name: 'Research Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {}
      };

      const reverseMap = new Map();
      const issues = validateAIAgentTool(node, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should warn on high maxIterations', () => {
      const node: WorkflowNode = {
        id: 'agent1',
        name: 'Complex Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          toolDescription: 'Performs complex research tasks',
          maxIterations: 60
        }
      };

      const reverseMap = new Map();
      const issues = validateAIAgentTool(node, reverseMap);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('maxIterations')
        })
      );
    });

    it('should pass valid AI Agent Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'agent1',
        name: 'Research Specialist',
        type: '@n8n/n8n-nodes-langchain.agent',
        position: [0, 0],
        parameters: {
          toolDescription: 'Specialist agent for conducting in-depth research on technical topics',
          maxIterations: 10
        }
      };

      const reverseMap = new Map();
      const issues = validateAIAgentTool(node, reverseMap);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateMCPClientTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'mcp1',
        name: 'File Access',
        type: '@n8n/n8n-nodes-langchain.mcpClientTool',
        position: [0, 0],
        parameters: {
          serverUrl: 'mcp://filesystem'
        }
      };

      const issues = validateMCPClientTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should error on missing serverUrl', () => {
      const node: WorkflowNode = {
        id: 'mcp1',
        name: 'MCP Tool',
        type: '@n8n/n8n-nodes-langchain.mcpClientTool',
        position: [0, 0],
        parameters: {
          toolDescription: 'Access external MCP server'
        }
      };

      const issues = validateMCPClientTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('serverUrl')
        })
      );
    });

    it('should pass valid MCP Client Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'mcp1',
        name: 'Filesystem Access',
        type: '@n8n/n8n-nodes-langchain.mcpClientTool',
        position: [0, 0],
        parameters: {
          toolDescription: 'Read and write files in the local filesystem',
          serverUrl: 'mcp://filesystem'
        }
      };

      const issues = validateMCPClientTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateCalculatorTool', () => {
    it('should not require toolDescription (has built-in description)', () => {
      const node: WorkflowNode = {
        id: 'calc1',
        name: 'Math Operations',
        type: '@n8n/n8n-nodes-langchain.toolCalculator',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateCalculatorTool(node);

      expect(issues).toHaveLength(0);
    });

    it('should pass valid Calculator Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'calc1',
        name: 'Calculator',
        type: '@n8n/n8n-nodes-langchain.toolCalculator',
        position: [0, 0],
        parameters: {
          toolDescription: 'Perform mathematical calculations and solve equations'
        }
      };

      const issues = validateCalculatorTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateThinkTool', () => {
    it('should not require toolDescription (has built-in description)', () => {
      const node: WorkflowNode = {
        id: 'think1',
        name: 'Think',
        type: '@n8n/n8n-nodes-langchain.toolThink',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateThinkTool(node);

      expect(issues).toHaveLength(0);
    });

    it('should pass valid Think Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'think1',
        name: 'Think',
        type: '@n8n/n8n-nodes-langchain.toolThink',
        position: [0, 0],
        parameters: {
          toolDescription: 'Pause and think through complex problems step by step'
        }
      };

      const issues = validateThinkTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateSerpApiTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'serp1',
        name: 'Web Search',
        type: '@n8n/n8n-nodes-langchain.toolSerpapi',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateSerpApiTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should warn on missing credentials', () => {
      const node: WorkflowNode = {
        id: 'serp1',
        name: 'Search Engine',
        type: '@n8n/n8n-nodes-langchain.toolSerpapi',
        position: [0, 0],
        parameters: {
          toolDescription: 'Search the web for current information'
        }
      };

      const issues = validateSerpApiTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('credentials')
        })
      );
    });

    it('should pass valid SerpApi Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'serp1',
        name: 'Web Search',
        type: '@n8n/n8n-nodes-langchain.toolSerpapi',
        position: [0, 0],
        parameters: {
          toolDescription: 'Search Google for current web information and news'
        },
        credentials: {
          serpApiApi: 'serpapi-credentials'
        }
      };

      const issues = validateSerpApiTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateWikipediaTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'wiki1',
        name: 'Wiki Lookup',
        type: '@n8n/n8n-nodes-langchain.toolWikipedia',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateWikipediaTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should pass valid Wikipedia Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'wiki1',
        name: 'Wikipedia',
        type: '@n8n/n8n-nodes-langchain.toolWikipedia',
        position: [0, 0],
        parameters: {
          toolDescription: 'Look up factual information from Wikipedia articles'
        }
      };

      const issues = validateWikipediaTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateSearXngTool', () => {
    it('should error on missing toolDescription', () => {
      const node: WorkflowNode = {
        id: 'searx1',
        name: 'Privacy Search',
        type: '@n8n/n8n-nodes-langchain.toolSearxng',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateSearXngTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_TOOL_DESCRIPTION'
        })
      );
    });

    it('should error on missing baseUrl', () => {
      const node: WorkflowNode = {
        id: 'searx1',
        name: 'SearXNG',
        type: '@n8n/n8n-nodes-langchain.toolSearxng',
        position: [0, 0],
        parameters: {
          toolDescription: 'Private web search through SearXNG instance'
        }
      };

      const issues = validateSearXngTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('baseUrl')
        })
      );
    });

    it('should pass valid SearXNG Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'searx1',
        name: 'SearXNG',
        type: '@n8n/n8n-nodes-langchain.toolSearxng',
        position: [0, 0],
        parameters: {
          toolDescription: 'Privacy-focused web search through self-hosted SearXNG',
          baseUrl: 'https://searx.example.com'
        }
      };

      const issues = validateSearXngTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateWolframAlphaTool', () => {
    it('should error on missing credentials', () => {
      const node: WorkflowNode = {
        id: 'wolfram1',
        name: 'Computational Knowledge',
        type: '@n8n/n8n-nodes-langchain.toolWolframAlpha',
        position: [0, 0],
        parameters: {}
      };

      const issues = validateWolframAlphaTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'MISSING_CREDENTIALS'
        })
      );
    });

    it('should provide info on missing custom description', () => {
      const node: WorkflowNode = {
        id: 'wolfram1',
        name: 'WolframAlpha',
        type: '@n8n/n8n-nodes-langchain.toolWolframAlpha',
        position: [0, 0],
        parameters: {},
        credentials: {
          wolframAlpha: 'wolfram-credentials'
        }
      };

      const issues = validateWolframAlphaTool(node);

      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('description')
        })
      );
    });

    it('should pass valid WolframAlpha Tool configuration', () => {
      const node: WorkflowNode = {
        id: 'wolfram1',
        name: 'WolframAlpha',
        type: '@n8n/n8n-nodes-langchain.toolWolframAlpha',
        position: [0, 0],
        parameters: {
          toolDescription: 'Computational knowledge engine for math, science, and factual queries'
        },
        credentials: {
          wolframAlphaApi: 'wolfram-credentials'
        }
      };

      const issues = validateWolframAlphaTool(node);

      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });
});
