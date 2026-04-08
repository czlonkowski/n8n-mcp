"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPLEX_TYPE_EXAMPLES = exports.TYPE_STRUCTURES = void 0;
exports.TYPE_STRUCTURES = {
    string: {
        type: 'primitive',
        jsType: 'string',
        description: 'A text value that can contain any characters',
        example: 'Hello World',
        examples: ['', 'A simple text', '{{ $json.name }}', 'https://example.com'],
        validation: {
            allowEmpty: true,
            allowExpressions: true,
        },
        notes: ['Most common property type', 'Supports n8n expressions'],
    },
    number: {
        type: 'primitive',
        jsType: 'number',
        description: 'A numeric value (integer or decimal)',
        example: 42,
        examples: [0, -10, 3.14, 100],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: ['Can be constrained with min/max in typeOptions'],
    },
    boolean: {
        type: 'primitive',
        jsType: 'boolean',
        description: 'A true/false toggle value',
        example: true,
        examples: [true, false],
        validation: {
            allowEmpty: false,
            allowExpressions: false,
        },
        notes: ['Rendered as checkbox in n8n UI'],
    },
    dateTime: {
        type: 'primitive',
        jsType: 'string',
        description: 'A date and time value in ISO 8601 format',
        example: '2024-01-20T10:30:00Z',
        examples: [
            '2024-01-20T10:30:00Z',
            '2024-01-20',
            '{{ $now }}',
        ],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
            pattern: '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z?)?$',
        },
        notes: ['Accepts ISO 8601 format', 'Can use n8n date expressions'],
    },
    color: {
        type: 'primitive',
        jsType: 'string',
        description: 'A color value in hex format',
        example: '#FF5733',
        examples: ['#FF5733', '#000000', '#FFFFFF', '{{ $json.color }}'],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
            pattern: '^#[0-9A-Fa-f]{6}$',
        },
        notes: ['Must be 6-digit hex color', 'Rendered with color picker in UI'],
    },
    json: {
        type: 'primitive',
        jsType: 'string',
        description: 'A JSON string that can be parsed into any structure',
        example: '{"key": "value", "nested": {"data": 123}}',
        examples: [
            '{}',
            '{"name": "John", "age": 30}',
            '[1, 2, 3]',
            '{{ $json }}',
        ],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: ['Must be valid JSON when parsed', 'Often used for custom payloads'],
    },
    options: {
        type: 'primitive',
        jsType: 'string',
        description: 'Single selection from a list of predefined options',
        example: 'option1',
        examples: ['GET', 'POST', 'channelMessage', 'update'],
        validation: {
            allowEmpty: false,
            allowExpressions: false,
        },
        notes: [
            'Value must match one of the defined option values',
            'Rendered as dropdown in UI',
            'Options defined in property.options array',
        ],
    },
    multiOptions: {
        type: 'array',
        jsType: 'array',
        description: 'Multiple selections from a list of predefined options',
        structure: {
            items: {
                type: 'string',
                description: 'Selected option value',
            },
        },
        example: ['option1', 'option2'],
        examples: [[], ['GET', 'POST'], ['read', 'write', 'delete']],
        validation: {
            allowEmpty: true,
            allowExpressions: false,
        },
        notes: [
            'Array of option values',
            'Each value must exist in property.options',
            'Rendered as multi-select dropdown',
        ],
    },
    collection: {
        type: 'collection',
        jsType: 'object',
        description: 'A group of related properties with dynamic values',
        structure: {
            properties: {
                '<propertyName>': {
                    type: 'any',
                    description: 'Any nested property from the collection definition',
                },
            },
            flexible: true,
        },
        example: {
            name: 'John Doe',
            email: 'john@example.com',
            age: 30,
        },
        examples: [
            {},
            { key1: 'value1', key2: 123 },
            { nested: { deep: { value: true } } },
        ],
        validation: {
            allowEmpty: true,
            allowExpressions: true,
        },
        notes: [
            'Properties defined in property.values array',
            'Each property can be any type',
            'UI renders as expandable section',
        ],
    },
    fixedCollection: {
        type: 'collection',
        jsType: 'object',
        description: 'A collection with predefined groups of properties',
        structure: {
            properties: {
                '<collectionName>': {
                    type: 'array',
                    description: 'Array of collection items',
                    items: {
                        type: 'object',
                        description: 'Collection item with defined properties',
                    },
                },
            },
            required: [],
        },
        example: {
            headers: [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Authorization', value: 'Bearer token' },
            ],
        },
        examples: [
            {},
            { queryParameters: [{ name: 'id', value: '123' }] },
            {
                headers: [{ name: 'Accept', value: '*/*' }],
                queryParameters: [{ name: 'limit', value: '10' }],
            },
        ],
        validation: {
            allowEmpty: true,
            allowExpressions: true,
        },
        notes: [
            'Each collection has predefined structure',
            'Often used for headers, parameters, etc.',
            'Supports multiple values per collection',
        ],
    },
    resourceLocator: {
        type: 'special',
        jsType: 'object',
        description: 'A flexible way to specify a resource by ID, name, URL, or list',
        structure: {
            properties: {
                mode: {
                    type: 'string',
                    description: 'How the resource is specified',
                    enum: ['id', 'url', 'list'],
                    required: true,
                },
                value: {
                    type: 'string',
                    description: 'The resource identifier',
                    required: true,
                },
            },
            required: ['mode', 'value'],
        },
        example: {
            mode: 'id',
            value: 'abc123',
        },
        examples: [
            { mode: 'url', value: 'https://example.com/resource/123' },
            { mode: 'list', value: 'item-from-dropdown' },
            { mode: 'id', value: '{{ $json.resourceId }}' },
        ],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'Provides flexible resource selection',
            'Mode determines how value is interpreted',
            'UI adapts based on selected mode',
        ],
    },
    resourceMapper: {
        type: 'special',
        jsType: 'object',
        description: 'Maps input data fields to resource fields with transformation options',
        structure: {
            properties: {
                mappingMode: {
                    type: 'string',
                    description: 'How fields are mapped',
                    enum: ['defineBelow', 'autoMapInputData'],
                },
                value: {
                    type: 'object',
                    description: 'Field mappings',
                    properties: {
                        '<fieldName>': {
                            type: 'string',
                            description: 'Expression or value for this field',
                        },
                    },
                    flexible: true,
                },
            },
        },
        example: {
            mappingMode: 'defineBelow',
            value: {
                name: '{{ $json.fullName }}',
                email: '{{ $json.emailAddress }}',
                status: 'active',
            },
        },
        examples: [
            { mappingMode: 'autoMapInputData', value: {} },
            {
                mappingMode: 'defineBelow',
                value: { id: '{{ $json.userId }}', name: '{{ $json.name }}' },
            },
        ],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'Complex mapping with UI assistance',
            'Can auto-map or manually define',
            'Supports field transformations',
        ],
    },
    filter: {
        type: 'special',
        jsType: 'object',
        description: 'Defines conditions for filtering data with boolean logic',
        structure: {
            properties: {
                conditions: {
                    type: 'array',
                    description: 'Array of filter conditions',
                    items: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Unique condition identifier',
                                required: true,
                            },
                            leftValue: {
                                type: 'any',
                                description: 'Left side of comparison',
                            },
                            operator: {
                                type: 'object',
                                description: 'Comparison operator',
                                required: true,
                                properties: {
                                    type: {
                                        type: 'string',
                                        enum: ['string', 'number', 'boolean', 'dateTime', 'array', 'object'],
                                        required: true,
                                    },
                                    operation: {
                                        type: 'string',
                                        description: 'Operation to perform',
                                        required: true,
                                    },
                                },
                            },
                            rightValue: {
                                type: 'any',
                                description: 'Right side of comparison',
                            },
                        },
                    },
                    required: true,
                },
                combinator: {
                    type: 'string',
                    description: 'How to combine conditions',
                    enum: ['and', 'or'],
                    required: true,
                },
            },
            required: ['conditions', 'combinator'],
        },
        example: {
            conditions: [
                {
                    id: 'abc-123',
                    leftValue: '{{ $json.status }}',
                    operator: { type: 'string', operation: 'equals' },
                    rightValue: 'active',
                },
            ],
            combinator: 'and',
        },
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'Advanced filtering UI in n8n',
            'Supports complex boolean logic',
            'Operations vary by data type',
        ],
    },
    assignmentCollection: {
        type: 'special',
        jsType: 'object',
        description: 'Defines variable assignments with expressions',
        structure: {
            properties: {
                assignments: {
                    type: 'array',
                    description: 'Array of variable assignments',
                    items: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Unique assignment identifier',
                                required: true,
                            },
                            name: {
                                type: 'string',
                                description: 'Variable name',
                                required: true,
                            },
                            value: {
                                type: 'any',
                                description: 'Value to assign',
                                required: true,
                            },
                            type: {
                                type: 'string',
                                description: 'Data type of the value',
                                enum: ['string', 'number', 'boolean', 'array', 'object'],
                            },
                        },
                    },
                    required: true,
                },
            },
            required: ['assignments'],
        },
        example: {
            assignments: [
                {
                    id: 'abc-123',
                    name: 'userName',
                    value: '{{ $json.name }}',
                    type: 'string',
                },
                {
                    id: 'def-456',
                    name: 'userAge',
                    value: 30,
                    type: 'number',
                },
            ],
        },
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'Used in Set node and similar',
            'Each assignment can use expressions',
            'Type helps with validation',
        ],
    },
    credentials: {
        type: 'special',
        jsType: 'string',
        description: 'Reference to credential configuration',
        example: 'googleSheetsOAuth2Api',
        examples: ['httpBasicAuth', 'slackOAuth2Api', 'postgresApi'],
        validation: {
            allowEmpty: false,
            allowExpressions: false,
        },
        notes: [
            'References credential type name',
            'Credential must be configured in n8n',
            'Type name matches credential definition',
        ],
    },
    credentialsSelect: {
        type: 'special',
        jsType: 'string',
        description: 'Dropdown to select from available credentials',
        example: 'credential-id-123',
        examples: ['cred-abc', 'cred-def', '{{ $credentials.id }}'],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'User selects from configured credentials',
            'Returns credential ID',
            'Used when multiple credential instances exist',
        ],
    },
    hidden: {
        type: 'special',
        jsType: 'string',
        description: 'Hidden property not shown in UI (used for internal logic)',
        example: '',
        validation: {
            allowEmpty: true,
            allowExpressions: true,
        },
        notes: [
            'Not rendered in UI',
            'Can store metadata or computed values',
            'Often used for version tracking',
        ],
    },
    button: {
        type: 'special',
        jsType: 'string',
        description: 'Clickable button that triggers an action',
        example: '',
        validation: {
            allowEmpty: true,
            allowExpressions: false,
        },
        notes: [
            'Triggers action when clicked',
            'Does not store a value',
            'Action defined in routing property',
        ],
    },
    callout: {
        type: 'special',
        jsType: 'string',
        description: 'Informational message box (warning, info, success, error)',
        example: '',
        validation: {
            allowEmpty: true,
            allowExpressions: false,
        },
        notes: [
            'Display-only, no value stored',
            'Used for warnings and hints',
            'Style controlled by typeOptions',
        ],
    },
    notice: {
        type: 'special',
        jsType: 'string',
        description: 'Notice message displayed to user',
        example: '',
        validation: {
            allowEmpty: true,
            allowExpressions: false,
        },
        notes: ['Similar to callout', 'Display-only element', 'Provides contextual information'],
    },
    workflowSelector: {
        type: 'special',
        jsType: 'string',
        description: 'Dropdown to select another workflow',
        example: 'workflow-123',
        examples: ['wf-abc', '{{ $json.workflowId }}'],
        validation: {
            allowEmpty: false,
            allowExpressions: true,
        },
        notes: [
            'Selects from available workflows',
            'Returns workflow ID',
            'Used in Execute Workflow node',
        ],
    },
    curlImport: {
        type: 'special',
        jsType: 'string',
        description: 'Import configuration from cURL command',
        example: 'curl -X GET https://api.example.com/data',
        validation: {
            allowEmpty: true,
            allowExpressions: false,
        },
        notes: [
            'Parses cURL command to populate fields',
            'Used in HTTP Request node',
            'One-time import feature',
        ],
    },
};
exports.COMPLEX_TYPE_EXAMPLES = {
    collection: {
        basic: {
            name: 'John Doe',
            email: 'john@example.com',
        },
        nested: {
            user: {
                firstName: 'Jane',
                lastName: 'Smith',
            },
            preferences: {
                theme: 'dark',
                notifications: true,
            },
        },
        withExpressions: {
            id: '{{ $json.userId }}',
            timestamp: '{{ $now }}',
            data: '{{ $json.payload }}',
        },
    },
    fixedCollection: {
        httpHeaders: {
            headers: [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Authorization', value: 'Bearer {{ $credentials.token }}' },
            ],
        },
        queryParameters: {
            queryParameters: [
                { name: 'page', value: '1' },
                { name: 'limit', value: '100' },
            ],
        },
        multipleCollections: {
            headers: [{ name: 'Accept', value: 'application/json' }],
            queryParameters: [{ name: 'filter', value: 'active' }],
        },
    },
    filter: {
        simple: {
            conditions: [
                {
                    id: '1',
                    leftValue: '{{ $json.status }}',
                    operator: { type: 'string', operation: 'equals' },
                    rightValue: 'active',
                },
            ],
            combinator: 'and',
        },
        complex: {
            conditions: [
                {
                    id: '1',
                    leftValue: '{{ $json.age }}',
                    operator: { type: 'number', operation: 'gt' },
                    rightValue: 18,
                },
                {
                    id: '2',
                    leftValue: '{{ $json.country }}',
                    operator: { type: 'string', operation: 'equals' },
                    rightValue: 'US',
                },
            ],
            combinator: 'and',
        },
    },
    resourceMapper: {
        autoMap: {
            mappingMode: 'autoMapInputData',
            value: {},
        },
        manual: {
            mappingMode: 'defineBelow',
            value: {
                firstName: '{{ $json.first_name }}',
                lastName: '{{ $json.last_name }}',
                email: '{{ $json.email_address }}',
                status: 'active',
            },
        },
    },
    assignmentCollection: {
        basic: {
            assignments: [
                {
                    id: '1',
                    name: 'fullName',
                    value: '{{ $json.firstName }} {{ $json.lastName }}',
                    type: 'string',
                },
            ],
        },
        multiple: {
            assignments: [
                { id: '1', name: 'userName', value: '{{ $json.name }}', type: 'string' },
                { id: '2', name: 'userAge', value: '{{ $json.age }}', type: 'number' },
                { id: '3', name: 'isActive', value: true, type: 'boolean' },
            ],
        },
    },
};
//# sourceMappingURL=type-structures.js.map