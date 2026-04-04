"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.N8nApiClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const n8n_errors_1 = require("../utils/n8n-errors");
const n8n_validation_1 = require("./n8n-validation");
const n8n_version_1 = require("./n8n-version");
class N8nApiClient {
    constructor(config) {
        this.versionInfo = null;
        this.versionPromise = null;
        const { baseUrl, apiKey, timeout = 30000, maxRetries = 3 } = config;
        this.maxRetries = maxRetries;
        this.baseUrl = baseUrl;
        const apiUrl = baseUrl.endsWith('/api/v1')
            ? baseUrl
            : `${baseUrl.replace(/\/$/, '')}/api/v1`;
        this.client = axios_1.default.create({
            baseURL: apiUrl,
            timeout,
            headers: {
                'X-N8N-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });
        this.client.interceptors.request.use((config) => {
            const isSensitive = config.url?.includes('/credentials') && config.method !== 'get';
            logger_1.logger.debug(`n8n API Request: ${config.method?.toUpperCase()} ${config.url}`, {
                params: config.params,
                data: isSensitive ? '[REDACTED]' : config.data,
            });
            return config;
        }, (error) => {
            logger_1.logger.error('n8n API Request Error:', error);
            return Promise.reject(error);
        });
        this.client.interceptors.response.use((response) => {
            logger_1.logger.debug(`n8n API Response: ${response.status} ${response.config.url}`);
            return response;
        }, (error) => {
            const n8nError = (0, n8n_errors_1.handleN8nApiError)(error);
            (0, n8n_errors_1.logN8nError)(n8nError, 'n8n API Response');
            return Promise.reject(n8nError);
        });
    }
    async getVersion() {
        if (this.versionInfo) {
            return this.versionInfo;
        }
        if (this.versionPromise) {
            return this.versionPromise;
        }
        this.versionPromise = this.fetchVersionOnce();
        try {
            this.versionInfo = await this.versionPromise;
            return this.versionInfo;
        }
        finally {
            this.versionPromise = null;
        }
    }
    async fetchVersionOnce() {
        let version = (0, n8n_version_1.getCachedVersion)(this.baseUrl);
        if (!version) {
            version = await (0, n8n_version_1.fetchN8nVersion)(this.baseUrl);
        }
        return version;
    }
    getCachedVersionInfo() {
        return this.versionInfo;
    }
    async healthCheck() {
        try {
            const baseUrl = this.client.defaults.baseURL || '';
            const healthzUrl = baseUrl.replace(/\/api\/v\d+\/?$/, '') + '/healthz';
            const response = await axios_1.default.get(healthzUrl, {
                timeout: 5000,
                validateStatus: (status) => status < 500
            });
            const versionInfo = await this.getVersion();
            if (response.status === 200 && response.data?.status === 'ok') {
                return {
                    status: 'ok',
                    n8nVersion: versionInfo?.version,
                    features: {}
                };
            }
            throw new Error('healthz endpoint not available');
        }
        catch (error) {
            try {
                await this.client.get('/workflows', { params: { limit: 1 } });
                const versionInfo = await this.getVersion();
                return {
                    status: 'ok',
                    n8nVersion: versionInfo?.version,
                    features: {}
                };
            }
            catch (fallbackError) {
                throw (0, n8n_errors_1.handleN8nApiError)(fallbackError);
            }
        }
    }
    async createWorkflow(workflow) {
        try {
            const cleanedWorkflow = (0, n8n_validation_1.cleanWorkflowForCreate)(workflow);
            const response = await this.client.post('/workflows', cleanedWorkflow);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getWorkflow(id) {
        try {
            const response = await this.client.get(`/workflows/${id}`);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateWorkflow(id, workflow) {
        try {
            const cleanedWorkflow = (0, n8n_validation_1.cleanWorkflowForUpdate)(workflow);
            const versionInfo = await this.getVersion();
            if (versionInfo) {
                logger_1.logger.debug(`Updating workflow with n8n version ${versionInfo.version}`);
                cleanedWorkflow.settings = (0, n8n_version_1.cleanSettingsForVersion)(cleanedWorkflow.settings, versionInfo);
            }
            else {
                logger_1.logger.warn('Could not determine n8n version, sending all known settings properties');
            }
            try {
                const response = await this.client.put(`/workflows/${id}`, cleanedWorkflow);
                return response.data;
            }
            catch (putError) {
                if (putError.response?.status === 405) {
                    logger_1.logger.debug('PUT method not supported, falling back to PATCH');
                    const response = await this.client.patch(`/workflows/${id}`, cleanedWorkflow);
                    return response.data;
                }
                throw putError;
            }
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteWorkflow(id) {
        try {
            const response = await this.client.delete(`/workflows/${id}`);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async transferWorkflow(id, destinationProjectId) {
        try {
            await this.client.put(`/workflows/${id}/transfer`, { destinationProjectId });
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async activateWorkflow(id) {
        try {
            const response = await this.client.post(`/workflows/${id}/activate`, {});
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deactivateWorkflow(id) {
        try {
            const response = await this.client.post(`/workflows/${id}/deactivate`, {});
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listWorkflows(params = {}) {
        try {
            const response = await this.client.get('/workflows', { params });
            return this.validateListResponse(response.data, 'workflows');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async generateAudit(options) {
        try {
            const additionalOptions = {};
            if (options?.categories)
                additionalOptions.categories = options.categories;
            if (options?.daysAbandonedWorkflow !== undefined)
                additionalOptions.daysAbandonedWorkflow = options.daysAbandonedWorkflow;
            const body = Object.keys(additionalOptions).length > 0 ? { additionalOptions } : {};
            const response = await this.client.post('/audit', body);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listAllWorkflows() {
        const allWorkflows = [];
        let cursor;
        const seenCursors = new Set();
        const PAGE_SIZE = 100;
        const MAX_PAGES = 50;
        for (let page = 0; page < MAX_PAGES; page++) {
            const params = { limit: PAGE_SIZE, cursor };
            const response = await this.listWorkflows(params);
            allWorkflows.push(...response.data);
            if (!response.nextCursor || seenCursors.has(response.nextCursor))
                break;
            seenCursors.add(response.nextCursor);
            cursor = response.nextCursor;
        }
        return allWorkflows;
    }
    async getExecution(id, includeData = false) {
        try {
            const response = await this.client.get(`/executions/${id}`, {
                params: { includeData },
            });
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listExecutions(params = {}) {
        try {
            const response = await this.client.get('/executions', { params });
            return this.validateListResponse(response.data, 'executions');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteExecution(id) {
        try {
            await this.client.delete(`/executions/${id}`);
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async triggerWebhook(request) {
        try {
            const { webhookUrl, httpMethod, data, headers, waitForResponse = true } = request;
            const { SSRFProtection } = await Promise.resolve().then(() => __importStar(require('../utils/ssrf-protection')));
            const validation = await SSRFProtection.validateWebhookUrl(webhookUrl);
            if (!validation.valid) {
                throw new Error(`SSRF protection: ${validation.reason}`);
            }
            const url = new URL(webhookUrl);
            const webhookPath = url.pathname;
            const config = {
                method: httpMethod,
                url: webhookPath,
                headers: {
                    ...headers,
                    'X-N8N-API-KEY': undefined,
                },
                data: httpMethod !== 'GET' ? data : undefined,
                params: httpMethod === 'GET' ? data : undefined,
                timeout: waitForResponse ? 120000 : 30000,
            };
            const webhookClient = axios_1.default.create({
                baseURL: new URL('/', webhookUrl).toString(),
                validateStatus: (status) => status < 500,
            });
            const response = await webhookClient.request(config);
            return {
                status: response.status,
                statusText: response.statusText,
                data: response.data,
                headers: response.headers,
            };
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listCredentials(params = {}) {
        try {
            const response = await this.client.get('/credentials', { params });
            return this.validateListResponse(response.data, 'credentials');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getCredential(id) {
        try {
            const response = await this.client.get(`/credentials/${id}`);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async createCredential(credential) {
        try {
            const response = await this.client.post('/credentials', credential);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateCredential(id, credential) {
        try {
            const response = await this.client.patch(`/credentials/${id}`, credential);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteCredential(id) {
        try {
            await this.client.delete(`/credentials/${id}`);
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getCredentialSchema(typeName) {
        try {
            const response = await this.client.get(`/credentials/schema/${typeName}`);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listTags(params = {}) {
        try {
            const response = await this.client.get('/tags', { params });
            return this.validateListResponse(response.data, 'tags');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async createTag(tag) {
        try {
            const response = await this.client.post('/tags', tag);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateTag(id, tag) {
        try {
            const response = await this.client.patch(`/tags/${id}`, tag);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteTag(id) {
        try {
            await this.client.delete(`/tags/${id}`);
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateWorkflowTags(workflowId, tagIds) {
        try {
            const response = await this.client.put(`/workflows/${workflowId}/tags`, tagIds.filter(id => id).map(id => ({ id })));
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getSourceControlStatus() {
        try {
            const response = await this.client.get('/source-control/status');
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async pullSourceControl(force = false) {
        try {
            const response = await this.client.post('/source-control/pull', { force });
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async pushSourceControl(message, fileNames) {
        try {
            const response = await this.client.post('/source-control/push', {
                message,
                fileNames,
            });
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getVariables() {
        try {
            const response = await this.client.get('/variables');
            return response.data.data || [];
        }
        catch (error) {
            logger_1.logger.warn('Variables API not available, returning empty array');
            return [];
        }
    }
    async createVariable(variable) {
        try {
            const response = await this.client.post('/variables', variable);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateVariable(id, variable) {
        try {
            const response = await this.client.patch(`/variables/${id}`, variable);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteVariable(id) {
        try {
            await this.client.delete(`/variables/${id}`);
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async createDataTable(params) {
        try {
            const response = await this.client.post('/data-tables', params);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async listDataTables(params = {}) {
        try {
            const response = await this.client.get('/data-tables', { params });
            return this.validateListResponse(response.data, 'data-tables');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getDataTable(id) {
        try {
            const response = await this.client.get(`/data-tables/${id}`);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateDataTable(id, params) {
        try {
            const response = await this.client.patch(`/data-tables/${id}`, params);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteDataTable(id) {
        try {
            await this.client.delete(`/data-tables/${id}`);
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async getDataTableRows(id, params = {}) {
        try {
            const response = await this.client.get(`/data-tables/${id}/rows`, {
                params,
                paramsSerializer: (p) => this.serializeDataTableParams(p),
            });
            return this.validateListResponse(response.data, 'data-table-rows');
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async insertDataTableRows(id, params) {
        try {
            const response = await this.client.post(`/data-tables/${id}/rows`, params);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async updateDataTableRows(id, params) {
        try {
            const response = await this.client.patch(`/data-tables/${id}/rows/update`, params);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async upsertDataTableRow(id, params) {
        try {
            const response = await this.client.post(`/data-tables/${id}/rows/upsert`, params);
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    async deleteDataTableRows(id, params) {
        try {
            const response = await this.client.delete(`/data-tables/${id}/rows/delete`, {
                params,
                paramsSerializer: (p) => this.serializeDataTableParams(p),
            });
            return response.data;
        }
        catch (error) {
            throw (0, n8n_errors_1.handleN8nApiError)(error);
        }
    }
    serializeDataTableParams(params) {
        const parts = [];
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null)
                continue;
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
        return parts.join('&');
    }
    validateListResponse(responseData, resourceType) {
        if (!responseData || typeof responseData !== 'object') {
            throw new Error(`Invalid response from n8n API for ${resourceType}: response is not an object`);
        }
        if (Array.isArray(responseData)) {
            logger_1.logger.warn(`n8n API returned array directly instead of {data, nextCursor} object for ${resourceType}. ` +
                'Wrapping in expected format for backwards compatibility.');
            return {
                data: responseData,
                nextCursor: null
            };
        }
        if (!Array.isArray(responseData.data)) {
            const keys = Object.keys(responseData).slice(0, 5);
            const keysPreview = keys.length < Object.keys(responseData).length
                ? `${keys.join(', ')}...`
                : keys.join(', ');
            throw new Error(`Invalid response from n8n API for ${resourceType}: expected {data: [], nextCursor?: string}, ` +
                `got object with keys: [${keysPreview}]`);
        }
        return responseData;
    }
}
exports.N8nApiClient = N8nApiClient;
//# sourceMappingURL=n8n-api-client.js.map