/**
 * Utility functions for working with n8n node types
 * Provides consistent normalization and transformation of node type strings
 */

/**
 * Normalize a node type to the standard short form
 * Handles both old-style (n8n-nodes-base.) and new-style (nodes-base.) prefixes
 *
 * @example
 * normalizeNodeType('n8n-nodes-base.httpRequest') // 'nodes-base.httpRequest'
 * normalizeNodeType('@n8n/n8n-nodes-langchain.openAi') // 'nodes-langchain.openAi'
 * normalizeNodeType('nodes-base.webhook') // 'nodes-base.webhook' (unchanged)
 */
export function normalizeNodeType(type: string): string {
  if (!type) return type;

  return type
    .replace(/^n8n-nodes-base\./, 'nodes-base.')
    .replace(/^@n8n\/n8n-nodes-langchain\./, 'nodes-langchain.');
}

/**
 * Convert a short-form node type to the full package name
 *
 * @example
 * denormalizeNodeType('nodes-base.httpRequest', 'base') // 'n8n-nodes-base.httpRequest'
 * denormalizeNodeType('nodes-langchain.openAi', 'langchain') // '@n8n/n8n-nodes-langchain.openAi'
 */
export function denormalizeNodeType(type: string, packageType: 'base' | 'langchain'): string {
  if (!type) return type;

  if (packageType === 'base') {
    return type.replace(/^nodes-base\./, 'n8n-nodes-base.');
  }

  return type.replace(/^nodes-langchain\./, '@n8n/n8n-nodes-langchain.');
}

/**
 * Extract the node name from a full node type
 *
 * @example
 * extractNodeName('nodes-base.httpRequest') // 'httpRequest'
 * extractNodeName('n8n-nodes-base.webhook') // 'webhook'
 */
export function extractNodeName(type: string): string {
  if (!type) return '';

  // First normalize the type
  const normalized = normalizeNodeType(type);

  // Extract everything after the last dot
  const parts = normalized.split('.');
  return parts[parts.length - 1] || '';
}

/**
 * Get the package prefix from a node type
 *
 * @example
 * getNodePackage('nodes-base.httpRequest') // 'nodes-base'
 * getNodePackage('nodes-langchain.openAi') // 'nodes-langchain'
 */
export function getNodePackage(type: string): string | null {
  if (!type || !type.includes('.')) return null;

  // First normalize the type
  const normalized = normalizeNodeType(type);

  // Extract everything before the first dot
  const parts = normalized.split('.');
  return parts[0] || null;
}

/**
 * Check if a node type is from the base package
 */
export function isBaseNode(type: string): boolean {
  const normalized = normalizeNodeType(type);
  return normalized.startsWith('nodes-base.');
}

/**
 * Check if a node type is from the langchain package
 */
export function isLangChainNode(type: string): boolean {
  const normalized = normalizeNodeType(type);
  return normalized.startsWith('nodes-langchain.');
}

/**
 * Validate if a string looks like a valid node type
 * (has package prefix and node name)
 */
