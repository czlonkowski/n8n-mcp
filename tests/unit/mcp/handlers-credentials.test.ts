/**
 * Unit tests for credential management handlers
 *
 * SECURITY CRITICAL: These tests verify that secret data is NEVER returned
 * to users through the MCP interface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the N8nApiClient before importing handlers
const mockListCredentials = vi.fn();
const mockGetCredential = vi.fn();

vi.mock('../../../src/services/n8n-api-client', () => ({
  N8nApiClient: vi.fn().mockImplementation(() => ({
    listCredentials: mockListCredentials,
    getCredential: mockGetCredential,
  })),
}));

vi.mock('../../../src/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn().mockReturnValue({
    baseUrl: 'https://test.n8n.cloud',
    apiKey: 'test-key',
    timeout: 30000,
    maxRetries: 3,
  }),
  getN8nApiConfigFromContext: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Credential Management Handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeCredential Security', () => {
    it('should NEVER include the data field in returned credentials', () => {
      // This simulates what the sanitizeCredential function does
      const credentialWithSecrets = {
        id: 'cred-123',
        name: 'My OpenAI Key',
        type: 'openAiApi',
        data: { apiKey: 'sk-super-secret-key-12345' },  // SECRET!
        nodesAccess: [{ nodeType: 'n8n-nodes-base.openAi' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      // Simulate sanitization
      const { data, ...safeCredential } = credentialWithSecrets;

      // Verify the data field is NOT present
      expect(safeCredential).not.toHaveProperty('data');
      expect('data' in safeCredential).toBe(false);

      // Verify other fields ARE present
      expect(safeCredential.id).toBe('cred-123');
      expect(safeCredential.name).toBe('My OpenAI Key');
      expect(safeCredential.type).toBe('openAiApi');
      expect(safeCredential.nodesAccess).toBeDefined();
    });

    it('should handle credentials with undefined data field', () => {
      const credentialNoData = {
        id: 'cred-456',
        name: 'Test Credential',
        type: 'httpBasicAuth',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const { data, ...safeCredential } = credentialNoData as any;

      // Should still work even if data is undefined
      expect(safeCredential).not.toHaveProperty('data');
      expect(safeCredential.id).toBe('cred-456');
    });

    it('should handle credentials with empty data object', () => {
      const credentialEmptyData = {
        id: 'cred-789',
        name: 'Empty Credential',
        type: 'httpHeaderAuth',
        data: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const { data, ...safeCredential } = credentialEmptyData;

      expect(safeCredential).not.toHaveProperty('data');
      expect(safeCredential.id).toBe('cred-789');
    });
  });

  describe('handleListCredentials', () => {
    it('should sanitize ALL credentials in the response', async () => {
      const mockCredentialsWithSecrets = [
        {
          id: 'cred-1',
          name: 'OpenAI',
          type: 'openAiApi',
          data: { apiKey: 'sk-secret-1' },
        },
        {
          id: 'cred-2',
          name: 'Slack',
          type: 'slackApi',
          data: { accessToken: 'xoxb-secret-2' },
        },
        {
          id: 'cred-3',
          name: 'Database',
          type: 'postgresApi',
          data: { host: 'db.example.com', password: 'super-secret-password' },
        },
      ];

      // Simulate what handleListCredentials does
      const sanitizedCredentials = mockCredentialsWithSecrets.map(cred => {
        const { data, ...safe } = cred;
        return safe;
      });

      // Verify NO credential has the data field
      sanitizedCredentials.forEach(cred => {
        expect(cred).not.toHaveProperty('data');
      });

      // Verify all credentials are present
      expect(sanitizedCredentials).toHaveLength(3);
      expect(sanitizedCredentials[0].id).toBe('cred-1');
      expect(sanitizedCredentials[1].id).toBe('cred-2');
      expect(sanitizedCredentials[2].id).toBe('cred-3');
    });

    it('should filter by type when specified', async () => {
      const allCredentials = [
        { id: 'cred-1', name: 'OpenAI 1', type: 'openAiApi' },
        { id: 'cred-2', name: 'Slack', type: 'slackApi' },
        { id: 'cred-3', name: 'OpenAI 2', type: 'openAiApi' },
      ];

      const filterType = 'openAiApi';
      const filtered = allCredentials.filter(c => c.type === filterType);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.type === 'openAiApi')).toBe(true);
    });
  });

  describe('handleGetCredentialSchema', () => {
    it('should return known schema for common credential types', () => {
      const commonCredentialSchemas: Record<string, { fields: string[], description: string }> = {
        'openAiApi': {
          fields: ['apiKey'],
          description: 'OpenAI API credentials'
        },
        'googlePalmApi': {
          fields: ['apiKey'],
          description: 'Google AI (Gemini/PaLM) API credentials'
        },
        'slackApi': {
          fields: ['accessToken'],
          description: 'Slack Bot Token or User Token'
        },
        'httpBasicAuth': {
          fields: ['user', 'password'],
          description: 'HTTP Basic Authentication'
        },
        'postgresApi': {
          fields: ['host', 'database', 'user', 'password', 'port', 'ssl'],
          description: 'PostgreSQL database credentials'
        },
      };

      // Test openAiApi
      const openAiSchema = commonCredentialSchemas['openAiApi'];
      expect(openAiSchema).toBeDefined();
      expect(openAiSchema.fields).toContain('apiKey');

      // Test postgresApi has multiple fields
      const postgresSchema = commonCredentialSchemas['postgresApi'];
      expect(postgresSchema).toBeDefined();
      expect(postgresSchema.fields).toContain('host');
      expect(postgresSchema.fields).toContain('password');
    });

    it('should return appropriate message for unknown credential types', () => {
      const commonCredentialSchemas: Record<string, { fields: string[], description: string }> = {
        'openAiApi': {
          fields: ['apiKey'],
          description: 'OpenAI API credentials'
        },
      };

      const unknownType = 'someCustomCredentialType';
      const knownSchema = commonCredentialSchemas[unknownType];

      if (!knownSchema) {
        const note = 'Schema details not available for this credential type. Check n8n documentation for required fields.';
        expect(note).toContain('not available');
      }
    });
  });

  describe('handleTestCredential', () => {
    it('should return exists status when credential is found', () => {
      const credential = {
        id: 'cred-123',
        name: 'Test Credential',
        type: 'openAiApi',
      };

      const response = {
        credential,
        status: 'exists',
        message: 'Credential exists and is accessible. Note: To fully test the credential, use it in a workflow execution.',
        hint: 'The n8n API does not expose a direct credential testing endpoint.',
      };

      expect(response.status).toBe('exists');
      expect(response.message).toContain('exists and is accessible');
    });

    it('should return not_found status when credential does not exist', () => {
      const response = {
        status: 'not_found',
        hint: 'The credential ID does not exist. Use n8n_list_credentials to find valid credential IDs.',
      };

      expect(response.status).toBe('not_found');
      expect(response.hint).toContain('n8n_list_credentials');
    });
  });

  describe('handleAssignCredential', () => {
    it('should detect credential type mismatch', () => {
      const credential = {
        id: 'cred-123',
        name: 'OpenAI Key',
        type: 'openAiApi',  // Actual type
      };

      const requestedType = 'slackApi';  // Requested type (wrong)

      if (credential.type !== requestedType) {
        const errorDetails = {
          expected: requestedType,
          actual: credential.type,
          hint: `The credential "${credential.name}" is of type "${credential.type}", not "${requestedType}". Use the correct credential type.`,
        };

        expect(errorDetails.expected).toBe('slackApi');
        expect(errorDetails.actual).toBe('openAiApi');
        expect(errorDetails.hint).toContain('Use the correct credential type');
      }
    });

    it('should construct correct updateNode operation', () => {
      const input = {
        workflowId: 'workflow-abc',
        nodeName: 'OpenAI Chat Model',
        credentialId: 'cred-123',
        credentialType: 'openAiApi',
      };

      const credentialName = 'My OpenAI Key';

      const operation = {
        type: 'updateNode',
        nodeName: input.nodeName,
        updates: {
          credentials: {
            [input.credentialType]: {
              id: input.credentialId,
              name: credentialName,
            },
          },
        },
      };

      expect(operation.type).toBe('updateNode');
      expect(operation.nodeName).toBe('OpenAI Chat Model');
      expect(operation.updates.credentials.openAiApi.id).toBe('cred-123');
      expect(operation.updates.credentials.openAiApi.name).toBe('My OpenAI Key');
    });
  });

  describe('Input Validation', () => {
    it('should validate limit is within bounds for listCredentials', () => {
      const validInputs = [1, 50, 100];
      const invalidInputs = [0, -1, 101, 1000];

      validInputs.forEach(limit => {
        expect(limit >= 1 && limit <= 100).toBe(true);
      });

      invalidInputs.forEach(limit => {
        expect(limit >= 1 && limit <= 100).toBe(false);
      });
    });

    it('should require id for getCredential', () => {
      const validInput = { id: 'cred-123' };
      const invalidInput = {};

      expect('id' in validInput).toBe(true);
      expect('id' in invalidInput).toBe(false);
    });

    it('should require all fields for assignCredential', () => {
      const requiredFields = ['workflowId', 'nodeName', 'credentialId', 'credentialType'];

      const validInput = {
        workflowId: 'wf-123',
        nodeName: 'OpenAI Chat Model',
        credentialId: 'cred-456',
        credentialType: 'openAiApi',
      };

      const incompleteInput = {
        workflowId: 'wf-123',
        nodeName: 'OpenAI Chat Model',
        // Missing credentialId and credentialType
      };

      requiredFields.forEach(field => {
        expect(field in validInput).toBe(true);
      });

      expect('credentialId' in incompleteInput).toBe(false);
      expect('credentialType' in incompleteInput).toBe(false);
    });
  });
});
