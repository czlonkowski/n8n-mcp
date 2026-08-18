import { describe, it, expect } from 'vitest';
import {
  formatExecutionError,
  formatNoExecutionError,
  getUserFriendlyErrorMessage,
  handleN8nApiError,
  N8nApiError,
  N8nAuthenticationError,
  N8nNotFoundError,
  N8nValidationError,
  N8nRateLimitError,
  N8nServerError
} from '../../../src/utils/n8n-errors';

describe('formatExecutionError', () => {
  it('should format error with both execution ID and workflow ID', () => {
    const result = formatExecutionError('exec_12345', 'wf_abc');

    expect(result).toBe("Workflow wf_abc execution exec_12345 failed. Use n8n_get_execution({id: 'exec_12345', mode: 'preview'}) to investigate the error.");
    expect(result).toContain('mode: \'preview\'');
    expect(result).toContain('exec_12345');
    expect(result).toContain('wf_abc');
  });

  it('should format error with only execution ID', () => {
    const result = formatExecutionError('exec_67890');

    expect(result).toBe("Execution exec_67890 failed. Use n8n_get_execution({id: 'exec_67890', mode: 'preview'}) to investigate the error.");
    expect(result).toContain('mode: \'preview\'');
    expect(result).toContain('exec_67890');
    expect(result).not.toContain('Workflow');
  });

  it('should include preview mode guidance', () => {
    const result = formatExecutionError('test_id');

    expect(result).toMatch(/mode:\s*'preview'/);
  });

  it('should format with undefined workflow ID (treated as missing)', () => {
    const result = formatExecutionError('exec_123', undefined);

    expect(result).toBe("Execution exec_123 failed. Use n8n_get_execution({id: 'exec_123', mode: 'preview'}) to investigate the error.");
  });

  it('should properly escape execution ID in suggestion', () => {
    const result = formatExecutionError('exec-with-special_chars.123');

    expect(result).toContain("id: 'exec-with-special_chars.123'");
  });
});

describe('formatNoExecutionError', () => {
  it('should provide guidance to check recent executions', () => {
    const result = formatNoExecutionError();

    expect(result).toBe("Workflow failed to execute. Use n8n_list_executions to find recent executions, then n8n_get_execution with mode='preview' to investigate.");
    expect(result).toContain('n8n_list_executions');
    expect(result).toContain('n8n_get_execution');
    expect(result).toContain("mode='preview'");
  });

  it('should include preview mode in guidance', () => {
    const result = formatNoExecutionError();

    expect(result).toMatch(/mode\s*=\s*'preview'/);
  });
});

describe('getUserFriendlyErrorMessage', () => {
  it('should handle authentication error', () => {
    const error = new N8nAuthenticationError('Invalid API key');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Failed to authenticate with n8n. Please check your API key.');
  });

  it('should handle not found error', () => {
    const error = new N8nNotFoundError('Workflow', '123');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toContain('not found');
  });

  it('should handle validation error', () => {
    const error = new N8nValidationError('Missing required field');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Invalid request: Missing required field');
  });

  it('should handle rate limit error', () => {
    const error = new N8nRateLimitError(60);
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Too many requests. Please wait a moment and try again.');
  });

  it('should handle server error with custom message', () => {
    const error = new N8nServerError('Database connection failed', 503);
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Database connection failed');
  });

  it('should handle server error without message', () => {
    const error = new N8nApiError('', 500, 'SERVER_ERROR');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('n8n server error occurred');
  });

  it('should handle no response error', () => {
    const error = new N8nApiError('Network error', undefined, 'NO_RESPONSE');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Unable to connect to n8n. Please check the server URL and ensure n8n is running.');
  });

  it('should handle unknown error with message', () => {
    const error = new N8nApiError('Custom error message');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('Custom error message');
  });

  it('should handle unknown error without message', () => {
    const error = new N8nApiError('');
    const message = getUserFriendlyErrorMessage(error);

    expect(message).toBe('An unexpected error occurred');
  });

  describe('folder placement hint (parentFolderId, n8n 2.32+)', () => {
    it('appends the upgrade hint when a 400 names parentFolderId in the message', () => {
      const error = new N8nValidationError('request/body must NOT have additional properties: parentFolderId');
      const message = getUserFriendlyErrorMessage(error);

      expect(message).toContain('requires n8n 2.32 or later');
    });

    it('appends the hint when only the details name parentFolderId', () => {
      const error = new N8nValidationError('request/body must NOT have additional properties', {
        errors: [{ params: { additionalProperty: 'parentFolderId' } }],
      });
      const message = getUserFriendlyErrorMessage(error);

      expect(message).toContain('requires n8n 2.32 or later');
    });

    it('does not fire on a semantic 400 about a folder ID on a supporting instance', () => {
      // n8n >= 2.32 rejecting a deleted/foreign folder mentions the field but is
      // not the additional-properties schema rejection - no upgrade advice.
      const error = new N8nValidationError('parentFolderId does not reference a folder in this project');
      const message = getUserFriendlyErrorMessage(error);

      expect(message).not.toContain('2.32');
    });

    it('does not fire on an unrelated 400', () => {
      const error = new N8nValidationError('Missing required field: name');
      const message = getUserFriendlyErrorMessage(error);

      expect(message).not.toContain('2.32');
    });

    it('does not fire on a non-400 that mentions parentFolderId', () => {
      const error = new N8nApiError('parentFolderId not found', 404, 'NOT_FOUND');
      const message = getUserFriendlyErrorMessage(error);

      expect(message).not.toContain('2.32');
    });

    it('survives circular details', () => {
      const details: any = {};
      details.self = details;
      details.field = 'parentFolderId';
      const error = new N8nValidationError('bad request', details);

      // Circular details cannot be stringified - the hint just doesn't fire from details
      expect(() => getUserFriendlyErrorMessage(error)).not.toThrow();
    });
  });
});

