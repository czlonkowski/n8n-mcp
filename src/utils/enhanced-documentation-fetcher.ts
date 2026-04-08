import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';
import { spawnSync } from 'child_process';

// Enhanced documentation structure with rich content
export interface EnhancedNodeDocumentation {
  markdown: string;
  url: string;
  title?: string;
  description?: string;
  operations?: OperationInfo[];
  apiMethods?: ApiMethodMapping[];
  examples?: CodeExample[];
  templates?: TemplateInfo[];
  relatedResources?: RelatedResource[];
  requiredScopes?: string[];
  metadata?: DocumentationMetadata;
}

export interface OperationInfo {
  resource: string;
  operation: string;
  description: string;
  subOperations?: string[];
}

export interface ApiMethodMapping {
  resource: string;
  operation: string;
  apiMethod: string;
  apiUrl: string;
}

export interface CodeExample {
  title?: string;
  description?: string;
  type: 'json' | 'javascript' | 'yaml' | 'text';
  code: string;
  language?: string;
}

export interface TemplateInfo {
  name: string;
  description?: string;
  url?: string;
}

export interface RelatedResource {
  title: string;
  url: string;
  type: 'documentation' | 'api' | 'tutorial' | 'external';
}

export interface DocumentationMetadata {
  contentType?: string[];
  priority?: string;
  tags?: string[];
  lastUpdated?: Date;
}

export class EnhancedDocumentationFetcher {
  private docsPath: string;
  private readonly docsRepoUrl = 'https://github.com/n8n-io/n8n-docs.git';
  private cloned = false;

  constructor(docsPath?: string) {
    // SECURITY: Validate and sanitize docsPath to prevent command injection
    // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-01 Part 2)
    const defaultPath = path.join(__dirname, '../../temp', 'n8n-docs');

    if (!docsPath) {
      this.docsPath = defaultPath;
    } else {
      // SECURITY: Block directory traversal and malicious paths
      const sanitized = this.sanitizePath(docsPath);

      if (!sanitized) {
        logger.error('Invalid docsPath rejected in constructor', { docsPath });
        throw new Error('Invalid docsPath: path contains disallowed characters or patterns');
      }

      // SECURITY: Verify path is absolute and within allowed boundaries
      const absolutePath = path.resolve(sanitized);

      // Block paths that could escape to sensitive directories
      if (absolutePath.startsWith('/etc') ||
          absolutePath.startsWith('/sys') ||
          absolutePath.startsWith('/proc') ||
          absolutePath.startsWith('/var/log')) {
        logger.error('docsPath points to system directory - blocked', { docsPath, absolutePath });
        throw new Error('Invalid docsPath: cannot use system directories');
      }

      this.docsPath = absolutePath;
      logger.info('docsPath validated and set', { docsPath: this.docsPath });
    }

    // SECURITY: Validate repository URL is HTTPS
    if (!this.docsRepoUrl.startsWith('https://')) {
      logger.error('docsRepoUrl must use HTTPS protocol', { url: this.docsRepoUrl });
      throw new Error('Invalid repository URL: must use HTTPS protocol');
    }
  }

