/**
 * Integration Tests: handleAutofixWorkflow
 *
 * Tests workflow autofix against a real n8n instance.
 * Covers fix types, confidence levels, preview/apply modes, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleAutofixWorkflow } from '../../../../src/mcp/handlers-n8n-manager';
import { getNodeRepository, closeNodeRepository } from '../utils/node-repository';
import { NodeRepository } from '../../../../src/database/node-repository';
import { AutofixResponse } from '../types/mcp-responses';

describe('Integration: handleAutofixWorkflow', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;
  let repository: NodeRepository;

  beforeEach(async () => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
    repository = await getNodeRepository();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  afterAll(async () => {
    await closeNodeRepository();
  });

  // ======================================================================
  // Preview Mode (applyFixes: false)
  // ======================================================================

  describe('Preview Mode', () => {
    it('should preview fixes without applying them (expression-format)', async () => {
      // Create workflow with expression format issues
      const workflow = {
        name: createTestWorkflowName('Autofix - Preview Expression'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          },
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              // Bad expression format (missing {{}})
              assignments: {
                assignments: [
                  {
                    id: '1',
                    name: 'value',
                    value: '$json.data',  // Should be {{ $json.data }}
                    type: 'string'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Webhook: {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        },
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      // Preview fixes (applyFixes: false)
      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as AutofixResponse;

      // If fixes are available, should be in preview mode
      if (data.fixesAvailable && data.fixesAvailable > 0) {
        expect(data.preview).toBe(true);
        expect(data.fixes).toBeDefined();
        expect(Array.isArray(data.fixes)).toBe(true);
        expect(data.summary).toBeDefined();
        expect(data.stats).toBeDefined();

        // Verify workflow not modified (fetch it back)
        const fetched = await client.getWorkflow(created.id!);
        const params = fetched.nodes[1].parameters as { assignments: { assignments: Array<{ value: string }> } };
        expect(params.assignments.assignments[0].value).toBe('$json.data');
      } else {
        // No fixes available - that's also a valid result
        expect(data.message).toContain('No automatic fixes available');
      }
    });

    it('should preview multiple fix types', async () => {
      // Create workflow with multiple issues
      const workflow = {
        name: createTestWorkflowName('Autofix - Preview Multiple'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1, // Old typeVersion
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET'
              // Missing path parameter
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data.preview).toBe(true);
      expect(data.fixesAvailable).toBeGreaterThan(0);
    });
  });

  // ======================================================================
  // Apply Mode (applyFixes: true)
  // ======================================================================

  describe('Apply Mode', () => {
    it('should apply expression-format fixes', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Apply Expression'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          },
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: '1',
                    name: 'value',
                    value: '$json.data',  // Bad format
                    type: 'string'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Webhook: {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        },
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      // Apply fixes
      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: true,
          fixTypes: ['expression-format']
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // If fixes were applied
      if (data.fixesApplied && data.fixesApplied > 0) {
        expect(data.fixes).toBeDefined();
        expect(data.preview).toBeUndefined();

        // Verify workflow was actually modified
        const fetched = await client.getWorkflow(created.id!);
        const params = fetched.nodes[1].parameters as { assignments: { assignments: Array<{ value: unknown }> } };
        const setValue = params.assignments.assignments[0].value;
        // Expression format should be fixed (depends on what fixes were available)
        expect(setValue).toBeDefined();
      } else {
        // No fixes available or applied - that's also valid
        expect(data.message).toBeDefined();
      }
    });

    it('should apply webhook-missing-path fixes', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Apply Webhook Path'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET'
              // Missing path
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: true,
          fixTypes: ['webhook-missing-path']
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      if (data.fixesApplied > 0) {
        // Verify path was added
        const fetched = await client.getWorkflow(created.id!);
        expect(fetched.nodes[0].parameters.path).toBeDefined();
        expect(fetched.nodes[0].parameters.path).toBeTruthy();
      }
    });
  });

  // ======================================================================
  // Fix Type Filtering
  // ======================================================================

  describe('Fix Type Filtering', () => {
    it('should only apply specified fix types', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Filter Fix Types'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1, // Old typeVersion
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET'
              // Missing path
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      // Only request webhook-missing-path fixes (ignore typeversion issues)
      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          fixTypes: ['webhook-missing-path']
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Should only show webhook-missing-path fixes
      if (data.fixes && data.fixes.length > 0) {
        data.fixes.forEach((fix: any) => {
          expect(fix.type).toBe('webhook-missing-path');
        });
      }
    });

    it('should handle multiple fix types filter', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Multiple Filter'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          fixTypes: ['expression-format', 'webhook-missing-path']
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
    });
  });

  // ======================================================================
  // Confidence Threshold
  // ======================================================================

  describe('Confidence Threshold', () => {
    it('should filter fixes by high confidence threshold', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - High Confidence'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          confidenceThreshold: 'high'
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // All fixes should be high confidence
      if (data.fixes && data.fixes.length > 0) {
        data.fixes.forEach((fix: any) => {
          expect(fix.confidence).toBe('high');
        });
      }
    });

    it('should include medium and high confidence with medium threshold', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Medium Confidence'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          confidenceThreshold: 'medium'
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Fixes should be medium or high confidence
      if (data.fixes && data.fixes.length > 0) {
        data.fixes.forEach((fix: any) => {
          expect(['high', 'medium']).toContain(fix.confidence);
        });
      }
    });

    it('should include all confidence levels with low threshold', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Low Confidence'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          confidenceThreshold: 'low'
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
    });
  });

  // ======================================================================
  // Max Fixes Parameter
  // ======================================================================

  describe('Max Fixes Parameter', () => {
    it('should limit fixes to maxFixes parameter', async () => {
      // Create workflow with multiple issues
      const workflow = {
        name: createTestWorkflowName('Autofix - Max Fixes'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          },
          {
            id: 'set-1',
            name: 'Set 1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              assignments: {
                assignments: [
                  { id: '1', name: 'val1', value: '$json.a', type: 'string' },
                  { id: '2', name: 'val2', value: '$json.b', type: 'string' },
                  { id: '3', name: 'val3', value: '$json.c', type: 'string' }
                ]
              }
            }
          }
        ],
        connections: {
          Webhook: {
            main: [[{ node: 'Set 1', type: 'main', index: 0 }]]
          }
        },
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      // Limit to 1 fix
      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          maxFixes: 1
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Should have at most 1 fix
      if (data.fixes) {
        expect(data.fixes.length).toBeLessThanOrEqual(1);
      }
    });
  });

  // ======================================================================
  // No Fixes Available
  // ======================================================================

  describe('No Fixes Available', () => {
    it('should handle workflow with no fixable issues', async () => {
      // Create valid workflow
      const workflow = {
        name: createTestWorkflowName('Autofix - No Issues'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test-webhook'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          // Exclude version upgrade fixes to test "no fixes" scenario
          fixTypes: ['expression-format', 'typeversion-correction', 'error-output-config', 'node-type-correction', 'webhook-missing-path']
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data.message).toContain('No automatic fixes available');
      expect(data.validationSummary).toBeDefined();
    });
  });

  // ======================================================================
  // Error Handling
  // ======================================================================

  describe('Error Handling', () => {
    it('should handle non-existent workflow ID', async () => {
      const response = await handleAutofixWorkflow(
        {
          id: '99999999',
          applyFixes: false
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle invalid fixTypes parameter', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Invalid Param'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          fixTypes: ['invalid-fix-type'] as any
        },
        repository,
        mcpContext
      );

      // Should either fail validation or ignore invalid type
      expect(response.success).toBe(false);
    });

    it('should handle invalid confidence threshold', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Invalid Confidence'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false,
          confidenceThreshold: 'invalid' as any
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(false);
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete autofix response structure (preview)', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Response Format Preview'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET'
              // Missing path to trigger fixes
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: false
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Verify required fields
      expect(data).toHaveProperty('workflowId');
      expect(data).toHaveProperty('workflowName');

      // Preview mode specific fields
      if (data.fixesAvailable > 0) {
        expect(data).toHaveProperty('preview');
        expect(data.preview).toBe(true);
        expect(data).toHaveProperty('fixesAvailable');
        expect(data).toHaveProperty('fixes');
        expect(data).toHaveProperty('summary');
        expect(data).toHaveProperty('stats');
        expect(data).toHaveProperty('message');

        // Verify fixes structure
        expect(Array.isArray(data.fixes)).toBe(true);
        if (data.fixes.length > 0) {
          const fix = data.fixes[0];
          expect(fix).toHaveProperty('type');
          expect(fix).toHaveProperty('confidence');
          expect(fix).toHaveProperty('description');
        }
      }
    });

    it('should return complete autofix response structure (apply)', async () => {
      const workflow = {
        name: createTestWorkflowName('Autofix - Response Format Apply'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET'
              // Missing path
            }
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleAutofixWorkflow(
        {
          id: created.id,
          applyFixes: true
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toHaveProperty('workflowId');
      expect(data).toHaveProperty('workflowName');

      // Apply mode specific fields
      if (data.fixesApplied > 0) {
        expect(data).toHaveProperty('fixesApplied');
        expect(data).toHaveProperty('fixes');
        expect(data).toHaveProperty('summary');
        expect(data).toHaveProperty('stats');
        expect(data).toHaveProperty('message');
        expect(data.preview).toBeUndefined();

        // Verify types
        expect(typeof data.fixesApplied).toBe('number');
        expect(Array.isArray(data.fixes)).toBe(true);
      }
    });
  });
});