export function isValidNodeTypeFormat(type: string): boolean {
  if (!type || typeof type !== 'string') return false;

  // Must contain at least one dot
  if (!type.includes('.')) return false;

  const parts = type.split('.');

  // Must have exactly 2 parts (package and node name)
  if (parts.length !== 2) return false;

  // Both parts must be non-empty
  return parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Try multiple variations of a node type to find a match
 * Returns an array of variations to try in order
 *
 * @example
 * getNodeTypeVariations('httpRequest')
 * // ['nodes-base.httpRequest', 'n8n-nodes-base.httpRequest', 'nodes-langchain.httpRequest', ...]
 */
export function getNodeTypeVariations(type: string): string[] {
  const variations: string[] = [];

  // If it already has a package prefix, try normalized version first
  if (type.includes('.')) {
    variations.push(normalizeNodeType(type));

    // Also try the denormalized versions
    const normalized = normalizeNodeType(type);
    if (normalized.startsWith('nodes-base.')) {
      variations.push(denormalizeNodeType(normalized, 'base'));
    } else if (normalized.startsWith('nodes-langchain.')) {
      variations.push(denormalizeNodeType(normalized, 'langchain'));
    }
  } else {
    // No package prefix, try common packages
    variations.push(`nodes-base.${type}`);
    variations.push(`n8n-nodes-base.${type}`);
    variations.push(`nodes-langchain.${type}`);
    variations.push(`@n8n/n8n-nodes-langchain.${type}`);
  }

  // Remove duplicates while preserving order
  return [...new Set(variations)];
}

/**
 * Check if a node is ANY type of trigger (including executeWorkflowTrigger)
 *
 * This function determines if a node can start a workflow execution.
 * Returns true for:
 * - Webhook triggers (webhook, webhookTrigger)
 * - Time-based triggers (schedule, cron)
 * - Poll-based triggers (emailTrigger, slackTrigger, etc.)
 * - Manual triggers (manualTrigger, start, formTrigger)
 * - Sub-workflow triggers (executeWorkflowTrigger)
 *
 * Used for: Disconnection validation (triggers don't need incoming connections)
 *
 * @param nodeType - The node type to check (e.g., "n8n-nodes-base.executeWorkflowTrigger")
 * @returns true if node is any type of trigger
 */
export function isTriggerNode(nodeType: string): boolean {
  const normalized = normalizeNodeType(nodeType);
  const lowerType = normalized.toLowerCase();

  // Check for trigger pattern in node type name
  if (lowerType.includes('trigger')) {
    return true;
  }

  // Check for webhook nodes (excluding respondToWebhook which is NOT a trigger)
  if (lowerType.includes('webhook') && !lowerType.includes('respond')) {
    return true;
  }

  // Check for polling-based triggers that don't have 'trigger' in their name
  if (lowerType.includes('emailread') || lowerType.includes('emailreadimap')) {
    return true;
  }

  // Check for specific trigger types that don't have 'trigger' in their name
  // (manualTrigger and formTrigger are already caught by the 'trigger' check above)
  return normalized === 'nodes-base.start';
}

/**
 * Check if a node is an ACTIVATABLE trigger
 *
 * This function determines if a node can be used to activate a workflow.
 * Returns true for:
 * - Webhook triggers (webhook, webhookTrigger)
 * - Time-based triggers (schedule, cron)
 * - Poll-based triggers (emailTrigger, slackTrigger, etc.)
 * - Manual triggers (manualTrigger, start, formTrigger)
 * - Sub-workflow triggers (executeWorkflowTrigger) - requires activation in n8n 2.0+
 *
 * Used for: Activation validation (active workflows need activatable triggers)
 *
 * NOTE: Since n8n 2.0, executeWorkflowTrigger workflows MUST be activated to work.
 * This is a breaking change from pre-2.0 behavior.
 *
 * @param nodeType - The node type to check
 * @returns true if node can activate a workflow
 */
export function isActivatableTrigger(nodeType: string): boolean {
  // All trigger nodes can activate workflows (including executeWorkflowTrigger in n8n 2.0+)
  return isTriggerNode(nodeType);
}

/**
 * Get human-readable description of trigger type
 *
 * @param nodeType - The node type
 * @returns Description of what triggers this node
 */
export function getTriggerTypeDescription(nodeType: string): string {
  const normalized = normalizeNodeType(nodeType);
  const lowerType = normalized.toLowerCase();

  if (lowerType.includes('executeworkflow')) {
    return 'Execute Workflow Trigger (invoked by other workflows)';
  }

  if (lowerType.includes('webhook')) {
    return 'Webhook Trigger (HTTP requests)';
  }

  if (lowerType.includes('schedule') || lowerType.includes('cron')) {
    return 'Schedule Trigger (time-based)';
  }

  if (lowerType.includes('manual') || normalized === 'nodes-base.start') {
    return 'Manual Trigger (manual execution)';
  }

  if (lowerType.includes('email') || lowerType.includes('imap') || lowerType.includes('gmail')) {
    return 'Email Trigger (polling)';
  }

  if (lowerType.includes('form')) {
    return 'Form Trigger (form submissions)';
  }

  if (lowerType.includes('trigger')) {
    return 'Trigger (event-based)';
  }

  return 'Unknown trigger type';
}