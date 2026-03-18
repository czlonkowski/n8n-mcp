"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolVariantGenerator = void 0;
class ToolVariantGenerator {
    generateToolVariant(baseNode) {
        if (!baseNode.isAITool) {
            return null;
        }
        if (baseNode.isToolVariant) {
            return null;
        }
        if (baseNode.isTrigger) {
            return null;
        }
        if (!baseNode.nodeType) {
            return null;
        }
        const toolNodeType = `${baseNode.nodeType}Tool`;
        const baseProperties = Array.isArray(baseNode.properties) ? baseNode.properties : [];
        return {
            ...baseNode,
            nodeType: toolNodeType,
            displayName: `${baseNode.displayName} Tool`,
            description: baseNode.description
                ? `${baseNode.description} (AI Tool variant for use with AI Agents)`
                : 'AI Tool variant for use with AI Agents',
            isToolVariant: true,
            toolVariantOf: baseNode.nodeType,
            hasToolVariant: false,
            outputs: [{ type: 'ai_tool', displayName: 'Tool' }],
            outputNames: ['Tool'],
            properties: this.addToolDescriptionProperty(baseProperties, baseNode.displayName),
        };
    }
    addToolDescriptionProperty(properties, displayName) {
        const toolDescriptionProperty = {
            displayName: 'Tool Description',
            name: 'toolDescription',
            type: 'string',
            default: '',
            required: false,
            description: 'Description for the AI to understand what this tool does and when to use it',
            typeOptions: {
                rows: 3
            },
            placeholder: `e.g., Use this tool to ${this.generateDescriptionPlaceholder(displayName)}`
        };
        return [toolDescriptionProperty, ...properties];
    }
    generateDescriptionPlaceholder(displayName) {
        const lowerName = displayName.toLowerCase();
        if (lowerName.includes('database') || lowerName.includes('sql')) {
            return 'query and manage data in the database';
        }
        if (lowerName.includes('email') || lowerName.includes('mail')) {
            return 'send and manage emails';
        }
        if (lowerName.includes('sheet') || lowerName.includes('spreadsheet')) {
            return 'read and write spreadsheet data';
        }
        if (lowerName.includes('file') || lowerName.includes('drive') || lowerName.includes('storage')) {
            return 'manage files and storage';
        }
        if (lowerName.includes('message') || lowerName.includes('chat') || lowerName.includes('slack')) {
            return 'send messages and communicate';
        }
        if (lowerName.includes('http') || lowerName.includes('api') || lowerName.includes('request')) {
            return 'make API requests and fetch data';
        }
        if (lowerName.includes('calendar') || lowerName.includes('event')) {
            return 'manage calendar events and schedules';
        }
        return `interact with ${displayName}`;
    }
    static isToolVariantNodeType(nodeType) {
        if (!nodeType || !nodeType.endsWith('Tool') || nodeType.endsWith('ToolTool')) {
            return false;
        }
        const basePart = nodeType.slice(0, -4);
        return basePart.includes('.') && basePart.split('.').pop().length > 0;
    }
    static getBaseNodeType(toolNodeType) {
        if (!ToolVariantGenerator.isToolVariantNodeType(toolNodeType)) {
            return null;
        }
        return toolNodeType.slice(0, -4);
    }
    static getToolVariantNodeType(baseNodeType) {
        return `${baseNodeType}Tool`;
    }
}
exports.ToolVariantGenerator = ToolVariantGenerator;
//# sourceMappingURL=tool-variant-generator.js.map