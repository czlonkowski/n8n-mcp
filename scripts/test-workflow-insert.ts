#!/usr/bin/env npx tsx
/**
 * Test direct workflow insert to Supabase
 */

import { createClient } from '@supabase/supabase-js';
import { TELEMETRY_BACKEND } from '../src/telemetry/telemetry-types';

// Resolved the same way the runtime does (telemetry-manager.ts), so this script
// always probes the credentials the package actually ships with.
const url = process.env.SUPABASE_URL || TELEMETRY_BACKEND.URL;
const key = process.env.SUPABASE_ANON_KEY || TELEMETRY_BACKEND.ANON_KEY;

async function testWorkflowInsert() {
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });

  const testWorkflow = {
    user_id: 'direct-test-' + Date.now(),
    workflow_hash: 'hash-direct-' + Date.now(),
    node_count: 2,
    node_types: ['webhook', 'http'],
    has_trigger: true,
    has_webhook: true,
    complexity: 'simple' as const,
    sanitized_workflow: {
      nodes: [
        { id: '1', type: 'webhook', parameters: {} },
        { id: '2', type: 'http', parameters: {} }
      ],
      connections: {}
    }
  };

  console.log('Attempting direct insert to telemetry_workflows...');
  console.log('Data:', JSON.stringify(testWorkflow, null, 2));

  const { data, error } = await supabase
    .from('telemetry_workflows')
    .insert([testWorkflow]);

  if (error) {
    console.error('\n❌ Error:', error);
  } else {
    console.log('\n✅ Success! Workflow inserted');
    if (data) {
      console.log('Response:', data);
    }
  }
}

testWorkflowInsert().catch(console.error);