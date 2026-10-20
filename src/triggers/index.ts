/**
 * Trigger system for n8n_test_workflow tool
 *
 * Provides extensible trigger handling for different n8n trigger types:
 * - webhook: HTTP-based triggers
 * - form: Form submission triggers
 * - chat: Chat/AI triggers
 *
 * Note: n8n's public API does not support direct workflow execution.
 * Only workflows with these trigger types can be triggered externally.
 */

// Types
export {
  TriggerType,
  BaseTriggerInput,
  WebhookTriggerInput,
  FormTriggerInput,
  ChatTriggerInput,
  TriggerInput,
  TriggerResponse,
  TriggerHandlerCapabilities,
  DetectedTrigger,
  TriggerDetectionResult,
  TestWorkflowInput,
} from './types';

// Detector
export {
  detectTriggerFromWorkflow,
  classifyTriggerNode,
  buildTriggerUrl,
  describeTrigger,
} from './trigger-detector';

// Registry
export {
  TriggerRegistry,
  initializeTriggerRegistry,
  ensureRegistryInitialized,
} from './trigger-registry';

// Base handler
export {
  BaseTriggerHandler,
  TriggerHandlerConstructor,
} from './handlers/base-handler';
