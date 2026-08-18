import { logger } from './logger';

// Custom error classes for n8n API operations

export class N8nApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'N8nApiError';
  }
}

export class N8nAuthenticationError extends N8nApiError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'N8nAuthenticationError';
  }
}

export class N8nNotFoundError extends N8nApiError {
  constructor(messageOrResource: string, id?: string) {
    // If id is provided, format as "resource with ID id not found"
    // Otherwise, use messageOrResource as-is (it's already a complete message from the API)
    const message = id ? `${messageOrResource} with ID ${id} not found` : messageOrResource;
    super(message, 404, 'NOT_FOUND');
    this.name = 'N8nNotFoundError';
  }
}

export class N8nValidationError extends N8nApiError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'N8nValidationError';
  }
}

export class N8nRateLimitError extends N8nApiError {
  constructor(retryAfter?: number) {
    const message = retryAfter
      ? `Rate limit exceeded. Retry after ${retryAfter} seconds`
      : 'Rate limit exceeded';
    super(message, 429, 'RATE_LIMIT_ERROR', { retryAfter });
    this.name = 'N8nRateLimitError';
  }
}

export class N8nServerError extends N8nApiError {
  constructor(message = 'Internal server error', statusCode = 500) {
    super(message, statusCode, 'SERVER_ERROR');
    this.name = 'N8nServerError';
  }
}

// Error handling utility
export function handleN8nApiError(error: unknown): N8nApiError {
  if (error instanceof N8nApiError) {
    return error;
  }

  if (error instanceof Error) {
    // Check if it's an Axios error
    const axiosError = error as any;
    if (axiosError.response) {
      const { status, data } = axiosError.response;
      const message = data?.message || axiosError.message;

      switch (status) {
        case 401:
          return new N8nAuthenticationError(message);
        case 404:
          return new N8nNotFoundError(message || 'Resource');
        case 400:
          return new N8nValidationError(message, data);
        case 429:
          const retryAfter = axiosError.response.headers['retry-after'];
          return new N8nRateLimitError(retryAfter ? parseInt(retryAfter) : undefined);
        default:
          if (status >= 500) {
            return new N8nServerError(message, status);
          }
          return new N8nApiError(message, status, 'API_ERROR', data);
      }
    } else if (axiosError.request) {
      // Request was made but no response received. Name which address(es)
      // failed so "no response" is diagnosable instead of opaque (#978/#989/#990).
      const detail = describeConnectionFailure(axiosError);
      const message = detail
        ? `No response from n8n server (${detail})`
        : 'No response from n8n server';
      return new N8nApiError(message, undefined, 'NO_RESPONSE');
    } else {
      // Something happened in setting up the request
      return new N8nApiError(axiosError.message, undefined, 'REQUEST_ERROR');
    }
  }

  // Unknown error type
  return new N8nApiError('Unknown error occurred', undefined, 'UNKNOWN_ERROR', error);
}

/**
 * Format execution error message with guidance to use n8n_get_execution
 * @param executionId - The execution ID from the failed execution
 * @param workflowId - Optional workflow ID
 * @returns Formatted error message with n8n_get_execution guidance
 */
export function formatExecutionError(executionId: string, workflowId?: string): string {
  const workflowPrefix = workflowId ? `Workflow ${workflowId} execution ` : 'Execution ';
  return `${workflowPrefix}${executionId} failed. Use n8n_get_execution({id: '${executionId}', mode: 'preview'}) to investigate the error.`;
}

/**
 * Format error message when no execution ID is available
 * @returns Generic guidance to check executions
 */
export function formatNoExecutionError(): string {
  return "Workflow failed to execute. Use n8n_list_executions to find recent executions, then n8n_get_execution with mode='preview' to investigate.";
}

/**
 * A 400 that names `parentFolderId` on a workflow write means the instance's OpenAPI
 * schema predates workflow folder placement (n8n 2.32): the write schema declares
 * `additionalProperties: false`, so older instances reject the whole request. The
 * validator names the offending property in its message/details, which is what makes
 * this check safe — a 400 for any other reason never mentions the field.
 */
