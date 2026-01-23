import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

/**
 * Unified database interface that abstracts better-sqlite3 and sql.js
 */
export interface DatabaseAdapter {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  close(): void;
  pragma(key: string, value?: any): any;
  readonly inTransaction: boolean;
  transaction<T>(fn: () => T): T;
  checkFTS5Support(): boolean;
}

export interface PreparedStatement {
  run(...params: any[]): RunResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
  iterate(...params: any[]): IterableIterator<any>;
  pluck(toggle?: boolean): this;
  expand(toggle?: boolean): this;
  raw(toggle?: boolean): this;
  columns(): ColumnDefinition[];
  bind(...params: any[]): this;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface ColumnDefinition {
  name: string;
  column: string | null;
  table: string | null;
  database: string | null;
  type: string | null;
}

/**
 * Factory function to create a database adapter
 * Tries better-sqlite3 first, falls back to sql.js if needed
 */
export async function createDatabaseAdapter(dbPath: string): Promise<DatabaseAdapter> {
  // Log Node.js version information
  // Only log in non-stdio mode
  if (process.env.MCP_MODE !== 'stdio') {
    logger.info(`Node.js version: ${process.version}`);
  }
  // Only log in non-stdio mode
  if (process.env.MCP_MODE !== 'stdio') {
    logger.info(`Platform: ${process.platform} ${process.arch}`);
  }
  
  // First, try to use better-sqlite3
  try {
    if (process.env.MCP_MODE !== 'stdio') {
      logger.info('Attempting to use better-sqlite3...');
    }
    const adapter = await createBetterSQLiteAdapter(dbPath);
    if (process.env.MCP_MODE !== 'stdio') {
      logger.info('Successfully initialized better-sqlite3 adapter');
    }
    return adapter;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check if it's a version mismatch error
    if (errorMessage.includes('NODE_MODULE_VERSION') || errorMessage.includes('was compiled against a different Node.js version')) {
      if (process.env.MCP_MODE !== 'stdio') {
        logger.warn(`Node.js version mismatch detected. Better-sqlite3 was compiled for a different Node.js version.`);
      }
      if (process.env.MCP_MODE !== 'stdio') {
        logger.warn(`Current Node.js version: ${process.version}`);
      }
    }
    
    if (process.env.MCP_MODE !== 'stdio') {
      logger.warn('Failed to initialize better-sqlite3, falling back to sql.js', error);
    }
    
    // Fall back to sql.js
    try {
      const adapter = await createSQLJSAdapter(dbPath);
      if (process.env.MCP_MODE !== 'stdio') {
        logger.info('Successfully initialized sql.js adapter (pure JavaScript, no native dependencies)');
      }
      return adapter;
    } catch (sqlJsError) {
      if (process.env.MCP_MODE !== 'stdio') {
        logger.error('Failed to initialize sql.js adapter', sqlJsError);
      }
      throw new Error('Failed to initialize any database adapter');
    }
  }
}

/**
 * Create better-sqlite3 adapter
 */
async function createBetterSQLiteAdapter(dbPath: string): Promise<DatabaseAdapter> {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    
    return new BetterSQLiteAdapter(db);
  } catch (error) {
    throw new Error(`Failed to create better-sqlite3 adapter: ${error}`);
  }
}

/**
 * Create sql.js adapter with persistence
 */
