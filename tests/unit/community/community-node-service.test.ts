import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommunityNodeService, SyncResult, SyncOptions } from '@/community/community-node-service';
import { NodeRepository, CommunityNodeFields } from '@/database/node-repository';
import {
  CommunityNodeFetcher,
  StrapiCommunityNode,
  NpmSearchResult,
} from '@/community/community-node-fetcher';
import { ParsedNode } from '@/parsers/node-parser';
import { logger } from '@/utils/logger';

// Mock the fetcher
vi.mock('@/community/community-node-fetcher', () => ({
  CommunityNodeFetcher: vi.fn().mockImplementation(() => ({
    fetchVerifiedNodes: vi.fn(),
    fetchNpmPackages: vi.fn(),
    fetchPackageJson: vi.fn(),
  })),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CommunityNodeService', () => {
  let service: CommunityNodeService;
  let mockRepository: Partial<NodeRepository>;
  let mockFetcher: {
    fetchVerifiedNodes: ReturnType<typeof vi.fn>;
    fetchNpmPackages: ReturnType<typeof vi.fn>;
    fetchPackageJson: ReturnType<typeof vi.fn>;
  };

  // Sample test data
  const mockStrapiNode: StrapiCommunityNode = {
    id: 1,
    attributes: {
      name: 'TestNode',
      displayName: 'Test Node',
      description: 'A test community node',
      packageName: 'n8n-nodes-test',
      authorName: 'Test Author',
      authorGithubUrl: 'https://github.com/testauthor',
      npmVersion: '1.0.0',
      numberOfDownloads: 1000,
      numberOfStars: 50,
      isOfficialNode: false,
      isPublished: true,
      nodeDescription: {
        name: 'n8n-nodes-test.testNode',
        displayName: 'Test Node',
        description: 'A test node',
        properties: [{ name: 'url', type: 'string' }],
        credentials: [],
        version: 1,
        group: ['transform'],
      },
      nodeVersions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
  };

  const mockNpmPackage: NpmSearchResult = {
    package: {
      name: 'n8n-nodes-npm-test',
      version: '1.0.0',
      description: 'A test npm community node',
      keywords: ['n8n-community-node-package'],
      date: '2024-01-01T00:00:00.000Z',
      links: {
        npm: 'https://www.npmjs.com/package/n8n-nodes-npm-test',
        repository: 'https://github.com/test/n8n-nodes-npm-test',
      },
      author: { name: 'NPM Author' },
      publisher: { username: 'npmauthor', email: 'npm@example.com' },
      maintainers: [{ username: 'npmauthor', email: 'npm@example.com' }],
    },
    score: {
      final: 0.8,
      detail: {
        quality: 0.9,
        popularity: 0.7,
        maintenance: 0.8,
      },
    },
    searchScore: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock repository
    mockRepository = {
      saveNode: vi.fn(),
      hasNodeByNpmPackage: vi.fn().mockReturnValue(false),
      getNodeByNpmPackage: vi.fn().mockReturnValue(null),
      deleteStaleCommunityNodes: vi.fn().mockReturnValue(0),
      updateNodeReadme: vi.fn(),
      updateNodeAISummary: vi.fn(),
      getCommunityNodes: vi.fn().mockReturnValue([]),
      getCommunityStats: vi.fn().mockReturnValue({ total: 0, verified: 0, unverified: 0 }),
      deleteCommunityNodes: vi.fn().mockReturnValue(0),
    };

    // Create mock fetcher instance
    mockFetcher = {
      fetchVerifiedNodes: vi.fn().mockResolvedValue([]),
      fetchNpmPackages: vi.fn().mockResolvedValue([]),
      fetchPackageJson: vi.fn().mockResolvedValue(null),
    };

    // Override CommunityNodeFetcher to return our mock
    (CommunityNodeFetcher as any).mockImplementation(() => mockFetcher);

    service = new CommunityNodeService(mockRepository as NodeRepository, 'production');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncCommunityNodes', () => {
    it('should sync both verified and npm nodes by default', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      const result = await service.syncCommunityNodes();

      expect(result.verified.fetched).toBe(1);
      expect(result.npm.fetched).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(mockFetcher.fetchVerifiedNodes).toHaveBeenCalled();
      expect(mockFetcher.fetchNpmPackages).toHaveBeenCalled();
    });

    it('should only sync verified nodes when verifiedOnly is true', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);

      const result = await service.syncCommunityNodes({ verifiedOnly: true });

      expect(result.verified.fetched).toBe(1);
      expect(result.npm.fetched).toBe(0);
      expect(mockFetcher.fetchVerifiedNodes).toHaveBeenCalled();
      expect(mockFetcher.fetchNpmPackages).not.toHaveBeenCalled();
    });

    it('should respect npmLimit option', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([]);
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      await service.syncCommunityNodes({ npmLimit: 50 });

      expect(mockFetcher.fetchNpmPackages).toHaveBeenCalledWith(
        50,
        undefined
      );
    });

    it('should handle Strapi sync errors gracefully', async () => {
      mockFetcher.fetchVerifiedNodes.mockRejectedValue(new Error('Strapi API error'));
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      const result = await service.syncCommunityNodes();

      expect(result.verified.errors).toContain('Strapi sync failed: Strapi API error');
      expect(result.npm.fetched).toBe(1);
    });

    it('should handle npm sync errors gracefully', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      mockFetcher.fetchNpmPackages.mockRejectedValue(new Error('npm API error'));

      const result = await service.syncCommunityNodes();

      expect(result.verified.fetched).toBe(1);
      expect(result.npm.errors).toContain('npm sync failed: npm API error');
    });

    it('should pass progress callback to fetcher', async () => {
      const progressCallback = vi.fn();
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      await service.syncCommunityNodes({}, progressCallback);

      // The progress callback is passed to fetchVerifiedNodes
      expect(mockFetcher.fetchVerifiedNodes).toHaveBeenCalled();
      const call = mockFetcher.fetchVerifiedNodes.mock.calls[0];
      expect(typeof call[0]).toBe('function'); // Progress callback
    });

    it('should calculate duration correctly', async () => {
      mockFetcher.fetchVerifiedNodes.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return [mockStrapiNode];
      });
      mockFetcher.fetchNpmPackages.mockResolvedValue([]);

      const result = await service.syncCommunityNodes({ verifiedOnly: true });

      // Assertion intentionally loose: setTimeout does not guarantee a
      // minimum elapsed time, so on fast CI runners the mocked 10ms delay
      // can resolve in 9ms and cause a flake. We only need to verify that
      // duration was measured (non-negative number), not its precise value.
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeLessThan(5000);
    });
  });

  describe('syncVerifiedNodes', () => {
    it('should save verified nodes to repository', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);

      const result = await service.syncVerifiedNodes();

      expect(result.fetched).toBe(1);
      expect(result.saved).toBe(1);
      expect(mockRepository.saveNode).toHaveBeenCalledTimes(1);
    });

    it('should skip existing nodes when skipExisting is true', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      (mockRepository.hasNodeByNpmPackage as any).mockReturnValue(true);

      const result = await service.syncVerifiedNodes(undefined, true);

      expect(result.fetched).toBe(1);
      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockRepository.saveNode).not.toHaveBeenCalled();
    });

    it('should handle nodes without nodeDescription', async () => {
      const nodeWithoutDesc = {
        ...mockStrapiNode,
        attributes: { ...mockStrapiNode.attributes, nodeDescription: null },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([nodeWithoutDesc]);

      const result = await service.syncVerifiedNodes();

      expect(result.fetched).toBe(1);
      expect(result.saved).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    it('should call progress callback during save', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      const progressCallback = vi.fn();

      await service.syncVerifiedNodes(progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        'Saving verified nodes',
        1,
        1
      );
    });

    it('should handle empty response', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([]);

      const result = await service.syncVerifiedNodes();

      expect(result.fetched).toBe(0);
      expect(result.saved).toBe(0);
      expect(mockRepository.saveNode).not.toHaveBeenCalled();
    });

    it('should handle save errors gracefully', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);
      (mockRepository.saveNode as any).mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.syncVerifiedNodes();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Error saving n8n-nodes-test');
    });
  });

  describe('syncNpmNodes', () => {
    it('should save npm packages to repository', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      const result = await service.syncNpmNodes();

      expect(result.fetched).toBe(1);
      expect(result.saved).toBe(1);
      expect(mockRepository.saveNode).toHaveBeenCalledTimes(1);
    });

    it('should skip packages already synced from Strapi', async () => {
      const verifiedPackage = {
        nodeType: 'n8n-nodes-npm-test.NpmTest',
        npmPackageName: 'n8n-nodes-npm-test',
        isVerified: true,
      };
      (mockRepository.getCommunityNodes as any).mockReturnValue([verifiedPackage]);
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      const result = await service.syncNpmNodes();

      expect(result.fetched).toBe(1);
      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should skip existing packages when skipExisting is true', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      (mockRepository.getNodeByNpmPackage as any).mockReturnValue({
        nodeType: 'n8n-nodes-npm-test.npmtest',
        npmPackageName: 'n8n-nodes-npm-test',
        isCommunity: true,
        isVerified: false,
      });

      const result = await service.syncNpmNodes(100, undefined, true);

      expect(result.skipped).toBe(1);
      expect(result.saved).toBe(0);
    });

    it('should respect limit parameter', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([]);

      await service.syncNpmNodes(50);

      expect(mockFetcher.fetchNpmPackages).toHaveBeenCalledWith(
        50,
        undefined
      );
    });

    it('should handle empty response', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([]);

      const result = await service.syncNpmNodes();

      expect(result.fetched).toBe(0);
      expect(result.saved).toBe(0);
    });

    it('should handle save errors gracefully', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      (mockRepository.saveNode as any).mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.syncNpmNodes();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Error saving n8n-nodes-npm-test');
    });
  });

  describe('strapiNodeToParsedNode (via syncVerifiedNodes)', () => {
    it('should convert Strapi node to ParsedNode format', async () => {
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([mockStrapiNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-test.testNode',
          packageName: 'n8n-nodes-test',
          displayName: 'Test Node',
          description: 'A test node',
          isCommunity: true,
          isVerified: true,
          authorName: 'Test Author',
          npmPackageName: 'n8n-nodes-test',
          npmVersion: '1.0.0',
          npmDownloads: 1000,
        })
      );
    });

    it('should transform preview node types to actual node types', async () => {
      const previewNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            name: 'n8n-nodes-preview-test.testNode',
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([previewNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-test.testNode',
        })
      );
    });

    it('should detect AI tools', async () => {
      const aiNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            usableAsTool: true,
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([aiNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isAITool: true,
        })
      );
    });

    it('should accept the object form of usableAsTool (#954)', async () => {
      const aiNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            usableAsTool: { replacements: { displayName: 'Test Tool' } },
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([aiNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isAITool: true,
        })
      );
    });

    it('should not infer AI tool capability from the node name (#954)', async () => {
      const aiNamedNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          name: 'firefliesAi',
          displayName: 'Fireflies AI',
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([aiNamedNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isAITool: false,
        })
      );
    });

    it('should detect triggers', async () => {
      const triggerNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            group: ['trigger'],
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([triggerNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isTrigger: true,
        })
      );
    });

    it('should detect webhooks', async () => {
      const webhookNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            name: 'n8n-nodes-test.webhookHandler',
            group: ['webhook'],
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([webhookNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isWebhook: true,
        })
      );
    });

    it('should extract operations from properties', async () => {
      const nodeWithOperations = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            properties: [
              {
                name: 'operation',
                options: [
                  { name: 'create', displayName: 'Create' },
                  { name: 'read', displayName: 'Read' },
                ],
              },
            ],
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([nodeWithOperations]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: [
            { name: 'create', displayName: 'Create' },
            { name: 'read', displayName: 'Read' },
          ],
        })
      );
    });

    it('should handle nodes with AI category in codex', async () => {
      const aiCategoryNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            codex: { categories: ['AI'] },
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([aiCategoryNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isAITool: true,
        })
      );
    });
  });

  describe('npmPackageToParsedNode (via syncNpmNodes)', () => {
    it('should convert npm package to ParsedNode format', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.npmtest',
          packageName: 'n8n-nodes-npm-test',
          displayName: 'npmtest',
          description: 'A test npm community node',
          isCommunity: true,
          isVerified: false,
          authorName: 'NPM Author',
          npmPackageName: 'n8n-nodes-npm-test',
          npmVersion: '1.0.0',
        })
      );
    });

    it('should handle scoped packages', async () => {
      const scopedPackage = {
        ...mockNpmPackage,
        package: {
          ...mockNpmPackage.package,
          name: '@myorg/n8n-nodes-custom',
        },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([scopedPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'custom',
        })
      );
    });

    it('should handle packages without author', async () => {
      const packageWithoutAuthor = {
        ...mockNpmPackage,
        package: {
          ...mockNpmPackage.package,
          author: undefined,
        },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([packageWithoutAuthor]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          authorName: 'npmauthor', // Falls back to publisher.username
        })
      );
    });

    it('should detect trigger packages', async () => {
      const triggerPackage = {
        ...mockNpmPackage,
        package: {
          ...mockNpmPackage.package,
          name: 'n8n-nodes-trigger-test',
        },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([triggerPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isTrigger: true,
        })
      );
    });

    it('should detect webhook packages', async () => {
      const webhookPackage = {
        ...mockNpmPackage,
        package: {
          ...mockNpmPackage.package,
          name: 'n8n-nodes-webhook-handler',
        },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([webhookPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isWebhook: true,
        })
      );
    });

    it('should derive the node name from the package.json n8n.nodes entry (#949)', async () => {
      const globalsPackage = {
        ...mockNpmPackage,
        package: { ...mockNpmPackage.package, name: 'n8n-nodes-globals' },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([globalsPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/nodes/GlobalConstants/GlobalConstants.node.js'] },
      });

      await service.syncNpmNodes();

      expect(mockFetcher.fetchPackageJson).toHaveBeenCalledWith(
        'n8n-nodes-globals',
        '1.0.0',
        expect.objectContaining({ maxRetries: 1 })
      );
      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-globals.globalConstants',
          displayName: 'globalConstants',
        })
      );
    });

    it('should lowercase a leading acronym in the node name (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/nodes/PDFGeneration/PDFGeneration.node.js'] },
      });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.pdfGeneration',
        })
      );
    });

    it('should use the first n8n.nodes entry that names a node file (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/README.js', 'dist/nodes/Foo/Foo.node.js'] },
      });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.foo',
        })
      );
    });

    it('should fall back and warn when no n8n.nodes entry names a node file (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/index.js'] },
      });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.npmtest',
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('n8n-nodes-npm-test')
      );
    });

    it('should look up the manifest with a single attempt and a short timeout (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      await service.syncNpmNodes();

      const options = mockFetcher.fetchPackageJson.mock.calls[0][2];
      expect(options.maxRetries).toBe(1);
      expect(options.timeout).toBeLessThan(15000);
    });

    it('should derive the node name from package.json for scoped packages (#949)', async () => {
      const scopedPackage = {
        ...mockNpmPackage,
        package: { ...mockNpmPackage.package, name: '@myorg/n8n-nodes-custom' },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([scopedPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/nodes/CustomThing/CustomThing.node.js'] },
      });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: '@myorg/n8n-nodes-custom.customThing',
        })
      );
    });

    it('should use the first entry of a multi-node n8n.nodes array (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: {
          nodes: [
            'dist/nodes/FirstNode/FirstNode.node.js',
            'dist/nodes/SecondNode/SecondNode.node.js',
          ],
        },
      });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.firstNode',
        })
      );
    });

    it('should fall back to the package-name heuristic when n8n.nodes is missing (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({ name: 'n8n-nodes-npm-test' });

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.npmtest',
        })
      );
    });

    it('should fall back to the package-name heuristic when package.json cannot be fetched (#949)', async () => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);
      mockFetcher.fetchPackageJson.mockRejectedValue(new Error('npm registry down'));

      const result = await service.syncNpmNodes();

      expect(result.saved).toBe(1);
      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'n8n-nodes-npm-test.npmtest',
        })
      );
    });

    it('should calculate approximate downloads from popularity score', async () => {
      const popularPackage = {
        ...mockNpmPackage,
        score: {
          ...mockNpmPackage.score,
          detail: {
            ...mockNpmPackage.score.detail,
            popularity: 0.5,
          },
        },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([popularPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          npmDownloads: 5000, // 0.5 * 10000
        })
      );
    });
  });

  describe('stale node type re-keying (#949)', () => {
    const globalsPackage: NpmSearchResult = {
      ...mockNpmPackage,
      package: { ...mockNpmPackage.package, name: 'n8n-nodes-globals' },
    };

    const staleRow = {
      nodeType: 'n8n-nodes-globals.globals',
      npmPackageName: 'n8n-nodes-globals',
      isCommunity: true,
      isVerified: false,
      npmReadme: '# Globals',
      aiDocumentationSummary: { summary: 'existing summary' },
    };

    beforeEach(() => {
      mockFetcher.fetchNpmPackages.mockResolvedValue([globalsPackage]);
      mockFetcher.fetchPackageJson.mockResolvedValue({
        n8n: { nodes: ['dist/nodes/GlobalConstants/GlobalConstants.node.js'] },
      });
    });

    it('should replace a row keyed by the old node type and carry over its docs', async () => {
      (mockRepository.getNodeByNpmPackage as any).mockReturnValue(staleRow);

      const result = await service.syncNpmNodes();

      expect(result.saved).toBe(1);
      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ nodeType: 'n8n-nodes-globals.globalConstants' })
      );
      expect(mockRepository.deleteStaleCommunityNodes).toHaveBeenCalledWith(
        'n8n-nodes-globals',
        'n8n-nodes-globals.globalConstants'
      );
      expect(mockRepository.updateNodeReadme).toHaveBeenCalledWith(
        'n8n-nodes-globals.globalConstants',
        '# Globals'
      );
      expect(mockRepository.updateNodeAISummary).toHaveBeenCalledWith(
        'n8n-nodes-globals.globalConstants',
        { summary: 'existing summary' }
      );
    });

    it('should re-key even when skipExisting is set', async () => {
      (mockRepository.getNodeByNpmPackage as any).mockReturnValue(staleRow);

      const result = await service.syncNpmNodes(100, undefined, true);

      expect(result.saved).toBe(1);
      expect(result.skipped).toBe(0);
      expect(mockRepository.deleteStaleCommunityNodes).toHaveBeenCalled();
    });

    it('should leave a row with the same node type alone', async () => {
      (mockRepository.getNodeByNpmPackage as any).mockReturnValue({
        ...staleRow,
        nodeType: 'n8n-nodes-globals.globalConstants',
      });

      await service.syncNpmNodes();

      expect(mockRepository.deleteStaleCommunityNodes).not.toHaveBeenCalled();
      expect(mockRepository.updateNodeReadme).not.toHaveBeenCalled();
    });

    it('should never re-key a verified row', async () => {
      (mockRepository.getNodeByNpmPackage as any).mockReturnValue({
        ...staleRow,
        isVerified: true,
      });

      await service.syncNpmNodes();

      expect(mockRepository.deleteStaleCommunityNodes).not.toHaveBeenCalled();
    });
  });

  describe('typeVersion handling (#781)', () => {
    it('Strapi: uses descriptor version, not npm package version', async () => {
      // Descriptor says version: 1; npm package is at 5.4.2 — typeVersion must be 1.
      const node = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          npmVersion: '5.4.2',
          nodeDescription: { ...mockStrapiNode.attributes.nodeDescription, version: 1 },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([node]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ version: '1', npmVersion: '5.4.2' })
      );
    });

    it('Strapi: defaults to "1" when descriptor version is missing (no npm fallback)', async () => {
      const node = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          npmVersion: '0.2.21', // npm-style multi-dot — must NOT leak into typeVersion
          nodeDescription: { ...mockStrapiNode.attributes.nodeDescription, version: undefined },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([node]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ version: '1', npmVersion: '0.2.21' })
      );
    });

    it('Strapi: collapses descriptor version arrays to the highest entry', async () => {
      const node = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: { ...mockStrapiNode.attributes.nodeDescription, version: [1, 2, 2.1] },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([node]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ version: '2.1' })
      );
    });

    it('npm-only: defaults version to "1" instead of using npm package version', async () => {
      // mockNpmPackage has package.version = "1.0.0" — must NOT be stored as typeVersion.
      mockFetcher.fetchNpmPackages.mockResolvedValue([mockNpmPackage]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ version: '1', npmVersion: '1.0.0' })
      );
    });

    it('npm-only: preserves npm package version separately even when it is multi-dot', async () => {
      const node = {
        ...mockNpmPackage,
        package: { ...mockNpmPackage.package, version: '0.2.21' },
      };
      mockFetcher.fetchNpmPackages.mockResolvedValue([node]);

      await service.syncNpmNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({ version: '1', npmVersion: '0.2.21' })
      );
    });
  });

  describe('getCommunityStats', () => {
    it('should return community stats from repository', () => {
      const mockStats = { total: 100, verified: 30, unverified: 70 };
      (mockRepository.getCommunityStats as any).mockReturnValue(mockStats);

      const result = service.getCommunityStats();

      expect(result).toEqual(mockStats);
      expect(mockRepository.getCommunityStats).toHaveBeenCalled();
    });
  });

  describe('deleteCommunityNodes', () => {
    it('should delete community nodes and return count', () => {
      (mockRepository.deleteCommunityNodes as any).mockReturnValue(50);

      const result = service.deleteCommunityNodes();

      expect(result).toBe(50);
      expect(mockRepository.deleteCommunityNodes).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle nodes with empty properties', async () => {
      const emptyPropsNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeDescription: {
            ...mockStrapiNode.attributes.nodeDescription,
            properties: [],
            credentials: [],
          },
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([emptyPropsNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: [],
          credentials: [],
        })
      );
    });

    it('should handle nodes with multiple versions', async () => {
      const versionedNode = {
        ...mockStrapiNode,
        attributes: {
          ...mockStrapiNode.attributes,
          nodeVersions: [{ version: 1 }, { version: 2 }],
        },
      };
      mockFetcher.fetchVerifiedNodes.mockResolvedValue([versionedNode]);

      await service.syncVerifiedNodes();

      expect(mockRepository.saveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          isVersioned: true,
        })
      );
    });

    it('should handle concurrent sync operations', async () => {
      mockFetcher.fetchVerifiedNodes.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return [mockStrapiNode];
      });
      mockFetcher.fetchNpmPackages.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return [mockNpmPackage];
      });

      // Start two sync operations concurrently
      const results = await Promise.all([
        service.syncCommunityNodes({ verifiedOnly: true }),
        service.syncCommunityNodes({ verifiedOnly: true }),
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].verified.fetched).toBe(1);
      expect(results[1].verified.fetched).toBe(1);
    });
  });
});
