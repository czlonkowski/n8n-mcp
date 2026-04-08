#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const tempDir = path.join(process.cwd(), 'temp', 'n8n-docs');

console.log('🔍 Debugging Slack documentation search...\n');

// Search for all Slack related files.
//
// Use `execFileSync` with an argv array (not `execSync` with a single
// shell string) so `tempDir` — which comes from `process.cwd()` and is
// therefore attacker-influenceable if the script is invoked from a
// directory with shell metacharacters — cannot be interpreted as shell
// syntax. Addresses CodeQL js/shell-command-injection-from-environment.
console.log('All Slack-related markdown files:');
try {
  const allSlackFiles = execFileSync(
    'find',
    [
      path.join(tempDir, 'docs/integrations/builtin'),
      '-name', '*slack*.md',
      '-type', 'f',
    ],
    { encoding: 'utf-8' }
  ).trim().split('\n').filter(Boolean);

  allSlackFiles.forEach(file => {
    console.log(`  - ${file}`);
  });
} catch (error) {
  console.log('  No files found');
}

console.log('\n📄 Checking file paths:');
const possiblePaths = [
  'docs/integrations/builtin/app-nodes/n8n-nodes-base.Slack.md',
  'docs/integrations/builtin/app-nodes/n8n-nodes-base.slack.md',
  'docs/integrations/builtin/core-nodes/n8n-nodes-base.Slack.md',
  'docs/integrations/builtin/core-nodes/n8n-nodes-base.slack.md',
  'docs/integrations/builtin/trigger-nodes/n8n-nodes-base.Slack.md',
  'docs/integrations/builtin/trigger-nodes/n8n-nodes-base.slack.md',
  'docs/integrations/builtin/credentials/slack.md',
];

const fs = require('fs');
possiblePaths.forEach(p => {
  const fullPath = path.join(tempDir, p);
  const exists = fs.existsSync(fullPath);
  console.log(`  ${exists ? '✓' : '✗'} ${p}`);
  
  if (exists) {
    // Read first few lines
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n').slice(0, 10);
    const title = lines.find(l => l.includes('title:'));
    if (title) {
      console.log(`    Title: ${title.trim()}`);
    }
  }
});