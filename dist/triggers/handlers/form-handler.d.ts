import { z } from 'zod';
import { Workflow } from '../../types/n8n-api';
import { TriggerType, TriggerResponse, TriggerHandlerCapabilities, DetectedTrigger, FormTriggerInput } from '../types';
import { BaseTriggerHandler } from './base-handler';
export declare class FormHandler extends BaseTriggerHandler<FormTriggerInput> {
    readonly triggerType: TriggerType;
    readonly capabilities: TriggerHandlerCapabilities;
    readonly inputSchema: z.ZodObject<{
        workflowId: z.ZodString;
        triggerType: z.ZodLiteral<"form">;
        formData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        waitForResponse: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        workflowId: string;
        triggerType: "form";
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
        formData?: Record<string, unknown> | undefined;
    }, {
        workflowId: string;
        triggerType: "form";
        data?: Record<string, unknown> | undefined;
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
        waitForResponse?: boolean | undefined;
        formData?: Record<string, unknown> | undefined;
    }>;
    execute(input: FormTriggerInput, workflow: Workflow, triggerInfo?: DetectedTrigger): Promise<TriggerResponse>;
}
//# sourceMappingURL=form-handler.d.ts.map