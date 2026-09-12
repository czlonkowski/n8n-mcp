/**
 * Integration Tests: Smart Parameters with Real n8n API
 *
 * These tests verify that smart parameters (branch='true'/'false', case=N)
 * correctly map to n8n's actual connection structure when tested against
 * a real n8n instance.
 *
 * CRITICAL: These tests validate against REAL n8n connection structure:
 *   ✅ workflow.connections.IF.main[0] (correct)
 *   ❌ workflow.connections.IF.true (wrong - what unit tests did)
 *
 * These integration tests would have caught the bugs that unit tests missed:
 * - Bug 1: branch='true' mapping to sourceOutput instead of sourceIndex
 * - Bug 2: Zod schema stripping branch/case parameters
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { cleanupOrphanedWorkflows } from '../utils/cleanup-helpers';
import { createMcpContext, getMcpRepository } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { NodeRepository } from '../../../../src/database/node-repository';
import { handleUpdatePartialWorkflow } from '../../../../src/mcp/handlers-workflow-diff';
import { Workflow } from '../../../../src/types/n8n-api';

describe('Integration: Smart Parameters with Real n8n API', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;
  let repository: NodeRepository;

  beforeEach(async () => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
    repository = await getMcpRepository();
    // Skip workflow validation for these tests - they test n8n API behavior with edge cases
    process.env.SKIP_WORKFLOW_VALIDATION = 'true';
  });

  afterEach(async () => {
    await context.cleanup();
    // Clean up environment variable
    delete process.env.SKIP_WORKFLOW_VALIDATION;
  });

  afterAll(async () => {
    if (!process.env.CI) {
      await cleanupOrphanedWorkflows();
    }
  });

  // ======================================================================
  // TEST 1: IF node with branch='true'
  // ======================================================================

  describe('IF Node Smart Parameters', () => {
    it('should handle branch="true" with real n8n API', async () => {
      // Create minimal workflow with IF node
      const workflowName = createTestWorkflowName('Smart Params - IF True Branch');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add TrueHandler node and connection using branch='true' smart parameter
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'TrueHandler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 200],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'handled',
                        value: 'true',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'TrueHandler',
              branch: 'true'  // Smart parameter
            }
          ]
        },
        repository,
        mcpContext
      );

      if (!result.success) console.log("VALIDATION ERROR:", JSON.stringify(result, null, 2));
      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert REAL n8n connection structure
      // The connection should be at index 0 of main output array (true branch)
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[0]![0].node).toBe('TrueHandler');
      expect(fetchedWorkflow.connections.IF.main[0]![0].type).toBe('main');

      // Verify false branch (index 1) is empty or undefined
      expect(fetchedWorkflow.connections.IF.main[1] || []).toHaveLength(0);
    });

    // ======================================================================
    // TEST 2: IF node with branch='false'
    // ======================================================================

    it('should handle branch="false" with real n8n API', async () => {
      // Create minimal workflow with IF node
      const workflowName = createTestWorkflowName('Smart Params - IF False Branch');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add FalseHandler node and connection using branch='false' smart parameter
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'FalseHandler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 400],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'handled',
                        value: 'false',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'FalseHandler',
              branch: 'false'  // Smart parameter
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert REAL n8n connection structure
      // The connection should be at index 1 of main output array (false branch)
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[1]![0].node).toBe('FalseHandler');
      expect(fetchedWorkflow.connections.IF.main[1]![0].type).toBe('main');

      // Verify true branch (index 0) is empty or undefined
      expect(fetchedWorkflow.connections.IF.main[0] || []).toHaveLength(0);
    });

    // ======================================================================
    // TEST 3: IF node with both branches
    // ======================================================================

    it('should handle both branch="true" and branch="false" simultaneously', async () => {
      // Create minimal workflow with IF node
      const workflowName = createTestWorkflowName('Smart Params - IF Both Branches');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add both handlers and connections in single operation batch
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'TrueHandler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 200],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'branch',
                        value: 'true',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addNode',
              node: {
                name: 'FalseHandler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 400],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-2',
                        name: 'branch',
                        value: 'false',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'TrueHandler',
              branch: 'true'
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'FalseHandler',
              branch: 'false'
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert both branches exist at separate indices
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();

      // True branch at index 0
      expect(fetchedWorkflow.connections.IF.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[0]![0].node).toBe('TrueHandler');

      // False branch at index 1
      expect(fetchedWorkflow.connections.IF.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[1]![0].node).toBe('FalseHandler');
    });
  });

  // ======================================================================
  // TEST 4-6: Switch node with case parameter
  // ======================================================================

  describe('Switch Node Smart Parameters', () => {
    it('should handle case=0, case=1, case=2 with real n8n API', async () => {
      // Create minimal workflow with Switch node
      const workflowName = createTestWorkflowName('Smart Params - Switch Cases');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'switch-1',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [450, 300],
            parameters: {
              mode: 'rules',
              rules: {
                rules: [
                  {
                    id: 'rule-1',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-1',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'a',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 0
                  },
                  {
                    id: 'rule-2',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-2',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'b',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 1
                  },
                  {
                    id: 'rule-3',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-3',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'c',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 2
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add 3 handler nodes and connections using case smart parameter
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            // Add handlers
            {
              type: 'addNode',
              node: {
                name: 'Handler0',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 100],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'case',
                        value: '0',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addNode',
              node: {
                name: 'Handler1',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 300],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-2',
                        name: 'case',
                        value: '1',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addNode',
              node: {
                name: 'Handler2',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 500],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-3',
                        name: 'case',
                        value: '2',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            // Add connections with case parameter
            {
              type: 'addConnection',
              source: 'Switch',
              target: 'Handler0',
              case: 0  // Smart parameter
            },
            {
              type: 'addConnection',
              source: 'Switch',
              target: 'Handler1',
              case: 1  // Smart parameter
            },
            {
              type: 'addConnection',
              source: 'Switch',
              target: 'Handler2',
              case: 2  // Smart parameter
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert connections at correct indices
      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();

      // Case 0 at index 0
      expect(fetchedWorkflow.connections.Switch.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[0]![0].node).toBe('Handler0');

      // Case 1 at index 1
      expect(fetchedWorkflow.connections.Switch.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[1]![0].node).toBe('Handler1');

      // Case 2 at index 2
      expect(fetchedWorkflow.connections.Switch.main[2]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[2]![0].node).toBe('Handler2');
    });
  });

  // ======================================================================
  // TEST 5: rewireConnection with branch parameter
  // ======================================================================

  describe('RewireConnection with Smart Parameters', () => {
    it('should rewire connection using branch="true" parameter', async () => {
      // Create workflow with IF node and initial connection
      const workflowName = createTestWorkflowName('Smart Params - Rewire IF True');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          },
          {
            id: 'handler1',
            name: 'Handler1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [650, 200],
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: 'assign-1',
                    name: 'handler',
                    value: '1',
                    type: 'string'
                  }
                ]
              }
            }
          },
          {
            id: 'handler2',
            name: 'Handler2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [650, 400],
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: 'assign-2',
                    name: 'handler',
                    value: '2',
                    type: 'string'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          },
          IF: {
            // Initial connection: true branch to Handler1
            main: [[{ node: 'Handler1', type: 'main', index: 0 }], []]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Rewire true branch from Handler1 to Handler2
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'rewireConnection',
              source: 'IF',
              from: 'Handler1',
              to: 'Handler2',
              branch: 'true'  // Smart parameter
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert connection rewired at index 0 (true branch)
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[0]![0].node).toBe('Handler2');
    });

    // ======================================================================
    // TEST 6: rewireConnection with case parameter
    // ======================================================================

    it('should rewire connection using case=1 parameter', async () => {
      // Create workflow with Switch node and initial connections
      const workflowName = createTestWorkflowName('Smart Params - Rewire Switch Case');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'switch-1',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [450, 300],
            parameters: {
              mode: 'rules',
              rules: {
                rules: [
                  {
                    id: 'rule-1',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-1',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'a',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 0
                  },
                  {
                    id: 'rule-2',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-2',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'b',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 1
                  }
                ]
              }
            }
          },
          {
            id: 'handler1',
            name: 'OldHandler',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [650, 300],
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: 'assign-1',
                    name: 'handler',
                    value: 'old',
                    type: 'string'
                  }
                ]
              }
            }
          },
          {
            id: 'handler2',
            name: 'NewHandler',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [650, 500],
            parameters: {
              assignments: {
                assignments: [
                  {
                    id: 'assign-2',
                    name: 'handler',
                    value: 'new',
                    type: 'string'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          },
          Switch: {
            // Initial connection: case 1 to OldHandler
            main: [[], [{ node: 'OldHandler', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Rewire case 1 from OldHandler to NewHandler
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'rewireConnection',
              source: 'Switch',
              from: 'OldHandler',
              to: 'NewHandler',
              case: 1  // Smart parameter
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert connection rewired at index 1 (case 1)
      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[1]![0].node).toBe('NewHandler');
    });
  });

  // ======================================================================
  // TEST 7: Explicit sourceIndex overrides branch
  // ======================================================================

  describe('Parameter Priority', () => {
    it('should prioritize explicit sourceIndex over branch parameter', async () => {
      // Create minimal workflow with IF node
      const workflowName = createTestWorkflowName('Smart Params - Explicit Override Branch');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add connection with BOTH branch='true' (would be index 0) and explicit sourceIndex=1
      // Explicit sourceIndex should win
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Handler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 400],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'test',
                        value: 'value',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'Handler',
              branch: 'true',  // Would map to index 0
              sourceIndex: 1   // Explicit index should override
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert connection is at index 1 (explicit wins)
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[1]![0].node).toBe('Handler');

      // Index 0 should be empty
      expect(fetchedWorkflow.connections.IF.main[0] || []).toHaveLength(0);
    });

    // ======================================================================
    // TEST 8: Explicit sourceIndex overrides case
    // ======================================================================

    it('should prioritize explicit sourceIndex over case parameter', async () => {
      // Create minimal workflow with Switch node
      const workflowName = createTestWorkflowName('Smart Params - Explicit Override Case');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'switch-1',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [450, 300],
            parameters: {
              mode: 'rules',
              rules: {
                rules: [
                  {
                    id: 'rule-1',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-1',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'a',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 0
                  },
                  {
                    id: 'rule-2',
                    conditions: {
                      conditions: [
                        {
                          id: 'cond-2',
                          leftValue: '={{ $json.case }}',
                          rightValue: 'b',
                          operation: 'equal'
                        }
                      ]
                    },
                    output: 1
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add connection with BOTH case=1 (would be index 1) and explicit sourceIndex=2
      // Explicit sourceIndex should win
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Handler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 500],
                parameters: {
                  assignments: {
                    assignments: [
                      {
                        id: 'assign-1',
                        name: 'test',
                        value: 'value',
                        type: 'string'
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'Switch',
              target: 'Handler',
              case: 1,         // Would map to index 1
              sourceIndex: 2   // Explicit index should override
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL: Assert connection is at index 2 (explicit wins)
      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[2]![0].node).toBe('Handler');

      // Index 1 should be empty
      expect(fetchedWorkflow.connections.Switch.main[1] || []).toHaveLength(0);
    });
  });

  // ======================================================================
  // ERROR CASES: Invalid smart parameter values
  // ======================================================================

  describe('Error Cases', () => {
    it('should reject invalid branch value', async () => {
      // Create minimal workflow with IF node
      const workflowName = createTestWorkflowName('Smart Params - Invalid Branch');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [450, 300],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Try to add connection with invalid branch value
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Handler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 300],
                parameters: {
                  assignments: {
                    assignments: []
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'IF',
              target: 'Handler',
              branch: 'invalid' as any  // Invalid value
            }
          ]
        },
        repository,
        mcpContext
      );

      // Should fail validation
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle negative case value gracefully', async () => {
      // NOTE: Currently negative case values are accepted and mapped to sourceIndex=-1
      // which n8n API accepts (though it may not behave correctly at runtime).
      // TODO: Add validation to reject negative case values in future enhancement.

      // Create minimal workflow with Switch node
      const workflowName = createTestWorkflowName('Smart Params - Negative Case');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'switch-1',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [450, 300],
            parameters: {
              mode: 'rules',
              rules: {
                rules: []
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add connection with negative case value
      // Currently accepted but should be validated in future
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Handler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 300],
                parameters: {
                  assignments: {
                    assignments: []
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'Switch',
              target: 'Handler',
              case: -1  // Negative value - should be validated but currently accepted
            }
          ]
        },
        repository,
        mcpContext
      );

      // Currently succeeds (validation gap)
      // TODO: Should fail validation when enhanced validation is added
      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // EDGE CASES: Branch parameter on non-IF node
  // ======================================================================

  describe('Edge Cases', () => {
    it('should ignore branch parameter on non-IF node (fallback to default)', async () => {
      // Create workflow with Set node (not an IF node)
      const workflowName = createTestWorkflowName('Smart Params - Branch on Non-IF');
      const workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300],
            parameters: {}
          },
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300],
            parameters: {
              assignments: {
                assignments: []
              }
            }
          }
        ],
        connections: {
          Manual: {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        },
        tags: ['mcp-integration-test']
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Add connection with branch parameter on non-IF node
      // Should be ignored and use default index 0
      const result = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Handler',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [650, 300],
                parameters: {
                  assignments: {
                    assignments: []
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'Set',
              target: 'Handler',
              branch: 'true'  // Should be ignored on non-IF node
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(result.success).toBe(true);

      // Fetch actual workflow from n8n API
      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // Connection should be at default index 0 (branch parameter ignored)
      expect(fetchedWorkflow.connections.Set).toBeDefined();
      expect(fetchedWorkflow.connections.Set.main).toBeDefined();
      expect(fetchedWorkflow.connections.Set.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Set.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Set.main[0]![0].node).toBe('Handler');
    });
  });

  // ======================================================================
  // TEST 11: Array Index Preservation (Issue #272 - Critical Bug Fix)
  // ======================================================================
  describe('Array Index Preservation for Multi-Output Nodes', () => {
    it('should preserve array indices when rewiring Switch node connections', async () => {
      // This test verifies the fix for the critical bug where filtering empty arrays
      // caused index shifting in multi-output nodes (Switch, IF with multiple handlers)
      //
      // Bug: workflow.connections[node][output].filter(conns => conns.length > 0)
      // Fix: Only remove trailing empty arrays, preserve intermediate ones

      const workflowName = createTestWorkflowName('Array Index Preservation - Switch');

      // Create workflow with Switch node connected to 4 handlers
      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              options: {},
              rules: {
                rules: [
                  { conditions: { conditions: [{ leftValue: '={{$json.value}}', rightValue: '1', operator: { type: 'string', operation: 'equals' } }] } },
                  { conditions: { conditions: [{ leftValue: '={{$json.value}}', rightValue: '2', operator: { type: 'string', operation: 'equals' } }] } },
                  { conditions: { conditions: [{ leftValue: '={{$json.value}}', rightValue: '3', operator: { type: 'string', operation: 'equals' } }] } }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'Handler0',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -100],
            parameters: {}
          },
          {
            id: '4',
            name: 'Handler1',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 0],
            parameters: {}
          },
          {
            id: '5',
            name: 'Handler2',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 100],
            parameters: {}
          },
          {
            id: '6',
            name: 'Handler3',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 200],
            parameters: {}
          },
          {
            id: '7',
            name: 'NewHandler1',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 50],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          },
          Switch: {
            main: [
              [{ node: 'Handler0', type: 'main', index: 0 }],  // case 0
              [{ node: 'Handler1', type: 'main', index: 0 }],  // case 1
              [{ node: 'Handler2', type: 'main', index: 0 }],  // case 2
              [{ node: 'Handler3', type: 'main', index: 0 }]   // case 3 (fallback)
            ]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Rewire case 1 from Handler1 to NewHandler1
      // CRITICAL: This should NOT shift indices of case 2 and case 3
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'rewireConnection',
            source: 'Switch',
            from: 'Handler1',
            to: 'NewHandler1',
            case: 1
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // Verify all indices are preserved correctly
      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();

      // case 0: Should still be Handler0
      expect(fetchedWorkflow.connections.Switch.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[0]![0].node).toBe('Handler0');

      // case 1: Should now be NewHandler1 (rewired)
      expect(fetchedWorkflow.connections.Switch.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[1]![0].node).toBe('NewHandler1');

      // case 2: Should STILL be Handler2 (index NOT shifted!)
      expect(fetchedWorkflow.connections.Switch.main[2]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[2]![0].node).toBe('Handler2');

      // case 3: Should STILL be Handler3 (index NOT shifted!)
      expect(fetchedWorkflow.connections.Switch.main[3]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[3]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[3]![0].node).toBe('Handler3');
    });

    it('should preserve empty arrays when removing IF node connections', async () => {
      // This test verifies that removing a connection creates an empty array
      // rather than shifting indices (which would break the true/false semantics)

      const workflowName = createTestWorkflowName('Array Preservation - IF Remove');

      // Create workflow with IF node connected to both branches
      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [200, 0],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 'test',
                    operation: 'equal'
                  }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'TrueHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -50],
            parameters: {}
          },
          {
            id: '4',
            name: 'FalseHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 50],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          },
          IF: {
            main: [
              [{ node: 'TrueHandler', type: 'main', index: 0 }],   // true branch (index 0)
              [{ node: 'FalseHandler', type: 'main', index: 0 }]   // false branch (index 1)
            ]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Remove connection from true branch (index 0)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'IF',
            target: 'TrueHandler',
            branch: 'true'
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // Verify structure: empty array at index 0, FalseHandler still at index 1
      expect(fetchedWorkflow.connections.IF).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main.length).toBe(2);

      // Index 0 (true branch): Should be empty array (NOT removed!)
      expect(fetchedWorkflow.connections.IF.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[0]!.length).toBe(0);

      // Index 1 (false branch): Should STILL be FalseHandler (NOT shifted to index 0!)
      expect(fetchedWorkflow.connections.IF.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.IF.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.IF.main[1]![0].node).toBe('FalseHandler');
    });

    it('should preserve indices when removing first case from Switch node', async () => {
      // MOST CRITICAL TEST: Verifies removing first output doesn't shift all others
      // This is the exact bug scenario that was production-breaking

      const workflowName = createTestWorkflowName('Array Preservation - Switch Remove First');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              options: {},
              rules: {
                rules: [
                  { conditions: { conditions: [{ leftValue: '={{$json.case}}', rightValue: '0', operator: { type: 'string', operation: 'equals' } }] } },
                  { conditions: { conditions: [{ leftValue: '={{$json.case}}', rightValue: '1', operator: { type: 'string', operation: 'equals' } }] } },
                  { conditions: { conditions: [{ leftValue: '={{$json.case}}', rightValue: '2', operator: { type: 'string', operation: 'equals' } }] } }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'Handler0',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -100],
            parameters: {}
          },
          {
            id: '4',
            name: 'Handler1',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 0],
            parameters: {}
          },
          {
            id: '5',
            name: 'Handler2',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 100],
            parameters: {}
          },
          {
            id: '6',
            name: 'FallbackHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 200],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          },
          Switch: {
            main: [
              [{ node: 'Handler0', type: 'main', index: 0 }],      // case 0
              [{ node: 'Handler1', type: 'main', index: 0 }],      // case 1
              [{ node: 'Handler2', type: 'main', index: 0 }],      // case 2
              [{ node: 'FallbackHandler', type: 'main', index: 0 }] // fallback (case 3)
            ]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Remove connection from case 0 (first output)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'Switch',
            target: 'Handler0',
            case: 0
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main.length).toBe(4);

      // case 0: Should be empty array (NOT removed!)
      expect(fetchedWorkflow.connections.Switch.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[0]!.length).toBe(0);

      // case 1: Should STILL be Handler1 at index 1 (NOT shifted to 0!)
      expect(fetchedWorkflow.connections.Switch.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[1]![0].node).toBe('Handler1');

      // case 2: Should STILL be Handler2 at index 2 (NOT shifted to 1!)
      expect(fetchedWorkflow.connections.Switch.main[2]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[2]![0].node).toBe('Handler2');

      // case 3: Should STILL be FallbackHandler at index 3 (NOT shifted to 2!)
      expect(fetchedWorkflow.connections.Switch.main[3]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[3]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[3]![0].node).toBe('FallbackHandler');
    });

    it('should preserve indices through sequential operations on Switch node', async () => {
      // Complex scenario: Multiple operations in sequence on the same Switch node
      // This tests that our fix works correctly across multiple operations

      const workflowName = createTestWorkflowName('Array Preservation - Sequential Ops');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              options: {},
              rules: {
                rules: [
                  { conditions: { conditions: [{ leftValue: '={{$json.value}}', rightValue: '1', operator: { type: 'string', operation: 'equals' } }] } },
                  { conditions: { conditions: [{ leftValue: '={{$json.value}}', rightValue: '2', operator: { type: 'string', operation: 'equals' } }] } }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'Handler0',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -50],
            parameters: {}
          },
          {
            id: '4',
            name: 'Handler1',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 50],
            parameters: {}
          },
          {
            id: '5',
            name: 'NewHandler0',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -100],
            parameters: {}
          },
          {
            id: '6',
            name: 'NewHandler2',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 150],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'Switch', type: 'main', index: 0 }]]
          },
          Switch: {
            main: [
              [{ node: 'Handler0', type: 'main', index: 0 }],  // case 0
              [{ node: 'Handler1', type: 'main', index: 0 }]   // case 1
            ]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Sequential operations:
      // 1. Rewire case 0: Handler0 → NewHandler0
      // 2. Add connection to case 2 (new handler)
      // 3. Remove connection from case 1 (Handler1)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'rewireConnection',
            source: 'Switch',
            from: 'Handler0',
            to: 'NewHandler0',
            case: 0
          },
          {
            type: 'addConnection',
            source: 'Switch',
            target: 'NewHandler2',
            case: 2
          },
          {
            type: 'removeConnection',
            source: 'Switch',
            target: 'Handler1',
            case: 1
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      expect(fetchedWorkflow.connections.Switch).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main.length).toBe(3);

      // case 0: Should be NewHandler0 (rewired)
      expect(fetchedWorkflow.connections.Switch.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[0]![0].node).toBe('NewHandler0');

      // case 1: Should be empty array (removed)
      expect(fetchedWorkflow.connections.Switch.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[1]!.length).toBe(0);

      // case 2: Should be NewHandler2 (added)
      expect(fetchedWorkflow.connections.Switch.main[2]).toBeDefined();
      expect(fetchedWorkflow.connections.Switch.main[2]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Switch.main[2]![0].node).toBe('NewHandler2');
    });

    it('should preserve indices when rewiring Filter node connections', async () => {
      // Filter node has 2 outputs: kept items (index 0) and discarded items (index 1)
      // Test that rewiring one doesn't affect the other

      const workflowName = createTestWorkflowName('Array Preservation - Filter');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'Filter',
            type: 'n8n-nodes-base.filter',
            typeVersion: 2,
            position: [200, 0],
            parameters: {
              conditions: {
                conditions: [
                  {
                    id: 'cond-1',
                    leftValue: '={{ $json.value }}',
                    rightValue: 10,
                    operator: { type: 'number', operation: 'gt' }
                  }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'KeptHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -50],
            parameters: {}
          },
          {
            id: '4',
            name: 'DiscardedHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, 50],
            parameters: {}
          },
          {
            id: '5',
            name: 'NewKeptHandler',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [400, -100],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'Filter', type: 'main', index: 0 }]]
          },
          Filter: {
            main: [
              [{ node: 'KeptHandler', type: 'main', index: 0 }],      // kept items (index 0)
              [{ node: 'DiscardedHandler', type: 'main', index: 0 }]  // discarded items (index 1)
            ]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Rewire kept items output (index 0) from KeptHandler to NewKeptHandler
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'rewireConnection',
            source: 'Filter',
            from: 'KeptHandler',
            to: 'NewKeptHandler',
            sourceIndex: 0
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      expect(fetchedWorkflow.connections.Filter).toBeDefined();
      expect(fetchedWorkflow.connections.Filter.main).toBeDefined();
      expect(fetchedWorkflow.connections.Filter.main.length).toBe(2);

      // Index 0 (kept items): Should now be NewKeptHandler
      expect(fetchedWorkflow.connections.Filter.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Filter.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Filter.main[0]![0].node).toBe('NewKeptHandler');

      // Index 1 (discarded items): Should STILL be DiscardedHandler (unchanged)
      expect(fetchedWorkflow.connections.Filter.main[1]).toBeDefined();
      expect(fetchedWorkflow.connections.Filter.main[1]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Filter.main[1]![0].node).toBe('DiscardedHandler');
    });
  });

  // ======================================================================
  // TEST 16-19: Merge Node - Multiple Inputs (targetIndex preservation)
  // ======================================================================
  describe('Merge Node - Multiple Inputs (targetIndex Preservation)', () => {
    it('should preserve targetIndex when removing connection to Merge input 0', async () => {
      // CRITICAL: Merge has multiple INPUTS (unlike Switch which has multiple outputs)
      // This tests that targetIndex preservation works for incoming connections
      // Bug would cause: Remove input 0 → input 1 shifts to input 0

      const workflowName = createTestWorkflowName('Merge - Remove Input 0');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '2',
            name: 'Source1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [200, -50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a1', name: 'source', value: '1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'Source2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [200, 50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a2', name: 'source', value: '2', type: 'string' }
                ]
              }
            }
          },
          {
            id: '4',
            name: 'Merge',
            type: 'n8n-nodes-base.merge',
            typeVersion: 3,
            position: [400, 0],
            parameters: {
              mode: 'append'
            }
          },
          {
            id: '5',
            name: 'Output',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [600, 0],
            parameters: {}
          }
        ],
        connections: {
          Start: {
            main: [[{ node: 'Source1', type: 'main', index: 0 }]]
          },
          Source1: {
            main: [[{ node: 'Merge', type: 'main', index: 0 }]]  // to Merge input 0
          },
          Source2: {
            main: [[{ node: 'Merge', type: 'main', index: 1 }]]  // to Merge input 1
          },
          Merge: {
            main: [[{ node: 'Output', type: 'main', index: 0 }]]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Remove connection from Source1 to Merge (input 0)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'Source1',
            target: 'Merge'
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // CRITICAL VERIFICATION: Source2 should STILL connect to Merge at targetIndex 1
      // Bug would cause it to shift to targetIndex 0
      expect(fetchedWorkflow.connections.Source2).toBeDefined();
      expect(fetchedWorkflow.connections.Source2.main).toBeDefined();
      expect(fetchedWorkflow.connections.Source2.main[0]).toBeDefined();
      expect(fetchedWorkflow.connections.Source2.main[0]!.length).toBe(1);
      expect(fetchedWorkflow.connections.Source2.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.Source2.main[0]![0].index).toBe(1); // STILL index 1!

      // Source1 should no longer connect to Merge
      expect(fetchedWorkflow.connections.Source1).toBeUndefined();
    });

    it('should preserve targetIndex when removing middle connection to Merge', async () => {
      // MOST CRITICAL: Remove middle input, verify inputs 0 and 2 stay at their indices
      // This is the multi-input equivalent of the Switch node bug

      const workflowName = createTestWorkflowName('Merge - Remove Middle Input');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Source0',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, -100],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a0', name: 'source', value: '0', type: 'string' }
                ]
              }
            }
          },
          {
            id: '2',
            name: 'Source1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, 0],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a1', name: 'source', value: '1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'Source2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, 100],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a2', name: 'source', value: '2', type: 'string' }
                ]
              }
            }
          },
          {
            id: '4',
            name: 'Merge',
            type: 'n8n-nodes-base.merge',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              mode: 'append'
            }
          }
        ],
        connections: {
          Source0: {
            main: [[{ node: 'Merge', type: 'main', index: 0 }]]  // input 0
          },
          Source1: {
            main: [[{ node: 'Merge', type: 'main', index: 1 }]]  // input 1
          },
          Source2: {
            main: [[{ node: 'Merge', type: 'main', index: 2 }]]  // input 2
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Remove connection from Source1 to Merge (middle input)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'Source1',
            target: 'Merge'
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // Source0 should STILL connect to Merge at targetIndex 0
      expect(fetchedWorkflow.connections.Source0).toBeDefined();
      expect(fetchedWorkflow.connections.Source0.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.Source0.main[0]![0].index).toBe(0); // STILL 0!

      // Source2 should STILL connect to Merge at targetIndex 2 (NOT shifted to 1!)
      expect(fetchedWorkflow.connections.Source2).toBeDefined();
      expect(fetchedWorkflow.connections.Source2.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.Source2.main[0]![0].index).toBe(2); // STILL 2!

      // Source1 should no longer connect to Merge
      expect(fetchedWorkflow.connections.Source1).toBeUndefined();
    });

    it('should handle replacing source connection to Merge input', async () => {
      // Test replacing which node connects to a Merge input
      // Use remove + add pattern (not rewireConnection which changes target, not source)

      const workflowName = createTestWorkflowName('Merge - Replace Source');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Source1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, -50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a1', name: 'source', value: '1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '2',
            name: 'Source2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, 50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a2', name: 'source', value: '2', type: 'string' }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'NewSource1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, -100],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a3', name: 'source', value: 'new1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '4',
            name: 'Merge',
            type: 'n8n-nodes-base.merge',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              mode: 'append'
            }
          }
        ],
        connections: {
          Source1: {
            main: [[{ node: 'Merge', type: 'main', index: 0 }]]
          },
          Source2: {
            main: [[{ node: 'Merge', type: 'main', index: 1 }]]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Replace Source1 with NewSource1 (both to Merge input 0)
      // Use remove + add pattern
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'Source1',
            target: 'Merge'
          },
          {
            type: 'addConnection',
            source: 'NewSource1',
            target: 'Merge',
            targetInput: 'main',
            targetIndex: 0
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // NewSource1 should now connect to Merge at input 0
      expect(fetchedWorkflow.connections.NewSource1).toBeDefined();
      expect(fetchedWorkflow.connections.NewSource1.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.NewSource1.main[0]![0].index).toBe(0);

      // Source2 should STILL connect to Merge at input 1 (unchanged)
      expect(fetchedWorkflow.connections.Source2).toBeDefined();
      expect(fetchedWorkflow.connections.Source2.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.Source2.main[0]![0].index).toBe(1);

      // Source1 should no longer connect to Merge
      expect(fetchedWorkflow.connections.Source1).toBeUndefined();
    });

    it('should preserve indices through sequential operations on Merge inputs', async () => {
      // Complex scenario: Multiple operations on Merge inputs in sequence

      const workflowName = createTestWorkflowName('Merge - Sequential Ops');

      const workflow: Workflow = await client.createWorkflow({
        name: workflowName,
        nodes: [
          {
            id: '1',
            name: 'Source1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, -50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a1', name: 'source', value: '1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '2',
            name: 'Source2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, 50],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a2', name: 'source', value: '2', type: 'string' }
                ]
              }
            }
          },
          {
            id: '3',
            name: 'NewSource1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, -100],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a3', name: 'source', value: 'new1', type: 'string' }
                ]
              }
            }
          },
          {
            id: '4',
            name: 'Source3',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [0, 150],
            parameters: {
              assignments: {
                assignments: [
                  { id: 'a4', name: 'source', value: '3', type: 'string' }
                ]
              }
            }
          },
          {
            id: '5',
            name: 'Merge',
            type: 'n8n-nodes-base.merge',
            typeVersion: 3,
            position: [200, 0],
            parameters: {
              mode: 'append'
            }
          }
        ],
        connections: {
          Source1: {
            main: [[{ node: 'Merge', type: 'main', index: 0 }]]
          },
          Source2: {
            main: [[{ node: 'Merge', type: 'main', index: 1 }]]
          }
        }
      });

      expect(workflow.id).toBeTruthy();
      if (!workflow.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(workflow.id);

      // Sequential operations:
      // 1. Replace input 0: Source1 → NewSource1 (remove + add)
      // 2. Add Source3 → Merge input 2
      // 3. Remove connection from Source2 (input 1)
      await handleUpdatePartialWorkflow({
        id: workflow.id,
        operations: [
          {
            type: 'removeConnection',
            source: 'Source1',
            target: 'Merge'
          },
          {
            type: 'addConnection',
            source: 'NewSource1',
            target: 'Merge',
            targetInput: 'main',
            targetIndex: 0
          },
          {
            type: 'addConnection',
            source: 'Source3',
            target: 'Merge',
            targetInput: 'main',
            targetIndex: 2
          },
          {
            type: 'removeConnection',
            source: 'Source2',
            target: 'Merge'
          }
        ]
      }, repository);

      const fetchedWorkflow = await client.getWorkflow(workflow.id);

      // NewSource1 should connect to Merge at input 0 (rewired)
      expect(fetchedWorkflow.connections.NewSource1).toBeDefined();
      expect(fetchedWorkflow.connections.NewSource1.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.NewSource1.main[0]![0].index).toBe(0);

      // Source2 removed, should not exist
      expect(fetchedWorkflow.connections.Source2).toBeUndefined();

      // Source3 should connect to Merge at input 2 (NOT shifted to 1!)
      expect(fetchedWorkflow.connections.Source3).toBeDefined();
      expect(fetchedWorkflow.connections.Source3.main[0]![0].node).toBe('Merge');
      expect(fetchedWorkflow.connections.Source3.main[0]![0].index).toBe(2);
    });
  });
});
