"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedDocumentationFetcher = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("./logger");
const child_process_1 = require("child_process");
class EnhancedDocumentationFetcher {
    constructor(docsPath) {
        this.docsRepoUrl = 'https://github.com/n8n-io/n8n-docs.git';
        this.cloned = false;
        const defaultPath = path_1.default.join(__dirname, '../../temp', 'n8n-docs');
        if (!docsPath) {
            this.docsPath = defaultPath;
        }
        else {
            const sanitized = this.sanitizePath(docsPath);
            if (!sanitized) {
                logger_1.logger.error('Invalid docsPath rejected in constructor', { docsPath });
                throw new Error('Invalid docsPath: path contains disallowed characters or patterns');
            }
            const absolutePath = path_1.default.resolve(sanitized);
            if (absolutePath.startsWith('/etc') ||
                absolutePath.startsWith('/sys') ||
                absolutePath.startsWith('/proc') ||
                absolutePath.startsWith('/var/log')) {
                logger_1.logger.error('docsPath points to system directory - blocked', { docsPath, absolutePath });
                throw new Error('Invalid docsPath: cannot use system directories');
            }
            this.docsPath = absolutePath;
            logger_1.logger.info('docsPath validated and set', { docsPath: this.docsPath });
        }
        if (!this.docsRepoUrl.startsWith('https://')) {
            logger_1.logger.error('docsRepoUrl must use HTTPS protocol', { url: this.docsRepoUrl });
            throw new Error('Invalid repository URL: must use HTTPS protocol');
        }
    }
    sanitizePath(inputPath) {
        const dangerousChars = /[;&|`$(){}[\]<>'"\\#\n\r\t]/;
        if (dangerousChars.test(inputPath)) {
            logger_1.logger.warn('Path contains shell metacharacters - rejected', { path: inputPath });
            return null;
        }
        if (inputPath.includes('..') || inputPath.startsWith('.')) {
            logger_1.logger.warn('Path traversal attempt blocked', { path: inputPath });
            return null;
        }
        return inputPath;
    }
    async ensureDocsRepository() {
        try {
            const exists = await fs_1.promises.access(this.docsPath).then(() => true).catch(() => false);
            if (!exists) {
                logger_1.logger.info('Cloning n8n-docs repository...', {
                    url: this.docsRepoUrl,
                    path: this.docsPath
                });
                await fs_1.promises.mkdir(path_1.default.dirname(this.docsPath), { recursive: true });
                const cloneResult = (0, child_process_1.spawnSync)('git', [
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
                    logger_1.logger.error('Git clone failed', {
                        status: cloneResult.status,
                        stderr: error,
                        url: this.docsRepoUrl,
                        path: this.docsPath
                    });
                    throw new Error(`Git clone failed: ${error}`);
                }
                logger_1.logger.info('n8n-docs repository cloned successfully');
            }
            else {
                logger_1.logger.info('Updating n8n-docs repository...', { path: this.docsPath });
                const pullResult = (0, child_process_1.spawnSync)('git', [
                    'pull',
                    '--ff-only'
                ], {
                    cwd: this.docsPath,
                    stdio: 'pipe',
                    encoding: 'utf-8'
                });
                if (pullResult.status !== 0) {
                    const error = pullResult.stderr || pullResult.error?.message || 'Unknown error';
                    logger_1.logger.error('Git pull failed', {
                        status: pullResult.status,
                        stderr: error,
                        cwd: this.docsPath
                    });
                    throw new Error(`Git pull failed: ${error}`);
                }
                logger_1.logger.info('n8n-docs repository updated');
            }
            this.cloned = true;
        }
        catch (error) {
            logger_1.logger.error('Failed to clone/update n8n-docs repository:', error);
            throw error;
        }
    }
    async getEnhancedNodeDocumentation(nodeType) {
        if (!this.cloned) {
            await this.ensureDocsRepository();
        }
        try {
            const nodeName = this.extractNodeName(nodeType);
            const possiblePaths = [
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'app-nodes', `${nodeType}.md`),
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'core-nodes', `${nodeType}.md`),
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'trigger-nodes', `${nodeType}.md`),
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'core-nodes', `${nodeName}.md`),
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'app-nodes', `${nodeName}.md`),
                path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin', 'trigger-nodes', `${nodeName}.md`),
            ];
            for (const docPath of possiblePaths) {
                try {
                    const content = await fs_1.promises.readFile(docPath, 'utf-8');
                    logger_1.logger.debug(`Checking doc path: ${docPath}`);
                    if (this.isCredentialDoc(docPath, content)) {
                        logger_1.logger.debug(`Skipping credential doc: ${docPath}`);
                        continue;
                    }
                    logger_1.logger.info(`Found documentation for ${nodeType} at: ${docPath}`);
                    return this.parseEnhancedDocumentation(content, docPath);
                }
                catch (error) {
                    continue;
                }
            }
            logger_1.logger.debug(`No exact match found, searching for ${nodeType}...`);
            const foundPath = await this.searchForNodeDoc(nodeType);
            if (foundPath) {
                logger_1.logger.info(`Found documentation via search at: ${foundPath}`);
                const content = await fs_1.promises.readFile(foundPath, 'utf-8');
                if (!this.isCredentialDoc(foundPath, content)) {
                    return this.parseEnhancedDocumentation(content, foundPath);
                }
            }
            logger_1.logger.warn(`No documentation found for node: ${nodeType}`);
            return null;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get documentation for ${nodeType}:`, error);
            return null;
        }
    }
    parseEnhancedDocumentation(markdown, filePath) {
        const doc = {
            markdown,
            url: this.generateDocUrl(filePath),
        };
        const metadata = this.extractFrontmatter(markdown);
        if (metadata) {
            doc.metadata = metadata;
            doc.title = metadata.title;
            doc.description = metadata.description;
        }
        if (!doc.title) {
            doc.title = this.extractTitle(markdown);
        }
        if (!doc.description) {
            doc.description = this.extractDescription(markdown);
        }
        doc.operations = this.extractOperations(markdown);
        doc.apiMethods = this.extractApiMethods(markdown);
        doc.examples = this.extractCodeExamples(markdown);
        doc.templates = this.extractTemplates(markdown);
        doc.relatedResources = this.extractRelatedResources(markdown);
        doc.requiredScopes = this.extractRequiredScopes(markdown);
        return doc;
    }
    extractFrontmatter(markdown) {
        const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch)
            return null;
        const frontmatter = {};
        const lines = frontmatterMatch[1].split('\n');
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, ...valueParts] = line.split(':');
                const value = valueParts.join(':').trim();
                if (value.startsWith('[') && value.endsWith(']')) {
                    frontmatter[key.trim()] = value
                        .slice(1, -1)
                        .split(',')
                        .map(v => v.trim());
                }
                else {
                    frontmatter[key.trim()] = value;
                }
            }
        }
        return frontmatter;
    }
    extractTitle(markdown) {
        const match = markdown.match(/^#\s+(.+)$/m);
        return match ? match[1].trim() : undefined;
    }
    extractDescription(markdown) {
        const content = markdown.replace(/^---[\s\S]*?---\n/, '');
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
    extractOperations(markdown) {
        const operations = [];
        const operationsMatch = markdown.match(/##\s+Operations\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
        if (!operationsMatch)
            return operations;
        const operationsText = operationsMatch[1];
        let currentResource = null;
        const lines = operationsText.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine)
                continue;
            if (line.match(/^\*\s+\*\*[^*]+\*\*\s*$/) && !line.match(/^\s+/)) {
                const match = trimmedLine.match(/^\*\s+\*\*([^*]+)\*\*/);
                if (match) {
                    currentResource = match[1].trim();
                }
                continue;
            }
            if (!currentResource)
                continue;
            if (line.match(/^\s+\*\s+/) && currentResource) {
                const operationMatch = trimmedLine.match(/^\*\s+\*\*([^*]+)\*\*(.*)$/);
                if (operationMatch) {
                    const operation = operationMatch[1].trim();
                    let description = operationMatch[2].trim();
                    description = description.replace(/^:\s*/, '').replace(/\.$/, '').trim();
                    operations.push({
                        resource: currentResource,
                        operation,
                        description: description || operation,
                    });
                }
                else {
                    const simpleMatch = trimmedLine.match(/^\*\s+(.+)$/);
                    if (simpleMatch) {
                        const text = simpleMatch[1].trim();
                        const colonIndex = text.indexOf(':');
                        if (colonIndex > 0) {
                            operations.push({
                                resource: currentResource,
                                operation: text.substring(0, colonIndex).trim(),
                                description: text.substring(colonIndex + 1).trim() || text,
                            });
                        }
                        else {
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
    extractApiMethods(markdown) {
        const apiMethods = [];
        const tableRegex = /\|.*Resource.*\|.*Operation.*\|.*(?:Slack API method|API method|Method).*\|[\s\S]*?\n(?=\n[^|]|$)/gi;
        const tables = markdown.match(tableRegex);
        if (!tables)
            return apiMethods;
        for (const table of tables) {
            const rows = table.split('\n').filter(row => row.trim() && !row.includes('---'));
            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].split('|').map(cell => cell.trim()).filter(Boolean);
                if (cells.length >= 3) {
                    const resource = cells[0];
                    const operation = cells[1];
                    const apiMethodCell = cells[2];
                    const linkMatch = apiMethodCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
                    if (linkMatch) {
                        apiMethods.push({
                            resource,
                            operation,
                            apiMethod: linkMatch[1],
                            apiUrl: linkMatch[2],
                        });
                    }
                    else {
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
    extractCodeExamples(markdown) {
        const examples = [];
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(markdown)) !== null) {
            const language = match[1] || 'text';
            const code = match[2].trim();
            const beforeCodeIndex = match.index;
            const beforeText = markdown.substring(Math.max(0, beforeCodeIndex - 200), beforeCodeIndex);
            const titleMatch = beforeText.match(/(?:###|####)\s+(.+)$/m);
            const example = {
                type: this.mapLanguageToType(language),
                language,
                code,
            };
            if (titleMatch) {
                example.title = titleMatch[1].trim();
            }
            if (language === 'json') {
                try {
                    JSON.parse(code);
                    examples.push(example);
                }
                catch (e) {
                }
            }
            else {
                examples.push(example);
            }
        }
        return examples;
    }
    extractTemplates(markdown) {
        const templates = [];
        const templateWidgetMatch = markdown.match(/\[\[\s*templatesWidget\s*\(\s*[^,]+,\s*'([^']+)'\s*\)\s*\]\]/);
        if (templateWidgetMatch) {
            templates.push({
                name: templateWidgetMatch[1],
                description: `Templates for ${templateWidgetMatch[1]}`,
            });
        }
        return templates;
    }
    extractRelatedResources(markdown) {
        const resources = [];
        const relatedMatch = markdown.match(/##\s+(?:Related resources|Related|Resources)\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
        if (!relatedMatch)
            return resources;
        const relatedText = relatedMatch[1];
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;
        while ((match = linkRegex.exec(relatedText)) !== null) {
            const title = match[1];
            const url = match[2];
            let type = 'external';
            if (url.startsWith('/')) {
                type = 'documentation';
            }
            else {
                let host = '';
                try {
                    host = new URL(url).hostname.toLowerCase();
                }
                catch {
                }
                if (host === 'docs.n8n.io' || host.endsWith('.docs.n8n.io')) {
                    type = 'documentation';
                }
                else if (host.startsWith('api.')) {
                    type = 'api';
                }
            }
            resources.push({ title, url, type });
        }
        return resources;
    }
    extractRequiredScopes(markdown) {
        const scopes = [];
        const scopesMatch = markdown.match(/##\s+(?:Required scopes|Scopes)\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
        if (!scopesMatch)
            return scopes;
        const scopesText = scopesMatch[1];
        const scopeRegex = /`([a-z:._-]+)`/gi;
        let match;
        while ((match = scopeRegex.exec(scopesText)) !== null) {
            const scope = match[1];
            if (scope.includes(':') || scope.includes('.')) {
                scopes.push(scope);
            }
        }
        return [...new Set(scopes)];
    }
    mapLanguageToType(language) {
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
    isCredentialDoc(filePath, content) {
        return filePath.includes('/credentials/') ||
            (content.includes('title: ') &&
                content.includes(' credentials') &&
                !content.includes(' node documentation'));
    }
    extractNodeName(nodeType) {
        const parts = nodeType.split('.');
        const name = parts[parts.length - 1];
        return name.toLowerCase();
    }
    async searchForNodeDoc(nodeType) {
        try {
            const sanitized = nodeType.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!sanitized) {
                logger_1.logger.warn('Invalid nodeType after sanitization', { nodeType });
                return null;
            }
            if (sanitized.includes('..') || sanitized.startsWith('.') || sanitized.startsWith('/')) {
                logger_1.logger.warn('Path traversal attempt blocked', { nodeType, sanitized });
                return null;
            }
            if (sanitized !== nodeType) {
                logger_1.logger.warn('nodeType was sanitized (potential injection attempt)', {
                    original: nodeType,
                    sanitized,
                });
            }
            const safeName = path_1.default.basename(sanitized);
            const searchPath = path_1.default.join(this.docsPath, 'docs', 'integrations', 'builtin');
            const files = await fs_1.promises.readdir(searchPath, {
                recursive: true,
                encoding: 'utf-8'
            });
            let match = files.find(f => f.endsWith(`${safeName}.md`) &&
                !f.includes('credentials') &&
                !f.includes('trigger'));
            if (match) {
                const fullPath = path_1.default.join(searchPath, match);
                if (!fullPath.startsWith(searchPath)) {
                    logger_1.logger.error('Path traversal blocked in final path', { fullPath, searchPath });
                    return null;
                }
                logger_1.logger.info('Found documentation (exact match)', { path: fullPath });
                return fullPath;
            }
            const lowerSafeName = safeName.toLowerCase();
            match = files.find(f => f.endsWith(`${lowerSafeName}.md`) &&
                !f.includes('credentials') &&
                !f.includes('trigger'));
            if (match) {
                const fullPath = path_1.default.join(searchPath, match);
                if (!fullPath.startsWith(searchPath)) {
                    logger_1.logger.error('Path traversal blocked in final path', { fullPath, searchPath });
                    return null;
                }
                logger_1.logger.info('Found documentation (lowercase match)', { path: fullPath });
                return fullPath;
            }
            const nodeName = this.extractNodeName(safeName);
            match = files.find(f => f.toLowerCase().includes(nodeName.toLowerCase()) &&
                f.endsWith('.md') &&
                !f.includes('credentials') &&
                !f.includes('trigger'));
            if (match) {
                const fullPath = path_1.default.join(searchPath, match);
                if (!fullPath.startsWith(searchPath)) {
                    logger_1.logger.error('Path traversal blocked in final path', { fullPath, searchPath });
                    return null;
                }
                logger_1.logger.info('Found documentation (partial match)', { path: fullPath });
                return fullPath;
            }
            logger_1.logger.debug('No documentation found', { nodeType: safeName });
            return null;
        }
        catch (error) {
            logger_1.logger.error('Error searching for node documentation:', {
                error: error instanceof Error ? error.message : String(error),
                nodeType,
            });
            return null;
        }
    }
    generateDocUrl(filePath) {
        const relativePath = path_1.default.relative(this.docsPath, filePath);
        const urlPath = relativePath
            .replace(/^docs\//, '')
            .replace(/\.md$/, '')
            .replace(/\\/g, '/');
        return `https://docs.n8n.io/${urlPath}`;
    }
    async cleanup() {
        try {
            await fs_1.promises.rm(this.docsPath, { recursive: true, force: true });
            this.cloned = false;
            logger_1.logger.info('Cleaned up documentation repository');
        }
        catch (error) {
            logger_1.logger.error('Failed to cleanup docs repository:', error);
        }
    }
}
exports.EnhancedDocumentationFetcher = EnhancedDocumentationFetcher;
//# sourceMappingURL=enhanced-documentation-fetcher.js.map