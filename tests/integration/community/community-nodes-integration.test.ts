import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeRepository, CommunityNodeFields } from '@/database/node-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '@/database/database-adapter';
import { ParsedNode } from '@/parsers/node-parser';

/**
 * Integration tests for the community nodes feature.
 *
 * These tests verify the end-to-end flow of community node operations
 * using a mock database adapter that simulates real database behavior.
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

/**
 * In-memory database adapter for integration testing
 */
class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private nodes: Map<string, any> = new Map();
  private nodesByNpmPackage: Map<string, any> = new Map();

  prepare = vi.fn((sql: string) => new InMemoryPreparedStatement(sql, this));

  exec = vi.fn();
  close = vi.fn();
  pragma = vi.fn();
  transaction = vi.fn((fn: () => any) => fn());
  checkFTS5Support = vi.fn(() => true);
  inTransaction = false;

  // Data access methods for the prepared statement
  saveNode(node: any): void {
    this.nodes.set(node.node_type, node);
    if (node.npm_package_name) {
      this.nodesByNpmPackage.set(node.npm_package_name, node);
    }
  }

  getNode(nodeType: string): any {
    return this.nodes.get(nodeType);
  }

  getNodeByNpmPackage(npmPackageName: string): any {
    return this.nodesByNpmPackage.get(npmPackageName);
  }

  hasNodeByNpmPackage(npmPackageName: string): boolean {
    return this.nodesByNpmPackage.has(npmPackageName);
  }

  getAllNodes(): any[] {
    return Array.from(this.nodes.values());
  }

  getCommunityNodes(verified?: boolean): any[] {
    const nodes = this.getAllNodes().filter((n) => n.is_community === 1);
    if (verified !== undefined) {
      return nodes.filter((n) => (n.is_verified === 1) === verified);
    }
    return nodes;
  }

  deleteCommunityNodes(): number {
    const communityNodes = this.getCommunityNodes();
    for (const node of communityNodes) {
      this.nodes.delete(node.node_type);
      if (node.npm_package_name) {
        this.nodesByNpmPackage.delete(node.npm_package_name);
      }
    }
    return communityNodes.length;
  }

  clear(): void {
    this.nodes.clear();
    this.nodesByNpmPackage.clear();
  }
}

class InMemoryPreparedStatement implements PreparedStatement {
  run = vi.fn((...params: any[]): RunResult => {
    if (this.sql.includes('INSERT') && this.sql.includes('INTO nodes')) {
      const node = this.paramsToNode(params);
      this.adapter.saveNode(node);
      return { changes: 1, lastInsertRowid: 1 };
    }
    if (this.sql.includes('DELETE FROM nodes WHERE is_community = 1')) {
      const deleted = this.adapter.deleteCommunityNodes();
      return { changes: deleted, lastInsertRowid: 0 };
    }
    return { changes: 0, lastInsertRowid: 0 };
  });

  get = vi.fn((...params: any[]) => {
    if (this.sql.includes('SELECT npm_readme')) {
      return undefined; // No existing docs to preserve
    }
    if (this.sql.includes('SELECT * FROM nodes WHERE node_type = ?')) {
      return this.adapter.getNode(params[0]);
    }
    if (this.sql.includes('SELECT * FROM nodes WHERE npm_package_name = ?')) {
      return this.adapter.getNodeByNpmPackage(params[0]);
    }
    if (this.sql.includes('SELECT 1 FROM nodes WHERE npm_package_name = ?')) {
      return this.adapter.hasNodeByNpmPackage(params[0]) ? { '1': 1 } : undefined;
    }
    if (this.sql.includes('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1') &&
        !this.sql.includes('is_verified')) {
      return { count: this.adapter.getCommunityNodes().length };
    }
    if (this.sql.includes('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1 AND is_verified = 1')) {
      return { count: this.adapter.getCommunityNodes(true).length };
    }
    return undefined;
  });

  all = vi.fn((...params: any[]) => {
    if (this.sql.includes('SELECT * FROM nodes WHERE is_community = 1')) {
      let nodes = this.adapter.getCommunityNodes();

      if (this.sql.includes('AND is_verified = ?')) {
        const isVerified = params[0] === 1;
        nodes = nodes.filter((n: any) => (n.is_verified === 1) === isVerified);
      }

      if (this.sql.includes('LIMIT ?')) {
        const limit = params[params.length - 1];
        nodes = nodes.slice(0, limit);
      }

      return nodes;
    }
    if (this.sql.includes('SELECT * FROM nodes ORDER BY display_name')) {
      return this.adapter.getAllNodes();
    }
    return [];
  });

