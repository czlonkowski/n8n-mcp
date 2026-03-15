export interface WorkflowNode {
    id: string;
    name: string;
    type: string;
    position: [number, number];
    parameters: any;
    credentials?: any;
    disabled?: boolean;
    typeVersion?: number;
}
export interface WorkflowJson {
    name?: string;
    nodes: WorkflowNode[];
    connections: Record<string, any>;
    settings?: any;
}
export interface ReverseConnection {
    sourceName: string;
    sourceType: string;
    type: string;
    index: number;
}
export interface ValidationIssue {
    severity: 'error' | 'warning' | 'info';
    nodeId?: string;
    nodeName?: string;
    message: string;
    code?: string;
}
export declare function validateHTTPRequestTool(node: WorkflowNode): ValidationIssue[];
export declare function validateCodeTool(node: WorkflowNode): ValidationIssue[];
export declare function validateVectorStoreTool(node: WorkflowNode, reverseConnections: Map<string, ReverseConnection[]>, workflow: WorkflowJson): ValidationIssue[];
export declare function validateWorkflowTool(node: WorkflowNode, reverseConnections?: Map<string, ReverseConnection[]>): ValidationIssue[];
export declare function validateAIAgentTool(node: WorkflowNode, reverseConnections: Map<string, ReverseConnection[]>): ValidationIssue[];
export declare function validateMCPClientTool(node: WorkflowNode): ValidationIssue[];
export declare function validateCalculatorTool(_node: WorkflowNode): ValidationIssue[];
export declare function validateThinkTool(_node: WorkflowNode): ValidationIssue[];
export declare function validateSerpApiTool(node: WorkflowNode): ValidationIssue[];
export declare function validateWikipediaTool(node: WorkflowNode): ValidationIssue[];
export declare function validateSearXngTool(node: WorkflowNode): ValidationIssue[];
export declare function validateWolframAlphaTool(node: WorkflowNode): ValidationIssue[];
export declare const AI_TOOL_VALIDATORS: {
    readonly 'nodes-langchain.toolHttpRequest': typeof validateHTTPRequestTool;
    readonly 'nodes-langchain.toolCode': typeof validateCodeTool;
    readonly 'nodes-langchain.toolVectorStore': typeof validateVectorStoreTool;
    readonly 'nodes-langchain.toolWorkflow': typeof validateWorkflowTool;
    readonly 'nodes-langchain.agentTool': typeof validateAIAgentTool;
    readonly 'nodes-langchain.mcpClientTool': typeof validateMCPClientTool;
    readonly 'nodes-langchain.toolCalculator': typeof validateCalculatorTool;
    readonly 'nodes-langchain.toolThink': typeof validateThinkTool;
    readonly 'nodes-langchain.toolSerpApi': typeof validateSerpApiTool;
    readonly 'nodes-langchain.toolWikipedia': typeof validateWikipediaTool;
    readonly 'nodes-langchain.toolSearXng': typeof validateSearXngTool;
    readonly 'nodes-langchain.toolWolframAlpha': typeof validateWolframAlphaTool;
};
export declare function isAIToolSubNode(nodeType: string): boolean;
export declare function validateAIToolSubNode(node: WorkflowNode, nodeType: string, reverseConnections: Map<string, ReverseConnection[]>, workflow: WorkflowJson): ValidationIssue[];
//# sourceMappingURL=ai-tool-validators.d.ts.map