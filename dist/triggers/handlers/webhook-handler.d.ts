import { z } from 'zod';
import { Workflow } from '../../types/n8n-api';
import { TriggerType, TriggerResponse, TriggerHandlerCapabilities, DetectedTrigger, WebhookTriggerInput } from '../types';
import { BaseTriggerHandler } from './base-handler';
export declare class WebhookHandler extends BaseTriggerHandler<WebhookTriggerInput> {
    readonly triggerType: TriggerType;
    readonly capabilities: TriggerHandlerCapabilities;
    readonly inputSchema: z.ZodObject<{
        workflowId: z.ZodString;
        triggerType: z.ZodLiteral<"webhook">;
        httpMethod: z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "DELETE"]>>;
        webhookPath: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        waitForResponse: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        workflowId: string;
        triggerType: "webhook";
        httpMethod?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
        webhookPath?: string | undefined;
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
    }, {
        workflowId: string;
        triggerType: "webhook";
        httpMethod?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
        webhookPath?: string | undefined;
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
    }>;
    execute(input: WebhookTriggerInput, workflow: Workflow, triggerInfo?: DetectedTrigger): Promise<TriggerResponse>;
}
//# sourceMappingURL=webhook-handler.d.ts.map