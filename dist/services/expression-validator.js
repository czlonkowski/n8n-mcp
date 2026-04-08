"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpressionValidator = void 0;
const expression_utils_1 = require("../utils/expression-utils");
class ExpressionValidator {
    static validateExpression(expression, context) {
        const result = {
            valid: true,
            errors: [],
            warnings: [],
            usedVariables: new Set(),
            usedNodes: new Set(),
        };
        if (!expression) {
            return result;
        }
        if (!context) {
            result.valid = false;
            result.errors.push('Validation context is required');
            return result;
        }
        const syntaxErrors = this.checkSyntaxErrors(expression);
        result.errors.push(...syntaxErrors);
        const expressions = this.extractExpressions(expression);
        for (const expr of expressions) {
            this.validateSingleExpression(expr, context, result);
        }
        this.checkNodeReferences(result, context);
        result.valid = result.errors.length === 0;
        return result;
    }
    static checkSyntaxErrors(expression) {
        const errors = [];
        const openBrackets = (expression.match(/\{\{/g) || []).length;
        const closeBrackets = (expression.match(/\}\}/g) || []).length;
        if (openBrackets !== closeBrackets) {
            errors.push('Unmatched expression brackets {{ }}');
        }
        const nestedPattern = /\{\{[^}]*\{\{/;
        if (nestedPattern.test(expression)) {
            errors.push('Nested expressions are not supported (expression inside another expression)');
        }
        const emptyExpressionPattern = /\{\{\s*\}\}/;
        if (emptyExpressionPattern.test(expression)) {
            errors.push('Empty expression found');
        }
        return errors;
    }
    static extractExpressions(text) {
        return (0, expression_utils_1.extractBracketExpressions)(text).map(match => match.slice(2, -2).trim());
    }
    static validateSingleExpression(expr, context, result) {
        let match;
        const jsonPattern = new RegExp(this.VARIABLE_PATTERNS.json.source, this.VARIABLE_PATTERNS.json.flags);
        while ((match = jsonPattern.exec(expr)) !== null) {
            result.usedVariables.add('$json');
            if (!context.hasInputData && !context.isInLoop) {
                result.warnings.push('Using $json but node might not have input data');
            }
            const fullMatch = match[0];
            if (fullMatch.includes('.invalid') || fullMatch.includes('.undefined') ||
                fullMatch.includes('.null') || fullMatch.includes('.test')) {
                result.warnings.push(`Property access '${fullMatch}' looks suspicious - verify this property exists in your data`);
            }
        }
        const nodePattern = new RegExp(this.VARIABLE_PATTERNS.node.source, this.VARIABLE_PATTERNS.node.flags);
        while ((match = nodePattern.exec(expr)) !== null) {
            const nodeName = match[1];
            result.usedNodes.add(nodeName);
            result.usedVariables.add('$node');
        }
        const inputPattern = new RegExp(this.VARIABLE_PATTERNS.input.source, this.VARIABLE_PATTERNS.input.flags);
        while ((match = inputPattern.exec(expr)) !== null) {
            result.usedVariables.add('$input');
            if (!context.hasInputData) {
                result.warnings.push('$input is only available when the node has input data');
            }
        }
        const itemsPattern = new RegExp(this.VARIABLE_PATTERNS.items.source, this.VARIABLE_PATTERNS.items.flags);
        while ((match = itemsPattern.exec(expr)) !== null) {
            const nodeName = match[1];
            result.usedNodes.add(nodeName);
            result.usedVariables.add('$items');
        }
        for (const [varName, pattern] of Object.entries(this.VARIABLE_PATTERNS)) {
            if (['json', 'node', 'input', 'items'].includes(varName))
                continue;
            const testPattern = new RegExp(pattern.source, pattern.flags);
            if (testPattern.test(expr)) {
                result.usedVariables.add(`$${varName}`);
            }
        }
        this.checkCommonMistakes(expr, result);
    }
    static checkCommonMistakes(expr, result) {
        const missingPrefixPattern = /(?<![.$\w['])\b(json|node|input|items|workflow|execution)\b(?!\s*[:''])/;
        if (expr.match(missingPrefixPattern)) {
            result.warnings.push('Possible missing $ prefix for variable (e.g., use $json instead of json)');
        }
        if (expr.includes('$json[') && !expr.match(/\$json\[\d+\]/)) {
            result.warnings.push('Array access should use numeric index: $json[0] or property access: $json.property');
        }
        if (expr.match(/\$json\['[^']+'\]/)) {
            result.warnings.push("Consider using dot notation: $json.property instead of $json['property']");
        }
        if (expr.match(/\?\./)) {
            result.warnings.push('Optional chaining (?.) is not supported in n8n expressions');
        }
        if (expr.includes('${')) {
            result.errors.push('Template literals ${} are not supported. Use string concatenation instead');
        }
    }
    static checkNodeReferences(result, context) {
        for (const nodeName of result.usedNodes) {
            if (!context.availableNodes.includes(nodeName)) {
                result.errors.push(`Referenced node "${nodeName}" not found in workflow`);
            }
        }
    }
    static validateNodeExpressions(parameters, context) {
        const combinedResult = {
            valid: true,
            errors: [],
            warnings: [],
            usedVariables: new Set(),
            usedNodes: new Set(),
        };
        const visited = new WeakSet();
        this.validateParametersRecursive(parameters, context, combinedResult, '', visited);
        combinedResult.valid = combinedResult.errors.length === 0;
        return combinedResult;
    }
    static checkBareExpression(value, path, result) {
        if (value.includes('{{') || value.startsWith('=')) {
            return;
        }
        const trimmed = value.trim();
        for (const { pattern, name } of this.BARE_EXPRESSION_PATTERNS) {
            if (pattern.test(trimmed)) {
                result.warnings.push((path ? `${path}: ` : '') +
                    `Possible unwrapped expression: "${trimmed}" looks like an n8n ${name} reference. ` +
                    `Use "={{ ${trimmed} }}" to evaluate it as an expression.`);
                return;
            }
        }
    }
    static validateParametersRecursive(obj, context, result, path = '', visited = new WeakSet()) {
        if (obj && typeof obj === 'object') {
            if (visited.has(obj)) {
                return;
            }
            visited.add(obj);
        }
        if (typeof obj === 'string') {
            this.checkBareExpression(obj, path, result);
            if (obj.includes('{{')) {
                const validation = this.validateExpression(obj, context);
                validation.errors.forEach(error => {
                    result.errors.push(path ? `${path}: ${error}` : error);
                });
                validation.warnings.forEach(warning => {
                    result.warnings.push(path ? `${path}: ${warning}` : warning);
                });
                validation.usedVariables.forEach(v => result.usedVariables.add(v));
                validation.usedNodes.forEach(n => result.usedNodes.add(n));
            }
        }
        else if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                this.validateParametersRecursive(item, context, result, `${path}[${index}]`, visited);
            });
        }
        else if (obj && typeof obj === 'object') {
            Object.entries(obj).forEach(([key, value]) => {
                const newPath = path ? `${path}.${key}` : key;
                this.validateParametersRecursive(value, context, result, newPath, visited);
            });
        }
    }
}
exports.ExpressionValidator = ExpressionValidator;
ExpressionValidator.BARE_EXPRESSION_PATTERNS = [
    { pattern: /^\$json[.\[]/, name: '$json' },
    { pattern: /^\$node\[/, name: '$node' },
    { pattern: /^\$input\./, name: '$input' },
    { pattern: /^\$execution\./, name: '$execution' },
    { pattern: /^\$workflow\./, name: '$workflow' },
    { pattern: /^\$prevNode\./, name: '$prevNode' },
    { pattern: /^\$env\./, name: '$env' },
    { pattern: /^\$(now|today|itemIndex|runIndex)$/, name: 'built-in variable' },
];
ExpressionValidator.VARIABLE_PATTERNS = {
    json: /\$json(\.[a-zA-Z_][\w]*|\["[^"]+"\]|\['[^']+'\]|\[\d+\])*/g,
    node: /\$node\["([^"]+)"\]\.json/g,
    input: /\$input\.item(\.[a-zA-Z_][\w]*|\["[^"]+"\]|\['[^']+'\]|\[\d+\])*/g,
    items: /\$items\("([^"]+)"(?:,\s*(-?\d+))?\)/g,
    parameter: /\$parameter\["([^"]+)"\]/g,
    env: /\$env\.([a-zA-Z_][\w]*)/g,
    workflow: /\$workflow\.(id|name|active)/g,
    execution: /\$execution\.(id|mode|resumeUrl)/g,
    prevNode: /\$prevNode\.(name|outputIndex|runIndex)/g,
    itemIndex: /\$itemIndex/g,
    runIndex: /\$runIndex/g,
    now: /\$now/g,
    today: /\$today/g,
};
//# sourceMappingURL=expression-validator.js.map