  /**
   * Sanitize path input to prevent command injection and directory traversal
   * SECURITY: Part of fix for command injection vulnerability
   */
  private sanitizePath(inputPath: string): string | null {
    // SECURITY: Reject paths containing any shell metacharacters or control characters
    // This prevents command injection even before attempting to sanitize
    const dangerousChars = /[;&|`$(){}[\]<>'"\\#\n\r\t]/;
    if (dangerousChars.test(inputPath)) {
      logger.warn('Path contains shell metacharacters - rejected', { path: inputPath });
      return null;
    }

    // Block directory traversal attempts
    if (inputPath.includes('..') || inputPath.startsWith('.')) {
      logger.warn('Path traversal attempt blocked', { path: inputPath });
      return null;
    }

    return inputPath;
  }

  /**
   * Clone or update the n8n-docs repository
   * SECURITY: Uses spawnSync with argument arrays to prevent command injection
   * See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-01 Part 2)
   */
  async ensureDocsRepository(): Promise<void> {
    try {
      const exists = await fs.access(this.docsPath).then(() => true).catch(() => false);

      if (!exists) {
        logger.info('Cloning n8n-docs repository...', {
          url: this.docsRepoUrl,
          path: this.docsPath
        });
        await fs.mkdir(path.dirname(this.docsPath), { recursive: true });

        // SECURITY: Use spawnSync with argument array instead of string interpolation
        // This prevents command injection even if docsPath or docsRepoUrl are compromised
        const cloneResult = spawnSync('git', [
          'clone',
          '--depth', '1',
          this.docsRepoUrl,
          this.docsPath
        ], {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        if (cloneResult.status !== 0) {
          const error = cloneResult.stderr || cloneResult.error?.message || 'Unknown error';
          logger.error('Git clone failed', {
            status: cloneResult.status,
            stderr: error,
            url: this.docsRepoUrl,
            path: this.docsPath
          });
          throw new Error(`Git clone failed: ${error}`);
        }

        logger.info('n8n-docs repository cloned successfully');
      } else {
        logger.info('Updating n8n-docs repository...', { path: this.docsPath });

        // SECURITY: Use spawnSync with argument array and cwd option
        const pullResult = spawnSync('git', [
          'pull',
          '--ff-only'
        ], {
          cwd: this.docsPath,
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        if (pullResult.status !== 0) {
          const error = pullResult.stderr || pullResult.error?.message || 'Unknown error';
          logger.error('Git pull failed', {
            status: pullResult.status,
            stderr: error,
            cwd: this.docsPath
          });
          throw new Error(`Git pull failed: ${error}`);
        }

        logger.info('n8n-docs repository updated');
      }

      this.cloned = true;
    } catch (error) {
      logger.error('Failed to clone/update n8n-docs repository:', error);
      throw error;
    }
  }

  /**
   * Get enhanced documentation for a specific node
   */
  async getEnhancedNodeDocumentation(nodeType: string): Promise<EnhancedNodeDocumentation | null> {
    if (!this.cloned) {
      await this.ensureDocsRepository();
    }

    try {
      const nodeName = this.extractNodeName(nodeType);
      
      // Common documentation paths to check
      const possiblePaths = [
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'app-nodes', `${nodeType}.md`),
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'core-nodes', `${nodeType}.md`),
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'trigger-nodes', `${nodeType}.md`),
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'core-nodes', `${nodeName}.md`),
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'app-nodes', `${nodeName}.md`),
        path.join(this.docsPath, 'docs', 'integrations', 'builtin', 'trigger-nodes', `${nodeName}.md`),
      ];

      for (const docPath of possiblePaths) {
        try {
          const content = await fs.readFile(docPath, 'utf-8');
          logger.debug(`Checking doc path: ${docPath}`);
          
          // Skip credential documentation files
          if (this.isCredentialDoc(docPath, content)) {
            logger.debug(`Skipping credential doc: ${docPath}`);
            continue;
          }
          
          logger.info(`Found documentation for ${nodeType} at: ${docPath}`);
          return this.parseEnhancedDocumentation(content, docPath);
        } catch (error) {
          // File doesn't exist, continue
          continue;
        }
      }

      // If no exact match, try to find by searching
      logger.debug(`No exact match found, searching for ${nodeType}...`);
      const foundPath = await this.searchForNodeDoc(nodeType);
      if (foundPath) {
        logger.info(`Found documentation via search at: ${foundPath}`);
        const content = await fs.readFile(foundPath, 'utf-8');
        
        if (!this.isCredentialDoc(foundPath, content)) {
          return this.parseEnhancedDocumentation(content, foundPath);
        }
      }

      logger.warn(`No documentation found for node: ${nodeType}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get documentation for ${nodeType}:`, error);
      return null;
    }
  }

  /**
   * Parse markdown content into enhanced documentation structure
   */
  private parseEnhancedDocumentation(markdown: string, filePath: string): EnhancedNodeDocumentation {
    const doc: EnhancedNodeDocumentation = {
      markdown,
      url: this.generateDocUrl(filePath),
    };

    // Extract frontmatter metadata
    const metadata = this.extractFrontmatter(markdown);
    if (metadata) {
      doc.metadata = metadata;
      doc.title = metadata.title;
      doc.description = metadata.description;
    }

    // Extract title and description from content if not in frontmatter
    if (!doc.title) {
      doc.title = this.extractTitle(markdown);
    }
    if (!doc.description) {
      doc.description = this.extractDescription(markdown);
    }

    // Extract operations
    doc.operations = this.extractOperations(markdown);

    // Extract API method mappings
    doc.apiMethods = this.extractApiMethods(markdown);

    // Extract code examples
    doc.examples = this.extractCodeExamples(markdown);

    // Extract templates
    doc.templates = this.extractTemplates(markdown);

    // Extract related resources
    doc.relatedResources = this.extractRelatedResources(markdown);

    // Extract required scopes
    doc.requiredScopes = this.extractRequiredScopes(markdown);

    return doc;
  }

  /**
   * Extract frontmatter metadata
   */
  private extractFrontmatter(markdown: string): any {
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter: any = {};
    const lines = frontmatterMatch[1].split('\n');
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        
        // Parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key.trim()] = value
            .slice(1, -1)
            .split(',')
            .map(v => v.trim());
        } else {
          frontmatter[key.trim()] = value;
        }
      }
    }

    return frontmatter;
  }

  /**
   * Extract title from markdown
   */
  private extractTitle(markdown: string): string | undefined {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Extract description from markdown
   */
  private extractDescription(markdown: string): string | undefined {
    // Remove frontmatter
    const content = markdown.replace(/^---[\s\S]*?---\n/, '');
    
    // Find first paragraph after title
    const lines = content.split('\n');
    let foundTitle = false;
    let description = '';
    
    for (const line of lines) {
      if (line.startsWith('#')) {
        foundTitle = true;
        continue;
      }
      
      if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('*') && !line.startsWith('-')) {
        description = line.trim();
        break;
      }
    }
    
    return description || undefined;
  }

  /**
   * Extract operations from markdown
   */
  private extractOperations(markdown: string): OperationInfo[] {
    const operations: OperationInfo[] = [];
    
    // Find operations section
    const operationsMatch = markdown.match(/##\s+Operations\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
    if (!operationsMatch) return operations;
    
    const operationsText = operationsMatch[1];
    
    // Parse operation structure - handle nested bullet points
    let currentResource: string | null = null;
    const lines = operationsText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) continue;
      
      // Resource level - non-indented bullet with bold text (e.g., "* **Channel**")
      if (line.match(/^\*\s+\*\*[^*]+\*\*\s*$/) && !line.match(/^\s+/)) {
        const match = trimmedLine.match(/^\*\s+\*\*([^*]+)\*\*/);
        if (match) {
          currentResource = match[1].trim();
        }
        continue;
      }
      
      // Skip if we don't have a current resource
      if (!currentResource) continue;
      
      // Operation level - indented bullets (any whitespace + *)
      if (line.match(/^\s+\*\s+/) && currentResource) {
        // Extract operation name and description
        const operationMatch = trimmedLine.match(/^\*\s+\*\*([^*]+)\*\*(.*)$/);
        if (operationMatch) {
          const operation = operationMatch[1].trim();
          let description = operationMatch[2].trim();
          
          // Clean up description
          description = description.replace(/^:\s*/, '').replace(/\.$/, '').trim();
          
          operations.push({
            resource: currentResource,
            operation,
            description: description || operation,
          });
        } else {
          // Handle operations without bold formatting or with different format
          const simpleMatch = trimmedLine.match(/^\*\s+(.+)$/);
          if (simpleMatch) {
            const text = simpleMatch[1].trim();
            // Split by colon to separate operation from description
            const colonIndex = text.indexOf(':');
            if (colonIndex > 0) {
              operations.push({
                resource: currentResource,
                operation: text.substring(0, colonIndex).trim(),
                description: text.substring(colonIndex + 1).trim() || text,
              });
            } else {
              operations.push({
                resource: currentResource,
                operation: text,
                description: text,
              });
            }
          }
        }
      }
    }
    
    return operations;
  }

  /**
   * Extract API method mappings from markdown tables
   */
  private extractApiMethods(markdown: string): ApiMethodMapping[] {
    const apiMethods: ApiMethodMapping[] = [];
    
    // Find API method tables
    const tableRegex = /\|.*Resource.*\|.*Operation.*\|.*(?:Slack API method|API method|Method).*\|[\s\S]*?\n(?=\n[^|]|$)/gi;
    const tables = markdown.match(tableRegex);
    
    if (!tables) return apiMethods;
    
    for (const table of tables) {
      const rows = table.split('\n').filter(row => row.trim() && !row.includes('---'));
      
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].split('|').map(cell => cell.trim()).filter(Boolean);
        
        if (cells.length >= 3) {
          const resource = cells[0];
          const operation = cells[1];
          const apiMethodCell = cells[2];
          
          // Extract API method and URL from markdown link
          const linkMatch = apiMethodCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
          
          if (linkMatch) {
            apiMethods.push({
              resource,
              operation,
              apiMethod: linkMatch[1],
              apiUrl: linkMatch[2],
            });
          } else {
            apiMethods.push({
              resource,
              operation,
              apiMethod: apiMethodCell,
              apiUrl: '',
            });
          }
        }
      }
    }
    
    return apiMethods;
  }

  /**
   * Extract code examples from markdown
   */
  private extractCodeExamples(markdown: string): CodeExample[] {
    const examples: CodeExample[] = [];
    
    // Extract all code blocks with language
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
      const language = match[1] || 'text';
      const code = match[2].trim();
      
      // Look for title or description before the code block
      const beforeCodeIndex = match.index;
      const beforeText = markdown.substring(Math.max(0, beforeCodeIndex - 200), beforeCodeIndex);
      const titleMatch = beforeText.match(/(?:###|####)\s+(.+)$/m);
      
      const example: CodeExample = {
        type: this.mapLanguageToType(language),
        language,
        code,
      };
      
      if (titleMatch) {
        example.title = titleMatch[1].trim();
      }
      
      // Try to parse JSON examples
      if (language === 'json') {
        try {
          JSON.parse(code);
          examples.push(example);
        } catch (e) {
          // Skip invalid JSON
        }
      } else {
        examples.push(example);
      }
    }
    
    return examples;
  }

  /**
   * Extract template information
   */
  private extractTemplates(markdown: string): TemplateInfo[] {
    const templates: TemplateInfo[] = [];
    
    // Look for template widget
    const templateWidgetMatch = markdown.match(/\[\[\s*templatesWidget\s*\(\s*[^,]+,\s*'([^']+)'\s*\)\s*\]\]/);
    if (templateWidgetMatch) {
      templates.push({
        name: templateWidgetMatch[1],
        description: `Templates for ${templateWidgetMatch[1]}`,
      });
    }
    
    return templates;
  }

  /**
   * Extract related resources
   */
  private extractRelatedResources(markdown: string): RelatedResource[] {
    const resources: RelatedResource[] = [];
    
    // Find related resources section
    const relatedMatch = markdown.match(/##\s+(?:Related resources|Related|Resources)\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
    if (!relatedMatch) return resources;
    
    const relatedText = relatedMatch[1];
    
    // Extract links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = linkRegex.exec(relatedText)) !== null) {
      const title = match[1];
      const url = match[2];

      // Determine resource type. Parse the hostname where possible so
      // `http://evil/docs.n8n.io` doesn't get misclassified as official
      // docs. Addresses CodeQL js/incomplete-url-substring-sanitization.
      let type: RelatedResource['type'] = 'external';
      if (url.startsWith('/')) {
        type = 'documentation';
      } else {
        let host = '';
        try {
          host = new URL(url).hostname.toLowerCase();
        } catch {
          // Relative or malformed URL — leave type as 'external'.
        }
        if (host === 'docs.n8n.io' || host.endsWith('.docs.n8n.io')) {
          type = 'documentation';
        } else if (host.startsWith('api.')) {
          type = 'api';
        }
      }

      resources.push({ title, url, type });
    }
    
    return resources;
  }