function folderPlacementHint(error: N8nApiError): string {
  if (error.statusCode !== 400) return '';
  const haystack = `${error.message} ${safeStringify(error.details)}`;
  if (!haystack.includes('parentFolderId')) return '';
  // Only the schema-level rejection shape ("must NOT have additional properties" /
  // params.additionalProperty) identifies a pre-2.32 instance. A semantic 400 that
  // merely mentions the field (e.g. a deleted folder ID on n8n >= 2.32) must not
  // earn upgrade advice.
  if (!/additional ?propert/i.test(haystack)) return '';
  return ' Note: workflow folder placement (parentFolderId) requires n8n 2.32 or later - retry without parentFolderId, or upgrade the instance.';
}

/**
 * Build a short "CODE address:port" detail string from a connection-level
 * axios error, for the NO_RESPONSE message (#978/#989/#990). When the
 * underlying failure is an AggregateError (`autoSelectFamily` trying
 * multiple pinned addresses), lists each member deduped so a multi-address
 * failure reads as e.g. "ECONNREFUSED 127.0.0.1:5678, ECONNREFUSED
 * [::1]:5678" instead of the generic top-level message alone. Returns ''
 * when no code-bearing detail is available.
 */
function describeConnectionFailure(axiosError: any): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  const addPart = (source: any) => {
    if (!source || !source.code) return;
    let part = String(source.code);
    if (source.address) {
      const host = String(source.address).includes(':') ? `[${source.address}]` : source.address;
      part += source.port !== undefined ? ` ${host}:${source.port}` : ` ${host}`;
    }
    if (!seen.has(part)) {
      seen.add(part);
      parts.push(part);
    }
  };

  const aggregateMembers = axiosError?.errors ?? axiosError?.cause?.errors;
  if (Array.isArray(aggregateMembers) && aggregateMembers.length > 0) {
    aggregateMembers.forEach(addPart);
  }
  // Fall back to the wrapper, then its cause: axios copies `code` onto the
  // AxiosError but the syscall address/port may live only on the underlying
  // error, and aggregate members without codes contribute nothing above.
  if (parts.length === 0) {
    addPart(axiosError);
  }
  if (parts.length === 0) {
    addPart(axiosError?.cause);
  }

  return parts.join(', ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// Utility to extract user-friendly error messages
export function getUserFriendlyErrorMessage(error: N8nApiError): string {
  switch (error.code) {
    case 'AUTHENTICATION_ERROR':
      return 'Failed to authenticate with n8n. Please check your API key.';
    case 'NOT_FOUND':
      return error.message;
    case 'VALIDATION_ERROR':
      return `Invalid request: ${error.message}${folderPlacementHint(error)}`;
    case 'RATE_LIMIT_ERROR':
      return 'Too many requests. Please wait a moment and try again.';
    case 'NO_RESPONSE': {
      // #978/#989/#990: append the connection detail from the enriched
      // message (e.g. "(ECONNREFUSED 127.0.0.1:5678)") when present, so the
      // generic sentence doesn't hide which address actually failed.
      const generic = 'Unable to connect to n8n. Please check the server URL and ensure n8n is running.';
      // Plain string scan instead of a trailing-group regex (CodeQL
      // js/polynomial-redos): take a non-empty parenthesized suffix that
      // contains no nested parens, which is the only shape
      // describeConnectionFailure produces.
      const message = error.message.trimEnd();
      const open = message.lastIndexOf('(');
      const detail = message.endsWith(')') && open !== -1
        ? message.slice(open + 1, -1)
        : '';
      return detail && !detail.includes(')') ? `${generic} (${detail})` : generic;
    }
    case 'SERVER_ERROR':
      // For server errors, we should not show generic message
      // Callers should check for execution context and use formatExecutionError instead
      return error.message || 'n8n server error occurred';
    default:
      return error.message || 'An unexpected error occurred';
  }
}

// Log error with appropriate level
export function logN8nError(error: N8nApiError, context?: string): void {
  const errorInfo = {
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    details: error.details,
    context,
  };

  if (error.statusCode && error.statusCode >= 500) {
    logger.error('n8n API server error', errorInfo);
  } else if (error.statusCode && error.statusCode >= 400) {
    logger.warn('n8n API client error', errorInfo);
  } else {
    logger.error('n8n API error', errorInfo);
  }
}