interface ExpressionValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    usedVariables: Set<string>;
    usedNodes: Set<string>;
}
interface ExpressionContext {
    availableNodes: string[];
    currentNodeName?: string;
    isInLoop?: boolean;
    hasInputData?: boolean;
}
export declare class ExpressionValidator {
    private static readonly BARE_EXPRESSION_PATTERNS;
    private static readonly VARIABLE_PATTERNS;
    static validateExpression(expression: string, context: ExpressionContext): ExpressionValidationResult;
    private static checkSyntaxErrors;
    private static extractExpressions;
    private static validateSingleExpression;
    private static checkCommonMistakes;
    private static checkNodeReferences;
    static validateNodeExpressions(parameters: any, context: ExpressionContext): ExpressionValidationResult;
    private static checkBareExpression;
    private static validateParametersRecursive;
}
export {};
//# sourceMappingURL=expression-validator.d.ts.map