async function createSQLJSAdapter(dbPath: string): Promise<DatabaseAdapter> {
  let initSqlJs;
  try {
    initSqlJs = require('sql.js');
  } catch (error) {
    logger.error('Failed to load sql.js module:', error);
    throw new Error('sql.js module not found. This might be an issue with npm package installation.');
  }
  
  // Initialize sql.js
  const SQL = await initSqlJs({
    // This will look for the wasm file in node_modules
    locateFile: (file: string) => {
      if (file.endsWith('.wasm')) {
        // Try multiple paths to find the WASM file
        const possiblePaths = [
          // Local development path
          path.join(__dirname, '../../node_modules/sql.js/dist/', file),
          // When installed as npm package
          path.join(__dirname, '../../../sql.js/dist/', file),
          // Alternative npm package path
          path.join(process.cwd(), 'node_modules/sql.js/dist/', file),
          // Try to resolve from require
          path.join(path.dirname(require.resolve('sql.js')), '../dist/', file)
        ];
        
        // Find the first existing path
        for (const tryPath of possiblePaths) {
          if (fsSync.existsSync(tryPath)) {
            if (process.env.MCP_MODE !== 'stdio') {
              logger.debug(`Found WASM file at: ${tryPath}`);
            }
            return tryPath;
          }
        }
        
        // If not found, try the last resort - require.resolve
        try {
          const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
          if (process.env.MCP_MODE !== 'stdio') {
            logger.debug(`Found WASM file via require.resolve: ${wasmPath}`);
          }
          return wasmPath;
        } catch (e) {
          // Fall back to the default path
          logger.warn(`Could not find WASM file, using default path: ${file}`);
          return file;
        }
      }
      return file;
    }
  });
  
  // Try to load existing database
  let db: any;
  try {
    const data = await fs.readFile(dbPath);
    db = new SQL.Database(new Uint8Array(data));
    logger.info(`Loaded existing database from ${dbPath}`);
  } catch (error) {
    // Create new database if file doesn't exist
    db = new SQL.Database();
    logger.info(`Created new database at ${dbPath}`);
  }
  
  return new SQLJSAdapter(db, dbPath);
}

/**
 * Adapter for better-sqlite3
 */
