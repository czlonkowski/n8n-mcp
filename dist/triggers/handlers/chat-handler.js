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
exports.ChatHandler = void 0;
const zod_1 = require("zod");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const base_handler_1 = require("./base-handler");
const trigger_detector_1 = require("../trigger-detector");
const chatInputSchema = zod_1.z.object({
    workflowId: zod_1.z.string(),
    triggerType: zod_1.z.literal('chat'),
    message: zod_1.z.string(),
    sessionId: zod_1.z.string().optional(),
    data: zod_1.z.record(zod_1.z.unknown()).optional(),
    headers: zod_1.z.record(zod_1.z.string()).optional(),
    timeout: zod_1.z.number().optional(),
    waitForResponse: zod_1.z.boolean().optional(),
});
function generateSessionId() {
    return `session_${Date.now()}_${(0, crypto_1.randomUUID)()}`;
}
class ChatHandler extends base_handler_1.BaseTriggerHandler {
    constructor() {
        super(...arguments);
        this.triggerType = 'chat';
        this.capabilities = {
            requiresActiveWorkflow: true,
            canPassInputData: true,
        };
        this.inputSchema = chatInputSchema;
    }
    async execute(input, workflow, triggerInfo) {
        const startTime = Date.now();
        try {
            const baseUrl = this.getBaseUrl();
            if (!baseUrl) {
                return this.errorResponse(input, 'Cannot determine n8n base URL', startTime);
            }
            let chatUrl;
            if (triggerInfo?.webhookPath) {
                chatUrl = (0, trigger_detector_1.buildTriggerUrl)(baseUrl, triggerInfo, 'production');
            }
            else {
                chatUrl = `${baseUrl.replace(/\/+$/, '')}/webhook/${input.workflowId}`;
            }
            const { SSRFProtection } = await Promise.resolve().then(() => __importStar(require('../../utils/ssrf-protection')));
            const validation = await SSRFProtection.validateWebhookUrl(chatUrl);
            if (!validation.valid) {
                return this.errorResponse(input, `SSRF protection: ${validation.reason}`, startTime);
            }
            const sessionId = input.sessionId || generateSessionId();
            const chatPayload = {
                action: 'sendMessage',
                sessionId,
                chatInput: input.message,
                ...input.data,
            };
            const config = {
                method: 'POST',
                url: chatUrl,
                headers: {
                    'Content-Type': 'application/json',
                    ...input.headers,
                },
                data: chatPayload,
                timeout: input.timeout || (input.waitForResponse !== false ? 120000 : 30000),
                validateStatus: (status) => status < 500,
            };
            const response = await axios_1.default.request(config);
            const chatResponse = response.data;
            return this.normalizeResponse(chatResponse, input, startTime, {
                status: response.status,
                statusText: response.statusText,
                metadata: {
                    duration: Date.now() - startTime,
                    sessionId,
                    webhookPath: triggerInfo?.webhookPath,
                },
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorDetails = error?.response?.data;
            const executionId = errorDetails?.executionId || errorDetails?.id;
            return this.errorResponse(input, errorMessage, startTime, {
                executionId,
                code: error?.code,
                details: errorDetails,
            });
        }
    }
}
exports.ChatHandler = ChatHandler;
//# sourceMappingURL=chat-handler.js.map