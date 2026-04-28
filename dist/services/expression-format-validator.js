"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpressionFormatValidator = void 0;
const universal_expression_validator_1 = require("./universal-expression-validator");
const confidence_scorer_1 = require("./confidence-scorer");
class ExpressionFormatValidator {
    static shouldUseResourceLocator(fieldName, nodeType) {
        const nodeBase = nodeType.split('.').pop()?.toLowerCase() || '';
        for (const [pattern, fields] of Object.entries(this.RESOURCE_LOCATOR_FIELDS)) {
            if ((nodeBase === pattern || nodeBase.startsWith(`${pattern}-`)) && fields.includes(fieldName)) {
                return true;
            }
        }
        return false;
    }
    static isResourceLocator(value) {
        if (typeof value !== 'object' || value === null || value.__rl !== true) {
            return false;
        }
        if (!('value' in value) || !('mode' in value)) {
            return false;
        }
        if (typeof value.mode !== 'string' || !this.VALID_RL_MODES.includes(value.mode)) {
            return false;
        }
        return true;
    }
    static generateCorrection(value, needsResourceLocator) {
        const correctedValue = value.startsWith(this.EXPRESSION_PREFIX)
            ? value
            : `${this.EXPRESSION_PREFIX}${value}`;
        if (needsResourceLocator) {
            return {
                __rl: true,
                value: correctedValue,
                mode: 'expression'
            };
        }
        return correctedValue;
    }
    static validateAndFix(value, fieldPath, context) {
        if (typeof value !== 'string' && !this.isResourceLocator(value)) {
            return null;
        }
        if (this.isResourceLocator(value)) {
            const universalResults = universal_expression_validator_1.UniversalExpressionValidator.validate(value.value);
            const invalidResult = universalResults.find(r => !r.isValid && r.needsPrefix);
            if (invalidResult) {
                return {
                    fieldPath,
                    currentValue: value,
                    correctedValue: {
                        ...value,
                        value: universal_expression_validator_1.UniversalExpressionValidator.getCorrectedValue(value.value)
                    },
                    issueType: 'missing-prefix',
                    explanation: `Resource locator value: ${invalidResult.explanation}`,
                    severity: 'error'
                };
            }
            return null;
        }
        const universalResults = universal_expression_validator_1.UniversalExpressionValidator.validate(value);
        const invalidResults = universalResults.filter(r => !r.isValid);
        if (invalidResults.length > 0) {
            const prefixIssue = invalidResults.find(r => r.needsPrefix);
            if (prefixIssue) {
                const fieldName = fieldPath.split('.').pop() || '';
                const confidenceScore = confidence_scorer_1.ConfidenceScorer.scoreResourceLocatorRecommendation(fieldName, context.nodeType, value);
                if (confidenceScore.value >= 0.8) {
                    return {
                        fieldPath,
                        currentValue: value,
                        correctedValue: this.generateCorrection(value, true),
                        issueType: 'needs-resource-locator',
                        explanation: `Field '${fieldName}' contains expression but needs resource locator format with '${this.EXPRESSION_PREFIX}' prefix for evaluation.`,
                        severity: 'error',
                        confidence: confidenceScore.value
                    };
                }
                else {
                    return {
                        fieldPath,
                        currentValue: value,
                        correctedValue: universal_expression_validator_1.UniversalExpressionValidator.getCorrectedValue(value),
                        issueType: 'missing-prefix',
                        explanation: prefixIssue.explanation,
                        severity: 'error'
                    };
                }
            }
            const firstIssue = invalidResults[0];
            return {
                fieldPath,
                currentValue: value,
                correctedValue: value,
                issueType: 'mixed-format',
                explanation: firstIssue.explanation,
                severity: 'error'
            };
        }
        const hasExpression = universalResults.some(r => r.hasExpression);
        if (hasExpression && typeof value === 'string') {
            const fieldName = fieldPath.split('.').pop() || '';
            const confidenceScore = confidence_scorer_1.ConfidenceScorer.scoreResourceLocatorRecommendation(fieldName, context.nodeType, value);
            if (confidenceScore.value >= 0.5) {
                return {
                    fieldPath,
                    currentValue: value,
                    correctedValue: this.generateCorrection(value, true),
                    issueType: 'needs-resource-locator',
                    explanation: `Field '${fieldName}' should use resource locator format for better compatibility. (Confidence: ${Math.round(confidenceScore.value * 100)}%)`,
                    severity: 'warning',
                    confidence: confidenceScore.value
                };
            }
        }
        return null;
    }
    static validateNodeParameters(parameters, context) {
        const issues = [];
        const visited = new WeakSet();
        this.validateRecursive(parameters, '', context, issues, visited);
        return issues;
    }
    static validateRecursive(obj, path, context, issues, visited, depth = 0) {
        if (depth > this.MAX_RECURSION_DEPTH) {
            issues.push({
                fieldPath: path,
                currentValue: obj,
                correctedValue: obj,
                issueType: 'mixed-format',
                explanation: `Maximum recursion depth (${this.MAX_RECURSION_DEPTH}) exceeded. Object may have circular references or be too deeply nested.`,
                severity: 'warning'
            });
            return;
        }
        if (obj && typeof obj === 'object') {
            if (visited.has(obj))
                return;
            visited.add(obj);
        }
        const issue = this.validateAndFix(obj, path, context);
        if (issue) {
            issues.push(issue);
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                const newPath = path ? `${path}[${index}]` : `[${index}]`;
                this.validateRecursive(item, newPath, context, issues, visited, depth + 1);
            });
        }
        else if (obj && typeof obj === 'object') {
            if (this.isResourceLocator(obj)) {
                return;
            }
            Object.entries(obj).forEach(([key, value]) => {
                if (key.startsWith('__'))
                    return;
                if (key === 'jsCode' || key === 'pythonCode' || key === 'functionCode')
                    return;
                const newPath = path ? `${path}.${key}` : key;
                this.validateRecursive(value, newPath, context, issues, visited, depth + 1);
            });
        }
    }
    static formatErrorMessage(issue, context) {
        let message = `Expression format ${issue.severity} in node '${context.nodeName}':\n`;
        message += `Field '${issue.fieldPath}' ${issue.explanation}\n\n`;
        message += `Current (incorrect):\n`;
        if (typeof issue.currentValue === 'string') {
            message += `"${issue.fieldPath}": "${issue.currentValue}"\n\n`;
        }
        else {
            message += `"${issue.fieldPath}": ${JSON.stringify(issue.currentValue, null, 2)}\n\n`;
        }
        message += `Fixed (correct):\n`;
        if (typeof issue.correctedValue === 'string') {
            message += `"${issue.fieldPath}": "${issue.correctedValue}"`;
        }
        else {
            message += `"${issue.fieldPath}": ${JSON.stringify(issue.correctedValue, null, 2)}`;
        }
        return message;
    }
}
exports.ExpressionFormatValidator = ExpressionFormatValidator;
ExpressionFormatValidator.VALID_RL_MODES = ['id', 'url', 'expression', 'name', 'list'];
ExpressionFormatValidator.MAX_RECURSION_DEPTH = 100;
ExpressionFormatValidator.EXPRESSION_PREFIX = '=';
ExpressionFormatValidator.RESOURCE_LOCATOR_FIELDS = {
    'github': ['owner', 'repository', 'user', 'organization'],
    'googleSheets': ['sheetId', 'documentId', 'spreadsheetId', 'rangeDefinition'],
    'googleDrive': ['fileId', 'folderId', 'driveId'],
    'slack': ['channel', 'user', 'channelId', 'userId', 'teamId'],
    'notion': ['databaseId', 'pageId', 'blockId'],
    'airtable': ['baseId', 'tableId', 'viewId'],
    'monday': ['boardId', 'itemId', 'groupId'],
    'hubspot': ['contactId', 'companyId', 'dealId'],
    'salesforce': ['recordId', 'objectName'],
    'jira': ['projectKey', 'issueKey', 'boardId'],
    'gitlab': ['projectId', 'mergeRequestId', 'issueId'],
    'mysql': ['table', 'database', 'schema'],
    'postgres': ['table', 'database', 'schema'],
    'mongodb': ['collection', 'database'],
    's3': ['bucketName', 'key', 'fileName'],
    'ftp': ['path', 'fileName'],
    'ssh': ['path', 'fileName'],
    'redis': ['key'],
};
//# sourceMappingURL=expression-format-validator.js.map