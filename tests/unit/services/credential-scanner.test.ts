import { describe, it, expect } from 'vitest';
import {
  scanWorkflow,
  maskSecret,
  SECRET_PATTERNS,
  PII_PATTERNS,
  type ScanDetection,
} from '@/services/credential-scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal workflow wrapper for single-node tests. */
function makeWorkflow(
  nodeParams: Record<string, unknown>,
  opts?: {
    nodeName?: string;
    nodeType?: string;
    workflowId?: string;
    workflowName?: string;
    pinData?: Record<string, unknown>;
    staticData?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  },
) {
  return {
    id: opts?.workflowId ?? 'wf-1',
    name: opts?.workflowName ?? 'Test Workflow',
    nodes: [
      {
        name: opts?.nodeName ?? 'HTTP Request',
        type: opts?.nodeType ?? 'n8n-nodes-base.httpRequest',
        parameters: nodeParams,
      },
    ],
    pinData: opts?.pinData,
    staticData: opts?.staticData,
    settings: opts?.settings,
  };
}

/** Helper that returns the first detection label, or null. */
function firstLabel(detections: ScanDetection[]): string | null {
  return detections.length > 0 ? detections[0].label : null;
}

// ===========================================================================
// Pattern matching — true positives
// ===========================================================================

describe('credential-scanner', () => {
  describe('pattern matching — true positives', () => {
    it('should detect OpenAI key (sk-proj- prefix)', () => {
      const wf = makeWorkflow({ apiKey: 'sk-proj-abc123def456ghi789jkl0' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('openai_key');
    });

    it('should detect OpenAI key (sk- prefix without proj)', () => {
      const wf = makeWorkflow({ apiKey: 'sk-abcdefghij1234567890abcdefghij' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('openai_key');
    });

    it('should detect AWS access key', () => {
      const wf = makeWorkflow({ accessKeyId: 'AKIA1234567890ABCDEF' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('aws_key');
    });

    it('should detect GitHub PAT (ghp_ prefix)', () => {
      const wf = makeWorkflow({ token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('github_pat');
    });

    it('should detect Stripe secret key', () => {
      const wf = makeWorkflow({ stripeKey: 'sk_live_1234567890abcdef12345' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('stripe_key');
    });

    it('should detect JWT token', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const wf = makeWorkflow({ token: jwt });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('jwt_token');
    });

    it('should detect Slack bot token', () => {
      const wf = makeWorkflow({ token: 'xoxb-1234567890-abcdefghij' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('slack_token');
    });

    it('should detect SendGrid API key', () => {
      const key =
        'SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789abcdefg';
      const wf = makeWorkflow({ apiKey: key });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('sendgrid_key');
    });

    it('should detect private key header', () => {
      const wf = makeWorkflow({
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...',
      });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('private_key');
    });

    it('should detect Bearer token', () => {
      const wf = makeWorkflow({
        header: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef',
      });
      const detections = scanWorkflow(wf);
      // Could match bearer_token or jwt_token; at minimum one detection exists
      const labels = detections.map((d) => d.label);
      expect(labels).toContain('bearer_token');
    });

    it('should detect URL with embedded credentials', () => {
      const wf = makeWorkflow({
        connectionString: 'postgres://admin:secret_password@db.example.com:5432/mydb',
      });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('url_with_auth');
    });

    it('should detect Anthropic key', () => {
      const wf = makeWorkflow({ apiKey: 'sk-ant-abcdefghijklmnopqrstuvwxyz1234' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('anthropic_key');
    });

    it('should detect GitHub OAuth token (gho_ prefix)', () => {
      const wf = makeWorkflow({ token: 'gho_1234567890abcdefghijklmnopqrstuvwxyz' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('github_oauth');
    });

    it('should detect Stripe restricted key (rk_live)', () => {
      const wf = makeWorkflow({ stripeKey: 'rk_live_1234567890abcdef12345' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('stripe_key');
    });
  });

  // ===========================================================================
  // PII patterns — true positives
  // ===========================================================================

  describe('PII pattern matching — true positives', () => {
    it('should detect email address', () => {
      const wf = makeWorkflow({ recipient: 'john.doe@example.com' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('email');
    });

    it('should detect credit card number with spaces', () => {
      const wf = makeWorkflow({ cardNumber: '4111 1111 1111 1111' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('credit_card');
    });

    it('should detect credit card number with dashes', () => {
      const wf = makeWorkflow({ cardNumber: '4111-1111-1111-1111' });
      const detections = scanWorkflow(wf);
      expect(firstLabel(detections)).toBe('credit_card');
    });
  });

  // ===========================================================================
  // True negatives — strings that should NOT be detected
  // ===========================================================================

  describe('true negatives', () => {
    it('should not flag a short string that looks like a key prefix', () => {
      const wf = makeWorkflow({ key: 'sk-abc' });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should not flag normal URLs without embedded auth', () => {
      const wf = makeWorkflow({ url: 'https://example.com/api/v1/path' });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should not flag a safe short string', () => {
      const wf = makeWorkflow({ value: 'hello world, this is a normal string' });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should not flag strings shorter than 9 characters', () => {
      // collectStrings skips strings with length <= 8
      const wf = makeWorkflow({ key: '12345678' });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Expression skipping
  // ===========================================================================

  describe('expression skipping', () => {
    it('should skip strings starting with = even if they contain a key pattern', () => {
      const wf = makeWorkflow({
        apiKey: '={{ $json.apiKey }}',
        header: '={{ "sk-proj-" + $json.secret123456789 }}',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should skip strings starting with {{ even if they contain a key pattern', () => {
      const wf = makeWorkflow({
        token: '{{ $json.token }}',
        auth: '{{ "Bearer " + $json.accessToken12345678 }}',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should skip mixed expression and literal if expression comes first', () => {
      const wf = makeWorkflow({
        mixed: '={{ "AKIA" + "1234567890ABCDEF" }}',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Field skipping
  // ===========================================================================

  describe('field skipping', () => {
    it('should not scan values under the credentials key', () => {
      const wf = makeWorkflow({
        credentials: {
          httpHeaderAuth: {
            id: 'cred-123',
            name: 'sk-proj-abc123def456ghi789jkl0',
          },
        },
        url: 'https://api.example.com',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should not scan values under the expression key', () => {
      const wf = makeWorkflow({
        expression: 'sk-proj-abc123def456ghi789jkl0',
        url: 'https://api.example.com',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });

    it('should not scan values under the id key', () => {
      const wf = makeWorkflow({
        id: 'AKIA1234567890ABCDEF',
        url: 'https://api.example.com',
      });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Depth limit
  // ===========================================================================

  describe('depth limit', () => {
    it('should stop traversing structures nested deeper than 10 levels', () => {
      // Build a nested structure 12 levels deep with a secret at the bottom
      let nested: Record<string, unknown> = {
        secret: 'sk-proj-abc123def456ghi789jkl0',
      };
      for (let i = 0; i < 12; i++) {
        nested = { level: nested };
      }

      const wf = makeWorkflow(nested);
      const detections = scanWorkflow(wf);
      // The secret is beyond depth 10, so it should not be found
      expect(detections).toHaveLength(0);
    });

    it('should detect secrets at exactly depth 10', () => {
      // Build a structure that puts the secret at depth 10 from the
      // parameters level. collectStrings is called with depth=0 for
      // node.parameters, so 10 nesting levels should still be traversed.
      let nested: Record<string, unknown> = {
        secret: 'sk-proj-abc123def456ghi789jkl0',
      };
      for (let i = 0; i < 9; i++) {
        nested = { level: nested };
      }

      const wf = makeWorkflow(nested);
      const detections = scanWorkflow(wf);
      expect(detections.length).toBeGreaterThanOrEqual(1);
      expect(firstLabel(detections)).toBe('openai_key');
    });
  });

  // ===========================================================================
  // maskSecret()
  // ===========================================================================

  describe('maskSecret()', () => {
    it('should mask a long value showing first 6 and last 4 characters', () => {
      const result = maskSecret('sk-proj-abc123def456ghi789jkl0');
      expect(result).toBe('sk-pro****jkl0');
    });

    it('should mask a 14-character value with head and tail', () => {
      // Exactly at boundary: 14 chars >= 14, so head+tail format
      const result = maskSecret('abcdefghijklmn');
      expect(result).toBe('abcdef****klmn');
    });

    it('should fully mask a value shorter than 14 characters', () => {
      expect(maskSecret('1234567890')).toBe('****');
      expect(maskSecret('short')).toBe('****');
      expect(maskSecret('a')).toBe('****');
      expect(maskSecret('abcdefghijk')).toBe('****'); // 11 chars
      expect(maskSecret('abcdefghijklm')).toBe('****'); // 13 chars
    });

    it('should handle empty string', () => {
      expect(maskSecret('')).toBe('****');
    });
  });

  // ===========================================================================
  // Full workflow scan — realistic workflow JSON
  // ===========================================================================

  describe('full workflow scan', () => {
    it('should detect a hardcoded key in a realistic HTTP Request node', () => {
      const workflow = {
        id: 'wf-42',
        name: 'Send Slack Message',
        nodes: [
          {
            name: 'Webhook Trigger',
            type: 'n8n-nodes-base.webhook',
            parameters: {
              path: '/incoming',
              method: 'POST',
            },
          },
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              url: 'https://api.openai.com/v1/chat/completions',
              method: 'POST',
              headers: {
                values: [
                  {
                    name: 'Authorization',
                    value: 'Bearer sk-proj-RealKeyThatShouldNotBeHere1234567890',
                  },
                ],
              },
              body: {
                json: {
                  model: 'gpt-4',
                  messages: [{ role: 'user', content: 'Hello' }],
                },
              },
            },
          },
          {
            name: 'Slack',
            type: 'n8n-nodes-base.slack',
            parameters: {
              channel: '#general',
              text: 'Response received',
            },
          },
        ],
      };

      const detections = scanWorkflow(workflow);
      expect(detections.length).toBeGreaterThanOrEqual(1);

      const openaiDetection = detections.find((d) => d.label === 'openai_key');
      expect(openaiDetection).toBeDefined();
      expect(openaiDetection!.location.workflowId).toBe('wf-42');
      expect(openaiDetection!.location.workflowName).toBe('Send Slack Message');
      expect(openaiDetection!.location.nodeName).toBe('HTTP Request');
      expect(openaiDetection!.location.nodeType).toBe('n8n-nodes-base.httpRequest');
      // maskedSnippet should not contain the full key
      expect(openaiDetection!.maskedSnippet).toContain('****');
    });

    it('should return empty detections for a clean workflow', () => {
      const workflow = {
        id: 'wf-clean',
        name: 'Clean Workflow',
        nodes: [
          {
            name: 'Manual Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            parameters: {},
          },
          {
            name: 'Set',
            type: 'n8n-nodes-base.set',
            parameters: {
              values: {
                string: [{ name: 'greeting', value: 'Hello World this is safe' }],
              },
            },
          },
        ],
      };

      const detections = scanWorkflow(workflow);
      expect(detections).toHaveLength(0);
    });
  });

  // ===========================================================================
  // pinData / staticData / settings scanning
  // ===========================================================================

  describe('pinData / staticData / settings scanning', () => {
    it('should detect secrets embedded in pinData', () => {
      const wf = makeWorkflow(
        { url: 'https://example.com' },
        {
          pinData: {
            'HTTP Request': [
              { json: { apiKey: 'sk-proj-abc123def456ghi789jkl0' } },
            ],
          },
        },
      );
      const detections = scanWorkflow(wf);
      const pinDetection = detections.find(
        (d) => d.label === 'openai_key' && d.location.nodeName === undefined,
      );
      expect(pinDetection).toBeDefined();
    });

    it('should detect secrets embedded in staticData', () => {
      const wf = makeWorkflow(
        { url: 'https://example.com' },
        {
          staticData: {
            lastProcessed: {
              token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
            },
          },
        },
      );
      const detections = scanWorkflow(wf);
      const staticDetection = detections.find(
        (d) => d.label === 'github_pat' && d.location.nodeName === undefined,
      );
      expect(staticDetection).toBeDefined();
    });

    it('should detect secrets in workflow settings', () => {
      const wf = makeWorkflow(
        { url: 'https://example.com' },
        {
          settings: {
            webhookSecret: 'sk_live_1234567890abcdef12345',
          },
        },
      );
      const detections = scanWorkflow(wf);
      const settingsDetection = detections.find(
        (d) => d.label === 'stripe_key' && d.location.nodeName === undefined,
      );
      expect(settingsDetection).toBeDefined();
    });

    it('should not flag pinData / staticData / settings when they are empty', () => {
      const wf = makeWorkflow(
        { url: 'https://example.com' },
        {
          pinData: {},
          staticData: {},
          settings: {},
        },
      );
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Detection metadata
  // ===========================================================================

  describe('detection metadata', () => {
    it('should include category and severity on each detection', () => {
      const wf = makeWorkflow({ key: 'AKIA1234567890ABCDEF' });
      const detections = scanWorkflow(wf);
      expect(detections).toHaveLength(1);
      expect(detections[0].category).toBe('Cloud/DevOps');
      expect(detections[0].severity).toBe('critical');
    });

    it('should set workflowId to empty string when id is missing', () => {
      const wf = {
        name: 'No ID Workflow',
        nodes: [
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: { key: 'AKIA1234567890ABCDEF' },
          },
        ],
      };
      const detections = scanWorkflow(wf);
      expect(detections[0].location.workflowId).toBe('');
    });
  });

  // ===========================================================================
  // Pattern completeness sanity check
  // ===========================================================================

  describe('pattern definitions', () => {
    it('should have at least 40 secret patterns defined', () => {
      expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(40);
    });

    it('should have PII patterns for email, phone, and credit card', () => {
      const labels = PII_PATTERNS.map((p) => p.label);
      expect(labels).toContain('email');
      expect(labels).toContain('phone');
      expect(labels).toContain('credit_card');
    });

    it('should have every pattern with a non-empty label and category', () => {
      for (const p of [...SECRET_PATTERNS, ...PII_PATTERNS]) {
        expect(p.label).toBeTruthy();
        expect(p.category).toBeTruthy();
        expect(['critical', 'high', 'medium']).toContain(p.severity);
      }
    });
  });
});
