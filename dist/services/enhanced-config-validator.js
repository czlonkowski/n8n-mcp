"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedConfigValidator = void 0;
const config_validator_1 = require("./config-validator");
const node_specific_validators_1 = require("./node-specific-validators");
const fixed_collection_validator_1 = require("../utils/fixed-collection-validator");
const operation_similarity_service_1 = require("./operation-similarity-service");
const resource_similarity_service_1 = require("./resource-similarity-service");
const node_type_normalizer_1 = require("../utils/node-type-normalizer");
const type_structure_service_1 = require("./type-structure-service");
class EnhancedConfigValidator extends config_validator_1.ConfigValidator {
    static initializeSimilarityServices(repository) {
        this.nodeRepository = repository;
        this.operationSimilarityService = new operation_similarity_service_1.OperationSimilarityService(repository);
        this.resourceSimilarityService = new resource_similarity_service_1.ResourceSimilarityService(repository);
    }
    static validateWithMode(nodeType, config, properties, mode = 'operation', profile = 'ai-friendly') {
        if (typeof nodeType !== 'string') {
            throw new Error(`Invalid nodeType: expected string, got ${typeof nodeType}`);
        }
        if (!config || typeof config !== 'object') {
            throw new Error(`Invalid config: expected object, got ${typeof config}`);
        }
        if (!Array.isArray(properties)) {
            throw new Error(`Invalid properties: expected array, got ${typeof properties}`);
        }
        const operationContext = this.extractOperationContext(config);
        const userProvidedKeys = new Set(Object.keys(config));
        const { properties: filteredProperties, configWithDefaults } = this.filterPropertiesByMode(properties, config, mode, operationContext);
        const baseResult = super.validate(nodeType, configWithDefaults, filteredProperties, userProvidedKeys);
        const enhancedResult = {
            ...baseResult,
            mode,
            profile,
            operation: operationContext,
            examples: [],
            nextSteps: [],
            errors: baseResult.errors || [],
            warnings: baseResult.warnings || [],
            suggestions: baseResult.suggestions || []
        };
        this.applyProfileFilters(enhancedResult, profile);
        this.addOperationSpecificEnhancements(nodeType, config, filteredProperties, enhancedResult);
        enhancedResult.errors = this.deduplicateErrors(enhancedResult.errors);
        enhancedResult.nextSteps = this.generateNextSteps(enhancedResult);
        enhancedResult.valid = enhancedResult.errors.length === 0;
        return enhancedResult;
    }
    static extractOperationContext(config) {
        return {
            resource: config.resource,
            operation: config.operation,
            action: config.action,
            mode: config.mode
        };
    }
    static filterPropertiesByMode(properties, config, mode, operation) {
        const configWithDefaults = this.applyNodeDefaults(properties, config);
        let filteredProperties;
        switch (mode) {
            case 'minimal':
                filteredProperties = properties.filter(prop => prop.required && this.isPropertyVisible(prop, configWithDefaults));
                break;
            case 'operation':
                filteredProperties = properties.filter(prop => this.isPropertyRelevantToOperation(prop, configWithDefaults, operation));
                break;
            case 'full':
            default:
                filteredProperties = properties;
                break;
        }
        return { properties: filteredProperties, configWithDefaults };
    }
    static applyNodeDefaults(properties, config) {
        const result = { ...config };
        for (const prop of properties) {
            if (prop.name && prop.default !== undefined && result[prop.name] === undefined) {
                result[prop.name] = prop.default;
            }
        }
        return result;
    }
    static isPropertyRelevantToOperation(prop, config, operation) {
        if (!this.isPropertyVisible(prop, config)) {
            return false;
        }
        if (!operation.resource && !operation.operation && !operation.action) {
            return true;
        }
        if (prop.displayOptions?.show) {
            const show = prop.displayOptions.show;
            if (operation.resource && show.resource) {
                const expectedResources = Array.isArray(show.resource) ? show.resource : [show.resource];
                if (!expectedResources.includes(operation.resource)) {
                    return false;
                }
            }
            if (operation.operation && show.operation) {
                const expectedOps = Array.isArray(show.operation) ? show.operation : [show.operation];
                if (!expectedOps.includes(operation.operation)) {
                    return false;
                }
            }
            if (operation.action && show.action) {
                const expectedActions = Array.isArray(show.action) ? show.action : [show.action];
                if (!expectedActions.includes(operation.action)) {
                    return false;
                }
            }
        }
        return true;
    }
    static addOperationSpecificEnhancements(nodeType, config, properties, result) {
        if (typeof nodeType !== 'string') {
            result.errors.push({
                type: 'invalid_type',
                property: 'nodeType',
                message: `Invalid nodeType: expected string, got ${typeof nodeType}`,
                fix: 'Provide a valid node type string (e.g., "nodes-base.webhook")'
            });
            return;
        }
        this.validateResourceAndOperation(nodeType, config, result);
        this.validateSpecialTypeStructures(config, properties, result);
        this.validateFixedCollectionStructures(nodeType, config, result);
        const context = {
            config,
            errors: result.errors,
            warnings: result.warnings,
            suggestions: result.suggestions,
            autofix: result.autofix || {}
        };
        const normalizedNodeType = nodeType.replace('n8n-nodes-base.', 'nodes-base.');
        switch (normalizedNodeType) {
            case 'nodes-base.slack':
                node_specific_validators_1.NodeSpecificValidators.validateSlack(context);
                this.enhanceSlackValidation(config, result);
                break;
            case 'nodes-base.googleSheets':
                node_specific_validators_1.NodeSpecificValidators.validateGoogleSheets(context);
                this.enhanceGoogleSheetsValidation(config, result);
                break;
            case 'nodes-base.httpRequest':
                this.enhanceHttpRequestValidation(config, result);
                break;
            case 'nodes-base.code':
                node_specific_validators_1.NodeSpecificValidators.validateCode(context);
                break;
            case 'nodes-base.openAi':
                node_specific_validators_1.NodeSpecificValidators.validateOpenAI(context);
                break;
            case 'nodes-base.mongoDb':
                node_specific_validators_1.NodeSpecificValidators.validateMongoDB(context);
                break;
            case 'nodes-base.webhook':
                node_specific_validators_1.NodeSpecificValidators.validateWebhook(context);
                break;
            case 'nodes-base.postgres':
                node_specific_validators_1.NodeSpecificValidators.validatePostgres(context);
                break;
            case 'nodes-base.mysql':
                node_specific_validators_1.NodeSpecificValidators.validateMySQL(context);
                break;
            case 'nodes-langchain.agent':
                node_specific_validators_1.NodeSpecificValidators.validateAIAgent(context);
                break;
            case 'nodes-base.set':
                node_specific_validators_1.NodeSpecificValidators.validateSet(context);
                break;
            case 'nodes-base.switch':
                this.validateSwitchNodeStructure(config, result);
                break;
            case 'nodes-base.if':
                this.validateIfNodeStructure(config, result);
                break;
            case 'nodes-base.filter':
                this.validateFilterNodeStructure(config, result);
                break;
        }
        if (Object.keys(context.autofix).length > 0) {
            result.autofix = context.autofix;
        }
    }
    static enhanceSlackValidation(config, result) {
        const { resource, operation } = result.operation || {};
        if (resource === 'message' && operation === 'send') {
            if (!config.channel && !config.channelId) {
                const channelError = result.errors.find(e => e.property === 'channel' || e.property === 'channelId');
                if (channelError) {
                    channelError.message = 'To send a Slack message, specify either a channel name (e.g., "#general") or channel ID';
                    channelError.fix = 'Add channel: "#general" or use a channel ID like "C1234567890"';
                }
            }
        }
    }
    static enhanceGoogleSheetsValidation(config, result) {
        const { operation } = result.operation || {};
        if (operation === 'append') {
            if (config.range && !config.range.includes('!')) {
                result.warnings.push({
                    type: 'inefficient',
                    property: 'range',
                    message: 'Range should include sheet name (e.g., "Sheet1!A:B")',
                    suggestion: 'Format: "SheetName!A1:B10" or "SheetName!A:B" for entire columns'
                });
            }
        }
    }
    static enhanceHttpRequestValidation(config, result) {
        const url = String(config.url || '');
        const options = config.options || {};
        if (!result.suggestions.some(s => typeof s === 'string' && s.includes('alwaysOutputData'))) {
            result.suggestions.push('Consider adding alwaysOutputData: true at node level (not in parameters) for better error handling. ' +
                'This ensures the node produces output even when HTTP requests fail, allowing downstream error handling.');
        }
        let host = '';
        try {
            host = new URL(url).hostname.toLowerCase();
        }
        catch {
        }
        const hostMatches = (suffix) => host === suffix || host.endsWith('.' + suffix);
        const isApiEndpoint = /^https?:\/\/api\./i.test(url) ||
            /\/api[\/\?]|\/api$/i.test(url) ||
            /\/rest[\/\?]|\/rest$/i.test(url) ||
            hostMatches('supabase.co') ||
            host.includes('firebase') ||
            hostMatches('googleapis.com') ||
            /\.com\/v\d+/i.test(url);
        if (isApiEndpoint && !options.response?.response?.responseFormat) {
            result.suggestions.push('API endpoints should explicitly set options.response.response.responseFormat to "json" or "text" ' +
                'to prevent confusion about response parsing. Example: ' +
                '{ "options": { "response": { "response": { "responseFormat": "json" } } } }');
        }
        if (url && url.startsWith('=')) {
            const expressionContent = url.slice(1);
            const lowerExpression = expressionContent.toLowerCase();
            if (expressionContent.startsWith('www.') ||
                (expressionContent.includes('{{') && !lowerExpression.includes('http'))) {
                result.warnings.push({
                    type: 'invalid_value',
                    property: 'url',
                    message: 'URL expression appears to be missing http:// or https:// protocol',
                    suggestion: 'Include protocol in your expression. Example: ={{ "https://" + $json.domain + ".com" }}'
                });
            }
        }
    }
    static generateNextSteps(result) {
        const steps = [];
        const requiredErrors = result.errors.filter(e => e.type === 'missing_required');
        const typeErrors = result.errors.filter(e => e.type === 'invalid_type');
        const valueErrors = result.errors.filter(e => e.type === 'invalid_value');
        if (requiredErrors.length > 0) {
            steps.push(`Add required fields: ${requiredErrors.map(e => e.property).join(', ')}`);
        }
        if (typeErrors.length > 0) {
            steps.push(`Fix type mismatches: ${typeErrors.map(e => `${e.property} should be ${e.fix}`).join(', ')}`);
        }
        if (valueErrors.length > 0) {
            steps.push(`Correct invalid values: ${valueErrors.map(e => e.property).join(', ')}`);
        }
        if (result.warnings.length > 0 && result.errors.length === 0) {
            steps.push('Consider addressing warnings for better reliability');
        }
        if (result.errors.length > 0) {
            steps.push('Fix the errors above following the provided suggestions');
        }
        return steps;
    }
    static deduplicateErrors(errors) {
        const seen = new Map();
        for (const error of errors) {
            const key = `${error.property}-${error.type}`;
            const existing = seen.get(key);
            if (!existing) {
                seen.set(key, error);
            }
            else {
                const existingLength = (existing.message?.length || 0) + (existing.fix?.length || 0);
                const newLength = (error.message?.length || 0) + (error.fix?.length || 0);
                if (newLength > existingLength) {
                    seen.set(key, error);
                }
            }
        }
        return Array.from(seen.values());
    }
    static shouldFilterCredentialWarning(warning) {
        return warning.type === 'security' &&
            warning.message !== undefined &&
            warning.message.includes('Hardcoded nodeCredentialType');
    }
    static applyProfileFilters(result, profile) {
        switch (profile) {
            case 'minimal':
                result.errors = result.errors.filter(e => e.type === 'missing_required');
                result.warnings = result.warnings.filter(w => {
                    if (this.shouldFilterCredentialWarning(w)) {
                        return false;
                    }
                    return w.type === 'security' || w.type === 'deprecated';
                });
                result.suggestions = [];
                break;
            case 'runtime':
                result.errors = result.errors.filter(e => e.type === 'missing_required' ||
                    e.type === 'invalid_value' ||
                    (e.type === 'invalid_type' && e.message.includes('undefined')));
                result.warnings = result.warnings.filter(w => {
                    if (this.shouldFilterCredentialWarning(w)) {
                        return false;
                    }
                    if (w.type === 'security' || w.type === 'deprecated')
                        return true;
                    if (w.type === 'inefficient' && w.message && w.message.includes('not visible')) {
                        return false;
                    }
                    return false;
                });
                result.suggestions = [];
                break;
            case 'strict':
                if (result.warnings.length === 0 && result.errors.length === 0) {
                    result.suggestions.push('Consider adding error handling with onError property and timeout configuration');
                    result.suggestions.push('Add authentication if connecting to external services');
                }
                this.enforceErrorHandlingForProfile(result, profile);
                break;
            case 'ai-friendly':
            default:
                result.warnings = result.warnings.filter(w => {
                    if (this.shouldFilterCredentialWarning(w)) {
                        return false;
                    }
                    if (w.type === 'security' || w.type === 'deprecated')
                        return true;
                    if (w.type === 'missing_common')
                        return true;
                    if (w.type === 'best_practice')
                        return true;
                    if (w.type === 'inefficient' && w.message && w.message.includes('not visible')) {
                        return false;
                    }
                    if (w.type === 'inefficient' && w.property?.startsWith('_')) {
                        return false;
                    }
                    return true;
                });
                this.addErrorHandlingSuggestions(result);
                break;
        }
    }
    static enforceErrorHandlingForProfile(result, profile) {
        if (profile !== 'strict')
            return;
        const nodeType = result.operation?.resource || '';
        const errorProneTypes = ['httpRequest', 'webhook', 'database', 'api', 'slack', 'email', 'openai'];
        if (errorProneTypes.some(type => nodeType.toLowerCase().includes(type))) {
            result.warnings.push({
                type: 'best_practice',
                property: 'errorHandling',
                message: 'External service nodes should have error handling configured',
                suggestion: 'Add onError: "continueRegularOutput" or "stopWorkflow" with retryOnFail: true for resilience'
            });
        }
    }
    static addErrorHandlingSuggestions(result) {
        const hasNetworkErrors = result.errors.some(e => e.message.toLowerCase().includes('url') ||
            e.message.toLowerCase().includes('endpoint') ||
            e.message.toLowerCase().includes('api'));
        if (hasNetworkErrors) {
            result.suggestions.push('For API calls, consider adding onError: "continueRegularOutput" with retryOnFail: true and maxTries: 3');
        }
        const isWebhook = result.operation?.resource === 'webhook' ||
            result.errors.some(e => e.message.toLowerCase().includes('webhook'));
        if (isWebhook) {
            result.suggestions.push('Webhooks should use onError: "continueRegularOutput" to ensure responses are always sent');
        }
    }
    static validateFixedCollectionStructures(nodeType, config, result) {
        const validationResult = fixed_collection_validator_1.FixedCollectionValidator.validate(nodeType, config);
        if (!validationResult.isValid) {
            for (const error of validationResult.errors) {
                result.errors.push({
                    type: 'invalid_value',
                    property: error.pattern.split('.')[0],
                    message: error.message,
                    fix: error.fix
                });
            }
            if (validationResult.autofix) {
                if (typeof validationResult.autofix === 'object' && !Array.isArray(validationResult.autofix)) {
                    result.autofix = {
                        ...result.autofix,
                        ...validationResult.autofix
                    };
                }
                else {
                    const firstError = validationResult.errors[0];
                    if (firstError) {
                        const rootProperty = firstError.pattern.split('.')[0];
                        result.autofix = {
                            ...result.autofix,
                            [rootProperty]: validationResult.autofix
                        };
                    }
                }
            }
        }
    }
    static validateSwitchNodeStructure(config, result) {
        if (!config.rules)
            return;
        const hasFixedCollectionError = result.errors.some(e => e.property === 'rules' && e.message.includes('propertyValues[itemName] is not iterable'));
        if (hasFixedCollectionError)
            return;
        if (config.rules.values && Array.isArray(config.rules.values)) {
            config.rules.values.forEach((rule, index) => {
                if (!rule.conditions) {
                    result.warnings.push({
                        type: 'missing_common',
                        property: 'rules',
                        message: `Switch rule ${index + 1} is missing "conditions" property`,
                        suggestion: 'Each rule in the values array should have a "conditions" property'
                    });
                }
                if (!rule.outputKey && rule.renameOutput !== false) {
                    result.warnings.push({
                        type: 'missing_common',
                        property: 'rules',
                        message: `Switch rule ${index + 1} is missing "outputKey" property`,
                        suggestion: 'Add "outputKey" to specify which output to use when this rule matches'
                    });
                }
            });
        }
    }
    static validateIfNodeStructure(config, result) {
        if (!config.conditions)
            return;
        const hasFixedCollectionError = result.errors.some(e => e.property === 'conditions' && e.message.includes('propertyValues[itemName] is not iterable'));
        if (hasFixedCollectionError)
            return;
    }
    static validateFilterNodeStructure(config, result) {
        if (!config.conditions)
            return;
        const hasFixedCollectionError = result.errors.some(e => e.property === 'conditions' && e.message.includes('propertyValues[itemName] is not iterable'));
        if (hasFixedCollectionError)
            return;
    }
    static validateResourceAndOperation(nodeType, config, result) {
        if (!this.operationSimilarityService || !this.resourceSimilarityService || !this.nodeRepository) {
            return;
        }
        const normalizedNodeType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        if (!this.nodeRepository.getNode(normalizedNodeType)) {
            return;
        }
        const configWithDefaults = { ...config };
        if (configWithDefaults.operation === undefined && configWithDefaults.resource !== undefined) {
            const defaultOperation = this.nodeRepository.getDefaultOperationForResource(normalizedNodeType, configWithDefaults.resource);
            if (defaultOperation !== undefined) {
                configWithDefaults.operation = defaultOperation;
            }
        }
        if (config.resource !== undefined) {
            result.errors = result.errors.filter(e => e.property !== 'resource');
            const validResources = this.nodeRepository.getNodeResources(normalizedNodeType);
            if (validResources.length > 0) {
                const resourceIsValid = validResources.some(r => {
                    const resourceValue = typeof r === 'string' ? r : r.value;
                    return resourceValue === config.resource;
                });
                if (!resourceIsValid && config.resource !== '') {
                    let suggestions = [];
                    try {
                        suggestions = this.resourceSimilarityService.findSimilarResources(normalizedNodeType, config.resource, 3);
                    }
                    catch (error) {
                        console.error('Resource similarity service error:', error);
                    }
                    let errorMessage = `Invalid resource "${config.resource}" for node ${nodeType}.`;
                    let fix = '';
                    if (suggestions.length > 0) {
                        const topSuggestion = suggestions[0];
                        errorMessage += ` Did you mean "${topSuggestion.value}"?`;
                        if (topSuggestion.confidence >= 0.8) {
                            fix = `Change resource to "${topSuggestion.value}". ${topSuggestion.reason}`;
                        }
                        else {
                            fix = `Valid resources: ${validResources.slice(0, 5).map(r => {
                                const val = typeof r === 'string' ? r : r.value;
                                return `"${val}"`;
                            }).join(', ')}${validResources.length > 5 ? '...' : ''}`;
                        }
                    }
                    else {
                        fix = `Valid resources: ${validResources.slice(0, 5).map(r => {
                            const val = typeof r === 'string' ? r : r.value;
                            return `"${val}"`;
                        }).join(', ')}${validResources.length > 5 ? '...' : ''}`;
                    }
                    const error = {
                        type: 'invalid_value',
                        property: 'resource',
                        message: errorMessage,
                        fix
                    };
                    if (suggestions.length > 0 && suggestions[0].confidence >= 0.5) {
                        error.suggestion = `Did you mean "${suggestions[0].value}"? ${suggestions[0].reason}`;
                    }
                    result.errors.push(error);
                    if (suggestions.length > 0) {
                        for (const suggestion of suggestions) {
                            result.suggestions.push(`Resource "${config.resource}" not found. Did you mean "${suggestion.value}"? ${suggestion.reason}`);
                        }
                    }
                }
            }
        }
        if (config.operation !== undefined || configWithDefaults.operation !== undefined) {
            result.errors = result.errors.filter(e => e.property !== 'operation');
            if (this.nodeRepository.getNodeOperations(normalizedNodeType).length === 0)
                return;
            const operationToValidate = configWithDefaults.operation || config.operation;
            const validOperations = this.nodeRepository.getNodeOperations(normalizedNodeType, config.resource);
            const operationIsValid = validOperations.some(op => {
                const opValue = op.operation || op.value || op;
                return opValue === operationToValidate;
            });
            if (!operationIsValid && config.operation !== undefined && config.operation !== '') {
                let suggestions = [];
                try {
                    suggestions = this.operationSimilarityService.findSimilarOperations(normalizedNodeType, config.operation, config.resource, 3);
                }
                catch (error) {
                    console.error('Operation similarity service error:', error);
                }
                let errorMessage = `Invalid operation "${config.operation}" for node ${nodeType}`;
                if (config.resource) {
                    errorMessage += ` with resource "${config.resource}"`;
                }
                errorMessage += '.';
                let fix = '';
                if (suggestions.length > 0) {
                    const topSuggestion = suggestions[0];
                    if (topSuggestion.confidence >= 0.8) {
                        errorMessage += ` Did you mean "${topSuggestion.value}"?`;
                        fix = `Change operation to "${topSuggestion.value}". ${topSuggestion.reason}`;
                    }
                    else {
                        errorMessage += ` Similar operations: ${suggestions.map(s => `"${s.value}"`).join(', ')}`;
                        fix = `Valid operations${config.resource ? ` for resource "${config.resource}"` : ''}: ${validOperations.slice(0, 5).map(op => {
                            const val = op.operation || op.value || op;
                            return `"${val}"`;
                        }).join(', ')}${validOperations.length > 5 ? '...' : ''}`;
                    }
                }
                else {
                    fix = `Valid operations${config.resource ? ` for resource "${config.resource}"` : ''}: ${validOperations.slice(0, 5).map(op => {
                        const val = op.operation || op.value || op;
                        return `"${val}"`;
                    }).join(', ')}${validOperations.length > 5 ? '...' : ''}`;
                }
                const error = {
                    type: 'invalid_value',
                    property: 'operation',
                    message: errorMessage,
                    fix
                };
                if (suggestions.length > 0 && suggestions[0].confidence >= 0.5) {
                    error.suggestion = `Did you mean "${suggestions[0].value}"? ${suggestions[0].reason}`;
                }
                result.errors.push(error);
                if (suggestions.length > 0) {
                    for (const suggestion of suggestions) {
                        result.suggestions.push(`Operation "${config.operation}" not found. Did you mean "${suggestion.value}"? ${suggestion.reason}`);
                    }
                }
            }
        }
    }
    static validateSpecialTypeStructures(config, properties, result) {
        for (const [key, value] of Object.entries(config)) {
            if (value === undefined || value === null)
                continue;
            const propDef = properties.find(p => p.name === key);
            if (!propDef)
                continue;
            let structureType = null;
            if (propDef.type === 'filter') {
                structureType = 'filter';
            }
            else if (propDef.type === 'resourceMapper') {
                structureType = 'resourceMapper';
            }
            else if (propDef.type === 'assignmentCollection') {
                structureType = 'assignmentCollection';
            }
            else if (propDef.type === 'resourceLocator') {
                structureType = 'resourceLocator';
            }
            if (!structureType)
                continue;
            const structure = type_structure_service_1.TypeStructureService.getStructure(structureType);
            if (!structure) {
                console.warn(`No structure definition found for type: ${structureType}`);
                continue;
            }
            const validationResult = type_structure_service_1.TypeStructureService.validateTypeCompatibility(value, structureType);
            if (!validationResult.valid) {
                for (const error of validationResult.errors) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: key,
                        message: error,
                        fix: `Ensure ${key} follows the expected structure for ${structureType} type. Example: ${JSON.stringify(structure.example)}`
                    });
                }
            }
            for (const warning of validationResult.warnings) {
                result.warnings.push({
                    type: 'best_practice',
                    property: key,
                    message: warning
                });
            }
            if (typeof value === 'object' && value !== null) {
                this.validateComplexTypeStructure(key, value, structureType, structure, result);
            }
            if (structureType === 'filter' && value.conditions) {
                this.validateFilterOperations(value.conditions, key, result);
            }
        }
    }
    static validateComplexTypeStructure(propertyName, value, type, structure, result) {
        switch (type) {
            case 'filter':
                if (!value.combinator) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.combinator`,
                        message: 'Filter must have a combinator field',
                        fix: 'Add combinator: "and" or combinator: "or" to the filter configuration'
                    });
                }
                else if (value.combinator !== 'and' && value.combinator !== 'or') {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.combinator`,
                        message: `Invalid combinator value: ${value.combinator}. Must be "and" or "or"`,
                        fix: 'Set combinator to either "and" or "or"'
                    });
                }
                if (!value.conditions) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.conditions`,
                        message: 'Filter must have a conditions field',
                        fix: 'Add conditions array to the filter configuration'
                    });
                }
                else if (!Array.isArray(value.conditions)) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.conditions`,
                        message: 'Filter conditions must be an array',
                        fix: 'Ensure conditions is an array of condition objects'
                    });
                }
                break;
            case 'resourceLocator':
                if (!value.mode) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.mode`,
                        message: 'ResourceLocator must have a mode field',
                        fix: 'Add mode: "id", mode: "url", or mode: "list" to the resourceLocator configuration'
                    });
                }
                else if (!['id', 'url', 'list', 'name'].includes(value.mode)) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.mode`,
                        message: `Invalid mode value: ${value.mode}. Must be "id", "url", "list", or "name"`,
                        fix: 'Set mode to one of: "id", "url", "list", "name"'
                    });
                }
                if (!value.hasOwnProperty('value')) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.value`,
                        message: 'ResourceLocator must have a value field',
                        fix: 'Add value field to the resourceLocator configuration'
                    });
                }
                break;
            case 'assignmentCollection':
                if (!value.assignments) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.assignments`,
                        message: 'AssignmentCollection must have an assignments field',
                        fix: 'Add assignments array to the assignmentCollection configuration'
                    });
                }
                else if (!Array.isArray(value.assignments)) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.assignments`,
                        message: 'AssignmentCollection assignments must be an array',
                        fix: 'Ensure assignments is an array of assignment objects'
                    });
                }
                break;
            case 'resourceMapper':
                if (!value.mappingMode) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.mappingMode`,
                        message: 'ResourceMapper must have a mappingMode field',
                        fix: 'Add mappingMode: "defineBelow" or mappingMode: "autoMapInputData"'
                    });
                }
                else if (!['defineBelow', 'autoMapInputData'].includes(value.mappingMode)) {
                    result.errors.push({
                        type: 'invalid_configuration',
                        property: `${propertyName}.mappingMode`,
                        message: `Invalid mappingMode: ${value.mappingMode}. Must be "defineBelow" or "autoMapInputData"`,
                        fix: 'Set mappingMode to either "defineBelow" or "autoMapInputData"'
                    });
                }
                break;
        }
    }
    static validateFilterOperations(conditions, propertyName, result) {
        if (!Array.isArray(conditions))
            return;
        const VALID_OPERATIONS_BY_TYPE = {
            string: [
                'empty', 'notEmpty', 'equals', 'notEquals',
                'contains', 'notContains', 'startsWith', 'notStartsWith',
                'endsWith', 'notEndsWith', 'regex', 'notRegex',
                'exists', 'notExists'
            ],
            number: [
                'empty', 'notEmpty', 'equals', 'notEquals', 'gt', 'lt', 'gte', 'lte',
                'exists', 'notExists'
            ],
            dateTime: [
                'empty', 'notEmpty', 'equals', 'notEquals', 'after', 'before', 'afterOrEquals', 'beforeOrEquals',
                'exists', 'notExists'
            ],
            boolean: [
                'empty', 'notEmpty', 'true', 'false', 'equals', 'notEquals',
                'exists', 'notExists'
            ],
            array: [
                'contains', 'notContains', 'lengthEquals', 'lengthNotEquals',
                'lengthGt', 'lengthLt', 'lengthGte', 'lengthLte', 'empty', 'notEmpty',
                'exists', 'notExists'
            ],
            object: [
                'empty', 'notEmpty',
                'exists', 'notExists'
            ],
            any: ['exists', 'notExists']
        };
        for (let i = 0; i < conditions.length; i++) {
            const condition = conditions[i];
            if (!condition.operator || typeof condition.operator !== 'object')
                continue;
            const { type, operation } = condition.operator;
            if (!type || !operation)
                continue;
            const validOperations = VALID_OPERATIONS_BY_TYPE[type];
            if (!validOperations) {
                result.warnings.push({
                    type: 'best_practice',
                    property: `${propertyName}.conditions[${i}].operator.type`,
                    message: `Unknown operator type: ${type}`
                });
                continue;
            }
            if (!validOperations.includes(operation)) {
                result.errors.push({
                    type: 'invalid_value',
                    property: `${propertyName}.conditions[${i}].operator.operation`,
                    message: `Operation '${operation}' is not valid for type '${type}'`,
                    fix: `Use one of the valid operations for ${type}: ${validOperations.join(', ')}`
                });
            }
        }
    }
}
exports.EnhancedConfigValidator = EnhancedConfigValidator;
EnhancedConfigValidator.operationSimilarityService = null;
EnhancedConfigValidator.resourceSimilarityService = null;
EnhancedConfigValidator.nodeRepository = null;
//# sourceMappingURL=enhanced-config-validator.js.map