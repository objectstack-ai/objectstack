---
name: objectstack-ai
description: >
  Design ObjectStack AI skills, tools, knowledge sources, conversations,
  model registry entries, and MCP integrations. Use when the user is adding
  `*.skill.ts` / `*.tool.ts`, configuring an LLM provider, wiring agent
  tools, or indexing ObjectStack data as a knowledge source for RAG. Agents
  themselves are platform-internal (`ask` / `build`) — third parties extend
  them via skills and tools, not by authoring `*.agent.ts`. Do not use for
  general LLM prompting questions unrelated to ObjectStack metadata.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: ai
  tags: agent, tool, skill, conversation, llm, embedding, mcp
---

# AI Agent Design — ObjectStack AI Protocol

Expert instructions for designing AI skills, tools, and knowledge sources —
and the platform agents they plug into — using the ObjectStack specification.
This skill covers the Agent → Skill → Tool three-tier architecture aligned with
Salesforce Agentforce, Microsoft Copilot Studio, and ServiceNow Now Assist
patterns.

> **Edition boundary (`service-ai` → cloud; open = MCP-only).**
> The in-UI AI **runtime** — the `ask` / `build` agents, in-product chat, and the
> `/api/v1/ai/*` routes (`@objectstack/service-ai`) — ships in the **cloud /
> Enterprise** distribution, not the open framework. The agent / skill / tool
> **schemas** in `@objectstack/spec/ai` stay open, so you author `*.skill.ts` /
> `*.tool.ts` as source either way (`*.agent.ts` is platform-internal) — but
> they only execute in a cloud / EE host. On the **open edition** there is no in-product agent: expose the
> app to your own AI via `@objectstack/mcp` (BYO-AI) for data query, and author
> metadata in **source mode** with an AI coding agent (Claude Code, Cursor).

---

## When to Use This Skill

- You need to define **skills** — bundles of related tools bound to the
  `ask` / `build` surfaces.
- You are configuring **tools** for data queries, actions, or integrations.
- You want to index ObjectStack data as a **knowledge source** for RAG
  retrieval.
- You are choosing and configuring **LLM models** (model registry).
- You need to read or review **agent** configuration — platform-internal;
  third parties extend agents via skills, not by authoring them.

---

## Three-Tier Architecture

```
Agent  →  Skill  →  Tool
  │         │         │
  │         │         └─ Atomic operation (query, action, flow, API call)
  │         └─ Capability bundle with instructions & trigger phrases
  └─ Autonomous actor with role, instructions, and guardrails
```

### Why Three Tiers?

| Tier | Analogy | Reuse Level |
|:-----|:--------|:------------|
| **Agent** | Job role (e.g., "Help Desk Agent") | Per use-case |
| **Skill** | Competency (e.g., "Case Management") | Across agents |
| **Tool** | Specific operation (e.g., "create_record") | Across skills |

> **Best practice:** Always model via Skills first. Direct tool assignment to
> agents is supported but considered legacy. Skills provide better
> discoverability, instruction scoping, and reuse.

### Built-in agents: `ask` & `build` (ADR-0063 / ADR-0064)

The runtime ships **exactly two** platform agents, bound by *surface* — the user
never picks from a roster; the surface they are in selects the agent:

- **`ask`** — the **data product** (≈ Claude Chat). Conversational read / query /
  explore over records, plus running the business **actions** the app already
  exposes. End-user audience, RLS-bounded. Canonical id `ask` (`ASK_AGENT_NAME`).
  **Cloud / Enterprise** — the `ask` runtime ships in the closed cloud AI runtime
  (`@objectstack/service-ai`); it is the implicit copilot for any cloud / EE app
  that does not pin `app.defaultAgent`. (Open editions have no in-product `ask`;
  use MCP.)
- **`build`** — the **authoring product** (≈ Claude Code). Agentic authoring of
  *metadata* (objects, fields, views, flows) through plan → draft → verify →
  publish. Builder audience, governance-gated. Canonical id `build`. Cloud-only ·
  paid — ships in the cloud AI Studio plugin; Studio pins it via `app.defaultAgent`.

There is **no per-turn intent classifier**: a `build`-shaped request arriving at
`ask` is declined and redirected to the Builder, never silently re-routed into
authoring (ADR-0063 §1/§5).

