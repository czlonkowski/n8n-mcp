/**
 * Form trigger handler
 *
 * Handles form-based workflow triggers:
 * - POST to /form/<webhookId> with multipart/form-data
 * - Supports all n8n form field types: text, textarea, email, number, password, date, dropdown, checkbox, file, hidden
 * - Workflow must be active (for production endpoint)
 */

import { z } from 'zod';
import axios, { AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { Workflow, WorkflowNode } from '../../types/n8n-api';
import {
  TriggerType,
  TriggerResponse,
  TriggerHandlerCapabilities,
  DetectedTrigger,
  FormTriggerInput,
} from '../types';
import { BaseTriggerHandler } from './base-handler';

/**
 * Zod schema for form input validation
 */
const formInputSchema = z.object({
  workflowId: z.string(),
  triggerType: z.literal('form'),
  formData: z.record(z.unknown()).optional(),
  data: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  waitForResponse: z.boolean().optional(),
});

/**
 * Form field types supported by n8n
 */
const FORM_FIELD_TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  EMAIL: 'email',
  NUMBER: 'number',
  PASSWORD: 'password',
  DATE: 'date',
  DROPDOWN: 'dropdown',
  CHECKBOX: 'checkbox',
  FILE: 'file',
  HIDDEN: 'hiddenField',
  HTML: 'html',
} as const;

/**
 * Maximum file size for base64 uploads (10MB)
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * n8n form field option structure
 */
interface FormFieldOption {
  option: string;
}

/**
 * n8n form field value structure from workflow parameters
 */
interface FormFieldValue {
  fieldType?: string;
  fieldLabel?: string;
  fieldName?: string;
  elementName?: string;
  requiredField?: boolean;
  fieldOptions?: {
    values?: FormFieldOption[];
  };
}

/**
 * Form field definition extracted from workflow
 */
interface FormFieldDef {
  index: number;
  fieldName: string;        // field-0, field-1, etc.
  label: string;
  type: string;
  required: boolean;
  options?: string[];       // For dropdown/checkbox
}

/**
 * Check if a string is valid base64
 */
function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) {
    return false;
  }
  // Check for valid base64 characters and proper padding
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) {
    return false;
  }
  try {
    // Verify round-trip encoding
    const decoded = Buffer.from(str, 'base64');
    return decoded.toString('base64') === str;
  } catch {
    return false;
  }
}

/**
 * Extract form field definitions from workflow
 */
function extractFormFields(workflow: Workflow, triggerNode?: WorkflowNode): FormFieldDef[] {
  const node = triggerNode || workflow.nodes.find(n =>
    n.type.toLowerCase().includes('formtrigger')
  );

  const params = node?.parameters as Record<string, unknown> | undefined;
  const formFields = params?.formFields as { values?: unknown[] } | undefined;

  if (!formFields?.values) {
    return [];
  }

  const fields: FormFieldDef[] = [];
  let fieldIndex = 0;

  for (const rawField of formFields.values) {
    const field = rawField as FormFieldValue;
    const fieldType = field.fieldType || FORM_FIELD_TYPES.TEXT;

    // HTML fields are rendered as hidden inputs but are display-only
    // They still get a field index
    const def: FormFieldDef = {
      index: fieldIndex,
      fieldName: `field-${fieldIndex}`,
      label: field.fieldLabel || field.fieldName || field.elementName || `field-${fieldIndex}`,
      type: fieldType,
      required: field.requiredField === true,
    };

    // Extract options for dropdown/checkbox
    if (field.fieldOptions?.values) {
      def.options = field.fieldOptions.values.map((v: FormFieldOption) => v.option);
    }

    fields.push(def);
    fieldIndex++;
  }

  return fields;
}

/**
 * Generate helpful usage hint for form fields
 */
