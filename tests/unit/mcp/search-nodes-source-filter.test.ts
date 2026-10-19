import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';

/**
 * Tests for MCP server search_nodes source filtering functionality.
 *
 * The source filter allows filtering search results by node source:
 * - 'all': Returns all nodes (default)
 * - 'core': Returns only core n8n nodes (is_community = 0)
 * - 'community': Returns only community nodes (is_community = 1)
 * - 'verified': Returns only verified community nodes (is_community = 1 AND is_verified = 1)
 */

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock database and FTS5
interface MockRow {
  node_type: string;
  display_name: string;
  description: string;
  package_name: string;
  category: string;
  is_community: number;
  is_verified: number;
  author_name?: string;
  npm_package_name?: string;
  npm_downloads?: number;
  properties_schema: string;
  operations: string;
  credentials_required: string;
  is_ai_tool: number;
  is_trigger: number;
  is_webhook: number;
  is_versioned: number;
}

describe('MCP Server - search_nodes source filter', () => {
  // Sample test data representing different node types
  const sampleNodes: MockRow[] = [
    // Core nodes
    {
      node_type: 'nodes-base.httpRequest',
      display_name: 'HTTP Request',
      description: 'Makes HTTP requests',
      package_name: 'n8n-nodes-base',
      category: 'Core',
      is_community: 0,
      is_verified: 0,
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 1,
    },
    {
      node_type: 'nodes-base.slack',
      display_name: 'Slack',
      description: 'Send messages to Slack',
      package_name: 'n8n-nodes-base',
      category: 'Communication',
      is_community: 0,
      is_verified: 0,
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 1,
    },
    // Verified community nodes
    {
      node_type: 'n8n-nodes-verified-pkg.verifiedNode',
      display_name: 'Verified Community Node',
      description: 'A verified community node',
      package_name: 'n8n-nodes-verified-pkg',
      category: 'Community',
      is_community: 1,
      is_verified: 1,
      author_name: 'Verified Author',
      npm_package_name: 'n8n-nodes-verified-pkg',
      npm_downloads: 5000,
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 0,
    },
    // Unverified community nodes
    {
      node_type: 'n8n-nodes-unverified-pkg.unverifiedNode',
      display_name: 'Unverified Community Node',
      description: 'An unverified community node',
      package_name: 'n8n-nodes-unverified-pkg',
      category: 'Community',
      is_community: 1,
      is_verified: 0,
      author_name: 'Community Author',
      npm_package_name: 'n8n-nodes-unverified-pkg',
      npm_downloads: 1000,
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 0,
    },
  ];

  describe('Source filter SQL generation', () => {
    type SourceFilter = 'all' | 'core' | 'community' | 'verified';

    function generateSourceFilter(source: SourceFilter): string {
      switch (source) {
        case 'core':
          return 'AND is_community = 0';
        case 'community':
          return 'AND is_community = 1';
        case 'verified':
          return 'AND is_community = 1 AND is_verified = 1';
        case 'all':
        default:
          return '';
      }
    }

    it('should generate no filter for source=all', () => {
      expect(generateSourceFilter('all')).toBe('');
    });

    it('should generate correct filter for source=core', () => {
      expect(generateSourceFilter('core')).toBe('AND is_community = 0');
    });

    it('should generate correct filter for source=community', () => {
      expect(generateSourceFilter('community')).toBe('AND is_community = 1');
    });

    it('should generate correct filter for source=verified', () => {
      expect(generateSourceFilter('verified')).toBe('AND is_community = 1 AND is_verified = 1');
    });
  });

  describe('Source filter application', () => {
    function filterNodes(nodes: MockRow[], source: string): MockRow[] {
      switch (source) {
        case 'core':
          return nodes.filter((n) => n.is_community === 0);
        case 'community':
          return nodes.filter((n) => n.is_community === 1);
        case 'verified':
          return nodes.filter((n) => n.is_community === 1 && n.is_verified === 1);
        case 'all':
        default:
          return nodes;
      }
    }

    it('should return all nodes with source=all', () => {
      const result = filterNodes(sampleNodes, 'all');

      expect(result).toHaveLength(4);
      expect(result.some((n) => n.is_community === 0)).toBe(true);
      expect(result.some((n) => n.is_community === 1)).toBe(true);
    });

    it('should return only core nodes with source=core', () => {
      const result = filterNodes(sampleNodes, 'core');

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.is_community === 0)).toBe(true);
      expect(result.some((n) => n.node_type === 'nodes-base.httpRequest')).toBe(true);
      expect(result.some((n) => n.node_type === 'nodes-base.slack')).toBe(true);
    });

    it('should return only community nodes with source=community', () => {
      const result = filterNodes(sampleNodes, 'community');

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.is_community === 1)).toBe(true);
    });

    it('should return only verified community nodes with source=verified', () => {
      const result = filterNodes(sampleNodes, 'verified');

      expect(result).toHaveLength(1);
      expect(result.every((n) => n.is_community === 1 && n.is_verified === 1)).toBe(true);
      expect(result[0].node_type).toBe('n8n-nodes-verified-pkg.verifiedNode');
    });

    it('should handle empty result for verified filter when no verified nodes', () => {
      const noVerifiedNodes = sampleNodes.filter((n) => n.is_verified !== 1);
      const result = filterNodes(noVerifiedNodes, 'verified');

      expect(result).toHaveLength(0);
    });

    it('should handle default to all when source is undefined', () => {
      const result = filterNodes(sampleNodes, undefined as any);

      expect(result).toHaveLength(4);
    });
  });

  describe('Community metadata in results', () => {
    function enrichNodeWithCommunityMetadata(node: MockRow): any {
      return {
        nodeType: node.node_type,
        displayName: node.display_name,
        description: node.description,
        package: node.package_name,
        // Community-specific metadata
        isCommunity: node.is_community === 1,
        isVerified: node.is_verified === 1,
        authorName: node.author_name || null,
        npmPackageName: node.npm_package_name || null,
        npmDownloads: node.npm_downloads || 0,
      };
    }

    it('should include community metadata for community nodes', () => {
      const communityNode = sampleNodes.find((n) => n.is_community === 1 && n.is_verified === 1);
      const result = enrichNodeWithCommunityMetadata(communityNode!);

      expect(result.isCommunity).toBe(true);
      expect(result.isVerified).toBe(true);
      expect(result.authorName).toBe('Verified Author');
      expect(result.npmPackageName).toBe('n8n-nodes-verified-pkg');
      expect(result.npmDownloads).toBe(5000);
    });

    it('should set community flags to false for core nodes', () => {
      const coreNode = sampleNodes.find((n) => n.is_community === 0);
      const result = enrichNodeWithCommunityMetadata(coreNode!);

      expect(result.isCommunity).toBe(false);
      expect(result.isVerified).toBe(false);
      expect(result.authorName).toBeNull();
      expect(result.npmPackageName).toBeNull();
      expect(result.npmDownloads).toBe(0);
    });

    it('should correctly identify unverified community nodes', () => {
      const unverifiedNode = sampleNodes.find(
        (n) => n.is_community === 1 && n.is_verified === 0
      );
      const result = enrichNodeWithCommunityMetadata(unverifiedNode!);

      expect(result.isCommunity).toBe(true);
      expect(result.isVerified).toBe(false);
    });
  });

  describe('Combined search and source filter', () => {
    function searchWithSourceFilter(
      nodes: MockRow[],
      query: string,
      source: string
    ): MockRow[] {
      const queryLower = query.toLowerCase();

      // First apply search filter
      const searchResults = nodes.filter(
        (n) =>
          n.display_name.toLowerCase().includes(queryLower) ||
          n.description.toLowerCase().includes(queryLower) ||
          n.node_type.toLowerCase().includes(queryLower)
      );

      // Then apply source filter
      switch (source) {
        case 'core':
          return searchResults.filter((n) => n.is_community === 0);
        case 'community':
          return searchResults.filter((n) => n.is_community === 1);
        case 'verified':
          return searchResults.filter(
            (n) => n.is_community === 1 && n.is_verified === 1
          );
        case 'all':
        default:
          return searchResults;
      }
    }

    it('should combine search query with source filter', () => {
      const result = searchWithSourceFilter(sampleNodes, 'node', 'community');

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.is_community === 1)).toBe(true);
    });

    it('should return empty when search matches but source does not', () => {
      const result = searchWithSourceFilter(sampleNodes, 'slack', 'community');

      expect(result).toHaveLength(0);
    });

    it('should return matching core nodes only with source=core', () => {
      const result = searchWithSourceFilter(sampleNodes, 'http', 'core');

      expect(result).toHaveLength(1);
      expect(result[0].node_type).toBe('nodes-base.httpRequest');
    });

    it('should return matching verified nodes only with source=verified', () => {
      const result = searchWithSourceFilter(sampleNodes, 'verified', 'verified');

      expect(result).toHaveLength(1);
      expect(result[0].is_verified).toBe(1);
    });

    it('should handle case-insensitive search with source filter', () => {
      // Note: "VERIFIED" matches both "Verified Community Node" and "Unverified Community Node"
      // because "VERIFIED" is a substring of both when doing case-insensitive search
      const result = searchWithSourceFilter(sampleNodes, 'VERIFIED', 'community');

      expect(result).toHaveLength(2); // Both match the search term
      expect(result.every((n) => n.is_community === 1)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle invalid source value gracefully', () => {
      const invalidSource = 'invalid' as any;
      let sourceFilter = '';

      switch (invalidSource) {
        case 'core':
          sourceFilter = 'AND is_community = 0';
          break;
        case 'community':
          sourceFilter = 'AND is_community = 1';
          break;
        case 'verified':
          sourceFilter = 'AND is_community = 1 AND is_verified = 1';
          break;
        // Falls through to no filter (same as 'all')
      }

      expect(sourceFilter).toBe('');
    });

    it('should handle null source value', () => {
      const nullSource = null as any;
      let sourceFilter = '';

      switch (nullSource) {
        case 'core':
          sourceFilter = 'AND is_community = 0';
          break;
        case 'community':
          sourceFilter = 'AND is_community = 1';
          break;
        case 'verified':
          sourceFilter = 'AND is_community = 1 AND is_verified = 1';
          break;
      }

      expect(sourceFilter).toBe('');
    });

    it('should handle database with only core nodes', () => {
      const coreOnlyNodes = sampleNodes.filter((n) => n.is_community === 0);

      const coreResult = coreOnlyNodes.filter((n) => n.is_community === 0);
      const communityResult = coreOnlyNodes.filter((n) => n.is_community === 1);
      const verifiedResult = coreOnlyNodes.filter(
        (n) => n.is_community === 1 && n.is_verified === 1
      );

      expect(coreResult).toHaveLength(2);
      expect(communityResult).toHaveLength(0);
      expect(verifiedResult).toHaveLength(0);
    });

    it('should handle database with only community nodes', () => {
      const communityOnlyNodes = sampleNodes.filter((n) => n.is_community === 1);

      const coreResult = communityOnlyNodes.filter((n) => n.is_community === 0);
      const communityResult = communityOnlyNodes.filter((n) => n.is_community === 1);

      expect(coreResult).toHaveLength(0);
      expect(communityResult).toHaveLength(2);
    });

    it('should handle empty database', () => {
      const emptyNodes: MockRow[] = [];

      const allResult = emptyNodes;
      const coreResult = emptyNodes.filter((n) => n.is_community === 0);
      const communityResult = emptyNodes.filter((n) => n.is_community === 1);
      const verifiedResult = emptyNodes.filter(
        (n) => n.is_community === 1 && n.is_verified === 1
      );

      expect(allResult).toHaveLength(0);
      expect(coreResult).toHaveLength(0);
      expect(communityResult).toHaveLength(0);
      expect(verifiedResult).toHaveLength(0);
    });
  });

  describe('FTS5 integration with source filter', () => {
    // Mock FTS5 query with source filter
    function buildFts5Query(searchQuery: string, source: string): string {
      let sourceFilter = '';
      switch (source) {
        case 'core':
          sourceFilter = 'AND n.is_community = 0';
          break;
        case 'community':
          sourceFilter = 'AND n.is_community = 1';
          break;
        case 'verified':
          sourceFilter = 'AND n.is_community = 1 AND n.is_verified = 1';
          break;
      }

      return `
        SELECT
          n.*,
          rank
        FROM nodes n
        JOIN nodes_fts ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
        ${sourceFilter}
        ORDER BY rank
        LIMIT ?
      `.trim();
    }

    it('should include source filter in FTS5 query for core', () => {
      const query = buildFts5Query('http', 'core');

      expect(query).toContain('AND n.is_community = 0');
      expect(query).not.toContain('is_verified');
    });

    it('should include source filter in FTS5 query for community', () => {
      const query = buildFts5Query('http', 'community');

      expect(query).toContain('AND n.is_community = 1');
      expect(query).not.toContain('is_verified');
    });

    it('should include both filters in FTS5 query for verified', () => {
      const query = buildFts5Query('http', 'verified');

      expect(query).toContain('AND n.is_community = 1');
      expect(query).toContain('AND n.is_verified = 1');
    });

    it('should not include source filter for all', () => {
      const query = buildFts5Query('http', 'all');

      expect(query).not.toContain('is_community');
      expect(query).not.toContain('is_verified');
    });
  });

  describe('search_nodes server behavior', () => {
    let server: N8NDocumentationMCPServer;
    let previousDbPath: string | undefined;

    beforeEach(async () => {
      previousDbPath = process.env.NODE_DB_PATH;
      process.env.NODE_DB_PATH = ':memory:';
      server = new N8NDocumentationMCPServer();
      await (server as any).initialized;

      const db = (server as any).db;
      const insertNode = db.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description, category,
          is_community, is_verified, operations
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let index = 0; index < 5; index++) {
        insertNode.run(
          `n8n-nodes-test.community${index}`,
          'n8n-nodes-test',
          `Community Operation ${index}`,
          'Runs an operation in a third-party service',
          'Community',
          1,
          0,
          '[]'
        );
      }

      insertNode.run(
        'nodes-base.noOp',
        'n8n-nodes-base',
        'No Operation, do nothing',
        'A core node that does nothing',
        'Core',
        0,
        0,
        '[]'
      );
      insertNode.run(
        'nodes-base.webhook',
        'n8n-nodes-base',
        'Webhook',
        'Starts a workflow from a webhook request',
        'Core',
        0,
        0,
        '[]'
      );
      insertNode.run(
        'n8n-nodes-test.webhook',
        'n8n-nodes-test',
        'Webhook Community',
        'Starts a workflow from a webhook request',
        'Community',
        1,
        0,
        '[]'
      );
    });

    afterEach(() => {
      if (previousDbPath === undefined) {
        delete process.env.NODE_DB_PATH;
      } else {
        process.env.NODE_DB_PATH = previousDbPath;
      }
    });

    it('ranks an exact core node name ahead of incidental OR matches', async () => {
      const result = await (server as any).searchNodes('No Operation', 1, {});

      expect(result.results[0].nodeType).toBe('nodes-base.noOp');
    });

    it('preserves AND semantics when FTS is unavailable', async () => {
      const result = await (server as any).searchNodes('webhook operation', 20, {
        mode: 'AND',
        source: 'core'
      });

      expect(result.results).toHaveLength(0);
    });

    it('applies the source filter in fuzzy mode', async () => {
      const result = await (server as any).searchNodes('webhook', 20, {
        mode: 'FUZZY',
        source: 'core'
      });

      expect(result.mode).toBe('FUZZY');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((node: any) => node.package === 'n8n-nodes-base')).toBe(true);
    });

    it('returns community metadata and examples in fuzzy mode', async () => {
      const db = (server as any).db;
      const originalPrepare = db.prepare.bind(db);
      db.prepare = vi.fn((query: string) => {
        if (query.includes('template_node_configs')) {
          return {
            all: vi.fn(() => [{
              parameters_json: JSON.stringify({ path: 'webhook' }),
              template_name: 'Webhook example',
              template_views: 10
            }])
          };
        }
        return originalPrepare(query);
      });

      const result = await (server as any).searchNodes('webhook', 20, {
        mode: 'FUZZY',
        source: 'community',
        includeExamples: true
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((node: any) => node.isCommunity === true)).toBe(true);
      expect(result.results[0].examples[0].template).toBe('Webhook example');
    });

    it('preserves the core source filter after an FTS syntax error', async () => {
      const db = (server as any).db;
      db.exec(`
        CREATE VIRTUAL TABLE nodes_fts USING fts5(
          node_type, display_name, description, documentation, operations
        )
      `);
      db.exec(`
        INSERT INTO nodes_fts(rowid, node_type, display_name, description, operations)
        SELECT rowid, node_type, display_name, description, operations FROM nodes
      `);

      const result = await (server as any).searchNodes('webhook OR', 20, { source: 'core' });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((node: any) => node.package === 'n8n-nodes-base')).toBe(true);
    });
  });
});
