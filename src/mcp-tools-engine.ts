/**
 * MCPEngine - A simplified interface for benchmarking MCP tool execution
 * This directly implements the MCP tool functionality without server dependencies
 */
import { NodeRepository } from './database/node-repository';
import { PropertyFilter } from './services/property-filter';
import { TaskTemplates } from './services/task-templates';
import { ConfigValidator } from './services/config-validator';
import { EnhancedConfigValidator } from './services/enhanced-config-validator';
import { WorkflowValidator, WorkflowValidationResult } from './services/workflow-validator';

export class MCPEngine {
  private workflowValidator: WorkflowValidator;

  constructor(private repository: NodeRepository) {
    this.workflowValidator = new WorkflowValidator(repository, EnhancedConfigValidator);
  }

  async listNodes(args: any = {}) {
    return this.repository.getAllNodes(args.limit);
  }

  async searchNodes(args: any) {
    return this.repository.searchNodes(args.query, args.mode || 'OR', args.limit || 20);
  }

  async getNodeInfo(args: any) {
    return this.repository.getNodeByType(args.nodeType);
  }

  async getNodeEssentials(args: any) {
    const node = await this.repository.getNodeByType(args.nodeType);
    if (!node) return null;
    
    // Filter to essentials using static method
    const essentials = PropertyFilter.getEssentials(node.properties || [], args.nodeType);
    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      description: node.description,
      category: node.category,
      required: essentials.required,
      common: essentials.common
    };
  }

  async getNodeDocumentation(args: any) {
    const node = await this.repository.getNodeByType(args.nodeType);
    return node?.documentation || null;
  }

  async validateNodeOperation(args: any) {
    // Get node properties and validate
    const node = await this.repository.getNodeByType(args.nodeType);
    if (!node) {
      return {
        valid: false,
        errors: [{ type: 'invalid_configuration', property: '', message: 'Node type not found' }],
        warnings: [],
        suggestions: [],
        visibleProperties: [],
        hiddenProperties: []
      };
    }

    // Routed through the enhanced validator so the embedding API sees the same
    // node-specific checks as validate_node and workflow validation - it also
    // derives the user-provided keys itself, which keeps default values from
    // raising false warnings. The result is a superset of ValidationResult.
    return EnhancedConfigValidator.validateWithMode(
      args.nodeType,
      args.config || {},
      node.properties || [],
      args.mode ?? 'operation',
      args.profile ?? 'ai-friendly'
    );
  }

  async validateNodeMinimal(args: any) {
    // Get node and check minimal requirements
    const node = await this.repository.getNodeByType(args.nodeType);
    if (!node) {
      return { missingFields: [], error: 'Node type not found' };
    }
    
    const missingFields: string[] = [];
    const requiredFields = PropertyFilter.getEssentials(node.properties || [], args.nodeType).required;
    
    for (const field of requiredFields) {
      if (!args.config[field.name]) {
        missingFields.push(field.name);
      }
    }
    
    return { missingFields };
  }

  async searchNodeProperties(args: any) {
    return this.repository.searchNodeProperties(args.nodeType, args.query, args.maxResults || 20);
  }

  async listAITools(args: any) {
    return this.repository.getAIToolNodes();
  }

  async getDatabaseStatistics(args: any) {
    const count = await this.repository.getNodeCount();
    const aiTools = await this.repository.getAIToolNodes();
    return {
      totalNodes: count,
      aiToolsCount: aiTools.length,
      categories: ['trigger', 'transform', 'output', 'input']
    };
  }

  async validateWorkflow(args: any): Promise<WorkflowValidationResult> {
    return this.workflowValidator.validateWorkflow(args.workflow, args.options);
  }
}