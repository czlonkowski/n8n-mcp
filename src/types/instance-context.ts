/**
 * Instance Context for flexible configuration support
 *
 * Allows the n8n-mcp engine to accept instance-specific configuration
 * at runtime, enabling flexible deployment scenarios while maintaining
 * backward compatibility with environment-based configuration.
 */

export interface InstanceContext {
  /**
   * Instance-specific n8n API configuration
   * When provided, these override environment variables
   */
  n8nApiUrl?: string;
  n8nApiKey?: string;
  /**
   * n8n session cookie for browser-session-based authentication.
   * Use when you cannot obtain an API key (e.g. self-hosted instances without API key access).
   * Obtain by inspecting the Cookie header after logging into the n8n UI.
   * Treated as a secret — never log the value.
   * When both n8nApiKey and n8nApiCookie are provided, n8nApiKey takes precedence.
   */
  n8nApiCookie?: string;
  n8nApiTimeout?: number;
  n8nApiMaxRetries?: number;

  /**
   * Instance identification
   * Used for session management and logging
   */
  instanceId?: string;
  sessionId?: string;

  /**
   * Extensible metadata for future use
   * Allows passing additional configuration without interface changes
   */
  metadata?: Record<string, any>;
}

/**
 * Validate URL format with enhanced checks
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Allow only http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Check for reasonable hostname (not empty or invalid)
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return false;
    }

    // Validate port if present
    if (parsed.port && (isNaN(Number(parsed.port)) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
      return false;
    }

    // Allow localhost, IP addresses, and domain names
    const hostname = parsed.hostname.toLowerCase();

    // Allow localhost for development
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Basic IPv4 address validation
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(hostname)) {
      const parts = hostname.split('.');
      return parts.every(part => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255;
      });
    }

    // Basic IPv6 pattern check (simplified)
    if (hostname.includes(':') || hostname.startsWith('[') && hostname.endsWith(']')) {
      // Basic IPv6 validation - just checking it's not obviously wrong
      return true;
    }

    // Domain name validation - allow subdomains and TLDs
    const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
    return domainPattern.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Validate API key format (basic check for non-empty string)
 */
function isValidApiKey(key: string): boolean {
  // API key should be non-empty and not contain obvious placeholder values
  return key.length > 0 &&
         !key.toLowerCase().includes('your_api_key') &&
         !key.toLowerCase().includes('placeholder') &&
         !key.toLowerCase().includes('example');
}

/**
 * Validate cookie string format (basic check for non-empty string without placeholders)
 */
function isValidCookie(cookie: string): boolean {
  return cookie.length > 0 &&
         !cookie.toLowerCase().includes('your_cookie') &&
         !cookie.toLowerCase().includes('placeholder') &&
         !cookie.toLowerCase().includes('example');
}

/**
 * Type guard to check if an object is an InstanceContext
 */
export function isInstanceContext(obj: any): obj is InstanceContext {
  if (!obj || typeof obj !== 'object') return false;

  // Check for known properties with validation
  const hasValidUrl = obj.n8nApiUrl === undefined ||
    (typeof obj.n8nApiUrl === 'string' && isValidUrl(obj.n8nApiUrl));

  const hasValidKey = obj.n8nApiKey === undefined ||
    (typeof obj.n8nApiKey === 'string' && isValidApiKey(obj.n8nApiKey));

  const hasValidCookie = obj.n8nApiCookie === undefined ||
    (typeof obj.n8nApiCookie === 'string' && isValidCookie(obj.n8nApiCookie));

  const hasValidTimeout = obj.n8nApiTimeout === undefined ||
    (typeof obj.n8nApiTimeout === 'number' && obj.n8nApiTimeout > 0);

  const hasValidRetries = obj.n8nApiMaxRetries === undefined ||
    (typeof obj.n8nApiMaxRetries === 'number' && obj.n8nApiMaxRetries >= 0);

  const hasValidInstanceId = obj.instanceId === undefined || typeof obj.instanceId === 'string';
  const hasValidSessionId = obj.sessionId === undefined || typeof obj.sessionId === 'string';
  const hasValidMetadata = obj.metadata === undefined ||
    (typeof obj.metadata === 'object' && obj.metadata !== null);

  return hasValidUrl && hasValidKey && hasValidCookie && hasValidTimeout && hasValidRetries &&
         hasValidInstanceId && hasValidSessionId && hasValidMetadata;
}

