import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { TestDatabase, TestDataGenerator } from './test-utils';

describe('Database Connection Management', () => {
  let testDb: TestDatabase;

  afterEach(async () => {
    if (testDb) {
      await testDb.cleanup();
    }
  });

  describe('In-Memory Database', () => {
    it('should create and connect to in-memory database', async () => {
      testDb = new TestDatabase({ mode: 'memory' });
      const db = await testDb.initialize();

      expect(db).toBeDefined();
      expect(db.open).toBe(true);
      expect(db.name).toBe(':memory:');
    });

    it('should execute queries on in-memory database', async () => {
      testDb = new TestDatabase({ mode: 'memory' });
      const db = await testDb.initialize();

      // Test basic query
      const result = db.prepare('SELECT 1 as value').get() as { value: number };
      expect(result.value).toBe(1);

      // Test table exists
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'"
      ).all();
      expect(tables.length).toBe(1);
    });

    it('should handle multiple connections to same in-memory database', async () => {
      // Each in-memory database is isolated
      const db1 = new TestDatabase({ mode: 'memory' });
      const db2 = new TestDatabase({ mode: 'memory' });

      const conn1 = await db1.initialize();
      const conn2 = await db2.initialize();

      // Insert data in first connection
      const node = TestDataGenerator.generateNode();
      conn1.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description, category,
          development_style, is_ai_tool, is_trigger, is_webhook,
          is_versioned, version, documentation, properties_schema,
          operations, credentials_required
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.nodeType,
        node.packageName,
        node.displayName,
        node.description || '',
        node.category || 'Core Nodes',
        node.developmentStyle || 'programmatic',
        node.isAITool ? 1 : 0,
        node.isTrigger ? 1 : 0,
        node.isWebhook ? 1 : 0,
        node.isVersioned ? 1 : 0,
        node.version,
        node.documentation,
        JSON.stringify(node.properties || []),
        JSON.stringify(node.operations || []),
        JSON.stringify(node.credentials || [])
      );

      // Verify data is isolated
      const count1 = conn1.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
      const count2 = conn2.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };

      expect(count1.count).toBe(1);
      expect(count2.count).toBe(0);

      await db1.cleanup();
      await db2.cleanup();
    });
  });

  describe('File-Based Database', () => {
    it('should create and connect to file database', async () => {
      testDb = new TestDatabase({ mode: 'file', name: 'test-connection.db' });
      const db = await testDb.initialize();

      expect(db).toBeDefined();
      expect(db.open).toBe(true);
      expect(db.name).toContain('test-connection.db');

      // Verify file exists
      const dbPath = path.join(__dirname, '../../../.test-dbs/test-connection.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should enable WAL mode by default for file databases', async () => {
      testDb = new TestDatabase({ mode: 'file', name: 'test-wal.db' });
      const db = await testDb.initialize();

      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode).toBe('wal');

      // Verify WAL files are created
      const dbPath = path.join(__dirname, '../../../.test-dbs/test-wal.db');
      expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
      expect(fs.existsSync(`${dbPath}-shm`)).toBe(true);
    });

    it('should allow disabling WAL mode', async () => {
      testDb = new TestDatabase({ 
        mode: 'file', 
        name: 'test-no-wal.db',
        enableWAL: false 
      });
      const db = await testDb.initialize();

      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode).not.toBe('wal');
    });

    it('should handle connection pooling simulation', async () => {
      const dbPath = path.join(__dirname, '../../../.test-dbs/test-pool.db');
      
      // Create initial database
      testDb = new TestDatabase({ mode: 'file', name: 'test-pool.db' });
      const initialDb = await testDb.initialize();
      
      // Close the initial connection but keep the file
      initialDb.close();

      // Simulate multiple connections
      const connections: Database.Database[] = [];
      const connectionCount = 5;

      try {
        for (let i = 0; i < connectionCount; i++) {
          const conn = new Database(dbPath, { 
            readonly: false,
            fileMustExist: true 
          });
          connections.push(conn);
        }

        // All connections should be open
        expect(connections.every(conn => conn.open)).toBe(true);

        // Test concurrent reads
        const promises = connections.map((conn, index) => {
          return new Promise((resolve, reject) => {
            try {
              const result = conn.prepare('SELECT ? as id').get(index);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          });
        });

        const results = await Promise.all(promises);
        expect(results).toHaveLength(connectionCount);

      } finally {
        // Cleanup connections - ensure all are closed even if some fail
        await Promise.all(
          connections.map(async (conn) => {
            try {
              if (conn.open) {
                conn.close();
              }
            } catch (error) {
              // Ignore close errors
            }
          })
        );
        
        // Clean up files with error handling
        try {
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
          }
          if (fs.existsSync(`${dbPath}-wal`)) {
            fs.unlinkSync(`${dbPath}-wal`);
          }
          if (fs.existsSync(`${dbPath}-shm`)) {
            fs.unlinkSync(`${dbPath}-shm`);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
        
        // Mark testDb as cleaned up to avoid double cleanup
        testDb = null as any;
      }
    });
  });

  describe('Connection Error Handling', () => {
    it('should handle invalid file path gracefully', async () => {
      const invalidPath = '/invalid/path/that/does/not/exist/test.db';
      
      expect(() => {
        new Database(invalidPath);
      }).toThrow();
    });

    it('should handle database file corruption', async () => {
      const corruptPath = path.join(__dirname, '../../../.test-dbs/corrupt.db');
      
      // Create directory if it doesn't exist
      const dir = path.dirname(corruptPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create a corrupt database file
      fs.writeFileSync(corruptPath, 'This is not a valid SQLite database');

      try {
        // SQLite may not immediately throw on construction, but on first operation
        let db: Database.Database | null = null;
        let errorThrown = false;
        
        try {
          db = new Database(corruptPath);
          // Try to use the database - this should fail
          db.prepare('SELECT 1').get();
        } catch (error) {
          errorThrown = true;
          expect(error).toBeDefined();
        } finally {
          if (db && db.open) {
            db.close();
          }
        }
        
        expect(errorThrown).toBe(true);
      } finally {
        if (fs.existsSync(corruptPath)) {
          fs.unlinkSync(corruptPath);
        }
      }
    });

    it('should handle readonly database access', async () => {
      // Create a database first
      testDb = new TestDatabase({ mode: 'file', name: 'test-readonly.db' });
      const db = await testDb.initialize();

      // Insert test data using correct schema
      const node = TestDataGenerator.generateNode();
      db.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description, category,
          development_style, is_ai_tool, is_trigger, is_webhook,
          is_versioned, version, documentation, properties_schema,
          operations, credentials_required
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.nodeType,
        node.packageName,
        node.displayName,
        node.description || '',
        node.category || 'Core Nodes',
        node.developmentStyle || 'programmatic',
        node.isAITool ? 1 : 0,
        node.isTrigger ? 1 : 0,
        node.isWebhook ? 1 : 0,
        node.isVersioned ? 1 : 0,
        node.version,
        node.documentation,
        JSON.stringify(node.properties || []),
        JSON.stringify(node.operations || []),
        JSON.stringify(node.credentials || [])
      );

      // Close the write database first
      db.close();
      
      // Get the actual path from the database name
      const dbPath = db.name;

      // Open as readonly
      const readonlyDb = new Database(dbPath, { readonly: true });

      try {
        // Reading should work
        const count = readonlyDb.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
        expect(count.count).toBe(1);

        // Writing should fail
        expect(() => {
          readonlyDb.prepare('DELETE FROM nodes').run();
        }).toThrow(/readonly/);

      } finally {
        readonlyDb.close();
      }
    });
  });

  describe('Connection Lifecycle', () => {
    it('should properly close database connections', async () => {
      testDb = new TestDatabase({ mode: 'file', name: 'test-lifecycle.db' });
      const db = await testDb.initialize();

      expect(db.open).toBe(true);

      await testDb.cleanup();

      expect(db.open).toBe(false);
    });

    it('should handle multiple open/close cycles', async () => {
      const dbPath = path.join(__dirname, '../../../.test-dbs/test-cycles.db');

      for (let i = 0; i < 3; i++) {
        const db = new TestDatabase({ mode: 'file', name: 'test-cycles.db' });
        const conn = await db.initialize();

        // Perform operation
        const result = conn.prepare('SELECT ? as cycle').get(i) as { cycle: number };
        expect(result.cycle).toBe(i);

        await db.cleanup();
      }

      // Ensure file is cleaned up
      expect(fs.existsSync(dbPath)).toBe(false);
    });

    it('should handle connection timeout simulation', { timeout: 5000 }, async () => {
      testDb = new TestDatabase({ mode: 'file', name: 'test-timeout.db' });
      const db = await testDb.initialize();

      // Set a busy timeout
      db.exec('PRAGMA busy_timeout = 100'); // 100ms timeout

      // Start a transaction to lock the database
      db.exec('BEGIN EXCLUSIVE');

      // Try to access from another connection (should timeout)
      const dbPath = path.join(__dirname, '../../../.test-dbs/test-timeout.db');
      const conn2 = new Database(dbPath);
      conn2.exec('PRAGMA busy_timeout = 100');

      try {
        expect(() => {
          conn2.exec('BEGIN EXCLUSIVE');
        }).toThrow(/database is locked/);
      } finally {
        db.exec('ROLLBACK');
        conn2.close();
      }
    }); // Add explicit timeout
  });

  describe('Database Configuration', () => {
    it('should apply optimal pragmas for performance', async () => {
      testDb = new TestDatabase({ mode: 'file', name: 'test-pragmas.db' });
      const db = await testDb.initialize();

      // Apply performance pragmas
      db.exec('PRAGMA synchronous = NORMAL');
      db.exec('PRAGMA cache_size = -64000'); // 64MB cache
      db.exec('PRAGMA temp_store = MEMORY');
      db.exec('PRAGMA mmap_size = 268435456'); // 256MB mmap

      // Verify pragmas
      const sync = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
      const cache = db.prepare('PRAGMA cache_size').get() as { cache_size: number };
      const temp = db.prepare('PRAGMA temp_store').get() as { temp_store: number };
      const mmap = db.prepare('PRAGMA mmap_size').get() as { mmap_size: number };

      expect(sync.synchronous).toBe(1); // NORMAL = 1
      expect(cache.cache_size).toBe(-64000);
      expect(temp.temp_store).toBe(2); // MEMORY = 2
      expect(mmap.mmap_size).toBeGreaterThan(0);
    });

    it('should have foreign key support enabled', async () => {
      testDb = new TestDatabase({ mode: 'memory' });
      const db = await testDb.initialize();

      // Foreign keys should be enabled by default
      const fkEnabled = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(fkEnabled.foreign_keys).toBe(1);

      // Note: The current schema doesn't define foreign key constraints,
      // but the setting is enabled for future use
    });
  });
});