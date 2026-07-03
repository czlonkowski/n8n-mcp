# n8n Code Tool Skill

Expert guidance for writing code inside the n8n **Custom Code Tool** (`@n8n/n8n-nodes-langchain.toolCode`) — the AI-agent-callable tool, not the regular Code node.

---

## ⚠️ This is NOT the Code node

Same editor UI, completely different contract:

| | Code **node** | Code **Tool** |
|---|---|---|
| Node type | `n8n-nodes-base.code` | `@n8n/n8n-nodes-langchain.toolCode` |
| Invoked by | Previous node | AI Agent (LangChain) |
| Input | `$input.all()` | `query` variable |
| Return | `[{json: {...}}]` | **A string** |
| `$fromAI()` | N/A | **Not available** |
| `$helpers` | Via `this.helpers` (bare `$helpers` global is undefined) | Not exposed |

If you carry over Code-node habits, it fails with cryptic errors. This skill teaches the Code Tool's actual contract.

---

## What This Skill Teaches

### Core Concepts
1. **Return a string** — `JSON.stringify()` for structured output
2. **Input lives in `query`** (JS) or `_query` (Python)
3. **No `$fromAI()`** — doesn't exist in this sandbox
4. **Unstructured vs structured input** — when to add a JSON Schema
5. **Tool name and description** are the LLM-facing contract, not docs

### Top 5 Errors This Skill Prevents
1. `"Cannot assign to read only property 'name'..."` — `$fromAI()` misuse
2. `"Wrong output type returned"` — returning `[{json:{...}}]`
3. `"The response property should be a string, but it is an object"` — unstringified object
4. AI never calls the tool — generic name or vague description
5. LLM sends malformed `query` — no schema, no example

---

## Skill Activation

Activates when you:
- Build a Code Tool attached to an AI Agent
- Get `"Wrong output type returned"` or `"No execution data available"` errors
- Decide between unstructured `query` parsing and `specifyInputSchema`
- Wonder why `$fromAI()` or `$helpers.httpRequest()` don't work
- Choose between Code Tool, HTTP Request Tool, and `toolWorkflow`

**Example queries**:
- "Why is my Code Tool throwing 'Wrong output type returned'?"
- "How do I pass multiple parameters to a Code Tool?"
- "Does `$fromAI` work in `@n8n/n8n-nodes-langchain.toolCode`?"
- "What's the difference between Code Tool and the Code node?"
- "How do I use `specifyInputSchema` for structured tool input?"

---

## File Structure

### SKILL.md
Main skill content — loaded when the skill activates.
- Why Code Tool ≠ Code node (the cheat-sheet table)
- Quick-start JS and Python examples
- The two input modes: unstructured `query` vs structured schema
- Return-format rules
- Tool name and description as prompt engineering
- What's NOT in the sandbox (`$input`, `$helpers`, `$fromAI`, state)
- When to choose Code Tool vs `toolWorkflow` vs HTTP Request Tool
- Complete working example
- Quick-reference checklist

### INPUT_SCHEMA.md
Structured-input deep dive — `specifyInputSchema: true`.
- Why schemas help (`DynamicStructuredTool` vs `DynamicTool`)
- Style A: `fromJson` (infer schema from an example, v≥1.3)
- Style B: `manual` (write the JSON Schema yourself)
- How `query` behaves with vs without schema
- Version compatibility
- Decision tree: when to stay unstructured, go structured, or jump to `toolWorkflow`

### ERROR_PATTERNS.md
Full error catalog with exact strings, causes, and fixes.
- The three signature runtime errors
- AI-never-calls-tool diagnostic
- LLM-sends-malformed-query fixes
- Sandbox-missing-helper error
- Python-specific `query` vs `_query`
- Debugging tips

---

## Quick Reference

### Minimal JavaScript Code Tool
```javascript
return `You asked: ${query}`;
```

### Minimal Python Code Tool
```python
return f"You asked: {_query}"
```

### Return a structured result
```javascript
return JSON.stringify({
  result: 42,
  currency: "SEK"
});
```

### Parse a JSON-string input (unstructured mode)
```javascript
const params = typeof query === 'string' ? JSON.parse(query) : query;
const price = Number(params.price);
```

### Use a typed input (structured mode, `specifyInputSchema: true`)
```javascript
const { price, months, residual_percent } = query;
```

### Tool name rules
- `[A-Za-z0-9_]+` — snake_case, no spaces/hyphens/emoji
- Verb-y and domain-specific: `calculate_car_loan`, not `Code Tool`

---

## Integration with Other Skills

**n8n-code-javascript** (Code *node*): most JS patterns transfer, but **I/O is different** — don't copy `$input.all()` or `[{json:{...}}]` return.

**n8n-node-configuration**: `specifyInputSchema` is a typical conditional-field pattern — use `get_node({detail: "standard"})` on `toolCode` to explore.

**n8n-workflow-patterns**: Code Tool sits inside the AI-Agent-with-tools pattern. Usually alongside HTTP Request Tool, `toolWorkflow`, and memory.

**n8n-validation-expert**: the three signature errors have exact strings that map cleanly to fixes — if you see them in validation output, the fix is mechanical.

---

## When to Use Code Tool vs Alternatives

| Need | Use |
|---|---|
| Pure computation (math, parsing, formatting) | **Code Tool** |
| Multiple typed params with `$fromAI()` | **`toolWorkflow`** (sub-workflow tool) |
| Single API call | **HTTP Request Tool** |
| Access to `this.helpers`, credentials, other nodes | **`toolWorkflow`** |
| Persistent state across calls | **`toolWorkflow`** with Data Table / Redis |
| Reusable logic across multiple agents | **`toolWorkflow`** |

**Rule of thumb**: if you catch yourself reaching for `$fromAI()`, you want `toolWorkflow` instead.

---

## Success Metrics

After using this skill, you should be able to:

- [ ] Distinguish Code Tool from Code node by node type and contract
- [ ] Return a string (or `JSON.stringify()` result) — never a bare object or items array
- [ ] Read input from `query`/`_query` without reaching for `$fromAI`
- [ ] Decide between unstructured (JSON-in-string) and structured (`specifyInputSchema`) patterns
- [ ] Write tool names/descriptions that the LLM will actually invoke
- [ ] Diagnose the three signature errors by message alone
- [ ] Pick the right tool type (Code Tool vs `toolWorkflow` vs HTTP Request Tool)

---

## Sources

Authoritative facts in this skill come from:
- [ToolCode source](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/nodes-langchain/nodes/tools/ToolCode/ToolCode.node.ts) — sandbox contract, `query` binding, return handling
- [n8n Custom Code Tool docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolcode/)
- [LangChain tool docs](https://js.langchain.com/docs/modules/agents/tools/) — `DynamicTool` / `DynamicStructuredTool` semantics

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n with `@n8n/n8n-nodes-langchain.toolCode` v1.1+; structured `fromJson` requires v≥1.3.

---

## Credits

Part of the n8n-skills project.

**Remember**: Code Tool is a LangChain tool wearing a Code-node UI. Contract is **string in, string out**. Everything else follows from that.