function generateFormUsageHint(fields: FormFieldDef[]): string {
  if (fields.length === 0) {
    return 'No form fields detected in workflow.';
  }

  const lines: string[] = ['Form fields (use these keys in data parameter):'];

  for (const field of fields) {
    let hint = `  "${field.fieldName}": `;

    switch (field.type) {
      case FORM_FIELD_TYPES.CHECKBOX:
        hint += `["${field.options?.[0] || 'option1'}", ...]`;
        if (field.options) {
          hint += ` (options: ${field.options.join(', ')})`;
        }
        break;
      case FORM_FIELD_TYPES.DROPDOWN:
        hint += `"${field.options?.[0] || 'value'}"`;
        if (field.options) {
          hint += ` (options: ${field.options.join(', ')})`;
        }
        break;
      case FORM_FIELD_TYPES.DATE:
        hint += '"YYYY-MM-DD"';
        break;
      case FORM_FIELD_TYPES.EMAIL:
        hint += '"user@example.com"';
        break;
      case FORM_FIELD_TYPES.NUMBER:
        hint += '123';
        break;
      case FORM_FIELD_TYPES.FILE:
        hint += '{ filename: "test.txt", content: "base64..." } or skip (sends empty file)';
        break;
      case FORM_FIELD_TYPES.PASSWORD:
        hint += '"secret"';
        break;
      case FORM_FIELD_TYPES.TEXTAREA:
        hint += '"multi-line text..."';
        break;
      case FORM_FIELD_TYPES.HTML:
        hint += '"" (display-only, can be omitted)';
        break;
      case FORM_FIELD_TYPES.HIDDEN:
        hint += '"value" (hidden field)';
        break;
      default:
        hint += '"text value"';
    }

    hint += field.required ? ' [REQUIRED]' : '';
    hint += ` // ${field.label}`;
    lines.push(hint);
  }

  return lines.join('\n');
}

/**
 * Form trigger handler
 */
export class FormHandler extends BaseTriggerHandler<FormTriggerInput> {
  readonly triggerType: TriggerType = 'form';

  readonly capabilities: TriggerHandlerCapabilities = {
    requiresActiveWorkflow: true,
    canPassInputData: true,
  };

  readonly inputSchema = formInputSchema;

