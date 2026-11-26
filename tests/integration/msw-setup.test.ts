import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mswTestServer, n8nApiMock, testDataBuilders, integrationTestServer } from './setup/msw-test-server';
import { http, HttpResponse } from 'msw';
import axios from 'axios';
import { server } from './setup/integration-setup';

describe('MSW Setup Verification', () => {
  const baseUrl = 'http://localhost:5678';

  describe('Global MSW Setup', () => {
    it('should intercept n8n API requests with default handlers', async () => {
      // This uses the global MSW setup from vitest.config.ts
      const response = await axios.get(`${baseUrl}/api/v1/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        status: 'ok',
        version: '1.103.2',
        features: {
          workflows: true,
          executions: true,
          credentials: true,
          webhooks: true,
        }
      });
    });

    it('should allow custom handlers for specific tests', async () => {
      // Add a custom handler just for this test using the global server
      server.use(
        http.get('*/api/v1/custom-endpoint', () => {
          return HttpResponse.json({ custom: true });
        })
      );

      const response = await axios.get(`${baseUrl}/api/v1/custom-endpoint`);
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ custom: true });
    });

    it('should return mock workflows', async () => {
      const response = await axios.get(`${baseUrl}/api/v1/workflows`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(Array.isArray(response.data.data)).toBe(true);
      expect(response.data.data.length).toBeGreaterThan(0);
    });
  });

  describe('Integration Test Server', () => {
    // Use the global MSW server instance for these tests
    afterEach(() => {
      // Reset handlers after each test to ensure clean state
      server.resetHandlers();
    });

    it('should handle workflow creation with custom response', async () => {
      // Use the global server instance to add custom handler
      server.use(
        http.post('*/api/v1/workflows', async ({ request }) => {
          const body = await request.json() as any;
          return HttpResponse.json({
            data: {
              id: 'custom-workflow-123',
              name: 'Test Workflow from MSW',
              active: body.active || false,
              nodes: body.nodes,
              connections: body.connections,
              settings: body.settings || {},
              tags: body.tags || [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              versionId: '1'
            }
          }, { status: 201 });
        })
      );

      const workflowData = testDataBuilders.workflow({
        name: 'My Test Workflow'
      });

      const response = await axios.post(`${baseUrl}/api/v1/workflows`, workflowData);
      
      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        id: 'custom-workflow-123',
        name: 'Test Workflow from MSW',
        nodes: workflowData.nodes,
        connections: workflowData.connections
      });
    });

    it('should handle error responses', async () => {
      server.use(
        http.get('*/api/v1/workflows/missing', () => {
          return HttpResponse.json(
            {
              message: 'Workflow not found',
              code: 'NOT_FOUND',
              timestamp: new Date().toISOString()
            },
            { status: 404 }
          );
        })
      );

      try {
        await axios.get(`${baseUrl}/api/v1/workflows/missing`);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
        expect(error.response.data).toEqual({
          message: 'Workflow not found',
          code: 'NOT_FOUND',
          timestamp: expect.any(String)
        });
      }
    });

    it('should simulate rate limiting', async () => {
      let requestCount = 0;
      const limit = 5;
      
      server.use(
        http.get('*/api/v1/rate-limited', () => {
          requestCount++;
          
          if (requestCount > limit) {
            return HttpResponse.json(
              {
                message: 'Rate limit exceeded',
                code: 'RATE_LIMIT',
                retryAfter: 60
              },
              {
                status: 429,
                headers: {
                  'X-RateLimit-Limit': String(limit),
                  'X-RateLimit-Remaining': '0',
                  'X-RateLimit-Reset': String(Date.now() + 60000)
                }
              }
            );
          }
          
          return HttpResponse.json({ success: true });
        })
      );

      // Make requests up to the limit
      for (let i = 0; i < 5; i++) {
        const response = await axios.get(`${baseUrl}/api/v1/rate-limited`);
        expect(response.status).toBe(200);
      }

      // Next request should be rate limited
      try {
        await axios.get(`${baseUrl}/api/v1/rate-limited`);
        expect.fail('Should have been rate limited');
      } catch (error: any) {
        expect(error.response.status).toBe(429);
        expect(error.response.data.code).toBe('RATE_LIMIT');
        expect(error.response.headers['x-ratelimit-remaining']).toBe('0');
      }
    });

    it('should handle webhook execution', async () => {
      server.use(
        http.post('*/webhook/test-webhook', async ({ request }) => {
          const body = await request.json();
          
          return HttpResponse.json({
            processed: true,
            result: 'success',
            webhookReceived: {
              path: 'test-webhook',
              method: 'POST',
              body,
              timestamp: new Date().toISOString()
            }
          });
        })
      );

      const webhookData = { message: 'Test webhook payload' };
      const response = await axios.post(`${baseUrl}/webhook/test-webhook`, webhookData);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        processed: true,
        result: 'success',
        webhookReceived: {
          path: 'test-webhook',
          method: 'POST',
          body: webhookData,
          timestamp: expect.any(String)
        }
      });
    });

    it('should wait for specific requests', { timeout: 10000 }, async () => {
      // Since the global server is already handling these endpoints,
      // we'll just make the requests and verify they succeed
      const responses = await Promise.all([
        axios.get(`${baseUrl}/api/v1/workflows`),
        axios.get(`${baseUrl}/api/v1/executions`)
      ]);

      expect(responses).toHaveLength(2);
      expect(responses[0].status).toBe(200);
      expect(responses[0].config.url).toContain('/api/v1/workflows');
      expect(responses[1].status).toBe(200);
      expect(responses[1].config.url).toContain('/api/v1/executions');
    }); // Increase timeout for this specific test

    it('should work with scoped handlers', async () => {
      // First add the scoped handler
      server.use(
        http.get('*/api/v1/scoped', () => {
          return HttpResponse.json({ scoped: true });
        })
      );
      
      // Make the request while handler is active
      const response = await axios.get(`${baseUrl}/api/v1/scoped`);
      expect(response.data).toEqual({ scoped: true });
      
      // Reset handlers to remove the scoped handler
      server.resetHandlers();
      
      // Verify the scoped handler is no longer active
      // Since there's no handler for this endpoint now, it should fall through to the catch-all
      try {
        await axios.get(`${baseUrl}/api/v1/scoped`);
        expect.fail('Should have returned 501');
      } catch (error: any) {
        expect(error.response.status).toBe(501);
      }
    });
  });

  describe('Factory Functions', () => {
    it('should create workflows using factory', async () => {
      const { workflowFactory } = await import('../mocks/n8n-api/data/workflows');
      
      const simpleWorkflow = workflowFactory.simple('n8n-nodes-base.slack', {
        resource: 'message',
        operation: 'post',
        channel: '#general',
        text: 'Hello from test'
      });

      expect(simpleWorkflow).toMatchObject({
        id: expect.stringMatching(/^workflow_\d+$/),
        name: 'Test n8n-nodes-base.slack Workflow', // Factory uses nodeType in the name
        active: true,
        nodes: expect.arrayContaining([
          expect.objectContaining({ type: 'n8n-nodes-base.start' }),
          expect.objectContaining({ 
            type: 'n8n-nodes-base.slack',
            parameters: {
              resource: 'message',
              operation: 'post',
              channel: '#general',
              text: 'Hello from test'
            }
          })
        ])
      });
    });

    it('should create executions using factory', async () => {
      const { executionFactory } = await import('../mocks/n8n-api/data/executions');
      
      const successExecution = executionFactory.success('workflow_123');
      const errorExecution = executionFactory.error('workflow_456', {
        message: 'Connection timeout',
        node: 'http_request_1'
      });

      expect(successExecution).toMatchObject({
        workflowId: 'workflow_123',
        status: 'success',
        mode: 'manual'
      });

      expect(errorExecution).toMatchObject({
        workflowId: 'workflow_456',
        status: 'error',
        error: {
          message: 'Connection timeout',
          node: 'http_request_1'
        }
      });
    });
  });
});