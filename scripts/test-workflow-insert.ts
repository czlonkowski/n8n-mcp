#!/usr/bin/env npx tsx
/**
 * Test direct workflow insert to Supabase
 */

import { createClient } from '@supabase/supabase-js';

const TELEMETRY_BACKEND = {
  URL: 'https://ydyufsohxdfpopqbubwk.supabase.co',
  ANON_KEY: 'sb_publishable_UbVUTyXgIyvemM9b15auQg_YzGa47Gq'
};

async function testWorkflowInsert() {
  const supabase = createClient(TELEMETRY_BACKEND.URL, TELEMETRY_BACKEND.ANON_KEY, {
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