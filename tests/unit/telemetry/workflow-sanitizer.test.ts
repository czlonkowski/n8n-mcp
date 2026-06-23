import { describe, it, expect } from 'vitest';
import { WorkflowSanitizer } from '../../../src/telemetry/workflow-sanitizer';

describe('WorkflowSanitizer', () => {
  describe('sanitizeWorkflow', () => {
    it('should remove API keys from parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              url: 'https://api.example.com',
              apiKey: 'sk-1234567890abcdef1234567890abcdef',
              headers: {
                'Authorization': 'Bearer sk-1234567890abcdef1234567890abcdef'
              }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].parameters.apiKey).toBe('[REDACTED]');
      expect(sanitized.nodes[0].parameters.headers.Authorization).toBe('[REDACTED]');
    });

    it('should redact webhook URL fields and keep other fields', () => {
      // Post-GHSA-f3rg-xqjj-cj9w: URL-named fields are fully redacted regardless
      // of value, so we no longer try to preserve the `https://[webhook-url]`
      // shape. The webhook short-circuit in sanitizeString still applies to
      // non-URL-named fields whose value embeds a /webhook/ URL (see below).
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [100, 100],
            parameters: {
              path: 'my-webhook',
              webhookUrl: 'https://n8n.example.com/webhook/abc-def-ghi',
              method: 'POST'
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].parameters.webhookUrl).toBe('[REDACTED_URL]');
      expect(sanitized.nodes[0].parameters.method).toBe('POST'); // Method should remain
      expect(sanitized.nodes[0].parameters.path).toBe('my-webhook'); // Path should remain
    });

    it('redacts /webhook/ URLs embedded in non-URL-named fields', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Note',
            type: 'n8n-nodes-base.set',
            position: [100, 100],
            parameters: {
              note: 'Trigger fires at https://n8n.example.com/webhook/abc-def-ghi when ready.'
            }
          }
        ],
        connections: {}
      };
      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);
      expect(sanitized.nodes[0].parameters.note).toBe('https://[webhook-url]');
    });

    it('should remove credentials entirely', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Slack',
            type: 'n8n-nodes-base.slack',
            position: [100, 100],
            parameters: {
              channel: 'general',
              text: 'Hello World'
            },
            credentials: {
              slackApi: {
                id: 'cred-123',
                name: 'My Slack'
              }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].credentials).toBeUndefined();
      expect(sanitized.nodes[0].parameters.channel).toBe('general'); // Channel should remain
      expect(sanitized.nodes[0].parameters.text).toBe('Hello World'); // Text should remain
    });

    it('should fully redact URL-like fields (GHSA-f3rg-xqjj-cj9w)', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              url: 'https://api.example.com/endpoint',
              endpoint: 'https://another.example.com/api',
              baseUrl: 'https://base.example.com'
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].parameters.url).toBe('[REDACTED_URL]');
      expect(sanitized.nodes[0].parameters.endpoint).toBe('[REDACTED_URL]');
      expect(sanitized.nodes[0].parameters.baseUrl).toBe('[REDACTED_URL]');
    });

    it('GHSA-f3rg-xqjj-cj9w: does not leak URL paths or query strings', () => {
      // Verbatim reproduction of the advisory PoC. Confirms that:
      //   - customer/tenant identifiers in URL paths
      //   - short query-string secrets (< 20 chars; under the generic-token threshold)
      //   - signed/short tokens hidden in query strings
      // never reach the telemetry payload.
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0] as [number, number],
            parameters: {
              url: 'https://api.example.com/v1/customer/123?api_key=shortsecret&tenant=acme',
              endpoint: 'https://internal.example.local/v2/users?token=abcd123456789012345',
              headers: { Authorization: 'Bearer abcdefghijklmnop' }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);
      const params = sanitized.nodes[0].parameters;
      const serialized = JSON.stringify(params);

      expect(params.url).toBe('[REDACTED_URL]');
      expect(params.endpoint).toBe('[REDACTED_URL]');
      expect(params.headers.Authorization).toBe('[REDACTED]');

      // Nothing from the original path/query string should survive anywhere.
      for (const leak of [
        'customer/123',
        'shortsecret',
        'tenant=acme',
        'v2/users',
        'abcd123456789012345',
        'api.example.com',
        'internal.example.local'
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });

    it('GHSA-f3rg-xqjj-cj9w: redacts short OAuth codes and signed query parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'OAuth',
            type: 'n8n-nodes-base.httpRequest',
            position: [0, 0] as [number, number],
            parameters: {
              url: 'https://oauth.example.com/callback?code=4/0AY0e&state=xyz',
              callbackUrl: 'https://s3.amazonaws.com/bucket/file.pdf?X-Amz-Signature=abc123'
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);
      const serialized = JSON.stringify(sanitized.nodes[0].parameters);

      for (const leak of [
        'code=4/0AY0e',
        'state=xyz',
        'X-Amz-Signature',
        'bucket/file.pdf',
        'oauth.example.com',
        's3.amazonaws.com'
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });

    it('should calculate workflow metrics correctly', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [100, 100],
            parameters: {}
          },
          {
            id: '2',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            position: [200, 100],
            parameters: {}
          },
          {
            id: '3',
            name: 'Slack',
            type: 'n8n-nodes-base.slack',
            position: [300, 100],
            parameters: {}
          }
        ],
        connections: {
          '1': {
            main: [[{ node: '2', type: 'main', index: 0 }]]
          },
          '2': {
            main: [[{ node: '3', type: 'main', index: 0 }]]
          }
        }
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodeCount).toBe(3);
      expect(sanitized.nodeTypes).toContain('n8n-nodes-base.webhook');
      expect(sanitized.nodeTypes).toContain('n8n-nodes-base.httpRequest');
      expect(sanitized.nodeTypes).toContain('n8n-nodes-base.slack');
      expect(sanitized.hasTrigger).toBe(true);
      expect(sanitized.hasWebhook).toBe(true);
      expect(sanitized.complexity).toBe('simple');
    });

    it('should calculate complexity based on node count', () => {
      const createWorkflow = (nodeCount: number) => ({
        nodes: Array.from({ length: nodeCount }, (_, i) => ({
          id: String(i),
          name: `Node ${i}`,
          type: 'n8n-nodes-base.function',
          position: [i * 100, 100],
          parameters: {}
        })),
        connections: {}
      });

      const simple = WorkflowSanitizer.sanitizeWorkflow(createWorkflow(5));
      expect(simple.complexity).toBe('simple');

      const medium = WorkflowSanitizer.sanitizeWorkflow(createWorkflow(15));
      expect(medium.complexity).toBe('medium');

      const complex = WorkflowSanitizer.sanitizeWorkflow(createWorkflow(25));
      expect(complex.complexity).toBe('complex');
    });

    it('should generate consistent workflow hash', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [100, 100],
            parameters: { path: 'test' }
          }
        ],
        connections: {}
      };

      const hash1 = WorkflowSanitizer.generateWorkflowHash(workflow);
      const hash2 = WorkflowSanitizer.generateWorkflowHash(workflow);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should sanitize nested objects in parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Complex Node',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              options: {
                headers: {
                  'X-API-Key': 'secret-key-1234567890abcdef',
                  'Content-Type': 'application/json'
                },
                body: {
                  data: 'some data',
                  token: 'another-secret-token-xyz123'
                }
              }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].parameters.options.headers['X-API-Key']).toBe('[REDACTED]');
      expect(sanitized.nodes[0].parameters.options.headers['Content-Type']).toBe('application/json');
      expect(sanitized.nodes[0].parameters.options.body.data).toBe('some data');
      expect(sanitized.nodes[0].parameters.options.body.token).toBe('[REDACTED]');
    });

    it('should preserve connections structure', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Node 1',
            type: 'n8n-nodes-base.start',
            position: [100, 100],
            parameters: {}
          },
          {
            id: '2',
            name: 'Node 2',
            type: 'n8n-nodes-base.function',
            position: [200, 100],
            parameters: {}
          }
        ],
        connections: {
          '1': {
            main: [[{ node: '2', type: 'main', index: 0 }]],
            error: [[{ node: '2', type: 'error', index: 0 }]]
          }
        }
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.connections).toEqual({
        '1': {
          main: [[{ node: '2', type: 'main', index: 0 }]],
          error: [[{ node: '2', type: 'error', index: 0 }]]
        }
      });
    });

    it('should remove sensitive workflow metadata', () => {
      const workflow = {
        id: 'workflow-123',
        name: 'My Workflow',
        nodes: [],
        connections: {},
        settings: {
          errorWorkflow: 'error-workflow-id',
          timezone: 'America/New_York'
        },
        staticData: { some: 'data' },
        pinData: { node1: 'pinned' },
        credentials: { slack: 'cred-123' },
        sharedWorkflows: ['user-456'],
        ownedBy: 'user-123',
        createdBy: 'user-123',
        updatedBy: 'user-456'
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      // Verify that sensitive workflow-level properties are not in the sanitized output
      // The sanitized workflow should only have specific fields as defined in SanitizedWorkflow interface
      expect(sanitized.nodes).toEqual([]);
      expect(sanitized.connections).toEqual({});
      expect(sanitized.nodeCount).toBe(0);
      expect(sanitized.nodeTypes).toEqual([]);

      // Verify these fields don't exist in the sanitized output
      const sanitizedAsAny = sanitized as any;
      expect(sanitizedAsAny.settings).toBeUndefined();
      expect(sanitizedAsAny.staticData).toBeUndefined();
      expect(sanitizedAsAny.pinData).toBeUndefined();
      expect(sanitizedAsAny.credentials).toBeUndefined();
      expect(sanitizedAsAny.sharedWorkflows).toBeUndefined();
      expect(sanitizedAsAny.ownedBy).toBeUndefined();
      expect(sanitizedAsAny.createdBy).toBeUndefined();
      expect(sanitizedAsAny.updatedBy).toBeUndefined();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle null or undefined workflow', () => {
      // The actual implementation will throw because JSON.parse(JSON.stringify(null)) is valid but creates issues
      expect(() => WorkflowSanitizer.sanitizeWorkflow(null as any)).toThrow();
      expect(() => WorkflowSanitizer.sanitizeWorkflow(undefined as any)).toThrow();
    });

    it('should handle workflow without nodes', () => {
      const workflow = {
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodeCount).toBe(0);
      expect(sanitized.nodeTypes).toEqual([]);
      expect(sanitized.nodes).toEqual([]);
      expect(sanitized.hasTrigger).toBe(false);
      expect(sanitized.hasWebhook).toBe(false);
    });

    it('should handle workflow without connections', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Test Node',
            type: 'n8n-nodes-base.function',
            position: [100, 100],
            parameters: {}
          }
        ]
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.connections).toEqual({});
      expect(sanitized.nodeCount).toBe(1);
    });

    it('should handle malformed nodes array', () => {
      const workflow = {
        nodes: [
          {
            id: '2',
            name: 'Valid Node',
            type: 'n8n-nodes-base.function',
            position: [100, 100],
            parameters: {}
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      // Should handle workflow gracefully
      expect(sanitized.nodeCount).toBe(1);
      expect(sanitized.nodes.length).toBe(1);
    });

    it('should handle deeply nested objects in parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Deep Node',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              level1: {
                level2: {
                  level3: {
                    level4: {
                      level5: {
                        secret: 'deep-secret-key-1234567890abcdef',
                        safe: 'safe-value'
                      }
                    }
                  }
                }
              }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes[0].parameters.level1.level2.level3.level4.level5.secret).toBe('[REDACTED]');
      expect(sanitized.nodes[0].parameters.level1.level2.level3.level4.level5.safe).toBe('safe-value');
    });

    it('should handle circular references gracefully', () => {
      const workflow: any = {
        nodes: [
          {
            id: '1',
            name: 'Circular Node',
            type: 'n8n-nodes-base.function',
            position: [100, 100],
            parameters: {}
          }
        ],
        connections: {}
      };

      // Create circular reference
      workflow.nodes[0].parameters.selfRef = workflow.nodes[0];

      // JSON.stringify throws on circular references, so this should throw
      expect(() => WorkflowSanitizer.sanitizeWorkflow(workflow)).toThrow();
    });

    it('should handle extremely large workflows', () => {
      const largeWorkflow = {
        nodes: Array.from({ length: 1000 }, (_, i) => ({
          id: String(i),
          name: `Node ${i}`,
          type: 'n8n-nodes-base.function',
          position: [i * 10, 100],
          parameters: {
            code: `// Node ${i} code here`.repeat(100) // Large parameter
          }
        })),
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(largeWorkflow);

      expect(sanitized.nodeCount).toBe(1000);
      expect(sanitized.complexity).toBe('complex');
    });

    it('should handle various sensitive data patterns', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Sensitive Node',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              // Different patterns of sensitive data
              api_key: 'sk-1234567890abcdef1234567890abcdef',
              accessToken: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
              secret_token: 'secret-123-abc-def',
              authKey: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
              clientSecret: 'abc123def456ghi789',
              webhookUrl: 'https://hooks.example.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
              databaseUrl: 'postgres://user:password@localhost:5432/db',
              connectionString: 'Server=myServerAddress;Database=myDataBase;Uid=myUsername;Pwd=myPassword;',
              // Safe values that should remain
              timeout: 5000,
              method: 'POST',
              retries: 3,
              name: 'My API Call'
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      const params = sanitized.nodes[0].parameters;
      expect(params.api_key).toBe('[REDACTED]');
      expect(params.accessToken).toBe('[REDACTED]');
      expect(params.secret_token).toBe('[REDACTED]');
      expect(params.authKey).toBe('[REDACTED]');
      expect(params.clientSecret).toBe('[REDACTED]');
      // Post-GHSA-f3rg-xqjj-cj9w: URL-named fields are fully redacted to
      // [REDACTED_URL] regardless of pattern matches inside the value.
      expect(params.webhookUrl).toBe('[REDACTED_URL]');
      expect(params.databaseUrl).toBe('[REDACTED_URL]');
      expect(params.connectionString).toBe('[REDACTED]');

      // Safe values should remain
      expect(params.timeout).toBe(5000);
      expect(params.method).toBe('POST');
      expect(params.retries).toBe(3);
      expect(params.name).toBe('My API Call');
    });

    it('should handle arrays in parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Array Node',
            type: 'n8n-nodes-base.httpRequest',
            position: [100, 100],
            parameters: {
              headers: [
                { name: 'Authorization', value: 'Bearer secret-token-123456789' },
                { name: 'Content-Type', value: 'application/json' },
                { name: 'X-API-Key', value: 'api-key-abcdefghijklmnopqrstuvwxyz' }
              ],
              methods: ['GET', 'POST']
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      const headers = sanitized.nodes[0].parameters.headers;
      expect(headers[0].value).toBe('Bearer [REDACTED]'); // Authorization (Bearer prefix preserved)
      expect(headers[1].value).toBe('application/json'); // Content-Type (safe)
      expect(headers[2].value).toBe('[REDACTED_TOKEN]'); // X-API-Key (32+ chars)
      expect(sanitized.nodes[0].parameters.methods).toEqual(['GET', 'POST']); // Array should remain
    });

    it('should handle mixed data types in parameters', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Mixed Node',
            type: 'n8n-nodes-base.function',
            position: [100, 100],
            parameters: {
              numberValue: 42,
              booleanValue: true,
              stringValue: 'safe string',
              nullValue: null,
              undefinedValue: undefined,
              dateValue: new Date('2024-01-01'),
              arrayValue: [1, 2, 3],
              nestedObject: {
                secret: 'secret-key-12345678',
                safe: 'safe-value'
              }
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      const params = sanitized.nodes[0].parameters;
      expect(params.numberValue).toBe(42);
      expect(params.booleanValue).toBe(true);
      expect(params.stringValue).toBe('safe string');
      expect(params.nullValue).toBeNull();
      expect(params.undefinedValue).toBeUndefined();
      expect(params.arrayValue).toEqual([1, 2, 3]);
      expect(params.nestedObject.secret).toBe('[REDACTED]');
      expect(params.nestedObject.safe).toBe('safe-value');
    });

    it('should handle missing node properties gracefully', () => {
      const workflow = {
        nodes: [
          { id: '3', name: 'Complete', type: 'n8n-nodes-base.function' } // Missing position but has required fields
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodes).toBeDefined();
      expect(sanitized.nodeCount).toBe(1);
    });

    it('should handle complex connection structures', () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Start', type: 'n8n-nodes-base.start', position: [0, 0], parameters: {} },
          { id: '2', name: 'Branch', type: 'n8n-nodes-base.if', position: [100, 0], parameters: {} },
          { id: '3', name: 'Path A', type: 'n8n-nodes-base.function', position: [200, 0], parameters: {} },
          { id: '4', name: 'Path B', type: 'n8n-nodes-base.function', position: [200, 100], parameters: {} },
          { id: '5', name: 'Merge', type: 'n8n-nodes-base.merge', position: [300, 50], parameters: {} }
        ],
        connections: {
          '1': {
            main: [[{ node: '2', type: 'main', index: 0 }]]
          },
          '2': {
            main: [
              [{ node: '3', type: 'main', index: 0 }],
              [{ node: '4', type: 'main', index: 0 }]
            ]
          },
          '3': {
            main: [[{ node: '5', type: 'main', index: 0 }]]
          },
          '4': {
            main: [[{ node: '5', type: 'main', index: 1 }]]
          }
        }
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.connections).toEqual(workflow.connections);
      expect(sanitized.nodeCount).toBe(5);
      expect(sanitized.complexity).toBe('simple'); // 5 nodes = simple
    });

    it('should generate different hashes for different workflows', () => {
      const workflow1 = {
        nodes: [{ id: '1', name: 'Node1', type: 'type1', position: [0, 0], parameters: {} }],
        connections: {}
      };

      const workflow2 = {
        nodes: [{ id: '1', name: 'Node2', type: 'type2', position: [0, 0], parameters: {} }],
        connections: {}
      };

      const hash1 = WorkflowSanitizer.generateWorkflowHash(workflow1);
      const hash2 = WorkflowSanitizer.generateWorkflowHash(workflow2);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{16}$/);
      expect(hash2).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle workflow with only trigger nodes', () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Cron', type: 'n8n-nodes-base.cron', position: [0, 0], parameters: {} },
          { id: '2', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 0], parameters: {} }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.hasTrigger).toBe(true);
      expect(sanitized.hasWebhook).toBe(true);
      expect(sanitized.nodeTypes).toContain('n8n-nodes-base.cron');
      expect(sanitized.nodeTypes).toContain('n8n-nodes-base.webhook');
    });

    it('should handle workflow with special characters in node names and types', () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Node with émojis 🚀 and specíal chars',
            type: 'n8n-nodes-base.function',
            position: [0, 0],
            parameters: {
              message: 'Test with émojis 🎉 and URLs https://example.com'
            }
          }
        ],
        connections: {}
      };

      const sanitized = WorkflowSanitizer.sanitizeWorkflow(workflow);

      expect(sanitized.nodeCount).toBe(1);
      expect(sanitized.nodes[0].name).toBe('Node with émojis 🚀 and specíal chars');
    });
  });

  describe('idempotency and multi-secret strings', () => {
    it('redacts secrets matching different patterns in the same string (no early break)', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: {
            jsCode:
              "const KEY = 'sk-1234567890abcdef1234567890abcdef';\n" +
              "fetch(u, { headers: { auth: 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' } });"
          },
        }],
        connections: {},
      };
      const out = WorkflowSanitizer.sanitizeWorkflow(wf);
      const code = (out.nodes[0].parameters as any).jsCode;
      expect(code).not.toMatch(/sk-1234567890abcdef/);
      expect(code).not.toMatch(/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/);
      expect(code).toContain('Bearer [REDACTED]');
    });

    it('produces byte-identical output when sanitized twice (idempotency)', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: {
            jsCode:
              "const KEY = 'sk-proj-HjL38eurXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';\n" +
              "const SUPA = 'sb_secret_8vSVYqplak7kizRcykjm0w_Xb2fObQ5x';\n" +
              "const E = 'jane.doe@example.org'; const P = '+1-604-555-1234';"
          },
        }],
        connections: {},
      };
      const first = WorkflowSanitizer.sanitizeWorkflow(wf);
      const second = WorkflowSanitizer.sanitizeWorkflow({ ...wf, nodes: first.nodes });
      expect(JSON.stringify(second.nodes)).toBe(JSON.stringify(first.nodes));
    });

    it('Bearer pattern stops at quotes and delimiters, preserving surrounding syntax', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: { jsCode: "const headers = { auth: 'Bearer my-secret-token-1234567890', other: 'x' };" },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).jsCode;
      expect(out).toContain("'Bearer [REDACTED]'");
      expect(out).toContain("', other: 'x'");
      expect(out).not.toContain('my-secret-token');
    });

    it('does not re-redact existing [REDACTED_*] placeholders', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: { jsCode: 'const A = "[REDACTED_LLM_API_KEY]"; const B = "[REDACTED_SUPABASE_KEY]";' },
        }],
        connections: {},
      };
      const out = WorkflowSanitizer.sanitizeWorkflow(wf);
      const code = (out.nodes[0].parameters as any).jsCode;
      expect(code).toContain('[REDACTED_LLM_API_KEY]');
      expect(code).toContain('[REDACTED_SUPABASE_KEY]');
    });
  });

  describe('provider-specific token patterns (Gap 4)', () => {
    const codeNode = (jsCode: string) => ({
      nodes: [{
        id: '1', name: 'Code', type: 'n8n-nodes-base.code',
        position: [0, 0] as [number, number], typeVersion: 2,
        parameters: { jsCode },
      }],
      connections: {},
    });

    const sweep = (jsCode: string): string =>
      (WorkflowSanitizer.sanitizeWorkflow(codeNode(jsCode)).nodes[0].parameters as any).jsCode;

    it('redacts Supabase secret keys', () => {
      const out = sweep("const K = 'sb_secret_8vSVYqplak7kizRcykjm0w_Xb2fObQ5x';");
      expect(out).not.toMatch(/sb_secret_/);
      expect(out).toContain('[REDACTED_SUPABASE_KEY]');
    });

    it('redacts Supabase publishable keys', () => {
      const out = sweep("const K = 'sb_publishable_abcDEF0123456789_-_xyz_more';");
      expect(out).not.toMatch(/sb_publishable_/);
      expect(out).toContain('[REDACTED_SUPABASE_KEY]');
    });

    it('redacts Supabase anon JWT', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTYwMDAwMDAwMH0.' +
        'abcdefghijklmnopqrstuvwxyz0123';
      const out = sweep(`const T = '${jwt}';`);
      expect(out).not.toContain(jwt);
      expect(out).toContain('[REDACTED_JWT]');
    });

    it('redacts OpenAI sk-proj keys', () => {
      const out = sweep("const OPENAI_KEY = 'sk-proj-HjL38eurAB-CD12EF34GH56IJ78KL90MN12OP34QR56ST78UV90WX';");
      expect(out).not.toMatch(/sk-proj-[A-Za-z0-9_-]{8,}/);
      expect(out).toContain('[REDACTED_LLM_API_KEY]');
    });

    it('redacts OpenRouter sk-or-v1 keys', () => {
      const out = sweep("const K = 'sk-or-v1-98807773d8a194795324abcdef0123456789abcdef';");
      expect(out).not.toMatch(/sk-or-(?:v1-)?[A-Za-z0-9-]{8,}/);
      expect(out).toContain('[REDACTED_LLM_API_KEY]');
    });

    it('redacts Stripe live and restricted keys', () => {
      // Build literals by concatenation so the source doesn't trip GitHub
      // push protection / secretlint while still producing format-valid
      // Stripe-shaped strings at runtime.
      const stripeLive = 'sk_li' + 've_' + '51HAaAaAaAaAaAaAaAaAaAaAa';
      const stripeTest = 'rk_te' + 'st_' + '51HBbBbBbBbBbBbBbBbBbBbBb';
      const out = sweep(`const A='${stripeLive}'; const B='${stripeTest}';`);
      expect(out).not.toMatch(/sk_live_|rk_test_/);
      expect((out.match(/\[REDACTED_STRIPE_KEY\]/g) || []).length).toBe(2);
    });

    it('redacts GitHub PATs (classic + fine-grained)', () => {
      const out = sweep("const A='ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; const B='github_pat_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';");
      expect(out).not.toMatch(/ghp_|github_pat_/);
      expect((out.match(/\[REDACTED_API_TOKEN\]/g) || []).length).toBe(2);
    });

    it('redacts GitLab PATs', () => {
      const out = sweep("const T='glpat-AbCdEfGhIjKlMnOpQrSt';");
      expect(out).not.toMatch(/glpat-/);
      expect(out).toContain('[REDACTED_API_TOKEN]');
    });

    it('redacts Hugging Face, Notion, GoHighLevel and Slack tokens', () => {
      const out = sweep(
        "const HF='hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';" +
        "const NTN='ntn_abcdefghijklmnopqrstuvwxyz01234567890ABCD';" +
        "const PIT='pit-1b3c7766-aaaa-bbbb-cccc-1234567890ab';" +
        "const SLK='xoxb-1234567890-abcdefghij-AbCdEfGhIjKlMnOp';"
      );
      expect(out).not.toMatch(/hf_|ntn_|pit-|xoxb-/);
      expect((out.match(/\[REDACTED_API_TOKEN\]/g) || []).length).toBe(4);
    });

    it('redacts AWS access key ids', () => {
      const out = sweep("const K='AKIAIOSFODNN7EXAMPLE';");
      expect(out).not.toMatch(/AKIA[A-Z0-9]{16}/);
      expect(out).toContain('[REDACTED_API_TOKEN]');
    });

    it('produces type-aware placeholder for plain OpenAI sk- keys', () => {
      const out = sweep("const K = 'sk-1234567890abcdef1234567890abcdef';");
      expect(out).toContain('[REDACTED_LLM_API_KEY]');
      expect(out).not.toContain('[REDACTED_APIKEY]');
    });
  });

  describe('topology-leaking URL patterns (Gaps 5 & 6)', () => {
    it('redacts self-hosted n8n hostnames anywhere they appear', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: { jsCode: "fetch('https://n8n.smeventures.dev/workflow/9uF6YQlHJjdsePK');" },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).jsCode;
      expect(out).not.toContain('smeventures.dev');
      expect(out).toContain('[REDACTED_N8N_HOST_URL]');
    });

    it('redacts Supabase project URLs (20-char project ref)', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: { jsCode: "const URL = 'https://lhbpobflhcizuaxehfvl.supabase.co/rest/v1/users';" },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).jsCode;
      expect(out).not.toContain('lhbpobflhcizuaxehfvl.supabase.co');
      expect(out).toContain('[REDACTED_SUPABASE_URL]');
    });

    it('redacts Supabase URLs in url fields (no path or project-ref leak)', () => {
      // Post-GHSA-f3rg-xqjj-cj9w: url-named fields are fully redacted at the
      // field-name layer, so even the Supabase-specific pattern is short-
      // circuited. What matters is that no fragment of the original URL
      // survives.
      const wf = {
        nodes: [{
          id: '1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest',
          position: [0, 0] as [number, number], typeVersion: 4,
          parameters: { url: 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/x' },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).url;
      expect(out).toBe('[REDACTED_URL]');
      expect(out).not.toContain('supabase.co');
      expect(out).not.toContain('abcdefghijklmnopqrst');
      expect(out).not.toContain('rest/v1/x');
    });
  });

  describe('email and phone PII patterns', () => {
    it('redacts emails embedded in systemMessage / html / text fields', () => {
      const wf = {
        nodes: [
          { id: '1', name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent',
            position: [0, 0] as [number, number], typeVersion: 1,
            parameters: { systemMessage: 'Contact Claire.Tremblay@betterhealthclinic.com for details.' } },
          { id: '2', name: 'Email', type: 'n8n-nodes-base.emailSend',
            position: [0, 0] as [number, number], typeVersion: 2.1,
            parameters: { html: '<p>Best, marcelo.fonseca@livefully.io</p>' } },
        ],
        connections: {},
      };
      const out = WorkflowSanitizer.sanitizeWorkflow(wf);
      expect((out.nodes[0].parameters as any).systemMessage).not.toContain('@betterhealthclinic.com');
      expect((out.nodes[0].parameters as any).systemMessage).toContain('[REDACTED_EMAIL]');
      expect((out.nodes[1].parameters as any).html).toContain('[REDACTED_EMAIL]');
    });

    it('redacts phone numbers in free-text fields', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent',
          position: [0, 0] as [number, number], typeVersion: 1,
          parameters: { systemMessage: 'Call our support: +1-604-555-1234 or (604) 555-1234.' },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).systemMessage;
      expect(out).not.toMatch(/\d{3}.*\d{3}.*\d{4}/);
      expect((out.match(/\[REDACTED_PHONE\]/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    it('does not misclassify UUIDs as phone numbers', () => {
      const wf = {
        nodes: [{
          id: '1', name: 'Code', type: 'n8n-nodes-base.code',
          position: [0, 0] as [number, number], typeVersion: 2,
          parameters: { jsCode: "const id = 'a1b2c3d4-1234-5678-9abc-123456789012';" },
        }],
        connections: {},
      };
      const out = (WorkflowSanitizer.sanitizeWorkflow(wf).nodes[0].parameters as any).jsCode;
      expect(out).not.toContain('[REDACTED_PHONE]');
      // The UUID will be redacted by the long-token (32+ char) fallback as
      // [REDACTED_TOKEN] — that's correct behaviour. Phone redaction must not fire.
    });
  });
});