class BetterSQLiteAdapter implements DatabaseAdapter {
  constructor(private db: any) {}
  
  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return new BetterSQLiteStatement(stmt);
  }
  
  exec(sql: string): void {
    this.db.exec(sql);
  }
  
  close(): void {
    this.db.close();
  }
  
  pragma(key: string, value?: any): any {
    return this.db.pragma(key, value);
  }
  
  get inTransaction(): boolean {
    return this.db.inTransaction;
  }
  
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  
  checkFTS5Support(): boolean {
    try {
      // Test if FTS5 is available
      this.exec("CREATE VIRTUAL TABLE IF NOT EXISTS test_fts5 USING fts5(content);");
      this.exec("DROP TABLE IF EXISTS test_fts5;");
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Adapter for sql.js with persistence
 */
class SQLJSAdapter implements DatabaseAdapter {
  private saveTimer: NodeJS.Timeout | null = null;
  private saveIntervalMs: number;
  private closed = false; // Prevent multiple close() calls

  // Default save interval: 5 seconds (balance between data safety and performance)
  // Configurable via SQLJS_SAVE_INTERVAL_MS environment variable
  //
  // DATA LOSS WINDOW: Up to 5 seconds of database changes may be lost if process
  // crashes before scheduleSave() timer fires. This is acceptable because:
  // 1. close() calls saveToFile() immediately on graceful shutdown
  // 2. Docker/Kubernetes SIGTERM provides 30s for cleanup (more than enough)
  // 3. The alternative (100ms interval) caused 2.2GB memory leaks in production
  // 4. MCP server is primarily read-heavy (writes are rare)
  private static readonly DEFAULT_SAVE_INTERVAL_MS = 5000;

  constructor(private db: any, private dbPath: string) {
    // Read save interval from environment or use default
    const envInterval = process.env.SQLJS_SAVE_INTERVAL_MS;
    this.saveIntervalMs = envInterval ? parseInt(envInterval, 10) : SQLJSAdapter.DEFAULT_SAVE_INTERVAL_MS;

    // Validate interval (minimum 100ms, maximum 60000ms = 1 minute)
    if (isNaN(this.saveIntervalMs) || this.saveIntervalMs < 100 || this.saveIntervalMs > 60000) {
      logger.warn(
        `Invalid SQLJS_SAVE_INTERVAL_MS value: ${envInterval} (must be 100-60000ms), ` +
        `using default ${SQLJSAdapter.DEFAULT_SAVE_INTERVAL_MS}ms`
      );
      this.saveIntervalMs = SQLJSAdapter.DEFAULT_SAVE_INTERVAL_MS;
    }

    logger.debug(`SQLJSAdapter initialized with save interval: ${this.saveIntervalMs}ms`);

    // NOTE: No initial save scheduled here (optimization)
    // Database is either:
    // 1. Loaded from existing file (already persisted), or
    // 2. New database (will be saved on first write operation)
  }
  
  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    // Don't schedule save on prepare - only on actual writes (via SQLJSStatement.run())
    return new SQLJSStatement(stmt, () => this.scheduleSave());
  }
  
  exec(sql: string): void {
    this.db.exec(sql);
    this.scheduleSave();
  }
  
  close(): void {
    if (this.closed) {
      logger.debug('SQLJSAdapter already closed, skipping');
      return;
    }

    this.saveToFile();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.db.close();
    this.closed = true;
  }
  
  pragma(key: string, value?: any): any {
    // sql.js doesn't support pragma in the same way
    // We'll handle specific pragmas as needed
    if (key === 'journal_mode' && value === 'WAL') {
      // WAL mode not supported in sql.js, ignore
      return 'memory';
    }
    return null;
  }
  
  get inTransaction(): boolean {
    // sql.js doesn't expose transaction state
    return false;
  }
  
  transaction<T>(fn: () => T): T {
    // Simple transaction implementation for sql.js
    try {
      this.exec('BEGIN');
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      this.exec('ROLLBACK');
      throw error;
    }
  }
  
  checkFTS5Support(): boolean {
    try {
      // Test if FTS5 is available
      this.exec("CREATE VIRTUAL TABLE IF NOT EXISTS test_fts5 USING fts5(content);");
      this.exec("DROP TABLE IF EXISTS test_fts5;");
      return true;
    } catch (error) {
      // sql.js doesn't support FTS5
      return false;
    }
  }
  
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Save after configured interval of inactivity (default: 5000ms)
    // This debouncing reduces memory churn from frequent buffer allocations
    //
    // NOTE: Under constant write load, saves may be delayed until writes stop.
    // This is acceptable because:
    // 1. MCP server is primarily read-heavy (node lookups, searches)
    // 2. Writes are rare (only during database rebuilds)
    // 3. close() saves immediately on shutdown, flushing any pending changes
    this.saveTimer = setTimeout(() => {
      this.saveToFile();
    }, this.saveIntervalMs);
  }
  
  private saveToFile(): void {
    try {
      // Export database to Uint8Array (2-5MB typical)
      const data = this.db.export();

      // Write directly without Buffer.from() copy (saves 50% memory allocation)
      // writeFileSync accepts Uint8Array directly, no need for Buffer conversion
      fsSync.writeFileSync(this.dbPath, data);
      logger.debug(`Database saved to ${this.dbPath}`);

      // Note: 'data' reference is automatically cleared when function exits
      // V8 GC will reclaim the Uint8Array once it's no longer referenced
    } catch (error) {
      logger.error('Failed to save database', error);
    }
  }
}

/**
 * Statement wrapper for better-sqlite3
 */
class BetterSQLiteStatement implements PreparedStatement {
  constructor(private stmt: any) {}
  
  run(...params: any[]): RunResult {
    return this.stmt.run(...params);
  }
  
  get(...params: any[]): any {
    return this.stmt.get(...params);
  }
  
  all(...params: any[]): any[] {
    return this.stmt.all(...params);
  }
  
  iterate(...params: any[]): IterableIterator<any> {
    return this.stmt.iterate(...params);
  }
  
  pluck(toggle?: boolean): this {
    this.stmt.pluck(toggle);
    return this;
  }
  
  expand(toggle?: boolean): this {
    this.stmt.expand(toggle);
    return this;
  }
  
  raw(toggle?: boolean): this {
    this.stmt.raw(toggle);
    return this;
  }
  
  columns(): ColumnDefinition[] {
    return this.stmt.columns();
  }
  
  bind(...params: any[]): this {
    this.stmt.bind(...params);
    return this;
  }
}

