/**
 * Telemetry Manager
 * Main telemetry coordinator using modular components
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TelemetryConfigManager } from './config-manager';
import { TelemetryEventTracker } from './event-tracker';
import { TelemetryBatchProcessor } from './batch-processor';
import { TelemetryPerformanceMonitor } from './performance-monitor';
import { TELEMETRY_BACKEND } from './telemetry-types';
import { TelemetryError, TelemetryErrorType, TelemetryErrorAggregator } from './telemetry-error';
import { telemetryFetch } from './telemetry-fetch';
import { logger } from '../utils/logger';

export class TelemetryManager {
  private static instance: TelemetryManager;
  private supabase: SupabaseClient | null = null;
  private configManager: TelemetryConfigManager;
  private eventTracker: TelemetryEventTracker;
  private batchProcessor: TelemetryBatchProcessor;
  private performanceMonitor: TelemetryPerformanceMonitor;
  private errorAggregator: TelemetryErrorAggregator;
  private isInitialized: boolean = false;

  private constructor() {
    // Prevent direct instantiation even when TypeScript is bypassed
    if (TelemetryManager.instance) {
      throw new Error('Use TelemetryManager.getInstance() instead of new TelemetryManager()');
    }

    this.configManager = TelemetryConfigManager.getInstance();
    this.errorAggregator = new TelemetryErrorAggregator();
    this.performanceMonitor = new TelemetryPerformanceMonitor();

    // Initialize event tracker with callbacks
    this.eventTracker = new TelemetryEventTracker(
      () => this.configManager.getUserId(),
      () => this.isEnabled()
    );

    // Initialize batch processor (will be configured after Supabase init)
    this.batchProcessor = new TelemetryBatchProcessor(
      null,
      () => this.isEnabled()
    );

    // Delay initialization to first use, not constructor
    // this.initialize();
  }

  static getInstance(): TelemetryManager {
    if (!TelemetryManager.instance) {
      TelemetryManager.instance = new TelemetryManager();
    }
    return TelemetryManager.instance;
  }

  /**
   * Ensure telemetry is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.isInitialized && this.configManager.isEnabled()) {
      this.initialize();
    }
  }

  /**
   * Initialize telemetry if enabled
   */
  private initialize(): void {
    if (!this.configManager.isEnabled()) {
      logger.debug('Telemetry disabled by user preference');
      return;
    }

    // Use hardcoded credentials for zero-configuration telemetry
    // Environment variables can override for development/testing
    const supabaseUrl = process.env.SUPABASE_URL || TELEMETRY_BACKEND.URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || TELEMETRY_BACKEND.ANON_KEY;

    try {
      this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          params: {
            eventsPerSecond: 1,
          },
        },
        global: {
          fetch: telemetryFetch,
        },
      });

      // Update batch processor with Supabase client
      this.batchProcessor = new TelemetryBatchProcessor(
        this.supabase,
        () => this.isEnabled(),
        {
          onFlushRequested: () => this.flush(),
        }
      );

      this.isInitialized = true;
      this.batchProcessor.start();

      logger.debug('Telemetry initialized successfully');
    } catch (error) {
      const telemetryError = new TelemetryError(
        TelemetryErrorType.INITIALIZATION_ERROR,
        'Failed to initialize telemetry',
        { error: error instanceof Error ? error.message : String(error) }
      );
      this.errorAggregator.record(telemetryError);
      telemetryError.log();
      this.isInitialized = false;
    }
  }

  /**
   * Track a tool usage event
   */
  trackToolUsage(toolName: string, success: boolean, duration?: number): void {
    this.ensureInitialized();
    this.performanceMonitor.startOperation('trackToolUsage');
    this.eventTracker.trackToolUsage(toolName, success, duration);
    this.eventTracker.updateToolSequence(toolName);
    this.performanceMonitor.endOperation('trackToolUsage');
  }

  /**
   * Track workflow creation
   */
  async trackWorkflowCreation(workflow: any, validationPassed: boolean): Promise<void> {
    this.ensureInitialized();
    this.performanceMonitor.startOperation('trackWorkflowCreation');
    try {
      await this.eventTracker.trackWorkflowCreation(workflow, validationPassed);
      // Auto-flush workflows to prevent data loss
      await this.flush();
    } catch (error) {
      const telemetryError = error instanceof TelemetryError
        ? error
        : new TelemetryError(
            TelemetryErrorType.UNKNOWN_ERROR,
            'Failed to track workflow',
            { error: String(error) }
          );
      this.errorAggregator.record(telemetryError);
    } finally {
      this.performanceMonitor.endOperation('trackWorkflowCreation');
    }
  }

  /**
   * Track workflow mutation from partial updates
   */
  async trackWorkflowMutation(data: any): Promise<void> {
    this.ensureInitialized();

    if (!this.isEnabled()) {
      logger.debug('Telemetry disabled, skipping mutation tracking');
      return;
    }

    this.performanceMonitor.startOperation('trackWorkflowMutation');
    try {
      const { mutationTracker } = await import('./mutation-tracker.js');
      const userId = this.configManager.getUserId();

      const mutationRecord = await mutationTracker.processMutation(data, userId);

      if (mutationRecord) {
        // Queue for batch processing
        this.eventTracker.enqueueMutation(mutationRecord);

        // Auto-flush if queue reaches threshold
        // Lower threshold (2) for mutations since they're less frequent than regular events
        const queueSize = this.eventTracker.getMutationQueueSize();
        if (queueSize >= 2) {
          await this.flushMutations();
        }
      }
    } catch (error) {
      const telemetryError = error instanceof TelemetryError
        ? error
        : new TelemetryError(
            TelemetryErrorType.UNKNOWN_ERROR,
            'Failed to track workflow mutation',
            { error: String(error) }
          );
      this.errorAggregator.record(telemetryError);
      logger.debug('Error tracking workflow mutation:', error);
    } finally {
      this.performanceMonitor.endOperation('trackWorkflowMutation');
    }
  }


  /**
   * Track an error event
   */
  trackError(errorType: string, context: string, toolName?: string, errorMessage?: string): void {
    this.ensureInitialized();
    this.eventTracker.trackError(errorType, context, toolName, errorMessage);
  }

  /**
   * Track a generic event
   */
  trackEvent(eventName: string, properties: Record<string, any>): void {
    this.ensureInitialized();
    this.eventTracker.trackEvent(eventName, properties);
  }

  /**
   * Track session start
   */
  trackSessionStart(): void {
    this.ensureInitialized();
    this.eventTracker.trackSessionStart();
  }

  /**
   * Track search queries
   */
  trackSearchQuery(query: string, resultsFound: number, searchType: string): void {
    this.eventTracker.trackSearchQuery(query, resultsFound, searchType);
  }

  /**
   * Track validation details
   */
  trackValidationDetails(nodeType: string, errorType: string, details: Record<string, any>): void {
    this.eventTracker.trackValidationDetails(nodeType, errorType, details);
  }

  /**
   * Track tool sequences
   */
  trackToolSequence(previousTool: string, currentTool: string, timeDelta: number): void {
    this.eventTracker.trackToolSequence(previousTool, currentTool, timeDelta);
  }

  /**
   * Track node configuration
   */
  trackNodeConfiguration(nodeType: string, propertiesSet: number, usedDefaults: boolean): void {
    this.eventTracker.trackNodeConfiguration(nodeType, propertiesSet, usedDefaults);
  }

  /**
   * Track performance metrics
   */
  trackPerformanceMetric(operation: string, duration: number, metadata?: Record<string, any>): void {
    this.eventTracker.trackPerformanceMetric(operation, duration, metadata);
  }


  /**
   * Flush queued events to Supabase
   */
  async flush(): Promise<void> {
    this.ensureInitialized();
    if (!this.isEnabled() || !this.supabase) return;

    this.performanceMonitor.startOperation('flush');

    // Get queued data from event tracker
    const events = this.eventTracker.getEventQueue();
    const workflows = this.eventTracker.getWorkflowQueue();
    const mutations = this.eventTracker.getMutationQueue();

    // Clear queues immediately to prevent duplicate processing
    this.eventTracker.clearEventQueue();
    this.eventTracker.clearWorkflowQueue();
    this.eventTracker.clearMutationQueue();

    try {
      // Use batch processor to flush
      await this.batchProcessor.flush(events, workflows, mutations);
    } catch (error) {
      const telemetryError = error instanceof TelemetryError
        ? error
        : new TelemetryError(
            TelemetryErrorType.NETWORK_ERROR,
            'Failed to flush telemetry',
            { error: String(error) },
            true // Retryable
          );
      this.errorAggregator.record(telemetryError);
      telemetryError.log();
    } finally {
      const duration = this.performanceMonitor.endOperation('flush');
      if (duration > 100) {
        logger.debug(`Telemetry flush took ${duration.toFixed(2)}ms`);
      }
    }
  }

  /**
   * Flush queued mutations only
   */
  async flushMutations(): Promise<void> {
    this.ensureInitialized();
    if (!this.isEnabled() || !this.supabase) return;

    const mutations = this.eventTracker.getMutationQueue();
    this.eventTracker.clearMutationQueue();

    if (mutations.length > 0) {
      await this.batchProcessor.flush([], [], mutations);
    }
  }


  /**
   * Check if telemetry is enabled
   */
  private isEnabled(): boolean {
    return this.isInitialized && this.configManager.isEnabled();
  }

  /**
   * Disable telemetry
   */
  disable(): void {
    this.configManager.disable();
    this.batchProcessor.stop();
    this.isInitialized = false;
    this.supabase = null;
  }

  /**
   * Enable telemetry
   */
  enable(): void {
    this.configManager.enable();
    this.initialize();
  }

  /**
   * Get telemetry status
   */
  getStatus(): string {
    return this.configManager.getStatus();
  }

  /**
   * Get comprehensive telemetry metrics
   */
  getMetrics() {
    return {
      status: this.isEnabled() ? 'enabled' : 'disabled',
      initialized: this.isInitialized,
      tracking: this.eventTracker.getStats(),
      processing: this.batchProcessor.getMetrics(),
      errors: this.errorAggregator.getStats(),
      performance: this.performanceMonitor.getDetailedReport(),
      overhead: this.performanceMonitor.getTelemetryOverhead()
    };
  }

  /**
   * Reset singleton instance (for testing purposes)
   */
  static resetInstance(): void {
    TelemetryManager.instance = undefined as any;
    (global as any).__telemetryManager = undefined;
  }
}

// Create a global singleton to ensure only one instance across all imports
const globalAny = global as any;

if (!globalAny.__telemetryManager) {
  globalAny.__telemetryManager = TelemetryManager.getInstance();
}

// Export singleton instance
export const telemetry = globalAny.__telemetryManager as TelemetryManager;
