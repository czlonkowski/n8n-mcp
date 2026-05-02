import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import type { DatabaseAdapter } from '../../../src/database/database-adapter';

/**
 * Configuration options for creating test databases
 */
export interface TestDatabaseOptions {
  /** Database mode - in-memory for fast tests, file for persistence tests */
  mode: 'memory' | 'file';
  /** Custom database filename (only for file mode) */
  name?: string;
  /** Enable Write-Ahead Logging for better concurrency (file mode only) */
  enableWAL?: boolean;
  /** Enable FTS5 full-text search extension */
  enableFTS5?: boolean;
}

/**
 * Test database utility for creating isolated database instances for testing.
 * Provides automatic schema setup, cleanup, and various helper methods.
 * 
 * @example
 * ```typescript
 * // Create in-memory database for unit tests
 * const testDb = await TestDatabase.createIsolated({ mode: 'memory' });
 * const db = testDb.getDatabase();
 * // ... run tests
 * await testDb.cleanup();
 * 
 * // Create file-based database for integration tests
 * const testDb = await TestDatabase.createIsolated({ 
 *   mode: 'file',
 *   enableWAL: true 
 * });
 * ```
 */
export class TestDatabase {
  private db: Database.Database | null = null;
  private dbPath?: string;
  private options: TestDatabaseOptions;

  constructor(options: TestDatabaseOptions = { mode: 'memory' }) {
    this.options = options;
  }

  /**
   * Creates an isolated test database instance with automatic cleanup.
   * Each instance gets a unique name to prevent conflicts in parallel tests.
   * 
   * @param options - Database configuration options
   * @returns Promise resolving to initialized TestDatabase instance
   */
  static async createIsolated(options: TestDatabaseOptions = { mode: 'memory' }): Promise<TestDatabase> {
    const testDb = new TestDatabase({
      ...options,
      name: options.name || `isolated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`
    });
    await testDb.initialize();
    return testDb;
  }

  async initialize(): Promise<Database.Database> {
    if (this.db) return this.db;

    if (this.options.mode === 'file') {
      const testDir = path.join(__dirname, '../../../.test-dbs');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      this.dbPath = path.join(testDir, this.options.name || `test-${Date.now()}.db`);
      this.db = new Database(this.dbPath);
    } else {
      this.db = new Database(':memory:');
    }

    // Enable WAL mode for file databases
    if (this.options.mode === 'file' && this.options.enableWAL !== false) {
      this.db.exec('PRAGMA journal_mode = WAL');
    }

    // Load FTS5 extension if requested
    if (this.options.enableFTS5) {
      // FTS5 is built into SQLite by default in better-sqlite3
      try {
        this.db.exec('CREATE VIRTUAL TABLE test_fts USING fts5(content)');
        this.db.exec('DROP TABLE test_fts');
      } catch (error) {
        throw new Error('FTS5 extension not available');
      }
    }

    // Apply schema
    await this.applySchema();

    return this.db;
  }

  private async applySchema(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const schemaPath = path.join(__dirname, '../../../src/database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Parse SQL statements properly (handles BEGIN...END blocks in triggers)
    const statements = this.parseSQLStatements(schema);

    for (const statement of statements) {
      this.db.exec(statement);
    }
  }

  /**
   * Parse SQL statements from schema file, properly handling multi-line statements
   * including triggers with BEGIN...END blocks
   */
  private parseSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inBlock = false;

    const lines = sql.split('\n');

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();

      // Skip comments and empty lines
      if (trimmed.startsWith('--') || trimmed === '') {
        continue;
      }

      // Track BEGIN...END blocks (triggers, procedures)
      if (trimmed.includes('BEGIN')) {
        inBlock = true;
      }

      current += line + '\n';

      // End of block (trigger/procedure)
      if (inBlock && trimmed === 'END;') {
        statements.push(current.trim());
        current = '';
        inBlock = false;
        continue;
      }

      // Regular statement end (not in block)
      if (!inBlock && trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }

    // Add any remaining content
    if (current.trim()) {
      statements.push(current.trim());
    }

    return statements.filter(s => s.length > 0);
  }

