#!/usr/bin/env npx tsx
/**
 * Direct telemetry test with hardcoded credentials
 */

import { createClient } from '@supabase/supabase-js';
import { TELEMETRY_BACKEND } from '../src/telemetry/telemetry-types';

// Resolved the same way the runtime does (telemetry-manager.ts), so this script
// always probes the credentials the package actually ships with.
const url = process.env.SUPABASE_URL || TELEMETRY_BACKEND.URL;
const key = process.env.SUPABASE_ANON_KEY || TELEMETRY_BACKEND.ANON_KEY;

async function testDirect() {
  console.log('🧪 Direct Telemetry Test\n');

  const supabase = createClient(url, key, {
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
