import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { ExpressionValidator } from '@/services/expression-validator';

// Mock dependencies
vi.mock('@/database/node-repository');
vi.mock('@/services/enhanced-config-validator');
vi.mock('@/services/expression-validator');
vi.mock('@/utils/logger');

/**
 * Regression tests from the 2026-07 validator false-positive audit (Stage 1).
 * Each block reproduces a construct that runs fine on real n8n (live-verified)
 * and asserts the validator no longer reports a false error, plus guard tests
 * proving the corresponding true positives still fire.
 */
describe('WorkflowValidator - false-positive audit fixes (Stage 1)', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: NodeRepository;

  const nodeTypes: Record<string, any> = {
    'nodes-base.webhook': { nodeType: 'nodes-base.webhook', displayName: 'Webhook', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.manualTrigger': { nodeType: 'nodes-base.manualTrigger', displayName: 'Manual Trigger', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.respondToWebhook': { nodeType: 'nodes-base.respondToWebhook', displayName: 'Respond to Webhook', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.set': { nodeType: 'nodes-base.set', displayName: 'Set', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.code': { nodeType: 'nodes-base.code', displayName: 'Code', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.httpRequest': { nodeType: 'nodes-base.httpRequest', displayName: 'HTTP Request', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.if': { nodeType: 'nodes-base.if', displayName: 'IF', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main', 'main'], properties: [] },
    'nodes-base.switch': { nodeType: 'nodes-base.switch', displayName: 'Switch', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main', 'main', 'main', 'main'], properties: [] },
    'nodes-base.splitInBatches': { nodeType: 'nodes-base.splitInBatches', displayName: 'Loop Over Items', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main', 'main'], properties: [] },
    'nodes-base.merge': { nodeType: 'nodes-base.merge', displayName: 'Merge', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.airtable': { nodeType: 'nodes-base.airtable', displayName: 'Airtable', package: 'n8n-nodes-base', version: 2.1, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-langchain.agent': { nodeType: 'nodes-langchain.agent', displayName: 'AI Agent', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-langchain.lmChatOpenAi': { nodeType: 'nodes-langchain.lmChatOpenAi', displayName: 'OpenAI Chat Model', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['ai_languageModel'], properties: [] },
    'nodes-langchain.memoryBufferWindow': { nodeType: 'nodes-langchain.memoryBufferWindow', displayName: 'Window Buffer Memory', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['ai_memory'], properties: [] },
    'nodes-langchain.textClassifier': { nodeType: 'nodes-langchain.textClassifier', displayName: 'Text Classifier', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['={{}}'], properties: [] },
    // Known community node at a stale snapshot version (audit: pinecone assistant 1.2 vs DB max 1)
    'n8n-nodes-pinecone.pineconeAssistant': { nodeType: 'n8n-nodes-pinecone.pineconeAssistant', displayName: 'Pinecone Assistant', package: 'n8n-nodes-pinecone', version: 1, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.telegramTrigger': { nodeType: 'nodes-base.telegramTrigger', displayName: 'Telegram Trigger', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.googleDrive': { nodeType: 'nodes-base.googleDrive', displayName: 'Google Drive', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'n8n-nodes-firecrawl.scrape': { nodeType: 'n8n-nodes-firecrawl.scrape', displayName: 'Firecrawl', package: 'n8n-nodes-firecrawl', isVersioned: false, isAITool: false, outputs: ['main'], properties: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeRepository = new NodeRepository({} as any) as any;
    if (!mockNodeRepository.getAllNodes) { mockNodeRepository.getAllNodes = vi.fn(); }
    if (!mockNodeRepository.getNode) { mockNodeRepository.getNode = vi.fn(); }

    vi.mocked(mockNodeRepository.getNode).mockImplementation((nodeType: string) => nodeTypes[nodeType] || null);
    vi.mocked(mockNodeRepository.getAllNodes).mockReturnValue(Object.values(nodeTypes));

    vi.mocked(EnhancedConfigValidator.validateWithMode).mockReturnValue({
      errors: [], warnings: [], suggestions: [], mode: 'operation' as const, valid: true, visibleProperties: [], hiddenProperties: [],
    } as any);

    vi.mocked(ExpressionValidator.validateNodeExpressions).mockReturnValue({
      valid: true, errors: [], warnings: [], usedVariables: new Set(), usedNodes: new Set(),
    });

    validator = new WorkflowValidator(mockNodeRepository, EnhancedConfigValidator as any);
  });

  // ─── A2a: webhook responseNode does not require onError ────────────

  describe('A2a: responseNode webhook pattern', () => {
    const responseNodeWorkflow = () => ({
      nodes: [
        { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { responseMode: 'responseNode' } },
        { id: '2', name: 'Prepare', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        { id: '3', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', position: [400, 0], parameters: {} },
      ],
      connections: {
        'Webhook': { main: [[{ node: 'Prepare', type: 'main', index: 0 }]] },
        'Prepare': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      },
    });

    it('does not error when responseMode=responseNode has no onError (n8n auto-returns 500)', async () => {
      const result = await validator.validateWorkflow(responseNodeWorkflow() as any);
      expect(result.errors.filter(e => e.message.includes('responseNode mode requires onError'))).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    it('guard: regular webhook without error handling still warns (strict)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Prepare', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: { 'Webhook': { main: [[{ node: 'Prepare', type: 'main', index: 0 }]] } },
      };
      const result = await validator.validateWorkflow(workflow as any, { profile: 'strict' });
      expect(result.warnings.some(w => w.message.includes('Webhook node without error handling'))).toBe(true);
    });
  });

  // ─── A2b + B1: node-type-aware error output configuration ──────────

  describe('A2b/B1: error output configuration', () => {
    it('does not warn for IF with both natural branches wired and no onError', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'True', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'False', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': { main: [[{ node: 'True', type: 'main', index: 0 }], [{ node: 'False', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message.includes("missing onError: 'continueErrorOutput'"))).toHaveLength(0);
    });

    it('does not warn for SplitInBatches with loop output wired and no onError', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Loop', type: 'n8n-nodes-base.splitInBatches', position: [200, 0], parameters: {} },
          { id: '3', name: 'Done', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Body', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
          'Loop': { main: [[{ node: 'Done', type: 'main', index: 0 }], [{ node: 'Body', type: 'main', index: 0 }]] },
          'Body': { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message.includes("missing onError: 'continueErrorOutput'"))).toHaveLength(0);
    });

    it('does not warn for Switch with all rule outputs wired and no onError', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Router', type: 'n8n-nodes-base.switch', position: [200, 0], parameters: { rules: { values: [{ v: 'a' }, { v: 'b' }] } } },
          { id: '3', name: 'A', type: 'nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'B', type: 'nodes-base.set', position: [400, 100], parameters: {} },
          { id: '5', name: 'Fallback', type: 'nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Router', type: 'main', index: 0 }]] },
          'Router': {
            main: [
              [{ node: 'A', type: 'main', index: 0 }],
              [{ node: 'B', type: 'main', index: 0 }],
              [{ node: 'Fallback', type: 'main', index: 0 }],
            ],
          },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message.includes("missing onError: 'continueErrorOutput'"))).toHaveLength(0);
    });

    it('guard: single-output node with main[1] wired and no onError still warns', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: {} },
          { id: '3', name: 'OK', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Errs', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
          'HTTP': { main: [[{ node: 'OK', type: 'main', index: 0 }], [{ node: 'Errs', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.some(w =>
        w.nodeName === 'HTTP' && w.message.includes("main[1] but missing onError: 'continueErrorOutput'")
      )).toBe(true);
    });

    it('unwired error output with continueErrorOutput is a warning, not an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'OK', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
          'HTTP': { main: [[{ node: 'OK', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes("onError: 'continueErrorOutput'"))).toHaveLength(0);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w =>
        w.nodeName === 'HTTP' &&
        w.message.includes("onError: 'continueErrorOutput'") &&
        w.message.includes('silently dropped')
      )).toBe(true);
    });

    it('is silent about the unwired error output at minimal profile', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'OK', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
          'HTTP': { main: [[{ node: 'OK', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any, { profile: 'minimal' });
      expect(result.errors.filter(e => e.message.includes("onError: 'continueErrorOutput'"))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('silently dropped'))).toHaveLength(0);
    });

    it('IF with continueErrorOutput and no handler at main[2] warns about main[2], not main[1]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'True', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'False', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': { main: [[{ node: 'True', type: 'main', index: 0 }], [{ node: 'False', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.nodeName === 'Route' && w.message.includes('silently dropped'));
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('main[2]');
      expect(result.errors.filter(e => e.message.includes("onError: 'continueErrorOutput'"))).toHaveLength(0);
    });

    it('IF with continueErrorOutput and a handler at main[2] does not warn', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'True', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'False', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
          { id: '5', name: 'ErrH', type: 'n8n-nodes-base.set', position: [400, 400], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': {
            main: [
              [{ node: 'True', type: 'main', index: 0 }],
              [{ node: 'False', type: 'main', index: 0 }],
              [{ node: 'ErrH', type: 'main', index: 0 }],
            ],
          },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message.includes('silently dropped'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes("missing onError: 'continueErrorOutput'"))).toHaveLength(0);
      expect(result.errors.filter(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS')).toHaveLength(0);
    });
  });

  // ─── A6: Merge input bounds ─────────────────────────────────────────

  describe('A6: Merge input index bounds', () => {
    const mergeWorkflow = (mergeParams: any, maxIndex: number) => {
      const nodes: any[] = [
        { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
        { id: 'm', name: 'Merge', type: 'n8n-nodes-base.merge', position: [600, 0], parameters: mergeParams },
      ];
      const connections: any = { 'Trigger': { main: [[]] } };
      for (let i = 0; i <= maxIndex; i++) {
        const name = `Set${i}`;
        nodes.push({ id: `s${i}`, name, type: 'n8n-nodes-base.set', position: [200, i * 100], parameters: {} });
        connections['Trigger'].main[0].push({ node: name, type: 'main', index: 0 });
        connections[name] = { main: [[{ node: 'Merge', type: 'main', index: i }]] };
      }
      return { nodes, connections };
    };

    it('does not error when numberInputs is absent and inputs 2..3 are wired (n8n ignores extras)', async () => {
      const result = await validator.validateWorkflow(mergeWorkflow({}, 3) as any);
      expect(result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS')).toHaveLength(0);
      expect(result.valid).toBe(true);
      const ignored = result.warnings.filter(w => w.code === 'MERGE_EXTRA_INPUTS_IGNORED');
      expect(ignored.length).toBe(2); // inputs 2 and 3
      expect(ignored[0].message).toContain('ignore');
    });

    it('guard: explicit numberInputs exceeded is still a hard error', async () => {
      const result = await validator.validateWorkflow(mergeWorkflow({ numberInputs: 2 }, 3) as any);
      const errors = result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('skips the bounds check when numberInputs is an expression', async () => {
      const result = await validator.validateWorkflow(mergeWorkflow({ numberInputs: '={{ $json.n }}' }, 3) as any);
      expect(result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS')).toHaveLength(0);
      expect(result.warnings.filter(w => w.code === 'MERGE_EXTRA_INPUTS_IGNORED')).toHaveLength(0);
    });

    it('guard: explicit numberInputs covering all wired inputs stays clean', async () => {
      const result = await validator.validateWorkflow(mergeWorkflow({ numberInputs: 4 }, 3) as any);
      expect(result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS')).toHaveLength(0);
      expect(result.warnings.filter(w => w.code === 'MERGE_EXTRA_INPUTS_IGNORED')).toHaveLength(0);
    });
  });

  // ─── A6: cycle detection ────────────────────────────────────────────

  describe('A6: cycle detection', () => {
    it('does not flag a revision loop routed by a langchain multi-output router (textClassifier)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Generate Post', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Classify', type: '@n8n/n8n-nodes-langchain.textClassifier', position: [400, 0], parameters: {} },
          { id: '4', name: 'Publish', type: 'n8n-nodes-base.set', position: [600, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Generate Post', type: 'main', index: 0 }]] },
          'Generate Post': { main: [[{ node: 'Classify', type: 'main', index: 0 }]] },
          'Classify': {
            main: [
              [{ node: 'Publish', type: 'main', index: 0 }],
              [{ node: 'Generate Post', type: 'main', index: 0 }], // revise → loop back
            ],
          },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('cycle'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('cycle'))).toHaveLength(0);
    });

    it('does not flag an error-output retry loop (onError: continueErrorOutput on the cycle)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Fetch', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'Retry Delay', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Fetch', type: 'main', index: 0 }]] },
          'Fetch': { main: [[], [{ node: 'Retry Delay', type: 'main', index: 0 }]] },
          'Retry Delay': { main: [[{ node: 'Fetch', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('cycle'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('cycle'))).toHaveLength(0);
    });

    it('demotes an unrecognized cycle to a warning (n8n does not reject cycles statically)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'A', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'B', type: 'n8n-nodes-base.code', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'A', type: 'main', index: 0 }]] },
          'A': { main: [[{ node: 'B', type: 'main', index: 0 }]] },
          'B': { main: [[{ node: 'A', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('cycle'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('Workflow contains a cycle'))).toHaveLength(1);
      expect(result.valid).toBe(true);
    });

    it('guard: bare SplitInBatches loop is not flagged at all', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Loop', type: 'n8n-nodes-base.splitInBatches', position: [200, 0], parameters: {} },
          { id: '3', name: 'Work', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
          'Loop': { main: [[], [{ node: 'Work', type: 'main', index: 0 }]] },
          'Work': { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('cycle'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('cycle'))).toHaveLength(0);
    });
  });

  // ─── A7: duplicate node IDs ─────────────────────────────────────────

  describe('A7: duplicate node ID guard', () => {
    it('does not report duplicates when ids are missing (undefined)', async () => {
      const workflow = {
        nodes: [
          { name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { name: 'Set A', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { name: 'Set B', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Set A', type: 'main', index: 0 }]] },
          'Set A': { main: [[{ node: 'Set B', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Duplicate node ID'))).toHaveLength(0);
    });

    it('does not report duplicates when ids are empty strings', async () => {
      const workflow = {
        nodes: [
          { id: '', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '', name: 'Set A', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Set A', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Duplicate node ID'))).toHaveLength(0);
    });

    it('guard: two nodes with the same non-empty id are still an error', async () => {
      const workflow = {
        nodes: [
          { id: 'dup', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: 'dup', name: 'Set A', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Set A', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Duplicate node ID: "dup"'))).toHaveLength(1);
    });
  });

  // ─── A7: typeVersion / unknown-node severity by package ────────────

  describe('A7: snapshot staleness severity', () => {
    it('community node typeVersion above the DB snapshot max is a warning, not an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Assistant', type: 'n8n-nodes-pinecone.pineconeAssistant', position: [200, 0], parameters: {}, typeVersion: 1.2 },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Assistant', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('exceeds maximum supported version'))).toHaveLength(0);
      expect(result.warnings.some(w => w.message.includes('exceeds maximum supported version'))).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('guard: core node typeVersion above max stays an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Airtable', type: 'n8n-nodes-base.airtable', position: [200, 0], parameters: {}, typeVersion: 3 },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Airtable', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('typeVersion 3 exceeds maximum supported version 2.1'))).toBe(true);
    });

    it('unknown community-prefixed node type is a warning, not an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Custom', type: 'n8n-nodes-browseract.browserAct', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Custom', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Unknown node type'))).toHaveLength(0);
      expect(result.warnings.some(w => w.message.includes('Unknown node type: "n8n-nodes-browseract.browserAct"'))).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('guard: unknown core-prefixed node type stays an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Missing', type: 'n8n-nodes-base.doesNotExist', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Missing', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Unknown node type'))).toHaveLength(1);
    });

    it('guard: prefix-less node type stays an error', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Bare', type: 'webhook', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Bare', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Unknown node type'))).toHaveLength(1);
    });
  });

  // ─── B2: AI sub-node trigger reachability ──────────────────────────

  describe('B2: trigger reachability across ai_* connections', () => {
    it('marks model and memory sub-nodes of a reachable agent as reachable', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 0], parameters: {} },
          { id: '3', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', position: [200, 200], parameters: {} },
          { id: '4', name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', position: [300, 200], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
          'Model': { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
          'Memory': { ai_memory: [[{ node: 'Agent', type: 'ai_memory', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message.includes('not reachable from any trigger'))).toHaveLength(0);
    });

    it('guard: sub-nodes attached to an unreachable agent stay unreachable', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Connected', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 400], parameters: {} },
          { id: '4', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', position: [200, 600], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Connected', type: 'main', index: 0 }]] },
          'Model': { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      const unreachable = result.warnings.filter(w => w.message.includes('not reachable from any trigger'));
      expect(unreachable.some(w => w.nodeName === 'Agent')).toBe(true);
      expect(unreachable.some(w => w.nodeName === 'Model')).toBe(true);
    });

    it('guard: genuinely orphaned nodes are still flagged', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Connected', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Orphan', type: 'n8n-nodes-base.code', position: [500, 500], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Connected', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.nodeName === 'Orphan' && w.message.includes('not reachable'))).toHaveLength(1);
    });
  });
});

/**
 * Stage 2 of the audit: warning/suggestion noise. These assert severity and
 * profile-gating changes: advisory findings move to the suggestions channel
 * and/or fire only under ai-friendly/strict.
 */
describe('WorkflowValidator - false-positive audit fixes (Stage 2)', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: NodeRepository;

  const nodeTypes: Record<string, any> = {
    'nodes-base.webhook': { nodeType: 'nodes-base.webhook', displayName: 'Webhook', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.manualTrigger': { nodeType: 'nodes-base.manualTrigger', displayName: 'Manual Trigger', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.set': { nodeType: 'nodes-base.set', displayName: 'Set', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.httpRequest': { nodeType: 'nodes-base.httpRequest', displayName: 'HTTP Request', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.airtable': { nodeType: 'nodes-base.airtable', displayName: 'Airtable', package: 'n8n-nodes-base', version: 2.1, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.telegramTrigger': { nodeType: 'nodes-base.telegramTrigger', displayName: 'Telegram Trigger', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-base.googleDrive': { nodeType: 'nodes-base.googleDrive', displayName: 'Google Drive', package: 'n8n-nodes-base', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-langchain.agent': { nodeType: 'nodes-langchain.agent', displayName: 'AI Agent', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['main'], properties: [] },
    'nodes-langchain.lmChatOpenAi': { nodeType: 'nodes-langchain.lmChatOpenAi', displayName: 'OpenAI Chat Model', package: '@n8n/n8n-nodes-langchain', isVersioned: false, outputs: ['ai_languageModel'], properties: [] },
    'n8n-nodes-firecrawl.scrape': { nodeType: 'n8n-nodes-firecrawl.scrape', displayName: 'Firecrawl', package: 'n8n-nodes-firecrawl', isVersioned: false, isAITool: false, outputs: ['main'], properties: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeRepository = new NodeRepository({} as any) as any;
    if (!mockNodeRepository.getAllNodes) { mockNodeRepository.getAllNodes = vi.fn(); }
    if (!mockNodeRepository.getNode) { mockNodeRepository.getNode = vi.fn(); }

    vi.mocked(mockNodeRepository.getNode).mockImplementation((nodeType: string) => nodeTypes[nodeType] || null);
    vi.mocked(mockNodeRepository.getAllNodes).mockReturnValue(Object.values(nodeTypes));

    vi.mocked(EnhancedConfigValidator.validateWithMode).mockReturnValue({
      errors: [], warnings: [], suggestions: [], mode: 'operation' as const, valid: true, visibleProperties: [], hiddenProperties: [],
    } as any);

    vi.mocked(ExpressionValidator.validateNodeExpressions).mockReturnValue({
      valid: true, errors: [], warnings: [], usedVariables: new Set(), usedNodes: new Set(),
    });

    validator = new WorkflowValidator(mockNodeRepository, EnhancedConfigValidator as any);
  });

  const chain = (nodes: Array<{ name: string; type: string; extra?: any }>) => {
    const wf: any = { nodes: [], connections: {} };
    nodes.forEach((n, i) => {
      wf.nodes.push({ id: String(i + 1), name: n.name, type: n.type, position: [i * 200, 0], parameters: {}, ...(n.extra || {}) });
      if (i < nodes.length - 1) {
        wf.connections[n.name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
      }
    });
    return wf;
  };

  // ─── B3: outdated typeVersion demoted to a gated suggestion ────────

  describe('B3: outdated typeVersion', () => {
    const outdatedWorkflow = () => chain([
      { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
      { name: 'Airtable', type: 'n8n-nodes-base.airtable', extra: { typeVersion: 2 } },
    ]);

    it('is silent at runtime profile (old typeVersions are supported by design)', async () => {
      const result = await validator.validateWorkflow(outdatedWorkflow() as any, { profile: 'runtime' });
      expect(result.warnings.filter(w => w.message.includes('Outdated typeVersion'))).toHaveLength(0);
      expect(result.suggestions.filter(s => s.includes('Outdated typeVersion'))).toHaveLength(0);
    });

    it('surfaces as a suggestion (not warning) under ai-friendly', async () => {
      const result = await validator.validateWorkflow(outdatedWorkflow() as any, { profile: 'ai-friendly' });
      expect(result.warnings.filter(w => w.message.includes('Outdated typeVersion'))).toHaveLength(0);
      const suggestions = result.suggestions.filter(s => s.includes('Outdated typeVersion'));
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toContain('Airtable');
      expect(suggestions[0]).toContain('Latest is 2.1');
    });

    it('guard: typeVersion exceeding maximum is still an error at every profile', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'Airtable', type: 'n8n-nodes-base.airtable', extra: { typeVersion: 3 } },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'minimal' });
      expect(result.errors.some(e => e.message.includes('exceeds maximum supported version'))).toBe(true);
    });
  });

  // ─── RC-2 + B7: error-handling advisories ───────────────────────────

  describe('RC-2/B7: node error-handling advisories', () => {
    const httpWorkflow = () => chain([
      { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
      { name: 'HTTP', type: 'n8n-nodes-base.httpRequest' },
    ]);

    it('does not warn about missing error handling at runtime profile', async () => {
      const result = await validator.validateWorkflow(httpWorkflow() as any, { profile: 'runtime' });
      expect(result.warnings.filter(w => w.message.includes('without error handling'))).toHaveLength(0);
    });

    it('guard: warns exactly once per node under strict', async () => {
      const result = await validator.validateWorkflow(httpWorkflow() as any, { profile: 'strict' });
      const warnings = result.warnings.filter(w => w.nodeName === 'HTTP' && w.message.includes('without error handling'));
      expect(warnings).toHaveLength(1);
    });

    it("guard: explicit onError: 'stopWorkflow' (fail-loud default) still gets the advisory under strict", async () => {
      const wf = httpWorkflow() as any;
      const http = wf.nodes.find((n: any) => n.name === 'HTTP');
      http.onError = 'stopWorkflow';
      const result = await validator.validateWorkflow(wf, { profile: 'strict' });
      const warnings = result.warnings.filter(w => w.nodeName === 'HTTP' && w.message.includes('without error handling'));
      expect(warnings).toHaveLength(1);
    });

    it("onError: 'continueRegularOutput' counts as error handling and suppresses the advisory", async () => {
      const wf = httpWorkflow() as any;
      const http = wf.nodes.find((n: any) => n.name === 'HTTP');
      http.onError = 'continueRegularOutput';
      const result = await validator.validateWorkflow(wf, { profile: 'strict' });
      const warnings = result.warnings.filter(w => w.nodeName === 'HTTP' && w.message.includes('without error handling'));
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for AI sub-nodes without a main output, even under strict', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 0], parameters: {} },
          { id: '3', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', position: [200, 200], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
          'Model': { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any, { profile: 'strict' });
      expect(result.warnings.filter(w => w.nodeName === 'Model' && w.message.includes('without error handling'))).toHaveLength(0);
    });

    it('does not warn for non-webhook trigger nodes, even under strict', async () => {
      const wf = chain([
        { name: 'TG', type: 'n8n-nodes-base.telegramTrigger' },
        { name: 'Set', type: 'n8n-nodes-base.set' },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'strict' });
      expect(result.warnings.filter(w => w.nodeName === 'TG' && w.message.includes('without error handling'))).toHaveLength(0);
    });

    it('webhook error-handling advisory is gated out of runtime', async () => {
      const wf = chain([
        { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { name: 'Set', type: 'n8n-nodes-base.set' },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'runtime' });
      expect(result.warnings.filter(w => w.message.includes('Webhook node without error handling'))).toHaveLength(0);
    });
  });

  // ─── RC-2 + B11: workflow-level error-handling advice ───────────────

  describe('RC-2/B11: workflow-level error handling advice', () => {
    const bareWorkflow = () => chain([
      { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
      { name: 'A', type: 'n8n-nodes-base.set' },
      { name: 'B', type: 'n8n-nodes-base.set' },
      { name: 'C', type: 'n8n-nodes-base.set' },
      { name: 'D', type: 'n8n-nodes-base.set' },
    ]);

    it('generic consider-error-handling warning is gated out of runtime', async () => {
      const result = await validator.validateWorkflow(bareWorkflow() as any, { profile: 'runtime' });
      expect(result.warnings.filter(w => w.message.includes('Consider adding error handling'))).toHaveLength(0);
    });

    it('under ai-friendly the warning fires and the overlapping suggestion is deduped', async () => {
      const result = await validator.validateWorkflow(bareWorkflow() as any, { profile: 'ai-friendly' });
      expect(result.warnings.some(w => w.message.includes('Consider adding error handling'))).toBe(true);
      expect(result.suggestions.filter(s => s.includes('Add error handling using the error output'))).toHaveLength(0);
    });

    it('workflow with a wired error output no longer gets the add-error-handling suggestion', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' },
          { id: '3', name: 'OK', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'ErrH', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
          'HTTP': { main: [[{ node: 'OK', type: 'main', index: 0 }], [{ node: 'ErrH', type: 'main', index: 0 }]] },
        },
      };
      const result = await validator.validateWorkflow(workflow as any, { profile: 'runtime' });
      expect(result.suggestions.filter(s => s.includes('Add error handling using the error output'))).toHaveLength(0);
      expect(result.warnings.filter(w => w.message.includes('Consider adding error handling'))).toHaveLength(0);
    });

    it('guard: a workflow with no error handling still gets the suggestion at runtime', async () => {
      const result = await validator.validateWorkflow(bareWorkflow() as any, { profile: 'runtime' });
      expect(result.suggestions.some(s => s.includes('Add error handling using the error output'))).toBe(true);
    });

    it('minimal profile gets no error-handling suggestion at all', async () => {
      const result = await validator.validateWorkflow(bareWorkflow() as any, { profile: 'minimal' });
      expect(result.suggestions.filter(s => s.includes('Add error handling'))).toHaveLength(0);
    });

    it('explicit onError:stopWorkflow does not count as error handling (advisory still fires)', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'A', type: 'n8n-nodes-base.set', extra: { onError: 'stopWorkflow' } },
        { name: 'B', type: 'n8n-nodes-base.set' },
        { name: 'C', type: 'n8n-nodes-base.set' },
        { name: 'D', type: 'n8n-nodes-base.set' },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'ai-friendly' });
      expect(result.warnings.some(w => w.message.includes('Consider adding error handling'))).toBe(true);
    });

    it('guard: onError:continueRegularOutput counts as error handling (advisory suppressed)', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'A', type: 'n8n-nodes-base.set', extra: { onError: 'continueRegularOutput' } },
        { name: 'B', type: 'n8n-nodes-base.set' },
        { name: 'C', type: 'n8n-nodes-base.set' },
        { name: 'D', type: 'n8n-nodes-base.set' },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'ai-friendly' });
      expect(result.warnings.filter(w => w.message.includes('Consider adding error handling'))).toHaveLength(0);
    });
  });

  // ─── B8 + info routing: AI advisory dedupe and severity ─────────────

  describe('B8/info routing: AI agent advisories', () => {
    const agentWorkflow = () => ({
      nodes: [
        { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
        { id: '2', name: 'Support Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 0], parameters: {} },
        { id: '3', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', position: [200, 200], parameters: {} },
      ],
      connections: {
        'Webhook': { main: [[{ node: 'Support Agent', type: 'main', index: 0 }]] },
        'Model': { ai_languageModel: [[{ node: 'Support Agent', type: 'ai_languageModel', index: 0 }]] },
      },
    });

    it('emits ONE no-tools advisory, as a suggestion naming the agent', async () => {
      const result = await validator.validateWorkflow(agentWorkflow() as any);
      // The duplicate substring-matched workflow-level warning is gone
      expect(result.warnings.filter(w => w.message.includes('has no tools connected'))).toHaveLength(0);
      // The precise ai-node-validator advisory rides the suggestions channel
      expect(result.warnings.filter(w => w.message.includes('no ai_tool connections'))).toHaveLength(0);
      const advisories = result.suggestions.filter(s => s.includes('no ai_tool connections'));
      expect(advisories).toHaveLength(1);
      expect(advisories[0]).toContain('Support Agent');
    });

    it('routes the systemMessage advisory to suggestions', async () => {
      const result = await validator.validateWorkflow(agentWorkflow() as any);
      expect(result.warnings.filter(w => w.message.includes('systemMessage'))).toHaveLength(0);
      expect(result.suggestions.some(s => s.includes('has no systemMessage'))).toBe(true);
    });

    it('emits the community-tool env notice once (warning only, no blanket suggestion)', async () => {
      const workflow = agentWorkflow() as any;
      workflow.nodes.push({ id: '4', name: 'Scraper', type: 'n8n-nodes-firecrawl.scrape', position: [300, 200], parameters: {} });
      workflow.connections['Scraper'] = { ai_tool: [[{ node: 'Support Agent', type: 'ai_tool', index: 0 }]] };
      const result = await validator.validateWorkflow(workflow);
      const notices = [
        ...result.warnings.filter(w => w.message.includes('N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE')),
        ...result.suggestions.filter(s => s.includes('N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE')),
      ];
      expect(notices).toHaveLength(1);
      expect(result.suggestions.filter(s => s.includes('N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE'))).toHaveLength(0);
    });

    it('guard: warning-severity AI issues stay warnings (2 models without needsFallback)', async () => {
      const workflow = agentWorkflow() as any;
      workflow.nodes.push({ id: '4', name: 'Fallback Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', position: [300, 200], parameters: {} });
      workflow.connections['Fallback Model'] = { ai_languageModel: [[{ node: 'Support Agent', type: 'ai_languageModel', index: 0 }]] };
      const result = await validator.validateWorkflow(workflow);
      expect(result.warnings.some(w => w.message.includes('needsFallback is not enabled'))).toBe(true);
    });

    it('guard: error-severity AI issues stay errors (agent without model)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', position: [200, 0], parameters: {} },
        ],
        connections: { 'Webhook': { main: [[{ node: 'Agent', type: 'main', index: 0 }]] } },
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('requires an ai_languageModel connection'))).toBe(true);
    });
  });

  // ─── B9: removed / demoted node-level advisories ────────────────────

  describe('B9: node-level advisory demotions', () => {
    it('retryOnFail without maxTries produces no finding (default of 3 is normal)', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', extra: { retryOnFail: true } },
      ]);
      const result = await validator.validateWorkflow(wf as any, { profile: 'strict' });
      expect(result.warnings.filter(w => w.message.includes('maxTries is not specified'))).toHaveLength(0);
    });

    it('guard: invalid maxTries with retryOnFail is still an error', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', extra: { retryOnFail: true, maxTries: 0 } },
      ]);
      const result = await validator.validateWorkflow(wf as any);
      expect(result.errors.some(e => e.message.includes('maxTries must be a positive number'))).toBe(true);
    });

    it('long linear chain is silent at runtime and a suggestion under ai-friendly', async () => {
      const nodes = [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' }];
      for (let i = 0; i < 12; i++) nodes.push({ name: `Step${i}`, type: 'n8n-nodes-base.set' });
      const runtime = await validator.validateWorkflow(chain(nodes) as any, { profile: 'runtime' });
      expect(runtime.warnings.filter(w => w.message.includes('Long linear chain'))).toHaveLength(0);
      expect(runtime.suggestions.filter(s => s.includes('Long linear chain'))).toHaveLength(0);

      const aiFriendly = await validator.validateWorkflow(chain(nodes) as any, { profile: 'ai-friendly' });
      expect(aiFriendly.warnings.filter(w => w.message.includes('Long linear chain'))).toHaveLength(0);
      expect(aiFriendly.suggestions.some(s => s.includes('Long linear chain detected (13 nodes)'))).toBe(true);
    });

    it('inferred dynamic Tool variant is a suggestion, not a warning', async () => {
      const workflow = {
        nodes: [{ id: '1', name: 'Drive Tool', type: 'n8n-nodes-base.googleDriveTool', position: [0, 0], parameters: {} }],
        connections: {},
      };
      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.filter(e => e.message.includes('Unknown node type'))).toHaveLength(0);
      expect(result.warnings.filter(w => (w as any).code === 'INFERRED_TOOL_VARIANT')).toHaveLength(0);
      expect(result.suggestions.some(s => s.includes('dynamic AI Tool variant'))).toBe(true);
    });

    it('continueOnFail + retryOnFail combo is informational (suggestion)', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', extra: { continueOnFail: true, retryOnFail: true } },
      ]);
      const result = await validator.validateWorkflow(wf as any);
      expect(result.warnings.filter(w => w.message.includes('Both continueOnFail and retryOnFail'))).toHaveLength(0);
      expect(result.suggestions.some(s => s.includes('retry first, then continue') && s.includes('HTTP'))).toBe(true);
    });
  });

  // ─── B11: RECOVERY text references the current tool surface ─────────

  describe('B11: recovery suggestions reference current tools', () => {
    it('configuration recovery references validate_node/get_node, not retired tools', async () => {
      // Four missing-typeVersion errors ("Missing required property …"):
      // triggers the configuration block, the typeVersion block, and the
      // >3-errors general workflow block.
      const nodes: any[] = [];
      for (let i = 0; i < 4; i++) {
        nodes.push({ id: String(i + 1), name: `Airtable${i}`, type: 'n8n-nodes-base.airtable', position: [i * 100, 0], parameters: {} });
      }
      const result = await validator.validateWorkflow({ nodes, connections: {} } as any);
      const text = result.suggestions.join('\n');
      expect(text).not.toMatch(/validate_node_minimal|get_node_essentials|get_node_info/);
      expect(text).toContain("validate_node with mode='minimal'");
      expect(text).toContain('Use get_node to see what fields are needed');
    });

    it('typeVersion recovery references get_node, not get_node_info', async () => {
      const wf = chain([
        { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger' },
        { name: 'Airtable', type: 'n8n-nodes-base.airtable', extra: { typeVersion: 5 } },
      ]);
      const result = await validator.validateWorkflow(wf as any);
      const text = result.suggestions.join('\n');
      expect(text).not.toMatch(/get_node_info|get_node_essentials/);
      expect(text).toContain('Use get_node to check the correct version');
    });
  });
});
