"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeNode = sanitizeNode;
exports.sanitizeWorkflowNodes = sanitizeWorkflowNodes;
exports.validateNodeMetadata = validateNodeMetadata;
const logger_1 = require("../utils/logger");
function sanitizeNode(node) {
    const sanitized = { ...node };
    if (isFilterBasedNode(node.type, node.typeVersion)) {
        sanitized.parameters = sanitizeFilterBasedNode(sanitized.parameters, node.type, node.typeVersion);
    }
    return sanitized;
}
function sanitizeWorkflowNodes(workflow) {
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
        return workflow;
    }
    return {
        ...workflow,
        nodes: workflow.nodes.map(sanitizeNode)
    };
}
function isFilterBasedNode(nodeType, typeVersion) {
    if (nodeType === 'n8n-nodes-base.if') {
        return typeVersion >= 2.2;
    }
    if (nodeType === 'n8n-nodes-base.switch') {
        return typeVersion >= 3.2;
    }
    return false;
}
function sanitizeFilterBasedNode(parameters, nodeType, typeVersion) {
    const sanitized = { ...parameters };
    if (nodeType === 'n8n-nodes-base.if' && typeVersion >= 2.2) {
        sanitized.conditions = sanitizeFilterConditions(sanitized.conditions);
    }
    if (nodeType === 'n8n-nodes-base.switch' && typeVersion >= 3.2) {
        if (sanitized.rules && typeof sanitized.rules === 'object') {
            const rules = sanitized.rules;
            if (rules.rules && Array.isArray(rules.rules)) {
                rules.rules = rules.rules.map((rule) => ({
                    ...rule,
                    conditions: sanitizeFilterConditions(rule.conditions)
                }));
            }
        }
    }
    return sanitized;
}
function sanitizeFilterConditions(conditions) {
    if (!conditions || typeof conditions !== 'object') {
        return conditions;
    }
    const sanitized = { ...conditions };
    if (!sanitized.options) {
        sanitized.options = {};
    }
    const requiredOptions = {
        version: 2,
        leftValue: '',
        caseSensitive: true,
        typeValidation: 'strict'
    };
    sanitized.options = {
        ...requiredOptions,
        ...sanitized.options
    };
    if (sanitized.conditions && Array.isArray(sanitized.conditions)) {
        sanitized.conditions = sanitized.conditions.map(sanitizeCondition);
    }
    return sanitized;
}
function sanitizeCondition(condition) {
    if (!condition || typeof condition !== 'object') {
        return condition;
    }
    const sanitized = { ...condition };
    if (!sanitized.id) {
        sanitized.id = generateConditionId();
    }
    if (sanitized.operator) {
        sanitized.operator = sanitizeOperator(sanitized.operator);
    }
    return sanitized;
}
function sanitizeOperator(operator) {
    if (!operator || typeof operator !== 'object') {
        return operator;
    }
    const sanitized = { ...operator };
    if (sanitized.type && !sanitized.operation) {
        const typeValue = sanitized.type;
        if (isOperationName(typeValue)) {
            logger_1.logger.debug(`Fixing operator structure: converting type="${typeValue}" to operation`);
            const dataType = inferDataType(typeValue);
            sanitized.type = dataType;
            sanitized.operation = typeValue;
        }
    }
    if (sanitized.operation) {
        if (isUnaryOperator(sanitized.operation)) {
            sanitized.singleValue = true;
        }
        else {
            delete sanitized.singleValue;
        }
    }
    return sanitized;
}
function isOperationName(value) {
    const dataTypes = ['string', 'number', 'boolean', 'dateTime', 'array', 'object'];
    return !dataTypes.includes(value) && /^[a-z][a-zA-Z]*$/.test(value);
}
function inferDataType(operation) {
    const booleanOps = ['true', 'false', 'isEmpty', 'isNotEmpty'];
    if (booleanOps.includes(operation)) {
        return 'boolean';
    }
    const numberOps = ['isNumeric', 'gt', 'gte', 'lt', 'lte'];
    if (numberOps.some(op => operation.includes(op))) {
        return 'number';
    }
    const dateOps = ['after', 'before', 'afterDate', 'beforeDate'];
    if (dateOps.some(op => operation.includes(op))) {
        return 'dateTime';
    }
    const objectOps = ['empty', 'notEmpty', 'exists', 'notExists'];
    if (objectOps.includes(operation)) {
        return 'object';
    }
    return 'string';
}
function isUnaryOperator(operation) {
    const unaryOps = [
        'isEmpty',
        'isNotEmpty',
        'true',
        'false',
        'isNumeric',
        'empty',
        'notEmpty',
        'exists',
        'notExists'
    ];
    return unaryOps.includes(operation);
}
function generateConditionId() {
    return `condition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
function validateNodeMetadata(node) {
    const issues = [];
    if (!isFilterBasedNode(node.type, node.typeVersion)) {
        return issues;
    }
    if (node.type === 'n8n-nodes-base.if') {
        const conditions = node.parameters.conditions;
        if (!conditions?.options) {
            issues.push('Missing conditions.options');
        }
        else {
            const required = ['version', 'leftValue', 'typeValidation', 'caseSensitive'];
            for (const field of required) {
                if (!(field in conditions.options)) {
                    issues.push(`Missing conditions.options.${field}`);
                }
            }
        }
        if (conditions?.conditions && Array.isArray(conditions.conditions)) {
            for (let i = 0; i < conditions.conditions.length; i++) {
                const condition = conditions.conditions[i];
                const operatorIssues = validateOperator(condition.operator, `conditions.conditions[${i}].operator`);
                issues.push(...operatorIssues);
            }
        }
    }
    if (node.type === 'n8n-nodes-base.switch') {
        const rules = node.parameters.rules;
        if (rules?.rules && Array.isArray(rules.rules)) {
            for (let i = 0; i < rules.rules.length; i++) {
                const rule = rules.rules[i];
                if (!rule.conditions?.options) {
                    issues.push(`Missing rules.rules[${i}].conditions.options`);
                }
                else {
                    const required = ['version', 'leftValue', 'typeValidation', 'caseSensitive'];
                    for (const field of required) {
                        if (!(field in rule.conditions.options)) {
                            issues.push(`Missing rules.rules[${i}].conditions.options.${field}`);
                        }
                    }
                }
                if (rule.conditions?.conditions && Array.isArray(rule.conditions.conditions)) {
                    for (let j = 0; j < rule.conditions.conditions.length; j++) {
                        const condition = rule.conditions.conditions[j];
                        const operatorIssues = validateOperator(condition.operator, `rules.rules[${i}].conditions.conditions[${j}].operator`);
                        issues.push(...operatorIssues);
                    }
                }
            }
        }
    }
    return issues;
}
function validateOperator(operator, path) {
    const issues = [];
    if (!operator || typeof operator !== 'object') {
        issues.push(`${path}: operator is missing or not an object`);
        return issues;
    }
    if (!operator.type) {
        issues.push(`${path}: missing required field 'type'`);
    }
    else if (!['string', 'number', 'boolean', 'dateTime', 'array', 'object'].includes(operator.type)) {
        issues.push(`${path}: invalid type "${operator.type}" (must be data type, not operation)`);
    }
    if (!operator.operation) {
        issues.push(`${path}: missing required field 'operation'`);
    }
    if (operator.operation) {
        if (isUnaryOperator(operator.operation)) {
            if (operator.singleValue !== true) {
                issues.push(`${path}: unary operator "${operator.operation}" requires singleValue: true`);
            }
        }
        else {
            if (operator.singleValue === true) {
                issues.push(`${path}: binary operator "${operator.operation}" should not have singleValue: true (only unary operators need this)`);
            }
        }
    }
    return issues;
}
//# sourceMappingURL=node-sanitizer.js.map