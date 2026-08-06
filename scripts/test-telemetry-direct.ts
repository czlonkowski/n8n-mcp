#!/usr/bin/env npx tsx
/**
 * Direct telemetry test with hardcoded credentials
 */

import { createClient } from '@supabase/supabase-js';

const TELEMETRY_BACKEND = {
  URL: 'https://ydyufsohxdfpopqbubwk.supabase.co',
  ANON_KEY: 'sb_publishable_UbVUTyXgIyvemM9b15auQg_YzGa47Gq'
};

async function testDirect() {
  console.log('🧪 Direct Telemetry Test\n');

  const supabase = createClient(TELEMETRY_BACKEND.URL, TELEMETRY_BACKEND.ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });

  const testEvent = {
    user_id: 'direct-test-' + Date.now(),
    event: 'direct_test',
    properties: {
      source: 'test-telemetry-direct.ts',
      timestamp: new Date().toISOString()
    }
  };

  console.log('Sending event:', testEvent);

  const { data, error } = await supabase
    .from('telemetry_events')
    .insert([testEvent]);

  if (error) {
    console.error('❌ Failed:', error);
  } else {
    console.log('✅ Success! Event sent directly to Supabase');
    console.log('Response:', data);
  }
}

testDirect().catch(console.error);
