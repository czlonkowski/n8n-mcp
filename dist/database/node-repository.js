"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeRepository = void 0;
const sqlite_storage_service_1 = require("../services/sqlite-storage-service");
const node_type_normalizer_1 = require("../utils/node-type-normalizer");
class NodeRepository {
    constructor(dbOrService) {
        if (dbOrService instanceof sqlite_storage_service_1.SQLiteStorageService) {
            this.db = dbOrService.db;
            return;
        }
        this.db = dbOrService;
    }
    saveNode(node) {
        const stmt = this.db.prepare(`
      INSERT INTO nodes (
        node_type, package_name, display_name, description,
        category, development_style, is_ai_tool, is_trigger,
        is_webhook, is_versioned, is_tool_variant, tool_variant_of,
        has_tool_variant, version, documentation,
        properties_schema, operations, credentials_required,
        outputs, output_names,
        is_community, is_verified, author_name, author_github_url,
        npm_package_name, npm_version, npm_downloads, community_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_type) DO UPDATE SET
        package_name = excluded.package_name,
        display_name = excluded.display_name,
        description = excluded.description,
        category = excluded.category,
        development_style = excluded.development_style,
        is_ai_tool = excluded.is_ai_tool,
        is_trigger = excluded.is_trigger,
        is_webhook = excluded.is_webhook,
        is_versioned = excluded.is_versioned,
        is_tool_variant = excluded.is_tool_variant,
        tool_variant_of = excluded.tool_variant_of,
        has_tool_variant = excluded.has_tool_variant,
        version = excluded.version,
        documentation = excluded.documentation,
        properties_schema = excluded.properties_schema,
        operations = excluded.operations,
        credentials_required = excluded.credentials_required,
        outputs = excluded.outputs,
        output_names = excluded.output_names,
        is_community = excluded.is_community,
        is_verified = excluded.is_verified,
        author_name = excluded.author_name,
        author_github_url = excluded.author_github_url,
        npm_package_name = excluded.npm_package_name,
        npm_version = excluded.npm_version,
        npm_downloads = excluded.npm_downloads,
        community_fetched_at = excluded.community_fetched_at,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(node.nodeType, node.packageName, node.displayName, node.description, node.category, node.style, node.isAITool ? 1 : 0, node.isTrigger ? 1 : 0, node.isWebhook ? 1 : 0, node.isVersioned ? 1 : 0, node.isToolVariant ? 1 : 0, node.toolVariantOf || null, node.hasToolVariant ? 1 : 0, node.version, node.documentation || null, JSON.stringify(node.properties, null, 2), JSON.stringify(node.operations, null, 2), JSON.stringify(node.credentials, null, 2), node.outputs ? JSON.stringify(node.outputs, null, 2) : null, node.outputNames ? JSON.stringify(node.outputNames, null, 2) : null, node.isCommunity ? 1 : 0, node.isVerified ? 1 : 0, node.authorName || null, node.authorGithubUrl || null, node.npmPackageName || null, node.npmVersion || null, node.npmDownloads || 0, node.communityFetchedAt || null);
    }
    getNode(nodeType) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const row = this.db.prepare(`
      SELECT * FROM nodes WHERE node_type = ?
    `).get(normalizedType);
        if (!row && normalizedType !== nodeType) {
            const originalRow = this.db.prepare(`
        SELECT * FROM nodes WHERE node_type = ?
      `).get(nodeType);
            if (originalRow) {
                return this.parseNodeRow(originalRow);
            }
        }
        if (!row) {
            const caseInsensitiveRow = this.db.prepare(`
        SELECT * FROM nodes WHERE LOWER(node_type) = LOWER(?)
      `).get(nodeType);
            if (caseInsensitiveRow) {
                return this.parseNodeRow(caseInsensitiveRow);
            }
        }
        if (!row)
            return null;
        return this.parseNodeRow(row);
    }
    getAITools() {
        const rows = this.db.prepare(`
      SELECT node_type, display_name, description, package_name
      FROM nodes 
      WHERE is_ai_tool = 1
      ORDER BY display_name
    `).all();
        return rows.map(row => ({
            nodeType: row.node_type,
            displayName: row.display_name,
            description: row.description,
            package: row.package_name
        }));
    }
    safeJsonParse(json, defaultValue) {
        try {
            return JSON.parse(json);
        }
        catch {
            return defaultValue;
        }
    }
    upsertNode(node) {
        this.saveNode(node);
    }
    getNodeByType(nodeType) {
        return this.getNode(nodeType);
    }
    getNodesByCategory(category) {
        const rows = this.db.prepare(`
      SELECT * FROM nodes WHERE category = ?
      ORDER BY display_name
    `).all(category);
        return rows.map(row => this.parseNodeRow(row));
    }
    searchNodes(query, mode = 'OR', limit = 20) {
        let sql = '';
        const params = [];
        if (mode === 'FUZZY') {
            sql = `
        SELECT * FROM nodes 
        WHERE node_type LIKE ? OR display_name LIKE ? OR description LIKE ?
        ORDER BY display_name
        LIMIT ?
      `;
            const fuzzyQuery = `%${query}%`;
            params.push(fuzzyQuery, fuzzyQuery, fuzzyQuery, limit);
        }
        else {
            const words = query.split(/\s+/).filter(w => w.length > 0);
            const conditions = words.map(() => '(node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)');
            const operator = mode === 'AND' ? ' AND ' : ' OR ';
            sql = `
        SELECT * FROM nodes 
        WHERE ${conditions.join(operator)}
        ORDER BY display_name
        LIMIT ?
      `;
            for (const word of words) {
                const searchTerm = `%${word}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }
            params.push(limit);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(row => this.parseNodeRow(row));
    }
    getAllNodes(limit) {
        let sql = 'SELECT * FROM nodes ORDER BY display_name';
        if (limit) {
            sql += ` LIMIT ${limit}`;
        }
        const rows = this.db.prepare(sql).all();
        return rows.map(row => this.parseNodeRow(row));
    }
    getNodeCount() {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get();
        return result.count;
    }
    getAIToolNodes() {
        return this.getAITools();
    }
    getToolVariant(baseNodeType) {
        if (!baseNodeType || typeof baseNodeType !== 'string' || !baseNodeType.includes('.')) {
            return null;
        }
        const toolNodeType = `${baseNodeType}Tool`;
        return this.getNode(toolNodeType);
    }
    getBaseNodeForToolVariant(toolNodeType) {
        const row = this.db.prepare(`
      SELECT tool_variant_of FROM nodes WHERE node_type = ?
    `).get(toolNodeType);
        if (!row?.tool_variant_of)
            return null;
        return this.getNode(row.tool_variant_of);
    }
    getToolVariants() {
        const rows = this.db.prepare(`
      SELECT node_type, display_name, description, package_name, tool_variant_of
      FROM nodes
      WHERE is_tool_variant = 1
      ORDER BY display_name
    `).all();
        return rows.map(row => ({
            nodeType: row.node_type,
            displayName: row.display_name,
            description: row.description,
            package: row.package_name,
            toolVariantOf: row.tool_variant_of
        }));
    }
    getToolVariantCount() {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE is_tool_variant = 1').get();
        return result.count;
    }
    getNodesByPackage(packageName) {
        const rows = this.db.prepare(`
      SELECT * FROM nodes WHERE package_name = ?
      ORDER BY display_name
    `).all(packageName);
        return rows.map(row => this.parseNodeRow(row));
    }
    searchNodeProperties(nodeType, query, maxResults = 20) {
        const node = this.getNode(nodeType);
        if (!node || !node.properties)
            return [];
        const results = [];
        const searchLower = query.toLowerCase();
        function searchProperties(properties, path = []) {
            for (const prop of properties) {
                if (results.length >= maxResults)
                    break;
                const currentPath = [...path, prop.name || prop.displayName];
                const pathString = currentPath.join('.');
                if (prop.name?.toLowerCase().includes(searchLower) ||
                    prop.displayName?.toLowerCase().includes(searchLower) ||
                    prop.description?.toLowerCase().includes(searchLower)) {
                    results.push({
                        path: pathString,
                        property: prop,
                        description: prop.description
                    });
                }
                if (prop.options) {
                    searchProperties(prop.options, currentPath);
                }
            }
        }
        searchProperties(node.properties);
        return results;
    }
    parseNodeRow(row) {
        return {
            nodeType: row.node_type,
            displayName: row.display_name,
            description: row.description,
            category: row.category,
            developmentStyle: row.development_style,
            package: row.package_name,
            isAITool: Number(row.is_ai_tool) === 1,
            isTrigger: Number(row.is_trigger) === 1,
            isWebhook: Number(row.is_webhook) === 1,
            isVersioned: Number(row.is_versioned) === 1,
            isToolVariant: Number(row.is_tool_variant) === 1,
            toolVariantOf: row.tool_variant_of || null,
            hasToolVariant: Number(row.has_tool_variant) === 1,
            version: row.version,
            properties: this.safeJsonParse(row.properties_schema, []),
            operations: this.safeJsonParse(row.operations, []),
            credentials: this.safeJsonParse(row.credentials_required, []),
            hasDocumentation: !!row.documentation,
            outputs: row.outputs ? this.safeJsonParse(row.outputs, null) : null,
            outputNames: row.output_names ? this.safeJsonParse(row.output_names, null) : null,
            isCommunity: Number(row.is_community) === 1,
            isVerified: Number(row.is_verified) === 1,
            authorName: row.author_name || null,
            authorGithubUrl: row.author_github_url || null,
            npmPackageName: row.npm_package_name || null,
            npmVersion: row.npm_version || null,
            npmDownloads: row.npm_downloads || 0,
            communityFetchedAt: row.community_fetched_at || null,
            npmReadme: row.npm_readme || null,
            aiDocumentationSummary: row.ai_documentation_summary
                ? this.safeJsonParse(row.ai_documentation_summary, null)
                : null,
            aiSummaryGeneratedAt: row.ai_summary_generated_at || null,
        };
    }
    getNodeOperations(nodeType, resource) {
        const node = this.getNode(nodeType);
        if (!node)
            return [];
        const operations = [];
        if (node.operations) {
            if (Array.isArray(node.operations)) {
                operations.push(...node.operations);
            }
            else if (typeof node.operations === 'object') {
                if (resource && node.operations[resource]) {
                    return node.operations[resource];
                }
                else {
                    Object.values(node.operations).forEach(ops => {
                        if (Array.isArray(ops)) {
                            operations.push(...ops);
                        }
                    });
                }
            }
        }
        if (node.properties && Array.isArray(node.properties)) {
            for (const prop of node.properties) {
                if (prop.name === 'operation' && prop.options) {
                    if (resource && prop.displayOptions?.show?.resource) {
                        const allowedResources = Array.isArray(prop.displayOptions.show.resource)
                            ? prop.displayOptions.show.resource
                            : [prop.displayOptions.show.resource];
                        if (!allowedResources.includes(resource)) {
                            continue;
                        }
                    }
                    operations.push(...prop.options);
                }
            }
        }
        return operations;
    }
    getNodeResources(nodeType) {
        const node = this.getNode(nodeType);
        if (!node || !node.properties)
            return [];
        const resources = [];
        for (const prop of node.properties) {
            if (prop.name === 'resource' && prop.options) {
                resources.push(...prop.options);
            }
        }
        return resources;
    }
    getOperationsForResource(nodeType, resource) {
        const node = this.getNode(nodeType);
        if (!node || !node.properties)
            return [];
        const operations = [];
        for (const prop of node.properties) {
            if (prop.name === 'operation' && prop.displayOptions?.show?.resource) {
                const allowedResources = Array.isArray(prop.displayOptions.show.resource)
                    ? prop.displayOptions.show.resource
                    : [prop.displayOptions.show.resource];
                if (allowedResources.includes(resource) && prop.options) {
                    operations.push(...prop.options);
                }
            }
        }
        return operations;
    }
    getAllOperations() {
        const allOperations = new Map();
        const nodes = this.getAllNodes();
        for (const node of nodes) {
            const operations = this.getNodeOperations(node.nodeType);
            if (operations.length > 0) {
                allOperations.set(node.nodeType, operations);
            }
        }
        return allOperations;
    }
    getAllResources() {
        const allResources = new Map();
        const nodes = this.getAllNodes();
        for (const node of nodes) {
            const resources = this.getNodeResources(node.nodeType);
            if (resources.length > 0) {
                allResources.set(node.nodeType, resources);
            }
        }
        return allResources;
    }
    getNodePropertyDefaults(nodeType) {
        try {
            const node = this.getNode(nodeType);
            if (!node || !node.properties)
                return {};
            const defaults = {};
            for (const prop of node.properties) {
                if (prop.name && prop.default !== undefined) {
                    defaults[prop.name] = prop.default;
                }
            }
            return defaults;
        }
        catch (error) {
            console.error(`Error getting property defaults for ${nodeType}:`, error);
            return {};
        }
    }
    getDefaultOperationForResource(nodeType, resource) {
        try {
            const node = this.getNode(nodeType);
            if (!node || !node.properties)
                return undefined;
            for (const prop of node.properties) {
                if (prop.name === 'operation') {
                    if (resource && prop.displayOptions?.show?.resource) {
                        const resourceDep = prop.displayOptions.show.resource;
                        if (!Array.isArray(resourceDep) && typeof resourceDep !== 'string') {
                            continue;
                        }
                        const allowedResources = Array.isArray(resourceDep)
                            ? resourceDep
                            : [resourceDep];
                        if (!allowedResources.includes(resource)) {
                            continue;
                        }
                    }
                    if (prop.default !== undefined) {
                        return prop.default;
                    }
                    if (prop.options && Array.isArray(prop.options) && prop.options.length > 0) {
                        const firstOption = prop.options[0];
                        return typeof firstOption === 'string' ? firstOption : firstOption.value;
                    }
                }
            }
        }
        catch (error) {
            console.error(`Error getting default operation for ${nodeType}:`, error);
            return undefined;
        }
        return undefined;
    }
    getCommunityNodes(options) {
        let sql = 'SELECT * FROM nodes WHERE is_community = 1';
        const params = [];
        if (options?.verified !== undefined) {
            sql += ' AND is_verified = ?';
            params.push(options.verified ? 1 : 0);
        }
        switch (options?.orderBy) {
            case 'downloads':
                sql += ' ORDER BY npm_downloads DESC';
                break;
            case 'updated':
                sql += ' ORDER BY community_fetched_at DESC';
                break;
            case 'name':
            default:
                sql += ' ORDER BY display_name';
        }
        if (options?.limit) {
            sql += ' LIMIT ?';
            params.push(options.limit);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(row => this.parseNodeRow(row));
    }
    getCommunityStats() {
        const totalResult = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1').get();
        const verifiedResult = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1 AND is_verified = 1').get();
        return {
            total: totalResult.count,
            verified: verifiedResult.count,
            unverified: totalResult.count - verifiedResult.count
        };
    }
    hasNodeByNpmPackage(npmPackageName) {
        const result = this.db.prepare('SELECT 1 FROM nodes WHERE npm_package_name = ? LIMIT 1').get(npmPackageName);
        return !!result;
    }
    getNodeByNpmPackage(npmPackageName) {
        const row = this.db.prepare('SELECT * FROM nodes WHERE npm_package_name = ?').get(npmPackageName);
        if (!row)
            return null;
        return this.parseNodeRow(row);
    }
    deleteCommunityNodes() {
        const result = this.db.prepare('DELETE FROM nodes WHERE is_community = 1').run();
        return result.changes;
    }
    updateNodeReadme(nodeType, readme) {
        const stmt = this.db.prepare(`
      UPDATE nodes SET npm_readme = ? WHERE node_type = ?
    `);
        stmt.run(readme, nodeType);
    }
    updateNodeAISummary(nodeType, summary) {
        const stmt = this.db.prepare(`
      UPDATE nodes
      SET ai_documentation_summary = ?, ai_summary_generated_at = datetime('now')
      WHERE node_type = ?
    `);
        stmt.run(JSON.stringify(summary), nodeType);
    }
    getCommunityNodesWithoutReadme() {
        const rows = this.db.prepare(`
      SELECT * FROM nodes
      WHERE is_community = 1 AND (npm_readme IS NULL OR npm_readme = '')
      ORDER BY npm_downloads DESC
    `).all();
        return rows.map(row => this.parseNodeRow(row));
    }
    getCommunityNodesWithoutAISummary() {
        const rows = this.db.prepare(`
      SELECT * FROM nodes
      WHERE is_community = 1
        AND npm_readme IS NOT NULL AND npm_readme != ''
        AND (ai_documentation_summary IS NULL OR ai_documentation_summary = '')
      ORDER BY npm_downloads DESC
    `).all();
        return rows.map(row => this.parseNodeRow(row));
    }
    getDocumentationStats() {
        const total = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE is_community = 1').get().count;
        const withReadme = this.db.prepare("SELECT COUNT(*) as count FROM nodes WHERE is_community = 1 AND npm_readme IS NOT NULL AND npm_readme != ''").get().count;
        const withAISummary = this.db.prepare("SELECT COUNT(*) as count FROM nodes WHERE is_community = 1 AND ai_documentation_summary IS NOT NULL AND ai_documentation_summary != ''").get().count;
        return {
            total,
            withReadme,
            withAISummary,
            needingReadme: total - withReadme,
            needingAISummary: withReadme - withAISummary
        };
    }
    saveNodeVersion(versionData) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO node_versions (
        node_type, version, package_name, display_name, description,
        category, is_current_max, properties_schema, operations,
        credentials_required, outputs, minimum_n8n_version,
        breaking_changes, deprecated_properties, added_properties,
        released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(versionData.nodeType, versionData.version, versionData.packageName, versionData.displayName, versionData.description || null, versionData.category || null, versionData.isCurrentMax ? 1 : 0, versionData.propertiesSchema ? JSON.stringify(versionData.propertiesSchema) : null, versionData.operations ? JSON.stringify(versionData.operations) : null, versionData.credentialsRequired ? JSON.stringify(versionData.credentialsRequired) : null, versionData.outputs ? JSON.stringify(versionData.outputs) : null, versionData.minimumN8nVersion || null, versionData.breakingChanges ? JSON.stringify(versionData.breakingChanges) : null, versionData.deprecatedProperties ? JSON.stringify(versionData.deprecatedProperties) : null, versionData.addedProperties ? JSON.stringify(versionData.addedProperties) : null, versionData.releasedAt || null);
    }
    getNodeVersions(nodeType) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const rows = this.db.prepare(`
      SELECT * FROM node_versions
      WHERE node_type = ?
      ORDER BY version DESC
    `).all(normalizedType);
        return rows.map(row => this.parseNodeVersionRow(row));
    }
    getLatestNodeVersion(nodeType) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const row = this.db.prepare(`
      SELECT * FROM node_versions
      WHERE node_type = ? AND is_current_max = 1
      LIMIT 1
    `).get(normalizedType);
        if (!row)
            return null;
        return this.parseNodeVersionRow(row);
    }
    getNodeVersion(nodeType, version) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const row = this.db.prepare(`
      SELECT * FROM node_versions
      WHERE node_type = ? AND version = ?
    `).get(normalizedType, version);
        if (!row)
            return null;
        return this.parseNodeVersionRow(row);
    }
    savePropertyChange(changeData) {
        const stmt = this.db.prepare(`
      INSERT INTO version_property_changes (
        node_type, from_version, to_version, property_name, change_type,
        is_breaking, old_value, new_value, migration_hint, auto_migratable,
        migration_strategy, severity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(changeData.nodeType, changeData.fromVersion, changeData.toVersion, changeData.propertyName, changeData.changeType, changeData.isBreaking ? 1 : 0, changeData.oldValue || null, changeData.newValue || null, changeData.migrationHint || null, changeData.autoMigratable ? 1 : 0, changeData.migrationStrategy ? JSON.stringify(changeData.migrationStrategy) : null, changeData.severity || 'MEDIUM');
    }
    getPropertyChanges(nodeType, fromVersion, toVersion) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const rows = this.db.prepare(`
      SELECT * FROM version_property_changes
      WHERE node_type = ? AND from_version = ? AND to_version = ?
      ORDER BY severity DESC, property_name
    `).all(normalizedType, fromVersion, toVersion);
        return rows.map(row => this.parsePropertyChangeRow(row));
    }
    getBreakingChanges(nodeType, fromVersion, toVersion) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let sql = `
      SELECT * FROM version_property_changes
      WHERE node_type = ? AND is_breaking = 1
    `;
        const params = [normalizedType];
        if (toVersion) {
            sql += ` AND from_version >= ? AND to_version <= ?`;
            params.push(fromVersion, toVersion);
        }
        else {
            sql += ` AND from_version >= ?`;
            params.push(fromVersion);
        }
        sql += ` ORDER BY from_version, to_version, severity DESC`;
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(row => this.parsePropertyChangeRow(row));
    }
    getAutoMigratableChanges(nodeType, fromVersion, toVersion) {
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        const rows = this.db.prepare(`
      SELECT * FROM version_property_changes
      WHERE node_type = ?
        AND from_version = ?
        AND to_version = ?
        AND auto_migratable = 1
      ORDER BY severity DESC
    `).all(normalizedType, fromVersion, toVersion);
        return rows.map(row => this.parsePropertyChangeRow(row));
    }
    hasVersionUpgradePath(nodeType, fromVersion, toVersion) {
        const versions = this.getNodeVersions(nodeType);
        if (versions.length === 0)
            return false;
        const fromExists = versions.some(v => v.version === fromVersion);
        const toExists = versions.some(v => v.version === toVersion);
        return fromExists && toExists;
    }
    getVersionedNodesCount() {
        const result = this.db.prepare(`
      SELECT COUNT(DISTINCT node_type) as count
      FROM node_versions
    `).get();
        return result.count;
    }
    parseNodeVersionRow(row) {
        return {
            id: row.id,
            nodeType: row.node_type,
            version: row.version,
            packageName: row.package_name,
            displayName: row.display_name,
            description: row.description,
            category: row.category,
            isCurrentMax: Number(row.is_current_max) === 1,
            propertiesSchema: row.properties_schema ? this.safeJsonParse(row.properties_schema, []) : null,
            operations: row.operations ? this.safeJsonParse(row.operations, []) : null,
            credentialsRequired: row.credentials_required ? this.safeJsonParse(row.credentials_required, []) : null,
            outputs: row.outputs ? this.safeJsonParse(row.outputs, null) : null,
            minimumN8nVersion: row.minimum_n8n_version,
            breakingChanges: row.breaking_changes ? this.safeJsonParse(row.breaking_changes, []) : [],
            deprecatedProperties: row.deprecated_properties ? this.safeJsonParse(row.deprecated_properties, []) : [],
            addedProperties: row.added_properties ? this.safeJsonParse(row.added_properties, []) : [],
            releasedAt: row.released_at,
            createdAt: row.created_at
        };
    }
    parsePropertyChangeRow(row) {
        return {
            id: row.id,
            nodeType: row.node_type,
            fromVersion: row.from_version,
            toVersion: row.to_version,
            propertyName: row.property_name,
            changeType: row.change_type,
            isBreaking: Number(row.is_breaking) === 1,
            oldValue: row.old_value,
            newValue: row.new_value,
            migrationHint: row.migration_hint,
            autoMigratable: Number(row.auto_migratable) === 1,
            migrationStrategy: row.migration_strategy ? this.safeJsonParse(row.migration_strategy, null) : null,
            severity: row.severity,
            createdAt: row.created_at
        };
    }
    createWorkflowVersion(data) {
        const stmt = this.db.prepare(`
      INSERT INTO workflow_versions (
        workflow_id, version_number, workflow_name, workflow_snapshot,
        trigger, operations, fix_types, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(data.workflowId, data.versionNumber, data.workflowName, JSON.stringify(data.workflowSnapshot), data.trigger, data.operations ? JSON.stringify(data.operations) : null, data.fixTypes ? JSON.stringify(data.fixTypes) : null, data.metadata ? JSON.stringify(data.metadata) : null);
        return result.lastInsertRowid;
    }
    getWorkflowVersions(workflowId, limit) {
        let sql = `
      SELECT * FROM workflow_versions
      WHERE workflow_id = ?
      ORDER BY version_number DESC
    `;
        if (limit) {
            sql += ` LIMIT ?`;
            const rows = this.db.prepare(sql).all(workflowId, limit);
            return rows.map(row => this.parseWorkflowVersionRow(row));
        }
        const rows = this.db.prepare(sql).all(workflowId);
        return rows.map(row => this.parseWorkflowVersionRow(row));
    }
    getWorkflowVersion(versionId) {
        const row = this.db.prepare(`
      SELECT * FROM workflow_versions WHERE id = ?
    `).get(versionId);
        if (!row)
            return null;
        return this.parseWorkflowVersionRow(row);
    }
    getLatestWorkflowVersion(workflowId) {
        const row = this.db.prepare(`
      SELECT * FROM workflow_versions
      WHERE workflow_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(workflowId);
        if (!row)
            return null;
        return this.parseWorkflowVersionRow(row);
    }
    deleteWorkflowVersion(versionId) {
        this.db.prepare(`
      DELETE FROM workflow_versions WHERE id = ?
    `).run(versionId);
    }
    deleteWorkflowVersionsByWorkflowId(workflowId) {
        const result = this.db.prepare(`
      DELETE FROM workflow_versions WHERE workflow_id = ?
    `).run(workflowId);
        return result.changes;
    }
    pruneWorkflowVersions(workflowId, keepCount) {
        const versions = this.db.prepare(`
      SELECT id FROM workflow_versions
      WHERE workflow_id = ?
      ORDER BY version_number DESC
    `).all(workflowId);
        if (versions.length <= keepCount) {
            return 0;
        }
        const idsToDelete = versions.slice(keepCount).map(v => v.id);
        if (idsToDelete.length === 0) {
            return 0;
        }
        const placeholders = idsToDelete.map(() => '?').join(',');
        const result = this.db.prepare(`
      DELETE FROM workflow_versions WHERE id IN (${placeholders})
    `).run(...idsToDelete);
        return result.changes;
    }
    truncateWorkflowVersions() {
        const result = this.db.prepare(`
      DELETE FROM workflow_versions
    `).run();
        return result.changes;
    }
    getWorkflowVersionCount(workflowId) {
        const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM workflow_versions WHERE workflow_id = ?
    `).get(workflowId);
        return result.count;
    }
    getVersionStorageStats() {
        const totalResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM workflow_versions
    `).get();
        const sizeResult = this.db.prepare(`
      SELECT SUM(LENGTH(workflow_snapshot)) as total_size FROM workflow_versions
    `).get();
        const byWorkflow = this.db.prepare(`
      SELECT
        workflow_id,
        workflow_name,
        COUNT(*) as version_count,
        SUM(LENGTH(workflow_snapshot)) as total_size,
        MAX(created_at) as last_backup
      FROM workflow_versions
      GROUP BY workflow_id
      ORDER BY version_count DESC
    `).all();
        return {
            totalVersions: totalResult.count,
            totalSize: sizeResult.total_size || 0,
            byWorkflow: byWorkflow.map(row => ({
                workflowId: row.workflow_id,
                workflowName: row.workflow_name,
                versionCount: row.version_count,
                totalSize: row.total_size,
                lastBackup: row.last_backup
            }))
        };
    }
    parseWorkflowVersionRow(row) {
        return {
            id: row.id,
            workflowId: row.workflow_id,
            versionNumber: row.version_number,
            workflowName: row.workflow_name,
            workflowSnapshot: this.safeJsonParse(row.workflow_snapshot, null),
            trigger: row.trigger,
            operations: row.operations ? this.safeJsonParse(row.operations, null) : null,
            fixTypes: row.fix_types ? this.safeJsonParse(row.fix_types, null) : null,
            metadata: row.metadata ? this.safeJsonParse(row.metadata, null) : null,
            createdAt: row.created_at
        };
    }
}
exports.NodeRepository = NodeRepository;
//# sourceMappingURL=node-repository.js.map