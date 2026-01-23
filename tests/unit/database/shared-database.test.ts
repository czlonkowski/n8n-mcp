import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies at module level
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn()
  }),
  exec: vi.fn(),
  close: vi.fn(),
  pragma: vi.fn(),
  inTransaction: false,
  transaction: vi.fn(),
  checkFTS5Support: vi.fn()
};

vi.mock('../../../src/database/database-adapter', () => ({
  createDatabaseAdapter: vi.fn().mockResolvedValue(mockDb)
}));

vi.mock('../../../src/database/node-repository', () => ({
  NodeRepository: vi.fn().mockImplementation(() => ({
    getNodeTypes: vi.fn().mockReturnValue([])
  }))
}));

vi.mock('../../../src/templates/template-service', () => ({
  TemplateService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../../src/services/enhanced-config-validator', () => ({
  EnhancedConfigValidator: {
    initializeSimilarityServices: vi.fn()
  }
}));

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('Shared Database Module', () => {
  let sharedDbModule: typeof import('../../../src/database/shared-database');
  let createDatabaseAdapter: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockDb.close.mockReset();

    // Reset modules to get fresh state
    vi.resetModules();

    // Import fresh module
    sharedDbModule = await import('../../../src/database/shared-database');

    // Get the mocked function
    const adapterModule = await import('../../../src/database/database-adapter');
    createDatabaseAdapter = adapterModule.createDatabaseAdapter as ReturnType<typeof vi.fn>;
  });

  afterEach(async () => {
    // Clean up any shared state by closing
    try {
      await sharedDbModule.closeSharedDatabase();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('getSharedDatabase', () => {
    it('should initialize database on first call', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');

      expect(state).toBeDefined();
      expect(state.db).toBe(mockDb);
      expect(state.dbPath).toBe('/path/to/db');
      expect(state.refCount).toBe(1);
      expect(state.initialized).toBe(true);
      expect(createDatabaseAdapter).toHaveBeenCalledWith('/path/to/db');
    });

    it('should reuse existing connection and increment refCount', async () => {
      // First call initializes
      const state1 = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(state1.refCount).toBe(1);

      // Second call reuses
      const state2 = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(state2.refCount).toBe(2);

      // Same object
      expect(state1).toBe(state2);

      // Only initialized once
      expect(createDatabaseAdapter).toHaveBeenCalledTimes(1);
    });

    it('should throw error when called with different path', async () => {
      await sharedDbModule.getSharedDatabase('/path/to/db1');

      await expect(sharedDbModule.getSharedDatabase('/path/to/db2'))
        .rejects.toThrow('Shared database already initialized with different path');
    });

    it('should handle concurrent initialization requests', async () => {
      // Start two requests concurrently
      const [state1, state2] = await Promise.all([
        sharedDbModule.getSharedDatabase('/path/to/db'),
        sharedDbModule.getSharedDatabase('/path/to/db')
      ]);

      // Both should get the same state
      expect(state1).toBe(state2);

      // RefCount should be 2 (one for each call)
      expect(state1.refCount).toBe(2);

      // Only one actual initialization
      expect(createDatabaseAdapter).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization failure', async () => {
      createDatabaseAdapter.mockRejectedValueOnce(new Error('DB error'));

      await expect(sharedDbModule.getSharedDatabase('/path/to/db'))
        .rejects.toThrow('DB error');

      // After failure, should not be initialized
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);
    });

    it('should allow retry after initialization failure', async () => {
      // First call fails
      createDatabaseAdapter.mockRejectedValueOnce(new Error('DB error'));
      await expect(sharedDbModule.getSharedDatabase('/path/to/db'))
        .rejects.toThrow('DB error');

      // Reset mock for successful call
      createDatabaseAdapter.mockResolvedValueOnce(mockDb);

      // Second call succeeds
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');

      expect(state).toBeDefined();
      expect(state.initialized).toBe(true);
    });
  });

  describe('releaseSharedDatabase', () => {
    it('should decrement refCount', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(state.refCount).toBe(1);

      sharedDbModule.releaseSharedDatabase(state);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
    });

    it('should not decrement below 0', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');

      // Release once (refCount: 1 -> 0)
      sharedDbModule.releaseSharedDatabase(state);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);

      // Release again (should stay at 0, not go negative)
      sharedDbModule.releaseSharedDatabase(state);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
    });

    it('should handle null state gracefully', () => {
      // Should not throw
      sharedDbModule.releaseSharedDatabase(null as any);
    });

    it('should not close database when refCount hits 0', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');
      sharedDbModule.releaseSharedDatabase(state);

      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
      expect(mockDb.close).not.toHaveBeenCalled();

      // Database should still be accessible
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(true);
    });
  });

  describe('closeSharedDatabase', () => {
    it('should close database and clear state', async () => {
      // Get state
      await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(true);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(1);

      await sharedDbModule.closeSharedDatabase();

      // State should be cleared
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
    });

    it('should handle close error gracefully', async () => {
      await sharedDbModule.getSharedDatabase('/path/to/db');
      mockDb.close.mockImplementationOnce(() => {
        throw new Error('Close error');
      });

      // Should not throw
      await sharedDbModule.closeSharedDatabase();

      // State should still be cleared
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);
    });

    it('should be idempotent when already closed', async () => {
      // Close without ever initializing
      await sharedDbModule.closeSharedDatabase();

      // Should not throw
      await sharedDbModule.closeSharedDatabase();
    });

    it('should allow re-initialization after close', async () => {
      // Initialize
      const state1 = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(state1.refCount).toBe(1);

      // Close
      await sharedDbModule.closeSharedDatabase();
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);

      // Re-initialize
      const state2 = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(state2.refCount).toBe(1);
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(true);

      // Should be a new state object
      expect(state1).not.toBe(state2);
    });
  });

  describe('isSharedDatabaseInitialized', () => {
    it('should return false before initialization', () => {
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(true);
    });

    it('should return false after close', async () => {
      await sharedDbModule.getSharedDatabase('/path/to/db');
      await sharedDbModule.closeSharedDatabase();
      expect(sharedDbModule.isSharedDatabaseInitialized()).toBe(false);
    });
  });

  describe('getSharedDatabaseRefCount', () => {
    it('should return 0 before initialization', () => {
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
    });

    it('should return correct refCount after multiple operations', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(1);

      await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(2);

      await sharedDbModule.getSharedDatabase('/path/to/db');
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(3);

      sharedDbModule.releaseSharedDatabase(state);
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(2);
    });

    it('should return 0 after close', async () => {
      await sharedDbModule.getSharedDatabase('/path/to/db');
      await sharedDbModule.closeSharedDatabase();
      expect(sharedDbModule.getSharedDatabaseRefCount()).toBe(0);
    });
  });

  describe('SharedDatabaseState interface', () => {
    it('should expose correct properties', async () => {
      const state = await sharedDbModule.getSharedDatabase('/path/to/db');

      expect(state).toHaveProperty('db');
      expect(state).toHaveProperty('repository');
      expect(state).toHaveProperty('templateService');
      expect(state).toHaveProperty('dbPath');
      expect(state).toHaveProperty('refCount');
      expect(state).toHaveProperty('initialized');
    });
  });
});
