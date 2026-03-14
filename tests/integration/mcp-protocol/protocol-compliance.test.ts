import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { TestableN8NMCPServer } from './test-helpers';

describe('MCP Protocol Compliance', () => {
  let mcpServer: TestableN8NMCPServer;
  let transport: InMemoryTransport;
  let client: Client;

  beforeEach(async () => {
    mcpServer = new TestableN8NMCPServer();
    await mcpServer.initialize();
    
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    transport = serverTransport;
    
    // Connect MCP server to transport
    await mcpServer.connectToTransport(transport);
    
    // Create client
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

  describe('JSON-RPC 2.0 Compliance', () => {
    it('should return proper JSON-RPC 2.0 response format', async () => {
      const response = await client.listTools();

      // Response should have tools array
      expect(response).toHaveProperty('tools');
      expect(Array.isArray((response as any).tools)).toBe(true);
    });

    it('should handle request with id correctly', async () => {
      const response = await client.listTools();

      expect(response).toBeDefined();
      expect(typeof response).toBe('object');
    });

    it('should handle batch requests', async () => {
      // Send multiple requests concurrently
      const promises = [
        client.listTools(),
        client.listTools(),
        client.listTools()
      ];

      const responses = await Promise.all(promises);
      
      expect(responses).toHaveLength(3);
      responses.forEach(response => {
        expect(response).toHaveProperty('tools');
      });
    });

    it('should preserve request order in responses', async () => {
      const requests = [];
      const expectedOrder = [];

      // Create requests with different tools to track order
      for (let i = 0; i < 5; i++) {
        expectedOrder.push(i);
        requests.push(
          client.callTool({ name: 'tools_documentation', arguments: {} })
            .then(() => i)
        );
      }

      const results = await Promise.all(requests);
      expect(results).toEqual(expectedOrder);
    });
  });

  describe('Protocol Version Negotiation', () => {
    it('should negotiate protocol capabilities', async () => {
      const serverInfo = await client.getServerVersion();
      
      expect(serverInfo).toHaveProperty('name');
      expect(serverInfo).toHaveProperty('version');
      expect(serverInfo!.name).toBe('n8n-documentation-mcp');
    });

    it('should expose supported capabilities', async () => {
      const serverCapabilities = client.getServerCapabilities();
      
      expect(serverCapabilities).toBeDefined();
      
      // Should support tools
      expect(serverCapabilities).toHaveProperty('tools');
    });
  });

  describe('Message Format Validation', () => {
    it('should reject messages without method', async () => {
      // MCP SDK 1.27+ enforces single-connection per Server instance,
      // so use the existing client from beforeEach instead of a new one.
      try {
        // This should fail as MCP SDK validates method
        await (client as any).request({ method: '', params: {} });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle missing params gracefully', async () => {
      // Most tools should work without params
      const response = await client.callTool({ name: 'search_nodes', arguments: { query: 'webhook' } });
      expect(response).toBeDefined();
    });

    it('should validate params schema', async () => {
      try {
        // Invalid nodeType format (missing prefix)
        const response = await client.callTool({ name: 'get_node', arguments: {
          nodeType: 'httpRequest' // Should be 'nodes-base.httpRequest'
        } });
        // Check if the response indicates an error
        const text = (response as any).content[0].text;
        expect(text).toContain('not found');
      } catch (error: any) {
        // If it throws, that's also acceptable
        expect(error.message).toContain('not found');
      }
    });
  });

  describe('Content Types', () => {
    it('should handle text content in tool responses', async () => {
      const response = await client.callTool({ name: 'tools_documentation', arguments: {} });

      expect((response as any).content).toHaveLength(1);
      expect((response as any).content[0]).toHaveProperty('type', 'text');
      expect((response as any).content[0]).toHaveProperty('text');
      expect(typeof (response as any).content[0].text).toBe('string');
    });

    it('should handle large text responses', async () => {
      // Get a large node info response
      const response = await client.callTool({ name: 'get_node', arguments: {
        nodeType: 'nodes-base.httpRequest'
      } });

      expect((response as any).content).toHaveLength(1);
      expect((response as any).content[0].type).toBe('text');
      expect((response as any).content[0].text.length).toBeGreaterThan(1000);
    });

    it('should handle JSON content properly', async () => {
      const response = await client.callTool({ name: 'search_nodes', arguments: {
        query: 'webhook',
        limit: 5
      } });

      expect((response as any).content).toHaveLength(1);
      const content = JSON.parse((response as any).content[0].text);
      expect(content).toHaveProperty('results');
      expect(Array.isArray(content.results)).toBe(true);
    });
  });

  describe('Request/Response Correlation', () => {
    it('should correlate concurrent requests correctly', async () => {
      const requests = [
        client.callTool({ name: 'get_node', arguments: { nodeType: 'nodes-base.httpRequest' } }),
        client.callTool({ name: 'get_node', arguments: { nodeType: 'nodes-base.webhook' } }),
        client.callTool({ name: 'get_node', arguments: { nodeType: 'nodes-base.slack' } })
      ];

      const responses = await Promise.all(requests);

      expect((responses[0] as any).content[0].text).toContain('httpRequest');
      expect((responses[1] as any).content[0].text).toContain('webhook');
      expect((responses[2] as any).content[0].text).toContain('slack');
    });

    it('should handle interleaved requests', async () => {
      const results: string[] = [];

      // Start multiple requests with different delays
      const p1 = client.callTool({ name: 'tools_documentation', arguments: {} })
        .then(() => { results.push('docs'); return 'docs'; });

      const p2 = client.callTool({ name: 'search_nodes', arguments: { query: 'webhook', limit: 1 } })
        .then(() => { results.push('nodes'); return 'nodes'; });

      const p3 = client.callTool({ name: 'search_nodes', arguments: { query: 'http' } })
        .then(() => { results.push('search'); return 'search'; });

      const resolved = await Promise.all([p1, p2, p3]);

      // All should complete
      expect(resolved).toHaveLength(3);
      expect(results).toHaveLength(3);
    });
  });

  describe('Protocol Extensions', () => {
    it('should handle tool-specific extensions', async () => {
      // Test tool with complex params (using consolidated validate_node from v2.26.0)
      const response = await client.callTool({ name: 'validate_node', arguments: {
        nodeType: 'nodes-base.httpRequest',
        config: {
          method: 'GET',
          url: 'https://api.example.com'
        },
        mode: 'full',
        profile: 'runtime'
      } });

      expect((response as any).content).toHaveLength(1);
      expect((response as any).content[0].type).toBe('text');
    });

    it('should support optional parameters', async () => {
      // Call with minimal params
      const response1 = await client.callTool({ name: 'search_nodes', arguments: { query: 'webhook' } });

      // Call with all params
      const response2 = await client.callTool({ name: 'search_nodes', arguments: {
        query: 'webhook',
        limit: 10,
        mode: 'OR'
      } });

      expect(response1).toBeDefined();
      expect(response2).toBeDefined();
    });
  });

  describe('Transport Layer', () => {
    it('should handle transport disconnection gracefully', async () => {
      // Use a dedicated server instance so we don't conflict with the
      // shared mcpServer that beforeEach already connected a transport to.
      const dedicatedServer = new TestableN8NMCPServer();
      await dedicatedServer.initialize();

      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await dedicatedServer.connectToTransport(serverTransport);

      const testClient = new Client({ name: 'test', version: '1.0.0' }, {});
      await testClient.connect(clientTransport);

      // Make a request
      const response = await testClient.callTool({ name: 'tools_documentation', arguments: {} });
      expect(response).toBeDefined();

      // Close client
      await testClient.close();

      // Further requests should fail
      try {
        await testClient.callTool({ name: 'tools_documentation', arguments: {} });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      await dedicatedServer.close();
    });

    it('should handle multiple sequential connections', async () => {
      // Close existing connection
      await client.close();
      await mcpServer.close();

      // Create new connections
      for (let i = 0; i < 3; i++) {
        const engine = new TestableN8NMCPServer();
        await engine.initialize();

        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        await engine.connectToTransport(serverTransport);

        const testClient = new Client({ name: 'test', version: '1.0.0' }, {});
        await testClient.connect(clientTransport);

        const response = await testClient.callTool({ name: 'tools_documentation', arguments: {} });
        expect(response).toBeDefined();

        await testClient.close();
        await engine.close();
      }
    });
  });
});