# n8n Agents Skill

The deep guide to designing n8n AI agents and the LangChain family around them (`@n8n/n8n-nodes-langchain.*`) — the AI Agent node, its model/memory/tools/outputParser slots, and the chains and classifiers you'd reach for instead.

This is the **biggest** skill in the pack. The parent **n8n-workflow-patterns** `ai_agent_workflow.md` gives the high-level "agent in a workflow" shell; this skill goes one level down into *how to build it well*.

---

## Pick the right node first

The most common over-build is reaching for an Agent when the job is one-shot:

| You need to… | Use |
|---|---|
| Tools, multi-turn reasoning, or memory | **AI Agent** (`.agent`) |
| One-shot text in → text out, no tools | **Basic LLM Chain** (`.chainLlm`) |
| Route a natural-language input to one of N branches | **Text Classifier** (`.textClassifier`) — NOT Agent + Switch |
| Pull structured fields out of free text | **Information Extractor** (`.informationExtractor`) |
| Generate an image / audio / video | The provider's **native single-call node** — never wrap media in an Agent |

---

## What This Skill Teaches

### Core Concepts
1. **The four sub-node slots** — model / memory / tools / outputParser, each on its own `ai_*` connection
2. **Tool names and descriptions ARE the prompt** — the model picks tools by reading them; generic names degrade routing silently
3. **`$fromAI()` anatomy** — how agent-filled tool params are declared (name / description / type); JSON only, never binary
4. **Structured output must parse AND autoFix** — `outputParserStructured` + a coding-capable fixer model
5. **Memory + sessionId continuity** — `memoryBufferWindow`, keyed on a stable session key
6. **The binary boundary** — the model can *see* images; tools can't *receive* them

### Common Mistakes This Skill Prevents
1. Agent + Switch to route on natural language — Text Classifier is one node with N outputs
2. A tool the agent ignores — generic name (`tool1`) or empty description
3. Malformed JSON crashing the workflow — `outputParserStructured` without `autoFix`
4. A chat bot in an infinite loop — no bot-user-ID filter
5. Wrapping image/audio/video generation in an Agent — binary doesn't flow through
6. Crossed conversations — hardcoded `sessionId` or `sessionId` behind `$fromAI`
7. "Max iterations reached" — the low default cap left untouched on a multi-tool agent

---

## Skill Activation

Activates when you:
- Build or edit any `@n8n/n8n-nodes-langchain.*` AI node
- Mention AI agents, LLM with tools, tool calling, `$fromAI`, system prompts
- Mention agent memory, `sessionId`, structured/JSON output, an output parser
- Mention RAG, a vector store, a chat assistant/bot, or human-in-the-loop review
- Choose between an Agent, an LLM chain, a Text Classifier, or an Information Extractor

**Example queries**:
- "My AI agent ignores a tool I named `tool1`. Why?"
- "Should I use an Agent + Switch to route messages into three branches?"
- "My agent sometimes returns malformed JSON and the workflow crashes despite an output parser."
- "How do I keep a Slack bot from triggering itself?"
- "Where should per-tool instructions go — the system prompt or the tool description?"

---

## File Structure

### SKILL.md
Main skill content — loaded when the skill activates.
- Pick the right node (Agent vs chain vs classifier vs extractor vs native media)
- The four sub-node slots and their `ai_*` connection types
- Two non-negotiables: tool names/descriptions as prompt; structured output parse + autoFix
- The four tool types and `$fromAI()` anatomy
- System prompt vs tool description split
- Memory mental model; the binary boundary; human review; chat topologies; RAG
- Anti-patterns, "what's NOT available via the MCP", integration, checklist

### Reference files
| File | Read when |
|---|---|
| **TOOLS.md** | Choosing among the four tool types, writing names/descriptions, `$fromAI` anatomy |
| **SUBWORKFLOW_AS_TOOL.md** | Wiring a sub-workflow as a tool via `.toolWorkflow` |
| **SYSTEM_PROMPT.md** | Writing/refactoring a system prompt; the modular split |
| **STRUCTURED_OUTPUT.md** | Forcing JSON output, autoFix, the fixer model, parse-failure fixes |
| **MEMORY.md** | Choosing a memory type; persistence and sessionId handling |
| **HUMAN_REVIEW.md** | Adding human approval; approval-message content; multi-channel approver |
| **CHAT_AGENT_PATTERNS.md** | Slack/Discord/Teams/Telegram bots; shell + core + sub-agents topology |
| **RAG.md** | Retrieval-augmented agents (thin by design) |
| **EXAMPLES.md** | Node-object snippets: stateless agent core, Slack router shell, domain sub-agent |