/**
 * Validate and sanitize InstanceContext
 * Provides field-specific error messages for better debugging
 */
export function validateInstanceContext(context: InstanceContext): {
  valid: boolean;
  errors?: string[]
} {
  const errors: string[] = [];

  // Validate URL if provided (even empty string should be validated)
  if (context.n8nApiUrl !== undefined) {
    if (context.n8nApiUrl === '') {
      errors.push(`Invalid n8nApiUrl: empty string - URL is required when field is provided`);
    } else if (!isValidUrl(context.n8nApiUrl)) {
      // Provide specific reason for URL invalidity
      try {
        const parsed = new URL(context.n8nApiUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push(`Invalid n8nApiUrl: URL must use HTTP or HTTPS protocol, got ${parsed.protocol}`);
        }
      } catch {
        errors.push(`Invalid n8nApiUrl: URL format is malformed or incomplete`);
      }
    }
  }

  // Validate API key if provided
  if (context.n8nApiKey !== undefined) {
    if (context.n8nApiKey === '') {
      errors.push(`Invalid n8nApiKey: empty string - API key is required when field is provided`);
    } else if (!isValidApiKey(context.n8nApiKey)) {
      // Provide specific reason for API key invalidity
      if (context.n8nApiKey.toLowerCase().includes('your_api_key')) {
        errors.push(`Invalid n8nApiKey: contains placeholder 'your_api_key' - Please provide actual API key`);
      } else if (context.n8nApiKey.toLowerCase().includes('placeholder')) {
        errors.push(`Invalid n8nApiKey: contains placeholder text - Please provide actual API key`);
      } else if (context.n8nApiKey.toLowerCase().includes('example')) {
        errors.push(`Invalid n8nApiKey: contains example text - Please provide actual API key`);
      } else {
        errors.push(`Invalid n8nApiKey: format validation failed - Ensure key is valid`);
      }
    }
  }

  // Validate cookie if provided
  if (context.n8nApiCookie !== undefined) {
    if (context.n8nApiCookie === '') {
      errors.push(`Invalid n8nApiCookie: empty string - cookie value is required when field is provided`);
    } else if (!isValidCookie(context.n8nApiCookie)) {
      if (context.n8nApiCookie.toLowerCase().includes('your_cookie')) {
        errors.push(`Invalid n8nApiCookie: contains placeholder 'your_cookie' - Please provide actual cookie`);
      } else if (context.n8nApiCookie.toLowerCase().includes('placeholder')) {
        errors.push(`Invalid n8nApiCookie: contains placeholder text - Please provide actual cookie`);
      } else if (context.n8nApiCookie.toLowerCase().includes('example')) {
        errors.push(`Invalid n8nApiCookie: contains example text - Please provide actual cookie`);
      } else {
        errors.push(`Invalid n8nApiCookie: format validation failed - Ensure cookie is valid`);
      }
    }
  }

  // Validate timeout
  if (context.n8nApiTimeout !== undefined) {
    if (typeof context.n8nApiTimeout !== 'number') {
      errors.push(`Invalid n8nApiTimeout: ${context.n8nApiTimeout} - Must be a number, got ${typeof context.n8nApiTimeout}`);
    } else if (context.n8nApiTimeout <= 0) {
      errors.push(`Invalid n8nApiTimeout: ${context.n8nApiTimeout} - Must be positive (greater than 0)`);
    } else if (!isFinite(context.n8nApiTimeout)) {
      errors.push(`Invalid n8nApiTimeout: ${context.n8nApiTimeout} - Must be a finite number (not Infinity or NaN)`);
    }
  }

  // Validate retries
  if (context.n8nApiMaxRetries !== undefined) {
    if (typeof context.n8nApiMaxRetries !== 'number') {
      errors.push(`Invalid n8nApiMaxRetries: ${context.n8nApiMaxRetries} - Must be a number, got ${typeof context.n8nApiMaxRetries}`);
    } else if (context.n8nApiMaxRetries < 0) {
      errors.push(`Invalid n8nApiMaxRetries: ${context.n8nApiMaxRetries} - Must be non-negative (0 or greater)`);
    } else if (!isFinite(context.n8nApiMaxRetries)) {
      errors.push(`Invalid n8nApiMaxRetries: ${context.n8nApiMaxRetries} - Must be a finite number (not Infinity or NaN)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}