  /**
   * Gets the underlying better-sqlite3 database instance.
   * @throws Error if database is not initialized
   * @returns The database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  /**
   * Cleans up the database connection and removes any created files.
   * Should be called in afterEach/afterAll hooks to prevent resource leaks.
   */
  async cleanup(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (this.dbPath && fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
      // Also remove WAL and SHM files if they exist
      const walPath = `${this.dbPath}-wal`;
      const shmPath = `${this.dbPath}-shm`;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    }
  }

  /**
   * Checks if the database is currently locked by another process.
   * Useful for testing concurrent access scenarios.
   * 
   * @returns true if database is locked, false otherwise
   */
  isLocked(): boolean {
    if (!this.db) return false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec('ROLLBACK');
      return false;
    } catch (error: any) {
      return error.code === 'SQLITE_BUSY';
    }
  }
}

/**
 * Performance monitoring utility for measuring test execution times.
 * Collects timing data and provides statistical analysis.
 * 
 * @example
 * ```typescript
 * const monitor = new PerformanceMonitor();
 * 
 * // Measure single operation
 * const stop = monitor.start('database-query');
 * await db.query('SELECT * FROM nodes');
 * stop();
 * 
 * // Get statistics
 * const stats = monitor.getStats('database-query');
 * console.log(`Average: ${stats.average}ms`);
 * ```
 */
export class PerformanceMonitor {
  private measurements: Map<string, number[]> = new Map();

  /**
   * Starts timing for a labeled operation.
   * Returns a function that should be called to stop timing.
   * 
   * @param label - Unique label for the operation being measured
   * @returns Stop function to call when operation completes
   */
  start(label: string): () => void {
    const startTime = process.hrtime.bigint();
    return () => {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
      
      if (!this.measurements.has(label)) {
        this.measurements.set(label, []);
      }
      this.measurements.get(label)!.push(duration);
    };
  }

  /**
   * Gets statistical analysis of all measurements for a given label.
   * 
   * @param label - The operation label to get stats for
   * @returns Statistics object or null if no measurements exist
   */
  getStats(label: string): {
    count: number;
    total: number;
    average: number;
    min: number;
    max: number;
    median: number;
  } | null {
    const durations = this.measurements.get(label);
    if (!durations || durations.length === 0) return null;

    const sorted = [...durations].sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);

    return {
      count: durations.length,
      total,
      average: total / durations.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)]
    };
  }

  /**
   * Clears all collected measurements.
   */
  clear(): void {
    this.measurements.clear();
  }
}

/**
 * Test data generator for creating mock nodes, templates, and other test objects.
 * Provides consistent test data with sensible defaults and easy customization.
 */
export class TestDataGenerator {
  /**
   * Monotonic counter for unique template ids. `Math.random()` over a small range
   * (the original generator used 0..100000) collides via the birthday paradox
   * when callers generate hundreds of rows, producing UNIQUE-constraint flakes
   * in CI on tables that key off `workflow_id`.
   */
  private static templateIdCounter = 100_000;

  /**
   * Resets the monotonic template id counter. Call from a `beforeEach` if a test
   * needs deterministic ids across runs.
   */
  static resetTemplateIds(start = 100_000): void {
    this.templateIdCounter = start;
  }

  /**
   * Generates a mock node object with default values and custom overrides.
   * 
   * @param overrides - Properties to override in the generated node
   * @returns Complete node object suitable for testing
   * 
   * @example
   * ```typescript
   * const node = TestDataGenerator.generateNode({
   *   displayName: 'Custom Node',
   *   isAITool: true
   * });
   * ```
   */
  static generateNode(overrides: any = {}): any {
    const nodeName = overrides.name || `testNode${Math.random().toString(36).substr(2, 9)}`;
    return {
      nodeType: overrides.nodeType || `n8n-nodes-base.${nodeName}`,
      packageName: overrides.packageName || overrides.package || 'n8n-nodes-base',
      displayName: overrides.displayName || 'Test Node',
      description: overrides.description || 'A test node for integration testing',
      category: overrides.category || 'automation',
      developmentStyle: overrides.developmentStyle || overrides.style || 'programmatic',
      isAITool: overrides.isAITool || false,
      isTrigger: overrides.isTrigger || false,
      isWebhook: overrides.isWebhook || false,
      isVersioned: overrides.isVersioned !== undefined ? overrides.isVersioned : true,
      version: overrides.version || '1',
      documentation: overrides.documentation || null,
      properties: overrides.properties || [],
      operations: overrides.operations || [],
      credentials: overrides.credentials || [],
      ...overrides
    };
  }

