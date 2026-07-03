# n8n Binary and Data Skill

Expert guidance for handling files and binary data in n8n — the `$binary` vs `$json` split, reading and writing bytes, keeping binary alive across transforms, the AI-agent tool boundary, and the CDN/URL requirement for chat surfaces.

---

## ⚠️ File contents live in `$binary`, not `$json`

Every n8n item has two independent slots that flow side by side:

| | `$json` | `$binary` |
|---|---|---|
| Holds | Structured data (numbers, strings, objects) | File bytes (base64) plus metadata |
| Shape | `{ customerId: 42 }` | `{ data, mimeType, fileName, fileExtension }` |
| Read in Code | `$json.field` | `this.helpers.getBinaryDataBuffer(i, 'data')` |
| Crosses an agent tool | Yes (JSON args/returns) | **No** — pass a key/URL instead |
| Renders in a chat surface | n/a | **No** — needs a URL, not raw bytes |

Reading `$json.data` for a downloaded PDF gives you nothing — the bytes are in `$binary.data`. This skill teaches the actual contract for files.

---

## What This Skill Teaches

### Core Concepts
1. **Two slots per item** — `$json` for data, `$binary` for files; they never mix
2. **Read bytes via `getBinaryDataBuffer`**, write by building the slot (base64 + mimeType + fileName)
3. **Binary is silently stripped** by JSON-only transforms — pass it through or Merge it back
4. **The agent-tool boundary is JSON only** — pre-stage to storage, pass keys/URLs
5. **Chat surfaces render by URL** — upload to storage/CDN first

### Top issues this skill prevents
1. Reading file contents from `$json` and getting empty data
2. HTTP download without `responseFormat: "file"` → mangled text instead of bytes
3. A Code node dropping the binary slot by not re-attaching it on return
4. Binary disappearing after an Edit Fields / IF / Code transform
5. An AI agent tool that receives nothing when handed an uploaded file
6. A generated image that "doesn't display" in Slack/Discord/Teams

---

## Skill Activation

Activates when you:
- Work with files, images, PDFs, attachments, uploads, or downloads
- Mention `$binary`, `binaryPropertyName`, base64, or "read the PDF"
- Need an AI agent to take a file as tool input or return a generated file
- Hit Merge losing the binary slot, or vision/multimodal input
- Ask why a chat-posted image isn't showing, or about a CDN for chat images

**Example queries**:
- "I downloaded a PDF but `$json.data` is empty — where's the file?"
- "How do I attach a file generated in a Code node to an email?"
- "My agent can't pass the uploaded image to its tool."
- "The workflow generates an image but it never shows up in Slack."
- "Why did the binary disappear after my Edit Fields node?"

---

## File Structure

### SKILL.md
Main skill content — loaded when the skill activates.
- The three rules (read from `$binary`; agent tools are JSON-only; chat needs a URL)
- The two-slot anatomy and `binaryPropertyName`
- Producing binary (HTTP `responseFormat: "file"`, Read Files, downloads)
- Reading/writing binary in a Code node
- Keeping binary alive across transforms (pass-through, Merge by position)
- The agent-tool binary boundary, inbound and outbound
- The CDN requirement for chat surfaces
- What's NOT available, anti-patterns table, verification, checklist

### BINARY_BASICS.md
The `$binary` slot in depth.
- Full slot shape and the property-name convention
- Which nodes produce and consume binary
- `getBinaryDataBuffer` read and base64 write recipes
- Mime types (table + magic-byte sniffing)
- File-size limits and when to offload to external storage
- Inspecting the binary slot in an execution

### AGENT_TOOL_BINARY.md
The JSON-only boundary between an AI Agent and its tools.
- Inbound: uploads → pre-stage → inject keys → tool fetches by key
- The Merge synchronization barrier and `executeOnce: true`
- What the system prompt and the tool argument look like
- Outbound: generate → upload → return `{ key, url }`
- `passthroughBinaryImages` (vision only, image only)
- Storage choice, hash strategy, cleanup, long-running tools

### MERGE_FOR_CONTEXT.md
Re-attaching binary after a JSON transform strips it.
- The fan-out + Merge-by-position pattern with wiring
- Configuring `combineByPosition`
- Pass-through alternatives on the transforming node
- When to switch to upload-early or a sub-workflow instead
- Verifying the merged item, common mistakes

