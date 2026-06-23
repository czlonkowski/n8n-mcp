import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateRepository, StoredTemplate } from '../../../src/templates/template-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '../../../src/database/database-adapter';
import { TemplateWorkflow, TemplateDetail } from '../../../src/templates/template-fetcher';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock template sanitizer
vi.mock('../../../src/utils/template-sanitizer', () => {
  class MockTemplateSanitizer {
    sanitizeWorkflow = vi.fn((workflow) => ({ sanitized: workflow, wasModified: false }));
    detectTokens = vi.fn(() => []);
  }
  
  return {
    TemplateSanitizer: MockTemplateSanitizer
  };
});

// Create mock database adapter
class MockDatabaseAdapter implements DatabaseAdapter {
  private statements = new Map<string, MockPreparedStatement>();
  private mockData = new Map<string, any>();
  private _fts5Support = true;
  
  prepare = vi.fn((sql: string) => {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, new MockPreparedStatement(sql, this.mockData));
    }
    return this.statements.get(sql)!;
  });
  
  exec = vi.fn();
  close = vi.fn();
  pragma = vi.fn();
  transaction = vi.fn((fn: () => any) => fn());
  checkFTS5Support = vi.fn(() => this._fts5Support);
  inTransaction = false;
  
  // Test helpers
  _setFTS5Support(supported: boolean) {
    this._fts5Support = supported;
  }
  
  _setMockData(key: string, value: any) {
    this.mockData.set(key, value);
  }
  
  _getStatement(sql: string) {
    return this.statements.get(sql);
  }
}

class MockPreparedStatement implements PreparedStatement {
  run = vi.fn((...params: any[]): RunResult => ({ changes: 1, lastInsertRowid: 1 }));
  get = vi.fn();
  all = vi.fn(() => []);
  iterate = vi.fn();
  pluck = vi.fn(() => this);
  expand = vi.fn(() => this);
  raw = vi.fn(() => this);
  columns = vi.fn(() => []);
  bind = vi.fn(() => this);
  
  constructor(private sql: string, private mockData: Map<string, any>) {
    // Configure based on SQL patterns
    if (sql.includes('SELECT * FROM templates WHERE id = ?')) {
      this.get = vi.fn((id: number) => this.mockData.get(`template:${id}`));
    }
    
    if (sql.includes('SELECT * FROM templates') && sql.includes('LIMIT')) {
      this.all = vi.fn(() => this.mockData.get('all_templates') || []);
    }
    
    if (sql.includes('templates_fts')) {
      this.all = vi.fn(() => this.mockData.get('fts_results') || []);
    }
    
    if (sql.includes('WHERE name LIKE')) {
      this.all = vi.fn(() => this.mockData.get('like_results') || []);
    }
    
    if (sql.includes('COUNT(*) as count')) {
      this.get = vi.fn(() => ({ count: this.mockData.get('template_count') || 0 }));
    }
    
    if (sql.includes('AVG(views)')) {
      this.get = vi.fn(() => ({ avg: this.mockData.get('avg_views') || 0 }));
    }
    
    if (sql.includes('sqlite_master')) {
      this.get = vi.fn(() => this.mockData.get('fts_table_exists') ? { name: 'templates_fts' } : undefined);
    }
  }
}

