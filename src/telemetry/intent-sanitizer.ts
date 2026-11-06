/**
 * Intent sanitizer for removing PII from user intent strings
 * Ensures privacy by masking sensitive information
 */

import { redactEmailAddresses } from './email-redaction';

/**
 * Patterns for detecting and removing PII
 */
const PII_PATTERNS = {
  // Email addresses
  // SECURITY (GHSA-xvxq-x6hr-xc2c): bound the local part.
  email: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,

  // URLs with domains
  url: /https?:\/\/[^\s]+/gi,

  // IP addresses
  ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

  // Phone numbers (various formats)
  phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,

  // Credit card-like numbers (groups of 4 digits)
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,

  // API keys and tokens (long alphanumeric strings)
  apiKey: /\b[A-Za-z0-9_-]{32,}(?:\b|(?<=-))/g, // SECURITY (GHSA-68rj-xv59-f2ch)

  // UUIDs
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,

  // File paths (Unix and Windows)
  filePath: /(?:\/[\w.-]+)+\/?|(?:[A-Z]:\\(?:[\w.-]+\\)*[\w.-]+)/g,

  // Potential passwords or secrets (common patterns)
  secret: /\b(?:password|passwd|pwd|secret|token|key)[:=\s]+[^\s]+/gi,
};

/**
 * Company/organization name patterns to anonymize
 * These are common patterns that might appear in workflow intents
 */
const COMPANY_PATTERNS = {
  // Company suffixes
  companySuffix: /\b\w+(?:\s+(?:Inc|LLC|Corp|Corporation|Ltd|Limited|GmbH|AG)\.?)\b/gi,

  // Common business terms that might indicate company names
  businessContext: /\b(?:company|organization|client|customer)\s+(?:named?|called)\s+\w+/gi,
};

// SECURITY (GHSA-xvxq-x6hr-xc2c): bound the input size.
const MAX_INTENT_LENGTH = 10_000;

const EMAIL_DOMAIN = /[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/iy;

/**
 * Sanitizes user intent by removing PII and sensitive information
 */
export class IntentSanitizer {
  /**
   * Sanitize user intent string
   */
  sanitize(intent: string): string {
    if (!intent) {
      return intent;
    }
    if (intent.length > MAX_INTENT_LENGTH) {
      return '[TRUNCATED]';
    }

    let sanitized = intent;

    // Remove email addresses
    sanitized = redactEmailAddresses(sanitized, EMAIL_DOMAIN, '[EMAIL]');

    // Remove URLs
    sanitized = sanitized.replace(PII_PATTERNS.url, '[URL]');

    // Remove IP addresses
    sanitized = sanitized.replace(PII_PATTERNS.ip, '[IP_ADDRESS]');

    // Remove phone numbers
    sanitized = sanitized.replace(PII_PATTERNS.phone, '[PHONE]');

    // Remove credit card numbers
    sanitized = sanitized.replace(PII_PATTERNS.creditCard, '[CARD_NUMBER]');

    // Remove API keys and long tokens
    sanitized = sanitized.replace(PII_PATTERNS.apiKey, '[API_KEY]');

    // Remove UUIDs
    sanitized = sanitized.replace(PII_PATTERNS.uuid, '[UUID]');

    // Remove file paths
    sanitized = sanitized.replace(PII_PATTERNS.filePath, '[FILE_PATH]');

    // Remove secrets/passwords
    sanitized = sanitized.replace(PII_PATTERNS.secret, '[SECRET]');

    // Anonymize company names
    sanitized = sanitized.replace(COMPANY_PATTERNS.companySuffix, '[COMPANY]');
    sanitized = sanitized.replace(COMPANY_PATTERNS.businessContext, '[COMPANY_CONTEXT]');

    // Clean up multiple spaces
    sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

    return sanitized;
  }

  /**
   * Check if intent contains potential PII
   */
  containsPII(intent: string): boolean {
    if (!intent) {
      return false;
    }

    return Object.values(PII_PATTERNS).some((pattern) => pattern.test(intent));
  }

  /**
   * Get list of PII types detected in the intent
   */
  detectPIITypes(intent: string): string[] {
    if (!intent) {
      return [];
    }

    const detected: string[] = [];

    if (PII_PATTERNS.email.test(intent)) detected.push('email');
    if (PII_PATTERNS.url.test(intent)) detected.push('url');
    if (PII_PATTERNS.ip.test(intent)) detected.push('ip_address');
    if (PII_PATTERNS.phone.test(intent)) detected.push('phone');
    if (PII_PATTERNS.creditCard.test(intent)) detected.push('credit_card');
    if (PII_PATTERNS.apiKey.test(intent)) detected.push('api_key');
    if (PII_PATTERNS.uuid.test(intent)) detected.push('uuid');
    if (PII_PATTERNS.filePath.test(intent)) detected.push('file_path');
    if (PII_PATTERNS.secret.test(intent)) detected.push('secret');

    // Reset lastIndex for global regexes
    Object.values(PII_PATTERNS).forEach((pattern) => {
      pattern.lastIndex = 0;
    });

    return detected;
  }

  /**
   * Truncate intent to maximum length while preserving meaning
   */
  truncate(intent: string, maxLength: number = 1000): string {
    if (!intent || intent.length <= maxLength) {
      return intent;
    }

    // Try to truncate at sentence boundary
    const truncated = intent.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSentence > maxLength * 0.8) {
      return truncated.substring(0, lastSentence + 1);
    } else if (lastSpace > maxLength * 0.9) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Validate intent is safe for telemetry
   */
  isSafeForTelemetry(intent: string): boolean {
    if (!intent) {
      return true;
    }

    // Check length
    if (intent.length > 5000) {
      return false;
    }

    // Check for null bytes or control characters
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(intent)) {
      return false;
    }

    return true;
  }
}

/**
 * Singleton instance for easy access
 */
export const intentSanitizer = new IntentSanitizer();