  async execute(
    input: FormTriggerInput,
    workflow: Workflow,
    triggerInfo?: DetectedTrigger
  ): Promise<TriggerResponse> {
    const startTime = Date.now();

    // Extract form field definitions for helpful error messages
    const formFieldDefs = extractFormFields(workflow, triggerInfo?.node);

    try {
      // Build form URL
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) {
        return this.errorResponse(input, 'Cannot determine n8n base URL', startTime, {
          details: {
            formFields: formFieldDefs,
            hint: generateFormUsageHint(formFieldDefs),
          },
        });
      }

      // Form triggers use /form/<webhookId> endpoint
      const formPath = triggerInfo?.webhookPath || triggerInfo?.node?.parameters?.path || input.workflowId;
      const formUrl = `${baseUrl.replace(/\/+$/, '')}/form/${formPath}`;

      // Merge formData and data (formData takes precedence)
      const inputFields = {
        ...input.data,
        ...input.formData,
      };

      // SSRF protection
      const { SSRFProtection } = await import('../../utils/ssrf-protection');
      const validation = await SSRFProtection.validateWebhookUrl(formUrl);
      if (!validation.valid) {
        return this.errorResponse(input, `SSRF protection: ${validation.reason}`, startTime);
      }

      // SECURITY (GHSA-cmrh-wvq6-wm9r): pin transport to validated IP.
      const pinned = validation.address && validation.family
        ? SSRFProtection.createPinnedAgents(validation.address, validation.family)
        : undefined;

      // Build multipart/form-data (required by n8n form triggers)
      const formData = new FormData();
      const warnings: string[] = [];

      // Process each defined form field
      for (const fieldDef of formFieldDefs) {
        const value = inputFields[fieldDef.fieldName];

        switch (fieldDef.type) {
          case FORM_FIELD_TYPES.CHECKBOX:
            // Checkbox fields need array syntax with [] suffix
            if (Array.isArray(value)) {
              for (const item of value) {
                formData.append(`${fieldDef.fieldName}[]`, String(item ?? ''));
              }
            } else if (value !== undefined && value !== null) {
              // Single value provided, wrap in array
              formData.append(`${fieldDef.fieldName}[]`, String(value));
            } else if (fieldDef.required) {
              warnings.push(`Required checkbox field "${fieldDef.fieldName}" (${fieldDef.label}) not provided`);
            }
            break;

          case FORM_FIELD_TYPES.FILE:
            // File fields - handle file upload or send empty placeholder
            if (value && typeof value === 'object' && 'content' in value) {
              // File object with content (base64 or buffer)
              const fileObj = value as { filename?: string; content: string | Buffer };
              let buffer: Buffer;

              if (typeof fileObj.content === 'string') {
                // Validate base64 encoding
                if (!isValidBase64(fileObj.content)) {
                  warnings.push(`Invalid base64 encoding for file field "${fieldDef.fieldName}" (${fieldDef.label})`);
                  buffer = Buffer.from('');
                } else {
                  buffer = Buffer.from(fileObj.content, 'base64');
                  // Check file size
                  if (buffer.length > MAX_FILE_SIZE_BYTES) {
                    warnings.push(`File too large for "${fieldDef.fieldName}" (${fieldDef.label}): ${Math.round(buffer.length / 1024 / 1024)}MB exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
                    buffer = Buffer.from('');
                  }
                }
              } else {
                buffer = fileObj.content;
                // Check file size for Buffer input
                if (buffer.length > MAX_FILE_SIZE_BYTES) {
                  warnings.push(`File too large for "${fieldDef.fieldName}" (${fieldDef.label}): ${Math.round(buffer.length / 1024 / 1024)}MB exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
                  buffer = Buffer.from('');
                }
              }

              formData.append(fieldDef.fieldName, buffer, {
                filename: fileObj.filename || 'file.txt',
                contentType: 'application/octet-stream',
              });
            } else if (value && typeof value === 'string') {
              // String value - treat as base64 content
              if (!isValidBase64(value)) {
                warnings.push(`Invalid base64 encoding for file field "${fieldDef.fieldName}" (${fieldDef.label})`);
                formData.append(fieldDef.fieldName, Buffer.from(''), {
                  filename: 'empty.txt',
                  contentType: 'text/plain',
                });
              } else {
                const buffer = Buffer.from(value, 'base64');
                if (buffer.length > MAX_FILE_SIZE_BYTES) {
                  warnings.push(`File too large for "${fieldDef.fieldName}" (${fieldDef.label}): ${Math.round(buffer.length / 1024 / 1024)}MB exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
                  formData.append(fieldDef.fieldName, Buffer.from(''), {
                    filename: 'empty.txt',
                    contentType: 'text/plain',
                  });
                } else {
                  formData.append(fieldDef.fieldName, buffer, {
                    filename: 'file.txt',
                    contentType: 'application/octet-stream',
                  });
                }
              }
            } else {
              // No file provided - send empty file as placeholder
              formData.append(fieldDef.fieldName, Buffer.from(''), {
                filename: 'empty.txt',
                contentType: 'text/plain',
              });
              if (fieldDef.required) {
                warnings.push(`Required file field "${fieldDef.fieldName}" (${fieldDef.label}) not provided - sending empty placeholder`);
              }
            }
            break;

          case FORM_FIELD_TYPES.HTML:
            // HTML is display-only, but n8n renders it as hidden input
            // Send empty string or provided value
            formData.append(fieldDef.fieldName, String(value ?? ''));
            break;

          case FORM_FIELD_TYPES.HIDDEN:
            // Hidden fields
            formData.append(fieldDef.fieldName, String(value ?? ''));
            break;

          default:
            // Standard fields: text, textarea, email, number, password, date, dropdown
            if (value !== undefined && value !== null) {
              formData.append(fieldDef.fieldName, String(value));
            } else if (fieldDef.required) {
              warnings.push(`Required field "${fieldDef.fieldName}" (${fieldDef.label}) not provided`);
            }
            break;
        }
      }

      // Also include any extra fields not in the form definition (for flexibility)
      const definedFieldNames = new Set(formFieldDefs.map(f => f.fieldName));
      for (const [key, value] of Object.entries(inputFields)) {
        if (!definedFieldNames.has(key)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(`${key}[]`, String(item ?? ''));
            }
          } else {
            formData.append(key, String(value ?? ''));
          }
        }
      }

      // Build request config
      const config: AxiosRequestConfig = {
        method: 'POST',
        url: formUrl,
        headers: {
          ...formData.getHeaders(),
          ...input.headers,
        },
        data: formData,
        timeout: input.timeout || (input.waitForResponse !== false ? 120000 : 30000),
        validateStatus: (status) => status < 500,
        // SECURITY (GHSA-8g7g-hmwm-6rv2): no redirect-following on validated URLs.
        maxRedirects: 0,
        httpAgent: pinned?.httpAgent,
        httpsAgent: pinned?.httpsAgent,
      };

      // Make the request
      const response = await axios.request(config);

      const result = this.normalizeResponse(response.data, input, startTime, {
        status: response.status,
        statusText: response.statusText,
        metadata: {
          duration: Date.now() - startTime,
        },
      });

      // Add fields submitted count to details
      result.details = {
        ...result.details,
        fieldsSubmitted: formFieldDefs.length,
      };

      // Add warnings if any
      if (warnings.length > 0) {
        result.details = {
          ...result.details,
          warnings,
        };
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Try to extract execution ID from error if available
      const errorDetails = (error as any)?.response?.data;
      const executionId = errorDetails?.executionId || errorDetails?.id;

      return this.errorResponse(input, errorMessage, startTime, {
        executionId,
        code: (error as any)?.code,
        details: {
          ...errorDetails,
          formFields: formFieldDefs.map(f => ({
            name: f.fieldName,
            label: f.label,
            type: f.type,
            required: f.required,
            options: f.options,
          })),
          hint: generateFormUsageHint(formFieldDefs),
        },
      });
    }
  }
}
