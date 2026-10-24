import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PropertyFilter } from '@/services/property-filter';
import type { SimplifiedProperty, FilteredProperties } from '@/services/property-filter';

// Mock the database
vi.mock('better-sqlite3');

describe('PropertyFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deduplicateProperties', () => {
    it('should remove duplicate properties with same name and conditions', () => {
      const properties = [
        { name: 'url', type: 'string', displayOptions: { show: { method: ['GET'] } } },
        { name: 'url', type: 'string', displayOptions: { show: { method: ['GET'] } } }, // Duplicate
        { name: 'url', type: 'string', displayOptions: { show: { method: ['POST'] } } }, // Different condition
      ];

      const result = PropertyFilter.deduplicateProperties(properties);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('url');
      expect(result[1].name).toBe('url');
      expect(result[0].displayOptions).not.toEqual(result[1].displayOptions);
    });

    it('should handle properties without displayOptions', () => {
      const properties = [
        { name: 'timeout', type: 'number' },
        { name: 'timeout', type: 'number' }, // Duplicate
        { name: 'retries', type: 'number' },
      ];

      const result = PropertyFilter.deduplicateProperties(properties);

      expect(result).toHaveLength(2);
      expect(result.map(p => p.name)).toEqual(['timeout', 'retries']);
    });
  });

  describe('getEssentials', () => {
    it('should return configured essentials for HTTP Request node', () => {
      const properties = [
        { name: 'url', type: 'string', required: true },
        { name: 'method', type: 'options', options: ['GET', 'POST'] },
        { name: 'authentication', type: 'options' },
        { name: 'sendBody', type: 'boolean' },
        { name: 'contentType', type: 'options' },
        { name: 'sendHeaders', type: 'boolean' },
        { name: 'someRareOption', type: 'string' },
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.httpRequest');

      expect(result.required).toHaveLength(1);
      expect(result.required[0].name).toBe('url');
      expect(result.required[0].required).toBe(true);
      
      // Curated order; names missing from the schema are skipped
      expect(result.common.map(p => p.name)).toEqual([
        'method',
        'authentication',
        'sendHeaders',
        'sendBody',
        'contentType'
      ]);
    });

    it('should handle nested properties in collections', () => {
      const properties = [
        {
          name: 'assignments',
          type: 'collection',
          options: [
            { name: 'field', type: 'string' },
            { name: 'value', type: 'string' }
          ]
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.set');

      expect(result.common.some(p => p.name === 'assignments')).toBe(true);
    });

    it('should infer essentials for unconfigured nodes', () => {
      const properties = [
        { name: 'requiredField', type: 'string', required: true },
        { name: 'simpleField', type: 'string' },
        { name: 'conditionalField', type: 'string', displayOptions: { show: { mode: ['advanced'] } } },
        { name: 'complexField', type: 'collection' },
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      expect(result.required).toHaveLength(1);
      expect(result.required[0].name).toBe('requiredField');
      
      // May include both simpleField and complexField (collection type)
      expect(result.common.length).toBeGreaterThanOrEqual(1);
      expect(result.common.some(p => p.name === 'simpleField')).toBe(true);
    });

    it('should include conditional properties when needed to reach minimum count', () => {
      const properties = [
        { name: 'field1', type: 'string' },
        { name: 'field2', type: 'string', displayOptions: { show: { mode: ['basic'] } } },
        { name: 'field3', type: 'string', displayOptions: { show: { mode: ['advanced'], type: ['custom'] } } },
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      expect(result.common).toHaveLength(2);
      expect(result.common[0].name).toBe('field1');
      expect(result.common[1].name).toBe('field2'); // Single condition included
    });
  });

  describe('getEssentials at a typeVersion', () => {
    const versioned = [
      { name: 'mode', type: 'options', options: [{ name: 'A', value: 'a' }] },
      { name: 'legacyField', type: 'string', displayOptions: { show: { '@version': [1, 1.1] } } },
      { name: 'newField', type: 'boolean', displayOptions: { show: { '@version': [{ _cnd: { gte: 2 } }] } } },
    ];

    it('drops properties hidden at that version and the resolved @version gates', () => {
      const result = PropertyFilter.getEssentials(versioned, 'nodes-base.unknownNode', 2);
      const names = [...result.required, ...result.common].map(p => p.name);
      expect(names).toEqual(['mode', 'newField']);
      // newField is always shown at v2, so it is listed as unconditional
      expect(result.common.find(p => p.name === 'newField')?.showWhen).toBeUndefined();
    });

    it('keeps every version when no version is given', () => {
      const result = PropertyFilter.getEssentials(versioned, 'nodes-base.unknownNode');
      expect([...result.required, ...result.common].map(p => p.name)).toContain('legacyField');
    });

    it('leaves the schema and its gates alone when the version does not parse', () => {
      for (const version of ['', 'abc', '0.2.21']) {
        const names = (() => {
          const result = PropertyFilter.getEssentials(versioned, 'nodes-base.unknownNode', version);
          return [...result.required, ...result.common];
        })();
        expect(names.map(p => p.name), version).toContain('legacyField');
        expect(names.find(p => p.name === 'newField')?.showWhen, version).toBeDefined();
      }
    });

    it('accepts the stored "1,2" version format', () => {
      const result = PropertyFilter.getEssentials(versioned, 'nodes-base.unknownNode', '1,2');
      expect([...result.required, ...result.common].map(p => p.name)).toEqual(['mode', 'newField']);
    });

    it('skips null entries in a schema instead of throwing', () => {
      expect(() => PropertyFilter.getEssentials([null, ...versioned] as any[], 'nodes-base.unknownNode', 2)).not.toThrow();
    });
  });

  describe('options collections', () => {
    const perOperation = [
      { name: 'operation', type: 'options', options: [{ name: 'Format', value: 'formatDate' }, { name: 'Now', value: 'getCurrentDate' }] },
      { name: 'options', type: 'collection', displayOptions: { show: { operation: ['formatDate'] } }, options: [
        { name: 'includeInputFields', type: 'boolean', description: 'Whether to include all input fields. More text here.' },
        { name: 'timezone', type: 'string', description: 'The timezone to use' },
      ] },
      { name: 'options', type: 'collection', displayOptions: { show: { operation: ['getCurrentDate'] } }, options: [
        { name: 'includeInputFields', type: 'boolean', description: 'Whether to include all input fields' },
        { name: 'timezone', type: 'string', description: 'The timezone to use' },
        { name: 'format', type: 'options', options: [{ name: 'ISO', value: 'iso' }, { name: 'Comma', value: ', ' }] },
      ] },
    ];

    it('merges per-operation options collections and notes where a child applies', () => {
      const result = PropertyFilter.getEssentials(perOperation, 'nodes-base.unknownNode', 1);
      const options = result.common.filter(p => p.name === 'options');
      expect(options).toHaveLength(1);
      const children = Object.fromEntries(options[0].options!.map(o => [o.value, o.description]));
      expect(Object.keys(children)).toEqual(['includeInputFields', 'timezone', 'format']);
      // In both collections: no note. First sentence only.
      expect(children.includeInputFields).toBe('Whether to include all input fields.');
      // Only in one: says when it applies; option values with spaces are quoted
      expect(children.format).toBe('Values: iso|", ". Only when operation=getCurrentDate.');
      expect(options[0].showWhen).toBeUndefined();
    });

    it('leaves @version gates out of the "Only when" note', () => {
      const gated = perOperation.map(prop => prop.name === 'options'
        ? { ...prop, displayOptions: { show: { ...prop.displayOptions!.show, '@version': [{ _cnd: { gte: 2 } }] } } }
        : prop);
      const result = PropertyFilter.getEssentials(gated, 'nodes-base.unknownNode');
      const format = result.common.find(p => p.name === 'options')!.options!.find(o => o.value === 'format');
      expect(format?.description).toBe('Values: iso|", ". Only when operation=getCurrentDate.');
    });

    it('says when a long settings list is cut', () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ name: `setting${i}`, type: 'boolean', description: `Setting ${i}` }));
      const result = PropertyFilter.getEssentials([{ name: 'options', type: 'collection', options: many }], 'nodes-base.unknownNode', 1);
      const options = result.common.find(p => p.name === 'options')!;
      expect(options.options).toHaveLength(25);
      expect(options.usageHint).toBe('Lists 25 of 30 settings. get_node with mode "search_properties" or detail "full" shows the rest.');
    });

    it('keeps same-named settings that apply under different conditions', () => {
      const result = PropertyFilter.getEssentials([{ name: 'options', type: 'collection', options: [
        { name: 'size', type: 'options', displayOptions: { show: { '/model': ['dall-e-2'] } }, options: [{ name: 'S', value: '256x256' }] },
        { name: 'size', type: 'options', displayOptions: { show: { '/model': ['dall-e-3'] } }, options: [{ name: 'L', value: '1792x1024' }] },
      ] }], 'nodes-base.unknownNode', 1);
      expect(result.common[0].options).toEqual([
        { value: 'size', label: 'size', description: 'Values: 256x256. Only when model=dall-e-2.' },
        { value: 'size', label: 'size', description: 'Values: 1792x1024. Only when model=dall-e-3.' },
      ]);
    });

    it('strips nested and broken-up HTML tags from the line', () => {
      const result = PropertyFilter.getEssentials([{ name: 'options', type: 'collection', options: [
        { name: 'tagged', type: 'boolean', description: 'See <<b>b>the docs</b> <a href="x">here</a>.' },
      ] }], 'nodes-base.unknownNode', 1);
      expect(result.common[0].options![0].description).toBe('See the docs here.');
    });

    it('keeps one entry per definition when merged collections disagree', () => {
      const result = PropertyFilter.getEssentials([
        { name: 'options', type: 'collection', displayOptions: { show: { operation: ['now'] } }, options: [
          { name: 'timezone', type: 'string', description: 'The timezone to use' },
          { name: 'keep', type: 'boolean', description: 'Same in both' },
        ] },
        { name: 'options', type: 'collection', displayOptions: { show: { operation: ['format'] } }, options: [
          { name: 'timezone', type: 'boolean', description: 'Whether to apply the workflow timezone' },
          { name: 'keep', type: 'boolean', description: 'Same in both, other wording' },
        ] },
      ], 'nodes-base.unknownNode', 1);
      const lines = result.common.find(p => p.name === 'options')!.options!.map(o => `${o.value}: ${o.description}`);
      expect(lines).toEqual([
        'timezone: The timezone to use. Only when operation=now.',
        'keep: Same in both.',
        'timezone: Whether to apply the workflow timezone. Only when operation=format.',
      ]);
    });

    it('folds conditions only when the rules differ in one field', () => {
      const collection = (show: Record<string, string[]>, child: string) =>
        ({ name: 'options', type: 'collection', displayOptions: { show }, options: [{ name: child, type: 'number' }] });
      const result = PropertyFilter.getEssentials([
        collection({ resource: ['chat'], operation: ['complete'] }, 'maxTokens'),
        collection({ resource: ['text'], operation: ['complete', 'edit'] }, 'maxTokens'),
        collection({ resource: ['image'], operation: ['create'] }, 'size'),
        collection({ resource: ['text'], operation: ['complete'] }, 'echo'),
        collection({ resource: ['text'], operation: ['edit'] }, 'echo'),
      ], 'nodes-base.unknownNode', 1);
      const lines = Object.fromEntries(result.common.find(p => p.name === 'options')!.options!.map(o => [o.value, o.description]));
      // chat/edit is not a valid combination, so the clauses stay apart
      expect(lines.maxTokens).toBe('Only when operation=complete & resource=chat or operation=complete|edit & resource=text.');
      // only the operation differs: folded
      expect(lines.echo).toBe('Only when operation=complete|edit & resource=text.');
    });

    it('writes out operator and hide conditions', () => {
      const result = PropertyFilter.getEssentials([{ name: 'options', type: 'collection', options: [
        { name: 'quoted', type: 'boolean', displayOptions: { show: { '/queryReplacement': [{ _cnd: { exists: true } }] } } },
        { name: 'clash', type: 'boolean', displayOptions: { hide: { '/joinMode': ['keepMatches', 'keepNonMatches'] } } },
        { name: 'big', type: 'number', displayOptions: { show: { limit: [{ _cnd: { gte: 10 } }, 5] } } },
        { name: 'named', type: 'string', displayOptions: { hide: { sheetName: [''] } } },
      ] }], 'nodes-base.unknownNode', 1);
      const lines = result.common[0].options!.map(o => o.description);
      expect(lines).toEqual([
        'Only when queryReplacement is set.',
        'Only when not joinMode=keepMatches|keepNonMatches.',
        'Only when (limit=5 or limit>=10).',
        'Only when not sheetName="".',
      ]);
    });

    it('keeps abbreviations inside the first sentence', () => {
      const result = PropertyFilter.getEssentials([{ name: 'options', type: 'collection', options: [
        { name: 'quoted', type: 'boolean', description: 'Whether to treat values as text, e.g. "1" stays a string. Second sentence.' },
      ] }], 'nodes-base.unknownNode', 1);
      expect(result.common[0].options![0].description).toBe('Whether to treat values as text, e.g. "1" stays a string.');
    });

    it('does not append options for service nodes with a resource selector', () => {
      const result = PropertyFilter.getEssentials(
        [{ name: 'resource', type: 'options', options: [{ name: 'Contact', value: 'contact' }] }, ...perOperation],
        'nodes-base.unknownNode',
        1
      );
      expect(result.common.some(p => p.name === 'options')).toBe(false);
    });

    it('lists fixedCollection groups with their fields and allowed values on one line', () => {
      const result = PropertyFilter.getEssentials([
        { name: 'fieldsToSummarize', type: 'fixedCollection', options: [
          { name: 'values', displayName: 'Values', values: [
            { name: 'aggregation', type: 'options', options: [{ name: 'Sum', value: 'sum' }, { name: 'Count', value: 'count' }] },
            { name: 'field', type: 'string' },
            { name: 'field', type: 'string' },
            { name: 'hint', type: 'notice' },
          ] },
        ] },
      ], 'nodes-base.unknownNode', 1);
      const line = result.common[0].options![0];
      expect(line).toEqual({ value: 'values', label: 'Values', description: 'Fields: aggregation (sum|count), field.' });
      expect(line.description).not.toContain('\n');
    });
  });

  describe('property simplification', () => {
    it('should simplify options properly', () => {
      const properties = [
        {
          name: 'method',
          type: 'options',
          displayName: 'HTTP Method',
          options: [
            { name: 'GET', value: 'GET' },
            { name: 'POST', value: 'POST' },
            { name: 'PUT', value: 'PUT' }
          ]
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.httpRequest');

      const methodProp = result.common.find(p => p.name === 'method');
      expect(methodProp?.options).toHaveLength(3);
      expect(methodProp?.options?.[0]).toEqual({ value: 'GET', label: 'GET' });
    });

    it('should handle string array options', () => {
      const properties = [
        {
          name: 'resource',
          type: 'options',
          options: ['user', 'post', 'comment']
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const resourceProp = result.common.find(p => p.name === 'resource');
      expect(resourceProp?.options).toEqual([
        { value: 'user', label: 'user' },
        { value: 'post', label: 'post' },
        { value: 'comment', label: 'comment' }
      ]);
    });

    it('should include simple display conditions', () => {
      const properties = [
        {
          name: 'channelId',
          type: 'string',
          displayOptions: {
            show: {
              resource: ['message'],
              operation: ['post']
            }
          }
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.slack');

      const channelProp = result.common.find(p => p.name === 'channelId');
      expect(channelProp?.showWhen).toEqual({
        resource: ['message'],
        operation: ['post']
      });
    });

    it('should exclude complex display conditions', () => {
      const properties = [
        {
          name: 'complexField',
          type: 'string',
          displayOptions: {
            show: {
              mode: ['advanced'],
              type: ['custom'],
              enabled: [true],
              resource: ['special']
            }
          }
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const complexProp = result.common.find(p => p.name === 'complexField');
      expect(complexProp?.showWhen).toBeUndefined();
    });

    it('should generate usage hints for common property types', () => {
      const properties = [
        { name: 'url', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'authentication', type: 'options' },
        { name: 'jsonData', type: 'json' },
        { name: 'jsCode', type: 'code' },
        { name: 'enableFeature', type: 'boolean', displayOptions: { show: { mode: ['advanced'] } } }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const urlProp = result.common.find(p => p.name === 'url');
      expect(urlProp?.usageHint).toBe('Enter the full URL including https://');

      const authProp = result.common.find(p => p.name === 'authentication');
      expect(authProp?.usageHint).toBe('Select authentication method or credentials');

      const jsonProp = result.common.find(p => p.name === 'jsonData');
      expect(jsonProp?.usageHint).toBe('Enter valid JSON data');
    });

    it('should extract descriptions from various fields', () => {
      const properties = [
        { name: 'field1', description: 'Primary description' },
        { name: 'field2', hint: 'Hint description' },
        { name: 'field3', placeholder: 'Placeholder description' },
        { name: 'field4', displayName: 'Display Name Only' },
        { name: 'url' } // Should generate description
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      expect(result.common[0].description).toBe('Primary description');
      expect(result.common[1].description).toBe('Hint description');
      expect(result.common[2].description).toBe('Placeholder description');
      expect(result.common[3].description).toBe('Display Name Only');
      expect(result.common[4].description).toBe('The URL to make the request to');
    });
  });

  describe('searchProperties', () => {
    const testProperties = [
      { 
        name: 'url', 
        displayName: 'URL', 
        type: 'string',
        description: 'The endpoint URL for the request' 
      },
      { 
        name: 'urlParams', 
        displayName: 'URL Parameters', 
        type: 'collection' 
      },
      { 
        name: 'authentication', 
        displayName: 'Authentication', 
        type: 'options',
        description: 'Select the authentication method' 
      },
      {
        name: 'headers',
        type: 'collection',
        options: [
          { name: 'Authorization', type: 'string' },
          { name: 'Content-Type', type: 'string' }
        ]
      }
    ];

    it('should find exact name matches with highest score', () => {
      const results = PropertyFilter.searchProperties(testProperties, 'url');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('url'); // Exact match
      expect(results[1].name).toBe('urlParams'); // Prefix match
    });

    it('should find properties by partial name match', () => {
      const results = PropertyFilter.searchProperties(testProperties, 'auth');

      // May match both 'authentication' and 'Authorization' in headers
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name === 'authentication')).toBe(true);
    });

    it('should find properties by description match', () => {
      const results = PropertyFilter.searchProperties(testProperties, 'endpoint');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('url');
    });

    it('should search nested properties in collections', () => {
      const results = PropertyFilter.searchProperties(testProperties, 'authorization');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Authorization');
      expect((results[0] as any).path).toBe('headers.Authorization');
    });

    it('should limit results to maxResults', () => {
      const manyProperties = Array.from({ length: 30 }, (_, i) => ({
        name: `authField${i}`,
        type: 'string'
      }));

      const results = PropertyFilter.searchProperties(manyProperties, 'auth', 5);

      expect(results).toHaveLength(5);
    });

    it('should handle empty query gracefully', () => {
      const results = PropertyFilter.searchProperties(testProperties, '');

      expect(results).toHaveLength(0);
    });

    it('should search in fixedCollection properties', () => {
      const properties = [
        {
          name: 'options',
          type: 'fixedCollection',
          options: [
            {
              name: 'advanced',
              values: [
                { name: 'timeout', type: 'number' },
                { name: 'retries', type: 'number' }
              ]
            }
          ]
        }
      ];

      const results = PropertyFilter.searchProperties(properties, 'timeout');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('timeout');
      expect((results[0] as any).path).toBe('options.advanced.timeout');
    });
  });

  describe('edge cases', () => {
    it('should handle empty properties array', () => {
      const result = PropertyFilter.getEssentials([], 'nodes-base.httpRequest');

      expect(result.required).toHaveLength(0);
      expect(result.common).toHaveLength(0);
    });

    it('should handle properties with missing fields gracefully', () => {
      const properties = [
        { name: 'field1' }, // No type
        { type: 'string' }, // No name
        { name: 'field2', type: 'string' } // Valid
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      expect(result.common.length).toBeGreaterThan(0);
      expect(result.common.every(p => p.name && p.type)).toBe(true);
    });

    it('should handle circular references in nested properties', () => {
      const circularProp: any = {
        name: 'circular',
        type: 'collection',
        options: []
      };
      circularProp.options.push(circularProp); // Create circular reference

      const properties = [circularProp, { name: 'normal', type: 'string' }];

      // Should not throw or hang
      expect(() => {
        PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');
      }).not.toThrow();
    });

    it('should preserve default values for simple types', () => {
      const properties = [
        { name: 'method', type: 'options', default: 'GET' },
        { name: 'timeout', type: 'number', default: 30000 },
        { name: 'enabled', type: 'boolean', default: true },
        { name: 'complex', type: 'collection', default: { key: 'value' } } // Should not include
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const method = result.common.find(p => p.name === 'method');
      expect(method?.default).toBe('GET');

      const timeout = result.common.find(p => p.name === 'timeout');
      expect(timeout?.default).toBe(30000);

      const enabled = result.common.find(p => p.name === 'enabled');
      expect(enabled?.default).toBe(true);

      const complex = result.common.find(p => p.name === 'complex');
      expect(complex?.default).toBeUndefined();
    });

    it('should add expectedFormat for resourceLocator type properties', () => {
      const properties = [
        {
          name: 'channelId',
          type: 'resourceLocator',
          displayName: 'Channel',
          description: 'The channel to send message to',
          modes: [
            { name: 'list', displayName: 'From List' },
            { name: 'id', displayName: 'By ID' },
            { name: 'url', displayName: 'By URL' }
          ],
          default: { mode: 'list', value: '' }
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.slack');

      const channelProp = result.common.find(p => p.name === 'channelId');
      expect(channelProp).toBeDefined();
      expect(channelProp?.expectedFormat).toBeDefined();
      expect(channelProp?.expectedFormat?.structure).toEqual({
        mode: 'string',
        value: 'string'
      });
      expect(channelProp?.expectedFormat?.modes).toEqual(['list', 'id', 'url']);
      expect(channelProp?.expectedFormat?.example).toBeDefined();
      expect(channelProp?.expectedFormat?.example.mode).toBe('id');
      expect(channelProp?.expectedFormat?.example.value).toBeDefined();
    });

    it('should handle resourceLocator without modes array', () => {
      const properties = [
        {
          name: 'resource',
          type: 'resourceLocator',
          displayName: 'Resource',
          default: { mode: 'id', value: 'test-123' }
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const resourceProp = result.common.find(p => p.name === 'resource');
      expect(resourceProp?.expectedFormat).toBeDefined();
      // Should default to common modes
      expect(resourceProp?.expectedFormat?.modes).toEqual(['list', 'id']);
      expect(resourceProp?.expectedFormat?.example.value).toBe('test-123');
    });

    it('should handle resourceLocator with no default value', () => {
      const properties = [
        {
          name: 'item',
          type: 'resourceLocator',
          displayName: 'Item',
          modes: [{ name: 'search' }, { name: 'id' }]
        }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');

      const itemProp = result.common.find(p => p.name === 'item');
      expect(itemProp?.expectedFormat).toBeDefined();
      expect(itemProp?.expectedFormat?.modes).toEqual(['search', 'id']);
      // Should use fallback value
      expect(itemProp?.expectedFormat?.example.value).toBe('your-resource-id');
    });
  });
});