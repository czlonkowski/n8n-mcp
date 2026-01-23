/**
 * Shared Database Manager - Singleton for cross-session database connection
 *
 * This module implements a singleton pattern to share a single database connection
 * across all MCP server sessions. This prevents memory leaks caused by each session
 * creating its own database connection (~900MB per session).
 *
 * Memory impact: Reduces per-session memory from ~900MB to near-zero by sharing
 * a single ~68MB database connection across all sessions.
 *
 * Issue: https://github.com/czlonkowski/n8n-mcp/issues/XXX
 */

import { DatabaseAdapter, createDatabaseAdapter } from './database-adapter';
import { NodeRepository } from './node-repository';
import { TemplateService } from '../templates/template-service';
import { EnhancedConfigValidator } from '../services/enhanced-config-validator';
import { logger } from '../utils/logger';

/**
 * Shared database state - holds the singleton connection and services
 */
export interface SharedDatabaseState {
  db: DatabaseAdapter;
  repository: NodeRepository;
  templateService: TemplateService;
  dbPath: string;
  refCount: number;
  initialized: boolean;
}

// Module-level singleton state
let sharedState: SharedDatabaseState | null = null;
let initializationPromise: Promise<SharedDatabaseState> | null = null;

/**
 * Get or create the shared database connection
 *
 * Thread-safe initialization using a promise lock pattern.
 * Multiple concurrent calls will wait for the same initialization.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns Shared database state with connection and services
 */
export async function getSharedDatabase(dbPath: string): Promise<SharedDatabaseState> {
  // If already initialized with the same path, increment ref count and return
  if (sharedState && sharedState.initialized && sharedState.dbPath === dbPath) {
    sharedState.refCount++;
    logger.debug('Reusing shared database connection', {
      refCount: sharedState.refCount,
      dbPath
    });
    return sharedState;
  }

  // If already initialized with a DIFFERENT path, this is a configuration error
  if (sharedState && sharedState.initialized && sharedState.dbPath !== dbPath) {
    logger.error('Attempted to initialize shared database with different path', {
      existingPath: sharedState.dbPath,
      requestedPath: dbPath
    });
    throw new Error(`Shared database already initialized with different path: ${sharedState.dbPath}`);
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    try {
      const state = await initializationPromise;
      state.refCount++;
      logger.debug('Reusing shared database (waited for init)', {
        refCount: state.refCount,
        dbPath
      });
      return state;
    } catch (error) {
      // Initialization failed while we were waiting, clear promise and rethrow
      initializationPromise = null;
      throw error;
    }
  }

  // Start new initialization
  initializationPromise = initializeSharedDatabase(dbPath);

  try {
    const state = await initializationPromise;
    // Clear the promise on success to allow future re-initialization after close
    initializationPromise = null;
    return state;
  } catch (error) {
    // Clear promise on failure to allow retry
    initializationPromise = null;
    throw error;
  }
}

/**
 * Initialize the shared database connection and services
 */
async function initializeSharedDatabase(dbPath: string): Promise<SharedDatabaseState> {
  logger.info('Initializing shared database connection', { dbPath });

  const db = await createDatabaseAdapter(dbPath);
  const repository = new NodeRepository(db);
  const templateService = new TemplateService(db);

  // Initialize similarity services for enhanced validation
  EnhancedConfigValidator.initializeSimilarityServices(repository);

  sharedState = {
    db,
    repository,
    templateService,
    dbPath,
    refCount: 1,
    initialized: true
  };

  logger.info('Shared database initialized successfully', {
    dbPath,
    refCount: sharedState.refCount
  });

  return sharedState;
}

/**
 * Release a reference to the shared database
 *
 * Decrements the reference count. Does NOT close the database
 * as it's shared across all sessions for the lifetime of the process.
 *
 * @param state - The shared database state to release
 */
export function releaseSharedDatabase(state: SharedDatabaseState): void {
  if (!state || !sharedState) {
    return;
  }

  // Guard against double-release (refCount going negative)
  if (sharedState.refCount <= 0) {
    logger.warn('Attempted to release shared database with refCount already at or below 0', {
      refCount: sharedState.refCount
    });
    return;
  }

  sharedState.refCount--;
  logger.debug('Released shared database reference', {
    refCount: sharedState.refCount
  });

  // Note: We intentionally do NOT close the database even when refCount hits 0
  // The database should remain open for the lifetime of the process to handle
  // new sessions. Only process shutdown should close it.
}

/**
 * Force close the shared database (for graceful shutdown only)
 *
 * This should only be called during process shutdown, not during normal
 * session cleanup. Closing the database would break other active sessions.
 */
export async function closeSharedDatabase(): Promise<void> {
  if (!sharedState) {
    return;
  }

  logger.info('Closing shared database connection', {
    refCount: sharedState.refCount
  });

  try {
    sharedState.db.close();
  } catch (error) {
    logger.warn('Error closing shared database', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  sharedState = null;
  initializationPromise = null;
}

/**
 * Check if shared database is initialized
 */
export function isSharedDatabaseInitialized(): boolean {
  return sharedState !== null && sharedState.initialized;
}

/**
 * Get current reference count (for debugging/monitoring)
 */
export function getSharedDatabaseRefCount(): number {
  return sharedState?.refCount ?? 0;
}