> **Legacy names are aliases only.** `data_chat`→`ask` and
> `metadata_assistant`→`build` resolve through the alias table for old bookmarks
> and persisted `agent_id`s; they are **not** vocabulary — always write `ask` /
> `build`. `*.agent.ts` is closed to third parties (`agent` type is
> `allowRuntimeCreate:false, allowOrgOverride:false`): you extend the platform
> with **skills**, never by authoring an agent (ADR-0063 §2).

#### Skill → agent affinity: the `surface` field (ADR-0063 §3)

Every skill declares which surface it binds to via
`surface: 'ask' | 'build' | 'both'` (defaults to `'ask'`). A skill may bind only
to an agent whose surface it matches; `'both'` binds to either. The runtime
enforces this in `resolveActiveSkills` at load time — an incompatible binding is a
**fast load error**, not a silent mis-scope. An agent's tool set is the **union of
its surface-compatible skills' tools** — there is no global fall-through
(ADR-0064), so `ask` cannot author by construction.

The built-in skills and their affinities:

| Skill | `surface` | Owns | Edition |
|---|---|---|---|
| `schema_reader` | `both` | `list_objects`, `describe_object`, `query_data` | OSS |
| `data_explorer` | `ask` | `query_records`, `get_record`, `aggregate_data`, `visualize_data` | OSS |
| `actions_executor` | `ask` | `action_*` (the business actions an object exposes) | OSS |
| `metadata_authoring` + `solution_design` | `build` | metadata draft / verify / publish + blueprint propose / apply | **cloud only** |

To grant data exploration to your own (platform-internal) agent, add
`data_explorer` / `schema_reader` to its `skills[]`; deactivating a skill
(`active: false`) revokes that capability for every agent that references it.

> **`surface:'build'` skills are inert on OSS — by design, not a bug.** The open
> single-env framework ships only the `ask` agent; `metadata_authoring` /
> `solution_design` (and any third-party `surface:'build'` skill) are supplied by
> the cloud AI Studio plugin and simply do not resolve in OSS. A `build`-intent
> turn on OSS degrades gracefully ("authoring lives in the cloud Build assistant")
> instead of dead-ending — this is intentional tiering. Do not assume authoring
> tools resolve in the open framework.

> **`visualize_data`:** the only built-in tool that draws a chart —
> it aggregates an object and emits an inline `data-chart` part. Auto-registered
> **only** when an analytics service (`IAnalyticsService`) is wired; `query_data` /
> `aggregate_data` return numbers, not charts.

> **Ops:** set `AI_DAILY_USER_MESSAGES=<N>` to cap user turns per user per day
> (backed by the `ai_usage_daily` object; no-op if unset). Adapter health is
> observable at `GET /api/v1/ai/status`; invalid `ai` settings are rejected at
> save time.

---

## Agent Configuration

> **Reference only — third parties do not author agents.** The `agent` type is
> closed (`allowRuntimeCreate:false`; ADR-0063 §2): the platform ships exactly
> `ask` and `build`, maintained by platform / cloud plugin authors. You extend
> the platform with **skills + tools** (and knowledge sources) — never by
> adding an agent. This section documents `AgentSchema` for reading existing
> agents and for platform-internal work.

### Required Properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `name` | `snake_case` | Unique agent identifier |
| `label` | string | Human-readable name |
| `role` | string | Agent's persona/role description |
| `instructions` | string | System prompt — detailed behavioural guidance |

### Important Optional Properties

