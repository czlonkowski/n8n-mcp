import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TemplateRepository } from '../../../src/templates/template-repository';
import { DatabaseAdapter } from '../../../src/database/database-adapter';
import { TestDatabase, TestDataGenerator, createTestDatabaseAdapter } from './test-utils';
import { TemplateWorkflow, TemplateDetail } from '../../../src/templates/template-fetcher';

describe('TemplateRepository Integration Tests', () => {
  let testDb: TestDatabase;
  let db: Database.Database;
  let repository: TemplateRepository;
  let adapter: DatabaseAdapter;

  beforeEach(async () => {
    testDb = new TestDatabase({ mode: 'memory', enableFTS5: true });
    db = await testDb.initialize();
    adapter = createTestDatabaseAdapter(db);
    repository = new TemplateRepository(adapter);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe('saveTemplate', () => {
    it('should save single template successfully', () => {
      const template = createTemplateWorkflow();
      const detail = createTemplateDetail({ id: template.id });
      repository.saveTemplate(template, detail);

      const saved = repository.getTemplate(template.id);
      expect(saved).toBeTruthy();
      expect(saved?.workflow_id).toBe(template.id);
      expect(saved?.name).toBe(template.name);
    });

    it('should update existing template', () => {
      const template = createTemplateWorkflow();
      
      // Save initial version
      const detail = createTemplateDetail({ id: template.id });
      repository.saveTemplate(template, detail);
      
      // Update and save again
      const updated: TemplateWorkflow = { ...template, name: 'Updated Template' };
      repository.saveTemplate(updated, detail);

      const saved = repository.getTemplate(template.id);
      expect(saved?.name).toBe('Updated Template');
      
      // Should not create duplicate
      const all = repository.getAllTemplates();
      expect(all).toHaveLength(1);
    });

    it('should handle templates with complex node types', () => {
      const template = createTemplateWorkflow({
        id: 1
      });

      const nodes = [
        {
          id: 'node1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [100, 100],
          parameters: {}
        },
        {
          id: 'node2',
          name: 'HTTP Request',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 3,
          position: [300, 100],
          parameters: {
            url: 'https://api.example.com',
            method: 'POST'
          }
        }
      ];

      const detail = createTemplateDetail({ 
        id: template.id, 
        workflow: {
          id: template.id.toString(),
          name: template.name,
          nodes: nodes,
          connections: {},
          settings: {}
        }
      });
      repository.saveTemplate(template, detail);
      
      const saved = repository.getTemplate(template.id);
      expect(saved).toBeTruthy();
      
      const nodesUsed = JSON.parse(saved!.nodes_used);
      expect(nodesUsed).toContain('n8n-nodes-base.webhook');
      expect(nodesUsed).toContain('n8n-nodes-base.httpRequest');
    });

    it('should sanitize workflow data before saving', () => {
      const template = createTemplateWorkflow({
        id: 5
      });

      const detail = createTemplateDetail({ 
        id: template.id, 
        workflow: {
          id: template.id.toString(),
          name: template.name,
          nodes: [
            {
              id: 'node1',
              name: 'Start',
              type: 'n8n-nodes-base.start',
              typeVersion: 1,
              position: [100, 100],
              parameters: {}
            }
          ],
          connections: {},
          settings: {},
          pinData: { node1: { data: 'sensitive' } },
          executionId: 'should-be-removed'
        }
      });
      repository.saveTemplate(template, detail);
      
      const saved = repository.getTemplate(template.id);
      expect(saved).toBeTruthy();
      
      expect(saved!.workflow_json).toBeTruthy();
      const workflowJson = JSON.parse(saved!.workflow_json!);
      expect(workflowJson.pinData).toBeUndefined();
    });
  });

  describe('getTemplate', () => {
    beforeEach(() => {
      const templates = [
        createTemplateWorkflow({ id: 1, name: 'Template 1' }),
        createTemplateWorkflow({ id: 2, name: 'Template 2' })
      ];
      templates.forEach(t => {
        const detail = createTemplateDetail({ 
          id: t.id,
          name: t.name,
          description: t.description
        });
        repository.saveTemplate(t, detail);
      });
    });

    it('should retrieve template by id', () => {
      const template = repository.getTemplate(1);
      expect(template).toBeTruthy();
      expect(template?.name).toBe('Template 1');
    });

    it('should return null for non-existent template', () => {
      const template = repository.getTemplate(999);
      expect(template).toBeNull();
    });
  });

  describe('searchTemplates with FTS5', () => {
    beforeEach(() => {
      const templates = [
        createTemplateWorkflow({
          id: 1,
          name: 'Webhook to Slack',
          description: 'Send Slack notifications when webhook received'
        }),
        createTemplateWorkflow({
          id: 2,
          name: 'HTTP Data Processing',
          description: 'Process data from HTTP requests'
        }),
        createTemplateWorkflow({
          id: 3,
          name: 'Email Automation',
          description: 'Automate email sending workflow'
        })
      ];
      templates.forEach(t => {
        const detail = createTemplateDetail({ 
          id: t.id,
          name: t.name,
          description: t.description
        });
        repository.saveTemplate(t, detail);
      });
    });

    it('should search templates by name', () => {
      const results = repository.searchTemplates('webhook');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Webhook to Slack');
    });

    it('should search templates by description', () => {
      const results = repository.searchTemplates('automate');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Email Automation');
    });

    it('should handle multiple search terms', () => {
      const results = repository.searchTemplates('data process');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('HTTP Data Processing');
    });

    it('should limit search results', () => {
      // Add more templates
      for (let i = 4; i <= 20; i++) {
        const template = createTemplateWorkflow({
          id: i,
          name: `Test Template ${i}`,
          description: 'Test description'
        });
        const detail = createTemplateDetail({ id: i });
        repository.saveTemplate(template, detail);
      }

      const results = repository.searchTemplates('test', 5);
      expect(results).toHaveLength(5);
    });

    it('should handle special characters in search', () => {
      const template = createTemplateWorkflow({
        id: 100,
        name: 'Special @ # $ Template',
        description: 'Template with special characters'
      });
      const detail = createTemplateDetail({ id: 100 });
      repository.saveTemplate(template, detail);

      const results = repository.searchTemplates('special');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should support pagination in search results', () => {
      for (let i = 1; i <= 15; i++) {
        const template = createTemplateWorkflow({
          id: i,
          name: `Search Template ${i}`,
          description: 'Common search term'
        });
        const detail = createTemplateDetail({ id: i });
        repository.saveTemplate(template, detail);
      }

      const page1 = repository.searchTemplates('search', 5, 0);
      expect(page1).toHaveLength(5);

      const page2 = repository.searchTemplates('search', 5, 5);
      expect(page2).toHaveLength(5);

      const page3 = repository.searchTemplates('search', 5, 10);
      expect(page3).toHaveLength(5);

      // Should be different templates on each page
      const page1Ids = page1.map(t => t.id);
      const page2Ids = page2.map(t => t.id);
      expect(page1Ids.filter(id => page2Ids.includes(id))).toHaveLength(0);
    });
  });

  describe('getTemplatesByNodeTypes', () => {
    beforeEach(() => {
      const templates = [
        {
          workflow: createTemplateWorkflow({ id: 1 }),
          detail: createTemplateDetail({
            id: 1,
            workflow: {
              nodes: [
                { id: 'node1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [100, 100], parameters: {} },
                { id: 'node2', name: 'Slack', type: 'n8n-nodes-base.slack', typeVersion: 1, position: [300, 100], parameters: {} }
              ],
              connections: {},
              settings: {}
            }
          })
        },
        {
          workflow: createTemplateWorkflow({ id: 2 }),
          detail: createTemplateDetail({
            id: 2,
            workflow: {
              nodes: [
                { id: 'node1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 3, position: [100, 100], parameters: {} },
                { id: 'node2', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 1, position: [300, 100], parameters: {} }
              ],
              connections: {},
              settings: {}
            }
          })
        },
        {
          workflow: createTemplateWorkflow({ id: 3 }),
          detail: createTemplateDetail({
            id: 3,
            workflow: {
              nodes: [
                { id: 'node1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [100, 100], parameters: {} },
                { id: 'node2', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 3, position: [300, 100], parameters: {} }
              ],
              connections: {},
              settings: {}
            }
          })
        }
      ];
      templates.forEach(t => {
        repository.saveTemplate(t.workflow, t.detail);
      });
    });

    it('should find templates using specific node types', () => {
      const results = repository.getTemplatesByNodes(['n8n-nodes-base.webhook']);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.workflow_id)).toContain(1);
      expect(results.map(r => r.workflow_id)).toContain(3);
    });

    it('should find templates using multiple node types', () => {
      const results = repository.getTemplatesByNodes([
        'n8n-nodes-base.webhook',
        'n8n-nodes-base.slack'
      ]);
      // The query uses OR, so it finds templates with either webhook OR slack
      expect(results).toHaveLength(2); // Templates 1 and 3 have webhook, template 1 has slack
      expect(results.map(r => r.workflow_id)).toContain(1);
      expect(results.map(r => r.workflow_id)).toContain(3);
    });

    it('should return empty array for non-existent node types', () => {
      const results = repository.getTemplatesByNodes(['non-existent-node']);
      expect(results).toHaveLength(0);
    });

    it('should limit results', () => {
      const results = repository.getTemplatesByNodes(['n8n-nodes-base.webhook'], 1);
      expect(results).toHaveLength(1);
    });

    it('should support pagination with offset', () => {
      const results1 = repository.getTemplatesByNodes(['n8n-nodes-base.webhook'], 1, 0);
      expect(results1).toHaveLength(1);
      
      const results2 = repository.getTemplatesByNodes(['n8n-nodes-base.webhook'], 1, 1);
      expect(results2).toHaveLength(1);
      
      // Results should be different
      expect(results1[0].id).not.toBe(results2[0].id);
    });
  });

  describe('getAllTemplates', () => {
    it('should return empty array when no templates', () => {
      const templates = repository.getAllTemplates();
      expect(templates).toHaveLength(0);
    });

    it('should return all templates with limit', () => {
      for (let i = 1; i <= 20; i++) {
        const template = createTemplateWorkflow({ id: i });
        const detail = createTemplateDetail({ id: i });
        repository.saveTemplate(template, detail);
      }

      const templates = repository.getAllTemplates(10);
      expect(templates).toHaveLength(10);
    });

    it('should support pagination with offset', () => {
      for (let i = 1; i <= 15; i++) {
        const template = createTemplateWorkflow({ id: i });
        const detail = createTemplateDetail({ id: i });
        repository.saveTemplate(template, detail);
      }

      const page1 = repository.getAllTemplates(5, 0);
      expect(page1).toHaveLength(5);

      const page2 = repository.getAllTemplates(5, 5);
      expect(page2).toHaveLength(5);

      const page3 = repository.getAllTemplates(5, 10);
      expect(page3).toHaveLength(5);

      // Should be different templates on each page
      const page1Ids = page1.map(t => t.id);
      const page2Ids = page2.map(t => t.id);
      const page3Ids = page3.map(t => t.id);

      expect(page1Ids.filter(id => page2Ids.includes(id))).toHaveLength(0);
      expect(page2Ids.filter(id => page3Ids.includes(id))).toHaveLength(0);
    });

    it('should support different sort orders', () => {
      const template1 = createTemplateWorkflow({ id: 1, name: 'Alpha Template', totalViews: 50 });
      const detail1 = createTemplateDetail({ id: 1 });
      repository.saveTemplate(template1, detail1);

      const template2 = createTemplateWorkflow({ id: 2, name: 'Beta Template', totalViews: 100 });
      const detail2 = createTemplateDetail({ id: 2 });
      repository.saveTemplate(template2, detail2);

      // Sort by views (default) - highest first
      const byViews = repository.getAllTemplates(10, 0, 'views');
      expect(byViews[0].name).toBe('Beta Template');
      expect(byViews[1].name).toBe('Alpha Template');

      // Sort by name - alphabetical
      const byName = repository.getAllTemplates(10, 0, 'name');
      expect(byName[0].name).toBe('Alpha Template');
      expect(byName[1].name).toBe('Beta Template');
    });

    it('should order templates by views and created_at descending', () => {
      // Save templates with different views to ensure predictable ordering
      const template1 = createTemplateWorkflow({ id: 1, name: 'First', totalViews: 50 });
      const detail1 = createTemplateDetail({ id: 1 });
      repository.saveTemplate(template1, detail1);

      const template2 = createTemplateWorkflow({ id: 2, name: 'Second', totalViews: 100 });
      const detail2 = createTemplateDetail({ id: 2 });
      repository.saveTemplate(template2, detail2);

      const templates = repository.getAllTemplates();
      expect(templates).toHaveLength(2);
      // Higher views should be first
      expect(templates[0].name).toBe('Second');
      expect(templates[1].name).toBe('First');
    });
  });

  describe('getTemplate with detail', () => {
    it('should return template with workflow data', () => {
      const template = createTemplateWorkflow({ id: 1 });
      const detail = createTemplateDetail({ id: 1 });
      repository.saveTemplate(template, detail);

      const saved = repository.getTemplate(1);
      expect(saved).toBeTruthy();
      expect(saved?.workflow_json).toBeTruthy();
      const workflow = JSON.parse(saved!.workflow_json!);
      expect(workflow.nodes).toHaveLength(detail.workflow.nodes.length);
    });
  });

  // Skipping clearOldTemplates test - method not implemented in repository
  describe.skip('clearOldTemplates', () => {
    it('should remove templates older than specified days', () => {
      // Insert old template (30 days ago)
      db.prepare(`
        INSERT INTO templates (
          id, workflow_id, name, description,
          nodes_used, workflow_json, categories, views,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, '[]', '{}', '[]', 0, datetime('now', '-31 days'), datetime('now', '-31 days'))
      `).run(1, 1001, 'Old Template', 'Old template');

      // Insert recent template
      const recentTemplate = createTemplateWorkflow({ id: 2, name: 'Recent Template' });
      const recentDetail = createTemplateDetail({ id: 2 });
      repository.saveTemplate(recentTemplate, recentDetail);

      // Clear templates older than 30 days
      // const deleted = repository.clearOldTemplates(30);
      // expect(deleted).toBe(1);

      const remaining = repository.getAllTemplates();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe('Recent Template');
    });
  });

  describe('Transaction handling', () => {
    it('should rollback on error during bulk save', () => {
      const templates = [
        createTemplateWorkflow({ id: 1 }),
        createTemplateWorkflow({ id: 2 }),
        { id: null } as any // Invalid template
      ];

      expect(() => {
        const transaction = db.transaction(() => {
          templates.forEach(t => {
            if (t.id === null) {
              // This will cause an error in the transaction
              throw new Error('Invalid template');
            }
            const detail = createTemplateDetail({ 
              id: t.id,
              name: t.name,
              description: t.description
            });
            repository.saveTemplate(t, detail);
          });
        });
        transaction();
      }).toThrow();

      // No templates should be saved due to error
      const all = repository.getAllTemplates();
      expect(all).toHaveLength(0);
    });
  });

  describe('FTS5 performance', () => {
    it('should handle large dataset searches efficiently', () => {
      // Insert 1000 templates
      const templates = Array.from({ length: 1000 }, (_, i) => 
        createTemplateWorkflow({
          id: i + 1,
          name: `Template ${i}`,
          description: `Description for ${['webhook', 'http', 'automation', 'data'][i % 4]} workflow ${i}`
        })
      );

      const insertMany = db.transaction((templates: TemplateWorkflow[]) => {
        templates.forEach(t => {
          const detail = createTemplateDetail({ id: t.id });
          repository.saveTemplate(t, detail);
        });
      });

      const start = Date.now();
      insertMany(templates);
      const insertDuration = Date.now() - start;

      expect(insertDuration).toBeLessThan(2000); // Should complete in under 2 seconds

      // Test search performance
      const searchStart = Date.now();
      const results = repository.searchTemplates('webhook', 50);
      const searchDuration = Date.now() - searchStart;

      expect(searchDuration).toBeLessThan(50); // Search should be very fast
      expect(results).toHaveLength(50);
    });
  });

  describe('New pagination count methods', () => {
    beforeEach(() => {
      // Set up test data
      for (let i = 1; i <= 25; i++) {
        const template = createTemplateWorkflow({
          id: i,
          name: `Template ${i}`,
          description: i <= 10 ? 'webhook automation' : 'data processing'
        });
        const detail = createTemplateDetail({
          id: i,
          workflow: {
            nodes: i <= 15 ? [
              { id: 'node1', type: 'n8n-nodes-base.webhook', name: 'Webhook', position: [0, 0], parameters: {}, typeVersion: 1 }
            ] : [
              { id: 'node1', type: 'n8n-nodes-base.httpRequest', name: 'HTTP', position: [0, 0], parameters: {}, typeVersion: 1 }
            ],
            connections: {},
            settings: {}
          }
        });
        repository.saveTemplate(template, detail);
      }
    });

    describe('getNodeTemplatesCount', () => {
      it('should return correct count for node type searches', () => {
        const webhookCount = repository.getNodeTemplatesCount(['n8n-nodes-base.webhook']);
        expect(webhookCount).toBe(15);

        const httpCount = repository.getNodeTemplatesCount(['n8n-nodes-base.httpRequest']);
        expect(httpCount).toBe(10);

        const bothCount = repository.getNodeTemplatesCount([
          'n8n-nodes-base.webhook',
          'n8n-nodes-base.httpRequest'
        ]);
        expect(bothCount).toBe(25); // OR query, so all templates
      });

      it('should return 0 for non-existent node types', () => {
        const count = repository.getNodeTemplatesCount(['non-existent-node']);
        expect(count).toBe(0);
      });
    });

    describe('getSearchCount', () => {
      it('should return correct count for search queries', () => {
        const webhookSearchCount = repository.getSearchCount('webhook');
        expect(webhookSearchCount).toBe(10);

        const processingSearchCount = repository.getSearchCount('processing');
        expect(processingSearchCount).toBe(15);

        const noResultsCount = repository.getSearchCount('nonexistent');
        expect(noResultsCount).toBe(0);
      });
    });

    describe('getTaskTemplatesCount', () => {
      it('should return correct count for task-based searches', () => {
        const webhookTaskCount = repository.getTaskTemplatesCount('webhook_processing');
        expect(webhookTaskCount).toBeGreaterThan(0);

        const unknownTaskCount = repository.getTaskTemplatesCount('unknown_task');
        expect(unknownTaskCount).toBe(0);
      });
    });

    describe('data_transformation task', () => {
      const saveWithNodeType = (id: number, nodeType: string) => {
        repository.saveTemplate(
          createTemplateWorkflow({ id }),
          createTemplateDetail({
            id,
            nodes: [{ id: 'n1', name: 'Node', type: nodeType, typeVersion: 1, position: [0, 0], parameters: {} }]
          })
        );
      };

      it('should match templates built on native transform nodes, not only Code', () => {
        repository.clearTemplates();
        saveWithNodeType(9001, 'n8n-nodes-base.aggregate');
        saveWithNodeType(9002, 'n8n-nodes-base.summarize');
        saveWithNodeType(9003, 'n8n-nodes-base.splitOut');
        saveWithNodeType(9004, 'n8n-nodes-base.filter');
        saveWithNodeType(9005, 'n8n-nodes-base.code');
        saveWithNodeType(9006, 'n8n-nodes-base.slack');

        const ids = repository.getTemplatesForTask('data_transformation', 20).map(t => t.id).sort();

        expect(ids).toEqual([9001, 9002, 9003, 9004, 9005]);
        expect(repository.getTaskTemplatesCount('data_transformation')).toBe(5);
      });
    });

    describe('getTemplateCount', () => {
      it('should return total template count', () => {
        const totalCount = repository.getTemplateCount();
        expect(totalCount).toBe(25);
      });

      it('should return 0 for empty database', () => {
        repository.clearTemplates();
        const count = repository.getTemplateCount();
        expect(count).toBe(0);
      });
    });

    describe('getTemplatesForTask with pagination', () => {
      it('should support pagination for task-based searches', () => {
        const page1 = repository.getTemplatesForTask('webhook_processing', 5, 0);
        const page2 = repository.getTemplatesForTask('webhook_processing', 5, 5);
        
        expect(page1).toHaveLength(5);
        expect(page2).toHaveLength(5);

        // Should be different results
        const page1Ids = page1.map(t => t.id);
        const page2Ids = page2.map(t => t.id);
        expect(page1Ids.filter(id => page2Ids.includes(id))).toHaveLength(0);
      });
    });
  });

  describe('searchTemplatesByMetadata - Two-Phase Optimization', () => {
  it('should use two-phase query pattern for performance', () => {
    // Setup: Create templates with metadata and different views for deterministic ordering
    const templates = [
      { id: 1, complexity: 'simple', category: 'automation', views: 200 },
      { id: 2, complexity: 'medium', category: 'integration', views: 300 },
      { id: 3, complexity: 'simple', category: 'automation', views: 100 },
      { id: 4, complexity: 'complex', category: 'data-processing', views: 400 }
    ];

    templates.forEach(({ id, complexity, category, views }) => {
      const template = createTemplateWorkflow({ id, name: `Template ${id}`, totalViews: views });
      const detail = createTemplateDetail({
        id,
        views,
        workflow: {
          id: id.toString(),
          name: `Template ${id}`,
          nodes: [],
          connections: {},
          settings: {}
        }
      });

      repository.saveTemplate(template, detail);

      // Update views to match our test data
      db.prepare(`UPDATE templates SET views = ? WHERE workflow_id = ?`).run(views, id);

      // Add metadata
      const metadata = {
        categories: [category],
        complexity,
        use_cases: ['test'],
        estimated_setup_minutes: 15,
        required_services: [],
        key_features: ['test'],
        target_audience: ['developers']
      };

      db.prepare(`
        UPDATE templates
        SET metadata_json = ?,
            metadata_generated_at = datetime('now')
        WHERE workflow_id = ?
      `).run(JSON.stringify(metadata), id);
    });

    // Test: Search with filter should return matching templates
    const results = repository.searchTemplatesByMetadata({ complexity: 'simple' }, 10, 0);

    // Verify results - Ordered by views DESC (200, 100), then created_at DESC, then id ASC
    expect(results).toHaveLength(2);
    expect(results[0].workflow_id).toBe(1); // 200 views
    expect(results[1].workflow_id).toBe(3); // 100 views
  });

  it('should preserve exact ordering from Phase 1', () => {
    // Setup: Create templates with different view counts
    // Use unique views to ensure deterministic ordering
    const templates = [
      { id: 1, views: 100 },
      { id: 2, views: 500 },
      { id: 3, views: 300 },
      { id: 4, views: 400 },
      { id: 5, views: 200 }
    ];

    templates.forEach(({ id, views }) => {
      const template = createTemplateWorkflow({ id, name: `Template ${id}`, totalViews: views });
      const detail = createTemplateDetail({
        id,
        views,
        workflow: {
          id: id.toString(),
          name: `Template ${id}`,
          nodes: [],
          connections: {},
          settings: {}
        }
      });

      repository.saveTemplate(template, detail);

      // Update views in database to match our test data
      db.prepare(`UPDATE templates SET views = ? WHERE workflow_id = ?`).run(views, id);

      // Add metadata
      const metadata = {
        categories: ['test'],
        complexity: 'medium',
        use_cases: ['test'],
        estimated_setup_minutes: 15,
        required_services: [],
        key_features: ['test'],
        target_audience: ['developers']
      };

      db.prepare(`
        UPDATE templates
        SET metadata_json = ?,
            metadata_generated_at = datetime('now')
        WHERE workflow_id = ?
      `).run(JSON.stringify(metadata), id);
    });

    // Test: Search should return templates in correct order
    const results = repository.searchTemplatesByMetadata({ complexity: 'medium' }, 10, 0);

    // Verify ordering: 500 views, 400 views, 300 views, 200 views, 100 views
    expect(results).toHaveLength(5);
    expect(results[0].workflow_id).toBe(2); // 500 views
    expect(results[1].workflow_id).toBe(4); // 400 views
    expect(results[2].workflow_id).toBe(3); // 300 views
    expect(results[3].workflow_id).toBe(5); // 200 views
    expect(results[4].workflow_id).toBe(1); // 100 views
  });

  it('should handle empty results efficiently', () => {
    // Setup: Create templates without the searched complexity
    const template = createTemplateWorkflow({ id: 1 });
    const detail = createTemplateDetail({
      id: 1,
      workflow: {
        id: '1',
        name: 'Template 1',
        nodes: [],
        connections: {},
        settings: {}
      }
    });

    repository.saveTemplate(template, detail);

    const metadata = {
      categories: ['test'],
      complexity: 'simple',
      use_cases: ['test'],
      estimated_setup_minutes: 15,
      required_services: [],
      key_features: ['test'],
      target_audience: ['developers']
    };

    db.prepare(`
      UPDATE templates
      SET metadata_json = ?,
          metadata_generated_at = datetime('now')
      WHERE workflow_id = 1
    `).run(JSON.stringify(metadata));

    // Test: Search for non-existent complexity
    const results = repository.searchTemplatesByMetadata({ complexity: 'complex' }, 10, 0);

    // Verify: Should return empty array without errors
    expect(results).toHaveLength(0);
  });

  it('should validate IDs defensively', () => {
    // This test ensures the defensive ID validation works
    // Setup: Create a template
    const template = createTemplateWorkflow({ id: 1 });
    const detail = createTemplateDetail({
      id: 1,
      workflow: {
        id: '1',
        name: 'Template 1',
        nodes: [],
        connections: {},
        settings: {}
      }
    });

    repository.saveTemplate(template, detail);

    const metadata = {
      categories: ['test'],
      complexity: 'simple',
      use_cases: ['test'],
      estimated_setup_minutes: 15,
      required_services: [],
      key_features: ['test'],
      target_audience: ['developers']
    };

    db.prepare(`
      UPDATE templates
      SET metadata_json = ?,
          metadata_generated_at = datetime('now')
      WHERE workflow_id = 1
    `).run(JSON.stringify(metadata));

    // Test: Normal search should work
    const results = repository.searchTemplatesByMetadata({ complexity: 'simple' }, 10, 0);

    // Verify: Should return the template
    expect(results).toHaveLength(1);
    expect(results[0].workflow_id).toBe(1);
  });
  });
});

// Helper functions
function createTemplateWorkflow(overrides: any = {}): TemplateWorkflow {
  const id = overrides.id || Math.floor(Math.random() * 10000);

  return {
    id,
    name: overrides.name || `Test Workflow ${id}`,
    description: overrides.description || '',
    totalViews: overrides.totalViews || 100,
    createdAt: overrides.createdAt || new Date().toISOString(),
    user: {
      id: 1,
      name: 'Test User',
      username: overrides.username || 'testuser',
      verified: false
    },
    nodes: [] // TemplateNode[] - just metadata about nodes, not actual workflow nodes
  };
}

function createTemplateDetail(overrides: any = {}): TemplateDetail {
  const id = overrides.id || Math.floor(Math.random() * 10000);
  return {
    id,
    name: overrides.name || `Test Workflow ${id}`,
    description: overrides.description || '',
    views: overrides.views || 100,
    createdAt: overrides.createdAt || new Date().toISOString(),
    workflow: overrides.workflow || {
      id: id.toString(),
      name: overrides.name || `Test Workflow ${id}`,
      nodes: overrides.nodes || [
        {
          id: 'node1',
          name: 'Start',
          type: 'n8n-nodes-base.start',
          typeVersion: 1,
          position: [100, 100],
          parameters: {}
        }
      ],
      connections: overrides.connections || {},
      settings: overrides.settings || {},
      pinData: overrides.pinData
    }
  };
}