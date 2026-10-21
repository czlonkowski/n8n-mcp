import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { NodeParser } from '@/parsers/node-parser';
import { NodeRepository } from '@/database/node-repository';
import { createDatabaseAdapter } from '@/database/database-adapter';
import { WorkflowValidator } from '@/services/workflow-validator';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { isDeprecatedNodeVersion } from '@/services/deprecated-nodes';

vi.mock('@/utils/logger');

// n8n refuses to save a workflow that adds or edits a node whose description sets
// `deprecated: true` (n8n 2.44+, N8N_DEPRECATED_NODES_BLOCK). These tests follow that
// flag from the installed n8n packages through the database to the validators.

// By file path: @n8n/n8n-nodes-langchain does not export its node files
const loadNodeClass = (modulePath: string, exportName: string) =>
  require(path.join(process.cwd(), 'node_modules', modulePath))[exportName];

describe('deprecated node detection', () => {
  describe('NodeParser.deprecatedVersions', () => {
    const parser = new NodeParser();

    it.each([
      ['n8n-nodes-base/dist/nodes/Function/Function.node.js', 'Function', 'n8n-nodes-base', 'nodes-base.function'],
      ['n8n-nodes-base/dist/nodes/FunctionItem/FunctionItem.node.js', 'FunctionItem', 'n8n-nodes-base', 'nodes-base.functionItem'],
      ['@n8n/n8n-nodes-langchain/dist/nodes/code/Code.node.js', 'Code', '@n8n/n8n-nodes-langchain', 'nodes-langchain.code'],
    ])('flags %s from the installed package', (modulePath, exportName, packageName, nodeType) => {
      const parsed = parser.parse(loadNodeClass(modulePath, exportName), packageName);

      expect(parsed.nodeType).toBe(nodeType);
      expect(parsed.deprecatedVersions).toEqual(['*']);
    });

    it('does not flag the Code node that replaces Function', () => {
      const parsed = parser.parse(
        loadNodeClass('n8n-nodes-base/dist/nodes/Code/Code.node.js', 'Code'),
        'n8n-nodes-base'
      );

      expect(parsed.deprecatedVersions).toEqual([]);
    });

    it('flags only the deprecated versions of a VersionedNodeType', () => {
      class Versioned {
        description = { displayName: 'Versioned', name: 'versioned', defaultVersion: 2 };
        nodeVersions = {
          1: { description: { name: 'versioned', version: 1, deprecated: true, properties: [] } },
          1.1: { description: { name: 'versioned', version: 1.1, deprecated: true, properties: [] } },
          2: { description: { name: 'versioned', version: 2, properties: [] } },
        };
      }

      const parsed = parser.parse(Versioned as any, 'n8n-nodes-base');

      expect(parsed.deprecatedVersions).toEqual(['1', '1.1']);
    });

    it('marks every typeVersion of a plain node, declared or not', () => {
      class Plain {
        description = { displayName: 'Plain', name: 'plain', version: [1, 2], deprecated: true, properties: [] };
      }

      const parsed = parser.parse(Plain as any, 'n8n-nodes-base');

      expect(parsed.deprecatedVersions).toEqual(['*']);
      // n8n returns the same description for a typeVersion outside the declared array
      expect(isDeprecatedNodeVersion({ nodeType: parsed.nodeType, version: parsed.version, deprecatedVersions: parsed.deprecatedVersions }, 1.5)).toBe(true);
    });
  });

  describe('NodeRepository', () => {
    it('adds the column to a database built before it existed and round-trips the versions', async () => {
      const db = await createDatabaseAdapter(':memory:');
      // The nodes table as shipped before deprecated_versions; rebuilds keep it in place
      db.exec(`CREATE TABLE nodes (
        node_type TEXT PRIMARY KEY, package_name TEXT NOT NULL, display_name TEXT NOT NULL,
        description TEXT, category TEXT, development_style TEXT, is_ai_tool INTEGER DEFAULT 0,
        is_trigger INTEGER DEFAULT 0, is_webhook INTEGER DEFAULT 0, is_versioned INTEGER DEFAULT 0,
        is_tool_variant INTEGER DEFAULT 0, tool_variant_of TEXT, has_tool_variant INTEGER DEFAULT 0,
        version TEXT, documentation TEXT, properties_schema TEXT, operations TEXT,
        credentials_required TEXT, outputs TEXT, output_names TEXT, is_community INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0, author_name TEXT, author_github_url TEXT, npm_package_name TEXT,
        npm_version TEXT, npm_downloads INTEGER DEFAULT 0, community_fetched_at DATETIME,
        npm_readme TEXT, ai_documentation_summary TEXT, ai_summary_generated_at DATETIME
      )`);
      const repository = new NodeRepository(db);
      const base = {
        style: 'programmatic' as const, packageName: 'n8n-nodes-base', category: 'transform',
        properties: [], credentials: [], operations: [], isAITool: false, isTrigger: false,
        isWebhook: false, isVersioned: false, version: '1',
      };

      // A failed batch rolls back the column added by its first save; later saves must re-add it
      expect(() => db.transaction(() => {
        repository.saveNode({ ...base, nodeType: 'nodes-base.discarded', displayName: 'Discarded', deprecatedVersions: [] });
        throw new Error('batch failed');
      })).toThrow('batch failed');

      repository.saveNode({ ...base, nodeType: 'nodes-base.function', displayName: 'Function', deprecatedVersions: ['*'] });
      repository.saveNode({ ...base, nodeType: 'nodes-base.code', displayName: 'Code', deprecatedVersions: [] });

      expect(repository.getNode('nodes-base.function').deprecatedVersions).toEqual(['*']);
      expect(repository.getNode('nodes-base.code').deprecatedVersions).toEqual([]);
      db.close();
    });
  });

  describe('isDeprecatedNodeVersion', () => {
    const versioned = { nodeType: 'nodes-base.x', version: '2', deprecatedVersions: ['1', '1.1'] };

    it('matches the workflow typeVersion', () => {
      expect(isDeprecatedNodeVersion(versioned, 1)).toBe(true);
      expect(isDeprecatedNodeVersion(versioned, 1.1)).toBe(true);
      expect(isDeprecatedNodeVersion(versioned, 2)).toBe(false);
    });

    it('uses the default version when typeVersion is omitted', () => {
      expect(isDeprecatedNodeVersion(versioned, undefined)).toBe(false);
      expect(isDeprecatedNodeVersion({ ...versioned, version: '1' }, undefined)).toBe(true);
    });

    it('treats every typeVersion of a plain node as deprecated, as n8n resolves them to one description', () => {
      const plain = { nodeType: 'nodes-base.function', version: '1', deprecatedVersions: ['*'] };
      expect(isDeprecatedNodeVersion(plain, 1)).toBe(true);
      expect(isDeprecatedNodeVersion(plain, 2)).toBe(true);
    });

    it('treats a node with no deprecated versions as current', () => {
      expect(isDeprecatedNodeVersion({ nodeType: 'nodes-base.code', version: '2', deprecatedVersions: [] }, 2)).toBe(false);
      expect(isDeprecatedNodeVersion({ nodeType: 'nodes-base.code', version: '2' }, 2)).toBe(false);
    });
  });

  describe('WorkflowValidator', () => {
    let validator: WorkflowValidator;
    const nodeTypes: Record<string, any> = {
      'nodes-base.webhook': { nodeType: 'nodes-base.webhook', displayName: 'Webhook', package: 'n8n-nodes-base', isTrigger: true, isWebhook: true, version: '2', isVersioned: true, properties: [], deprecatedVersions: [] },
      'nodes-base.function': { nodeType: 'nodes-base.function', displayName: 'Function', package: 'n8n-nodes-base', version: '1', isVersioned: false, properties: [], deprecatedVersions: ['*'] },
      'nodes-base.code': { nodeType: 'nodes-base.code', displayName: 'Code', package: 'n8n-nodes-base', version: '2', isVersioned: true, properties: [], deprecatedVersions: [] },
    };

    beforeEach(() => {
      const repository = {
        getNode: vi.fn((type: string) => nodeTypes[type] ?? null),
        getAllNodes: vi.fn(() => Object.values(nodeTypes)),
      } as any;
      validator = new WorkflowValidator(repository, EnhancedConfigValidator);
    });

    const workflowWith = (type: string, typeVersion: number) => ({
      nodes: [
        { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { path: 'p' } },
        { id: '2', name: 'Transform', type, typeVersion, position: [200, 0], parameters: {} },
      ],
      connections: { Webhook: { main: [[{ node: 'Transform', type: 'main', index: 0 }]] } },
    });

    it('warns about a deprecated node without failing validation', async () => {
      const result = await validator.validateWorkflow(workflowWith('n8n-nodes-base.function', 1) as any);

      const warning = result.warnings.find(w => w.code === 'DEPRECATED_NODE');
      expect(warning?.nodeName).toBe('Transform');
      expect(warning?.message).toContain('"n8n-nodes-base.function" is deprecated');
      expect(warning?.message).toContain('n8n-nodes-base.code');
      expect(result.errors.some(e => /deprecated/i.test(e.message))).toBe(false);
    });

    it('keeps the warning under the minimal profile', async () => {
      const result = await validator.validateWorkflow(workflowWith('n8n-nodes-base.function', 1) as any, { profile: 'minimal' });

      expect(result.warnings.some(w => w.code === 'DEPRECATED_NODE')).toBe(true);
    });

    it('warns about a disabled deprecated node, which n8n also rejects', async () => {
      const workflow = workflowWith('n8n-nodes-base.function', 1);
      (workflow.nodes[1] as any).disabled = true;

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.warnings.some(w => w.code === 'DEPRECATED_NODE' && w.nodeName === 'Transform')).toBe(true);
    });

    it('warns about a plain deprecated node whatever its typeVersion', async () => {
      const result = await validator.validateWorkflow(workflowWith('n8n-nodes-base.function', 2) as any);

      expect(result.warnings.some(w => w.code === 'DEPRECATED_NODE')).toBe(true);
    });

    it('does not warn about the Code node', async () => {
      const result = await validator.validateWorkflow(workflowWith('n8n-nodes-base.code', 2) as any);

      expect(result.warnings.some(w => w.code === 'DEPRECATED_NODE')).toBe(false);
    });
  });
});

