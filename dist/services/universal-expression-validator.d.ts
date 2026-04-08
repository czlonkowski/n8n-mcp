export interface UniversalValidationResult {
    isValid: boolean;
    hasExpression: boolean;
    needsPrefix: boolean;
    isMixedContent: boolean;
    confidence: 1.0;
    suggestion?: string;
    explanation: string;
}
export declare class UniversalExpressionValidator {
    private static readonly EXPRESSION_PREFIX;
    static validateExpressionPrefix(value: any): UniversalValidationResult;
    private static hasMixedContent;
    static validateExpressionSyntax(value: string): UniversalValidationResult;
    static validateCommonPatterns(value: string): UniversalValidationResult;
    static validate(value: any): UniversalValidationResult[];
    static getCorrectedValue(value: string): string;
}
//# sourceMappingURL=universal-expression-validator.d.ts.map