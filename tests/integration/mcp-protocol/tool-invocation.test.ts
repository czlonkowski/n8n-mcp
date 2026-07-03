import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TestableN8NMCPServer } from './test-helpers';

describe('MCP Tool Invocation', () => {
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

  describe('Node Discovery Tools', () => {
    describe('search_nodes', () => {
      it('should search nodes by keyword', async () => {
        const response = await client.callTool({ name: 'search_nodes', arguments: {
          query: 'webhook'
        }});

        const result = JSON.parse(((response as any).content[0]).text);
        const nodes = result.results;
        expect(nodes.length).toBeGreaterThan(0);
        
        // Should find webhook node
        const webhookNode = nodes.find((n: any) => n.displayName.toLowerCase().includes('webhook'));
        expect(webhookNode).toBeDefined();
      });

      it('should support different search modes', async () => {
        // OR mode
        const orResponse = await client.callTool({ name: 'search_nodes', arguments: {
          query: 'http request',
          mode: 'OR'
        }});
        const orResult = JSON.parse(((orResponse as any).content[0]).text);
        const orNodes = orResult.results;
        expect(orNodes.length).toBeGreaterThan(0);

        // AND mode
        const andResponse = await client.callTool({ name: 'search_nodes', arguments: {
          query: 'http request',
          mode: 'AND'
        }});
        const andResult = JSON.parse(((andResponse as any).content[0]).text);
        const andNodes = andResult.results;
        expect(andNodes.length).toBeLessThanOrEqual(orNodes.length);

        // FUZZY mode - use less typo-heavy search
        const fuzzyResponse = await client.callTool({ name: 'search_nodes', arguments: {
          query: 'http req', // Partial match should work
          mode: 'FUZZY'
        }});
        const fuzzyResult = JSON.parse(((fuzzyResponse as any).content[0]).text);
        const fuzzyNodes = fuzzyResult.results;
        expect(fuzzyNodes.length).toBeGreaterThan(0);
      });

      it('should respect result limit', async () => {
        const response = await client.callTool({ name: 'search_nodes', arguments: {
          query: 'node',
          limit: 3
        }});

        const result = JSON.parse(((response as any).content[0]).text);
        const nodes = result.results;
        expect(nodes).toHaveLength(3);
      });
    });

    describe('get_node', () => {
      it('should get complete node information', async () => {
        const response = await client.callTool({ name: 'get_node', arguments: {
          nodeType: 'nodes-base.httpRequest',
          detail: 'full'
        }});

        expect(((response as any).content[0]).type).toBe('text');
        const nodeInfo = JSON.parse(((response as any).content[0]).text);

        expect(nodeInfo).toHaveProperty('nodeType', 'nodes-base.httpRequest');
        expect(nodeInfo).toHaveProperty('displayName');
        expect(nodeInfo).toHaveProperty('description');
        expect(nodeInfo).toHaveProperty('version');
      });

      it('should handle non-existent nodes', async () => {
        try {
          await client.callTool({ name: 'get_node', arguments: {
            nodeType: 'nodes-base.nonExistent'
          }});
          expect.fail('Should have thrown an error');
        } catch (error: any) {
          expect(error.message).toContain('not found');
        }
      });

      it('should handle invalid node type format', async () => {
        try {
          await client.callTool({ name: 'get_node', arguments: {
            nodeType: 'invalidFormat'
          }});
          expect.fail('Should have thrown an error');
        } catch (error: any) {
          expect(error.message).toContain('not found');
        }
      });
    });

    describe('get_node with different detail levels', () => {
      it('should return standard detail by default', async () => {
        const response = await client.callTool({ name: 'get_node', arguments: {
          nodeType: 'nodes-base.httpRequest'
        }});

        const nodeInfo = JSON.parse(((response as any).content[0]).text);

        expect(nodeInfo).toHaveProperty('nodeType');
        expect(nodeInfo).toHaveProperty('displayName');
        expect(nodeInfo).toHaveProperty('description');
        expect(nodeInfo).toHaveProperty('requiredProperties');
        expect(nodeInfo).toHaveProperty('commonProperties');

        // Should be smaller than full detail
        const fullResponse = await client.callTool({ name: 'get_node', arguments: {
          nodeType: 'nodes-base.httpRequest',
          detail: 'full'
        }});

        expect(((response as any).content[0]).text.length).toBeLessThan(((fullResponse as any).content[0]).text.length);
      });
    });
  });

  describe('Validation Tools', () => {
    // v2.26.0: validate_node_operation consolidated into validate_node with mode parameter
    describe('validate_node', () => {
      it('should validate valid node configuration', async () => {
        const response = await client.callTool({ name: 'validate_node', arguments: {
          nodeType: 'nodes-base.httpRequest',
          config: {
            method: 'GET',
            url: 'https://api.example.com/data'
          },
          mode: 'full'
        }});

        const validation = JSON.parse(((response as any).content[0]).text);
        expect(validation).toHaveProperty('valid');
        expect(validation).toHaveProperty('errors');
        expect(validation).toHaveProperty('warnings');
      });

      it('should detect missing required fields', async () => {
        const response = await client.callTool({ name: 'validate_node', arguments: {
          nodeType: 'nodes-base.httpRequest',
          config: {
            method: 'GET'
            // Missing required 'url' field
          },
          mode: 'full'
        }});

        const validation = JSON.parse(((response as any).content[0]).text);
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
        expect(validation.errors[0].message.toLowerCase()).toContain('url');
      });

      it('should support different validation profiles', async () => {
        const profiles = ['minimal', 'runtime', 'ai-friendly', 'strict'];

        for (const profile of profiles) {
          const response = await client.callTool({ name: 'validate_node', arguments: {
            nodeType: 'nodes-base.httpRequest',
            config: { method: 'GET', url: 'https://api.example.com' },
            mode: 'full',
            profile
          }});

          const validation = JSON.parse(((response as any).content[0]).text);
          expect(validation).toHaveProperty('profile', profile);
        }
      });
    });

    describe('validate_workflow', () => {
      it('should validate complete workflow', async () => {
        const workflow = {
          nodes: [
            {
              id: '1',
              name: 'Start',
              type: 'nodes-base.manualTrigger',
              typeVersion: 1,
              position: [0, 0],
              parameters: {}
            },
            {
              id: '2',
              name: 'HTTP Request',
              type: 'nodes-base.httpRequest',
              typeVersion: 3,
              position: [250, 0],
              parameters: {
                method: 'GET',
                url: 'https://api.example.com/data'
              }
            }
          ],
          connections: {
            'Start': {
              'main': [[{ node: 'HTTP Request', type: 'main', index: 0 }]]
            }
          }
        };

        const response = await client.callTool({ name: 'validate_workflow', arguments: {
          workflow
        }});

        const validation = JSON.parse(((response as any).content[0]).text);
        expect(validation).toHaveProperty('valid');
        expect(validation).toHaveProperty('errors');
        expect(validation).toHaveProperty('warnings');
      });

      it('should detect connection errors', async () => {
        const workflow = {
          nodes: [
            {
              id: '1',
              name: 'Start',
              type: 'nodes-base.manualTrigger',
              typeVersion: 1,
              position: [0, 0],
              parameters: {}
            }
          ],
          connections: {
            'Start': {
              'main': [[{ node: 'NonExistent', type: 'main', index: 0 }]]
            }
          }
        };

        const response = await client.callTool({ name: 'validate_workflow', arguments: {
          workflow
        }});

        const validation = JSON.parse(((response as any).content[0]).text);
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      });

      it('should validate expressions', async () => {
        const workflow = {
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
              name: 'Set',
              type: 'n8n-nodes-base.set',
              typeVersion: 3.4,
              position: [250, 0],
              parameters: {
                mode: 'manual',
                duplicateItem: false,
                values: {
                  string: [
                    {
                      // Genuinely malformed: unclosed expression brackets
                      name: 'broken',
                      value: '={{ $json.field'
                    }
                  ]
                }
              }
            }
          ],
          connections: {
            'Start': {
              'main': [[{ node: 'Set', type: 'main', index: 0 }]]
            }
          }
        };

        const response = await client.callTool({ name: 'validate_workflow', arguments: {
          workflow,
          options: {
            validateExpressions: true
          }
        }});

        const validation = JSON.parse(((response as any).content[0]).text);
        expect(validation).toHaveProperty('valid');
        
        // The workflow should have either errors or warnings about the expression
        if (validation.errors && validation.errors.length > 0) {
          expect(validation.errors.some((e: any) => 
            e.message.includes('expression') || e.message.includes('$json')
          )).toBe(true);
        } else if (validation.warnings) {
          expect(validation.warnings.length).toBeGreaterThan(0);
          expect(validation.warnings.some((w: any) => 
            w.message.includes('expression') || w.message.includes('$json')
          )).toBe(true);
        }
      });
    });
  });

  describe('Documentation Tools', () => {
    describe('tools_documentation', () => {
      it('should get quick start guide', async () => {
        const response = await client.callTool({ name: 'tools_documentation', arguments: {} });

        expect(((response as any).content[0]).type).toBe('text');
        expect(((response as any).content[0]).text).toContain('n8n MCP Tools');
      });

      it('should get specific tool documentation', async () => {
        const response = await client.callTool({ name: 'tools_documentation', arguments: {
          topic: 'search_nodes'
        }});

        expect(((response as any).content[0]).text).toContain('search_nodes');
        expect(((response as any).content[0]).text).toContain('Text search');
      });

      it('should get comprehensive documentation', async () => {
        const response = await client.callTool({ name: 'tools_documentation', arguments: {
          depth: 'full'
        }});

        // Reduced from 5000 after v2.26.0 tool consolidation (31→19 tools)
        expect(((response as any).content[0]).text.length).toBeGreaterThan(4000);
        expect(((response as any).content[0]).text).toBeDefined();
      });

      it('should handle invalid topics gracefully', async () => {
        const response = await client.callTool({ name: 'tools_documentation', arguments: {
          topic: 'nonexistent_tool'
        }});

        expect(((response as any).content[0]).text).toContain('not found');
      });
    });
  });

  // AI Tools section removed - list_ai_tools and get_node_as_tool_info were removed in v2.25.0
  // Use search_nodes with query for finding AI-capable nodes

  describe('Complex Tool Interactions', () => {
    it('should handle tool chaining', async () => {
      // Search for nodes
      const searchResponse = await client.callTool({ name: 'search_nodes', arguments: {
        query: 'slack'
      }});
      const searchResult = JSON.parse(((searchResponse as any).content[0]).text);
      const nodes = searchResult.results;
      
      // Get info for first result
      const firstNode = nodes[0];
      const infoResponse = await client.callTool({ name: 'get_node', arguments: {
        nodeType: firstNode.nodeType
      }});
      
      expect(((infoResponse as any).content[0]).text).toContain(firstNode.displayName);
    });

    it('should handle parallel tool calls', async () => {
      const toolCalls = [
        { name: 'search_nodes', arguments: { query: 'http' } },
        { name: 'tools_documentation', arguments: {} },
        { name: 'get_node', arguments: { nodeType: 'nodes-base.httpRequest' } },
        { name: 'search_nodes', arguments: { query: 'webhook' } }
      ];

      const promises = toolCalls.map(call =>
        client.callTool(call)
      );

      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(toolCalls.length);
      responses.forEach(response => {
        expect(response.content).toHaveLength(1);
        expect(((response as any).content[0]).type).toBe('text');
      });
    });

    it('should maintain consistency across related tools', async () => {
      // Get node via different methods
      const nodeType = 'nodes-base.httpRequest';
      
      const [fullInfo, essentials, searchResult] = await Promise.all([
        client.callTool({ name: 'get_node', arguments: { nodeType } }),
        client.callTool({ name: 'get_node', arguments: { nodeType } }),
        client.callTool({ name: 'search_nodes', arguments: { query: 'httpRequest' } })
      ]);

      const full = JSON.parse(((fullInfo as any).content[0]).text);
      const essential = JSON.parse(((essentials as any).content[0]).text);
      const searchData = JSON.parse(((searchResult as any).content[0]).text);
      const search = searchData.results;

      // Should all reference the same node
      expect(full.nodeType).toBe('nodes-base.httpRequest');
      expect(essential.displayName).toBe(full.displayName);
      expect(search.find((n: any) => n.nodeType === 'nodes-base.httpRequest')).toBeDefined();
    });
  });
});
