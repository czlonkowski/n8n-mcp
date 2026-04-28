import assert from 'assert';
import { WorkflowDiffEngine } from '../services/workflow-diff-engine';
import { validateWorkflowStructure } from '../services/n8n-validation';

function buildIfWebhookRespondFixture(): any {
  return {
    id: 'wf-regression-save-path',
    name: 'W-03 Query Surface',
    nodes: [
      {
        id: 'W03_WEBHOOK',
        name: 'W03 Webhook Trigger',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 300],
        parameters: { path: 'w03-query-surface' },
      },
      {
        id: 'W03_VALIDATE',
        name: 'W03 Validate Input',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [480, 300],
        parameters: { jsCode: 'return items;' },
      },
      {
        id: 'W03_IF',
        name: 'W03 Is Valid?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [720, 300],
        parameters: {
          conditions: {
            conditions: [
              {
                leftValue: '={{$json.valid}}',
                rightValue: true,
                operator: { type: 'boolean', operation: 'equals' },
              },
            ],
          },
        },
      },
      {
        id: 'W03_RESP_OK',
        name: 'W03 Respond OK',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [960, 220],
        parameters: { jsCode: 'return items;' },
      },
      {
        id: 'W03_RESP_ERR',
        name: 'W03 Respond Error',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [960, 380],
        parameters: { jsCode: 'return items;' },
      },
      {
        id: 'W03_RESPOND',
        name: 'W03 Respond To Webhook',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [1200, 300],
        parameters: {},
      },
    ],
    connections: {
      'W03 Webhook Trigger': {
        main: [[{ node: 'W03 Validate Input', type: 'main', index: 0 }]],
      },
      'W03 Validate Input': {
        main: [[{ node: 'W03 Is Valid?', type: 'main', index: 0 }]],
      },
      'W03 Is Valid?': {
        main: [
          [{ node: 'W03 Respond OK', type: 'main', index: 0 }],
          [{ node: 'W03 Respond Error', type: 'main', index: 0 }],
        ],
      },
      'W03 Respond OK': {
        main: [[{ node: 'W03 Respond To Webhook', type: 'main', index: 0 }]],
      },
      'W03 Respond Error': {
        main: [[{ node: 'W03 Respond To Webhook', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
  };
}

function buildInvalidConnectionsFixture(): any {
  const workflow = buildIfWebhookRespondFixture();
  workflow.id = 'wf-invalid-connections';
  workflow.connections = {
    'W03 Webhook Trigger': 'BROKEN_SHAPE',
  };
  return workflow;
}

async function testUpdateNameNoConnectionMutation(): Promise<void> {
  const engine = new WorkflowDiffEngine();
  const workflow = buildIfWebhookRespondFixture();
  const beforeConnections = JSON.parse(JSON.stringify(workflow.connections));

  const result = await engine.applyDiff(workflow, {
    id: workflow.id,
    validateOnly: false,
    continueOnError: false,
    operations: [{ type: 'updateName', name: 'W-03 Query Surface' }],
  });

  assert.strictEqual(result.success, true, 'updateName should apply successfully');
  assert.strictEqual(result.operationsApplied, 1, 'Exactly one operation should be applied');
  assert.deepStrictEqual(result.workflow.connections, beforeConnections, 'updateName must not mutate connections');

  const structureErrors = validateWorkflowStructure(result.workflow);
  assert.deepStrictEqual(
    structureErrors,
    [],
    `Workflow should remain structurally valid after updateName, got: ${JSON.stringify(structureErrors)}`,
  );
}

async function testUpdateNodeWithoutConnectionChanges(): Promise<void> {
  const engine = new WorkflowDiffEngine();
  const workflow = buildIfWebhookRespondFixture();
  const beforeConnections = JSON.parse(JSON.stringify(workflow.connections));

  const result = await engine.applyDiff(workflow, {
    id: workflow.id,
    validateOnly: false,
    continueOnError: false,
    operations: [
      {
        type: 'updateNode',
        nodeName: 'W03 Validate Input',
        updates: {
          'parameters.jsCode': 'return items.map(item => ({ json: { ...item.json, normalized: true } }));',
        },
      },
    ],
  });

  assert.strictEqual(result.success, true, 'updateNode should apply successfully');
  assert.deepStrictEqual(result.workflow.connections, beforeConnections, 'updateNode must not mutate connections when not requested');

  const structureErrors = validateWorkflowStructure(result.workflow);
  assert.deepStrictEqual(
    structureErrors,
    [],
    `Workflow should remain structurally valid after updateNode, got: ${JSON.stringify(structureErrors)}`,
  );
}

async function testIfWebhookRespondTopologyRemainsIntact(): Promise<void> {
  const engine = new WorkflowDiffEngine();
  const workflow = buildIfWebhookRespondFixture();

  const result = await engine.applyDiff(workflow, {
    id: workflow.id,
    validateOnly: false,
    continueOnError: false,
    operations: [{ type: 'updateName', name: 'W-03 Query Surface' }],
  });

  assert.strictEqual(result.success, true, 'updateName should apply successfully on IF/Webhook topology');

  const ifOutputs = result.workflow.connections['W03 Is Valid?'].main;
  assert.strictEqual(ifOutputs.length, 2, 'IF node must keep two output branches');
  assert.strictEqual(ifOutputs[0][0].node, 'W03 Respond OK', 'TRUE branch must target success responder');
  assert.strictEqual(ifOutputs[1][0].node, 'W03 Respond Error', 'FALSE branch must target error responder');
}

async function testValidateOnlyAndApplyUseSameCanonicalShape(): Promise<void> {
  const workflow = buildInvalidConnectionsFixture();

  const validateOnlyEngine = new WorkflowDiffEngine();
  const validateOnlyResult = await validateOnlyEngine.applyDiff(workflow, {
    id: workflow.id,
    validateOnly: true,
    continueOnError: false,
    operations: [{ type: 'updateName', name: 'W-03 Query Surface' }],
  });

  const applyEngine = new WorkflowDiffEngine();
  const applyResult = await applyEngine.applyDiff(workflow, {
    id: workflow.id,
    validateOnly: false,
    continueOnError: false,
    operations: [{ type: 'updateName', name: 'W-03 Query Surface' }],
  });

  assert.strictEqual(validateOnlyResult.success, true, 'validateOnly diff should succeed');
  assert.strictEqual(applyResult.success, true, 'apply diff should succeed');
  assert.ok(validateOnlyResult.workflow, 'validateOnly diff should return canonical workflow snapshot');
  assert.ok(applyResult.workflow, 'apply diff should return canonical workflow snapshot');

  assert.deepStrictEqual(
    validateOnlyResult.workflow,
    applyResult.workflow,
    'validateOnly and apply paths must produce identical canonical workflow shape',
  );

  const validateOnlyErrors = validateWorkflowStructure(validateOnlyResult.workflow);
  const applyErrors = validateWorkflowStructure(applyResult.workflow);

  assert.ok(validateOnlyErrors.length > 0, 'broken fixture must produce structural errors');
  assert.deepStrictEqual(
    validateOnlyErrors,
    applyErrors,
    'validateOnly and apply workflows must produce identical structural validation result',
  );
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ['updateName no-op preserves connections', testUpdateNameNoConnectionMutation],
    ['updateNode preserves connections', testUpdateNodeWithoutConnectionChanges],
    ['IF/webhook/respond topology remains valid', testIfWebhookRespondTopologyRemainsIntact],
    ['validateOnly and apply use same canonical shape', testValidateOnlyAndApplyUseSameCanonicalShape],
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS: ${name}`);
  }

  console.log('All save-path regression tests passed.');
}

main().catch((error) => {
  console.error('Regression tests failed:', error?.stack || error);
  process.exit(1);
});