describe('validate_workflow response', () => {
  it('keeps the issue code so callers can recognise DEPRECATED_NODE', async () => {
    const { N8NDocumentationMCPServer } = await import('@/mcp/server');
    const spy = vi.spyOn(WorkflowValidator.prototype, 'validateWorkflow').mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [{ type: 'warning', nodeName: 'Transform', code: 'DEPRECATED_NODE', message: 'deprecated' }],
      suggestions: [],
      statistics: { totalNodes: 1, enabledNodes: 1, triggerNodes: 0, validConnections: 0, invalidConnections: 0, expressionsValidated: 0 },
    } as any);
    const server = Object.create(N8NDocumentationMCPServer.prototype) as any;
    server.ensureInitialized = async () => {};
    server.repository = {};

    const response = await server.validateWorkflow({ nodes: [], connections: {} });

    expect(response.warnings[0]).toMatchObject({ node: 'Transform', code: 'DEPRECATED_NODE' });
    spy.mockRestore();
  });
});

describe('server tool responses for deprecated nodes', () => {
  const functionNode = {
    nodeType: 'nodes-base.function', displayName: 'Function', package: 'n8n-nodes-base',
    version: '1', isVersioned: false, properties: [], deprecatedVersions: ['*'],
  };
  const codeNode = {
    nodeType: 'nodes-base.code', displayName: 'Code', package: 'n8n-nodes-base',
    version: '2', isVersioned: true, properties: [], deprecatedVersions: [],
  };

  const makeServer = async () => {
    const { N8NDocumentationMCPServer } = await import('@/mcp/server');
    const server = Object.create(N8NDocumentationMCPServer.prototype) as any;
    server.ensureInitialized = async () => {};
    server.repository = { getNode: (type: string) => ({ 'nodes-base.function': functionNode, 'nodes-base.code': codeNode } as any)[type] ?? null };
    return server;
  };

  it('validate_node reports a deprecated node as an error with the replacement', async () => {
    const server = await makeServer();

    const result = await server.validateNodeConfig('n8n-nodes-base.function', { functionCode: 'return items;' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      type: 'incompatible',
      message: expect.stringContaining('"n8n-nodes-base.function" is deprecated'),
      fix: expect.stringContaining('n8n-nodes-base.code'),
    }));
  });

  it('validate_node checks the requested @version of a versioned node, under every profile', async () => {
    const server = await makeServer();
    const versionedNode = { ...codeNode, nodeType: 'nodes-base.partly', deprecatedVersions: ['1'] };
    server.repository = { getNode: (type: string) => (type === 'nodes-base.partly' ? versionedNode : null) };
    const isDeprecatedError = (e: any) => /is deprecated/.test(e.message);

    for (const profile of ['minimal', 'runtime', 'ai-friendly', 'strict']) {
      const deprecated = await server.validateNodeConfig('n8n-nodes-base.partly', { '@version': 1 }, 'operation', profile);
      const current = await server.validateNodeConfig('n8n-nodes-base.partly', { '@version': 2 }, 'operation', profile);
      const defaulted = await server.validateNodeConfig('n8n-nodes-base.partly', {}, 'operation', profile);

      expect(deprecated.valid, profile).toBe(false);
      expect(deprecated.errors.some(isDeprecatedError), profile).toBe(true);
      expect(current.errors.some(isDeprecatedError), profile).toBe(false);
      expect(defaulted.errors.some(isDeprecatedError), profile).toBe(false);
    }
  });

  it('validate_node keeps the error for a deprecated node under the minimal profile', async () => {
    const server = await makeServer();

    const result = await server.validateNodeConfig('n8n-nodes-base.function', {}, 'operation', 'minimal');

    expect(result.valid).toBe(false);
    expect(result.errors.some((e: any) => /n8n-nodes-base\.code/.test(e.fix ?? ''))).toBe(true);
  });

  it('validate_node does not flag the Code node', async () => {
    const server = await makeServer();

    const result = await server.validateNodeConfig('n8n-nodes-base.code', {});

    expect(result.errors.some((e: any) => /deprecated/.test(e.message))).toBe(false);
  });

  it('get_node describes the deprecation only for deprecated nodes', async () => {
    const server = await makeServer();

    expect(server.buildDeprecationInfo(functionNode)).toMatchObject({
      deprecatedVersions: ['*'],
      replacement: expect.stringContaining('Run Once for All Items'),
    });
    expect(server.buildDeprecationInfo(codeNode)).toBeUndefined();
  });

  it('search_nodes flags a row whose default version is deprecated', async () => {
    const server = await makeServer();

    expect(server.isDeprecatedSearchRow({ node_type: 'nodes-base.function', version: '1', deprecated_versions: '["*"]' })).toBe(true);
    expect(server.isDeprecatedSearchRow({ node_type: 'nodes-base.x', version: '2', deprecated_versions: '["1"]' })).toBe(false);
    expect(server.isDeprecatedSearchRow({ node_type: 'nodes-base.code', version: '2', deprecated_versions: null })).toBe(false);
  });
});
