import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TemplateService, PaginatedResponse, TemplateInfo, TemplateMinimal } from '../../../src/templates/template-service';
import { TemplateRepository, StoredTemplate } from '../../../src/templates/template-repository';
import { DatabaseAdapter } from '../../../src/database/database-adapter';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock the template repository
vi.mock('../../../src/templates/template-repository');

// Mock template fetcher - only imported when needed
vi.mock('../../../src/templates/template-fetcher', () => ({
  TemplateFetcher: vi.fn().mockImplementation(function () { return ({
    fetchTemplates: vi.fn(),
    fetchAllTemplateDetails: vi.fn()
  }); })
}));

describe('TemplateService', () => {
  let service: TemplateService;
  let mockDb: DatabaseAdapter;
  let mockRepository: TemplateRepository;

  const createMockTemplate = (id: number, overrides: any = {}): StoredTemplate => ({
    id,
    workflow_id: id,
    name: overrides.name || `Template ${id}`,
    description: overrides.description || `Description for template ${id}`,
    author_name: overrides.author_name || 'Test Author',
    author_username: overrides.author_username || 'testuser',
    author_verified: overrides.author_verified !== undefined ? overrides.author_verified : 1,
    nodes_used: JSON.stringify(overrides.nodes_used || ['n8n-nodes-base.webhook']),
    workflow_json: JSON.stringify(overrides.workflow || {
      nodes: [
        {
          id: 'node1',
          type: 'n8n-nodes-base.webhook',
          name: 'Webhook',
          position: [100, 100],
          parameters: {}
        }
      ],
      connections: {},
      settings: {}
    }),
    categories: JSON.stringify(overrides.categories || ['automation']),
    views: overrides.views || 100,
    created_at: overrides.created_at || '2024-01-01T00:00:00Z',
    updated_at: overrides.updated_at || '2024-01-01T00:00:00Z',
    url: overrides.url || `https://n8n.io/workflows/${id}`,
    scraped_at: '2024-01-01T00:00:00Z',
    metadata_json: overrides.metadata_json || null,
    metadata_generated_at: overrides.metadata_generated_at || null
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDb = {} as DatabaseAdapter;
    
    // Create mock repository with all methods
    mockRepository = {
      getTemplatesByNodes: vi.fn(),
      getNodeTemplatesCount: vi.fn(),
      getTemplate: vi.fn(),
      searchTemplates: vi.fn(),
      getSearchCount: vi.fn(),
      getTemplatesForTask: vi.fn(),
      getTaskTemplatesCount: vi.fn(),
      getAllTemplates: vi.fn(),
      getTemplateCount: vi.fn(),
      getTemplateStats: vi.fn(),
      getExistingTemplateIds: vi.fn(),
      getMostRecentTemplateDate: vi.fn(),
      clearTemplates: vi.fn(),
      saveTemplate: vi.fn(),
      rebuildTemplateFTS: vi.fn(),
      searchTemplatesByMetadata: vi.fn(),
      getMetadataSearchCount: vi.fn()
    } as any;

    // Mock the constructor
    (TemplateRepository as any).mockImplementation(function () { return mockRepository; });
    
    service = new TemplateService(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listNodeTemplates', () => {
    it('should return paginated node templates', async () => {
      const mockTemplates = [
        createMockTemplate(1, { name: 'Webhook Template' }),
        createMockTemplate(2, { name: 'HTTP Template' })
      ];

      mockRepository.getTemplatesByNodes = vi.fn().mockReturnValue(mockTemplates);
      mockRepository.getNodeTemplatesCount = vi.fn().mockReturnValue(10);

      const result = await service.listNodeTemplates(['n8n-nodes-base.webhook'], 5, 0);

      expect(result).toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: 'Webhook Template',
            author: expect.objectContaining({
              name: 'Test Author',
              username: 'testuser',
              verified: true
            }),
            nodes: ['n8n-nodes-base.webhook'],
            views: 100
          })
        ]),
        total: 10,
        limit: 5,
        offset: 0,
        hasMore: true
      });

      expect(mockRepository.getTemplatesByNodes).toHaveBeenCalledWith(['n8n-nodes-base.webhook'], 5, 0);
      expect(mockRepository.getNodeTemplatesCount).toHaveBeenCalledWith(['n8n-nodes-base.webhook']);
    });

    it('should handle pagination correctly', async () => {
      mockRepository.getTemplatesByNodes = vi.fn().mockReturnValue([]);
      mockRepository.getNodeTemplatesCount = vi.fn().mockReturnValue(25);

      const result = await service.listNodeTemplates(['n8n-nodes-base.webhook'], 10, 20);

      expect(result.hasMore).toBe(false); // 20 + 10 >= 25
      expect(result.offset).toBe(20);
      expect(result.limit).toBe(10);
    });

    it('should use default pagination parameters', async () => {
      mockRepository.getTemplatesByNodes = vi.fn().mockReturnValue([]);
      mockRepository.getNodeTemplatesCount = vi.fn().mockReturnValue(0);

      await service.listNodeTemplates(['n8n-nodes-base.webhook']);

      expect(mockRepository.getTemplatesByNodes).toHaveBeenCalledWith(['n8n-nodes-base.webhook'], 10, 0);
    });
  });

  describe('getTemplate', () => {
    const mockWorkflow = {
      nodes: [
        {
          id: 'node1',
          type: 'n8n-nodes-base.webhook',
          name: 'Webhook',
          position: [100, 100],
          parameters: { path: 'test' }
        },
        {
          id: 'node2',
          type: 'n8n-nodes-base.slack',
          name: 'Slack',
          position: [300, 100],
          parameters: { channel: '#general' }
        }
      ],
      connections: {
        'node1': {
          'main': [
            [{ 'node': 'node2', 'type': 'main', 'index': 0 }]
          ]
        }
      },
      settings: { timezone: 'UTC' }
    };

    it('should return template in nodes_only mode', async () => {
      const mockTemplate = createMockTemplate(1, { workflow: mockWorkflow });
      mockRepository.getTemplate = vi.fn().mockReturnValue(mockTemplate);

      const result = await service.getTemplate(1, 'nodes_only');

      expect(result).toEqual({
        id: 1,
        name: 'Template 1',
        nodes: [
          { type: 'n8n-nodes-base.webhook', name: 'Webhook' },
          { type: 'n8n-nodes-base.slack', name: 'Slack' }
        ]
      });
    });

    it('should return template in structure mode', async () => {
      const mockTemplate = createMockTemplate(1, { workflow: mockWorkflow });
      mockRepository.getTemplate = vi.fn().mockReturnValue(mockTemplate);

      const result = await service.getTemplate(1, 'structure');

      expect(result).toEqual({
        id: 1,
        name: 'Template 1',
        nodes: [
          {
            id: 'node1',
            type: 'n8n-nodes-base.webhook',
            name: 'Webhook',
            position: [100, 100]
          },
          {
            id: 'node2',
            type: 'n8n-nodes-base.slack',
            name: 'Slack',
            position: [300, 100]
          }
        ],
        connections: mockWorkflow.connections
      });
    });

    it('should return full template in full mode', async () => {
      const mockTemplate = createMockTemplate(1, { workflow: mockWorkflow });
      mockRepository.getTemplate = vi.fn().mockReturnValue(mockTemplate);

      const result = await service.getTemplate(1, 'full');

      expect(result).toEqual(expect.objectContaining({
        id: 1,
        name: 'Template 1',
        description: 'Description for template 1',
        author: {
          name: 'Test Author',
          username: 'testuser',
          verified: true
        },
        nodes: ['n8n-nodes-base.webhook'],
        views: 100,
        workflow: mockWorkflow
      }));
    });

    it('should return null for non-existent template', async () => {
      mockRepository.getTemplate = vi.fn().mockReturnValue(null);

      const result = await service.getTemplate(999);

      expect(result).toBeNull();
    });

    it('should handle templates with no workflow nodes', async () => {
      const mockTemplate = createMockTemplate(1, { workflow: { connections: {}, settings: {} } });
      mockRepository.getTemplate = vi.fn().mockReturnValue(mockTemplate);

      const result = await service.getTemplate(1, 'nodes_only');

      expect(result.nodes).toEqual([]);
    });
  });

  describe('searchTemplates', () => {
    it('should return paginated search results', async () => {
      const mockTemplates = [
        createMockTemplate(1, { name: 'Webhook Automation' }),
        createMockTemplate(2, { name: 'Webhook Processing' })
      ];

      mockRepository.searchTemplates = vi.fn().mockReturnValue(mockTemplates);
      mockRepository.getSearchCount = vi.fn().mockReturnValue(15);

      const result = await service.searchTemplates('webhook', 10, 5);

      expect(result).toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({ id: 1, name: 'Webhook Automation' }),
          expect.objectContaining({ id: 2, name: 'Webhook Processing' })
        ]),
        total: 15,
        limit: 10,
        offset: 5,
        hasMore: false // 5 + 10 >= 15
      });

      expect(mockRepository.searchTemplates).toHaveBeenCalledWith('webhook', 10, 5);
      expect(mockRepository.getSearchCount).toHaveBeenCalledWith('webhook');
    });

    it('should use default parameters', async () => {
      mockRepository.searchTemplates = vi.fn().mockReturnValue([]);
      mockRepository.getSearchCount = vi.fn().mockReturnValue(0);

      await service.searchTemplates('test');

      expect(mockRepository.searchTemplates).toHaveBeenCalledWith('test', 20, 0);
    });
  });

  describe('getTemplatesForTask', () => {
    it('should return paginated task templates', async () => {
      const mockTemplates = [
        createMockTemplate(1, { name: 'AI Workflow' }),
        createMockTemplate(2, { name: 'ML Pipeline' })
      ];

      mockRepository.getTemplatesForTask = vi.fn().mockReturnValue(mockTemplates);
      mockRepository.getTaskTemplatesCount = vi.fn().mockReturnValue(8);

      const result = await service.getTemplatesForTask('ai_automation', 5, 3);

      expect(result).toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({ id: 1, name: 'AI Workflow' }),
          expect.objectContaining({ id: 2, name: 'ML Pipeline' })
        ]),
        total: 8,
        limit: 5,
        offset: 3,
        hasMore: false // 3 + 5 >= 8
      });

      expect(mockRepository.getTemplatesForTask).toHaveBeenCalledWith('ai_automation', 5, 3);
      expect(mockRepository.getTaskTemplatesCount).toHaveBeenCalledWith('ai_automation');
    });
  });

  describe('listTemplates', () => {
    it('should return paginated minimal template data', async () => {
      const mockTemplates = [
        createMockTemplate(1, { 
          name: 'Template A',
          nodes_used: ['n8n-nodes-base.webhook', 'n8n-nodes-base.slack'],
          views: 200
        }),
        createMockTemplate(2, { 
          name: 'Template B',
          nodes_used: ['n8n-nodes-base.httpRequest'],
          views: 150
        })
      ];

      mockRepository.getAllTemplates = vi.fn().mockReturnValue(mockTemplates);
      mockRepository.getTemplateCount = vi.fn().mockReturnValue(50);

      const result = await service.listTemplates(10, 20, 'views');

      expect(result).toEqual({
        items: [
          { id: 1, name: 'Template A', description: 'Description for template 1', views: 200, nodeCount: 2 },
          { id: 2, name: 'Template B', description: 'Description for template 2', views: 150, nodeCount: 1 }
        ],
        total: 50,
        limit: 10,
        offset: 20,
        hasMore: true // 20 + 10 < 50
      });

      expect(mockRepository.getAllTemplates).toHaveBeenCalledWith(10, 20, 'views');
      expect(mockRepository.getTemplateCount).toHaveBeenCalled();
    });

    it('should use default parameters', async () => {
      mockRepository.getAllTemplates = vi.fn().mockReturnValue([]);
      mockRepository.getTemplateCount = vi.fn().mockReturnValue(0);

      await service.listTemplates();

      expect(mockRepository.getAllTemplates).toHaveBeenCalledWith(10, 0, 'views');
    });

    it('should handle different sort orders', async () => {
      mockRepository.getAllTemplates = vi.fn().mockReturnValue([]);
      mockRepository.getTemplateCount = vi.fn().mockReturnValue(0);

      await service.listTemplates(5, 0, 'name');

      expect(mockRepository.getAllTemplates).toHaveBeenCalledWith(5, 0, 'name');
    });
  });

  describe('listAvailableTasks', () => {
    it('should return list of available tasks', () => {
      const tasks = service.listAvailableTasks();

      expect(tasks).toEqual([
        'ai_automation',
        'data_sync',
        'webhook_processing',
        'email_automation',
        'slack_integration',
        'data_transformation',
        'file_processing',
        'scheduling',
        'api_integration',
        'database_operations'
      ]);
    });
  });

  describe('getTemplateStats', () => {
    it('should return template statistics', async () => {
      const mockStats = {
        totalTemplates: 100,
        averageViews: 250,
        topUsedNodes: [
          { node: 'n8n-nodes-base.webhook', count: 45 },
          { node: 'n8n-nodes-base.slack', count: 30 }
        ]
      };

      mockRepository.getTemplateStats = vi.fn().mockReturnValue(mockStats);

      const result = await service.getTemplateStats();

      expect(result).toEqual(mockStats);
      expect(mockRepository.getTemplateStats).toHaveBeenCalled();
    });
  });

  describe('fetchAndUpdateTemplates', () => {
    it('should handle rebuild mode', async () => {
      const mockFetcher = {
        fetchTemplates: vi.fn().mockResolvedValue([
          { id: 1, name: 'Template 1' },
          { id: 2, name: 'Template 2' }
        ]),
        fetchAllTemplateDetails: vi.fn().mockResolvedValue(new Map([
          [1, { id: 1, workflow: { nodes: [], connections: {}, settings: {} } }],
          [2, { id: 2, workflow: { nodes: [], connections: {}, settings: {} } }]
        ]))
      };

      // Mock dynamic import
      vi.doMock('../../../src/templates/template-fetcher', () => ({
        TemplateFetcher: vi.fn(function () { return mockFetcher; })
      }));

      mockRepository.clearTemplates = vi.fn();
      mockRepository.saveTemplate = vi.fn();
      mockRepository.rebuildTemplateFTS = vi.fn();

      const progressCallback = vi.fn();

      await service.fetchAndUpdateTemplates(progressCallback, 'rebuild');

      expect(mockRepository.clearTemplates).toHaveBeenCalled();
      expect(mockRepository.saveTemplate).toHaveBeenCalledTimes(2);
      expect(mockRepository.rebuildTemplateFTS).toHaveBeenCalled();
      expect(progressCallback).toHaveBeenCalledWith('Complete', 2, 2);
    });

    it('should handle update mode with existing templates', async () => {
      const mockFetcher = {
        fetchTemplates: vi.fn().mockResolvedValue([
          { id: 1, name: 'Template 1' },
          { id: 2, name: 'Template 2' },
          { id: 3, name: 'Template 3' }
        ]),
        fetchAllTemplateDetails: vi.fn().mockResolvedValue(new Map([
          [3, { id: 3, workflow: { nodes: [], connections: {}, settings: {} } }]
        ]))
      };

      // Mock dynamic import
      vi.doMock('../../../src/templates/template-fetcher', () => ({
        TemplateFetcher: vi.fn(function () { return mockFetcher; })
      }));

      mockRepository.getExistingTemplateIds = vi.fn().mockReturnValue(new Set([1, 2]));
      mockRepository.getMostRecentTemplateDate = vi.fn().mockReturnValue(new Date('2025-09-01'));
      mockRepository.saveTemplate = vi.fn();
      mockRepository.rebuildTemplateFTS = vi.fn();

      const progressCallback = vi.fn();

      await service.fetchAndUpdateTemplates(progressCallback, 'update');

      expect(mockRepository.getExistingTemplateIds).toHaveBeenCalled();
      expect(mockRepository.saveTemplate).toHaveBeenCalledTimes(1); // Only new template
      expect(mockRepository.rebuildTemplateFTS).toHaveBeenCalled();
    });

    it('should handle update mode with no new templates', async () => {
      const mockFetcher = {
        fetchTemplates: vi.fn().mockResolvedValue([
          { id: 1, name: 'Template 1' },
          { id: 2, name: 'Template 2' }
        ]),
        fetchAllTemplateDetails: vi.fn().mockResolvedValue(new Map())
      };

      // Mock dynamic import
      vi.doMock('../../../src/templates/template-fetcher', () => ({
        TemplateFetcher: vi.fn(function () { return mockFetcher; })
      }));

      mockRepository.getExistingTemplateIds = vi.fn().mockReturnValue(new Set([1, 2]));
      mockRepository.getMostRecentTemplateDate = vi.fn().mockReturnValue(new Date('2025-09-01'));
      mockRepository.saveTemplate = vi.fn();
      mockRepository.rebuildTemplateFTS = vi.fn();

      const progressCallback = vi.fn();

      await service.fetchAndUpdateTemplates(progressCallback, 'update');

      expect(mockRepository.saveTemplate).not.toHaveBeenCalled();
      expect(mockRepository.rebuildTemplateFTS).not.toHaveBeenCalled();
      expect(progressCallback).toHaveBeenCalledWith('No new templates', 0, 0);
    });

    it('should handle errors during fetch', async () => {
      // Mock the import to fail during constructor
      const mockFetcher = function() {
        throw new Error('Fetch failed');
      };

      vi.doMock('../../../src/templates/template-fetcher', () => ({
        TemplateFetcher: mockFetcher
      }));

      await expect(service.fetchAndUpdateTemplates()).rejects.toThrow('Fetch failed');
    });
  });

  describe('searchTemplatesByMetadata', () => {
    it('should return paginated metadata search results', async () => {
      const mockTemplates = [
        createMockTemplate(1, { 
          name: 'AI Workflow',
          metadata_json: JSON.stringify({
            categories: ['ai', 'automation'],
            complexity: 'complex',
            estimated_setup_minutes: 60
          })
        }),
        createMockTemplate(2, { 
          name: 'Simple Webhook',
          metadata_json: JSON.stringify({
            categories: ['automation'],
            complexity: 'simple',
            estimated_setup_minutes: 15
          })
        })
      ];

      mockRepository.searchTemplatesByMetadata = vi.fn().mockReturnValue(mockTemplates);
      mockRepository.getMetadataSearchCount = vi.fn().mockReturnValue(12);

      const result = await service.searchTemplatesByMetadata({
        complexity: 'simple',
        maxSetupMinutes: 30
      }, 10, 5);

      expect(result).toEqual({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: 'AI Workflow',
            metadata: {
              categories: ['ai', 'automation'],
              complexity: 'complex',
              estimated_setup_minutes: 60
            }
          }),
          expect.objectContaining({
            id: 2,
            name: 'Simple Webhook',
            metadata: {
              categories: ['automation'],
              complexity: 'simple',
              estimated_setup_minutes: 15
            }
          })
        ]),
        total: 12,
        limit: 10,
        offset: 5,
        hasMore: false // 5 + 10 >= 12
      });

      expect(mockRepository.searchTemplatesByMetadata).toHaveBeenCalledWith({
        complexity: 'simple',
        maxSetupMinutes: 30
      }, 10, 5);
      expect(mockRepository.getMetadataSearchCount).toHaveBeenCalledWith({
        complexity: 'simple',
        maxSetupMinutes: 30
      });
    });

    it('should use default pagination parameters', async () => {
      mockRepository.searchTemplatesByMetadata = vi.fn().mockReturnValue([]);
      mockRepository.getMetadataSearchCount = vi.fn().mockReturnValue(0);

      await service.searchTemplatesByMetadata({ category: 'test' });

      expect(mockRepository.searchTemplatesByMetadata).toHaveBeenCalledWith({ category: 'test' }, 20, 0);
    });

    it('should handle templates without metadata gracefully', async () => {
      const templatesWithoutMetadata = [
        createMockTemplate(1, { metadata_json: null }),
        createMockTemplate(2, { metadata_json: undefined }),
        createMockTemplate(3, { metadata_json: 'invalid json' })
      ];

      mockRepository.searchTemplatesByMetadata = vi.fn().mockReturnValue(templatesWithoutMetadata);
      mockRepository.getMetadataSearchCount = vi.fn().mockReturnValue(3);

      const result = await service.searchTemplatesByMetadata({ category: 'test' });

      expect(result.items).toHaveLength(3);
      result.items.forEach(item => {
        expect(item.metadata).toBeUndefined();
      });
    });

    it('should handle malformed metadata JSON', async () => {
      const templateWithBadMetadata = createMockTemplate(1, { 
        metadata_json: '{"invalid": json syntax}'
      });

      mockRepository.searchTemplatesByMetadata = vi.fn().mockReturnValue([templateWithBadMetadata]);
      mockRepository.getMetadataSearchCount = vi.fn().mockReturnValue(1);

      const result = await service.searchTemplatesByMetadata({ category: 'test' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].metadata).toBeUndefined();
    });
  });

  describe('formatTemplateInfo (private method behavior)', () => {
    it('should format template data correctly through public methods', async () => {
      const mockTemplate = createMockTemplate(1, {
        name: 'Test Template',
        description: 'Test Description',
        author_name: 'John Doe',
        author_username: 'johndoe',
        author_verified: 1,
        nodes_used: ['n8n-nodes-base.webhook', 'n8n-nodes-base.slack'],
        views: 500,
        created_at: '2024-01-15T10:30:00Z',
        url: 'https://n8n.io/workflows/123'
      });

      mockRepository.searchTemplates = vi.fn().mockReturnValue([mockTemplate]);
      mockRepository.getSearchCount = vi.fn().mockReturnValue(1);

      const result = await service.searchTemplates('test');

      expect(result.items[0]).toEqual({
        id: 1,
        name: 'Test Template',
        description: 'Test Description',
        author: {
          name: 'John Doe',
          username: 'johndoe',
          verified: true
        },
        nodes: ['n8n-nodes-base.webhook', 'n8n-nodes-base.slack'],
        views: 500,
        created: '2024-01-15T10:30:00Z',
        url: 'https://n8n.io/workflows/123'
      });
    });

    it('should handle unverified authors', async () => {
      const mockTemplate = createMockTemplate(1, {
        author_verified: 0  // Explicitly set to 0 for unverified
      });

      // Override the helper to return exactly what we want
      const unverifiedTemplate = {
        ...mockTemplate,
        author_verified: 0
      };

      mockRepository.searchTemplates = vi.fn().mockReturnValue([unverifiedTemplate]);
      mockRepository.getSearchCount = vi.fn().mockReturnValue(1);

      const result = await service.searchTemplates('test');

      expect(result.items[0]?.author?.verified).toBe(false);
    });
  });
});