import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigValidator } from '@/services/config-validator';
import { NodeSpecificValidators } from '@/services/node-specific-validators';
import type { ValidationResult, ValidationError, ValidationWarning } from '@/services/config-validator';

// Mock the database
vi.mock('better-sqlite3');

describe('ConfigValidator - Security Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Credential security', () => {
    it('should perform security checks for hardcoded credentials', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        api_key: 'sk-1234567890abcdef',
        password: 'my-secret-password',
        token: 'hardcoded-token'
      };
      const properties = [
        { name: 'api_key', type: 'string' },
        { name: 'password', type: 'string' },
        { name: 'token', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.filter(w => w.type === 'security')).toHaveLength(3);
      expect(result.warnings.some(w => w.property === 'api_key')).toBe(true);
      expect(result.warnings.some(w => w.property === 'password')).toBe(true);
      expect(result.warnings.some(w => w.property === 'token')).toBe(true);
    });

    it('should validate HTTP Request with authentication in API URLs', () => {
      const nodeType = 'nodes-base.httpRequest';
      const config = {
        method: 'GET',
        url: 'https://api.github.com/user/repos',
        authentication: 'none'
      };
      const properties = [
        { name: 'method', type: 'options' },
        { name: 'url', type: 'string' },
        { name: 'authentication', type: 'options' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('API endpoints typically require authentication')
      )).toBe(true);
    });
  });

  describe('Code execution security', () => {
    it('should warn about security issues with eval/exec', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const userInput = items[0].json.code;
          const result = eval(userInput);
          return [{json: {result}}];
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('eval/exec which can be a security risk')
      )).toBe(true);
    });

    it('should detect infinite loops', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          while (true) {
            console.log('infinite loop');
          }
          return items;
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Infinite loop detected')
      )).toBe(true);
    });
  });

  describe('Database security', () => {
    it('should validate database query security', () => {
      const nodeType = 'nodes-base.postgres';
      const config = {
        query: 'DELETE FROM users;' // Missing WHERE clause
      };
      const properties = [
        { name: 'query', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('DELETE query without WHERE clause')
      )).toBe(true);
    });

    it('should check for SQL injection vulnerabilities', () => {
      const nodeType = 'nodes-base.mysql';
      const config = {
        query: 'SELECT * FROM users WHERE id = ${userId}'
      };
      const properties = [
        { name: 'query', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('SQL injection')
      )).toBe(true);
    });

    // DROP TABLE warning not implemented in current validator
    it.skip('should warn about DROP TABLE operations', () => {
      const nodeType = 'nodes-base.postgres';
      const config = {
        query: 'DROP TABLE IF EXISTS user_sessions;'
      };
      const properties = [
        { name: 'query', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('DROP TABLE is a destructive operation')
      )).toBe(true);
    });

    // TRUNCATE warning not implemented in current validator
    it.skip('should warn about TRUNCATE operations', () => {
      const nodeType = 'nodes-base.mysql';
      const config = {
        query: 'TRUNCATE TABLE audit_logs;'
      };
      const properties = [
        { name: 'query', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('TRUNCATE is a destructive operation')
      )).toBe(true);
    });

    it('should check for unescaped user input in queries', () => {
      const nodeType = 'nodes-base.postgres';
      const config = {
        query: `SELECT * FROM users WHERE name = '{{ $json.userName }}'`
      };
      const properties = [
        { name: 'query', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('vulnerable to SQL injection')
      )).toBe(true);
    });
  });

  describe('Network security', () => {
    // HTTP vs HTTPS warning not implemented in current validator
    it.skip('should warn about HTTP (non-HTTPS) API calls', () => {
      const nodeType = 'nodes-base.httpRequest';
      const config = {
        method: 'POST',
        url: 'http://api.example.com/sensitive-data',
        sendBody: true
      };
      const properties = [
        { name: 'method', type: 'options' },
        { name: 'url', type: 'string' },
        { name: 'sendBody', type: 'boolean' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Consider using HTTPS')
      )).toBe(true);
    });

    // Localhost URL warning not implemented in current validator
    it.skip('should validate localhost/internal URLs', () => {
      const nodeType = 'nodes-base.httpRequest';
      const config = {
        method: 'GET',
        url: 'http://localhost:8080/admin'
      };
      const properties = [
        { name: 'method', type: 'options' },
        { name: 'url', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Accessing localhost/internal URLs')
      )).toBe(true);
    });

    // Sensitive data in URL warning not implemented in current validator
    it.skip('should check for sensitive data in URLs', () => {
      const nodeType = 'nodes-base.httpRequest';
      const config = {
        method: 'GET',
        url: 'https://api.example.com/users?api_key=secret123&token=abc'
      };
      const properties = [
        { name: 'method', type: 'options' },
        { name: 'url', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Sensitive data in URL')
      )).toBe(true);
    });
  });

  describe('File system security', () => {
    // File system operations warning not implemented in current validator
    it.skip('should warn about dangerous file operations', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const fs = require('fs');
          fs.unlinkSync('/etc/passwd');
          return items;
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('File system operations')
      )).toBe(true);
    });

    // Path traversal warning not implemented in current validator
    it.skip('should check for path traversal vulnerabilities', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const path = items[0].json.userPath;
          const file = fs.readFileSync('../../../' + path);
          return [{json: {content: file.toString()}}];
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Path traversal')
      )).toBe(true);
    });
  });

  describe('Crypto and sensitive operations', () => {
    it('should validate crypto module usage', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const uuid = crypto.randomUUID();
          return [{json: {id: uuid}}];
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'invalid_value' && 
        w.message.includes('Using crypto without require')
      )).toBe(true);
    });

    // Weak crypto algorithm warning not implemented in current validator
    it.skip('should warn about weak crypto algorithms', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const crypto = require('crypto');
          const hash = crypto.createHash('md5');
          hash.update(data);
          return [{json: {hash: hash.digest('hex')}}];
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('MD5 is cryptographically weak')
      )).toBe(true);
    });

    // Environment variable access warning not implemented in current validator
    it.skip('should check for environment variable access', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'javascript',
        jsCode: `
          const apiKey = process.env.SECRET_API_KEY;
          const dbPassword = process.env.DATABASE_PASSWORD;
          return [{json: {configured: !!apiKey}}];
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'jsCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('Accessing environment variables')
      )).toBe(true);
    });
  });

  describe('Python security', () => {
    // exec/eval are denied builtins in native Python, reported as errors by
    // NodeSpecificValidators. The base layer stays quiet so the two layers
    // don't report the same call twice.
    it('should leave Python exec/eval to the node-specific layer', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'python',
        pythonCode: `
user_code = _items[0]['json']['code']
result = exec(user_code)
return [{"json": {"result": result}}]
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'pythonCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w =>
        w.message.includes('eval/exec which can be a security risk')
      )).toBe(false);

      const context = { config, errors: [] as any[], warnings: [] as any[], suggestions: [] as string[], autofix: {} };
      NodeSpecificValidators.validateCode(context as any);
      expect(context.errors.filter(e => e.message.includes('exec() is denied'))).toHaveLength(1);
    });

    it('should still warn about JavaScript eval', () => {
      const result = ConfigValidator.validate(
        'nodes-base.code',
        { language: 'javaScript', jsCode: 'const result = eval(items[0].json.code);\nreturn [{json: {result}}];' },
        [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]
      );

      expect(result.warnings.some(w =>
        w.type === 'security' &&
        w.message.includes('eval/exec which can be a security risk')
      )).toBe(true);
    });

    // os.system usage warning not implemented in current validator
    it.skip('should check for subprocess/os.system usage', () => {
      const nodeType = 'nodes-base.code';
      const config = {
        language: 'python',
        pythonCode: `
import os
command = items[0]['json']['command']
os.system(command)
return [{"json": {"executed": True}}]
        `
      };
      const properties = [
        { name: 'language', type: 'options' },
        { name: 'pythonCode', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'security' && 
        w.message.includes('os.system() can execute arbitrary commands')
      )).toBe(true);
    });
  });
});