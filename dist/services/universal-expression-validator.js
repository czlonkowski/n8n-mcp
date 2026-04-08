"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniversalExpressionValidator = void 0;
const expression_utils_1 = require("../utils/expression-utils");
class UniversalExpressionValidator {
    static validateExpressionPrefix(value) {
        if (typeof value !== 'string') {
            return {
                isValid: true,
                hasExpression: false,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: 'Not a string value'
            };
        }
        const hasExpression = (0, expression_utils_1.hasBracketExpression)(value);
        if (!hasExpression) {
            return {
                isValid: true,
                hasExpression: false,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: 'No n8n expression found'
            };
        }
        const hasPrefix = value.startsWith(this.EXPRESSION_PREFIX);
        const isMixedContent = this.hasMixedContent(value);
        if (!hasPrefix) {
            return {
                isValid: false,
                hasExpression: true,
                needsPrefix: true,
                isMixedContent,
                confidence: 1.0,
                suggestion: `${this.EXPRESSION_PREFIX}${value}`,
                explanation: isMixedContent
                    ? 'Mixed literal text and expression requires = prefix for expression evaluation'
                    : 'Expression requires = prefix to be evaluated'
            };
        }
        return {
            isValid: true,
            hasExpression: true,
            needsPrefix: false,
            isMixedContent,
            confidence: 1.0,
            explanation: 'Expression is properly formatted with = prefix'
        };
    }
    static hasMixedContent(value) {
        const content = value.startsWith(this.EXPRESSION_PREFIX)
            ? value.substring(1)
            : value;
        let withoutExpressions = '';
        let cursor = 0;
        while (cursor < content.length) {
            const start = content.indexOf('{{', cursor);
            if (start === -1) {
                withoutExpressions += content.slice(cursor);
                break;
            }
            withoutExpressions += content.slice(cursor, start);
            const end = content.indexOf('}}', start + 2);
            if (end === -1) {
                withoutExpressions += content.slice(start);
                break;
            }
            cursor = end + 2;
        }
        return withoutExpressions.trim().length > 0;
    }
    static validateExpressionSyntax(value) {
        const hasAnyBrackets = value.includes('{{') || value.includes('}}');
        if (!hasAnyBrackets) {
            return {
                isValid: true,
                hasExpression: false,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: 'No expression to validate'
            };
        }
        const openCount = (value.match(/\{\{/g) || []).length;
        const closeCount = (value.match(/\}\}/g) || []).length;
        if (openCount !== closeCount) {
            return {
                isValid: false,
                hasExpression: true,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: `Unmatched expression brackets: ${openCount} opening, ${closeCount} closing`
            };
        }
        const expressions = (0, expression_utils_1.extractBracketExpressions)(value);
        for (const expr of expressions) {
            const content = expr.slice(2, -2).trim();
            if (!content) {
                return {
                    isValid: false,
                    hasExpression: true,
                    needsPrefix: false,
                    isMixedContent: false,
                    confidence: 1.0,
                    explanation: 'Empty expression {{ }} is not valid'
                };
            }
        }
        return {
            isValid: true,
            hasExpression: expressions.length > 0,
            needsPrefix: false,
            isMixedContent: this.hasMixedContent(value),
            confidence: 1.0,
            explanation: 'Expression syntax is valid'
        };
    }
    static validateCommonPatterns(value) {
        if (!(0, expression_utils_1.hasBracketExpression)(value)) {
            return {
                isValid: true,
                hasExpression: false,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: 'No expression to validate'
            };
        }
        const expressions = (0, expression_utils_1.extractBracketExpressions)(value);
        const warnings = [];
        for (const expr of expressions) {
            const content = expr.slice(2, -2).trim();
            if (content.includes('${') && content.includes('}')) {
                warnings.push(`Template literal syntax \${} found - use n8n syntax instead: ${expr}`);
            }
            if (content.startsWith('=')) {
                warnings.push(`Double prefix detected in expression: ${expr}`);
            }
            if (content.includes('{{') || content.includes('}}')) {
                warnings.push(`Nested brackets detected: ${expr}`);
            }
        }
        if (warnings.length > 0) {
            return {
                isValid: false,
                hasExpression: true,
                needsPrefix: false,
                isMixedContent: false,
                confidence: 1.0,
                explanation: warnings.join('; ')
            };
        }
        return {
            isValid: true,
            hasExpression: true,
            needsPrefix: false,
            isMixedContent: this.hasMixedContent(value),
            confidence: 1.0,
            explanation: 'Expression patterns are valid'
        };
    }
    static validate(value) {
        const results = [];
        const prefixResult = this.validateExpressionPrefix(value);
        if (!prefixResult.isValid) {
            results.push(prefixResult);
        }
        if (typeof value === 'string') {
            const syntaxResult = this.validateExpressionSyntax(value);
            if (!syntaxResult.isValid) {
                results.push(syntaxResult);
            }
            const patternResult = this.validateCommonPatterns(value);
            if (!patternResult.isValid) {
                results.push(patternResult);
            }
        }
        if (results.length === 0) {
            results.push({
                isValid: true,
                hasExpression: prefixResult.hasExpression,
                needsPrefix: false,
                isMixedContent: prefixResult.isMixedContent,
                confidence: 1.0,
                explanation: prefixResult.hasExpression
                    ? 'Expression is valid'
                    : 'No expression found'
            });
        }
        return results;
    }
    static getCorrectedValue(value) {
        if (!(0, expression_utils_1.hasBracketExpression)(value)) {
            return value;
        }
        if (!value.startsWith(this.EXPRESSION_PREFIX)) {
            return `${this.EXPRESSION_PREFIX}${value}`;
        }
        return value;
    }
}
exports.UniversalExpressionValidator = UniversalExpressionValidator;
UniversalExpressionValidator.EXPRESSION_PREFIX = '=';
//# sourceMappingURL=universal-expression-validator.js.map