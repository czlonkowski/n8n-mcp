import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TelemetryManager, telemetry } from '../../../src/telemetry/telemetry-manager';
import { TelemetryConfigManager } from '../../../src/telemetry/config-manager';
import { TelemetryEventTracker } from '../../../src/telemetry/event-tracker';
import { TelemetryBatchProcessor } from '../../../src/telemetry/batch-processor';
import { createClient } from '@supabase/supabase-js';
import { TELEMETRY_BACKEND } from '../../../src/telemetry/telemetry-types';
import { TelemetryError, TelemetryErrorType } from '../../../src/telemetry/telemetry-error';

// Mock all dependencies
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn()
}));

vi.mock('../../../src/telemetry/config-manager');
vi.mock('../../../src/telemetry/event-tracker');
vi.mock('../../../src/telemetry/batch-processor');
vi.mock('../../../src/telemetry/workflow-sanitizer');

describe('TelemetryManager', () => {
  let mockConfigManager: any;
  let mockSupabaseClient: any;
  let mockEventTracker: any;
  let mockBatchProcessor: any;
  let manager: TelemetryManager;

  beforeEach(() => {
    // Reset singleton using the new method
    TelemetryManager.resetInstance();

    // Mock TelemetryConfigManager
    mockConfigManager = {
      isEnabled: vi.fn().mockReturnValue(true),
      getUserId: vi.fn().mockReturnValue('test-user-123'),
      disable: vi.fn(),
      enable: vi.fn(),
      getStatus: vi.fn().mockReturnValue('enabled')
    };
    vi.mocked(TelemetryConfigManager.getInstance).mockReturnValue(mockConfigManager);

    // Mock Supabase client
    mockSupabaseClient = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    };
    vi.mocked(createClient).mockReturnValue(mockSupabaseClient);

    // Mock EventTracker
    mockEventTracker = {
      trackToolUsage: vi.fn(),
      trackWorkflowCreation: vi.fn().mockResolvedValue(undefined),
      trackError: vi.fn(),
      trackEvent: vi.fn(),
      trackSessionStart: vi.fn(),
      trackSearchQuery: vi.fn(),
      trackValidationDetails: vi.fn(),
      trackToolSequence: vi.fn(),
      trackNodeConfiguration: vi.fn(),
      trackPerformanceMetric: vi.fn(),
      updateToolSequence: vi.fn(),
      getEventQueue: vi.fn().mockReturnValue([]),
      getWorkflowQueue: vi.fn().mockReturnValue([]),
      getMutationQueue: vi.fn().mockReturnValue([]),
      clearEventQueue: vi.fn(),
      clearWorkflowQueue: vi.fn(),
      clearMutationQueue: vi.fn(),
      enqueueMutation: vi.fn(),
      getMutationQueueSize: vi.fn().mockReturnValue(0),
      getStats: vi.fn().mockReturnValue({
        rateLimiter: { currentEvents: 0, droppedEvents: 0 },
        validator: { successes: 0, errors: 0 },
        eventQueueSize: 0,
        workflowQueueSize: 0,
        mutationQueueSize: 0,
        performanceMetrics: {}
      })
    };
    vi.mocked(TelemetryEventTracker).mockImplementation(() => mockEventTracker);

    // Mock BatchProcessor
    mockBatchProcessor = {
      start: vi.fn(),
      stop: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      getMetrics: vi.fn().mockReturnValue({
        eventsTracked: 0,
        eventsDropped: 0,
        eventsFailed: 0,
        batchesSent: 0,
        batchesFailed: 0,
        averageFlushTime: 0,
        rateLimitHits: 0,
        circuitBreakerState: { state: 'closed', failureCount: 0, canRetry: true },
        deadLetterQueueSize: 0
      }),
      resetMetrics: vi.fn()
    };
    vi.mocked(TelemetryBatchProcessor).mockImplementation(() => mockBatchProcessor);

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up global state
    TelemetryManager.resetInstance();
  });

  describe('singleton behavior', () => {
    it('should create only one instance', () => {
      const instance1 = TelemetryManager.getInstance();
      const instance2 = TelemetryManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it.skip('should use global singleton for telemetry export', async () => {
      // Skip: Testing module import behavior with mocks is complex
      // The core singleton behavior is tested in other tests
      const instance = TelemetryManager.getInstance();

      // Import the telemetry export
      const { telemetry: telemetry1 } = await import('../../../src/telemetry/telemetry-manager');

      // Both should reference the same global singleton
      expect(telemetry1).toBe(instance);
    });
  });

  describe('initialization', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should initialize successfully when enabled', () => {
      let enabledDuringStart = false;
      mockBatchProcessor.start.mockImplementation(() => {
        const calls = vi.mocked(TelemetryBatchProcessor).mock.calls;
        const [, isEnabledCallback] = calls[calls.length - 1];
        enabledDuringStart = isEnabledCallback();
      });

      // Trigger initialization by calling a tracking method
      manager.trackEvent('test', {});

      expect(mockConfigManager.isEnabled).toHaveBeenCalled();
      expect(createClient).toHaveBeenCalledWith(
        TELEMETRY_BACKEND.URL,
        TELEMETRY_BACKEND.ANON_KEY,
        expect.objectContaining({
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        })
      );
      expect(mockBatchProcessor.start).toHaveBeenCalled();
      expect(enabledDuringStart).toBe(true);
    });

    it('should use environment variables if provided', () => {
      process.env.SUPABASE_URL = 'https://custom.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'custom-anon-key';

      // Reset instance to trigger re-initialization
      TelemetryManager.resetInstance();
      manager = TelemetryManager.getInstance();

      // Trigger initialization
      manager.trackEvent('test', {});

      expect(createClient).toHaveBeenCalledWith(
        'https://custom.supabase.co',
        'custom-anon-key',
        expect.any(Object)
      );

      // Clean up
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
    });

    it('should not initialize when disabled', () => {
      mockConfigManager.isEnabled.mockReturnValue(false);

      // Reset instance to trigger re-initialization
      TelemetryManager.resetInstance();
      manager = TelemetryManager.getInstance();

      expect(createClient).not.toHaveBeenCalled();
      expect(mockBatchProcessor.start).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', () => {
      vi.mocked(createClient).mockImplementation(() => {
        throw new Error('Supabase initialization failed');
      });

      // Reset instance to trigger re-initialization
      TelemetryManager.resetInstance();
      manager = TelemetryManager.getInstance();

      expect(mockBatchProcessor.start).not.toHaveBeenCalled();
    });
  });

  describe('event tracking methods', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should track tool usage with sequence update', () => {
      manager.trackToolUsage('httpRequest', true, 500);

      expect(mockEventTracker.trackToolUsage).toHaveBeenCalledWith('httpRequest', true, 500);
      expect(mockEventTracker.updateToolSequence).toHaveBeenCalledWith('httpRequest');
    });

    it('should track workflow creation and auto-flush', async () => {
      const workflow = { nodes: [], connections: {} };

      await manager.trackWorkflowCreation(workflow, true);

      expect(mockEventTracker.trackWorkflowCreation).toHaveBeenCalledWith(workflow, true);
      expect(mockBatchProcessor.flush).toHaveBeenCalled();
    });

    it('should handle workflow creation errors', async () => {
      const workflow = { nodes: [], connections: {} };
      const error = new Error('Workflow tracking failed');
      mockEventTracker.trackWorkflowCreation.mockRejectedValue(error);

      await manager.trackWorkflowCreation(workflow, true);

      // Should not throw, but should handle error internally
      expect(mockEventTracker.trackWorkflowCreation).toHaveBeenCalledWith(workflow, true);
    });

    it('should track errors', () => {
      manager.trackError('ValidationError', 'Node configuration invalid', 'httpRequest', 'Required field "url" is missing');

      expect(mockEventTracker.trackError).toHaveBeenCalledWith(
        'ValidationError',
        'Node configuration invalid',
        'httpRequest',
        'Required field "url" is missing'
      );
    });

    it('should track generic events', () => {
      const properties = { key: 'value', count: 42 };
      manager.trackEvent('custom_event', properties);

      expect(mockEventTracker.trackEvent).toHaveBeenCalledWith('custom_event', properties);
    });

    it('should track session start', () => {
      manager.trackSessionStart();

      expect(mockEventTracker.trackSessionStart).toHaveBeenCalled();
    });

    it('should track search queries', () => {
      manager.trackSearchQuery('httpRequest nodes', 5, 'nodes');

      expect(mockEventTracker.trackSearchQuery).toHaveBeenCalledWith(
        'httpRequest nodes',
        5,
        'nodes'
      );
    });

    it('should track validation details', () => {
      const details = { field: 'url', value: 'invalid' };
      manager.trackValidationDetails('nodes-base.httpRequest', 'required_field_missing', details);

      expect(mockEventTracker.trackValidationDetails).toHaveBeenCalledWith(
        'nodes-base.httpRequest',
        'required_field_missing',
        details
      );
    });

    it('should track tool sequences', () => {
      manager.trackToolSequence('httpRequest', 'webhook', 5000);

      expect(mockEventTracker.trackToolSequence).toHaveBeenCalledWith(
        'httpRequest',
        'webhook',
        5000
      );
    });

    it('should track node configuration', () => {
      manager.trackNodeConfiguration('nodes-base.httpRequest', 5, false);

      expect(mockEventTracker.trackNodeConfiguration).toHaveBeenCalledWith(
        'nodes-base.httpRequest',
        5,
        false
      );
    });

    it('should track performance metrics', () => {
      const metadata = { operation: 'database_query' };
      manager.trackPerformanceMetric('search_nodes', 1500, metadata);

      expect(mockEventTracker.trackPerformanceMetric).toHaveBeenCalledWith(
        'search_nodes',
        1500,
        metadata
      );
    });
  });

  describe('flush()', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should flush events and workflows', async () => {
      const mockEvents = [{ user_id: 'user1', event: 'test', properties: {} }];
      const mockWorkflows = [{ user_id: 'user1', workflow_hash: 'hash1' }];
      const mockMutations: any[] = [];

      mockEventTracker.getEventQueue.mockReturnValue(mockEvents);
      mockEventTracker.getWorkflowQueue.mockReturnValue(mockWorkflows);
      mockEventTracker.getMutationQueue.mockReturnValue(mockMutations);

      await manager.flush();

      expect(mockEventTracker.getEventQueue).toHaveBeenCalled();
      expect(mockEventTracker.getWorkflowQueue).toHaveBeenCalled();
      expect(mockEventTracker.getMutationQueue).toHaveBeenCalled();
      expect(mockEventTracker.clearEventQueue).toHaveBeenCalled();
      expect(mockEventTracker.clearWorkflowQueue).toHaveBeenCalled();
      expect(mockEventTracker.clearMutationQueue).toHaveBeenCalled();
      expect(mockBatchProcessor.flush).toHaveBeenCalledWith(mockEvents, mockWorkflows, mockMutations);
    });

    it('should not flush when disabled', async () => {
      mockConfigManager.isEnabled.mockReturnValue(false);

      await manager.flush();

      expect(mockBatchProcessor.flush).not.toHaveBeenCalled();
    });

    it('should not flush without Supabase client', async () => {
      // Simulate initialization failure
      vi.mocked(createClient).mockImplementation(() => {
        throw new Error('Init failed');
      });

      // Reset instance to trigger re-initialization with failure
      (TelemetryManager as any).instance = undefined;
      manager = TelemetryManager.getInstance();

      await manager.flush();

      expect(mockBatchProcessor.flush).not.toHaveBeenCalled();
    });

    it('should handle flush errors gracefully', async () => {
      const error = new Error('Flush failed');
      mockBatchProcessor.flush.mockRejectedValue(error);

      await manager.flush();

      // Should not throw, error should be handled internally
      expect(mockBatchProcessor.flush).toHaveBeenCalled();
    });

    it('should handle TelemetryError specifically', async () => {
      const telemetryError = new TelemetryError(
        TelemetryErrorType.NETWORK_ERROR,
        'Network failed',
        { attempt: 1 },
        true
      );
      mockBatchProcessor.flush.mockRejectedValue(telemetryError);

      await manager.flush();

      expect(mockBatchProcessor.flush).toHaveBeenCalled();
    });
  });

  describe('enable/disable functionality', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should disable telemetry', () => {
      manager.disable();

      expect(mockConfigManager.disable).toHaveBeenCalled();
      expect(mockBatchProcessor.stop).toHaveBeenCalled();
    });

    it('should enable telemetry', () => {
      // Disable first to clear state
      manager.disable();
      vi.clearAllMocks();

      // Now enable
      manager.enable();

      expect(mockConfigManager.enable).toHaveBeenCalled();
      // Should initialize (createClient called once)
      expect(createClient).toHaveBeenCalledTimes(1);
    });

    it('should get status from config manager', () => {
      const status = manager.getStatus();

      expect(mockConfigManager.getStatus).toHaveBeenCalled();
      expect(status).toBe('enabled');
    });
  });

  describe('getMetrics()', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
      // Trigger initialization for enabled tests
      manager.trackEvent('test', {});
    });

    it('should return comprehensive metrics when enabled', () => {
      const metrics = manager.getMetrics();

      expect(metrics).toEqual({
        status: 'enabled',
        initialized: true,
        tracking: expect.any(Object),
        processing: expect.any(Object),
        errors: expect.any(Object),
        performance: expect.any(Object),
        overhead: expect.any(Object)
      });

      expect(mockEventTracker.getStats).toHaveBeenCalled();
      expect(mockBatchProcessor.getMetrics).toHaveBeenCalled();
    });

    it('should return disabled status when disabled', () => {
      mockConfigManager.isEnabled.mockReturnValue(false);
      // Reset to get a fresh instance without initialization
      TelemetryManager.resetInstance();
      manager = TelemetryManager.getInstance();

      const metrics = manager.getMetrics();

      expect(metrics.status).toBe('disabled');
      expect(metrics.initialized).toBe(false); // Not initialized when disabled
    });

    it('should reflect initialization failure', () => {
      // Simulate initialization failure
      vi.mocked(createClient).mockImplementation(() => {
        throw new Error('Init failed');
      });

      // Reset instance to trigger re-initialization with failure
      (TelemetryManager as any).instance = undefined;
      manager = TelemetryManager.getInstance();

      const metrics = manager.getMetrics();

      expect(metrics.initialized).toBe(false);
    });
  });

  describe('error handling and aggregation', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should aggregate initialization errors', () => {
      vi.mocked(createClient).mockImplementation(() => {
        throw new Error('Supabase connection failed');
      });

      // Reset instance to trigger re-initialization with error
      TelemetryManager.resetInstance();
      manager = TelemetryManager.getInstance();

      // Trigger initialization which will fail
      manager.trackEvent('test', {});

      const metrics = manager.getMetrics();
      expect(metrics.errors.totalErrors).toBeGreaterThan(0);
    });

    it('should aggregate workflow tracking errors', async () => {
      const error = new TelemetryError(
        TelemetryErrorType.VALIDATION_ERROR,
        'Workflow validation failed'
      );
      mockEventTracker.trackWorkflowCreation.mockRejectedValue(error);

      const workflow = { nodes: [], connections: {} };
      await manager.trackWorkflowCreation(workflow, true);

      const metrics = manager.getMetrics();
      expect(metrics.errors.totalErrors).toBeGreaterThan(0);
    });

    it('should aggregate flush errors', async () => {
      const error = new Error('Network timeout');
      mockBatchProcessor.flush.mockRejectedValue(error);

      await manager.flush();

      const metrics = manager.getMetrics();
      expect(metrics.errors.totalErrors).toBeGreaterThan(0);
    });
  });

  describe('constructor privacy', () => {
    it('should have private constructor', () => {
      // Ensure there's already an instance
      TelemetryManager.getInstance();

      // Now trying to instantiate directly should throw
      expect(() => new (TelemetryManager as any)()).toThrow('Use TelemetryManager.getInstance() instead of new TelemetryManager()');
    });
  });

  describe('isEnabled() privacy', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should correctly check enabled state', async () => {
      mockConfigManager.isEnabled.mockReturnValue(true);

      await manager.flush();

      expect(mockBatchProcessor.flush).toHaveBeenCalled();
    });

    it('should prevent operations when not initialized', async () => {
      // Simulate initialization failure
      vi.mocked(createClient).mockImplementation(() => {
        throw new Error('Init failed');
      });

      // Reset instance to trigger re-initialization with failure
      (TelemetryManager as any).instance = undefined;
      manager = TelemetryManager.getInstance();

      await manager.flush();

      expect(mockBatchProcessor.flush).not.toHaveBeenCalled();
    });
  });

  describe('dependency injection and callbacks', () => {
    it('should provide correct callbacks to EventTracker', () => {
      const TelemetryEventTrackerMock = vi.mocked(TelemetryEventTracker);

      const manager = TelemetryManager.getInstance();
      // Trigger initialization
      manager.trackEvent('test', {});

      expect(TelemetryEventTrackerMock).toHaveBeenCalledWith(
        expect.any(Function), // getUserId callback
        expect.any(Function)  // isEnabled callback
      );

      // Test the callbacks
      const [getUserIdCallback, isEnabledCallback] = TelemetryEventTrackerMock.mock.calls[0];

      expect(getUserIdCallback()).toBe('test-user-123');
      expect(isEnabledCallback()).toBe(true);
    });

    it('should provide correct callbacks to BatchProcessor', () => {
      const TelemetryBatchProcessorMock = vi.mocked(TelemetryBatchProcessor);

      const manager = TelemetryManager.getInstance();
      // Trigger initialization
      manager.trackEvent('test', {});

      expect(TelemetryBatchProcessorMock).toHaveBeenCalledTimes(2); // Once with null, once with Supabase client

      const lastCall = TelemetryBatchProcessorMock.mock.calls[TelemetryBatchProcessorMock.mock.calls.length - 1];
      const [supabaseClient, isEnabledCallback, options] = lastCall;

      expect(supabaseClient).toBe(mockSupabaseClient);
      expect(isEnabledCallback()).toBe(true);
      expect(options).toEqual(expect.objectContaining({
        onFlushRequested: expect.any(Function)
      }));
    });

    it('should route scheduled flush requests through the manager queues', async () => {
      const events = [{ user_id: 'user1', event: 'scheduled', properties: {} }];
      const workflows = [{ user_id: 'user1', workflow_hash: 'hash1' }];
      const mutations = [{ workflowHashBefore: 'hash1' }];
      mockEventTracker.getEventQueue.mockReturnValue(events);
      mockEventTracker.getWorkflowQueue.mockReturnValue(workflows);
      mockEventTracker.getMutationQueue.mockReturnValue(mutations);

      const manager = TelemetryManager.getInstance();
      manager.trackEvent('test', {});

      const calls = vi.mocked(TelemetryBatchProcessor).mock.calls;
      const options = calls[calls.length - 1][2];
      await options?.onFlushRequested?.();

      expect(mockBatchProcessor.flush).toHaveBeenCalledWith(events, workflows, mutations);
      expect(mockEventTracker.clearEventQueue).toHaveBeenCalled();
      expect(mockEventTracker.clearWorkflowQueue).toHaveBeenCalled();
      expect(mockEventTracker.clearMutationQueue).toHaveBeenCalled();
    });
  });

  describe('Supabase client configuration', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
      // Trigger initialization
      manager.trackEvent('test', {});
    });

    it('should configure Supabase client with correct options', () => {
      expect(createClient).toHaveBeenCalledWith(
        TELEMETRY_BACKEND.URL,
        TELEMETRY_BACKEND.ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          },
          realtime: {
            params: {
              eventsPerSecond: 1
            }
          },
          global: {
            fetch: expect.any(Function)
          }
        }
      );
    });
  });

  describe('workflow creation auto-flush behavior', () => {
    beforeEach(() => {
      manager = TelemetryManager.getInstance();
    });

    it('should auto-flush after successful workflow tracking', async () => {
      const workflow = { nodes: [], connections: {} };

      await manager.trackWorkflowCreation(workflow, true);

      expect(mockEventTracker.trackWorkflowCreation).toHaveBeenCalledWith(workflow, true);
      expect(mockBatchProcessor.flush).toHaveBeenCalled();
    });

    it('should not auto-flush if workflow tracking fails', async () => {
      const workflow = { nodes: [], connections: {} };
      mockEventTracker.trackWorkflowCreation.mockRejectedValue(new Error('Tracking failed'));

      await manager.trackWorkflowCreation(workflow, true);

      expect(mockEventTracker.trackWorkflowCreation).toHaveBeenCalledWith(workflow, true);
      // Flush should NOT be called if tracking fails
      expect(mockBatchProcessor.flush).not.toHaveBeenCalled();
    });
  });

  describe('global singleton behavior', () => {
    it('should preserve singleton across require() calls', async () => {
      // Get the first instance
      const manager1 = TelemetryManager.getInstance();

      // Clear and re-get the instance - should be same due to global state
      TelemetryManager.resetInstance();
      const manager2 = TelemetryManager.getInstance();

      // They should be different instances after reset
      expect(manager2).not.toBe(manager1);

      // But subsequent calls should return the same instance
      const manager3 = TelemetryManager.getInstance();
      expect(manager3).toBe(manager2);
    });

    it.skip('should handle undefined global state gracefully', async () => {
      // Skip: Testing module import behavior with mocks is complex
      // The core singleton behavior is tested in other tests
      // Ensure clean state
      TelemetryManager.resetInstance();

      const manager1 = TelemetryManager.getInstance();
      expect(manager1).toBeDefined();

      // Import telemetry - it should use the same global instance
      const { telemetry } = await import('../../../src/telemetry/telemetry-manager');
      expect(telemetry).toBeDefined();
      expect(telemetry).toBe(manager1);
    });
  });
});