  /**
   * Extract required scopes
   */
  private extractRequiredScopes(markdown: string): string[] {
    const scopes: string[] = [];
    
    // Find required scopes section
    const scopesMatch = markdown.match(/##\s+(?:Required scopes|Scopes)\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
    if (!scopesMatch) return scopes;
    
    const scopesText = scopesMatch[1];
    
    // Extract scope patterns (common formats)
    const scopeRegex = /`([a-z:._-]+)`/gi;
    let match;
    
    while ((match = scopeRegex.exec(scopesText)) !== null) {
      const scope = match[1];
      if (scope.includes(':') || scope.includes('.')) {
        scopes.push(scope);
      }
    }
    
    return [...new Set(scopes)]; // Remove duplicates
  }

  /**
   * Map language to code example type
   */
  private mapLanguageToType(language: string): CodeExample['type'] {
    switch (language.toLowerCase()) {
      case 'json':
        return 'json';
      case 'js':
      case 'javascript':
      case 'typescript':
      case 'ts':
        return 'javascript';
      case 'yaml':
      case 'yml':
        return 'yaml';
      default:
        return 'text';
    }
  }

  /**
   * Check if this is a credential documentation
   */
  private isCredentialDoc(filePath: string, content: string): boolean {
    return filePath.includes('/credentials/') || 
           (content.includes('title: ') && 
            content.includes(' credentials') && 
            !content.includes(' node documentation'));
  }

  /**
   * Extract node name from node type
   */
  private extractNodeName(nodeType: string): string {
    const parts = nodeType.split('.');
    const name = parts[parts.length - 1];
    return name.toLowerCase();
  }

  /**
   * Search for node documentation file
   * SECURITY: Uses Node.js fs APIs instead of shell commands to prevent command injection
   * See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-01)
   */
  private async searchForNodeDoc(nodeType: string): Promise<string | null> {
    try {
      // SECURITY: Sanitize input to prevent command injection and directory traversal
      const sanitized = nodeType.replace(/[^a-zA-Z0-9._-]/g, '');

      if (!sanitized) {
        logger.warn('Invalid nodeType after sanitization', { nodeType });
        return null;
      }

      // SECURITY: Block directory traversal attacks
      if (sanitized.includes('..') || sanitized.startsWith('.') || sanitized.startsWith('/')) {
        logger.warn('Path traversal attempt blocked', { nodeType, sanitized });
        return null;
      }

      // Log sanitization if it occurred
      if (sanitized !== nodeType) {
        logger.warn('nodeType was sanitized (potential injection attempt)', {
          original: nodeType,
          sanitized,
        });
      }

      // SECURITY: Use path.basename to strip any path components
      const safeName = path.basename(sanitized);
      const searchPath = path.join(this.docsPath, 'docs', 'integrations', 'builtin');

      // SECURITY: Read directory recursively using Node.js fs API (no shell execution!)
      const files = await fs.readdir(searchPath, {
        recursive: true,
        encoding: 'utf-8'
      }) as string[];

      // Try exact match first
      let match = files.find(f =>
        f.endsWith(`${safeName}.md`) &&
        !f.includes('credentials') &&
        !f.includes('trigger')
      );

      if (match) {
        const fullPath = path.join(searchPath, match);

        // SECURITY: Verify final path is within expected directory
        if (!fullPath.startsWith(searchPath)) {
          logger.error('Path traversal blocked in final path', { fullPath, searchPath });
          return null;
        }

        logger.info('Found documentation (exact match)', { path: fullPath });
        return fullPath;
      }

      // Try lowercase match
      const lowerSafeName = safeName.toLowerCase();
      match = files.find(f =>
        f.endsWith(`${lowerSafeName}.md`) &&
        !f.includes('credentials') &&
        !f.includes('trigger')
      );

      if (match) {
        const fullPath = path.join(searchPath, match);

        // SECURITY: Verify final path is within expected directory
        if (!fullPath.startsWith(searchPath)) {
          logger.error('Path traversal blocked in final path', { fullPath, searchPath });
          return null;
        }

        logger.info('Found documentation (lowercase match)', { path: fullPath });
        return fullPath;
      }

      // Try partial match with node name
      const nodeName = this.extractNodeName(safeName);
      match = files.find(f =>
        f.toLowerCase().includes(nodeName.toLowerCase()) &&
        f.endsWith('.md') &&
        !f.includes('credentials') &&
        !f.includes('trigger')
      );

      if (match) {
        const fullPath = path.join(searchPath, match);

        // SECURITY: Verify final path is within expected directory
        if (!fullPath.startsWith(searchPath)) {
          logger.error('Path traversal blocked in final path', { fullPath, searchPath });
          return null;
        }

        logger.info('Found documentation (partial match)', { path: fullPath });
        return fullPath;
      }

      logger.debug('No documentation found', { nodeType: safeName });
      return null;
    } catch (error) {
      logger.error('Error searching for node documentation:', {
        error: error instanceof Error ? error.message : String(error),
        nodeType,
      });
      return null;
    }
  }

  /**
   * Generate documentation URL from file path
   */
  private generateDocUrl(filePath: string): string {
    const relativePath = path.relative(this.docsPath, filePath);
    const urlPath = relativePath
      .replace(/^docs\//, '')
      .replace(/\.md$/, '')
      .replace(/\\/g, '/');
    
    return `https://docs.n8n.io/${urlPath}`;
  }

  /**
   * Clean up cloned repository
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.docsPath, { recursive: true, force: true });
      this.cloned = false;
      logger.info('Cleaned up documentation repository');
    } catch (error) {
      logger.error('Failed to cleanup docs repository:', error);
    }
  }
}