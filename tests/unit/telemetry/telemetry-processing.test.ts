import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll, type MockInstance } from 'vitest';
import { TelemetryBatchProcessor } from '../../../src/telemetry/batch-processor';
import { TelemetryEvent, WorkflowTelemetry, WorkflowMutationRecord, TELEMETRY_CONFIG } from '../../../src/telemetry/telemetry-types';
import { TelemetryError, TelemetryErrorType } from '../../../src/telemetry/telemetry-error';
import { IntentClassification, MutationToolName } from '../../../src/telemetry/mutation-types';
import { AddNodeOperation } from '../../../src/types/workflow-diff';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock logger to avoid console output in tests
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('TelemetryBatchProcessor', () => {
  const TEST_OPERATION_TIMEOUT = 100;
  let batchProcessor: TelemetryBatchProcessor;
  let mockSupabase: SupabaseClient;
  let mockIsEnabled: ReturnType<typeof vi.fn>;
  let mockProcessExit: MockInstance;

  const createMockSupabaseResponse = (error: any = null) => ({
    data: null,
    error,
    status: error ? 400 : 200,
    statusText: error ? 'Bad Request' : 'OK',
    count: null,
    success: !error,
  });

  const createWorkflowTelemetry = (index: number): WorkflowTelemetry => ({
    user_id: `workflow-user-${index}`,
    workflow_hash: `workflow-hash-${index}`,
    node_count: 1,
    node_types: ['n8n-nodes-base.set'],
    has_trigger: false,
    has_webhook: false,
    complexity: 'simple',
    sanitized_workflow: { nodes: [], connections: {} },
  });

  const createMutationRecord = (index: number): WorkflowMutationRecord => ({
    userId: `mutation-user-${index}`,
    sessionId: `mutation-session-${index}`,
    workflowBefore: { nodes: [], connections: {} },
    workflowAfter: { nodes: [], connections: {} },
    workflowHashBefore: `before-${index}`,
    workflowHashAfter: `after-${index}`,
    userIntent: 'Test multi-batch retention',
    intentClassification: IntentClassification.ADD_FUNCTIONALITY,
    toolName: MutationToolName.UPDATE_PARTIAL,
    operations: [],
    operationCount: 0,
    operationTypes: [],
    validationImproved: null,
    errorsResolved: 0,
    errorsIntroduced: 0,
    nodesAdded: 0,
    nodesRemoved: 0,
    nodesModified: 0,
    connectionsAdded: 0,
    connectionsRemoved: 0,
    propertiesChanged: 0,
    mutationSuccess: true,
    durationMs: 1,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockIsEnabled = vi.fn().mockReturnValue(true);

    mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue(createMockSupabaseResponse())
      })
    } as any;

    // Mock process events to prevent actual exit
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      // Do nothing - just prevent actual exit
    }) as any);

    vi.clearAllMocks();

    batchProcessor = new TelemetryBatchProcessor(mockSupabase, mockIsEnabled, {
      operationTimeout: TEST_OPERATION_TIMEOUT,
    });
  });

  afterEach(() => {
    // Stop the batch processor to clear any intervals
    batchProcessor.stop();
    mockProcessExit.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('should start periodic flushing when enabled', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const flushSpy = vi.spyOn(batchProcessor, 'flush');

      batchProcessor.start();
      await vi.advanceTimersByTimeAsync(TELEMETRY_CONFIG.BATCH_FLUSH_INTERVAL);

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        TELEMETRY_CONFIG.BATCH_FLUSH_INTERVAL
      );
      expect(flushSpy).toHaveBeenCalled();
    });

    it('should not start when disabled', () => {
      mockIsEnabled.mockReturnValue(false);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      batchProcessor.start();

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('should not start without Supabase client', () => {
      const processor = new TelemetryBatchProcessor(null, mockIsEnabled);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      processor.start();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      processor.stop();
    });

    it('should not register timers or listeners more than once', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const onSpy = vi.spyOn(process, 'on');

      batchProcessor.start();
      batchProcessor.start();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(onSpy).toHaveBeenCalledTimes(3);
    });

    it('should set up process exit handlers', () => {
      const onSpy = vi.spyOn(process, 'on');

      batchProcessor.start();

      expect(onSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('should clear flush timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      batchProcessor.start();
      batchProcessor.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('flush()', () => {
    const mockEvents: TelemetryEvent[] = [
      {
        user_id: 'user1',
        event: 'tool_used',
        properties: { tool: 'httpRequest', success: true }
      },
      {
        user_id: 'user2',
        event: 'tool_used',
        properties: { tool: 'webhook', success: false }
      }
    ];

    const mockWorkflows: WorkflowTelemetry[] = [
      {
        user_id: 'user1',
        workflow_hash: 'hash1',
        node_count: 3,
        node_types: ['webhook', 'httpRequest', 'set'],
        has_trigger: true,
        has_webhook: true,
        complexity: 'medium',
        sanitized_workflow: { nodes: [], connections: {} }
      }
    ];

    it('should flush events successfully', async () => {
      await batchProcessor.flush(mockEvents);

      expect(mockSupabase.from).toHaveBeenCalledWith('telemetry_events');
      expect(mockSupabase.from('telemetry_events').insert).toHaveBeenCalledWith(mockEvents);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(2);
      expect(metrics.batchesSent).toBe(1);
    });

    it('should flush workflows successfully', async () => {
      await batchProcessor.flush(undefined, mockWorkflows);

      expect(mockSupabase.from).toHaveBeenCalledWith('telemetry_workflows');
      expect(mockSupabase.from('telemetry_workflows').insert).toHaveBeenCalledWith(mockWorkflows);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(1);
      expect(metrics.batchesSent).toBe(1);
    });

    it('should flush both events and workflows', async () => {
      await batchProcessor.flush(mockEvents, mockWorkflows);

      expect(mockSupabase.from).toHaveBeenCalledWith('telemetry_events');
      expect(mockSupabase.from).toHaveBeenCalledWith('telemetry_workflows');

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(3); // 2 events + 1 workflow
      expect(metrics.batchesSent).toBe(2);
    });

    it('should not flush when disabled', async () => {
      mockIsEnabled.mockReturnValue(false);

      await batchProcessor.flush(mockEvents, mockWorkflows);

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should not flush without Supabase client', async () => {
      const processor = new TelemetryBatchProcessor(null, mockIsEnabled);

      await processor.flush(mockEvents);

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should skip flush when circuit breaker is open', async () => {
      // Open circuit breaker by failing multiple times
      const errorResponse = createMockSupabaseResponse(new Error('Network error'));
      vi.mocked(mockSupabase.from('telemetry_events').insert).mockResolvedValue(errorResponse);

      // Fail enough times to open circuit breaker (5 by default)
      for (let i = 0; i < 5; i++) {
        await batchProcessor.flush(mockEvents);
      }

      const metrics = batchProcessor.getMetrics();
      expect(metrics.circuitBreakerState.state).toBe('open');

      // Next flush should be skipped
      vi.clearAllMocks();
      await batchProcessor.flush(mockEvents);

      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(batchProcessor.getMetrics().eventsDropped).toBeGreaterThan(0);
    });

    it('should record flush time metrics', async () => {
      const startTime = Date.now();
      await batchProcessor.flush(mockEvents);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.averageFlushTime).toBeGreaterThanOrEqual(0);
      expect(metrics.lastFlushTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('batch creation', () => {
    async function expectAllUnsentBatchesRetried(
      table: string,
      itemCount: number,
      flush: () => Promise<void>
    ): Promise<void> {
      const insert = vi.fn()
        .mockResolvedValueOnce(createMockSupabaseResponse(new Error('First batch failed')))
        .mockResolvedValue(createMockSupabaseResponse());
      vi.mocked(mockSupabase.from).mockImplementation((requestedTable) => ({
        insert: requestedTable === table
          ? insert
          : vi.fn().mockResolvedValue(createMockSupabaseResponse()),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      await flush();

      expect(insert).toHaveBeenCalledTimes(1);
      expect(batchProcessor.getMetrics()).toMatchObject({
        eventsFailed: itemCount,
        batchesFailed: 2,
        deadLetterQueueSize: itemCount,
      });

      await batchProcessor.flush([]);

      const retriedItems = insert.mock.calls
        .slice(1)
        .flatMap(([batch]) => batch);
      expect(insert).toHaveBeenCalledTimes(3);
      expect(retriedItems).toHaveLength(itemCount);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(0);
    }

    it('should create single batch for small datasets', async () => {
      const events: TelemetryEvent[] = Array.from({ length: 10 }, (_, i) => ({
        user_id: `user${i}`,
        event: 'test_event',
        properties: { index: i }
      }));

      await batchProcessor.flush(events);

      expect(mockSupabase.from('telemetry_events').insert).toHaveBeenCalledTimes(1);
      expect(mockSupabase.from('telemetry_events').insert).toHaveBeenCalledWith(events);
    });

    it('should create multiple batches for large datasets', async () => {
      const events: TelemetryEvent[] = Array.from({ length: 75 }, (_, i) => ({
        user_id: `user${i}`,
        event: 'test_event',
        properties: { index: i }
      }));

      await batchProcessor.flush(events);

      // Should create 2 batches (50 + 25) based on TELEMETRY_CONFIG.MAX_BATCH_SIZE
      expect(mockSupabase.from('telemetry_events').insert).toHaveBeenCalledTimes(2);

      const firstCall = vi.mocked(mockSupabase.from('telemetry_events').insert).mock.calls[0][0];
      const secondCall = vi.mocked(mockSupabase.from('telemetry_events').insert).mock.calls[1][0];

      expect(firstCall).toHaveLength(TELEMETRY_CONFIG.MAX_BATCH_SIZE);
      expect(secondCall).toHaveLength(25);
    });

    it('should retain every unattempted event batch after a failure', async () => {
      const events: TelemetryEvent[] = Array.from({ length: 60 }, (_, index) => ({
        user_id: `event-user-${index}`,
        event: 'multi_batch_event',
        properties: { index },
      }));

      await expectAllUnsentBatchesRetried(
        'telemetry_events',
        events.length,
        () => batchProcessor.flush(events)
      );
    });

    it('should retain every unattempted workflow batch after a failure', async () => {
      const workflows = Array.from({ length: 60 }, (_, index) =>
        createWorkflowTelemetry(index)
      );

      await expectAllUnsentBatchesRetried(
        'telemetry_workflows',
        workflows.length,
        () => batchProcessor.flush(undefined, workflows)
      );
    });

    it('should retain every unattempted mutation batch after a failure', async () => {
      const mutations = Array.from({ length: 60 }, (_, index) =>
        createMutationRecord(index)
      );

      await expectAllUnsentBatchesRetried(
        'workflow_mutations',
        mutations.length,
        () => batchProcessor.flush(undefined, undefined, mutations)
      );
    });
  });

  describe('workflow deduplication', () => {
    it('should deduplicate workflows by hash', async () => {
      const workflows: WorkflowTelemetry[] = [
        {
          user_id: 'user1',
          workflow_hash: 'hash1',
          node_count: 2,
          node_types: ['webhook', 'set'],
          has_trigger: true,
          has_webhook: true,
          complexity: 'simple',
          sanitized_workflow: { nodes: [], connections: {} }
        },
        {
          user_id: 'user2',
          workflow_hash: 'hash1', // Same hash - should be deduplicated
          node_count: 2,
          node_types: ['webhook', 'set'],
          has_trigger: true,
          has_webhook: true,
          complexity: 'simple',
          sanitized_workflow: { nodes: [], connections: {} }
        },
        {
          user_id: 'user1',
          workflow_hash: 'hash2', // Different hash - should be kept
          node_count: 3,
          node_types: ['webhook', 'httpRequest', 'set'],
          has_trigger: true,
          has_webhook: true,
          complexity: 'medium',
          sanitized_workflow: { nodes: [], connections: {} }
        }
      ];

      await batchProcessor.flush(undefined, workflows);

      const insertCall = vi.mocked(mockSupabase.from('telemetry_workflows').insert).mock.calls[0][0];
      expect(insertCall).toHaveLength(2); // Should deduplicate to 2 workflows

      const hashes = insertCall.map((w: WorkflowTelemetry) => w.workflow_hash);
      expect(hashes).toEqual(['hash1', 'hash2']);
    });
  });

  describe('bounded operation execution', () => {
    it('should succeed on a single attempt', async () => {
      const insert = vi.mocked(mockSupabase.from('telemetry_events').insert);

      const events: TelemetryEvent[] = [{
        user_id: 'user1',
        event: 'test_event',
        properties: {}
      }];

      await batchProcessor.flush(events);

      expect(insert).toHaveBeenCalledTimes(1);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(1);
    });

    it('should fail after a single attempt', async () => {
      const error = new Error('Persistent network error');
      const errorResponse = createMockSupabaseResponse(error);

      const insert = vi.mocked(mockSupabase.from('telemetry_events').insert);
      insert.mockResolvedValue(errorResponse);

      const events: TelemetryEvent[] = [{
        user_id: 'user1',
        event: 'test_event',
        properties: {}
      }];

      await batchProcessor.flush(events);

      expect(insert).toHaveBeenCalledTimes(1);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsFailed).toBe(1);
      expect(metrics.batchesFailed).toBe(1);
      expect(metrics.deadLetterQueueSize).toBe(1);
    });

    it('should bound a truly never-settling operation with production timeout behavior', async () => {
      const insert = vi.mocked(mockSupabase.from('telemetry_events').insert);
      insert.mockImplementation(() => new Promise(() => {}) as any);

      const events: TelemetryEvent[] = [{
        user_id: 'user1',
        event: 'test_event',
        properties: {}
      }];

      let settled = false;
      const flushPromise = batchProcessor.flush(events).then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.runAllTimersAsync();
      await flushPromise;

      const metrics = batchProcessor.getMetrics();
      expect(settled).toBe(true);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(metrics.eventsFailed).toBe(1);
      expect(metrics.batchesFailed).toBe(1);
      expect(metrics.deadLetterQueueSize).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should clear the operation timeout after a successful attempt', async () => {
      await batchProcessor.flush([{
        user_id: 'user1',
        event: 'test_event',
        properties: {}
      }]);

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('dead letter queue', () => {
    it('should add failed events to dead letter queue', async () => {
      const error = new Error('Persistent error');
      const errorResponse = createMockSupabaseResponse(error);
      vi.mocked(mockSupabase.from('telemetry_events').insert).mockResolvedValue(errorResponse);

      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'event1', properties: {} },
        { user_id: 'user2', event: 'event2', properties: {} }
      ];

      await batchProcessor.flush(events);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(2);
    });

    it('should process dead letter queue when circuit is healthy', async () => {
      const error = new Error('Temporary error');
      const errorResponse = createMockSupabaseResponse(error);

      const insert = vi.mocked(mockSupabase.from('telemetry_events').insert);
      insert.mockResolvedValueOnce(errorResponse);
      insert.mockResolvedValueOnce(createMockSupabaseResponse());

      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'event1', properties: {} }
      ];

      // First flush - should fail and add to dead letter queue
      await batchProcessor.flush(events);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(1);

      // Second flush - should process dead letter queue
      await batchProcessor.flush([]);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(0);
    });

    it('should maintain dead letter queue size limit', async () => {
      const error = new Error('Persistent error');
      const errorResponse = createMockSupabaseResponse(error);
      // Always fail - each flush adds its batch to the dead letter queue
      vi.mocked(mockSupabase.from('telemetry_events').insert).mockResolvedValue(errorResponse);

      for (let i = 0; i < 3; i++) {
        const events: TelemetryEvent[] = Array.from({ length: 50 }, (_, j) => ({
          user_id: `user${i}_${j}`,
          event: 'test_event',
          properties: { batch: i, index: j }
        }));

        await batchProcessor.flush(events);
      }

      const metrics = batchProcessor.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(100);
      expect(metrics.eventsDropped).toBe(50);
    });

    it('should retry failed workflow mutations through the mutation table', async () => {
      const errorResponse = createMockSupabaseResponse(new Error('Temporary mutation error'));
      const mutationInsert = vi.fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(createMockSupabaseResponse());
      const eventInsert = vi.fn().mockResolvedValue(createMockSupabaseResponse());

      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: table === 'workflow_mutations' ? mutationInsert : eventInsert,
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      const mutation: WorkflowMutationRecord = {
        userId: 'user1',
        sessionId: 'session1',
        workflowBefore: { nodes: [], connections: {} },
        workflowAfter: { nodes: [], connections: {} },
        workflowHashBefore: 'hash1',
        workflowHashAfter: 'hash2',
        userIntent: 'Test mutation DLQ retry',
        intentClassification: IntentClassification.ADD_FUNCTIONALITY,
        toolName: MutationToolName.UPDATE_PARTIAL,
        operations: [],
        operationCount: 0,
        operationTypes: [],
        validationImproved: null,
        errorsResolved: 0,
        errorsIntroduced: 0,
        nodesAdded: 0,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 0,
        connectionsRemoved: 0,
        propertiesChanged: 0,
        mutationSuccess: false,
        durationMs: 10
      };

      await batchProcessor.flush(undefined, undefined, [mutation]);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(1);

      await batchProcessor.flush([]);

      expect(mutationInsert).toHaveBeenCalledTimes(2);
      expect(eventInsert).not.toHaveBeenCalled();
      expect(mockSupabase.from).toHaveBeenNthCalledWith(1, 'workflow_mutations');
      expect(mockSupabase.from).toHaveBeenNthCalledWith(2, 'workflow_mutations');
      expect(mutationInsert).toHaveBeenLastCalledWith([
        expect.objectContaining({
          user_id: 'user1',
          workflow_hash_before: 'hash1',
          workflow_hash_after: 'hash2'
        })
      ]);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(0);
    });

    it('should handle mixed events and workflows in dead letter queue', async () => {
      const error = new Error('Mixed error');
      const errorResponse = createMockSupabaseResponse(error);
      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockResolvedValue(errorResponse),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'event1', properties: {} }
      ];

      const workflows: WorkflowTelemetry[] = [
        {
          user_id: 'user1',
          workflow_hash: 'hash1',
          node_count: 1,
          node_types: ['webhook'],
          has_trigger: true,
          has_webhook: true,
          complexity: 'simple',
          sanitized_workflow: { nodes: [], connections: {} }
        }
      ];

      await batchProcessor.flush(events, workflows);

      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(2);

      // Mock successful operations for dead letter queue processing
      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockResolvedValue(createMockSupabaseResponse()),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      await batchProcessor.flush([]);
      expect(batchProcessor.getMetrics().deadLetterQueueSize).toBe(0);
    });
  });

  describe('circuit breaker integration', () => {
    it('should update circuit breaker on success', async () => {
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      await batchProcessor.flush(events);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.circuitBreakerState.state).toBe('closed');
      expect(metrics.circuitBreakerState.failureCount).toBe(0);
    });

    it('should update circuit breaker on failure', async () => {
      const error = new Error('Network error');
      const errorResponse = createMockSupabaseResponse(error);
      vi.mocked(mockSupabase.from('telemetry_events').insert).mockResolvedValue(errorResponse);

      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      await batchProcessor.flush(events);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.circuitBreakerState.failureCount).toBeGreaterThan(0);
    });
  });

  describe('metrics collection', () => {
    it('should collect comprehensive metrics', async () => {
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'event1', properties: {} },
        { user_id: 'user2', event: 'event2', properties: {} }
      ];

      await batchProcessor.flush(events);

      const metrics = batchProcessor.getMetrics();

      expect(metrics).toHaveProperty('eventsTracked');
      expect(metrics).toHaveProperty('eventsDropped');
      expect(metrics).toHaveProperty('eventsFailed');
      expect(metrics).toHaveProperty('batchesSent');
      expect(metrics).toHaveProperty('batchesFailed');
      expect(metrics).toHaveProperty('averageFlushTime');
      expect(metrics).toHaveProperty('lastFlushTime');
      expect(metrics).toHaveProperty('rateLimitHits');
      expect(metrics).toHaveProperty('circuitBreakerState');
      expect(metrics).toHaveProperty('deadLetterQueueSize');

      expect(metrics.eventsTracked).toBe(2);
      expect(metrics.batchesSent).toBe(1);
    });

    it('should track flush time statistics', async () => {
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      // Perform multiple flushes to test average calculation
      await batchProcessor.flush(events);
      await batchProcessor.flush(events);
      await batchProcessor.flush(events);

      const metrics = batchProcessor.getMetrics();
      expect(metrics.averageFlushTime).toBeGreaterThanOrEqual(0);
      expect(metrics.lastFlushTime).toBeGreaterThanOrEqual(0);
    });

    it('should maintain limited flush time history', async () => {
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      // Perform more than 100 flushes to test history limit
      for (let i = 0; i < 105; i++) {
        await batchProcessor.flush(events);
      }

      // Should still calculate average correctly (history is limited internally)
      const metrics = batchProcessor.getMetrics();
      expect(metrics.averageFlushTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetMetrics()', () => {
    it('should reset all metrics to initial state', async () => {
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      // Generate some metrics
      await batchProcessor.flush(events);

      // Verify metrics exist
      let metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBeGreaterThan(0);
      expect(metrics.batchesSent).toBeGreaterThan(0);

      // Reset metrics
      batchProcessor.resetMetrics();

      // Verify reset
      metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(0);
      expect(metrics.eventsDropped).toBe(0);
      expect(metrics.eventsFailed).toBe(0);
      expect(metrics.batchesSent).toBe(0);
      expect(metrics.batchesFailed).toBe(0);
      expect(metrics.averageFlushTime).toBe(0);
      expect(metrics.rateLimitHits).toBe(0);
      expect(metrics.circuitBreakerState.state).toBe('closed');
      expect(metrics.circuitBreakerState.failureCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays gracefully', async () => {
      await batchProcessor.flush([], []);

      expect(mockSupabase.from).not.toHaveBeenCalled();

      const metrics = batchProcessor.getMetrics();
      expect(metrics.eventsTracked).toBe(0);
      expect(metrics.batchesSent).toBe(0);
    });

    it('should handle undefined inputs gracefully', async () => {
      await batchProcessor.flush();

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should handle null Supabase client gracefully', async () => {
      const processor = new TelemetryBatchProcessor(null, mockIsEnabled);
      const events: TelemetryEvent[] = [
        { user_id: 'user1', event: 'test_event', properties: {} }
      ];

      await expect(processor.flush(events)).resolves.not.toThrow();
    });

    it('should serialize concurrent event, workflow, and mutation flushes globally', async () => {
      const operationOrder: string[] = [];
      const pendingOperations: Array<() => void> = [];
      let activeOperations = 0;
      let maxActiveOperations = 0;

      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockImplementation(() => {
          operationOrder.push(table);
          activeOperations++;
          maxActiveOperations = Math.max(maxActiveOperations, activeOperations);

          return new Promise(resolve => {
            pendingOperations.push(() => {
              activeOperations--;
              resolve(createMockSupabaseResponse());
            });
          });
        }),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      const event: TelemetryEvent = {
        user_id: 'event-user',
        event: 'test_event',
        properties: {}
      };
      const workflow: WorkflowTelemetry = {
        user_id: 'workflow-user',
        workflow_hash: 'concurrent-hash',
        node_count: 1,
        node_types: ['n8n-nodes-base.set'],
        has_trigger: false,
        has_webhook: false,
        complexity: 'simple',
        sanitized_workflow: { nodes: [], connections: {} }
      };
      const mutation = {
        userId: 'mutation-user',
        sessionId: 'concurrent-session',
        workflowBefore: { nodes: [], connections: {} },
        workflowAfter: { nodes: [], connections: {} },
        workflowHashBefore: 'before',
        workflowHashAfter: 'after',
        userIntent: 'Test concurrent serialization',
        intentClassification: IntentClassification.ADD_FUNCTIONALITY,
        toolName: MutationToolName.UPDATE_PARTIAL,
        operations: [],
        operationCount: 0,
        operationTypes: [],
        validationImproved: null,
        errorsResolved: 0,
        errorsIntroduced: 0,
        nodesAdded: 0,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 0,
        connectionsRemoved: 0,
        propertiesChanged: 0,
        mutationSuccess: true,
        durationMs: 1
      } as WorkflowMutationRecord;

      const flushPromises = [
        batchProcessor.flush([event]),
        batchProcessor.flush(undefined, [workflow]),
        batchProcessor.flush(undefined, undefined, [mutation])
      ];

      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(operationOrder).toEqual(['telemetry_events']);
      expect(activeOperations).toBe(1);

      pendingOperations.shift()!();
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(operationOrder).toEqual(['telemetry_events', 'telemetry_workflows']);
      expect(activeOperations).toBe(1);

      pendingOperations.shift()!();
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(operationOrder).toEqual([
        'telemetry_events',
        'telemetry_workflows',
        'workflow_mutations'
      ]);
      expect(activeOperations).toBe(1);

      pendingOperations.shift()!();
      await Promise.all(flushPromises);

      expect(maxActiveOperations).toBe(1);
      expect(batchProcessor.getMetrics()).toMatchObject({
        eventsTracked: 3,
        batchesSent: 3,
        eventsFailed: 0,
        batchesFailed: 0
      });
    });

    it('should settle queued never-ending flushes without silently losing any batch', async () => {
      const insert = vi.mocked(mockSupabase.from('telemetry_events').insert);
      insert.mockImplementation(() => new Promise(() => {}) as any);

      const events = ['queued-1', 'queued-2', 'queued-3'].map(user_id => [{
        user_id,
        event: 'never_settles',
        properties: {}
      }] as TelemetryEvent[]);

      const flushPromises = events.map(batch => batchProcessor.flush(batch));

      await vi.runAllTimersAsync();
      await Promise.all(flushPromises);

      const attemptedUsers = insert.mock.calls.map(([batch]) =>
        (batch as TelemetryEvent[])[0].user_id
      );
      expect(attemptedUsers).toEqual(events.map(([event]) => event.user_id));
      expect(batchProcessor.getMetrics()).toMatchObject({
        eventsFailed: 3,
        batchesFailed: 3,
        eventsDropped: 0,
        deadLetterQueueSize: 3
      });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('process lifecycle integration', () => {
    it('should route lifecycle flushes through the queue-aware callback', async () => {
      const onFlushRequested = vi.fn().mockRejectedValue(new Error('Scheduled flush failed'));
      const processor = new TelemetryBatchProcessor(mockSupabase, mockIsEnabled, {
        operationTimeout: TEST_OPERATION_TIMEOUT,
        onFlushRequested,
      });

      processor.start();
      process.emit('beforeExit', 0);
      await Promise.resolve();
      await Promise.resolve();

      expect(onFlushRequested).toHaveBeenCalledOnce();
      processor.stop();
    });

    it('should flush on process beforeExit', async () => {
      const flushSpy = vi.spyOn(batchProcessor, 'flush');

      batchProcessor.start();

      // Trigger beforeExit event
      process.emit('beforeExit', 0);

      expect(flushSpy).toHaveBeenCalled();
    });

    it('should flush and exit on SIGINT', async () => {
      const flushSpy = vi.spyOn(batchProcessor, 'flush');

      batchProcessor.start();

      // Trigger SIGINT event
      process.emit('SIGINT', 'SIGINT');
      for (let index = 0; index < 10; index++) await Promise.resolve();

      expect(flushSpy).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should flush and exit on SIGTERM', async () => {
      const flushSpy = vi.spyOn(batchProcessor, 'flush');

      batchProcessor.start();

      // Trigger SIGTERM event
      process.emit('SIGTERM', 'SIGTERM');
      for (let index = 0; index < 10; index++) await Promise.resolve();

      expect(flushSpy).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it.each(['SIGINT', 'SIGTERM'] as const)(
      'should wait for the scheduled flush before exiting on %s',
      async signal => {
        let resolveFlush!: () => void;
        const onFlushRequested = vi.fn(() => new Promise<void>(resolve => {
          resolveFlush = resolve;
        }));
        const processor = new TelemetryBatchProcessor(mockSupabase, mockIsEnabled, {
          operationTimeout: TEST_OPERATION_TIMEOUT,
          onFlushRequested,
        });

        processor.start();
        process.emit(signal, signal);
        await Promise.resolve();

        expect(onFlushRequested).toHaveBeenCalledOnce();
        expect(mockProcessExit).not.toHaveBeenCalled();

        resolveFlush();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockProcessExit).toHaveBeenCalledWith(0);
        processor.stop();
      }
    );
  });

  describe('Issue #517: workflow data preservation', () => {
    // This test verifies that workflow mutation data is NOT recursively converted to snake_case
    // Previously, the toSnakeCase function was applied recursively which caused:
    // - Connection keys like "Webhook" to become "_webhook"
    // - Node fields like "typeVersion" to become "type_version"

    it('should preserve connection keys exactly as-is (node names)', async () => {
      const mutation: WorkflowMutationRecord = {
        userId: 'user1',
        sessionId: 'session1',
        workflowBefore: {
          nodes: [],
          connections: {}
        },
        workflowAfter: {
          nodes: [
            { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [0, 0], parameters: {} }
          ],
          // Connection keys are NODE NAMES - must be preserved exactly
          connections: {
            'Webhook': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
            'AI Agent': { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] },
            'HTTP Request': { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] }
          }
        },
        workflowHashBefore: 'hash1',
        workflowHashAfter: 'hash2',
        userIntent: 'Test',
        intentClassification: IntentClassification.ADD_FUNCTIONALITY,
        toolName: MutationToolName.UPDATE_PARTIAL,
        operations: [],
        operationCount: 0,
        operationTypes: [],
        validationImproved: null,
        errorsResolved: 0,
        errorsIntroduced: 0,
        nodesAdded: 1,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 3,
        connectionsRemoved: 0,
        propertiesChanged: 0,
        mutationSuccess: true,
        durationMs: 100
      };

      let capturedData: any = null;
      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockImplementation((data) => {
          if (table === 'workflow_mutations') {
            capturedData = data;
          }
          return Promise.resolve(createMockSupabaseResponse());
        }),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      await batchProcessor.flush(undefined, undefined, [mutation]);

      expect(capturedData).toBeDefined();
      expect(capturedData).toHaveLength(1);

      const savedMutation = capturedData[0];

      // Top-level keys should be snake_case for Supabase
      expect(savedMutation).toHaveProperty('user_id');
      expect(savedMutation).toHaveProperty('session_id');
      expect(savedMutation).toHaveProperty('workflow_after');

      // Connection keys should be preserved EXACTLY (not "_webhook", "_a_i _agent", etc.)
      const connections = savedMutation.workflow_after.connections;
      expect(connections).toHaveProperty('Webhook');  // NOT "_webhook"
      expect(connections).toHaveProperty('AI Agent'); // NOT "_a_i _agent"
      expect(connections).toHaveProperty('HTTP Request'); // NOT "_h_t_t_p _request"
    });

    it('should preserve node field names in camelCase', async () => {
      const mutation: WorkflowMutationRecord = {
        userId: 'user1',
        sessionId: 'session1',
        workflowBefore: { nodes: [], connections: {} },
        workflowAfter: {
          nodes: [
            {
              id: '1',
              name: 'Webhook',
              type: 'n8n-nodes-base.webhook',
              // These fields MUST remain in camelCase for n8n API compatibility
              typeVersion: 2,
              webhookId: 'abc123',
              onError: 'continueOnFail',
              alwaysOutputData: true,
              continueOnFail: false,
              retryOnFail: true,
              maxTries: 3,
              notesInFlow: true,
              waitBetweenTries: 1000,
              executeOnce: false,
              position: [100, 200],
              parameters: {}
            }
          ],
          connections: {}
        },
        workflowHashBefore: 'hash1',
        workflowHashAfter: 'hash2',
        userIntent: 'Test',
        intentClassification: IntentClassification.ADD_FUNCTIONALITY,
        toolName: MutationToolName.UPDATE_PARTIAL,
        operations: [],
        operationCount: 0,
        operationTypes: [],
        validationImproved: null,
        errorsResolved: 0,
        errorsIntroduced: 0,
        nodesAdded: 1,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 0,
        connectionsRemoved: 0,
        propertiesChanged: 0,
        mutationSuccess: true,
        durationMs: 100
      };

      let capturedData: any = null;
      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockImplementation((data) => {
          if (table === 'workflow_mutations') {
            capturedData = data;
          }
          return Promise.resolve(createMockSupabaseResponse());
        }),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      await batchProcessor.flush(undefined, undefined, [mutation]);

      expect(capturedData).toBeDefined();
      const savedNode = capturedData[0].workflow_after.nodes[0];

      // Node fields should be preserved in camelCase (NOT snake_case)
      expect(savedNode).toHaveProperty('typeVersion');        // NOT type_version
      expect(savedNode).toHaveProperty('webhookId');          // NOT webhook_id
      expect(savedNode).toHaveProperty('onError');            // NOT on_error
      expect(savedNode).toHaveProperty('alwaysOutputData');   // NOT always_output_data
      expect(savedNode).toHaveProperty('continueOnFail');     // NOT continue_on_fail
      expect(savedNode).toHaveProperty('retryOnFail');        // NOT retry_on_fail
      expect(savedNode).toHaveProperty('maxTries');           // NOT max_tries
      expect(savedNode).toHaveProperty('notesInFlow');        // NOT notes_in_flow
      expect(savedNode).toHaveProperty('waitBetweenTries');   // NOT wait_between_tries
      expect(savedNode).toHaveProperty('executeOnce');        // NOT execute_once

      // Verify values are preserved
      expect(savedNode.typeVersion).toBe(2);
      expect(savedNode.webhookId).toBe('abc123');
      expect(savedNode.maxTries).toBe(3);
    });

    it('should convert only top-level mutation record fields to snake_case', async () => {
      const mutation: WorkflowMutationRecord = {
        userId: 'user1',
        sessionId: 'session1',
        workflowBefore: { nodes: [], connections: {} },
        workflowAfter: { nodes: [], connections: {} },
        workflowHashBefore: 'hash1',
        workflowHashAfter: 'hash2',
        workflowStructureHashBefore: 'struct1',
        workflowStructureHashAfter: 'struct2',
        isTrulySuccessful: true,
        userIntent: 'Test intent',
        intentClassification: IntentClassification.ADD_FUNCTIONALITY,
        toolName: MutationToolName.UPDATE_PARTIAL,
        operations: [{ type: 'addNode', node: { name: 'Test', type: 'n8n-nodes-base.set', position: [0, 0] } } as AddNodeOperation],
        operationCount: 1,
        operationTypes: ['addNode'],
        validationBefore: { valid: false, errors: [] },
        validationAfter: { valid: true, errors: [] },
        validationImproved: true,
        errorsResolved: 1,
        errorsIntroduced: 0,
        nodesAdded: 1,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 0,
        connectionsRemoved: 0,
        propertiesChanged: 0,
        mutationSuccess: true,
        mutationError: undefined,
        durationMs: 150
      };

      let capturedData: any = null;
      vi.mocked(mockSupabase.from).mockImplementation((table) => ({
        insert: vi.fn().mockImplementation((data) => {
          if (table === 'workflow_mutations') {
            capturedData = data;
          }
          return Promise.resolve(createMockSupabaseResponse());
        }),
        url: { href: '' },
        headers: {},
        select: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      } as any));

      await batchProcessor.flush(undefined, undefined, [mutation]);

      expect(capturedData).toBeDefined();
      const saved = capturedData[0];

      // Top-level fields should be converted to snake_case
      expect(saved).toHaveProperty('user_id', 'user1');
      expect(saved).toHaveProperty('session_id', 'session1');
      expect(saved).toHaveProperty('workflow_before');
      expect(saved).toHaveProperty('workflow_after');
      expect(saved).toHaveProperty('workflow_hash_before', 'hash1');
      expect(saved).toHaveProperty('workflow_hash_after', 'hash2');
      expect(saved).toHaveProperty('workflow_structure_hash_before', 'struct1');
      expect(saved).toHaveProperty('workflow_structure_hash_after', 'struct2');
      expect(saved).toHaveProperty('is_truly_successful', true);
      expect(saved).toHaveProperty('user_intent', 'Test intent');
      expect(saved).toHaveProperty('intent_classification');
      expect(saved).toHaveProperty('tool_name');
      expect(saved).toHaveProperty('operation_count', 1);
      expect(saved).toHaveProperty('operation_types');
      expect(saved).toHaveProperty('validation_before');
      expect(saved).toHaveProperty('validation_after');
      expect(saved).toHaveProperty('validation_improved', true);
      expect(saved).toHaveProperty('errors_resolved', 1);
      expect(saved).toHaveProperty('errors_introduced', 0);
      expect(saved).toHaveProperty('nodes_added', 1);
      expect(saved).toHaveProperty('nodes_removed', 0);
      expect(saved).toHaveProperty('nodes_modified', 0);
      expect(saved).toHaveProperty('connections_added', 0);
      expect(saved).toHaveProperty('connections_removed', 0);
      expect(saved).toHaveProperty('properties_changed', 0);
      expect(saved).toHaveProperty('mutation_success', true);
      expect(saved).toHaveProperty('duration_ms', 150);
    });
  });
});