  /**
   * Generates multiple nodes with sequential naming.
   * 
   * @param count - Number of nodes to generate
   * @param template - Common properties to apply to all nodes
   * @returns Array of generated nodes
   */
  static generateNodes(count: number, template: any = {}): any[] {
    return Array.from({ length: count }, (_, i) => 
      this.generateNode({
        ...template,
        name: `testNode${i}`,
        displayName: `Test Node ${i}`,
        nodeType: `n8n-nodes-base.testNode${i}`
      })
    );
  }

  /**
   * Generates a mock workflow template.
   * 
   * @param overrides - Properties to override in the template
   * @returns Template object suitable for testing
   */
  static generateTemplate(overrides: any = {}): any {
    return {
      id: ++TestDataGenerator.templateIdCounter,
      name: `Test Workflow ${Math.random().toString(36).substr(2, 9)}`,
      totalViews: Math.floor(Math.random() * 1000),
      nodeTypes: ['n8n-nodes-base.webhook', 'n8n-nodes-base.httpRequest'],
      categories: [{ id: 1, name: 'automation' }],
      description: 'A test workflow template',
      workflowInfo: {
        nodeCount: 5,
        webhookCount: 1
      },
      ...overrides
    };
  }

  /**
   * Generates multiple workflow templates.
   * 
   * @param count - Number of templates to generate
   * @returns Array of template objects
   */
  static generateTemplates(count: number): any[] {
    return Array.from({ length: count }, () => this.generateTemplate());
  }
}

/**
 * Runs a function within a database transaction with automatic rollback on error.
 * Useful for testing transactional behavior and ensuring test isolation.
 * 
 * @param db - Database instance
 * @param fn - Function to run within transaction
 * @returns Promise resolving to function result
 * @throws Rolls back transaction and rethrows any errors
 * 
 * @example
 * ```typescript
 * await runInTransaction(db, () => {
 *   db.prepare('INSERT INTO nodes ...').run();
 *   db.prepare('UPDATE nodes ...').run();
 *   // If any operation fails, all are rolled back
 * });
 * ```
 */
