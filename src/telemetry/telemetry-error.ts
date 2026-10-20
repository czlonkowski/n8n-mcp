/**
 * Telemetry Error Classes
 * Custom error types for telemetry system with enhanced tracking
 */

import { TelemetryErrorType, TelemetryErrorContext } from './telemetry-types';
import { logger } from '../utils/logger';

// Re-export types for convenience
export { TelemetryErrorType, TelemetryErrorContext } from './telemetry-types';

export class TelemetryError extends Error {
  public readonly type: TelemetryErrorType;
  public readonly context?: Record<string, any>;
  public readonly timestamp: number;
  public readonly retryable: boolean;

  constructor(
    type: TelemetryErrorType,
    message: string,
    context?: Record<string, any>,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'TelemetryError';
    this.type = type;
    this.context = context;
    this.timestamp = Date.now();
    this.retryable = retryable;

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, TelemetryError.prototype);
  }

  /**
   * Convert error to context object
   */
  toContext(): TelemetryErrorContext {
    return {
      type: this.type,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable
    };
  }

  /**
   * Log the error with appropriate level
   */
  log(): void {
    const logContext = {
      type: this.type,
      message: this.message,
      ...this.context
    };

    if (this.retryable) {
      logger.debug('Retryable telemetry error:', logContext);
    } else {
      logger.debug('Non-retryable telemetry error:', logContext);
    }
  }
}

/**
 * Circuit Breaker for handling repeated failures
 */
export class TelemetryCircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenRequests: number;
  private halfOpenCount: number = 0;

  constructor(
    failureThreshold: number = 5,
    resetTimeout: number = 60000, // 1 minute
    halfOpenRequests: number = 3
  ) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.halfOpenRequests = halfOpenRequests;
  }

  /**
   * Check if requests should be allowed
   */
  shouldAllow(): boolean {
    const now = Date.now();

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if enough time has passed to try half-open
        if (now - this.lastFailureTime > this.resetTimeout) {
          this.state = 'half-open';
          this.halfOpenCount = 0;
          logger.debug('Circuit breaker transitioning to half-open');
          return true;
        }
        return false;

      case 'half-open':
        // Allow limited requests in half-open state
        if (this.halfOpenCount < this.halfOpenRequests) {
          this.halfOpenCount++;
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Record a success
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      // If we've had enough successful requests, close the circuit
      if (this.halfOpenCount >= this.halfOpenRequests) {
        this.state = 'closed';
        this.failureCount = 0;
        logger.debug('Circuit breaker closed after successful recovery');
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failure
   */
  recordFailure(error?: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Immediately open on failure in half-open state
      this.state = 'open';
      logger.debug('Circuit breaker opened from half-open state', { error: error?.message });
    } else if (this.state === 'closed' && this.failureCount >= this.failureThreshold) {
      // Open circuit after threshold reached
      this.state = 'open';
      logger.debug(
        `Circuit breaker opened after ${this.failureCount} failures`,
        { error: error?.message }
      );
    }
  }

  /**
   * Pure (side-effect-free) read of whether a real attempt would currently
   * be let through. Mirrors shouldAllow()'s logic exactly, but never
   * transitions open -> half-open and never consumes a half-open probe slot
   * — only an actual shouldAllow() call (i.e. a real send attempt) may do
   * that. Used by getState() so that merely reading metrics can never burn
   * through the limited half-open budget that a real recovery attempt needs.
   */
  private canRetryNow(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return Date.now() - this.lastFailureTime > this.resetTimeout;
      case 'half-open':
        return this.halfOpenCount < this.halfOpenRequests;
      default:
        return false;
    }
  }

  /**
   * Get current state. Side-effect free — see canRetryNow().
   */
  getState(): { state: string; failureCount: number; canRetry: boolean } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      canRetry: this.canRetryNow()
    };
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCount = 0;
  }
}

/**
 * Error aggregator for tracking error patterns
 */
export class TelemetryErrorAggregator {
  private errors: Map<TelemetryErrorType, number> = new Map();
  private errorDetails: TelemetryErrorContext[] = [];
  private readonly maxDetails: number = 100;

  /**
   * Record an error
   */
  record(error: TelemetryError): void {
    // Increment counter for this error type
    const count = this.errors.get(error.type) || 0;
    this.errors.set(error.type, count + 1);

    // Store error details (limited)
    this.errorDetails.push(error.toContext());
    if (this.errorDetails.length > this.maxDetails) {
      this.errorDetails.shift();
    }
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    mostCommonError?: string;
    recentErrors: TelemetryErrorContext[];
  } {
    const errorsByType: Record<string, number> = {};
    let totalErrors = 0;
    let mostCommonError: string | undefined;
    let maxCount = 0;

    for (const [type, count] of this.errors.entries()) {
      errorsByType[type] = count;
      totalErrors += count;

      if (count > maxCount) {
        maxCount = count;
        mostCommonError = type;
      }
    }

    return {
      totalErrors,
      errorsByType,
      mostCommonError,
      recentErrors: this.errorDetails.slice(-10) // Last 10 errors
    };
  }

  /**
   * Clear error history
   */
  reset(): void {
    this.errors.clear();
    this.errorDetails = [];
  }
}