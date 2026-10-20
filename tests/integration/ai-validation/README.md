# AI Validation Integration Tests

Comprehensive integration tests for AI workflow validation introduced in v2.17.0.

## Overview

These tests validate ALL AI validation operations against a REAL n8n instance. They verify:
- AI Agent validation rules
- Chat Trigger validation constraints
- Basic LLM Chain validation requirements
- AI Tool sub-node validation (HTTP Request, Code, Vector Store, Workflow, Calculator)
- End-to-end workflow validation
- Multi-error detection
- Node type normalization (bug fix validation)

## Test Files

### 1. `helpers.ts`
Utility functions for creating AI workflow components:
- `createAIAgentNode()` - AI Agent with configurable options
- `createChatTriggerNode()` - Chat Trigger with streaming modes
- `createBasicLLMChainNode()` - Basic LLM Chain
- `createLanguageModelNode()` - OpenAI/Anthropic models
- `createHTTPRequestToolNode()` - HTTP Request Tool
- `createCodeToolNode()` - Code Tool
- `createVectorStoreToolNode()` - Vector Store Tool
- `createWorkflowToolNode()` - Workflow Tool
- `createCalculatorToolNode()` - Calculator Tool
- `createMemoryNode()` - Buffer Window Memory
- `createRespondNode()` - Respond to Webhook
- `createAIConnection()` - AI connection helper (reversed for langchain)
- `createMainConnection()` - Standard n8n connection
- `mergeConnections()` - Merge multiple connection objects
- `createAIWorkflow()` - Complete workflow builder

### 2. `ai-agent-validation.test.ts` (7 tests)
Tests AI Agent validation:
- ✅ Detects missing language model (MISSING_LANGUAGE_MODEL error)
- ✅ Validates AI Agent with language model connected
- ✅ Detects tool connections correctly (no false warnings)
- ✅ Validates streaming mode constraints (Chat Trigger)
- ✅ Validates AI Agent own streamResponse setting
- ✅ Detects multiple memory connections (error)
- ✅ Validates complete AI workflow (all components)

### 3. `chat-trigger-validation.test.ts` (5 tests)
Tests Chat Trigger validation:
- ✅ Detects streaming to non-AI-Agent (STREAMING_WRONG_TARGET error)
- ✅ Detects missing connections (MISSING_CONNECTIONS error)
- ✅ Validates valid streaming setup
- ✅ Validates lastNode mode with AI Agent
- ✅ Detects streaming agent with output connection

### 4. `llm-chain-validation.test.ts` (6 tests)
Tests Basic LLM Chain validation:
- ✅ Detects missing language model (MISSING_LANGUAGE_MODEL error)
- ✅ Detects missing prompt text (MISSING_PROMPT_TEXT error)
- ✅ Validates complete LLM Chain
- ✅ Validates LLM Chain with memory
- ✅ Detects multiple language models (error - no fallback support)
- ✅ Detects tools connection (TOOLS_NOT_SUPPORTED error)

### 5. `ai-tool-validation.test.ts` (9 tests)
Tests AI Tool validation:

**HTTP Request Tool:**
- ✅ Detects missing toolDescription (MISSING_TOOL_DESCRIPTION)
- ✅ Detects missing URL (MISSING_URL)
- ✅ Validates valid HTTP Request Tool

**Code Tool:**
- ✅ Detects missing code (MISSING_CODE)
- ✅ Validates valid Code Tool

**Vector Store Tool:**
- ✅ Detects missing toolDescription
- ✅ Validates valid Vector Store Tool

**Workflow Tool:**
- ✅ Detects missing workflowId (MISSING_WORKFLOW_ID)
- ✅ Validates valid Workflow Tool

**Calculator Tool:**
- ✅ Validates Calculator Tool (no configuration needed)

### 6. `e2e-validation.test.ts` (5 tests)
End-to-end validation tests:
- ✅ Validates and creates complex AI workflow (7 nodes, all components)
- ✅ Detects multiple validation errors (5+ errors in one workflow)
- ✅ Validates streaming workflow without main output
- ✅ Validates non-streaming workflow with main output
- ✅ Tests node type normalization (v2.17.0 bug fix validation)

## Running Tests

### Run All AI Validation Tests
```bash
npm test -- tests/integration/ai-validation --run
```

### Run Specific Test Suite
```bash
npm test -- tests/integration/ai-validation/ai-agent-validation.test.ts --run
npm test -- tests/integration/ai-validation/chat-trigger-validation.test.ts --run
npm test -- tests/integration/ai-validation/llm-chain-validation.test.ts --run
npm test -- tests/integration/ai-validation/ai-tool-validation.test.ts --run
npm test -- tests/integration/ai-validation/e2e-validation.test.ts --run
```

### Prerequisites

1. **n8n Instance**: Real n8n instance required (not mocked)
2. **Environment Variables**:
   ```env
   N8N_API_URL=http://localhost:5678
   N8N_API_KEY=your-api-key
   TEST_CLEANUP=true  # Auto-cleanup test workflows (default: true)
   ```
3. **Build**: Run `npm run build` before testing

## Test Infrastructure

### Cleanup
- All tests use `TestContext` for automatic workflow cleanup
- Workflows are tagged with `mcp-integration-test` and `ai-validation`
- Cleanup runs in `afterEach` hooks
- Orphaned workflow cleanup runs once before the integration suite via a Vitest `globalSetup` (non-CI only, `npm run test:integration` / `test:integration:n8n`), not per-file and not on a plain `npm test`, to avoid deleting in-flight workflows from other test files running in parallel

