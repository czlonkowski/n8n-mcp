import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeRepository, CommunityNodeFields } from '@/database/node-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '@/database/database-adapter';
import { ParsedNode } from '@/parsers/node-parser';

/**
 * Mock DatabaseAdapter for testing community node methods
 */
class MockDatabaseAdapter implements DatabaseAdapter {
  private statements = new Map<string, MockPreparedStatement>();
  private mockData: Map<string, any[]> = new Map();

  prepare = vi.fn((sql: string) => {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, new MockPreparedStatement(sql, this.mockData, this));
    }
    return this.statements.get(sql)!;
  });

  exec = vi.fn();
  close = vi.fn();
  pragma = vi.fn();
  transaction = vi.fn((fn: () => any) => fn());
  checkFTS5Support = vi.fn(() => true);
  inTransaction = false;

  // Test helpers
  _setMockData(key: string, data: any[]) {
    this.mockData.set(key, data);
  }

  _getMockData(key: string): any[] {
    return this.mockData.get(key) || [];
  }
}

class MockPreparedStatement implements PreparedStatement {
  run = vi.fn((..._params: any[]): RunResult => ({ changes: 1, lastInsertRowid: 1 }));
  get = vi.fn();
  all = vi.fn(() => []);
  iterate = vi.fn();
  pluck = vi.fn(() => this);
  expand = vi.fn(() => this);
  raw = vi.fn(() => this);
  columns = vi.fn(() => []);
  bind = vi.fn(() => this);

  constructor(
    private sql: string,
    private mockData: Map<string, any[]>,
    private adapter: MockDatabaseAdapter
  ) {
    this.setupMockBehavior();
  }

  private setupMockBehavior() {
    // Community nodes queries
    if (this.sql.includes('SELECT * FROM nodes WHERE is_community = 1')) {
      this.all = vi.fn((...params: any[]) => {
        let nodes = this.mockData.get('community_nodes') || [];

        // Handle verified filter
        if (this.sql.includes('AND is_verified = ?')) {
          const isVerified = params[0] === 1;
          nodes = nodes.filter((n: any) => n.is_verified === (isVerified ? 1 : 0));
        }

        // Handle limit
        if (this.sql.includes('LIMIT ?')) {
          const limitParam = params[params.length - 1];
          nodes = nodes.slice(0, limitParam);
        }

        return nodes;
      });
    }

    // Community stats - total count
    if (this.sql.includes('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1') &&
        !this.sql.includes('AND is_verified')) {
      this.get = vi.fn(() => {
        const nodes = this.mockData.get('community_nodes') || [];
        return { count: nodes.length };
      });
    }

    // Community stats - verified count
    if (this.sql.includes('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1 AND is_verified = 1')) {
      this.get = vi.fn(() => {
        const nodes = this.mockData.get('community_nodes') || [];
        return { count: nodes.filter((n: any) => n.is_verified === 1).length };
      });
    }

    // hasNodeByNpmPackage
    if (this.sql.includes('SELECT 1 FROM nodes WHERE npm_package_name = ?')) {
      this.get = vi.fn((npmPackageName: string) => {
        const nodes = this.mockData.get('community_nodes') || [];
        const found = nodes.find((n: any) => n.npm_package_name === npmPackageName);
        return found ? { '1': 1 } : undefined;
      });
    }

    // getNodeByNpmPackage
    if (this.sql.includes('SELECT * FROM nodes WHERE npm_package_name = ?')) {
      this.get = vi.fn((npmPackageName: string) => {
        const nodes = this.mockData.get('community_nodes') || [];
        return nodes.find((n: any) => n.npm_package_name === npmPackageName);
      });
    }

    // deleteCommunityNodes
    if (this.sql.includes('DELETE FROM nodes WHERE is_community = 1')) {
      this.run = vi.fn(() => {
        const nodes = this.mockData.get('community_nodes') || [];
        const count = nodes.length;
        this.mockData.set('community_nodes', []);
        return { changes: count, lastInsertRowid: 0 };
      });
    }

    // saveNode - SELECT existing doc fields before upsert
    if (this.sql.includes('SELECT npm_readme, ai_documentation_summary, ai_summary_generated_at FROM nodes')) {
      this.get = vi.fn(() => undefined); // No existing row by default
    }

    // saveNode - INSERT OR REPLACE
    if (this.sql.includes('INSERT OR REPLACE INTO nodes')) {
      this.run = vi.fn((...params: any[]): RunResult => {
        const nodes = this.mockData.get('community_nodes') || [];
        const nodeType = params[0];

        // Remove existing node with same type
        const filteredNodes = nodes.filter((n: any) => n.node_type !== nodeType);

        // Add new node (simplified)
        const newNode = {
          node_type: params[0],
          package_name: params[1],
          display_name: params[2],
          description: params[3],
          is_community: params[20] || 0,
          is_verified: params[21] || 0,
          npm_package_name: params[24],
          npm_version: params[25],
          npm_downloads: params[26] || 0,
          author_name: params[22],
        };

        filteredNodes.push(newNode);
        this.mockData.set('community_nodes', filteredNodes);

        return { changes: 1, lastInsertRowid: filteredNodes.length };
      });
    }
  }
}

