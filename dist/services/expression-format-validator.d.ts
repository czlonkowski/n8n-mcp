export interface ExpressionFormatIssue {
    fieldPath: string;
    currentValue: any;
    correctedValue: any;
    issueType: 'missing-prefix' | 'needs-resource-locator' | 'invalid-rl-structure' | 'mixed-format' | 'missing-cached-result-name';
    explanation: string;
    severity: 'error' | 'warning';
    confidence?: number;
}
export interface ResourceLocatorField {
    __rl: true;
    value: string;
    mode: string;
    cachedResultName?: string;
}
export interface ValidationContext {
    nodeType: string;
    nodeName: string;
    nodeId?: string;
}
export declare class ExpressionFormatValidator {
    private static readonly VALID_RL_MODES;
    private static readonly MAX_RECURSION_DEPTH;
    private static readonly EXPRESSION_PREFIX;
    private static readonly RESOURCE_LOCATOR_FIELDS;
    private static shouldUseResourceLocator;
    private static isResourceLocator;
    private static generateCorrection;
    private static readonly MODES_USING_CACHED_NAME;
    private static checkCachedResultName;
    static validateAndFix(value: any, fieldPath: string, context: ValidationContext): ExpressionFormatIssue | null;
    static validateNodeParameters(parameters: any, context: ValidationContext): ExpressionFormatIssue[];
    private static validateRecursive;
    static formatErrorMessage(issue: ExpressionFormatIssue, context: ValidationContext): string;
}
//# sourceMappingURL=expression-format-validator.d.ts.map