### CDN_REQUIREMENT.md
Why chat surfaces need a served URL.
- Why `$binary` doesn't render; how chat clients embed images
- Storage options (object storage vs drive-style) and how to ask the user
- The generate → upload → reply flow
- Signed URLs, file naming, cleanup

---

## Quick Reference

### Read file bytes (Code node)
```javascript
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const text = buffer.toString('utf-8');
```

### Write a file (Code node) — re-attach on return
```javascript
return [{
  json: { ok: true },
  binary: {
    report: {
      data: Buffer.from(text).toString('base64'),
      mimeType: 'text/plain',
      fileName: 'report.txt',
    },
  },
}];
```

### Keep binary across a JSON transform
```
[Source] ─┬─→ [Edit Fields] ─┐
          └──────────────────┴─→ [Merge: combineByPosition]
```

### Pass a file to/from an agent tool
- Inbound: upload → inject storage key in system prompt → tool downloads by key
- Outbound: tool uploads → returns `{ key, url }` in JSON

---

## Integration with Other Skills

**n8n-code-javascript / n8n-code-python**: own the Code-node sandbox and helpers; this skill owns the rule that binary must be re-attached on return.

**n8n-code-tool**: the Custom Code Tool sandbox has no `$binary`/`getBinaryDataBuffer` — a tool gets files via the storage-key pattern.

**n8n-workflow-patterns**: the agent-tool boundary and the generate → upload → reply flow live inside larger patterns.

**n8n-node-configuration**: `responseFormat`, `binaryPropertyName`, `includeOtherFields`, `binaryPropertyOutput` are conditional fields — confirm names with `get_node`.

**n8n-expression-syntax**: addressing `$binary.<key>` and webhook uploads under `$json.body`.

**n8n-validation-expert**: a stripped binary slot is a silent failure validation won't flag.

**n8n-mcp-tools-expert**: owns `n8n_manage_datatable` (Data Tables) and `n8n_executions` (confirm binary survived).

**n8n-error-handling**: storage uploads/downloads fail — staging steps need error branches.

**using-n8n-mcp-skills**: the index of how these skills fit together.

---

## When to Use This Skill vs Alternatives

| Need | Use |
|---|---|
| Where file bytes live, reading/writing binary | **n8n-binary-and-data** |
| Language-level Code-node logic (arrays, dates, HTTP) | **n8n-code-javascript** / **n8n-code-python** |
| A tool an AI agent invokes | **n8n-code-tool** |
| Persistent tabular storage (dedup, state) | **n8n-mcp-tools-expert** (`n8n_manage_datatable`) |
| Overall workflow shape | **n8n-workflow-patterns** |

---

## Success Metrics

After using this skill, you should be able to:

- [ ] Read file contents from `$binary`, never `$json`
- [ ] Set `responseFormat: "file"` on HTTP downloads
- [ ] Re-attach `binary` on a Code node return so the file survives
- [ ] Keep binary across a JSON transform via pass-through or Merge by position
- [ ] Move a file in or out of an agent tool using a storage key, not raw bytes
- [ ] Recognize that `passthroughBinaryImages` is vision-only and doesn't feed tools
- [ ] Get a generated image to display in a chat surface by serving it from a URL
- [ ] Confirm binary survived by inspecting the execution, not by validation

---

## Sources

Authoritative facts in this skill come from:
- [n8n binary data docs](https://docs.n8n.io/data/binary-data/) — the `$binary` slot, property names, storage
- [n8n Code node docs](https://docs.n8n.io/code/builtin/) — `getBinaryDataBuffer` and the helpers surface
- [n8n Merge node docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/) — `combineByPosition` semantics
- [n8n AI Agent / LangChain nodes docs](https://docs.n8n.io/advanced-ai/) — the agent ↔ tool JSON boundary and `passthroughBinaryImages`

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n with `$binary` items; agent-tool patterns require the LangChain AI Agent node.

---

**Remember**: two slots, side by side. Data rides in `$json`, files ride in `$binary` — and the moment a file crosses an agent tool or reaches a chat surface, it travels as a URL, not as bytes.