describe('TemplateRepository - Core Functionality', () => {
  let repository: TemplateRepository;
  let mockAdapter: MockDatabaseAdapter;
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = new MockDatabaseAdapter();
    mockAdapter._setMockData('fts_table_exists', false); // Default to creating FTS
    repository = new TemplateRepository(mockAdapter);
  });
  
  describe('FTS5 initialization', () => {
    it('should initialize FTS5 when supported', () => {
      expect(mockAdapter.checkFTS5Support).toHaveBeenCalled();
      expect(mockAdapter.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE VIRTUAL TABLE'));
    });
    
    it('should skip FTS5 when not supported', () => {
      mockAdapter._setFTS5Support(false);
      mockAdapter.exec.mockClear();
      
      const newRepo = new TemplateRepository(mockAdapter);
      
      expect(mockAdapter.exec).not.toHaveBeenCalledWith(expect.stringContaining('CREATE VIRTUAL TABLE'));
    });
  });
  
  describe('saveTemplate', () => {
    it('should save a template with proper JSON serialization', () => {
      const workflow: TemplateWorkflow = {
        id: 123,
        name: 'Test Workflow',
        description: 'A test workflow',
        user: {
          id: 1,
          name: 'John Doe',
          username: 'johndoe',
          verified: true
        },
        nodes: [
          { id: 1, name: 'n8n-nodes-base.httpRequest', icon: 'fa:globe' },
          { id: 2, name: 'n8n-nodes-base.slack', icon: 'fa:slack' }
        ],
        totalViews: 1000,
        createdAt: '2024-01-01T00:00:00Z'
      };
      
      const detail: TemplateDetail = {
        id: 123,
        name: 'Test Workflow',
        description: 'A test workflow',
        views: 1000,
        createdAt: '2024-01-01T00:00:00Z',
        workflow: {
          nodes: [
            { type: 'n8n-nodes-base.httpRequest', name: 'HTTP Request', id: '1', position: [0, 0], parameters: {}, typeVersion: 1 },
            { type: 'n8n-nodes-base.slack', name: 'Slack', id: '2', position: [100, 0], parameters: {}, typeVersion: 1 }
          ],
          connections: {},
          settings: {}
        }
      };
      
      const categories = ['automation', 'integration'];
      
      repository.saveTemplate(workflow, detail, categories);
      
      const stmt = mockAdapter._getStatement(mockAdapter.prepare.mock.calls.find(
        call => call[0].includes('INSERT OR REPLACE INTO templates')
      )?.[0] || '');
      
      // The implementation now uses gzip compression, so we just verify the call happened
      expect(stmt?.run).toHaveBeenCalledWith(
        123, // id
        123, // workflow_id
        'Test Workflow',
        'A test workflow',
        'John Doe',
        'johndoe',
        1, // verified
        JSON.stringify(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.slack']),
        expect.any(String), // compressed workflow JSON
        JSON.stringify(['automation', 'integration']),
        1000, // views
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:00:00Z',
        'https://n8n.io/workflows/123'
      );
    });
  });
  
  describe('getTemplate', () => {
    it('should retrieve a specific template by ID', () => {
      const mockTemplate: StoredTemplate = {
        id: 123,
        workflow_id: 123,
        name: 'Test Template',
        description: 'Description',
        author_name: 'Author',
        author_username: 'author',
        author_verified: 1,
        nodes_used: '[]',
        workflow_json: '{}',
        categories: '[]',
        views: 500,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        url: 'https://n8n.io/workflows/123',
        scraped_at: '2024-01-01'
      };
      
      mockAdapter._setMockData('template:123', mockTemplate);
      
      const result = repository.getTemplate(123);
      
      expect(result).toEqual(mockTemplate);
    });
    
    it('should return null for non-existent template', () => {
      const result = repository.getTemplate(999);
      expect(result).toBeNull();
    });
  });
  
  describe('searchTemplates', () => {
    it('should use FTS5 search when available', () => {
      const ftsResults: StoredTemplate[] = [{
        id: 1,
        workflow_id: 1,
        name: 'Chatbot Workflow',
        description: 'AI chatbot',
        author_name: 'Author',
        author_username: 'author',
        author_verified: 0,
        nodes_used: '[]',
        workflow_json: '{}',
        categories: '[]',
        views: 100,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        url: 'https://n8n.io/workflows/1',
        scraped_at: '2024-01-01'
      }];
      
      mockAdapter._setMockData('fts_results', ftsResults);
      
      const results = repository.searchTemplates('chatbot', 10);
      
      expect(results).toEqual(ftsResults);
    });
    
    it('should fall back to LIKE search when FTS5 is not supported', () => {
      mockAdapter._setFTS5Support(false);
      const newRepo = new TemplateRepository(mockAdapter);
      
      const likeResults: StoredTemplate[] = [{
        id: 3,
        workflow_id: 3,
        name: 'LIKE only',
        description: 'No FTS5',
        author_name: 'Author',
        author_username: 'author',
        author_verified: 0,
        nodes_used: '[]',
        workflow_json: '{}',
        categories: '[]',
        views: 25,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        url: 'https://n8n.io/workflows/3',
        scraped_at: '2024-01-01'
      }];
      
      mockAdapter._setMockData('like_results', likeResults);
      
      const results = newRepo.searchTemplates('test', 20);
      
      expect(results).toEqual(likeResults);
    });
  });
  
  describe('getTemplatesByNodes', () => {
    it('should find templates using specific node types', () => {
      const mockTemplates: StoredTemplate[] = [{
        id: 1,
        workflow_id: 1,
        name: 'HTTP Workflow',
        description: 'Uses HTTP',
        author_name: 'Author',
        author_username: 'author',
        author_verified: 1,
        nodes_used: '["n8n-nodes-base.httpRequest"]',
        workflow_json: '{}',
        categories: '[]',
        views: 100,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        url: 'https://n8n.io/workflows/1',
        scraped_at: '2024-01-01'
      }];
      
      // Set up the mock to return our templates
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => mockTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.getTemplatesByNodes(['n8n-nodes-base.httpRequest'], 5);
      
      expect(stmt.all).toHaveBeenCalledWith('%"n8n-nodes-base.httpRequest"%', 5, 0);
      expect(results).toEqual(mockTemplates);
    });
  });
  
  describe('getTemplatesForTask', () => {
    it('should return templates for known tasks', () => {
      const aiTemplates: StoredTemplate[] = [{
        id: 1,
        workflow_id: 1,
        name: 'AI Workflow',
        description: 'Uses OpenAI',
        author_name: 'Author',
        author_username: 'author',
        author_verified: 1,
        nodes_used: '["@n8n/n8n-nodes-langchain.openAi"]',
        workflow_json: '{}',
        categories: '["ai"]',
        views: 1000,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        url: 'https://n8n.io/workflows/1',
        scraped_at: '2024-01-01'
      }];
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => aiTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.getTemplatesForTask('ai_automation');
      
      expect(results).toEqual(aiTemplates);
    });
    
    it('should return empty array for unknown task', () => {
      const results = repository.getTemplatesForTask('unknown_task');
      expect(results).toEqual([]);
    });

    it('queries only the webhook node for webhook_processing (regression #2)', () => {
      const received: unknown[][] = [];
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn((...args: unknown[]) => {
        received.push(args);
        return [];
      });
      mockAdapter.prepare = vi.fn(() => stmt);

      repository.getTemplatesForTask('webhook_processing');

      const flatParams = received.flat().filter((p): p is string => typeof p === 'string');
      // Params are LIKE patterns such as `%n8n-nodes-base.webhook%` — use
      // substring match. httpRequest is NOT a trigger — previous map included
      // it and pulled in scheduleTrigger/formTrigger templates.
      expect(flatParams.some(p => p.includes('n8n-nodes-base.webhook'))).toBe(true);
      expect(flatParams.every(p => !p.includes('n8n-nodes-base.httpRequest'))).toBe(true);
    });
  });
  
  describe('template statistics', () => {
    it('should get template count', () => {
      mockAdapter._setMockData('template_count', 42);
      
      const count = repository.getTemplateCount();
      
      expect(count).toBe(42);
    });
    
    it('should get template statistics', () => {
      mockAdapter._setMockData('template_count', 100);
      mockAdapter._setMockData('avg_views', 250.5);
      
      const topTemplates = [
        { nodes_used: '["n8n-nodes-base.httpRequest", "n8n-nodes-base.slack"]' },
        { nodes_used: '["n8n-nodes-base.httpRequest", "n8n-nodes-base.code"]' },
        { nodes_used: '["n8n-nodes-base.slack"]' }
      ];
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => topTemplates);
      mockAdapter.prepare = vi.fn((sql) => {
        if (sql.includes('ORDER BY views DESC')) {
          return stmt;
        }
        return new MockPreparedStatement(sql, mockAdapter['mockData']);
      });
      
      const stats = repository.getTemplateStats();
      
      expect(stats.totalTemplates).toBe(100);
      expect(stats.averageViews).toBe(251);
      expect(stats.topUsedNodes).toContainEqual({ node: 'n8n-nodes-base.httpRequest', count: 2 });
    });
  });

  describe('pagination count methods', () => {
    it('should get node templates count', () => {
      mockAdapter._setMockData('node_templates_count', 15);
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.get = vi.fn(() => ({ count: 15 }));
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const count = repository.getNodeTemplatesCount(['n8n-nodes-base.webhook']);
      
      expect(count).toBe(15);
      expect(stmt.get).toHaveBeenCalledWith('%"n8n-nodes-base.webhook"%');
    });

    it('should get search count', () => {
      const stmt = new MockPreparedStatement('', new Map());
      stmt.get = vi.fn(() => ({ count: 8 }));
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const count = repository.getSearchCount('webhook');
      
      expect(count).toBe(8);
    });

    it('should get task templates count', () => {
      const stmt = new MockPreparedStatement('', new Map());
      stmt.get = vi.fn(() => ({ count: 12 }));
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const count = repository.getTaskTemplatesCount('ai_automation');
      
      expect(count).toBe(12);
    });

    it('should handle pagination in getAllTemplates', () => {
      const mockTemplates = [
        { id: 1, name: 'Template 1' },
        { id: 2, name: 'Template 2' }
      ];
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => mockTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.getAllTemplates(10, 5, 'name');
      
      expect(results).toEqual(mockTemplates);
      expect(stmt.all).toHaveBeenCalledWith(10, 5);
    });

    it('should handle pagination in getTemplatesByNodes', () => {
      const mockTemplates = [
        { id: 1, nodes_used: '["n8n-nodes-base.webhook"]' }
      ];
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => mockTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.getTemplatesByNodes(['n8n-nodes-base.webhook'], 5, 10);
      
      expect(results).toEqual(mockTemplates);
      expect(stmt.all).toHaveBeenCalledWith('%"n8n-nodes-base.webhook"%', 5, 10);
    });

    it('should handle pagination in searchTemplates', () => {
      const mockTemplates = [
        { id: 1, name: 'Search Result 1' }
      ];
      
      mockAdapter._setMockData('fts_results', mockTemplates);
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => mockTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.searchTemplates('webhook', 20, 40);
      
      expect(results).toEqual(mockTemplates);
    });

    it('should handle pagination in getTemplatesForTask', () => {
      const mockTemplates = [
        { id: 1, categories: '["ai"]' }
      ];
      
      const stmt = new MockPreparedStatement('', new Map());
      stmt.all = vi.fn(() => mockTemplates);
      mockAdapter.prepare = vi.fn(() => stmt);
      
      const results = repository.getTemplatesForTask('ai_automation', 15, 30);
      
      expect(results).toEqual(mockTemplates);
    });
  });
  
  describe('maintenance operations', () => {
    it('should clear all templates', () => {
      repository.clearTemplates();
      
      expect(mockAdapter.exec).toHaveBeenCalledWith('DELETE FROM templates');
    });
    
    it('should rebuild FTS5 index when supported', () => {
      repository.rebuildTemplateFTS();
      
      expect(mockAdapter.exec).toHaveBeenCalledWith('DELETE FROM templates_fts');
      expect(mockAdapter.exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO templates_fts')
      );
    });
  });
});