import { z } from 'zod';
import { Workflow } from '../../types/n8n-api';
import { TriggerType, TriggerResponse, TriggerHandlerCapabilities, DetectedTrigger, ChatTriggerInput } from '../types';
import { BaseTriggerHandler } from './base-handler';
export declare class ChatHandler extends BaseTriggerHandler<ChatTriggerInput> {
    readonly triggerType: TriggerType;
    readonly capabilities: TriggerHandlerCapabilities;
    readonly inputSchema: z.ZodObject<{
        workflowId: z.ZodString;
        triggerType: z.ZodLiteral<"chat">;
        message: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        waitForResponse: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        workflowId: string;
        triggerType: "chat";
        message: string;
        sessionId?: string | undefined;
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
    }, {
        workflowId: string;
        triggerType: "chat";
        message: string;
        sessionId?: string | undefined;
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
    }>;
    execute(input: ChatTriggerInput, workflow: Workflow, triggerInfo?: DetectedTrigger): Promise<TriggerResponse>;
}
//# sourceMappingURL=chat-handler.d.ts.map