/**
 * Statement wrapper for sql.js
 *
 * IMPORTANT: sql.js requires explicit memory management via Statement.free().
 * This wrapper automatically frees statement memory after each operation
 * to prevent memory leaks during sustained traffic.
 *
 * See: https://sql.js.org/documentation/Statement.html
 * "After calling db.prepare() you must manually free the assigned memory
 *  by calling Statement.free()."
 */
class SQLJSStatement implements PreparedStatement {
  private boundParams: any = null;
  private freed: boolean = false;

  constructor(private stmt: any, private onModify: () => void) {}

  /**
   * Free the underlying sql.js statement memory.
   * Safe to call multiple times - subsequent calls are no-ops.
   */
  private freeStatement(): void {
    if (!this.freed && this.stmt) {
      try {
        this.stmt.free();
        this.freed = true;
      } catch (e) {
        // Statement may already be freed or invalid - ignore
      }
    }
  }

  run(...params: any[]): RunResult {
    try {
      if (params.length > 0) {
        this.bindParams(params);
        if (this.boundParams) {
          this.stmt.bind(this.boundParams);
        }
      }

      this.stmt.run();
      this.onModify();

      // sql.js doesn't provide changes/lastInsertRowid easily
      return {
        changes: 1, // Assume success means 1 change
        lastInsertRowid: 0
      };
    } catch (error) {
      this.stmt.reset();
      throw error;
    } finally {
      // Free statement memory after write operation completes
      this.freeStatement();
    }
  }

  get(...params: any[]): any {
    try {
      if (params.length > 0) {
        this.bindParams(params);
        if (this.boundParams) {
          this.stmt.bind(this.boundParams);
        }
      }

      if (this.stmt.step()) {
        const result = this.stmt.getAsObject();
        this.stmt.reset();
        return this.convertIntegerColumns(result);
      }

      this.stmt.reset();
      return undefined;
    } catch (error) {
      this.stmt.reset();
      throw error;
    } finally {
      // Free statement memory after read operation completes
      this.freeStatement();
    }
  }

  all(...params: any[]): any[] {
    try {
      if (params.length > 0) {
        this.bindParams(params);
        if (this.boundParams) {
          this.stmt.bind(this.boundParams);
        }
      }

      const results: any[] = [];
      while (this.stmt.step()) {
        results.push(this.convertIntegerColumns(this.stmt.getAsObject()));
      }

      this.stmt.reset();
      return results;
    } catch (error) {
      this.stmt.reset();
      throw error;
    } finally {
      // Free statement memory after read operation completes
      this.freeStatement();
    }
  }
  
  iterate(...params: any[]): IterableIterator<any> {
    // sql.js doesn't support generators well, return array iterator
    return this.all(...params)[Symbol.iterator]();
  }
  
  pluck(toggle?: boolean): this {
    // Not directly supported in sql.js
    return this;
  }
  
  expand(toggle?: boolean): this {
    // Not directly supported in sql.js
    return this;
  }
  
  raw(toggle?: boolean): this {
    // Not directly supported in sql.js
    return this;
  }
  
  columns(): ColumnDefinition[] {
    // sql.js has different column info
    return [];
  }
  
  bind(...params: any[]): this {
    this.bindParams(params);
    return this;
  }
  
  private bindParams(params: any[]): void {
    if (params.length === 0) {
      this.boundParams = null;
      return;
    }
    
    if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0]) && params[0] !== null) {
      // Named parameters passed as object
      this.boundParams = params[0];
    } else {
      // Positional parameters - sql.js uses array for positional
      // Filter out undefined values that might cause issues
      this.boundParams = params.map(p => p === undefined ? null : p);
    }
  }
  
  /**
   * Convert SQLite integer columns to JavaScript numbers
   * sql.js returns all values as strings, but we need proper types for boolean conversion
   */
  private convertIntegerColumns(row: any): any {
    if (!row) return row;
    
    // Known integer columns in the nodes table
    const integerColumns = ['is_ai_tool', 'is_trigger', 'is_webhook', 'is_versioned'];
    
    const converted = { ...row };
    for (const col of integerColumns) {
      if (col in converted && typeof converted[col] === 'string') {
        converted[col] = parseInt(converted[col], 10);
      }
    }
    
    return converted;
  }
}