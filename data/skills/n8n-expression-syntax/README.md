# n8n Expression Syntax

Expert guide for writing correct n8n expressions in workflows.

---

## Purpose

Teaches correct n8n expression syntax ({{ }} patterns) and fixes common mistakes, especially the critical webhook data structure gotcha.

## Activates On

- expression
- {{}} syntax
- $json, $node, $now, $env
- webhook data
- troubleshoot expression error
- undefined in workflow

## File Count

4 files

## Dependencies

**n8n-mcp tools**:
- None directly (syntax knowledge skill)
- Works with n8n-mcp validation tools

**Related skills**:
- n8n Workflow Patterns (uses expressions in examples)
- n8n MCP Tools Expert (validates expressions)
- n8n Node Configuration (when expressions are needed)

## Coverage

### Core Topics
- Expression format ({{ }})
- Core variables ($json, $node, $now, $env)
- **Webhook data structure** ($json.body.*)
- When NOT to use expressions (Code nodes)
- `$jmespath(object, query)` — querying nested JSON in one expression, with the quoting rules that fail silently
- Runtime errors inside `{{ }}` resolve to `null` (node still succeeds) — how to surface them

### Common Patterns
- Accessing nested fields
- Referencing other nodes
- Array and object access
- Date/time formatting
- String manipulation

### Error Prevention
- 17 common mistakes with fixes (incl. JMESPath quoting and the silent-null runtime error)
- Quick reference table
- Debugging process

## Evaluations

6 scenarios (100% coverage expected):
1. **eval-001**: Missing curly braces
2. **eval-002**: Webhook body data access (critical!)
3. **eval-003**: Code node vs expression confusion
4. **eval-004**: Node reference syntax
5. **eval-005**: `$jmespath` quoting (double-quoted string, bare number)
6. **eval-006**: Filter drops everything on a green run (silent null)

## Key Features

✅ **Critical Gotcha Highlighted**: Webhook data under `.body`
✅ **Real Examples**: From MCP testing and real templates
✅ **Quick Fixes Table**: Fast reference for common errors
✅ **Code vs Expression**: Clear distinction
✅ **Comprehensive**: Covers 95% of expression use cases

## Files

- **SKILL.md** - Main content with all essential knowledge
- **COMMON_MISTAKES.md** - Complete error catalog with 15 common mistakes
- **EXAMPLES.md** - 10 real working examples
- **README.md** (this file) - Skill metadata

## Success Metrics

**Expected outcomes**:
- Users correctly wrap expressions in {{ }}
- Zero webhook `.body` access errors
- No expressions used in Code nodes
- Correct $node reference syntax

## Last Updated

2025-10-20

---

**Part of**: n8n-skills repository
**Conceived by**: Romuald Członkowski - [aiadvisors.pl/en](https://aiadvisors.pl/en)