| Property | Purpose |
|:---------|:--------|
| `skills` | Array of skill names — **primary capability model** |
| `tools` | Direct tool references — legacy fallback |
| `surface` | `'ask' \| 'build'` — the product surface this agent is (default `'ask'`) |
| `model` | LLM model configuration — `provider`, `model`, `temperature`, `maxTokens`, `topP` |
| ~~`knowledge`~~ | REMOVED in protocol 17 — declaring sources/indexes on an agent never scoped retrieval (`search_knowledge` takes `sourceIds` from the LLM's tool-call arguments). Restrict at the knowledge-service/source level; describe intended grounding in `instructions` |
| `guardrails` | `maxTokensPerInvocation`, `maxExecutionTimeSec`, `blockedTopics` |
| `structuredOutput` | Output format (JSON schema, regex, etc.) |
| `planning` | Autonomous reasoning — `maxIterations` (default 10) |
| `memory` | `longTerm` persistence + `reflectionInterval` |
| `permissions` | Permission-set capabilities required to use the agent |
| `active` | Enable/disable the agent |

There is **no top-level `temperature` / `maxTokens`** on an agent — sampling
parameters live under `model` (`AIModelConfigSchema`).

### Agent Example

<!-- os:check -->
```typescript
import { defineAgent } from '@objectstack/spec';

export default defineAgent({
  name: 'support_tier_1',
  label: 'First Line Support',
  role: 'Help Desk Assistant for customer support cases',
  instructions: `
    You are a friendly and professional help desk assistant.
    
    RULES:
    - Always greet the customer by name if available.
    - Search the knowledge base before creating a new case.
    - Escalate to a human agent if the issue is critical or security-related.
    - Never share internal system details with customers.
    - Respond in the customer's preferred language.
  `,
  skills: ['case_management', 'knowledge_search'],
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
  },
  guardrails: {
    blockedTopics: ['internal_pricing', 'employee_data'],   // forbidden topics / action names
    maxTokensPerInvocation: 8000,                            // token budget per invocation
    maxExecutionTimeSec: 60,                                 // wall-clock cap per invocation
  },
});
```

---

## Skill Configuration

A **Skill** is a named bundle of tools with dedicated instructions and
trigger conditions.

### Required Properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `name` | `snake_case` | Unique skill identifier (`/^[a-z_][a-z0-9_]*$/`) |
| `label` | string | Human-readable name |
| `tools` | `string[]` | Tool names this skill grants access to (trailing wildcard allowed, e.g. `action_*`) |

### Important Optional Properties

| Property | Purpose |
|:---------|:--------|
| `surface` | `'ask' \| 'build' \| 'both'` — agent surface affinity (default `'ask'`; see above) |
| `description` | What the skill does — helps the agent decide when to use it |
| `instructions` | LLM prompt guidance specific to this skill's context |
| `triggerPhrases` | Natural language phrases that activate the skill |
| `triggerConditions` | Programmatic activation rules |
| `active` | Is the skill enabled (default: `true`) |

> A skill has **no `permissions` key** — it was removed in 16.x. Skill invocation
> was never gated by it (the registry reads only `active` / `triggerConditions` /
> `tools`), and a security-shaped field that enforces nothing is worse than no
> field at all. Gate access at the **agent** instead — `access` / `permissions` on
> `defineAgent` are enforced at the chat route — or on the underlying actions the
> skill's tools call (permission sets, ADR-0066).

### Skill Example

<!-- os:check -->
```typescript
import { defineSkill } from '@objectstack/spec';

export default defineSkill({
  name: 'case_management',
  label: 'Case Management',
  description: 'Create, update, query, and escalate support cases.',
  instructions: `
    When managing cases:
    - Always check for duplicate cases before creating a new one.
    - Set priority based on customer tier: Enterprise → High, Pro → Medium, Free → Low.
    - Escalated cases must include a summary of actions already taken.
  `,
  tools: [
    'query_support_case',
    'create_support_case',
    'update_support_case',
    'escalate_case',
  ],
  triggerConditions: [
    { field: 'objectName', operator: 'eq', value: 'support_case' },
  ],
  active: true,
});
```

### Trigger Conditions

| Operator | Meaning |
|:---------|:--------|
| `eq` | Equals |
| `neq` | Not equals |
| `in` | Value is in array |
| `not_in` | Value is not in array |
| `contains` | String contains substring |

---

## Tool Configuration

Tools are the atomic operations that skills expose to agents.

### First-Class Tool Metadata (`defineTool`)

A tool authored as metadata (`type: 'tool'`, `*.tool.ts`) is validated by
`ToolSchema`: required `name` / `label` / `description`, a **JSON Schema**
`parameters` object, plus optional `objectName` and `outputSchema`. `ToolSchema`
is **strict** — an unknown key (a typo, or a retired key) is a parse error, not
a silent strip. Retired in protocol 17: `category`, `permissions`,
`active` and `builtIn` (all were authorable and inert; `permissions` gated
nothing and `active: false` withdrew nothing — the rejection message carries
each key's replacement), joining `requiresConfirmation`.

<!-- os:check -->
```typescript
import { defineTool } from '@objectstack/spec';

export default defineTool({
  name: 'create_case',
  label: 'Create Support Case',
  description: 'Creates a new support case record',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Case subject' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['subject'],
  },
  objectName: 'support_case',
});
```

To gate what a tool can do, gate the underlying action
(`action.requiredPermissions`, ADR-0066) or the objects it touches; to withdraw
a tool, remove it from the skills/agents that reference it. Categorization, if
you need it, belongs on the action side (`action.ai.category` — a live,
enforced surface).

> **Tool metadata is a read-only projection — not an execution entry point.**
> `ToolSchema` has no `handler` / `implementation` field, and no framework
> executor loads a metadata-authored tool. The runtime executes a
> separately-registered `AIToolDefinition` (cloud `@objectstack/service-ai`);
> tool metadata is a one-way projection for Studio / discovery. Do not expect a
> hand-authored tool to run in the open edition.

### Inline Agent `tools[]` (legacy)

Entries in an agent's inline `tools[]` array are a **different, legacy shape**
(`AIToolSchema`): `{ type: 'action' | 'flow' | 'query' | 'vector_search',
name, description? }` — references to existing actions / flows / queries, not
tool definitions. Prefer skills + first-class tool names.

### Auto-Exposed Actions

> **Cloud / EE runtime.** `registerActionsAsTools()`, `AIServicePlugin`, and
> the HITL approval queue below ship in `@objectstack/service-ai` — the closed
> cloud / Enterprise runtime, not an open package. On the open edition, expose
> actions to your own AI via `@objectstack/mcp` instead.

You usually **don't author tool definitions by hand** for action invocation. Every `Action` you attach to an object via `defineObject({ actions: [...] })` is auto-exposed as a tool named `action_<actionName>` by `registerActionsAsTools()` (invoked from `AIServicePlugin`).

Three action types dispatch headlessly:

| `action.type` | Dispatch | Wiring |
|:---|:---|:---|
| `script` | `IDataEngine.executeAction(object, target, ctx)` — same as Studio's row toolbar | none |
| `api` | HTTP call to `action.target` (`fetch`-based by default) | `AIServicePlugin({ apiActionBaseUrl, apiActionHeaders })` or custom `apiClient` |
| `flow` | `IAutomationService.execute(target, { triggerData })` | `automation` service registered with the kernel |

**Skipped automatically:**
- UI-only types (`url`, `modal`, `form`).
- Dangerous variants (`confirmText` set, `mode: 'delete'`, `variant: 'danger'`) — **unless** the plugin is started with `enableActionApproval: true`, in which case they route through the HITL approval queue (see below).
- Owner opt-outs (`aiExposed: false`).

**`type:'api'` body assembly** (last wins): user params → `recordIdParam` (using `recordIdField`, default `'id'`) → `bodyExtra`. `bodyShape: { wrap: 'data' }` nests user params under `data` while keeping `recordIdParam` flat.

Use `actionSkipReason(action, ctx)` (exported from `@objectstack/service-ai` — cloud-only, not importable on the open edition) when authoring an action and you want to know *why* it isn't surfacing in chat. Studio's "AI exposure" diagnostics use the same predicate. Pair with `actionRequiresApproval(action)` to know whether a registered action will be routed through HITL.

### Human-In-The-Loop approval

> **Cloud / EE runtime.** The HITL approval queue is part of
> `@objectstack/service-ai` and is not available in the open framework.

```ts
kernel.use(new AIServicePlugin({
  enableActionApproval: true,   // opt in; default is false
  apiActionBaseUrl: process.env.OS_AI_ACTION_API_BASE_URL,
}));
```

Flow:
1. LLM picks `action_delete_task` → runtime persists an `ai_pending_actions` row and returns `{ status: 'pending_approval', pendingActionId }`.
2. Operator triages via Studio's **AI Pending Actions** inbox (or the REST endpoints: `GET/POST /api/v1/ai/pending-actions/...`).
3. Approve → service re-runs the action via the pre-registered bypass-approval dispatcher; row transitions to `executed` / `failed`.
4. Reject → row transitions to `rejected` with an optional reason.

Programmatic API on `IAIService`: `proposePendingAction`, `approvePendingAction`, `rejectPendingAction`, `listPendingActions`. All are optional (returns clear error when no `IDataEngine` is wired).

---

## Knowledge Sources (RAG)

The platform's RAG primitive is the **KnowledgeSource**
(`KnowledgeSourceSchema` in `@objectstack/spec/ai`): declarative metadata
pairing *what to index* with the id of an `IKnowledgeAdapter` that does the
work. Sources are registered at runtime via
`IKnowledgeService.registerSource()` (there is no `defineStack` collection for
them), and the `search_knowledge` tool exposes registered sources to agents.

### KnowledgeSource Structure

| Property | Purpose |
|:---------|:--------|
| `id` | Snake_case source id |
| `label` / `description` | Display metadata |
| `adapter` | Adapter id (e.g. `'ragflow'`, `'memory'`), resolved via `IKnowledgeService.registerAdapter` |
| `adapterConfig` | Adapter-specific configuration (opaque to the service) |
| `source` | What gets indexed — discriminated on `kind`: `'object'` \| `'file'` \| `'http'` |
| `embedding` | Optional `EmbeddingModelSchema` ref (`provider`, `model`, `dimensions`) — adapters that manage embeddings internally (RAGFlow, Dify, Vectara) may ignore it |
| `vectorStore` | Optional `VectorStoreSchema` ref (`provider`, `collection`) — same caveat |
| `refresh` | `onRecordChange` (default `true` for object sources) + optional `cron` (surfaced for an external scheduler, not self-scheduled) |
| `aiExposed` | Whether `search_knowledge` may expose this source to agents (default `true`) |

Source kinds:

| `source.kind` | Fields |
|:--------------|:-------|
| `object` | `object`, `contentFields[]` (min 1; `*` = every readable text field), `metadataFields?`, `where?` (ObjectQL `where` syntax) |
| `file` | `prefix` (storage prefix, e.g. `kb/handbooks/`), `mimeTypes?` |
| `http` | `urls[]`, `userAgent?` |

### Knowledge Source Example

<!-- os:check -->
```typescript
import { KnowledgeSourceSchema, type KnowledgeSource } from '@objectstack/spec/ai';

export const supportKb: KnowledgeSource = KnowledgeSourceSchema.parse({
  id: 'support_kb',
  label: 'Support Knowledge Base',
  adapter: 'ragflow',                       // or 'memory' for dev/test
  source: {
    kind: 'object',
    object: 'kb_article',
    contentFields: ['title', 'body'],       // concatenated into document content
    metadataFields: ['category', 'owner_id'], // projected for search-time filtering
    where: { published: true },             // index published articles only
  },
  refresh: { onRecordChange: true },        // re-index on record.* events
});
```

> **Chunking, top-K, score thresholds, and rerankers are NOT platform
> metadata.** The spec deliberately scopes them out (`embedding.zod.ts`):
> chunking strategies, retrieval pipelines, and RAG orchestration belong to
> the adapter (`adapterConfig`) or application code. The platform only carries
> the embed + vector primitives so any RAG strategy can be built on top.

### Knowledge Source Best Practices

1. **Filter with `where`.** Index only published/active records
   (`where: { published: true }`) so draft or archived content never enters
   the index.
2. **Index only meaningful text via `contentFields`.** Do not include system
   fields or IDs; use `*` (all readable text fields) sparingly.
3. **Project filter fields into `metadataFields`** (e.g. `status`, `owner_id`,
   `tags`) so searches can be narrowed at query time.
4. **Hide with `aiExposed: false`** when a source should be indexed but not
   agent-searchable.
5. **Tune relevance in the adapter, not the metadata.** Top-K, thresholds, and
   reranking are configured in your RAG backend (via `adapterConfig`), not in
   ObjectStack metadata.

---

## Model Configuration

### Supported Providers

| Provider | Models | Use Case |
|:---------|:-------|:---------|
| `openai` | GPT-4o, GPT-4o-mini, o1, o3-mini | General purpose, reasoning |
| `anthropic` | Claude Sonnet 4, Claude Haiku | Long context, safety |
| `azure_openai` | Same as OpenAI, enterprise managed | Compliance, data residency |
| `local` | Ollama, vLLM, llama.cpp | On-premise, air-gapped |

> The inline agent `model.provider` enum is the narrow set above
> (`openai` / `azure_openai` / `anthropic` / `local`). **Model-registry** entries
> (`ModelProviderSchema`) accept a wider set: also `google`, `cohere`,
> `huggingface`, `custom`.

### Model Selection Guidelines

| Scenario | Recommended |
|:---------|:------------|
| Complex reasoning, multi-step planning | GPT-4o / Claude Sonnet 4 |
| High-volume, low-latency | GPT-4o-mini / Claude Haiku |
| Sensitive data, on-premise | Local models via Ollama |
| Structured data extraction | Any model + `structuredOutput` config |

### Temperature Guidelines

| Value | Use Case |
|:------|:---------|
| `0.0–0.3` | Factual Q&A, data extraction, code generation |
| `0.3–0.7` | Conversational agents, customer support |
| `0.7–1.0` | Creative writing, brainstorming |
| `> 1.0` | Experimental / highly creative (use with caution) |

---

## Structured Output

Force the agent to respond in a specific format:

```typescript
structuredOutput: {
  format: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      action_items: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'priority'],
  },
  strict: true,     // enforce exact schema compliance (default: false)
  maxRetries: 3,    // max retries on validation failure (default: 3)
}
```

On validation failure the runtime retries by default
(`retryOnValidationFailure: true`). Optional extras: `fallbackFormat` and a
`transformPipeline` of post-processing steps (`trim`, `parse_json`,
`validate`, `coerce_types`). There is no `retry` object — the knobs are
`retryOnValidationFailure` + `maxRetries`.

---

## Common Pitfalls

1. **Overly broad instructions.** Agents with vague instructions hallucinate
   more. Be specific about what the agent should and should not do.
2. **Too many tools per skill.** Keep skills focused (3–8 tools). If a skill
   has 15+ tools, split it.
3. **Missing guardrails and approval gates.** Define `blockedTopics` (plus the
   token / time budgets) in agent `guardrails`; for destructive operations put
   a human in the loop with a gate that is **actually enforced** —
   `enableActionApproval: true` (HITL queue, cloud) for auto-exposed actions,
   `ai.requiresConfirmation` on the **action**, or `approval: 'always'` on an
   MCP tool binding. AI metadata edits are already gated: they land as drafts a
   human must publish (ADR-0033).
   ⚠️ `requiresConfirmation` on the **tool** was REMOVED (ADR-0033 §2) —
   it was read by no execution path, so it produced no pause. `ToolSchema` is
   strict, so authoring it now fails the parse with the migration attached.
   There is no `requireApprovalFor` field.
4. **Ignoring tool descriptions.** The LLM uses tool `description` to decide
   when to call it. Poor descriptions = wrong tool selection.
5. **Not testing trigger phrases.** Ambiguous trigger phrases cause skill
   conflicts. Test with edge-case inputs.
6. **Indexing everything.** A knowledge source without a `where` filter and
   curated `contentFields` fills the index with drafts and boilerplate that
   pollute retrieval. Source hygiene is the metadata's job; relevance tuning
   (top-K, thresholds, reranking) belongs to the adapter.

---

## App AI Blueprint (Skills + Tools + Knowledge)

Reference layout for a scaffolded app:

| Layer | File | Pattern |
|:--|:--|:--|
| Reusable skill | `src/skills/lead-qualification.skill.ts` | `defineSkill` — trigger phrases + trigger conditions + bounded toolset; pick a `surface` |
| Tool metadata | `src/tools/query-leads.tool.ts` | `defineTool` — JSON-Schema `parameters`; a discovery projection, not an executor (see caveat above) |
| Knowledge source | `src/knowledge/sales-kb.ts` | `KnowledgeSourceSchema` metadata, registered at runtime via `IKnowledgeService.registerSource()` |
| Central registration | `defineStack({ skills: [...], tools: [...] })` | `agents` / `tools` / `skills` are the only AI stack collections — knowledge sources have none; agents are platform-supplied |

Default for metadata apps: push business capability logic into **skills**, keep
tools atomic, and wire domain knowledge through **knowledge sources**.

---

## Verify your work

After authoring a `*.skill.ts` / `*.tool.ts` (or platform-internal
`*.agent.ts`) or a model-registry entry, run the author-time gate before
reporting done:

```bash
os validate     # Zod schema + CEL predicate validation + bindings (no artifact)
# or: os build  # the same gates, plus emits dist/
```

It confirms the agent/tool/model metadata conforms to the protocol and that any
CEL predicate (e.g. a tool's availability condition) parses and resolves. In a
scaffolded project the gate is `npm run validate`. See objectstack-platform →
**Verify your work**.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