// #978/#989/#990 — say which address failed instead of an opaque "no response".
describe('NO_RESPONSE connection detail', () => {
  it('enriches the message with code and address:port from a plain connection error', () => {
    const axiosError: any = new Error('connect ECONNREFUSED 127.0.0.1:5678');
    axiosError.isAxiosError = true;
    axiosError.code = 'ECONNREFUSED';
    axiosError.address = '127.0.0.1';
    axiosError.port = 5678;
    axiosError.request = {};

    const error = handleN8nApiError(axiosError);
    expect(error.code).toBe('NO_RESPONSE');
    expect(error.message).toBe('No response from n8n server (ECONNREFUSED 127.0.0.1:5678)');
  });

  it('brackets an IPv6 address in the detail', () => {
    const axiosError: any = new Error('connect ECONNREFUSED ::1:5678');
    axiosError.isAxiosError = true;
    axiosError.code = 'ECONNREFUSED';
    axiosError.address = '::1';
    axiosError.port = 5678;
    axiosError.request = {};

    const error = handleN8nApiError(axiosError);
    expect(error.message).toBe('No response from n8n server (ECONNREFUSED [::1]:5678)');
  });

  it('lists each deduped member of an AggregateError (autoSelectFamily)', () => {
    const axiosError: any = new Error('connect failed');
    axiosError.isAxiosError = true;
    axiosError.request = {};
    axiosError.errors = [
      Object.assign(new Error('a'), { code: 'ECONNREFUSED', address: '127.0.0.1', port: 5678 }),
      Object.assign(new Error('b'), { code: 'ECONNREFUSED', address: '::1', port: 5678 }),
      Object.assign(new Error('c'), { code: 'ECONNREFUSED', address: '127.0.0.1', port: 5678 }),
    ];

    const error = handleN8nApiError(axiosError);
    expect(error.message).toBe(
      'No response from n8n server (ECONNREFUSED 127.0.0.1:5678, ECONNREFUSED [::1]:5678)'
    );
  });

  it('reads the detail from error.cause when the wrapper carries only the code', () => {
    // Real axios copies `code` onto the AxiosError but the syscall
    // address/port can live only on the underlying cause.
    const axiosError: any = new Error('connect ECONNREFUSED 127.0.0.1:5678');
    axiosError.isAxiosError = true;
    axiosError.request = {};
    axiosError.cause = Object.assign(new Error('raw'), {
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 5678,
    });

    const error = handleN8nApiError(axiosError);
    expect(error.message).toBe('No response from n8n server (ECONNREFUSED 127.0.0.1:5678)');
  });

  it('falls back to the top-level code when aggregate members carry none', () => {
    const axiosError: any = new Error('connect failed');
    axiosError.isAxiosError = true;
    axiosError.code = 'ECONNREFUSED';
    axiosError.request = {};
    axiosError.errors = [new Error('memberless'), new Error('another')];

    const error = handleN8nApiError(axiosError);
    expect(error.message).toBe('No response from n8n server (ECONNREFUSED)');
  });

  it('falls back to the generic message when no code-bearing detail is available', () => {
    const axiosError: any = new Error('Network error');
    axiosError.isAxiosError = true;
    axiosError.request = {};

    const error = handleN8nApiError(axiosError);
    expect(error.message).toBe('No response from n8n server');
  });

  it('getUserFriendlyErrorMessage appends the detail to the generic sentence', () => {
    const error = new N8nApiError(
      'No response from n8n server (ECONNREFUSED 127.0.0.1:5678)',
      undefined,
      'NO_RESPONSE'
    );
    expect(getUserFriendlyErrorMessage(error)).toBe(
      'Unable to connect to n8n. Please check the server URL and ensure n8n is running. (ECONNREFUSED 127.0.0.1:5678)'
    );
  });
});

describe('Error message integration', () => {
  it('should use formatExecutionError for webhook failures with execution ID', () => {
    const executionId = 'exec_webhook_123';
    const workflowId = 'wf_webhook_abc';
    const message = formatExecutionError(executionId, workflowId);

    expect(message).toContain('Workflow wf_webhook_abc execution exec_webhook_123 failed');
    expect(message).toContain('n8n_get_execution');
    expect(message).toContain("mode: 'preview'");
  });

  it('should use formatNoExecutionError for server errors without execution context', () => {
    const message = formatNoExecutionError();

    expect(message).toContain('Workflow failed to execute');
    expect(message).toContain('n8n_list_executions');
    expect(message).toContain('n8n_get_execution');
  });

  it('should not include "contact support" in any error message', () => {
    const executionMessage = formatExecutionError('test');
    const noExecutionMessage = formatNoExecutionError();
    const serverError = new N8nServerError();
    const serverErrorMessage = getUserFriendlyErrorMessage(serverError);

    expect(executionMessage.toLowerCase()).not.toContain('contact support');
    expect(noExecutionMessage.toLowerCase()).not.toContain('contact support');
    expect(serverErrorMessage.toLowerCase()).not.toContain('contact support');
  });

  it('should always guide users to use preview mode first', () => {
    const executionMessage = formatExecutionError('test');
    const noExecutionMessage = formatNoExecutionError();

    expect(executionMessage).toContain("mode: 'preview'");
    expect(noExecutionMessage).toContain("mode='preview'");
  });
});
