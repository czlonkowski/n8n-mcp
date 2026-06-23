import { DatabaseAdapter } from '../database/database-adapter';
import { TemplateRepository, StoredTemplate } from './template-repository';
import { logger } from '../utils/logger';

export interface TemplateInfo {
  id: number;
  name: string;
  description: string;
  author: {
    name: string;
    username: string;
    verified: boolean;
  };
  nodes: string[];
  views: number;
  created: string;
  url: string;
  metadata?: {
    categories: string[];
    complexity: 'simple' | 'medium' | 'complex';
    use_cases: string[];
    estimated_setup_minutes: number;
    required_services: string[];
    key_features: string[];
    target_audience: string[];
  };
}

export interface TemplateWithWorkflow extends TemplateInfo {
  workflow: any;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TemplateMinimal {
  id: number;
  name: string;
  description: string;
  views: number;
  nodeCount: number;
  metadata?: {
    categories: string[];
    complexity: 'simple' | 'medium' | 'complex';
    use_cases: string[];
    estimated_setup_minutes: number;
    required_services: string[];
    key_features: string[];
    target_audience: string[];
  };
}

export type TemplateField = 'id' | 'name' | 'description' | 'author' | 'nodes' | 'views' | 'created' | 'url' | 'metadata';
export type PartialTemplateInfo = Partial<TemplateInfo>;

export class TemplateService {
  private repository: TemplateRepository;
  
  constructor(db: DatabaseAdapter) {
    this.repository = new TemplateRepository(db);
  }
  
