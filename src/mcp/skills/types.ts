/**
 * Types for the SkillResourceRegistry — markdown skill files exposed
 * via MCP Resources (skill://n8n-mcp/{name}/{file}).
 */

export interface SkillResource {
  skillName: string;
  file: string;
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  content: string;
}
