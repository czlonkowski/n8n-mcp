import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowBuilderAgent } from '../../../src/services/workflow-builder-agent';
import { WorkflowValidator } from '../../../src/services/workflow-validator';

vi.mock('../../../src/services/n8n-validation', () => ({
  validateWorkflowStructure: vi.fn(() => []),
}));

vi.mock('../../../src/services/workflow-validator', () => ({
  WorkflowValidator: class {
    async validateWorkflow() {
      return { valid: true, errors: [], warnings: [] };
    }
  },
}));

const workflow = {
  name: 'New order notification',
  nodes: [{
    id: 'webhook-1',
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    parameters: { httpMethod: 'POST' },
  }],
  connections: {},
};

function createAgent(response: unknown) {
  const responses = Array.isArray(response) ? [...response] : [response];
  const modelCall = vi.fn().mockImplementation(async () => ({
    choices: [{ message: { content: JSON.stringify(responses.shift()) } }],
  }));
  const repository = {
    searchNodes: vi.fn().mockReturnValue([{ nodeType: 'n8n-nodes-base.webhook' }]),
    getNode: vi.fn().mockReturnValue({
      nodeType: 'n8n-nodes-base.webhook',
      displayName: 'Webhook',
      description: 'Starts a workflow from an HTTP request',
      isTrigger: true,
      version: '2',
      credentials: [],
      operations: [],
      properties: [],
    }),
  };
  const client = { chat: { completions: { create: modelCall } } };
  const agent = new WorkflowBuilderAgent(repository as any, {
    apiKey: 'test-key',
    baseURL: 'https://model.example.test/v1',
    model: 'test-model',
    timeoutMs: 1000,
  }, client as any);
  return { agent, modelCall, repository };
}

describe('WorkflowBuilderAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a validated draft and supplies node catalog context to the model', async () => {
    const { agent, modelCall, repository } = createAgent({
      status: 'ready',
      summary: 'Accept an order webhook and prepare a notification workflow.',
      questions: [],
      workflow,
    });

    const plan = await agent.plan('Notify the team when a new order arrives');

    expect(plan.status).toBe('ready');
    expect(plan.workflow).toEqual(workflow);
    expect(plan.validation?.valid).toBe(true);
    expect(repository.searchNodes).toHaveBeenCalledWith('Notify the team when a new order arrives', 'OR', 12);
    expect(modelCall).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      response_format: { type: 'json_object' },
    }));
  });

  it('returns clarification questions without a workflow when the goal is underspecified', async () => {
    const { agent } = createAgent({
      status: 'needs_input',
      summary: 'The destination is not specified.',
      questions: ['Where should notifications be sent?'],
    });

    const plan = await agent.plan('Notify me about orders');

    expect(plan.status).toBe('needs_input');
    expect(plan.questions).toEqual(['Where should notifications be sent?']);
    expect(plan.workflow).toBeUndefined();
  });

  it('repairs a draft from validation findings before returning it', async () => {
    const correctedWorkflow = { ...workflow, name: 'Validated order notification' };
    const { agent, modelCall } = createAgent([
      { status: 'ready', summary: 'Draft workflow.', questions: [], workflow },
      { status: 'ready', summary: 'Corrected workflow.', questions: [], workflow: correctedWorkflow },
    ]);
    vi.spyOn(WorkflowValidator.prototype, 'validateWorkflow')
      .mockResolvedValueOnce({
        valid: false,
        errors: [{ nodeName: 'Webhook', message: 'Webhook path is required' }],
        warnings: [],
      } as any)
      .mockResolvedValueOnce({ valid: true, errors: [], warnings: [] } as any);

    const plan = await agent.plan('Notify the team when a new order arrives');

    expect(modelCall).toHaveBeenCalledTimes(2);
    expect(plan.status).toBe('ready');
    expect(plan.workflow).toEqual(correctedWorkflow);
    expect(plan.validation?.valid).toBe(true);
  });

  it('withholds drafts containing credential-like parameter fields', async () => {
    const unsafeWorkflow = {
      ...workflow,
      nodes: [{ ...workflow.nodes[0], parameters: { apiKey: 'must-not-be-returned' } }],
    };
    const { agent } = createAgent({
      status: 'ready',
      summary: 'Generated workflow.',
      questions: [],
      workflow: unsafeWorkflow,
    });

    const plan = await agent.plan('Call an API with a key');

    expect(plan.status).toBe('needs_revision');
    expect(plan.workflow).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('must-not-be-returned');
  });

  it('rejects goals outside the accepted size before contacting the model', async () => {
    const { agent, modelCall } = createAgent({});

    await expect(agent.plan('x'.repeat(4001))).rejects.toThrow('goal must contain');
    expect(modelCall).not.toHaveBeenCalled();
  });

  it('rejects model responses that do not match the plan schema', async () => {
    const { agent } = createAgent({ status: 'ready', summary: 'Missing workflow.' });

    await expect(agent.plan('Create a basic workflow')).rejects.toThrow('marked the plan ready');
  });
});