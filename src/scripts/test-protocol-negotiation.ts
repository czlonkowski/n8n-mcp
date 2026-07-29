#!/usr/bin/env node
/**
 * Test Protocol Version Negotiation
 * 
 * This script tests the protocol version negotiation logic with different client scenarios.
 */

import {
  negotiateProtocolVersion,
  isN8nClient,
  STANDARD_PROTOCOL_VERSION,
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  N8N_PROTOCOL_VERSION
} from '../utils/protocol-version';

interface TestCase {
  name: string;
  clientVersion?: string;  
  clientInfo?: any;
  userAgent?: string;
  headers?: Record<string, string>;
  expectedVersion: string;
  expectedIsN8nClient: boolean;
}

const testCases: TestCase[] = [
  {
    name: 'Standard MCP client requesting latest revision',
    clientVersion: '2025-11-25',
    clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
    expectedVersion: '2025-11-25',
    expectedIsN8nClient: false
  },
  {
    name: 'Standard MCP client requesting 2025-06-18',
    clientVersion: '2025-06-18',
    clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
    expectedVersion: '2025-06-18',
    expectedIsN8nClient: false
  },
  {
    name: 'Standard MCP client requesting 2025-03-26',
    clientVersion: '2025-03-26',
    clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
    expectedVersion: '2025-03-26',
    expectedIsN8nClient: false
  },
  {
    name: 'n8n client with specific client info',
    clientVersion: '2025-03-26',
    clientInfo: { name: 'n8n', version: '1.0.0' },
    expectedVersion: N8N_PROTOCOL_VERSION,
    expectedIsN8nClient: true
  },
  {
    name: 'LangChain client',
    clientVersion: '2025-03-26',
    clientInfo: { name: 'langchain-js', version: '0.1.0' },
    expectedVersion: N8N_PROTOCOL_VERSION,
    expectedIsN8nClient: true
  },
  {
    name: 'n8n client via user agent',
    clientVersion: '2025-03-26',
    userAgent: 'n8n/1.0.0',
    expectedVersion: N8N_PROTOCOL_VERSION,
    expectedIsN8nClient: true
  },
  {
    name: 'n8n mode environment variable',
    clientVersion: '2025-03-26',
    expectedVersion: N8N_PROTOCOL_VERSION,
    expectedIsN8nClient: true
  },
  {
    name: 'Client requesting oldest supported version',
    clientVersion: '2024-10-07',
    clientInfo: { name: 'Some Client', version: '1.0.0' },
    expectedVersion: '2024-10-07',
    expectedIsN8nClient: false
  },
  {
    name: 'Client requesting retired version (2024-06-25 was never an MCP revision)',
    clientVersion: '2024-06-25',
    clientInfo: { name: 'Some Client', version: '1.0.0' },
    expectedVersion: STANDARD_PROTOCOL_VERSION,
    expectedIsN8nClient: false
  },
  {
    name: 'Client requesting unsupported version',
    clientVersion: '2020-01-01',
    clientInfo: { name: 'Old Client', version: '1.0.0' },
    expectedVersion: STANDARD_PROTOCOL_VERSION,
    expectedIsN8nClient: false
  },
  {
    name: 'No client info provided',
    expectedVersion: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
    expectedIsN8nClient: false
  },
  {
    name: 'n8n headers detection',
    clientVersion: '2025-03-26',
    headers: { 'x-n8n-version': '1.0.0' },
    expectedVersion: N8N_PROTOCOL_VERSION,
    expectedIsN8nClient: true
  }
];

async function runTests(): Promise<void> {
  console.log('🧪 Testing Protocol Version Negotiation\n');
  
  let passed = 0;
  let failed = 0;
  
  // Set N8N_MODE for the environment variable test
  const originalN8nMode = process.env.N8N_MODE;
  
  for (const testCase of testCases) {
    try {
      // Set N8N_MODE for specific test
      if (testCase.name.includes('environment variable')) {
        process.env.N8N_MODE = 'true';
      } else {
        delete process.env.N8N_MODE;
      }
      
      // Test isN8nClient function
      const detectedAsN8n = isN8nClient(testCase.clientInfo, testCase.userAgent, testCase.headers);
      
      // Test negotiateProtocolVersion function
      const result = negotiateProtocolVersion(
        testCase.clientVersion,
        testCase.clientInfo,
        testCase.userAgent,
        testCase.headers
      );
      
      // Check results
      const versionCorrect = result.version === testCase.expectedVersion;
      const n8nDetectionCorrect = result.isN8nClient === testCase.expectedIsN8nClient;
      const isN8nFunctionCorrect = detectedAsN8n === testCase.expectedIsN8nClient;
      
      if (versionCorrect && n8nDetectionCorrect && isN8nFunctionCorrect) {
        console.log(`✅ ${testCase.name}`);
        console.log(`   Version: ${result.version}, n8n client: ${result.isN8nClient}`);
        console.log(`   Reasoning: ${result.reasoning}\n`);
        passed++;
      } else {
        console.log(`❌ ${testCase.name}`);
        console.log(`   Expected: version=${testCase.expectedVersion}, isN8n=${testCase.expectedIsN8nClient}`);
        console.log(`   Got: version=${result.version}, isN8n=${result.isN8nClient}`);
        console.log(`   isN8nClient function: ${detectedAsN8n} (expected: ${testCase.expectedIsN8nClient})`);
        console.log(`   Reasoning: ${result.reasoning}\n`);
        failed++;
      }
      
    } catch (error) {
      console.log(`💥 ${testCase.name} - ERROR`);
      console.log(`   ${error instanceof Error ? error.message : String(error)}\n`);
      failed++;
    }
  }
  
  // Restore original N8N_MODE
  if (originalN8nMode) {
    process.env.N8N_MODE = originalN8nMode;
  } else {
    delete process.env.N8N_MODE;
  }
  
  // Summary
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   Total: ${passed + failed}`);
  
  if (failed > 0) {
    console.log(`\n❌ Some tests failed!`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All tests passed!`);
  }
}

// Additional integration test
async function testIntegration(): Promise<void> {
  console.log('\n🔧 Integration Test - MCP Server Protocol Negotiation\n');
  
  // This would normally test the actual MCP server, but we'll just verify
  // the negotiation logic works in typical scenarios
  
  const scenarios = [
    {
      name: 'Claude Desktop connecting',
      clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
      clientVersion: '2025-11-25'
    },
    {
      name: 'n8n connecting via HTTP',
      headers: { 'user-agent': 'n8n/1.52.0' },
      clientVersion: '2025-11-25'
    }
  ];
  
  for (const scenario of scenarios) {
    const result = negotiateProtocolVersion(
      scenario.clientVersion,
      scenario.clientInfo,
      scenario.headers?.['user-agent'],
      scenario.headers
    );
    
    console.log(`🔍 ${scenario.name}:`);
    console.log(`   Negotiated version: ${result.version}`);
    console.log(`   Is n8n client: ${result.isN8nClient}`);
    console.log(`   Reasoning: ${result.reasoning}\n`);
  }
}

if (require.main === module) {
  runTests()
    .then(() => testIntegration())
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}