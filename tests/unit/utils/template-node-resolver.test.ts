import { describe, it, expect } from 'vitest';
import { resolveTemplateNodeTypes } from '../../../src/utils/template-node-resolver';

describe('Template Node Resolver', () => {
  describe('resolveTemplateNodeTypes', () => {
    it('should handle bare node names', () => {
      const result = resolveTemplateNodeTypes(['slack']);
      
      expect(result).toContain('n8n-nodes-base.slack');
      expect(result).toContain('n8n-nodes-base.slackTrigger');
    });
    
    it('should handle HTTP variations', () => {
      const result = resolveTemplateNodeTypes(['http']);
      
      expect(result).toContain('n8n-nodes-base.httpRequest');
      expect(result).toContain('n8n-nodes-base.webhook');
    });
    
    it('should handle httpRequest variations', () => {
      const result = resolveTemplateNodeTypes(['httprequest']);
      
      expect(result).toContain('n8n-nodes-base.httpRequest');
    });
    
    it('should handle partial prefix formats', () => {
      const result = resolveTemplateNodeTypes(['nodes-base.webhook']);
      
      expect(result).toContain('n8n-nodes-base.webhook');
      expect(result).not.toContain('nodes-base.webhook');
    });
    
    it('should handle langchain nodes', () => {
      const result = resolveTemplateNodeTypes(['nodes-langchain.agent']);
      
      expect(result).toContain('@n8n/n8n-nodes-langchain.agent');
      expect(result).not.toContain('nodes-langchain.agent');
    });
    
    it('should handle already correct formats', () => {
      const input = ['n8n-nodes-base.slack', '@n8n/n8n-nodes-langchain.agent'];
      const result = resolveTemplateNodeTypes(input);
      
      expect(result).toContain('n8n-nodes-base.slack');
      expect(result).toContain('@n8n/n8n-nodes-langchain.agent');
    });
    
    it('should handle Google services', () => {
      const result = resolveTemplateNodeTypes(['google']);
      
      expect(result).toContain('n8n-nodes-base.googleSheets');
      expect(result).toContain('n8n-nodes-base.googleDrive');
      expect(result).toContain('n8n-nodes-base.googleCalendar');
    });
    
    it('should handle database variations', () => {
      const result = resolveTemplateNodeTypes(['database']);
      
      expect(result).toContain('n8n-nodes-base.postgres');
      expect(result).toContain('n8n-nodes-base.mysql');
      expect(result).toContain('n8n-nodes-base.mongoDb');
      expect(result).toContain('n8n-nodes-base.postgresDatabase');
      expect(result).toContain('n8n-nodes-base.mysqlDatabase');
    });
    
    it('should handle AI/LLM variations', () => {
      const result = resolveTemplateNodeTypes(['ai']);
      
      expect(result).toContain('n8n-nodes-base.openAi');
      expect(result).toContain('@n8n/n8n-nodes-langchain.agent');
      expect(result).toContain('@n8n/n8n-nodes-langchain.lmChatOpenAi');
    });
    
    it('should handle email variations', () => {
      const result = resolveTemplateNodeTypes(['email']);
      
      expect(result).toContain('n8n-nodes-base.emailSend');
      expect(result).toContain('n8n-nodes-base.emailReadImap');
      expect(result).toContain('n8n-nodes-base.gmail');
      expect(result).toContain('n8n-nodes-base.gmailTrigger');
    });
    
    it('should handle schedule/cron variations', () => {
      const result = resolveTemplateNodeTypes(['schedule']);
      
      expect(result).toContain('n8n-nodes-base.scheduleTrigger');
      expect(result).toContain('n8n-nodes-base.cron');
    });
    
    it('should handle multiple inputs', () => {
      const result = resolveTemplateNodeTypes(['slack', 'webhook', 'http']);
      
      expect(result).toContain('n8n-nodes-base.slack');
      expect(result).toContain('n8n-nodes-base.slackTrigger');
      expect(result).toContain('n8n-nodes-base.webhook');
      expect(result).toContain('n8n-nodes-base.httpRequest');
    });
    
    it('should not duplicate entries', () => {
      const result = resolveTemplateNodeTypes(['slack', 'n8n-nodes-base.slack']);
      
      const slackCount = result.filter(r => r === 'n8n-nodes-base.slack').length;
      expect(slackCount).toBe(1);
    });
    
    it('should handle mixed case inputs', () => {
      const result = resolveTemplateNodeTypes(['Slack', 'WEBHOOK', 'HttpRequest']);
      
      expect(result).toContain('n8n-nodes-base.slack');
      expect(result).toContain('n8n-nodes-base.webhook');
      expect(result).toContain('n8n-nodes-base.httpRequest');
    });
    
    it('should handle common misspellings', () => {
      const result = resolveTemplateNodeTypes(['postgres', 'postgresql']);
      
      expect(result).toContain('n8n-nodes-base.postgres');
      expect(result).toContain('n8n-nodes-base.postgresDatabase');
    });
    
    it('should handle code/javascript/python variations', () => {
      const result = resolveTemplateNodeTypes(['javascript', 'python', 'js']);
      
      result.forEach(() => {
        expect(result).toContain('n8n-nodes-base.code');
      });
    });
    
    it('should resolve transform to native data-shaping nodes as well as code', () => {
      const result = resolveTemplateNodeTypes(['transform']);

      ['set', 'aggregate', 'summarize', 'splitOut', 'merge', 'code'].forEach(name => {
        expect(result).toContain(`n8n-nodes-base.${name}`);
      });
      // splitInBatches is a loop node, not a transform
      expect(result).not.toContain('n8n-nodes-base.splitInBatches');
    });

    it('should handle trigger suffix variations', () => {
      const result = resolveTemplateNodeTypes(['slacktrigger', 'gmailtrigger']);
      
      expect(result).toContain('n8n-nodes-base.slackTrigger');
      expect(result).toContain('n8n-nodes-base.gmailTrigger');
    });
    
    it('should handle sheet/sheets variations', () => {
      const result = resolveTemplateNodeTypes(['googlesheet', 'googlesheets']);
      
      result.forEach(() => {
        expect(result).toContain('n8n-nodes-base.googleSheets');
      });
    });
    
    it('should return empty array for empty input', () => {
      const result = resolveTemplateNodeTypes([]);
      
      expect(result).toEqual([]);
    });
  });
  
  describe('Edge cases', () => {
    it('should handle undefined-like strings gracefully', () => {
      const result = resolveTemplateNodeTypes(['undefined', 'null', '']);
      
      // Should process them as regular strings
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
    
    it('should handle very long node names', () => {
      const longName = 'a'.repeat(100);
      const result = resolveTemplateNodeTypes([longName]);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
    
    it('should handle special characters in node names', () => {
      const result = resolveTemplateNodeTypes(['node-with-dashes', 'node_with_underscores']);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
  
  describe('Real-world scenarios from AI agents', () => {
    it('should handle common AI agent queries', () => {
      // These are actual queries that AI agents commonly try
      const testCases = [
        { input: ['slack'], shouldContain: 'n8n-nodes-base.slack' },
        { input: ['webhook'], shouldContain: 'n8n-nodes-base.webhook' },
        { input: ['http'], shouldContain: 'n8n-nodes-base.httpRequest' },
        { input: ['email'], shouldContain: 'n8n-nodes-base.gmail' },
        { input: ['gpt'], shouldContain: 'n8n-nodes-base.openAi' },
        { input: ['chatgpt'], shouldContain: 'n8n-nodes-base.openAi' },
        { input: ['agent'], shouldContain: '@n8n/n8n-nodes-langchain.agent' },
        { input: ['sql'], shouldContain: 'n8n-nodes-base.postgres' },
        { input: ['api'], shouldContain: 'n8n-nodes-base.httpRequest' },
        { input: ['csv'], shouldContain: 'n8n-nodes-base.spreadsheetFile' },
      ];
      
      testCases.forEach(({ input, shouldContain }) => {
        const result = resolveTemplateNodeTypes(input);
        expect(result).toContain(shouldContain);
      });
    });
  });
});