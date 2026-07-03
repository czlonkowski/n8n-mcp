# AI Agent Workflow Pattern

**Use Case**: An AI agent with tool access, memory, and reasoning sits inside a larger workflow — trigger feeds it, it decides and acts, output flows on.

> **For agent design depth, use the `n8n-agents` skill.** This file covers where an AI agent sits in a workflow's architecture (trigger → agent → output, the `ai_*` sub-node connection types). The `n8n-agents` skill owns the design rules: tool selection and `$fromAI` parameters, the system-prompt vs tool-description split, structured output with autoFix, memory and sessionId, human-in-the-loop review, RAG, and chat shell/core/sub-agent topologies. Start there when building or debugging an agent.

---

## Pattern Structure

```
Trigger → AI Agent (Model + Tools + Memory + optional Output Parser) → [Process Response] → Output
```

**Key Characteristic**: AI-powered decision making with tool use. From the *workflow* angle, an agent is one node with a main input/output plus `ai_*` sub-node slots — it slots into the same trigger → process → deliver spine as every other pattern.

---

## Core AI Connection Types

Agent workflows wire sub-nodes into the agent with dedicated `ai_*` connection types — **not** the regular `main` connection. This is the single most important architectural fact: a tool wired to `main` is invisible to the agent (and `validate_workflow` flags it as disconnected).

| Connection type | Wires in | Into slot |
|---|---|---|
| `ai_languageModel` | The LLM (OpenAI, Anthropic, Gemini, Ollama…) | model (required) |
| `ai_tool` | Any node the agent can call | tools |
| `ai_memory` | Conversation context store | memory |
| `ai_outputParser` | Structured-output parser | output parser |
| `ai_embedding` | Vector embeddings | RAG chain |
| `ai_vectorStore` | Vector database | RAG chain |
| `ai_document` | Document loaders | RAG ingest |
| `ai_textSplitter` | Text chunking | RAG ingest |

**Wiring direction**: a sub-node connects FROM itself TO the agent, and the connection lives on the sub-node keyed by its `ai_*` type. With `n8n_update_partial_workflow` you add each with an `addConnection` op using `sourceOutput: "ai_tool"` (or `"ai_languageModel"`, etc.). Multiple tools all stack on the same `ai_tool` index 0.

---

## Core Components

The agent has a **main input** (the user message / prompt) and up to four sub-node slots:

1. **Trigger** — Chat Trigger (chat UI/streaming), Webhook (API), Manual (testing), or Schedule (periodic). Feeds the agent's main input.
2. **Language Model** (`ai_languageModel`, required) — the reasoning engine. One chat-model sub-node; a second can be wired as a fallback.
3. **Tools** (`ai_tool`, optional but the whole point) — **ANY node can be a tool.** HTTP Request, a database node, a sub-workflow, Code, or a pre-built tool node connects via the `ai_tool` port and the agent calls it by name.
4. **Memory** (`ai_memory`, optional) — maintains conversation context across turns, keyed by a `sessionKey`.
5. **Output Parser** (`ai_outputParser`, optional) — forces structured JSON instead of free text.

**Critical output fact**: the AI Agent node puts its final answer in **`$json.output`** — not `$json.text` or `$json.response`. Downstream nodes reference `{{ $json.output }}`.

**Fan-out tip**: when several agents run in parallel (e.g. multiple research agents feeding one report), avoid funneling them into a Merge node — Merge `combineAll` does a cross-product and mishandles inputs arriving at different times (often yielding 0 output). Either have each agent deliver its own output directly, or collect same-shaped items with an **Aggregate** node followed by a Code node for formatting.

For the deep slot mechanics — tool types, `$fromAI` parameters, memory configuration, parser schemas — see **n8n-agents**.

---

## Common Use Cases

Short architecture sketches. Each is a trigger → agent → output spine; the agent's sub-nodes are listed under it.

### 1. Conversational Chatbot
```
Webhook (chat message) → AI Agent → Webhook Response
                          ├─ Chat Model (ai_languageModel)
                          ├─ HTTP Request Tool — search knowledge base (ai_tool)
                          ├─ Database node — query orders (ai_tool)
                          └─ Window Buffer Memory, keyed on session_id (ai_memory)
```

### 2. Document Q&A (RAG)
```
Setup (run once):  Read Files → Text Splitter → Embeddings → Vector Store
Query (recurring): Webhook → AI Agent → Webhook Response
                              ├─ Chat Model (ai_languageModel)
                              ├─ Vector Store Tool — search docs (ai_tool)
                              └─ Buffer Memory (ai_memory)
```

### 3. Data Analysis Assistant
```
Webhook (data question) → AI Agent → Code (chart data) → Webhook Response
                          ├─ Chat Model (ai_languageModel)
                          ├─ Postgres node, read-only user (ai_tool)
                          └─ Code Tool — analysis (ai_tool)
```

