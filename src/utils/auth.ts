import crypto from 'crypto';

export type AuthFailureReason = 'no_auth_header' | 'invalid_auth_format' | 'invalid_token';

/**
 * Build an RFC 6750-compliant WWW-Authenticate challenge for Bearer auth.
 *
 * Per RFC 6750 §3, when the request lacks any authentication information
 * the resource server SHOULD NOT include an error code (the client may not
 * have known auth was required). Errors are signalled only when credentials
 * were sent but rejected.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6750#section-3
 */
export function buildBearerChallenge(
  reason: AuthFailureReason,
  realm: string = 'n8n-mcp'
): string {
  // realm is a quoted-string per RFC 7235 §2.2; escape backslash and double-quote.
  const escapedRealm = realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (reason === 'no_auth_header') {
    return `Bearer realm="${escapedRealm}"`;
  }
  if (reason === 'invalid_auth_format') {
    return `Bearer realm="${escapedRealm}", error="invalid_request", error_description="Bearer token required"`;
  }
  return `Bearer realm="${escapedRealm}", error="invalid_token", error_description="Invalid bearer token"`;
}

export class AuthManager {
  private validTokens: Set<string>;
  private tokenExpiry: Map<string, number>;

  constructor() {
    this.validTokens = new Set();
    this.tokenExpiry = new Map();
  }

  /**
   * Validate an authentication token
   */
  validateToken(token: string | undefined, expectedToken?: string): boolean {
    if (!expectedToken) {
      // No authentication required
      return true;
    }

    if (!token) {
      return false;
    }

    // SECURITY: Use timing-safe comparison for static token
    // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
    if (AuthManager.timingSafeCompare(token, expectedToken)) {
      return true;
    }

    // Check dynamic tokens
    if (this.validTokens.has(token)) {
      const expiry = this.tokenExpiry.get(token);
      if (expiry && expiry > Date.now()) {
        return true;
      } else {
        // Token expired
        this.validTokens.delete(token);
        this.tokenExpiry.delete(token);
        return false;
      }
    }

    return false;
  }

  /**
   * Generate a new authentication token
   */
  generateToken(expiryHours: number = 24): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiryTime = Date.now() + (expiryHours * 60 * 60 * 1000);

    this.validTokens.add(token);
    this.tokenExpiry.set(token, expiryTime);

    // Clean up expired tokens
    this.cleanupExpiredTokens();

    return token;
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): void {
    this.validTokens.delete(token);
    this.tokenExpiry.delete(token);
  }

  /**
   * Clean up expired tokens
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, expiry] of this.tokenExpiry.entries()) {
      if (expiry <= now) {
        this.validTokens.delete(token);
        this.tokenExpiry.delete(token);
      }
    }
  }

  /**
   * Hash a password or token for secure storage
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compare a plain token with a hashed token
   */
  static compareTokens(plainToken: string, hashedToken: string): boolean {
    const hashedPlainToken = AuthManager.hashToken(plainToken);
    return crypto.timingSafeEqual(
      Buffer.from(hashedPlainToken),
      Buffer.from(hashedToken)
    );
  }

  /**
   * Compare two tokens using constant-time algorithm to prevent timing attacks
   *
   * @param plainToken - Token from request
   * @param expectedToken - Expected token value
   * @returns true if tokens match, false otherwise
   *
   * @security This uses crypto.timingSafeEqual to prevent timing attack vulnerabilities.
   * Never use === or !== for token comparison as it allows attackers to discover
   * tokens character-by-character through timing analysis.
   *
   * @example
   * const isValid = AuthManager.timingSafeCompare(requestToken, serverToken);
   * if (!isValid) {
   *   return res.status(401).json({ error: 'Unauthorized' });
   * }
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
   */
  static timingSafeCompare(plainToken: string, expectedToken: string): boolean {
    try {
      // Tokens must be non-empty
      if (!plainToken || !expectedToken) {
        return false;
      }

      // Convert to buffers
      const plainBuffer = Buffer.from(plainToken, 'utf8');
      const expectedBuffer = Buffer.from(expectedToken, 'utf8');

      // Check length first (constant time not needed for length comparison)
      if (plainBuffer.length !== expectedBuffer.length) {
        return false;
      }

      // Constant-time comparison
      return crypto.timingSafeEqual(plainBuffer, expectedBuffer);
    } catch (error) {
      // Buffer conversion or comparison failed
      return false;
    }
  }
}