import { describe, expect, it, vi } from 'vitest';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { WorkflowValidator } from '@/services/workflow-validator';
import type { NodeRepository } from '@/database/node-repository';

vi.mock('@/utils/logger');

describe('WorkflowValidator version-specific schemas', () => {
  it('validates a Notion 2.2 database page against its own schema', async () => {
    const title = {
      displayName: 'Title',
      name: 'title',
      type: 'string',
      default: '',
      required: true,
      displayOptions: { show: { resource: ['databasePage'], operation: ['create'] } },
    };
    const properties = [
      { displayName: 'Resource', name: 'resource', type: 'options', default: 'page' },
      { displayName: 'Operation', name: 'operation', type: 'options', default: 'create', displayOptions: { show: { resource: ['databasePage'] } } },
      title,
    ];
    const repository = {
      getAllNodes: vi.fn(() => []),
      getNode: vi.fn((type: string) => type === 'nodes-base.manualTrigger'
        ? { nodeType: type, displayName: 'Manual Trigger', package: 'n8n-nodes-base', isTrigger: true, isVersioned: false, outputs: ['main'], properties: [] }
        : { nodeType: type, displayName: 'Notion', package: 'n8n-nodes-base', version: 3, isVersioned: true, outputs: ['main'], properties }),
      getNodeVersion: vi.fn(() => ({ propertiesSchema: properties.map(property => property === title ? { ...property, required: false } : property) })),
    } as unknown as NodeRepository;
    const validator = new WorkflowValidator(repository, EnhancedConfigValidator);
    const workflow = {
      name: 'notion-title-expression-repro',
      nodes: [
        { parameters: {}, id: 'trigger', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], typeVersion: 1 },
        {
          parameters: {
            resource: 'databasePage',
            databaseId: { __rl: true, mode: 'list', value: '00000000-0000-0000-0000-000000000000', cachedResultName: 'example-db' },
            propertiesUi: { propertyValues: [
              { key: 'URL|url', urlValue: "={{ 'https://example.com' + $json.path }}" },
              { key: 'title|title', title: '={{ $json.title }}' },
              { key: 'abstract|rich_text', textContent: '={{ $json.abstract }}' },
            ] },
            options: {},
          },
          id: 'notion',
          name: 'Store Page',
          type: 'n8n-nodes-base.notion',
          position: [220, 0],
          typeVersion: 2.2,
        },
      ],
      connections: { 'Manual Trigger': { main: [[{ node: 'Store Page', type: 'main', index: 0 }]] } },
    };

    const result = await validator.validateWorkflow(workflow as any, { profile: 'runtime' });

    expect(result.errors).toEqual([]);
    expect(repository.getNodeVersion).toHaveBeenCalledWith('nodes-base.notion', '2.2');
  });

  it('preserves Tool variant properties in historical schemas', async () => {
    const historicalProperties = [
      { displayName: 'Resource', name: 'resource', type: 'options', default: 'event' },
    ];
    const repository = {
      getAllNodes: vi.fn(() => []),
      getNode: vi.fn((type: string) => ({
        nodeType: type,
        displayName: 'Google Calendar Tool',
        package: 'n8n-nodes-base',
        version: 1.4,
        isVersioned: true,
        isToolVariant: true,
        toolVariantOf: 'nodes-base.googleCalendar',
        outputs: ['ai_tool'],
        properties: [
          { displayName: 'Tool Description', name: 'toolDescription', type: 'string', default: '' },
          ...historicalProperties,
        ],
      })),
      getNodeVersion: vi.fn(() => ({ propertiesSchema: historicalProperties })),
    } as unknown as NodeRepository;
    const validator = new WorkflowValidator(repository, EnhancedConfigValidator);
    const workflow = {
      name: 'tool-variant-version-repro',
      nodes: [{
        parameters: {
          toolDescription: 'Look up calendar events',
          resource: 'event',
        },
        id: 'calendar-tool',
        name: 'Google Calendar Tool',
        type: 'n8n-nodes-base.googleCalendarTool',
        position: [0, 0],
        typeVersion: 1.3,
      }],
      connections: {},
    };

    const result = await validator.validateWorkflow(workflow as any, { profile: 'strict' });

    expect(result.warnings.some(warning => warning.message.includes("Property 'toolDescription' won't be used"))).toBe(false);
    expect(repository.getNodeVersion).toHaveBeenCalledWith('nodes-base.googleCalendarTool', '1.3');
  });

  it('falls back to the latest schema when an exact version is unavailable', async () => {
    const properties = [
      { displayName: 'Current Field', name: 'currentField', type: 'string', default: '', required: true },
    ];
    const repository = {
      getAllNodes: vi.fn(() => []),
      getNode: vi.fn((type: string) => ({
        nodeType: type,
        displayName: 'Versioned Node',
        package: 'n8n-nodes-base',
        version: 2,
        isVersioned: true,
        outputs: ['main'],
        properties,
      })),
      getNodeVersion: vi.fn(() => null),
    } as unknown as NodeRepository;
    const validator = new WorkflowValidator(repository, EnhancedConfigValidator);
    const workflow = {
      name: 'missing-version-schema-repro',
      nodes: [{
        parameters: {},
        id: 'versioned-node',
        name: 'Versioned Node',
        type: 'n8n-nodes-base.versionedNode',
        position: [0, 0],
        typeVersion: 1,
      }],
      connections: {},
    };

    const result = await validator.validateWorkflow(workflow as any, { profile: 'runtime' });

    expect(result.errors.some(error => error.message.includes("Required property 'Current Field' cannot be empty"))).toBe(true);
    expect(repository.getNodeVersion).toHaveBeenCalledWith('nodes-base.versionedNode', '1');
  });
});
