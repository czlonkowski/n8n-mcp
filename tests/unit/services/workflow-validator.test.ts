import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { ExpressionValidator } from '@/services/expression-validator';
import { createWorkflow } from '@tests/utils/builders/workflow.builder';
import { validateConditionNodeStructure } from '@/services/n8n-validation';

// Mock dependencies
vi.mock('@/database/node-repository');
vi.mock('@/services/enhanced-config-validator');
vi.mock('@/services/expression-validator');
vi.mock('@/utils/logger');

describe('WorkflowValidator', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: NodeRepository;
  let mockEnhancedConfigValidator: typeof EnhancedConfigValidator;

  const nodeTypes: Record<string, any> = {
    'nodes-base.webhook': { type: 'nodes-base.webhook', displayName: 'Webhook', package: 'n8n-nodes-base', isTrigger: true, version: 2, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.manualTrigger': { type: 'nodes-base.manualTrigger', displayName: 'Manual Trigger', package: 'n8n-nodes-base', isTrigger: true, version: 1, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.set': { type: 'nodes-base.set', displayName: 'Set', package: 'n8n-nodes-base', version: 3, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.code': { type: 'nodes-base.code', displayName: 'Code', package: 'n8n-nodes-base', version: 2, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.httpRequest': { type: 'nodes-base.httpRequest', displayName: 'HTTP Request', package: 'n8n-nodes-base', version: 4, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.if': { type: 'nodes-base.if', displayName: 'IF', package: 'n8n-nodes-base', version: 2, isVersioned: true, outputs: ['main', 'main'], properties: [] },
    'nodes-base.filter': { type: 'nodes-base.filter', displayName: 'Filter', package: 'n8n-nodes-base', outputs: ['main', 'main'], properties: [] },
    'nodes-base.switch': { type: 'nodes-base.switch', displayName: 'Switch', package: 'n8n-nodes-base', outputs: ['main', 'main', 'main', 'main'], properties: [] },
    'nodes-base.slack': { type: 'nodes-base.slack', displayName: 'Slack', package: 'n8n-nodes-base', version: 2, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.googleSheets': { type: 'nodes-base.googleSheets', displayName: 'Google Sheets', package: 'n8n-nodes-base', version: 4, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.merge': { type: 'nodes-base.merge', displayName: 'Merge', package: 'n8n-nodes-base', outputs: ['main'], properties: [] },
    'nodes-base.postgres': { type: 'nodes-base.postgres', displayName: 'Postgres', package: 'n8n-nodes-base', version: 2, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-langchain.agent': { type: 'nodes-langchain.agent', displayName: 'AI Agent', package: '@n8n/n8n-nodes-langchain', version: 1, isVersioned: true, isAITool: true, outputs: ['main'], properties: [] },
    'nodes-langchain.lmChatGoogleGemini': { type: 'nodes-langchain.lmChatGoogleGemini', displayName: 'Google Gemini Chat Model', package: '@n8n/n8n-nodes-langchain', outputs: ['ai_languageModel'], properties: [] },
    'nodes-langchain.memoryBufferWindow': { type: 'nodes-langchain.memoryBufferWindow', displayName: 'Window Buffer Memory', package: '@n8n/n8n-nodes-langchain', outputs: ['ai_memory'], properties: [] },
    'nodes-langchain.embeddingsOpenAi': { type: 'nodes-langchain.embeddingsOpenAi', displayName: 'Embeddings OpenAI', package: '@n8n/n8n-nodes-langchain', outputs: ['ai_embedding'], properties: [] },
    'nodes-langchain.openAi': { type: 'nodes-langchain.openAi', displayName: 'OpenAI', package: '@n8n/n8n-nodes-langchain', outputs: ['main'], properties: [] },
    'nodes-langchain.textClassifier': { type: 'nodes-langchain.textClassifier', displayName: 'Text Classifier', package: '@n8n/n8n-nodes-langchain', outputs: ['={{}}'], properties: [] },
    'nodes-langchain.vectorStoreInMemory': { type: 'nodes-langchain.vectorStoreInMemory', displayName: 'In-Memory Vector Store', package: '@n8n/n8n-nodes-langchain', outputs: ['={{$parameter["mode"] === "retrieve" ? "main" : "ai_vectorStore"}}'], properties: [] },
    'community.customNode': { type: 'community.customNode', displayName: 'Custom Node', package: 'n8n-nodes-custom', version: 1, isVersioned: false, properties: [], isAITool: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeRepository = new NodeRepository({} as any) as any;
    mockEnhancedConfigValidator = EnhancedConfigValidator as any;
    if (!mockNodeRepository.getAllNodes) { mockNodeRepository.getAllNodes = vi.fn(); }
    if (!mockNodeRepository.getNode) { mockNodeRepository.getNode = vi.fn(); }

    vi.mocked(mockNodeRepository.getNode).mockImplementation((nodeType: string) => {
      if (nodeType === 'n8n-nodes-custom.customNode') {
        return { type: 'n8n-nodes-custom.customNode', displayName: 'Custom Node', package: 'n8n-nodes-custom', version: 1, isVersioned: false, properties: [], isAITool: false };
      }
      return nodeTypes[nodeType] || null;
    });
    vi.mocked(mockNodeRepository.getAllNodes).mockReturnValue(Object.values(nodeTypes));

    vi.mocked(mockEnhancedConfigValidator.validateWithMode).mockReturnValue({
      errors: [], warnings: [], suggestions: [], mode: 'operation' as const, valid: true, visibleProperties: [], hiddenProperties: [],
    } as any);

    vi.mocked(ExpressionValidator.validateNodeExpressions).mockReturnValue({
      valid: true, errors: [], warnings: [], usedVariables: new Set(), usedNodes: new Set(),
    });

    validator = new WorkflowValidator(mockNodeRepository, mockEnhancedConfigValidator);
  });

  // ─── Workflow Structure Validation ─────────────────────────────────

  describe('validateWorkflow', () => {
    it('should validate a minimal valid workflow', async () => {
      const workflow = createWorkflow('Test Workflow').addWebhookNode({ name: 'Webhook' }).build();
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.statistics.totalNodes).toBe(1);
      expect(result.statistics.enabledNodes).toBe(1);
      expect(result.statistics.triggerNodes).toBe(1);
    });

    it('should validate a workflow with all options disabled', async () => {
      const workflow = createWorkflow('Test Workflow').addWebhookNode({ name: 'Webhook' }).build();
      const result = await validator.validateWorkflow(workflow as any, { validateNodes: false, validateConnections: false, validateExpressions: false });
      expect(result.valid).toBe(true);
      expect(mockNodeRepository.getNode).not.toHaveBeenCalled();
      expect(ExpressionValidator.validateNodeExpressions).not.toHaveBeenCalled();
    });

    it('should handle validation errors gracefully', async () => {
      const workflow = createWorkflow('Test Workflow').addWebhookNode({ name: 'Webhook' }).build();
      vi.mocked(mockNodeRepository.getNode).mockImplementation(() => { throw new Error('Database error'); });
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Database error'))).toBe(true);
    });

    it('should use different validation profiles', async () => {
      const workflow = createWorkflow('Test Workflow').addWebhookNode({ name: 'Webhook' }).build();
      for (const profile of ['minimal', 'runtime', 'ai-friendly', 'strict'] as const) {
        const result = await validator.validateWorkflow(workflow as any, { profile });
        expect(result).toBeDefined();
        expect(mockEnhancedConfigValidator.validateWithMode).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.any(Array), 'operation', profile);
      }
    });

    it('should handle null workflow gracefully', async () => {
      const result = await validator.validateWorkflow(null as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid workflow structure'))).toBe(true);
    });

    it('should handle undefined workflow gracefully', async () => {
      const result = await validator.validateWorkflow(undefined as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid workflow structure'))).toBe(true);
    });

    it('should handle workflow with null nodes array', async () => {
      const result = await validator.validateWorkflow({ nodes: null, connections: {} } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('nodes must be an array'))).toBe(true);
    });

    it('should handle workflow with null connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [], connections: null } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('connections must be an object'))).toBe(true);
    });

    it('should handle non-array nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: 'not-an-array', connections: {} } as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('nodes must be an array');
    });

    it('should handle non-object connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [], connections: [] } as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('connections must be an object');
    });

    it('should handle nodes with null/undefined properties', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: null, type: 'n8n-nodes-base.set', position: [0, 0], parameters: undefined }], connections: {} } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle circular references in workflow object', async () => {
      const workflow: any = { nodes: [], connections: {} };
      workflow.circular = workflow;
      await expect(validator.validateWorkflow(workflow)).resolves.toBeDefined();
    });
  });

  describe('validateWorkflowStructure', () => {
    it('should error when nodes array is missing', async () => {
      const result = await validator.validateWorkflow({ connections: {} } as any);
      expect(result.errors.some(e => e.message === 'Workflow must have a nodes array')).toBe(true);
    });

    it('should error when connections object is missing', async () => {
      const result = await validator.validateWorkflow({ nodes: [] } as any);
      expect(result.errors.some(e => e.message === 'Workflow must have a connections object')).toBe(true);
    });

    it('should warn when workflow has no nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [], connections: {} } as any);
      expect(result.valid).toBe(true);
      expect(result.warnings[0].message).toBe('Workflow is empty - no nodes defined');
    });

    it('should error for single non-webhook node workflow', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Single-node workflows are only valid for webhook endpoints'))).toBe(true);
    });

    it('should warn for webhook without connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, typeVersion: 2 }], connections: {} } as any);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Webhook node has no connections'))).toBe(true);
    });

    it('should error for multi-node workflow without connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Multi-node workflow has no connections'))).toBe(true);
    });

    it('should detect duplicate node names', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [300, 100], parameters: {} }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Duplicate node name: "Webhook"'))).toBe(true);
    });

    it('should detect duplicate node IDs', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook1', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '1', name: 'Webhook2', type: 'n8n-nodes-base.webhook', position: [300, 100], parameters: {} }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Duplicate node ID: "1"'))).toBe(true);
    });

    it('should count trigger nodes correctly', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', position: [100, 300], parameters: {} }, { id: '3', name: 'Manual', type: 'n8n-nodes-base.manualTrigger', position: [100, 500], parameters: {} }], connections: {} } as any);
      expect(result.statistics.triggerNodes).toBe(3);
    });

    it('should warn when no trigger nodes exist', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: {} }, { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [300, 100], parameters: {} }], connections: { 'Set': { main: [[{ node: 'Code', type: 'main', index: 0 }]] } } } as any);
      expect(result.warnings.some(w => w.message.includes('Workflow has no trigger nodes'))).toBe(true);
    });

    it('should not count disabled nodes in enabledNodes count', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, disabled: true }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: {} } as any);
      expect(result.statistics.totalNodes).toBe(2);
      expect(result.statistics.enabledNodes).toBe(1);
    });

    it('should handle very large workflows', async () => {
      const nodes = Array(1000).fill(null).map((_, i) => ({ id: `node${i}`, name: `Node ${i}`, type: 'n8n-nodes-base.set', position: [i * 100, 0] as [number, number], parameters: {} }));
      const connections: any = {};
      for (let i = 0; i < 999; i++) { connections[`Node ${i}`] = { main: [[{ node: `Node ${i + 1}`, type: 'main', index: 0 }]] }; }
      const start = Date.now();
      const result = await validator.validateWorkflow({ nodes, connections } as any);
      expect(result).toBeDefined();
      expect(Date.now() - start).toBeLessThan(process.env.CI ? 10000 : 5000);
    });

    it('should handle invalid position values', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'InvalidPos', type: 'n8n-nodes-base.set', position: 'invalid' as any, parameters: {} }, { id: '2', name: 'NaNPos', type: 'n8n-nodes-base.set', position: [NaN, NaN] as [number, number], parameters: {} }], connections: {} } as any);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle very long node names', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'A'.repeat(1000), type: 'n8n-nodes-base.set', position: [0, 0] as [number, number], parameters: {} }], connections: {} } as any);
      expect(result.warnings.some(w => w.message.includes('very long'))).toBe(true);
    });
  });

  // ─── Node Validation ───────────────────────────────────────────────

  describe('validateAllNodes', () => {
    it('should skip disabled nodes', async () => {
      await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, disabled: true }], connections: {} } as any);
      expect(mockNodeRepository.getNode).not.toHaveBeenCalled();
    });

    it('should accept both nodes-base and n8n-nodes-base prefixes', async () => {
      (mockNodeRepository.getNode as any) = vi.fn((type: string) => type === 'nodes-base.webhook' ? { nodeType: 'nodes-base.webhook', displayName: 'Webhook', properties: [], isVersioned: false } : null);
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'nodes-base.webhook', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.valid).toBe(true);
    });

    it('should try normalized types for n8n-nodes-base', async () => {
      await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(mockNodeRepository.getNode).toHaveBeenCalledWith('nodes-base.webhook');
    });

    it('should validate typeVersion but skip parameter validation for langchain nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1, position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(mockNodeRepository.getNode).toHaveBeenCalledWith('nodes-langchain.agent');
      expect(result.errors.filter(e => e.message.includes('typeVersion'))).toEqual([]);
    });

    it('should catch invalid typeVersion for langchain nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 99999, position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('typeVersion 99999 exceeds maximum'))).toBe(true);
    });

    it('should error for missing typeVersion on versioned nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes("Missing required property 'typeVersion'"))).toBe(true);
    });

    it('should error for invalid typeVersion', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, typeVersion: 'invalid' as any }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Invalid typeVersion: invalid'))).toBe(true);
    });

    it('should warn for outdated typeVersion', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, typeVersion: 1 }], connections: {} } as any);
      expect(result.warnings.some(w => w.message.includes('Outdated typeVersion: 1. Latest is 2'))).toBe(true);
    });

    it('should error for typeVersion exceeding maximum', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, typeVersion: 10 }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('typeVersion 10 exceeds maximum supported version 2'))).toBe(true);
    });

    it('should add node validation errors and warnings', async () => {
      vi.mocked(mockEnhancedConfigValidator.validateWithMode).mockReturnValue({ errors: [{ type: 'missing_required', property: 'url', message: 'Missing required field: url' }], warnings: [{ type: 'security', property: 'url', message: 'Consider using HTTPS' }], suggestions: [], mode: 'operation' as const, valid: false, visibleProperties: [], hiddenProperties: [] } as any);
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, typeVersion: 4 }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Missing required field: url'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Consider using HTTPS'))).toBe(true);
    });

    it('should handle node validation failures gracefully', async () => {
      vi.mocked(mockEnhancedConfigValidator.validateWithMode).mockImplementation(() => { throw new Error('Validation error'); });
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, typeVersion: 4 }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Failed to validate node: Validation error'))).toBe(true);
    });

    it('should handle repository errors gracefully', async () => {
      vi.mocked(mockNodeRepository.getNode).mockImplementation(() => { throw new Error('Database connection failed'); });
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Test', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {} }], connections: {} } as any);
      expect(result).toHaveProperty('valid');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // ─── Connection Validation ─────────────────────────────────────────

  describe('validateConnections', () => {
    it('should validate valid connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.statistics.validConnections).toBe(1);
      expect(result.statistics.invalidConnections).toBe(0);
    });

    it('should error for connection from non-existent node', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }], connections: { 'NonExistent': { main: [[{ node: 'Webhook', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes('Connection from non-existent node: "NonExistent"'))).toBe(true);
    });

    it('should error when using node ID instead of name in source', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: 'webhook-id', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: 'set-id', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: { 'webhook-id': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes("Connection uses node ID 'webhook-id' instead of node name 'Webhook'"))).toBe(true);
    });

    it('should error for connection to non-existent node', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'NonExistent', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes('Connection to non-existent node: "NonExistent"'))).toBe(true);
    });

    it('should error when using node ID instead of name in target', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: 'webhook-id', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: 'set-id', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'set-id', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes("Connection target uses node ID 'set-id' instead of node name 'Set'"))).toBe(true);
    });

    it('should warn for connection to disabled node', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {}, disabled: true }], connections: { 'Webhook': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.warnings.some(w => w.message.includes('Connection to disabled node: "Set"'))).toBe(true);
    });

    it('should detect self-referencing nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'SelfLoop', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }], connections: { 'SelfLoop': { main: [[{ node: 'SelfLoop', type: 'main', index: 0 }]] } } } as any);
      expect(result.warnings.some(w => w.message.includes('self-referencing'))).toBe(true);
    });

    it('should handle invalid connection formats', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Node1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }], connections: { 'Node1': { main: 'invalid-format' as any } } } as any);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle negative output indices', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Node1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }, { id: '2', name: 'Node2', type: 'n8n-nodes-base.set', position: [100, 0], parameters: {} }], connections: { 'Node1': { main: [[{ node: 'Node2', type: 'main', index: -1 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes('Invalid'))).toBe(true);
    });

    it('should validate error outputs', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {} }, { id: '2', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: { 'HTTP': { error: [[{ node: 'Error Handler', type: 'main', index: 0 }]] } } } as any);
      expect(result.statistics.validConnections).toBe(1);
    });

    it('should validate AI tool connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [100, 100], parameters: {} }, { id: '2', name: 'Tool', type: 'n8n-nodes-base.httpRequest', position: [300, 100], parameters: {} }], connections: { 'Agent': { ai_tool: [[{ node: 'Tool', type: 'main', index: 0 }]] } } } as any);
      expect(result.statistics.validConnections).toBe(1);
    });

    it('should warn for orphaned nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }, { id: '3', name: 'Orphaned', type: 'n8n-nodes-base.code', position: [500, 100], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.warnings.some(w => w.message.includes('not reachable from any trigger node') && w.nodeName === 'Orphaned')).toBe(true);
    });

    it('should detect cycles in workflow', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Node1', type: 'n8n-nodes-base.set', position: [100, 100], parameters: {} }, { id: '2', name: 'Node2', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }, { id: '3', name: 'Node3', type: 'n8n-nodes-base.set', position: [500, 100], parameters: {} }], connections: { 'Node1': { main: [[{ node: 'Node2', type: 'main', index: 0 }]] }, 'Node2': { main: [[{ node: 'Node3', type: 'main', index: 0 }]] }, 'Node3': { main: [[{ node: 'Node1', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.some(e => e.message.includes('Workflow contains a cycle'))).toBe(true);
    });

    it('should handle null connections properly', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'IF', type: 'n8n-nodes-base.if', position: [100, 100], parameters: {}, typeVersion: 2 }, { id: '2', name: 'True Branch', type: 'n8n-nodes-base.set', position: [300, 50], parameters: {}, typeVersion: 3 }], connections: { 'IF': { main: [[{ node: 'True Branch', type: 'main', index: 0 }], null] } } } as any);
      expect(result.statistics.validConnections).toBe(1);
    });

    it('should continue validation after encountering errors', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: null as any, type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }, { id: '2', name: 'Valid', type: 'n8n-nodes-base.set', position: [100, 0], parameters: {} }, { id: '3', name: 'AlsoValid', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }], connections: { 'Valid': { main: [[{ node: 'AlsoValid', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.statistics.validConnections).toBeGreaterThan(0);
    });
  });

  // ─── Expression Validation ─────────────────────────────────────────

  describe('validateExpressions', () => {
    it('should validate expressions in node parameters', async () => {
      await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: { values: { string: [{ name: 'field', value: '={{ $json.data }}' }] } } }], connections: { 'Webhook': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(ExpressionValidator.validateNodeExpressions).toHaveBeenCalledWith(expect.objectContaining({ values: expect.any(Object) }), expect.objectContaining({ currentNodeName: 'Set', hasInputData: true }));
    });

    it('should add expression errors to result', async () => {
      vi.mocked(ExpressionValidator.validateNodeExpressions).mockReturnValue({ valid: false, errors: ['Invalid expression syntax'], warnings: ['Deprecated variable usage'], usedVariables: new Set(['$json']), usedNodes: new Set() });
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: { value: '={{ invalid }}' } }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Expression error: Invalid expression syntax'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Expression warning: Deprecated variable usage'))).toBe(true);
    });

    it('should skip expression validation for disabled nodes', async () => {
      await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: { value: '={{ $json.data }}' }, disabled: true }], connections: {} } as any);
      expect(ExpressionValidator.validateNodeExpressions).not.toHaveBeenCalled();
    });

    it('should skip expression validation when option is false', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Node1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: { value: '{{ $json.data }}' } }], connections: {} } as any, { validateExpressions: false });
      expect(result.statistics.expressionsValidated).toBe(0);
    });
  });

  // ─── Expression Format Detection ──────────────────────────────────

  describe('Expression Format Detection', () => {
    it('should detect missing = prefix in simple expressions', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Send Email', type: 'n8n-nodes-base.emailSend', position: [0, 0], parameters: { fromEmail: '{{ $env.SENDER_EMAIL }}', toEmail: 'user@example.com', subject: 'Test' }, typeVersion: 2.1 }], connections: {} } as any);
      expect(result.valid).toBe(false);
      const formatErrors = result.errors.filter(e => e.message.includes('Expression format error'));
      expect(formatErrors).toHaveLength(1);
      expect(formatErrors[0].message).toContain('fromEmail');
      expect(formatErrors[0].message).toContain('={{ $env.SENDER_EMAIL }}');
    });

    it('should detect missing resource locator format for GitHub fields', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'GitHub', type: 'n8n-nodes-base.github', position: [0, 0], parameters: { operation: 'createComment', owner: '{{ $vars.GITHUB_OWNER }}', repository: '{{ $vars.GITHUB_REPO }}', issueNumber: 123, body: 'Test' }, typeVersion: 1.1 }], connections: {} } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.find(e => e.message.includes('owner'))?.message).toContain('resource locator format');
    });

    it('should detect mixed content without prefix', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: { url: 'https://api.example.com/{{ $json.endpoint }}' }, typeVersion: 4 }], connections: {} } as any);
      const urlError = result.errors.find(e => e.message.includes('Expression format') && e.message.includes('url'));
      expect(urlError).toBeTruthy();
      expect(urlError?.message).toContain('=https://api.example.com/{{ $json.endpoint }}');
    });

    it('should accept properly formatted expressions', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Send Email', type: 'n8n-nodes-base.emailSend', position: [0, 0], parameters: { fromEmail: '={{ $env.SENDER_EMAIL }}', toEmail: 'user@example.com', subject: '=Test {{ $json.type }}' }, typeVersion: 2.1 }], connections: {} } as any);
      expect(result.errors.filter(e => e.message.includes('Expression format'))).toHaveLength(0);
    });

    it('should accept resource locator format', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'GitHub', type: 'n8n-nodes-base.github', position: [0, 0], parameters: { operation: 'createComment', owner: { __rl: true, value: '={{ $vars.GITHUB_OWNER }}', mode: 'expression' }, repository: { __rl: true, value: '={{ $vars.GITHUB_REPO }}', mode: 'expression' }, issueNumber: 123, body: '=Test from {{ $json.author }}' }, typeVersion: 1.1 }], connections: {} } as any);
      expect(result.errors.filter(e => e.message.includes('Expression format'))).toHaveLength(0);
    });

    it('should provide clear fix examples in error messages', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Process Data', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: { url: 'https://api.example.com/users/{{ $json.userId }}' }, typeVersion: 4 }], connections: {} } as any);
      const error = result.errors.find(e => e.message.includes('Expression format'));
      expect(error?.message).toContain('Current (incorrect):');
      expect(error?.message).toContain('Fixed (correct):');
    });
  });

  // ─── Error Handler Detection ───────────────────────────────────────

  describe('Error Handler Detection', () => {
    it('should identify error handlers by node name patterns', async () => {
      for (const errorName of ['Error Handler', 'Handle Error', 'Catch Exception', 'Failure Response']) {
        const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Source', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {} }, { id: '2', name: 'Success', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: errorName, type: 'n8n-nodes-base.set', position: [200, 100], parameters: {} }], connections: { 'Source': { main: [[{ node: 'Success', type: 'main', index: 0 }, { node: errorName, type: 'main', index: 0 }]] } } } as any);
        expect(result.errors.some(e => e.message.includes('Incorrect error output configuration') && e.message.includes(errorName))).toBe(true);
      }
    });

    it('should not flag success node names as error handlers', async () => {
      for (const name of ['Process Data', 'Transform', 'Normal Flow']) {
        const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Source', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {} }, { id: '2', name: 'First', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: name, type: 'n8n-nodes-base.set', position: [200, 100], parameters: {} }], connections: { 'Source': { main: [[{ node: 'First', type: 'main', index: 0 }, { node: name, type: 'main', index: 0 }]] } } } as any);
        expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
      }
    });

    it('should generate valid JSON in error messages', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'API Call', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {} }, { id: '2', name: 'Success', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: 'Error Handler', type: 'n8n-nodes-base.respondToWebhook', position: [200, 100], parameters: {} }], connections: { 'API Call': { main: [[{ node: 'Success', type: 'main', index: 0 }, { node: 'Error Handler', type: 'main', index: 0 }]] } } } as any);
      const errorMsg = result.errors.find(e => e.message.includes('Incorrect error output configuration'));
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain('INCORRECT (current):');
      expect(errorMsg!.message).toContain('CORRECT (should be):');
    });
  });

  // ─── onError Property Validation ───────────────────────────────────

  describe('onError Property Validation', () => {
    it('should validate onError property combinations', async () => {
      // onError set but no error connections -> error
      const r1 = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Test', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {}, onError: 'continueErrorOutput' }, { id: '2', name: 'Next', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }], connections: { 'Test': { main: [[{ node: 'Next', type: 'main', index: 0 }]] } } } as any);
      expect(r1.errors.some(e => e.message.includes("has onError: 'continueErrorOutput' but no error output connections"))).toBe(true);

      // error connections but no onError -> warning
      const r2 = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Test', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {} }, { id: '2', name: 'Success', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: 'ErrH', type: 'n8n-nodes-base.set', position: [200, 100], parameters: {} }], connections: { 'Test': { main: [[{ node: 'Success', type: 'main', index: 0 }], [{ node: 'ErrH', type: 'main', index: 0 }]] } } } as any);
      expect(r2.warnings.some(w => w.message.includes('error output connections in main[1] but missing onError'))).toBe(true);
    });

    it('should only flag continueErrorOutput without error connections', async () => {
      for (const val of ['continueRegularOutput', 'stopWorkflow']) {
        const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Test', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {}, onError: val }, { id: '2', name: 'Next', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }], connections: { 'Test': { main: [[{ node: 'Next', type: 'main', index: 0 }]] } } } as any);
        expect(result.errors.some(e => e.message.includes('but no error output connections'))).toBe(false);
      }
    });
  });

  // ─── Workflow Patterns ─────────────────────────────────────────────

  describe('checkWorkflowPatterns', () => {
    it('should suggest error handling for large workflows', async () => {
      const builder = createWorkflow('Large');
      for (let i = 0; i < 5; i++) builder.addCustomNode('n8n-nodes-base.set', 3, {}, { name: `Set${i}` });
      expect((await validator.validateWorkflow(builder.build() as any)).warnings.some(w => w.message.includes('Consider adding error handling'))).toBe(true);
    });

    it('should warn about long linear chains', async () => {
      const builder = createWorkflow('Linear');
      const names: string[] = [];
      for (let i = 0; i < 12; i++) { const n = `Node${i}`; builder.addCustomNode('n8n-nodes-base.set', 3, {}, { name: n }); names.push(n); }
      builder.connectSequentially(names);
      expect((await validator.validateWorkflow(builder.build() as any)).warnings.some(w => w.message.includes('Long linear chain detected'))).toBe(true);
    });

    it('should warn about AI agents without tools', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.warnings.some(w => w.message.includes('AI Agent has no tools connected'))).toBe(true);
    });

    it('should NOT warn about AI agents WITH tools', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Tool', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [300, 100], parameters: {} }], connections: { 'Tool': { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] } } } as any);
      expect(result.warnings.some(w => w.message.includes('AI Agent has no tools connected'))).toBe(false);
    });
  });

  // ─── Node Error Handling ───────────────────────────────────────────

  describe('checkNodeErrorHandling', () => {
    it('should error when node-level properties are inside parameters', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], typeVersion: 4, parameters: { url: 'https://api.example.com', onError: 'continueRegularOutput', retryOnFail: true, credentials: {} } }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Node-level properties onError, retryOnFail, credentials are in the wrong location'))).toBe(true);
    });

    it('should validate onError property values', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, onError: 'invalidValue' as any }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Invalid onError value: "invalidValue"'))).toBe(true);
    });

    it('should warn about deprecated continueOnFail', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, continueOnFail: true }], connections: {} } as any);
      expect(result.warnings.some(w => w.message.includes('Using deprecated "continueOnFail: true"'))).toBe(true);
    });

    it('should error for conflicting error handling properties', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, continueOnFail: true, onError: 'continueRegularOutput' }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('Cannot use both "continueOnFail" and "onError" properties'))).toBe(true);
    });

    it('should validate retry configuration', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, retryOnFail: true, maxTries: 'invalid' as any, waitBetweenTries: -1000 }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('maxTries must be a positive number'))).toBe(true);
      expect(result.errors.some(e => e.message.includes('waitBetweenTries must be a non-negative number'))).toBe(true);
    });

    it('should validate other node-level properties', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: {}, typeVersion: 3, alwaysOutputData: 'invalid' as any, executeOnce: 'invalid' as any, disabled: 'invalid' as any, notesInFlow: 'invalid' as any, notes: 123 as any }], connections: {} } as any);
      expect(result.errors.some(e => e.message.includes('alwaysOutputData must be a boolean'))).toBe(true);
      expect(result.errors.some(e => e.message.includes('executeOnce must be a boolean'))).toBe(true);
      expect(result.errors.some(e => e.message.includes('disabled must be a boolean'))).toBe(true);
    });
  });

  // ─── Trigger Reachability ──────────────────────────────────────────

  describe('Trigger reachability', () => {
    it('should flag disconnected subgraph as unreachable', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} }, { id: '2', name: 'Connected', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: 'Island1', type: 'n8n-nodes-base.code', position: [0, 300], parameters: {} }, { id: '4', name: 'Island2', type: 'n8n-nodes-base.set', position: [200, 300], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'Connected', type: 'main', index: 0 }]] }, 'Island1': { main: [[{ node: 'Island2', type: 'main', index: 0 }]] } } } as any);
      const unreachable = result.warnings.filter(w => w.message.includes('not reachable from any trigger'));
      expect(unreachable.length).toBe(2);
    });

    it('should not flag disabled nodes or sticky notes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} }, { id: '3', name: 'Disabled', type: 'n8n-nodes-base.code', position: [500, 500], parameters: {}, disabled: true }, { id: '4', name: 'Note', type: 'n8n-nodes-base.stickyNote', position: [500, 600], parameters: {} }], connections: { 'Webhook': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.warnings.filter(w => w.nodeName === 'Disabled' || w.nodeName === 'Note')).toHaveLength(0);
    });
  });

  // ─── Tool Variant Validation ───────────────────────────────────────

  describe('Tool Variant Validation', () => {
    let toolVariantRepo: NodeRepository;

    beforeEach(() => {
      toolVariantRepo = { getNode: vi.fn((t: string) => {
        const m: Record<string, any> = {
          'nodes-base.supabase': { nodeType: 'nodes-base.supabase', displayName: 'Supabase', isAITool: true, hasToolVariant: true, isToolVariant: false, properties: [] },
          'nodes-base.supabaseTool': { nodeType: 'nodes-base.supabaseTool', displayName: 'Supabase Tool', isAITool: true, hasToolVariant: false, isToolVariant: true, toolVariantOf: 'nodes-base.supabase', properties: [] },
          'nodes-langchain.toolCalculator': { nodeType: 'nodes-langchain.toolCalculator', displayName: 'Calculator', isAITool: true, properties: [] },
          'nodes-base.httpRequest': { nodeType: 'nodes-base.httpRequest', displayName: 'HTTP Request', isAITool: false, hasToolVariant: false, isToolVariant: false, properties: [] },
          'nodes-base.googleDrive': { nodeType: 'nodes-base.googleDrive', displayName: 'Google Drive', isAITool: false, hasToolVariant: false, isToolVariant: false, properties: [] },
          'nodes-base.googleSheets': { nodeType: 'nodes-base.googleSheets', displayName: 'Google Sheets', isAITool: false, hasToolVariant: false, isToolVariant: false, properties: [] },
          'nodes-langchain.agent': { nodeType: 'nodes-langchain.agent', displayName: 'AI Agent', properties: [] },
        };
        return m[t] || null;
      }) } as any;
      validator = new WorkflowValidator(toolVariantRepo, mockEnhancedConfigValidator);
    });

    it('should pass for langchain tool nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Calc', type: 'n8n-nodes-langchain.toolCalculator', typeVersion: 1.2, position: [250, 300], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1.7, position: [450, 300], parameters: {} }], connections: { Calc: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] } } } as any);
      expect(result.errors.filter(e => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL')).toHaveLength(0);
    });

    it('should pass for Tool variant nodes', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Supabase Tool', type: 'n8n-nodes-base.supabaseTool', typeVersion: 1, position: [250, 300], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1.7, position: [450, 300], parameters: {} }], connections: { 'Supabase Tool': { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] } } } as any);
      expect(result.errors.filter(e => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL')).toHaveLength(0);
    });

    it('should fail when base node is used instead of Tool variant', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Supabase', type: 'n8n-nodes-base.supabase', typeVersion: 1, position: [250, 300], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1.7, position: [450, 300], parameters: {} }], connections: { Supabase: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] } } } as any);
      const errors = result.errors.filter(e => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL');
      expect(errors).toHaveLength(1);
      expect((errors[0] as any).fix?.suggestedType).toBe('n8n-nodes-base.supabaseTool');
    });

    it('should not error for base nodes without ai_tool connections', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Supabase', type: 'n8n-nodes-base.supabase', typeVersion: 1, position: [250, 300], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 1, position: [450, 300], parameters: {} }], connections: { Supabase: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } } as any);
      expect(result.errors.filter(e => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL')).toHaveLength(0);
    });

    it('should not error when base node without Tool variant uses ai_tool', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 1, position: [250, 300], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1.7, position: [450, 300], parameters: {} }], connections: { 'HTTP': { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] } } } as any);
      expect(result.errors.filter(e => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL')).toHaveLength(0);
      expect(result.errors.filter(e => e.code === 'INVALID_AI_TOOL_SOURCE').length).toBeGreaterThan(0);
    });

    it('should infer googleDriveTool when googleDrive exists', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'GDT', type: 'n8n-nodes-base.googleDriveTool', typeVersion: 3, position: [250, 300], parameters: {} }], connections: {} } as any);
      expect(result.errors.filter(e => e.message?.includes('Unknown node type'))).toHaveLength(0);
      expect(result.warnings.filter(e => (e as any).code === 'INFERRED_TOOL_VARIANT')).toHaveLength(1);
    });

    it('should error for unknownNodeTool when base does not exist', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Unknown', type: 'n8n-nodes-base.nonExistentNodeTool', typeVersion: 1, position: [250, 300], parameters: {} }], connections: {} } as any);
      expect(result.errors.filter(e => e.message?.includes('Unknown node type'))).toHaveLength(1);
    });

    it('should prefer database record over inference for supabaseTool', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'ST', type: 'n8n-nodes-base.supabaseTool', typeVersion: 1, position: [250, 300], parameters: {} }], connections: {} } as any);
      expect(result.errors.filter(e => e.message?.includes('Unknown node type'))).toHaveLength(0);
      expect(result.warnings.filter(e => (e as any).code === 'INFERRED_TOOL_VARIANT')).toHaveLength(0);
    });
  });

  // ─── AI Sub-Node Main Connection Detection ─────────────────────────

  describe('AI Sub-Node Main Connection Detection', () => {
    function makeAIWorkflow(sourceType: string, sourceName: string) {
      return { nodes: [{ id: '1', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} }, { id: '2', name: sourceName, type: sourceType, position: [200, 0], parameters: {} }, { id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} }], connections: { 'Manual Trigger': { main: [[{ node: sourceName, type: 'main', index: 0 }]] }, [sourceName]: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } } };
    }

    it('should flag LLM node connected via main', async () => {
      const result = await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 'Gemini') as any);
      const error = result.errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION');
      expect(error).toBeDefined();
      expect(error!.message).toContain('ai_languageModel');
    });

    it('should flag memory node connected via main', async () => {
      const result = await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.memoryBufferWindow', 'Memory') as any);
      expect(result.errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')?.message).toContain('ai_memory');
    });

    it('should flag embeddings node connected via main', async () => {
      const result = await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.embeddingsOpenAi', 'Embed') as any);
      expect(result.errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')?.message).toContain('ai_embedding');
    });

    it('should NOT flag regular langchain nodes via main', async () => {
      expect((await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.agent', 'Agent') as any)).errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')).toBeUndefined();
      expect((await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.openAi', 'OpenAI') as any)).errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')).toBeUndefined();
    });

    it('should NOT flag dynamic-output nodes', async () => {
      expect((await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.textClassifier', 'TC') as any)).errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')).toBeUndefined();
      expect((await validator.validateWorkflow(makeAIWorkflow('@n8n/n8n-nodes-langchain.vectorStoreInMemory', 'VS') as any)).errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')).toBeUndefined();
    });

    it('should NOT flag sub-node connected via correct AI type', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} }, { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 0], parameters: {} }, { id: '3', name: 'Gemini', type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', position: [200, 200], parameters: {} }], connections: { 'Trigger': { main: [[{ node: 'Agent', type: 'main', index: 0 }]] }, 'Gemini': { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] } } } as any);
      expect(result.errors.find(e => e.code === 'AI_SUBNODE_MAIN_CONNECTION')).toBeUndefined();
    });
  });

  // ─── Suggestions ───────────────────────────────────────────────────

  describe('generateSuggestions', () => {
    it('should suggest adding trigger', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [100, 100], parameters: {} }], connections: {} } as any);
      expect(result.suggestions.some(s => s.includes('Add a trigger node'))).toBe(true);
    });

    it('should provide connection examples', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} }, { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} }], connections: {} } as any);
      expect(result.suggestions.some(s => s.includes('Example connection structure'))).toBe(true);
    });

    it('should suggest breaking up large workflows', async () => {
      const builder = createWorkflow('Large');
      for (let i = 0; i < 25; i++) builder.addCustomNode('n8n-nodes-base.set', 3, {}, { name: `N${i}` });
      expect((await validator.validateWorkflow(builder.build() as any)).suggestions.some(s => s.includes('Consider breaking this workflow'))).toBe(true);
    });
  });

  // ─── Validation Options ────────────────────────────────────────────

  describe('Validation Options', () => {
    it('should validate connections only', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'N1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }, { id: '2', name: 'N2', type: 'n8n-nodes-base.set', position: [100, 0], parameters: {} }], connections: { 'N1': { main: [[{ node: 'N2', type: 'main', index: 0 }]] } } } as any, { validateNodes: false, validateExpressions: false, validateConnections: true });
      expect(result.statistics.validConnections).toBe(1);
    });

    it('should validate expressions only', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'N1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: { value: '{{ $json.data }}' } }], connections: {} } as any, { validateNodes: false, validateExpressions: true, validateConnections: false });
      expect(result.statistics.expressionsValidated).toBeGreaterThan(0);
    });
  });

  // ─── Integration Tests ─────────────────────────────────────────────

  describe('Integration Tests', () => {
    it('should validate a complex workflow with multiple issues', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {}, typeVersion: 2 }, { id: '2', name: 'HTTP1', type: 'nodes-base.httpRequest', position: [300, 100], parameters: {} }, { id: '3', name: 'Slack', type: 'n8n-nodes-base.slack', position: [500, 100], parameters: {} }, { id: '4', name: 'Disabled', type: 'n8n-nodes-base.set', position: [700, 100], parameters: {}, disabled: true }, { id: '5', name: 'HTTP2', type: 'n8n-nodes-base.httpRequest', position: [900, 100], parameters: { onError: 'continueRegularOutput' }, typeVersion: 4 }, { id: '6', name: 'Orphaned', type: 'n8n-nodes-base.code', position: [1100, 100], parameters: {}, typeVersion: 2 }, { id: '7', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [100, 300], parameters: {}, typeVersion: 1 }], connections: { 'Webhook': { main: [[{ node: 'HTTP1', type: 'main', index: 0 }]] }, 'HTTP1': { main: [[{ node: 'Slack', type: 'main', index: 0 }]] }, 'Slack': { main: [[{ node: 'Disabled', type: 'main', index: 0 }]] }, '5': { main: [[{ node: 'Agent', type: 'main', index: 0 }]] } } } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes("Missing required property 'typeVersion'"))).toBe(true);
      expect(result.errors.some(e => e.message.includes('Node-level properties onError are in the wrong location'))).toBe(true);
      expect(result.errors.some(e => e.message.includes("Connection uses node ID '5'"))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Connection to disabled node'))).toBe(true);
      expect(result.statistics.totalNodes).toBe(7);
    });

    it('should validate a perfect workflow', async () => {
      const result = await validator.validateWorkflow({ nodes: [{ id: '1', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', position: [250, 300], parameters: {}, typeVersion: 1 }, { id: '2', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', position: [450, 300], parameters: { url: 'https://api.example.com', method: 'GET' }, typeVersion: 4, onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 }, { id: '3', name: 'Process', type: 'n8n-nodes-base.code', position: [650, 300], parameters: { jsCode: 'return items;' }, typeVersion: 2 }, { id: '4', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [650, 500], parameters: {}, typeVersion: 3 }], connections: { 'Manual Trigger': { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] }, 'HTTP Request': { main: [[{ node: 'Process', type: 'main', index: 0 }], [{ node: 'Error Handler', type: 'main', index: 0 }]] } } } as any);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.statistics.validConnections).toBe(3);
    });
  });

  // ─── If/Switch conditions validation ──────────────────────────────

  describe('If/Switch conditions validation (validateConditionNodeStructure)', () => {
    it('If v2.3 missing conditions.options → error', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.3,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and'
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('options'))).toBe(true);
    });

    it('If v2.3 with complete options → no error', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.3,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
            conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and'
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors).toHaveLength(0);
    });

    it('If v2.0 without options → no error', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.0,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and'
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors).toHaveLength(0);
    });

    it('If v2.0 with bad operator (missing type) → operator error', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.0,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { operation: 'equals' } }],
            combinator: 'and'
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('type'))).toBe(true);
    });

    it('If v1 with old format → no errors', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 1,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: { string: [{ value1: '={{ $json.x }}', value2: 'a', operation: 'equals' }] }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors).toHaveLength(0);
    });

    it('Switch v3.2 missing rule options → error', () => {
      const node = {
        id: '1', name: 'Switch', type: 'n8n-nodes-base.switch', typeVersion: 3.2,
        position: [0, 0] as [number, number],
        parameters: {
          rules: {
            rules: [{
              conditions: {
                conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
                combinator: 'and'
              },
              outputKey: 'Branch 1'
            }]
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('rules.rules[0].conditions.options'))).toBe(true);
    });

    it('Switch v3.2 with complete options → no error', () => {
      const node = {
        id: '1', name: 'Switch', type: 'n8n-nodes-base.switch', typeVersion: 3.2,
        position: [0, 0] as [number, number],
        parameters: {
          rules: {
            rules: [{
              conditions: {
                options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
                conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
                combinator: 'and'
              },
              outputKey: 'Branch 1'
            }]
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors).toHaveLength(0);
    });

    it('If v2.2 with empty parameters (missing conditions) → no error (graceful)', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.2,
        position: [0, 0] as [number, number],
        parameters: {}
      };
      const errors = validateConditionNodeStructure(node);
      // Empty parameters are allowed — draft/incomplete nodes are valid at this level
      expect(errors).toHaveLength(0);
    });

    it('Switch v3.0 without options → no error', () => {
      const node = {
        id: '1', name: 'Switch', type: 'n8n-nodes-base.switch', typeVersion: 3.0,
        position: [0, 0] as [number, number],
        parameters: {
          rules: {
            rules: [{
              conditions: {
                conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
                combinator: 'and'
              },
              outputKey: 'Branch 1'
            }]
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors).toHaveLength(0);
    });
  });
});