export async function runInTransaction<T>(
  db: Database.Database,
  fn: () => T
): Promise<T> {
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Simulates concurrent database access using worker processes.
 * Useful for testing database locking and concurrency handling.
 * 
 * @param dbPath - Path to the database file
 * @param workerCount - Number of concurrent workers to spawn
 * @param operations - Number of operations each worker should perform
 * @param workerScript - JavaScript code to execute in each worker
 * @returns Results with success/failure counts and total duration
 * 
 * @example
 * ```typescript
 * const results = await simulateConcurrentAccess(
 *   dbPath,
 *   10, // 10 workers
 *   100, // 100 operations each
 *   `
 *     const db = require('better-sqlite3')(process.env.DB_PATH);
 *     for (let i = 0; i < process.env.OPERATIONS; i++) {
 *       db.prepare('INSERT INTO test VALUES (?)').run(i);
 *     }
 *   `
 * );
 * ```
 */
export async function simulateConcurrentAccess(
  dbPath: string,
  workerCount: number,
  operations: number,
  workerScript: string
): Promise<{ success: number; failed: number; duration: number }> {
  const startTime = Date.now();
  const results = { success: 0, failed: 0 };

  // Create worker processes
  const workers = Array.from({ length: workerCount }, (_, i) => {
    return new Promise<void>((resolve) => {
      try {
        const output = execSync(
          `node -e "${workerScript}"`,
          {
            env: {
              ...process.env,
              DB_PATH: dbPath,
              WORKER_ID: i.toString(),
              OPERATIONS: operations.toString()
            }
          }
        );
        results.success++;
      } catch (error) {
        results.failed++;
      }
      resolve();
    });
  });

  await Promise.all(workers);

  return {
    ...results,
    duration: Date.now() - startTime
  };
}

/**
 * Performs comprehensive database integrity checks including foreign keys and schema.
 * 
 * @param db - Database instance to check
 * @returns Object with validation status and any error messages
 * 
 * @example
 * ```typescript
 * const integrity = checkDatabaseIntegrity(db);
 * if (!integrity.isValid) {
 *   console.error('Database issues:', integrity.errors);
 * }
 * ```
 */
export function checkDatabaseIntegrity(db: Database.Database): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    // Run integrity check
    const result = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    if (result.length !== 1 || result[0].integrity_check !== 'ok') {
      errors.push('Database integrity check failed');
    }

    // Check foreign key constraints
    const fkResult = db.prepare('PRAGMA foreign_key_check').all();
    if (fkResult.length > 0) {
      errors.push(`Foreign key violations: ${JSON.stringify(fkResult)}`);
    }

    // Check table existence
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type = 'table' AND name = 'nodes'
    `).all();
    
    if (tables.length === 0) {
      errors.push('nodes table does not exist');
    }

  } catch (error: any) {
    errors.push(`Integrity check error: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Creates a DatabaseAdapter interface from a better-sqlite3 instance.
 * This adapter provides a consistent interface for database operations across the codebase.
 * 
 * @param db - better-sqlite3 database instance
 * @returns DatabaseAdapter implementation
 * 
 * @example
 * ```typescript
 * const db = new Database(':memory:');
 * const adapter = createTestDatabaseAdapter(db);
 * const stmt = adapter.prepare('SELECT * FROM nodes WHERE type = ?');
 * const nodes = stmt.all('webhook');
 * ```
 */
export function createTestDatabaseAdapter(db: Database.Database): DatabaseAdapter {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: any[]) => stmt.run(...params),
        get: (...params: any[]) => stmt.get(...params),
        all: (...params: any[]) => stmt.all(...params),
        iterate: (...params: any[]) => stmt.iterate(...params),
        pluck: function(enabled?: boolean) { stmt.pluck(enabled); return this; },
        expand: function(enabled?: boolean) { stmt.expand?.(enabled); return this; },
        raw: function(enabled?: boolean) { stmt.raw?.(enabled); return this; },
        columns: () => stmt.columns?.() || [],
        bind: function(...params: any[]) { stmt.bind(...params); return this; }
      } as any;
    },
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
    pragma: (key: string, value?: any) => db.pragma(key, value),
    get inTransaction() { return db.inTransaction; },
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    checkFTS5Support: () => {
      try {
        db.exec('CREATE VIRTUAL TABLE test_fts5_check USING fts5(content)');
        db.exec('DROP TABLE test_fts5_check');
        return true;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Pre-configured mock nodes for common testing scenarios.
 * These represent the most commonly used n8n nodes with realistic configurations.
 */
export const MOCK_NODES = {
  webhook: {
    nodeType: 'n8n-nodes-base.webhook',
    packageName: 'n8n-nodes-base',
    displayName: 'Webhook',
    description: 'Starts the workflow when a webhook is called',
    category: 'trigger',
    developmentStyle: 'programmatic',
    isAITool: false,
    isTrigger: true,
    isWebhook: true,
    isVersioned: true,
    version: '1',
    documentation: 'Webhook documentation',
    properties: [
      {
        displayName: 'HTTP Method',
        name: 'httpMethod',
        type: 'options',
        options: [
          { name: 'GET', value: 'GET' },
          { name: 'POST', value: 'POST' }
        ],
        default: 'GET'
      }
    ],
    operations: [],
    credentials: []
  },
  httpRequest: {
    nodeType: 'n8n-nodes-base.httpRequest',
    packageName: 'n8n-nodes-base',
    displayName: 'HTTP Request',
    description: 'Makes an HTTP request and returns the response',
    category: 'automation',
    developmentStyle: 'programmatic',
    isAITool: false,
    isTrigger: false,
    isWebhook: false,
    isVersioned: true,
    version: '1',
    documentation: 'HTTP Request documentation',
    properties: [
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        required: true,
        default: ''
      }
    ],
    operations: [],
    credentials: []
  }
};