### Workflow Naming
- All test workflows use timestamps: `[MCP-TEST] Description 1696723200000`
- Prevents name collisions
- Easy identification in n8n UI

### Connection Patterns
- **Main connections**: Standard n8n flow (A → B)
- **AI connections**: Reversed flow (Language Model → AI Agent)
- Uses helper functions to ensure correct connection structure

## Key Validation Checks

### AI Agent
- Language model connections (1 or 2 for fallback)
- Output parser configuration
- Prompt type validation (auto vs define)
- System message recommendations
- Streaming mode constraints (CRITICAL)
- Memory connections (0-1 max)
- Tool connections
- maxIterations validation

### Chat Trigger
- responseMode validation (streaming vs lastNode)
- Streaming requires AI Agent target
- AI Agent in streaming mode: NO main output allowed

### Basic LLM Chain
- Exactly 1 language model (no fallback)
- Memory connections (0-1 max)
- No tools support (error if connected)
- Prompt configuration validation

### AI Tools
- HTTP Request Tool: requires toolDescription + URL
- Code Tool: requires jsCode
- Vector Store Tool: requires toolDescription + vector store connection
- Workflow Tool: requires workflowId
- Calculator Tool: no configuration required

## Validation Error Codes

Tests verify these error codes are correctly detected:

- `MISSING_LANGUAGE_MODEL` - No language model connected
- `MISSING_TOOL_DESCRIPTION` - Tool missing description
- `MISSING_URL` - HTTP tool missing URL
- `MISSING_CODE` - Code tool missing code
- `MISSING_WORKFLOW_ID` - Workflow tool missing ID
- `MISSING_PROMPT_TEXT` - Prompt type=define but no text
- `MISSING_CONNECTIONS` - Chat Trigger has no output
- `STREAMING_WITH_MAIN_OUTPUT` - AI Agent in streaming mode with main output
- `STREAMING_WRONG_TARGET` - Chat Trigger streaming to non-AI-Agent
- `STREAMING_AGENT_HAS_OUTPUT` - Streaming agent has output connection
- `MULTIPLE_LANGUAGE_MODELS` - LLM Chain with multiple models
- `MULTIPLE_MEMORY_CONNECTIONS` - Multiple memory connected
- `TOOLS_NOT_SUPPORTED` - Basic LLM Chain with tools
- `TOO_MANY_LANGUAGE_MODELS` - AI Agent with 3+ models
- `FALLBACK_MISSING_SECOND_MODEL` - needsFallback=true but 1 model
- `MULTIPLE_OUTPUT_PARSERS` - Multiple output parsers

## Bug Fix Validation

### v2.17.0 Node Type Normalization
Test 5 in `e2e-validation.test.ts` validates the fix for node type normalization:
- Creates AI Agent + OpenAI Model + HTTP Request Tool
- Connects tool via ai_tool connection
- Verifies NO false "no tools connected" warning
- Validates workflow is valid

This test would have caught the bug where:
```typescript
// BUG: Incorrect comparison
sourceNode.type === 'nodes-langchain.chatTrigger'  // ❌ Never matches

// FIX: Use normalizer
NodeTypeNormalizer.normalizeToFullForm(sourceNode.type) === 'nodes-langchain.chatTrigger'  // ✅ Works
```

## Success Criteria

All tests should:
- ✅ Create workflows in real n8n
- ✅ Validate using actual MCP tools (handleValidateWorkflow)
- ✅ Verify validation results match expected outcomes
- ✅ Clean up after themselves (no orphaned workflows)
- ✅ Run in under 30 seconds each
- ✅ Be deterministic (no flakiness)

## Test Coverage

Total: **32 tests** covering:
- **7 AI Agent tests** - Complete AI Agent validation logic
- **5 Chat Trigger tests** - Streaming mode and connection validation
- **6 Basic LLM Chain tests** - LLM Chain constraints and requirements
- **9 AI Tool tests** - All AI tool sub-node types
- **5 E2E tests** - Complex workflows and multi-error detection

## Coverage Summary

### Validation Features Tested
- ✅ Language model connections (required, fallback)
- ✅ Output parser configuration
- ✅ Prompt type validation
- ✅ System message checks
- ✅ Streaming mode constraints
- ✅ Memory connections (single)
- ✅ Tool connections
- ✅ maxIterations validation
- ✅ Chat Trigger modes (streaming, lastNode)
- ✅ Tool description requirements
- ✅ Tool-specific parameters (URL, code, workflowId)
- ✅ Multi-error detection
- ✅ Node type normalization
- ✅ Connection validation (missing, invalid)

### Edge Cases Tested
- ✅ Empty/missing required fields
- ✅ Invalid configurations
- ✅ Multiple connections (when not allowed)
- ✅ Streaming with main output (forbidden)
- ✅ Tool connections to non-agent nodes
- ✅ Fallback model configuration
- ✅ Complex workflows with all components

## Recommendations

### Additional Tests (Future)
1. **Performance tests** - Validate large AI workflows (20+ nodes)
2. **Credential validation** - Test with invalid/missing credentials
3. **Expression validation** - Test n8n expressions in AI node parameters
4. **Cross-version tests** - Test different node typeVersions
5. **Concurrent validation** - Test multiple workflows in parallel

### Test Maintenance
- Update tests when new AI nodes are added
- Add tests for new validation rules
- Keep helpers.ts updated with new node types
- Verify error codes match specification

## Notes

- Tests create real workflows in n8n (not mocked)
- Each test is independent (no shared state)
- Workflows are automatically cleaned up
- Tests use actual MCP validation handlers
- All AI connection types are tested
- Streaming mode validation is comprehensive
- Node type normalization is validated
