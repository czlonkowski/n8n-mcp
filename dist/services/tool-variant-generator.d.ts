import type { ParsedNode } from '../parsers/node-parser';
export declare class ToolVariantGenerator {
    generateToolVariant(baseNode: ParsedNode): ParsedNode | null;
    private addToolDescriptionProperty;
    private generateDescriptionPlaceholder;
    static isToolVariantNodeType(nodeType: string): boolean;
    static getBaseNodeType(toolNodeType: string): string | null;
    static getToolVariantNodeType(baseNodeType: string): string;
}
//# sourceMappingURL=tool-variant-generator.d.ts.map