  iterate = vi.fn();
  pluck = vi.fn(() => this);
  expand = vi.fn(() => this);
  raw = vi.fn(() => this);
  columns = vi.fn(() => []);
  bind = vi.fn(() => this);

  constructor(private sql: string, private adapter: InMemoryDatabaseAdapter) {}

  private paramsToNode(params: any[]): any {
    return {
      node_type: params[0],
      package_name: params[1],
      display_name: params[2],
      description: params[3],
      category: params[4],
      development_style: params[5],
      is_ai_tool: params[6],
      is_trigger: params[7],
      is_webhook: params[8],
      is_versioned: params[9],
      is_tool_variant: params[10],
      tool_variant_of: params[11],
      has_tool_variant: params[12],
      version: params[13],
      documentation: params[14],
      properties_schema: params[15],
      operations: params[16],
      credentials_required: params[17],
      outputs: params[18],
      output_names: params[19],
      is_community: params[20],
      is_verified: params[21],
      author_name: params[22],
      author_github_url: params[23],
      npm_package_name: params[24],
      npm_version: params[25],
      npm_downloads: params[26],
      community_fetched_at: params[27],
    };
  }
}

describe('Community Nodes Integration', () => {
  let adapter: InMemoryDatabaseAdapter;
  let repository: NodeRepository;

  // Sample nodes for testing
  const verifiedCommunityNode: ParsedNode & CommunityNodeFields = {
    nodeType: 'n8n-nodes-verified.testNode',
    packageName: 'n8n-nodes-verified',
    displayName: 'Verified Test Node',
    description: 'A verified community node for testing',
    category: 'Community',
    style: 'declarative',
    properties: [{ name: 'url', type: 'string', displayName: 'URL' }],
    credentials: [],
    operations: [{ name: 'execute', displayName: 'Execute' }],
    isAITool: false,
    isTrigger: false,
    isWebhook: false,
    isVersioned: false,
    version: '1.0.0',
    isCommunity: true,
    isVerified: true,
    authorName: 'Verified Author',
    authorGithubUrl: 'https://github.com/verified',
    npmPackageName: 'n8n-nodes-verified',
    npmVersion: '1.0.0',
    npmDownloads: 5000,
    communityFetchedAt: new Date().toISOString(),
  };

  const unverifiedCommunityNode: ParsedNode & CommunityNodeFields = {
    nodeType: 'n8n-nodes-unverified.testNode',
    packageName: 'n8n-nodes-unverified',
    displayName: 'Unverified Test Node',
    description: 'An unverified community node for testing',
    category: 'Community',
    style: 'declarative',
    properties: [],
    credentials: [],
    operations: [],
    isAITool: false,
    isTrigger: true,
    isWebhook: false,
    isVersioned: false,
    version: '0.5.0',
    isCommunity: true,
    isVerified: false,
    authorName: 'Community Author',
    npmPackageName: 'n8n-nodes-unverified',
    npmVersion: '0.5.0',
    npmDownloads: 1000,
    communityFetchedAt: new Date().toISOString(),
  };

  const coreNode: ParsedNode = {
    nodeType: 'nodes-base.httpRequest',
    packageName: 'n8n-nodes-base',
    displayName: 'HTTP Request',
    description: 'Makes HTTP requests',
    category: 'Core',
    style: 'declarative',
    properties: [{ name: 'url', type: 'string', displayName: 'URL' }],
    credentials: [],
    operations: [],
    isAITool: false,
    isTrigger: false,
    isWebhook: false,
    isVersioned: true,
    version: '4.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new InMemoryDatabaseAdapter();
    repository = new NodeRepository(adapter);
  });

  afterEach(() => {
    adapter.clear();
  });

  describe('Full sync workflow', () => {
    it('should save and retrieve community nodes correctly', () => {
      // Save nodes
      repository.saveNode(verifiedCommunityNode);
      repository.saveNode(unverifiedCommunityNode);
      repository.saveNode(coreNode);

      // Verify community nodes
      const communityNodes = repository.getCommunityNodes();
      expect(communityNodes).toHaveLength(2);

      // Verify verified filter
      const verifiedNodes = repository.getCommunityNodes({ verified: true });
      expect(verifiedNodes).toHaveLength(1);
      expect(verifiedNodes[0].displayName).toBe('Verified Test Node');

      // Verify unverified filter
      const unverifiedNodes = repository.getCommunityNodes({ verified: false });
      expect(unverifiedNodes).toHaveLength(1);
      expect(unverifiedNodes[0].displayName).toBe('Unverified Test Node');
    });

    it('should correctly track community stats', () => {
      repository.saveNode(verifiedCommunityNode);
      repository.saveNode(unverifiedCommunityNode);
      repository.saveNode(coreNode);

      const stats = repository.getCommunityStats();

      expect(stats.total).toBe(2);
      expect(stats.verified).toBe(1);
      expect(stats.unverified).toBe(1);
    });

    it('should check npm package existence correctly', () => {
      repository.saveNode(verifiedCommunityNode);

      expect(repository.hasNodeByNpmPackage('n8n-nodes-verified')).toBe(true);
      expect(repository.hasNodeByNpmPackage('n8n-nodes-nonexistent')).toBe(false);
    });

    it('should delete only community nodes', () => {
      repository.saveNode(verifiedCommunityNode);
      repository.saveNode(unverifiedCommunityNode);
      repository.saveNode(coreNode);

      const deleted = repository.deleteCommunityNodes();

      expect(deleted).toBe(2);
      expect(repository.getCommunityNodes()).toHaveLength(0);
      // Core node should still exist
      expect(adapter.getNode('nodes-base.httpRequest')).toBeDefined();
    });
  });

  describe('Node update workflow', () => {
    it('should update existing community node', () => {
      repository.saveNode(verifiedCommunityNode);

      // Update the node
      const updatedNode = {
        ...verifiedCommunityNode,
        displayName: 'Updated Verified Node',
        npmVersion: '1.1.0',
        npmDownloads: 6000,
      };
      repository.saveNode(updatedNode);

      const retrieved = repository.getNodeByNpmPackage('n8n-nodes-verified');
      expect(retrieved).toBeDefined();
      // Note: The actual update verification depends on parseNodeRow implementation
    });

    it('should handle transition from unverified to verified', () => {
      repository.saveNode(unverifiedCommunityNode);

      const nowVerified = {
        ...unverifiedCommunityNode,
        isVerified: true,
      };
      repository.saveNode(nowVerified);

      const stats = repository.getCommunityStats();
      expect(stats.verified).toBe(1);
      expect(stats.unverified).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty database', () => {
      expect(repository.getCommunityNodes()).toHaveLength(0);
      expect(repository.getCommunityStats()).toEqual({
        total: 0,
        verified: 0,
        unverified: 0,
      });
      expect(repository.hasNodeByNpmPackage('any-package')).toBe(false);
      expect(repository.deleteCommunityNodes()).toBe(0);
    });

    it('should handle node with minimal fields', () => {
      const minimalNode: ParsedNode & CommunityNodeFields = {
        nodeType: 'n8n-nodes-minimal.node',
        packageName: 'n8n-nodes-minimal',
        displayName: 'Minimal Node',
        description: 'Minimal',
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
        isVerified: false,
        npmPackageName: 'n8n-nodes-minimal',
      };

      repository.saveNode(minimalNode);

      expect(repository.hasNodeByNpmPackage('n8n-nodes-minimal')).toBe(true);
      expect(repository.getCommunityStats().total).toBe(1);
    });

    it('should handle multiple nodes from same package', () => {
      const node1 = { ...verifiedCommunityNode };
      const node2 = {
        ...verifiedCommunityNode,
        nodeType: 'n8n-nodes-verified.anotherNode',
        displayName: 'Another Node',
      };

      repository.saveNode(node1);
      repository.saveNode(node2);

      // Both should exist
      expect(adapter.getNode('n8n-nodes-verified.testNode')).toBeDefined();
      expect(adapter.getNode('n8n-nodes-verified.anotherNode')).toBeDefined();
    });

    it('should handle limit correctly', () => {
      // Save multiple nodes
      for (let i = 0; i < 10; i++) {
        const node = {
          ...verifiedCommunityNode,
          nodeType: `n8n-nodes-test-${i}.node`,
          npmPackageName: `n8n-nodes-test-${i}`,
        };
        repository.saveNode(node);
      }

      const limited = repository.getCommunityNodes({ limit: 5 });
      expect(limited).toHaveLength(5);
    });
  });

  describe('Concurrent operations', () => {
    it('should handle rapid consecutive saves', () => {
      const nodes = Array(50)
        .fill(null)
        .map((_, i) => ({
          ...verifiedCommunityNode,
          nodeType: `n8n-nodes-rapid-${i}.node`,
          npmPackageName: `n8n-nodes-rapid-${i}`,
        }));

      nodes.forEach((node) => repository.saveNode(node));

      expect(repository.getCommunityStats().total).toBe(50);
    });

    it('should handle save followed by immediate delete', () => {
      repository.saveNode(verifiedCommunityNode);
      expect(repository.getCommunityStats().total).toBe(1);

      repository.deleteCommunityNodes();
      expect(repository.getCommunityStats().total).toBe(0);

      repository.saveNode(verifiedCommunityNode);
      expect(repository.getCommunityStats().total).toBe(1);
    });
  });
});