describe('NodeRepository - Community Node Methods', () => {
  let repository: NodeRepository;
  let mockAdapter: MockDatabaseAdapter;

  // Sample community node data
  const sampleCommunityNodes = [
    {
      node_type: 'n8n-nodes-verified.testNode',
      package_name: 'n8n-nodes-verified',
      display_name: 'Verified Test Node',
      description: 'A verified community node',
      category: 'Community',
      development_style: 'declarative',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 0,
      is_tool_variant: 0,
      has_tool_variant: 0,
      version: '1.0.0',
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_community: 1,
      is_verified: 1,
      author_name: 'Verified Author',
      author_github_url: 'https://github.com/verified',
      npm_package_name: 'n8n-nodes-verified',
      npm_version: '1.0.0',
      npm_downloads: 5000,
      community_fetched_at: '2024-01-01T00:00:00.000Z',
    },
    {
      node_type: 'n8n-nodes-unverified.testNode',
      package_name: 'n8n-nodes-unverified',
      display_name: 'Unverified Test Node',
      description: 'An unverified community node',
      category: 'Community',
      development_style: 'declarative',
      is_ai_tool: 0,
      is_trigger: 1,
      is_webhook: 0,
      is_versioned: 0,
      is_tool_variant: 0,
      has_tool_variant: 0,
      version: '0.5.0',
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_community: 1,
      is_verified: 0,
      author_name: 'Community Author',
      author_github_url: 'https://github.com/community',
      npm_package_name: 'n8n-nodes-unverified',
      npm_version: '0.5.0',
      npm_downloads: 1000,
      community_fetched_at: '2024-01-02T00:00:00.000Z',
    },
    {
      node_type: 'n8n-nodes-popular.testNode',
      package_name: 'n8n-nodes-popular',
      display_name: 'Popular Test Node',
      description: 'A popular verified community node',
      category: 'Community',
      development_style: 'declarative',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 1,
      is_versioned: 1,
      is_tool_variant: 0,
      has_tool_variant: 0,
      version: '2.0.0',
      properties_schema: '[]',
      operations: '[]',
      credentials_required: '[]',
      is_community: 1,
      is_verified: 1,
      author_name: 'Popular Author',
      author_github_url: 'https://github.com/popular',
      npm_package_name: 'n8n-nodes-popular',
      npm_version: '2.0.0',
      npm_downloads: 50000,
      community_fetched_at: '2024-01-03T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = new MockDatabaseAdapter();
    repository = new NodeRepository(mockAdapter);
  });

  describe('getCommunityNodes', () => {
    beforeEach(() => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);
    });

    it('should return all community nodes', () => {
      const nodes = repository.getCommunityNodes();

      expect(nodes).toHaveLength(3);
      expect(nodes[0].isCommunity).toBe(true);
    });

    it('should filter by verified status', () => {
      const verifiedNodes = repository.getCommunityNodes({ verified: true });
      const unverifiedNodes = repository.getCommunityNodes({ verified: false });

      expect(verifiedNodes).toHaveLength(2);
      expect(unverifiedNodes).toHaveLength(1);
      expect(verifiedNodes.every((n: any) => n.isVerified)).toBe(true);
      expect(unverifiedNodes.every((n: any) => !n.isVerified)).toBe(true);
    });

    it('should respect limit parameter', () => {
      const nodes = repository.getCommunityNodes({ limit: 2 });

      expect(nodes).toHaveLength(2);
    });

    it('should correctly parse community node fields', () => {
      const nodes = repository.getCommunityNodes();
      const verifiedNode = nodes.find((n: any) => n.nodeType === 'n8n-nodes-verified.testNode');

      expect(verifiedNode).toBeDefined();
      expect(verifiedNode.isCommunity).toBe(true);
      expect(verifiedNode.isVerified).toBe(true);
      expect(verifiedNode.authorName).toBe('Verified Author');
      expect(verifiedNode.npmPackageName).toBe('n8n-nodes-verified');
      expect(verifiedNode.npmVersion).toBe('1.0.0');
      expect(verifiedNode.npmDownloads).toBe(5000);
    });

    it('should handle empty result', () => {
      mockAdapter._setMockData('community_nodes', []);
      const nodes = repository.getCommunityNodes();

      expect(nodes).toHaveLength(0);
    });

    it('should handle order by downloads', () => {
      const nodes = repository.getCommunityNodes({ orderBy: 'downloads' });

      // The mock doesn't actually sort, but we verify the query is made
      expect(nodes).toBeDefined();
    });

    it('should handle order by updated', () => {
      const nodes = repository.getCommunityNodes({ orderBy: 'updated' });

      expect(nodes).toBeDefined();
    });
  });

  describe('getCommunityStats', () => {
    beforeEach(() => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);
    });

    it('should return correct community statistics', () => {
      const stats = repository.getCommunityStats();

      expect(stats.total).toBe(3);
      expect(stats.verified).toBe(2);
      expect(stats.unverified).toBe(1);
    });

    it('should handle empty database', () => {
      mockAdapter._setMockData('community_nodes', []);
      const stats = repository.getCommunityStats();

      expect(stats.total).toBe(0);
      expect(stats.verified).toBe(0);
      expect(stats.unverified).toBe(0);
    });

    it('should handle all verified nodes', () => {
      mockAdapter._setMockData(
        'community_nodes',
        sampleCommunityNodes.filter((n) => n.is_verified === 1)
      );
      const stats = repository.getCommunityStats();

      expect(stats.total).toBe(2);
      expect(stats.verified).toBe(2);
      expect(stats.unverified).toBe(0);
    });

    it('should handle all unverified nodes', () => {
      mockAdapter._setMockData(
        'community_nodes',
        sampleCommunityNodes.filter((n) => n.is_verified === 0)
      );
      const stats = repository.getCommunityStats();

      expect(stats.total).toBe(1);
      expect(stats.verified).toBe(0);
      expect(stats.unverified).toBe(1);
    });
  });

  describe('hasNodeByNpmPackage', () => {
    beforeEach(() => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);
    });

    it('should return true for existing package', () => {
      const exists = repository.hasNodeByNpmPackage('n8n-nodes-verified');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent package', () => {
      const exists = repository.hasNodeByNpmPackage('n8n-nodes-nonexistent');

      expect(exists).toBe(false);
    });

    it('should handle empty package name', () => {
      const exists = repository.hasNodeByNpmPackage('');

      expect(exists).toBe(false);
    });
  });

  describe('getNodeByNpmPackage', () => {
    beforeEach(() => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);
    });

    it('should return node for existing package', () => {
      const node = repository.getNodeByNpmPackage('n8n-nodes-verified');

      expect(node).toBeDefined();
      expect(node.npmPackageName).toBe('n8n-nodes-verified');
      expect(node.displayName).toBe('Verified Test Node');
    });

    it('should return null for non-existent package', () => {
      const node = repository.getNodeByNpmPackage('n8n-nodes-nonexistent');

      expect(node).toBeNull();
    });

    it('should correctly parse all community fields', () => {
      const node = repository.getNodeByNpmPackage('n8n-nodes-popular');

      expect(node).toBeDefined();
      expect(node.isCommunity).toBe(true);
      expect(node.isVerified).toBe(true);
      expect(node.isWebhook).toBe(true);
      expect(node.isVersioned).toBe(true);
      expect(node.npmDownloads).toBe(50000);
    });
  });

  describe('deleteCommunityNodes', () => {
    beforeEach(() => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);
    });

    it('should delete all community nodes and return count', () => {
      const deletedCount = repository.deleteCommunityNodes();

      expect(deletedCount).toBe(3);
      expect(mockAdapter._getMockData('community_nodes')).toHaveLength(0);
    });

    it('should handle empty database', () => {
      mockAdapter._setMockData('community_nodes', []);
      const deletedCount = repository.deleteCommunityNodes();

      expect(deletedCount).toBe(0);
    });
  });

  describe('saveNode with community fields', () => {
    it('should save a community node with all fields', () => {
      const communityNode: ParsedNode & CommunityNodeFields = {
        nodeType: 'n8n-nodes-new.newNode',
        packageName: 'n8n-nodes-new',
        displayName: 'New Community Node',
        description: 'A brand new community node',
        category: 'Community',
        style: 'declarative',
        properties: [],
        credentials: [],
        operations: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: false,
        version: '1.0.0',
        isCommunity: true,
        isVerified: true,
        authorName: 'New Author',
        authorGithubUrl: 'https://github.com/newauthor',
        npmPackageName: 'n8n-nodes-new',
        npmVersion: '1.0.0',
        npmDownloads: 100,
        communityFetchedAt: new Date().toISOString(),
      };

      repository.saveNode(communityNode);

      const savedNodes = mockAdapter._getMockData('community_nodes');
      expect(savedNodes).toHaveLength(1);
      expect(savedNodes[0].node_type).toBe('n8n-nodes-new.newNode');
      expect(savedNodes[0].is_community).toBe(1);
      expect(savedNodes[0].is_verified).toBe(1);
    });

    it('should save a core node without community fields', () => {
      const coreNode: ParsedNode = {
        nodeType: 'nodes-base.httpRequest',
        packageName: 'n8n-nodes-base',
        displayName: 'HTTP Request',
        description: 'Makes an HTTP request',
        category: 'Core',
        style: 'declarative',
        properties: [],
        credentials: [],
        operations: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '4.0',
      };

      repository.saveNode(coreNode);

      const savedNodes = mockAdapter._getMockData('community_nodes');
      expect(savedNodes).toHaveLength(1);
      expect(savedNodes[0].is_community).toBe(0);
    });

    it('should update existing community node', () => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);

      const updatedNode: ParsedNode & CommunityNodeFields = {
        nodeType: 'n8n-nodes-verified.testNode',
        packageName: 'n8n-nodes-verified',
        displayName: 'Updated Verified Node',
        description: 'Updated description',
        category: 'Community',
        style: 'declarative',
        properties: [],
        credentials: [],
        operations: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: false,
        version: '1.1.0',
        isCommunity: true,
        isVerified: true,
        authorName: 'Verified Author',
        npmPackageName: 'n8n-nodes-verified',
        npmVersion: '1.1.0',
        npmDownloads: 6000,
        communityFetchedAt: new Date().toISOString(),
      };

      repository.saveNode(updatedNode);

      const savedNodes = mockAdapter._getMockData('community_nodes');
      const updatedSaved = savedNodes.find(
        (n: any) => n.node_type === 'n8n-nodes-verified.testNode'
      );
      expect(updatedSaved).toBeDefined();
      expect(updatedSaved.display_name).toBe('Updated Verified Node');
    });
  });

  describe('edge cases', () => {
    it('should handle null values in community fields', () => {
      const nodeWithNulls = {
        ...sampleCommunityNodes[0],
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        community_fetched_at: null,
      };
      mockAdapter._setMockData('community_nodes', [nodeWithNulls]);

      const nodes = repository.getCommunityNodes();

      expect(nodes).toHaveLength(1);
      expect(nodes[0].authorName).toBeNull();
      expect(nodes[0].npmPackageName).toBeNull();
    });

    it('should handle zero downloads', () => {
      const nodeWithZeroDownloads = {
        ...sampleCommunityNodes[0],
        npm_downloads: 0,
      };
      mockAdapter._setMockData('community_nodes', [nodeWithZeroDownloads]);

      const nodes = repository.getCommunityNodes();

      expect(nodes[0].npmDownloads).toBe(0);
    });

    it('should handle very large download counts', () => {
      const nodeWithManyDownloads = {
        ...sampleCommunityNodes[0],
        npm_downloads: 10000000,
      };
      mockAdapter._setMockData('community_nodes', [nodeWithManyDownloads]);

      const nodes = repository.getCommunityNodes();

      expect(nodes[0].npmDownloads).toBe(10000000);
    });

    it('should handle special characters in author name', () => {
      const nodeWithSpecialChars = {
        ...sampleCommunityNodes[0],
        author_name: "O'Brien & Sons <test>",
      };
      mockAdapter._setMockData('community_nodes', [nodeWithSpecialChars]);

      const nodes = repository.getCommunityNodes();

      expect(nodes[0].authorName).toBe("O'Brien & Sons <test>");
    });

    it('should handle Unicode in display name', () => {
      const nodeWithUnicode = {
        ...sampleCommunityNodes[0],
        display_name: 'Test Node',
      };
      mockAdapter._setMockData('community_nodes', [nodeWithUnicode]);

      const nodes = repository.getCommunityNodes();

      expect(nodes[0].displayName).toBe('Test Node');
    });

    it('should handle combined filters', () => {
      mockAdapter._setMockData('community_nodes', [...sampleCommunityNodes]);

      const nodes = repository.getCommunityNodes({
        verified: true,
        limit: 1,
        orderBy: 'downloads',
      });

      expect(nodes).toHaveLength(1);
      expect(nodes[0].isVerified).toBe(true);
    });
  });
});