### 4. Workflow Automation Agent
```
Slack (slash command) → AI Agent → Slack (status)
                        ├─ Chat Model (ai_languageModel)
                        ├─ HTTP Request Tool — GitHub API (ai_tool)
                        ├─ HTTP Request Tool — Deploy API (ai_tool)
                        └─ Postgres node — deployment logs (ai_tool)
```

### 5. Email Processing Agent
```
Email Trigger → AI Agent → Email (auto-response) → Slack (notify team)
                ├─ Chat Model (ai_languageModel)
                ├─ Vector Store Tool — similar tickets (ai_tool)
                └─ HTTP Request Tool — create Jira ticket (ai_tool)
```

For the *content* of these (tool descriptions, system prompts, schema design), see **n8n-agents** `EXAMPLES.md`.

---

## What the deep design lives in n8n-agents

This file is the workflow-architecture view. The design depth below is owned by **n8n-agents** — go there, don't duplicate it here:

- **Tool configuration** (the four tool types, native vs `.toolWorkflow` vs HTTP Request Tool vs MCP Client, `$fromAI()` anatomy, tool names/descriptions as prompt) → **n8n-agents** `TOOLS.md`, and `SUBWORKFLOW_AS_TOOL.md` for wiring a sub-workflow as a tool.
- **Memory configuration** (buffer/window/postgres/redis, `contextWindowLength`, sessionId handling per trigger) → **n8n-agents** `MEMORY.md`.
- **Agent vs chain vs classifier choice, prompt engineering, system-prompt vs tool-description split** → **n8n-agents** `SYSTEM_PROMPT.md` (and the SKILL.md "Pick the right node" table).
- **RAG chains, structured output, streaming, fallback models** → **n8n-agents** `RAG.md` and `STRUCTURED_OUTPUT.md`.
- **Human review / gating destructive tools** → **n8n-agents** `HUMAN_REVIEW.md`.
- **Error handling** (tool failures, LLM API errors, retries, error workflows) → **n8n-error-handling**, plus the agent-specific notes in **n8n-agents**.
- **Performance, security, testing, common gotchas** → **n8n-agents** (anti-patterns table and quick-reference checklist) for the agent-specific ones; the workflow lifecycle (test → validate → activate) is in this skill's SKILL.md "Workflow lifecycle" section.

One workflow-architecture safety note worth restating here: **any tool that fetches third-party content** (HTTP Request, web search, MCP Client, scrapers) can return attacker-controlled text that reaches the agent's context — indirect prompt injection. If the agent can both *read the internet* AND *take an action the user can't undo*, put a guardrail (human review, read-only scopes) between them. The detail lives in **n8n-agents** `HUMAN_REVIEW.md` and the **n8n-agents** anti-patterns.

---

## Checklist for AI Agent Workflows

Architecture-level checks (the design-level checklist lives in **n8n-agents**):

- [ ] Trigger feeds the agent's **main** input
- [ ] Language model wired via **`ai_languageModel`** (required)
- [ ] Tools wired via **`ai_tool`** ports — NOT `main` (a tool on `main` is disconnected from the agent)
- [ ] Memory wired via **`ai_memory`**, keyed on a stable `sessionKey` from the trigger — when conversation context is needed
- [ ] Output parser wired via **`ai_outputParser`** — when downstream needs strict JSON
- [ ] Downstream nodes read the response from **`{{ $json.output }}`**
- [ ] Parallel agents collected with **Aggregate**, not Merge `combineAll`
- [ ] Validated with `validate_workflow` (confirms sub-nodes sit on `ai_*`, not `main`)
- [ ] Tested and activated per the lifecycle (see SKILL.md "Workflow lifecycle" section)

---

## Summary

**Key Points**:
1. An agent is **one node** with a main input/output plus `ai_*` sub-node slots — it fits the standard trigger → process → deliver spine.
2. **8 AI connection types** — wire the model with `ai_languageModel`, tools with `ai_tool`, memory with `ai_memory`, parsers with `ai_outputParser`. Never `main`.
3. **ANY node can be a tool** — connect it via the `ai_tool` port.
4. The response is in **`$json.output`**.
5. For all design depth — tools, memory, prompts, structured output, RAG, human review, chat topologies — go to **n8n-agents**.

**Pattern**: Trigger → AI Agent (Model + Tools + Memory + optional Parser) → Output

**Related**:
- **n8n-agents** — the deep agent design guide (tools, memory, prompts, structured output, RAG, human review, chat topologies)
- [webhook_processing.md](webhook_processing.md) — receiving chat messages
- [http_api_integration.md](http_api_integration.md) — tools that call APIs
- [database_operations.md](database_operations.md) — database tools for agents
- SKILL.md "Workflow lifecycle" section — test, validate, and activate the workflow
- **n8n-error-handling** — tool-failure and LLM-error handling
