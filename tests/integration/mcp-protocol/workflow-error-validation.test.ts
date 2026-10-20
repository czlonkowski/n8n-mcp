import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TestableN8NMCPServer } from './test-helpers';

describe('MCP Workflow Error Output Validation Integration', () => {
  let mcpServer: TestableN8NMCPServer;
  let client: Client;

  beforeEach(async () => {
    mcpServer = new TestableN8NMCPServer();
    await mcpServer.initialize();

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connectToTransport(serverTransport);

    client = new Client({
      name: 'test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.close();
  });

  describe('validate_workflow tool - Error Output Configuration', () => {
    // The hard "Incorrect error output configuration" error is gone (#1111). A fan-out to a
    // node named like an error handler is now only a warning, and only once the source also
    // sets onError: 'continueErrorOutput' and leaves the error output unwired.
    it('warns (does not error) when onError leaves the error output unwired via MCP', async () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Validate Input',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [-400, 64],
            parameters: {},
            onError: 'continueErrorOutput'
          },
          {
            id: '2',
            name: 'Filter URLs',
            type: 'n8n-nodes-base.filter',
            typeVersion: 2.2,
            position: [-176, 64],
            parameters: {}
          },
          {
            id: '3',
            name: 'Error Response1',
            type: 'n8n-nodes-base.respondToWebhook',
            typeVersion: 1.5,
            position: [-160, 240],
            parameters: {}
          }
        ],
        connections: {
          'Validate Input': {
            main: [
              [
                { node: 'Filter URLs', type: 'main', index: 0 },
                { node: 'Error Response1', type: 'main', index: 0 }  // main[0] only - error output unwired
              ]
            ]
          }
        }
      };

      const response = await client.callTool({
        name: 'validate_workflow',
        arguments: { workflow }
      });

      expect((response as any).content).toHaveLength(1);
      expect((response as any).content[0].type).toBe('text');

      const result = JSON.parse(((response as any).content[0]).text);

      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.some((e: any) => e.message.includes('Incorrect error output configuration'))).toBe(false);

      // The warning names the node and points at main[1] instead
      const warningMsg = (result.warnings || []).find((w: any) => w.message.includes('named like an error handler'));
      expect(warningMsg).toBeDefined();
      expect(warningMsg.message).toContain('Error Response1');
      expect(warningMsg.message).toContain("onError: 'continueErrorOutput' but the error output (main[1]) is not connected");
    });

    it('does not warn when there is no onError setting, even with a fan-out named like an error handler via MCP', async () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Validate Input',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [-400, 64],
            parameters: {}
          },
          {
            id: '2',
            name: 'Filter URLs',
            type: 'n8n-nodes-base.filter',
            typeVersion: 2.2,
            position: [-176, 64],
            parameters: {}
          },
          {
            id: '3',
            name: 'Error Response1',
            type: 'n8n-nodes-base.respondToWebhook',
            typeVersion: 1.5,
            position: [-160, 240],
            parameters: {}
          }
        ],
        connections: {
          'Validate Input': {
            main: [
              [
                { node: 'Filter URLs', type: 'main', index: 0 },
                { node: 'Error Response1', type: 'main', index: 0 }
              ]
            ]
          }
        }
      };

      const response = await client.callTool({
        name: 'validate_workflow',
        arguments: { workflow }
      });

      const result = JSON.parse(((response as any).content[0]).text);

      expect(result.errors.some((e: any) => e.message.includes('Incorrect error output configuration'))).toBe(false);
      expect((result.warnings || []).some((w: any) => w.message.includes('named like an error handler'))).toBe(false);
    });

    it('should validate correct error output configuration via MCP', async () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Validate Input',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [-400, 64],
            parameters: {},
            onError: 'continueErrorOutput'
          },
          {
            id: '2',
            name: 'Filter URLs',
            type: 'n8n-nodes-base.filter',
            typeVersion: 2.2,
            position: [-176, 64],
            parameters: {}
          },
          {
            id: '3',
            name: 'Error Response1',
            type: 'n8n-nodes-base.respondToWebhook',
            typeVersion: 1.5,
            position: [-160, 240],
            parameters: {}
          }
        ],
        connections: {
          'Validate Input': {
            main: [
              [
                { node: 'Filter URLs', type: 'main', index: 0 }
              ],
              [
                { node: 'Error Response1', type: 'main', index: 0 }  // Correctly in main[1]
              ]
            ]
          }
        }
      };

      const response = await client.callTool({
        name: 'validate_workflow',
        arguments: { workflow }
      });

      expect((response as any).content).toHaveLength(1);
      expect((response as any).content[0].type).toBe('text');

      const result = JSON.parse(((response as any).content[0]).text);

      // Should not have the specific error about incorrect configuration
      const hasIncorrectConfigError = result.errors?.some((e: any) =>
        e.message.includes('Incorrect error output configuration')
      ) ?? false;
      expect(hasIncorrectConfigError).toBe(false);
      // The error output is already wired, so the named-like-a-handler warning doesn't fire either.
      expect((result.warnings || []).some((w: any) => w.message.includes('named like an error handler'))).toBe(false);
    });

    it('should detect onError and connection mismatches via MCP', async () => {
      // Test case 1: onError set but no error connections
      const workflow1 = {
        nodes: [
          {
            id: '1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [100, 100],
            parameters: {},
            onError: 'continueErrorOutput'
          },
          {
            id: '2',
            name: 'Process Data',
            type: 'n8n-nodes-base.set',
            position: [300, 100],
            parameters: {}
          }
        ],
        connections: {
          'HTTP Request': {
            main: [
              [
                { node: 'Process Data', type: 'main', index: 0 }
              ]
            ]
          }
        }
      };

      // Test case 2: error connections but no onError
      const workflow2 = {
        nodes: [
          {
            id: '1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [100, 100],
            parameters: {}
            // No onError property
          },
          {
            id: '2',
            name: 'Process Data',
            type: 'n8n-nodes-base.set',
            position: [300, 100],
            parameters: {}
          },
          {
            id: '3',
            name: 'Error Handler',
            type: 'n8n-nodes-base.set',
            position: [300, 200],
            parameters: {}
          }
        ],
        connections: {
          'HTTP Request': {
            main: [
              [
                { node: 'Process Data', type: 'main', index: 0 }
              ],
              [
                { node: 'Error Handler', type: 'main', index: 0 }
              ]
            ]
          }
        }
      };

      // Test both scenarios
      const workflows = [workflow1, workflow2];

      for (const workflow of workflows) {
        const response = await client.callTool({
          name: 'validate_workflow',
          arguments: { workflow }
        });

        const result = JSON.parse(((response as any).content[0]).text);

        // Should detect some kind of validation issue
        expect(result).toHaveProperty('valid');
        expect(Array.isArray(result.errors || [])).toBe(true);
        expect(Array.isArray(result.warnings || [])).toBe(true);
      }
    });

    it('should handle large workflows with complex error patterns via MCP', async () => {
      // Create a large workflow with multiple error handling scenarios
      const nodes = [];
      const connections: any = {};

      // Create 50 nodes with various error handling patterns
      for (let i = 1; i <= 50; i++) {
        nodes.push({
          id: i.toString(),
          name: `Node${i}`,
          type: i % 5 === 0 ? 'n8n-nodes-base.httpRequest' : 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [i * 100, 100],
          parameters: {},
          ...(i % 3 === 0 ? { onError: 'continueErrorOutput' } : {})
        });
      }

      // Create connections with mixed correct and incorrect error handling
      for (let i = 1; i < 50; i++) {
        const hasErrorHandling = i % 3 === 0;
        const nextNode = `Node${i + 1}`;

        if (hasErrorHandling && i % 6 === 0) {
          // Incorrect: error handler in main[0] with success node
          connections[`Node${i}`] = {
            main: [
              [
                { node: nextNode, type: 'main', index: 0 },
                { node: 'Error Handler', type: 'main', index: 0 }  // Wrong placement
              ]
            ]
          };
        } else if (hasErrorHandling) {
          // Correct: separate success and error outputs
          connections[`Node${i}`] = {
            main: [
              [
                { node: nextNode, type: 'main', index: 0 }
              ],
              [
                { node: 'Error Handler', type: 'main', index: 0 }
              ]
            ]
          };
        } else {
          // Normal connection
          connections[`Node${i}`] = {
            main: [
              [
                { node: nextNode, type: 'main', index: 0 }
              ]
            ]
          };
        }
      }

      // Add error handler node
      nodes.push({
        id: '51',
        name: 'Error Handler',
        type: 'n8n-nodes-base.set',
        typeVersion: 1,
        position: [2600, 200],
        parameters: {}
      });

      const workflow = { nodes, connections };

      const startTime = Date.now();
      const response = await client.callTool({
        name: 'validate_workflow',
        arguments: { workflow }
      });
      const endTime = Date.now();

      // Validation should complete quickly even for large workflows
      expect(endTime - startTime).toBeLessThan(5000); // Less than 5 seconds

      const result = JSON.parse(((response as any).content[0]).text);

      // The hard error is gone (#1111) - the "wrong placement" nodes (onError set, error
      // output unwired, fan-out named like a handler) now produce a warning instead.
      expect(result.errors.some((e: any) => e.message.includes('Incorrect error output configuration'))).toBe(false);

      const namedLikeHandlerWarnings = (result.warnings || []).filter((w: any) =>
        w.message.includes('named like an error handler')
      );
      expect(namedLikeHandlerWarnings.length).toBeGreaterThan(0);
    });

    it('should handle edge cases gracefully via MCP', async () => {
      const edgeCaseWorkflows = [
        // Empty workflow
        { nodes: [], connections: {} },

        // Single isolated node
        {
          nodes: [{
            id: '1',
            name: 'Isolated',
            type: 'n8n-nodes-base.set',
            position: [100, 100],
            parameters: {}
          }],
          connections: {}
        },

        // Node with null/undefined connections
        {
          nodes: [{
            id: '1',
            name: 'Source',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {}
          }],
          connections: {
            'Source': {
              main: [null, undefined]
            }
          }
        }
      ];

      for (const workflow of edgeCaseWorkflows) {
        const response = await client.callTool({
          name: 'validate_workflow',
          arguments: { workflow }
        });

        expect((response as any).content).toHaveLength(1);
        const result = JSON.parse(((response as any).content[0]).text);

        // Should not crash and should return a valid validation result
        expect(result).toHaveProperty('valid');
        expect(typeof result.valid).toBe('boolean');
        expect(Array.isArray(result.errors || [])).toBe(true);
        expect(Array.isArray(result.warnings || [])).toBe(true);
      }
    });

    it('should validate with different validation profiles via MCP', async () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'API Call',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {},
            onError: 'continueErrorOutput'
          },
          {
            id: '2',
            name: 'Success Handler',
            type: 'n8n-nodes-base.set',
            position: [300, 100],
            parameters: {}
          },
          {
            id: '3',
            name: 'Error Response',
            type: 'n8n-nodes-base.respondToWebhook',
            position: [300, 200],
            parameters: {}
          }
        ],
        connections: {
          'API Call': {
            main: [
              [
                { node: 'Success Handler', type: 'main', index: 0 },
                { node: 'Error Response', type: 'main', index: 0 }  // main[0] only - error output unwired
              ]
            ]
          }
        }
      };

      // No profile ever raises this as a hard error any more (#1111).
      for (const profile of ['minimal', 'runtime', 'ai-friendly', 'strict']) {
        const response = await client.callTool({
          name: 'validate_workflow',
          arguments: {
            workflow,
            options: { profile }
          }
        });

        const result = JSON.parse(((response as any).content[0]).text);
        expect(result.errors?.some((e: any) => e.message.includes('Incorrect error output configuration')) ?? false).toBe(false);
      }

      // The warning fires under every profile except minimal.
      for (const profile of ['runtime', 'ai-friendly', 'strict']) {
        const response = await client.callTool({
          name: 'validate_workflow',
          arguments: {
            workflow,
            options: { profile }
          }
        });

        const result = JSON.parse(((response as any).content[0]).text);
        expect(
          (result.warnings || []).some((w: any) => w.message.includes('named like an error handler')),
          `profile=${profile}`
        ).toBe(true);
      }

      const minimalResponse = await client.callTool({
        name: 'validate_workflow',
        arguments: { workflow, options: { profile: 'minimal' } }
      });
      const minimalResult = JSON.parse(((minimalResponse as any).content[0]).text);
      expect((minimalResult.warnings || []).some((w: any) => w.message.includes('named like an error handler'))).toBe(false);
    });
  });

  describe('Error Message Format Consistency', () => {
    // No more INCORRECT/CORRECT JSON blocks (#1111) - the warning names the node(s) and points
    // at the unwired error output index, in singular or plural form as appropriate.
    it('should format warning messages consistently across single and multiple handler-like names', async () => {
      const scenarios = [
        {
          name: 'Single error handler in wrong place',
          handlerNames: ['Error Handler'],
          workflow: {
            nodes: [
              { id: '1', name: 'Source', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {}, onError: 'continueErrorOutput' },
              { id: '2', name: 'Success', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
              { id: '3', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [200, 100], parameters: {} }
            ],
            connections: {
              'Source': {
                main: [[
                  { node: 'Success', type: 'main', index: 0 },
                  { node: 'Error Handler', type: 'main', index: 0 }
                ]]
              }
            }
          }
        },
        {
          name: 'Multiple error handlers in wrong place',
          handlerNames: ['Error Handler 1', 'Error Handler 2'],
          workflow: {
            nodes: [
              { id: '1', name: 'Source', type: 'n8n-nodes-base.httpRequest', position: [0, 0], parameters: {}, onError: 'continueErrorOutput' },
              { id: '2', name: 'Success', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
              { id: '3', name: 'Error Handler 1', type: 'n8n-nodes-base.set', position: [200, 100], parameters: {} },
              { id: '4', name: 'Error Handler 2', type: 'n8n-nodes-base.emailSend', position: [200, 200], parameters: {} }
            ],
            connections: {
              'Source': {
                main: [[
                  { node: 'Success', type: 'main', index: 0 },
                  { node: 'Error Handler 1', type: 'main', index: 0 },
                  { node: 'Error Handler 2', type: 'main', index: 0 }
                ]]
              }
            }
          }
        }
      ];

      for (const scenario of scenarios) {
        const response = await client.callTool({
          name: 'validate_workflow',
          arguments: { workflow: scenario.workflow }
        });

        const result = JSON.parse(((response as any).content[0]).text);

        expect(result.errors.some((e: any) => e.message.includes('Incorrect error output configuration'))).toBe(false);

        const warning = (result.warnings || []).find((w: any) => w.message.includes('named like an error handler'));
        expect(warning, scenario.name).toBeDefined();

        // Consistent format regardless of how many names match
        expect(warning.message).toContain("onError: 'continueErrorOutput' but the error output (main[1]) is not connected");
        expect(warning.message).toContain('main[0]');
        for (const handlerName of scenario.handlerNames) {
          expect(warning.message).toContain(handlerName);
        }
        expect(warning.message).toContain('main[1] instead');
      }
    });
  });
});