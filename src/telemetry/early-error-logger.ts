/**
 * Early Error Logger (v2.18.3)
 * Captures errors that occur BEFORE the main telemetry system is ready
 * Uses direct Supabase insert to bypass batching and ensure immediate persistence
 *
 * CRITICAL FIXES:
 * - Singleton pattern to prevent multiple instances
 * - Defensive initialization (safe defaults before any throwing operation)
 * - Timeout wrapper for Supabase operations (5s max)
 * - Shared sanitization utilities (DRY principle)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TelemetryConfigManager } from './config-manager';
import { TELEMETRY_BACKEND } from './telemetry-types';
import { StartupCheckpoint, isValidCheckpoint, getCheckpointDescription } from './startup-checkpoints';
import { sanitizeErrorMessageCore } from './error-sanitization-utils';
import { telemetryFetch } from './telemetry-fetch';
import { logger } from '../utils/logger';

/**
 * Timeout wrapper for async operations
 * Prevents hanging if Supabase is unreachable
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${operation} timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
      timer.unref?.();
    });

    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    logger.debug(`${operation} failed or timed out:`, error);
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class EarlyErrorLogger {
  // Singleton instance
  private static instance: EarlyErrorLogger | null = null;

  // DEFENSIVE INITIALIZATION: Initialize all fields to safe defaults FIRST
  // This ensures the object is in a valid state even if initialization fails
  private enabled: boolean = false;  // Safe default: disabled
  private supabase: SupabaseClient | null = null;  // Safe default: null
  private userId: string | null = null;  // Safe default: null
  private checkpoints: StartupCheckpoint[] = [];
  private startTime: number = Date.now();
  private initPromise: Promise<void>;

  /**
   * Private constructor - use getInstance() instead
   * Ensures only one instance exists per process
   */
  private constructor() {
    // Kick off async initialization without blocking
    this.initPromise = this.initialize();
  }

  /**
   * Get singleton instance
   * Safe to call from anywhere - initialization errors won't crash caller
   */
  static getInstance(): EarlyErrorLogger {
    if (!EarlyErrorLogger.instance) {
      EarlyErrorLogger.instance = new EarlyErrorLogger();
    }
    return EarlyErrorLogger.instance;
  }

  /**
   * Async initialization logic
   * Separated from constructor to prevent throwing before safe defaults are set
   */
  private async initialize(): Promise<void> {
    try {
      // Validate backend configuration before using
      if (!TELEMETRY_BACKEND.URL || !TELEMETRY_BACKEND.ANON_KEY) {
        logger.debug('Telemetry backend not configured, early error logger disabled');
        this.enabled = false;
        return;
      }

      // Check if telemetry is disabled by user
      const configManager = TelemetryConfigManager.getInstance();
      const isEnabled = configManager.isEnabled();

      if (!isEnabled) {
        logger.debug('Telemetry disabled by user, early error logger will not send events');
        this.enabled = false;
        return;
      }

      // Initialize Supabase client for direct inserts
      this.supabase = createClient(
        TELEMETRY_BACKEND.URL,
        TELEMETRY_BACKEND.ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
          global: {
            fetch: telemetryFetch,
          },
        }
      );

      // Get user ID from config manager
      this.userId = configManager.getUserId();

      // Mark as enabled only after successful initialization
      this.enabled = true;

      logger.debug('Early error logger initialized successfully');
    } catch (error) {
      // Initialization failed - ensure safe state
      logger.debug('Early error logger initialization failed:', error);
      this.enabled = false;
      this.supabase = null;
      this.userId = null;
    }
  }

  /**
   * Wait for initialization to complete (for testing)
   * Not needed in production - all methods handle uninitialized state gracefully
   */
  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Log a checkpoint as the server progresses through startup
   * FIRE-AND-FORGET: Does not block caller (no await needed)
   */
  logCheckpoint(checkpoint: StartupCheckpoint): void {
    if (!this.enabled) {
      return;
    }

    try {
      // Validate checkpoint
      if (!isValidCheckpoint(checkpoint)) {
        logger.warn(`Invalid checkpoint: ${checkpoint}`);
        return;
      }

      // Add to internal checkpoint list
      this.checkpoints.push(checkpoint);

      logger.debug(`Checkpoint passed: ${checkpoint} (${getCheckpointDescription(checkpoint)})`);
    } catch (error) {
      // Don't throw - we don't want checkpoint logging to crash the server
      logger.debug('Failed to log checkpoint:', error);
    }
  }

  /**
   * Log a startup error with checkpoint context
   * This is the main error capture mechanism
   * FIRE-AND-FORGET: Does not block caller
   */
  logStartupError(checkpoint: StartupCheckpoint, error: unknown): void {
    if (!this.enabled || !this.supabase || !this.userId) {
      return;
    }

    // Run async operation without blocking caller
    this.logStartupErrorAsync(checkpoint, error).catch((logError) => {
      // Swallow errors - telemetry must never crash the server
      logger.debug('Failed to log startup error:', logError);
    });
  }

  /**
   * Internal async implementation with timeout wrapper
   */
  private async logStartupErrorAsync(checkpoint: StartupCheckpoint, error: unknown): Promise<void> {
    try {
      // Sanitize error message using shared utilities (v2.18.3)
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.stack) {
          errorMessage = error.stack;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        errorMessage = String(error);
      }

      const sanitizedError = sanitizeErrorMessageCore(errorMessage);

      // Extract error type if it's an Error object
      let errorType = 'unknown';
      if (error instanceof Error) {
        errorType = error.name || 'Error';
      } else if (typeof error === 'string') {
        errorType = 'string_error';
      }

      // Create startup_error event
      const event = {
        user_id: this.userId!,
        event: 'startup_error',
        properties: {
          checkpoint,
          errorMessage: sanitizedError,
          errorType,
          checkpointsPassed: this.checkpoints,
          checkpointsPassedCount: this.checkpoints.length,
          startupDuration: Date.now() - this.startTime,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          isDocker: process.env.IS_DOCKER === 'true',
        },
        created_at: new Date().toISOString(),
      };

      // Direct insert to Supabase with timeout (5s max)
      const insertOperation = async () => {
        return await this.supabase!
          .from('events')
          .insert(event)
          .select()
          .single();
      };

      const result = await withTimeout(insertOperation(), 5000, 'Startup error insert');

      if (result && 'error' in result && result.error) {
        logger.debug('Failed to insert startup error event:', result.error);
      } else if (result) {
        logger.debug(`Startup error logged for checkpoint: ${checkpoint}`);
      }
    } catch (logError) {
      // Don't throw - telemetry failures should never crash the server
      logger.debug('Failed to log startup error:', logError);
    }
  }

  /**
   * Log successful startup completion
   * Called when all checkpoints have been passed
   * FIRE-AND-FORGET: Does not block caller
   */
  logStartupSuccess(checkpoints: StartupCheckpoint[], durationMs: number): void {
    if (!this.enabled) {
      return;
    }

    try {
      // Store checkpoints for potential session_start enhancement
      this.checkpoints = checkpoints;

      logger.debug(`Startup successful: ${checkpoints.length} checkpoints passed in ${durationMs}ms`);

      // We don't send a separate event here - this data will be included
      // in the session_start event sent by the main telemetry system
    } catch (error) {
      logger.debug('Failed to log startup success:', error);
    }
  }

  /**
   * Get the list of checkpoints passed so far
   */
  getCheckpoints(): StartupCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get startup duration in milliseconds
   */
  getStartupDuration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get startup data for inclusion in session_start event
   */
  getStartupData(): { durationMs: number; checkpoints: StartupCheckpoint[] } | null {
    if (!this.enabled) {
      return null;
    }

    return {
      durationMs: this.getStartupDuration(),
      checkpoints: this.getCheckpoints(),
    };
  }

  /**
   * Check if early logger is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.supabase !== null && this.userId !== null;
  }
}
