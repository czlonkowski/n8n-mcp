import { WorkflowValidationResult } from './workflow-validator';
import { ExpressionFormatIssue } from './expression-format-validator';
import { NodeRepository } from '../database/node-repository';
import { WorkflowDiffOperation } from '../types/workflow-diff';
import { Workflow } from '../types/n8n-api';
import { PostUpdateGuidance } from './post-update-validator';
export type FixConfidenceLevel = 'high' | 'medium' | 'low';
export type FixType = 'expression-format' | 'typeversion-correction' | 'error-output-config' | 'node-type-correction' | 'webhook-missing-path' | 'typeversion-upgrade' | 'version-migration' | 'tool-variant-correction' | 'connection-numeric-keys' | 'connection-invalid-type' | 'connection-id-to-name' | 'connection-duplicate-removal' | 'connection-input-index';
export declare const CONNECTION_FIX_TYPES: FixType[];
export interface AutoFixConfig {
    applyFixes: boolean;
    fixTypes?: FixType[];
    confidenceThreshold?: FixConfidenceLevel;
    maxFixes?: number;
}
export interface FixOperation {
    node: string;
    field: string;
    type: FixType;
    before: any;
    after: any;
    confidence: FixConfidenceLevel;
    description: string;
}
export interface AutoFixResult {
    operations: WorkflowDiffOperation[];
    fixes: FixOperation[];
    summary: string;
    stats: {
        total: number;
        byType: Record<FixType, number>;
        byConfidence: Record<FixConfidenceLevel, number>;
    };
    postUpdateGuidance?: PostUpdateGuidance[];
}
export interface NodeFormatIssue extends ExpressionFormatIssue {
    nodeName: string;
    nodeId: string;
}
export declare function isNodeFormatIssue(issue: ExpressionFormatIssue): issue is NodeFormatIssue;
export interface NodeTypeError {
    type: 'error';
    nodeId?: string;
    nodeName?: string;
    message: string;
    suggestions?: Array<{
        nodeType: string;
        confidence: number;
        reason: string;
    }>;
}
export declare class WorkflowAutoFixer {
    private readonly defaultConfig;
    private similarityService;
    private versionService;
    private breakingChangeDetector;
    private migrationService;
    private postUpdateValidator;
    constructor(repository?: NodeRepository);
    generateFixes(workflow: Workflow, validationResult: WorkflowValidationResult, formatIssues?: ExpressionFormatIssue[], config?: Partial<AutoFixConfig>): Promise<AutoFixResult>;
    private processExpressionFormatFixes;
    private processTypeVersionFixes;
    private processErrorOutputFixes;
    private processNodeTypeFixes;
    private static readonly WEBHOOK_ID_NAMESPACE;
    private deriveStableWebhookId;
    private processWebhookPathFixes;
    private processToolVariantFixes;
    private setNestedValue;
    private filterByConfidence;
    private filterOperationsByFixes;
    private calculateStats;
    private generateSummary;
    private processConnectionFixes;
    private fixNumericKeys;
    private fixIdToName;
    private fixInvalidTypes;
    private fixInputIndices;
    private fixDuplicateConnections;
    private processVersionUpgradeFixes;
    private processVersionMigrationFixes;
}
//# sourceMappingURL=workflow-auto-fixer.d.ts.map