---

## Quick Reference

### Wiring a sub-node (connection lives on the sub-node)
```json
"Main LLM": { "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]] }
```

### Agent-filled tool parameter
```
={{ $fromAI('recipient', 'Email address of the recipient', 'string') }}
```

### Plumbed (hidden-from-agent) tool parameter
```
={{ $('Chat Trigger').first().json.user.id }}
```

### Memory keyed on a stable session
```json
{ "sessionIdType": "customKey", "sessionKey": "={{ $json.threadId }}", "contextWindowLength": 50 }
```

### Human-review approval message — literal params, never `$fromAI`
```
=Refund {{ $tool.parameters.amount }} to {{ $tool.parameters.customerId }}?
```

### Node-type formats
- Workflow JSON: long form — `@n8n/n8n-nodes-langchain.agent`
- `get_node` / `validate_node`: short form — `nodes-langchain.agent`

---

## Integration with Other Skills

**n8n-workflow-patterns** (`ai_agent_workflow.md`): the high-level agent shape. Start there for architecture; this skill is the deep dive.

**n8n-mcp-tools-expert**: node-type formats and tool selection — consult before any MCP call.

**n8n-node-configuration**: `displayOptions`-driven fields on the agent and sub-nodes; Slack/Block Kit message shapes.

**n8n-expression-syntax**: `{{ }}`, `$json.output`, `$now`, `$fromAI`, `$tool.parameters`.

**n8n-code-tool**: the Custom Code Tool's string-in/string-out contract (a different runtime from this skill's tools).

**n8n-subworkflows**: the sub-workflow primitive `.toolWorkflow` builds on.

**n8n-binary-and-data**: owns the agent-tool binary boundary mechanics.

**n8n-validation-expert**: interpreting `validate_workflow`, including AI-connection issues (a tool on `main` instead of `ai_tool` flags as disconnected).

**n8n-error-handling**: `onError: 'continueErrorOutput'` on tool sub-workflows and the agent-core call; error UX on chat shells.

---

## When to Use Which Tool Type

| Need | Use |
|---|---|
| One native node + one operation | **Native tool node** |
| More than one node / reusable / testable | **`.toolWorkflow`** (default when in doubt) |
| A single external HTTP API the agent orchestrates | **HTTP Request Tool** (`.toolHttpRequest`) |
| A maintained MCP server / publish n8n logic to many agents | **MCP Client Tool** |
| Pure inline computation (math, parsing) | **Custom Code Tool** (`.toolCode`, see **n8n-code-tool**) |

**Rule of thumb**: if you want `$fromAI()` inside Code, you want `.toolWorkflow` instead.

---

## Success Metrics

After using this skill, you should be able to:

- [ ] Pick Agent vs Basic LLM Chain vs Text Classifier vs Information Extractor correctly
- [ ] Wire model/memory/tools/outputParser via the right `ai_*` connection types
- [ ] Write tool names and descriptions the model actually selects against
- [ ] Declare `$fromAI()` params well, and plumb identity/limits/sessionId deterministically
- [ ] Configure `outputParserStructured` with a manual schema + autoFix + a coding-capable fixer
- [ ] Key memory on a stable session and avoid crossed conversations
- [ ] Gate destructive tools behind human review using literal `$tool.parameters`
- [ ] Build a chat bot that doesn't loop on its own messages

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n with `@n8n/n8n-nodes-langchain.agent` and the LangChain sub-node family. Node versions and model availability shift between releases — verify on the target instance with `search_nodes` / `get_node`.

---

**Remember**: the model can't see your wiring — it sees a system prompt and a list of named, described tools. Design those like an API and most "the agent won't behave" problems disappear.