  /**
   * List templates that use specific node types
   */
  async listNodeTemplates(nodeTypes: string[], limit: number = 10, offset: number = 0): Promise<PaginatedResponse<TemplateInfo>> {
    const templates = this.repository.getTemplatesByNodes(nodeTypes, limit, offset);
    const total = this.repository.getNodeTemplatesCount(nodeTypes);
    
    return {
      items: templates.map(this.formatTemplateInfo),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Get a specific template with different detail levels
   */
  async getTemplate(templateId: number, mode: 'nodes_only' | 'structure' | 'full' = 'full'): Promise<any> {
    const template = this.repository.getTemplate(templateId);
    if (!template) {
      return null;
    }
    
    const workflow = JSON.parse(template.workflow_json || '{}');
    
    if (mode === 'nodes_only') {
      return {
        id: template.id,
        name: template.name,
        nodes: workflow.nodes?.map((n: any) => ({
          type: n.type,
          name: n.name
        })) || []
      };
    }
    
    if (mode === 'structure') {
      return {
        id: template.id,
        name: template.name,
        nodes: workflow.nodes?.map((n: any) => ({
          id: n.id,
          type: n.type,
          name: n.name,
          position: n.position
        })) || [],
        connections: workflow.connections || {}
      };
    }
    
    // Full mode
    return {
      ...this.formatTemplateInfo(template),
      workflow
    };
  }
  
  /**
   * Search templates by query
   */
  async searchTemplates(query: string, limit: number = 20, offset: number = 0, fields?: string[]): Promise<PaginatedResponse<PartialTemplateInfo>> {
    const templates = this.repository.searchTemplates(query, limit, offset);
    const total = this.repository.getSearchCount(query);
    
    // If fields are specified, filter the template info
    const items = fields 
      ? templates.map(t => this.formatTemplateWithFields(t, fields))
      : templates.map(t => this.formatTemplateInfo(t));
    
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Get templates for a specific task
   */
  async getTemplatesForTask(task: string, limit: number = 10, offset: number = 0): Promise<PaginatedResponse<TemplateInfo>> {
    const templates = this.repository.getTemplatesForTask(task, limit, offset);
    const total = this.repository.getTaskTemplatesCount(task);
    
    return {
      items: templates.map(this.formatTemplateInfo),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * List all templates with minimal data
   */
  async listTemplates(limit: number = 10, offset: number = 0, sortBy: 'views' | 'created_at' | 'name' = 'views', includeMetadata: boolean = false): Promise<PaginatedResponse<TemplateMinimal>> {
    const templates = this.repository.getAllTemplates(limit, offset, sortBy);
    const total = this.repository.getTemplateCount();
    
    const items = templates.map(t => {
      const item: TemplateMinimal = {
        id: t.id,
        name: t.name,
        description: t.description, // Always include description
        views: t.views,
        nodeCount: JSON.parse(t.nodes_used).length
      };
      
      // Optionally include metadata
      if (includeMetadata && t.metadata_json) {
        try {
          item.metadata = JSON.parse(t.metadata_json);
        } catch (error) {
          logger.warn(`Failed to parse metadata for template ${t.id}:`, error);
        }
      }
      
      return item;
    });
    
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * List available tasks
   */
  listAvailableTasks(): string[] {
    return [
      'ai_automation',
      'data_sync',
      'webhook_processing',
      'email_automation',
      'slack_integration',
      'data_transformation',
      'file_processing',
      'scheduling',
      'api_integration',
      'database_operations'
    ];
  }
  
  /**
   * Search templates by metadata filters
   */
  async searchTemplatesByMetadata(
    filters: {
      category?: string;
      complexity?: 'simple' | 'medium' | 'complex';
      maxSetupMinutes?: number;
      minSetupMinutes?: number;
      requiredService?: string;
      targetAudience?: string;
    },
    limit: number = 20,
    offset: number = 0
  ): Promise<PaginatedResponse<TemplateInfo>> {
    const templates = this.repository.searchTemplatesByMetadata(filters, limit, offset);
    const total = this.repository.getMetadataSearchCount(filters);
    
    return {
      items: templates.map(this.formatTemplateInfo.bind(this)),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Whether any templates in the corpus have metadata enrichment applied.
   */
  async hasMetadataCoverage(): Promise<boolean> {
    return this.repository.hasMetadataCoverage();
  }

  /**
   * Get available categories from template metadata
   */
  async getAvailableCategories(): Promise<string[]> {
    return this.repository.getAvailableCategories();
  }
  
  /**
   * Get available target audiences from template metadata
   */
  async getAvailableTargetAudiences(): Promise<string[]> {
    return this.repository.getAvailableTargetAudiences();
  }
  
  /**
   * Get templates by category
   */
  async getTemplatesByCategory(
    category: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<PaginatedResponse<TemplateInfo>> {
    const templates = this.repository.getTemplatesByCategory(category, limit, offset);
    const total = this.repository.getMetadataSearchCount({ category });
    
    return {
      items: templates.map(this.formatTemplateInfo.bind(this)),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Get templates by complexity level
   */
  async getTemplatesByComplexity(
    complexity: 'simple' | 'medium' | 'complex',
    limit: number = 10,
    offset: number = 0
  ): Promise<PaginatedResponse<TemplateInfo>> {
    const templates = this.repository.getTemplatesByComplexity(complexity, limit, offset);
    const total = this.repository.getMetadataSearchCount({ complexity });
    
    return {
      items: templates.map(this.formatTemplateInfo.bind(this)),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }
  
  /**
   * Get template statistics
   */
  async getTemplateStats(): Promise<Record<string, any>> {
    return this.repository.getTemplateStats();
  }
  
  /**
   * Fetch and update templates from n8n.io
   * @param mode - 'rebuild' to clear and rebuild, 'update' to add only new templates
   */
  async fetchAndUpdateTemplates(
    progressCallback?: (message: string, current: number, total: number) => void,
    mode: 'rebuild' | 'update' = 'rebuild'
  ): Promise<void> {
    try {
      // Dynamically import fetcher only when needed (requires axios)
      const { TemplateFetcher } = await import('./template-fetcher');
      const fetcher = new TemplateFetcher();
      
      // Get existing template IDs if in update mode
      let existingIds: Set<number> = new Set();
      let sinceDate: Date | undefined;

      if (mode === 'update') {
        existingIds = this.repository.getExistingTemplateIds();
        logger.info(`Update mode: Found ${existingIds.size} existing templates in database`);

        // Get most recent template date and fetch only templates from last 2 weeks
        const mostRecentDate = this.repository.getMostRecentTemplateDate();
        if (mostRecentDate) {
          // Fetch templates from 2 weeks before the most recent template
          sinceDate = new Date(mostRecentDate);
          sinceDate.setDate(sinceDate.getDate() - 14);
          logger.info(`Update mode: Fetching templates since ${sinceDate.toISOString().split('T')[0]} (2 weeks before most recent)`);
        } else {
          // No templates yet, fetch from last 2 weeks
          sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - 14);
          logger.info(`Update mode: No existing templates, fetching from last 2 weeks`);
        }
      } else {
        // Clear existing templates in rebuild mode
        this.repository.clearTemplates();
        logger.info('Rebuild mode: Cleared existing templates');
      }

      // Fetch template list
      logger.info(`Fetching template list from n8n.io (mode: ${mode})`);
      const templates = await fetcher.fetchTemplates((current, total) => {
        progressCallback?.('Fetching template list', current, total);
      }, sinceDate);
      
      logger.info(`Found ${templates.length} templates matching date criteria`);
      
      // Filter to only new templates if in update mode
      let templatesToFetch = templates;
      if (mode === 'update') {
        templatesToFetch = templates.filter(t => !existingIds.has(t.id));
        logger.info(`Update mode: ${templatesToFetch.length} new templates to fetch (skipping ${templates.length - templatesToFetch.length} existing)`);
        
        if (templatesToFetch.length === 0) {
          logger.info('No new templates to fetch');
          progressCallback?.('No new templates', 0, 0);
          return;
        }
      }
      
      // Fetch details for each template
      logger.info(`Fetching details for ${templatesToFetch.length} templates`);
      const details = await fetcher.fetchAllTemplateDetails(templatesToFetch, (current, total) => {
        progressCallback?.('Fetching template details', current, total);
      });
      
      // Save to database
      logger.info('Saving templates to database');
      let saved = 0;
      for (const template of templatesToFetch) {
        const detail = details.get(template.id);
        if (detail) {
          this.repository.saveTemplate(template, detail);
          saved++;
        }
      }
      
      logger.info(`Successfully saved ${saved} templates to database`);
      
      // Rebuild FTS5 index after bulk import
      if (saved > 0) {
        logger.info('Rebuilding FTS5 index for templates');
        this.repository.rebuildTemplateFTS();
      }
      
      progressCallback?.('Complete', saved, saved);
    } catch (error) {
      logger.error('Error fetching templates:', error);
      throw error;
    }
  }
  
  /**
   * Format stored template for API response
   */
  private formatTemplateInfo(template: StoredTemplate): TemplateInfo {
    const info: TemplateInfo = {
      id: template.id,
      name: template.name,
      description: template.description,
      author: {
        name: template.author_name,
        username: template.author_username,
        verified: template.author_verified === 1
      },
      nodes: JSON.parse(template.nodes_used),
      views: template.views,
      created: template.created_at,
      url: template.url
    };
    
    // Include metadata if available
    if (template.metadata_json) {
      try {
        info.metadata = JSON.parse(template.metadata_json);
      } catch (error) {
        logger.warn(`Failed to parse metadata for template ${template.id}:`, error);
      }
    }
    
    return info;
  }
  
  /**
   * Format template with only specified fields
   */
  private formatTemplateWithFields(template: StoredTemplate, fields: string[]): PartialTemplateInfo {
    const fullInfo = this.formatTemplateInfo(template);
    const result: PartialTemplateInfo = {};
    
    // Only include requested fields
    for (const field of fields) {
      if (field in fullInfo) {
        (result as any)[field] = (fullInfo as any)[field];
      }
    }
    
    return result;
  }
}