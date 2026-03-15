"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeNodeType = normalizeNodeType;
exports.denormalizeNodeType = denormalizeNodeType;
exports.extractNodeName = extractNodeName;
exports.getNodePackage = getNodePackage;
exports.isBaseNode = isBaseNode;
exports.isLangChainNode = isLangChainNode;
exports.isValidNodeTypeFormat = isValidNodeTypeFormat;
exports.getNodeTypeVariations = getNodeTypeVariations;
exports.isTriggerNode = isTriggerNode;
exports.isActivatableTrigger = isActivatableTrigger;
exports.getTriggerTypeDescription = getTriggerTypeDescription;
function normalizeNodeType(type) {
    if (!type)
        return type;
    return type
        .replace(/^n8n-nodes-base\./, 'nodes-base.')
        .replace(/^@n8n\/n8n-nodes-langchain\./, 'nodes-langchain.');
}
function denormalizeNodeType(type, packageType) {
    if (!type)
        return type;
    if (packageType === 'base') {
        return type.replace(/^nodes-base\./, 'n8n-nodes-base.');
    }
    return type.replace(/^nodes-langchain\./, '@n8n/n8n-nodes-langchain.');
}
function extractNodeName(type) {
    if (!type)
        return '';
    const normalized = normalizeNodeType(type);
    const parts = normalized.split('.');
    return parts[parts.length - 1] || '';
}
function getNodePackage(type) {
    if (!type || !type.includes('.'))
        return null;
    const normalized = normalizeNodeType(type);
    const parts = normalized.split('.');
    return parts[0] || null;
}
function isBaseNode(type) {
    const normalized = normalizeNodeType(type);
    return normalized.startsWith('nodes-base.');
}
function isLangChainNode(type) {
    const normalized = normalizeNodeType(type);
    return normalized.startsWith('nodes-langchain.');
}
function isValidNodeTypeFormat(type) {
    if (!type || typeof type !== 'string')
        return false;
    if (!type.includes('.'))
        return false;
    const parts = type.split('.');
    if (parts.length !== 2)
        return false;
    return parts[0].length > 0 && parts[1].length > 0;
}
function getNodeTypeVariations(type) {
    const variations = [];
    if (type.includes('.')) {
        variations.push(normalizeNodeType(type));
        const normalized = normalizeNodeType(type);
        if (normalized.startsWith('nodes-base.')) {
            variations.push(denormalizeNodeType(normalized, 'base'));
        }
        else if (normalized.startsWith('nodes-langchain.')) {
            variations.push(denormalizeNodeType(normalized, 'langchain'));
        }
    }
    else {
        variations.push(`nodes-base.${type}`);
        variations.push(`n8n-nodes-base.${type}`);
        variations.push(`nodes-langchain.${type}`);
        variations.push(`@n8n/n8n-nodes-langchain.${type}`);
    }
    return [...new Set(variations)];
}
function isTriggerNode(nodeType) {
    const normalized = normalizeNodeType(nodeType);
    const lowerType = normalized.toLowerCase();
    if (lowerType.includes('trigger')) {
        return true;
    }
    if (lowerType.includes('webhook') && !lowerType.includes('respond')) {
        return true;
    }
    if (lowerType.includes('emailread') || lowerType.includes('emailreadimap')) {
        return true;
    }
    return normalized === 'nodes-base.start';
}
function isActivatableTrigger(nodeType) {
    return isTriggerNode(nodeType);
}
function getTriggerTypeDescription(nodeType) {
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
//# sourceMappingURL=node-type-utils.js.map