/**
 * Shared Error Sanitization Utilities
 * Used by both error-sanitizer.ts and event-tracker.ts to avoid code duplication
 *
 * Security patterns from v2.15.3 with ReDoS fix from v2.18.3
 */

import { logger } from '../utils/logger';

/**
 * Core error message sanitization with security-focused patterns
 *
 * Sanitization order (critical for preventing leakage):
 * 1. Early truncation (ReDoS prevention)
 * 2. Stack trace limitation
 * 3. URLs (most encompassing) - fully redact
 * 4. Specific credentials (AWS, GitHub, JWT, Bearer)
 * 5. Emails (after URLs)
 * 6. Long keys and tokens
 * 7. Generic credential patterns
 * 8. Final truncation
 *
 * @param errorMessage - Raw error message to sanitize
 * @returns Sanitized error message safe for telemetry
 */
export function sanitizeErrorMessageCore(errorMessage: string): string {
  try {
    // Early truncate to prevent ReDoS and performance issues
    const maxLength = 1500;
    const trimmed = errorMessage.length > maxLength
      ? errorMessage.substring(0, maxLength)
      : errorMessage;

    // Handle stack traces - keep only first 3 lines (message + top stack frames)
    const lines = trimmed.split('\n');
    let sanitized = lines.slice(0, 3).join('\n');

    // Sanitize sensitive data in correct order to prevent leakage

    // 1. URLs first (most encompassing) - fully redact to prevent path leakage
    sanitized = sanitized.replace(/https?:\/\/\S+/gi, '[URL]');

    // 2. Specific credential patterns (before generic patterns)
    sanitized = sanitized
      .replace(/AKIA[A-Z0-9]{16}/g, '[AWS_KEY]')
      .replace(/ghp_[a-zA-Z0-9]{36,}/g, '[GITHUB_TOKEN]')
      .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [TOKEN]');

    // 3. Emails (after URLs to avoid partial matches)
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

    // 4. Long keys and quoted tokens
    sanitized = sanitized
      .replace(/\b[a-zA-Z0-9_-]{32,}(?:\b|(?<=-))/g, '[KEY]') // SECURITY (GHSA-68rj-xv59-f2ch)
      .replace(/(['"])[a-zA-Z0-9_-]{16,}\1/g, '$1[TOKEN]$1');

    // 5. Generic credential patterns (after specific ones to avoid conflicts)
    // FIX (v2.18.3): Replaced negative lookbehind with simpler regex to prevent ReDoS
    sanitized = sanitized
      .replace(/password\s*[=:]\s*\S+/gi, 'password=[REDACTED]')
      .replace(/api[_-]?key\s*[=:]\s*\S+/gi, 'api_key=[REDACTED]')
      .replace(/\btoken\s*[=:]\s*[^\s;,)]+/gi, 'token=[REDACTED]'); // Simplified regex (no negative lookbehind)

    // Final truncate to 500 chars
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '...';
    }

    return sanitized;
  } catch (error) {
    logger.debug('Error message sanitization failed:', error);
    return '[SANITIZATION_FAILED]';
  }
}
