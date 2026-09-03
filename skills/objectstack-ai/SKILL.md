---
name: objectstack-ai
description: >
  Design ObjectStack AI skills, tools, knowledge sources, and the open-edition
  MCP server surface. Use when the user is adding `*.skill.ts` / `*.tool.ts`,
  configuring an LLM provider, wiring the tools a skill grants, or indexing
  ObjectStack data as a knowledge source for RAG. Agents themselves are
  platform-internal (`ask` / `build`) — third parties extend them via skills,
  not by authoring `*.agent.ts`. Do not use for general LLM prompting questions
  unrelated to ObjectStack metadata.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.4"
  domain: ai
  tags: agent, tool, skill, knowledge, llm, embedding, mcp
---

# AI Agent Design — ObjectStack AI Protocol

> **Edition boundary. ☁️ marks a cloud / Enterprise surface, and is not restated
> below.** The in-UI AI **runtime** — the `ask` / `build` agents, in-product
> chat, `/api/v1/ai/*` (`@objectstack/service-ai`) — ships cloud / EE, not in the
> open framework. The **schemas** in `@objectstack/spec/ai` stay open, so you
> author `*.skill.ts` / `*.tool.ts` as source either way, but they only execute
> in a cloud / EE host. On the **open edition** there is no in-product agent:
> expose the app to your own AI over **MCP** (below), and author metadata in
> **source mode** with an AI coding agent (Claude Code, Cursor).

```
Agent  →  Skill  →  Tool
  │         │         │
  │         │         └─ Atomic operation (query, action, flow, API call)
  │         └─ Capability bundle with instructions & trigger conditions
  └─ Autonomous actor with role, instructions, and guardrails
```

Agents are platform-internal (☁️ `ask` / `build`; reference section at the
bottom). **Skills are your entry point** — you extend the platform by authoring
skills, and a skill reaches tools by naming them.

---

## Skill Configuration

A **Skill** is a named bundle of tools with dedicated instructions and trigger
conditions.

| Required | Type | Description |
|:---------|:-----|:------------|
| `name` | `snake_case` | Unique skill id (`/^[a-z_][a-z0-9_]*$/`) |
| `label` | string | Display name |
| `tools` | `string[]` | Tool names this skill grants (trailing wildcard allowed, e.g. `action_*`) — every name must resolve; see the ladder below |

| Optional | Purpose |
|:---------|:--------|
| `surface` | `'ask' \| 'build' \| 'both'` — which platform agent may bind this skill (default `'ask'`). Enforced in `resolveActiveSkills` at load: an incompatible binding is a **fast load error** (ADR-0063 §3) |
| `description` | What the skill does — the agent reads it to decide when to use the skill |
| `instructions` | Prompt guidance for this skill's context. **The one field the open edition reads**: `@objectstack/mcp` projects it onto the MCP `prompts` primitive, so a skill with blank `instructions` — or `active: false` — is not listed as a prompt at all |
| `triggerConditions` | Programmatic activation rules (below) |
| `active` | Enabled (default `true`) |

> A skill has **no `permissions` key** — removed in 17.0.0 because it gated
> nothing. Gate at the **agent** (`access` / `permissions` on `defineAgent`,
> enforced at the chat route) or on the actions the tools call (ADR-0066).

### Naming the tools: the resolution ladder

A `skill.tools[]` entry resolves against the union of three sources
(`packages/lint/src/validate-ai-tool-references.ts:148-171`):

1. **`stack.tools[].name`** — records your own stack declares. ADR-0109: the
   default third-party path declares **none** (see *Tool metadata* below).
2. **`PLATFORM_PROVIDED_TOOL_NAMES`** — the 30 statically-registered platform
   tools, grouped by owning package in
   `packages/spec/src/system/constants/platform-tool-names.ts:38-82` — 6 data /
   knowledge tools from `service-ai` (`query_records`, `get_record`,
   `query_data`, `aggregate_data`, `search_knowledge`, `visualize_data`) and 24
   schema / metadata / package tools from `service-ai-studio`. Read that file for
   the exact set: it is the registry the lint rule checks against.
3. **`action_<name>`** — one tool per AI-exposed Action of your own stack
   (`PLATFORM_TOOL_FAMILY_PREFIXES`). **The default path** for anything your app
   does.

A name in none of the three raises **`ai-skill-tool-unresolved`** (warning,
ADR-0078 advisory-first). The rule exists because one audited app shipped 10
fictional tools across 6 skills through `validate` / `lint` clean, and became a
copilot claiming abilities it did not have.

### Skill Example

<!-- os:check -->
```typescript
import { defineSkill } from '@objectstack/spec';

export default defineSkill({
  name: 'case_management',
  label: 'Case Management',
  description: 'Triage, query, and escalate support cases.',
  instructions: `
    When managing cases:
    - Always check for duplicate cases before creating a new one.
    - Set priority by customer tier: Enterprise → High, Pro → Medium, Free → Low.
    - Escalated cases must summarise the actions already taken.
  `,
  // Every name resolves: two platform tools (rung 2) plus one action tool
  // materialised from this stack's own `escalate_case` Action (rung 3).
  tools: ['query_records', 'get_record', 'action_escalate_case'],
  triggerConditions: [
    { field: 'objectName', operator: 'eq', value: 'support_case' },
  ],
  active: true,
});
```

### Trigger Conditions

Each condition is `{ field, operator, value }`, ANDed with its siblings. The
shape of `value` is **coupled to `operator`** — a mismatch is a parse error, not
a coercion (`packages/spec/src/ai/skill.zod.ts:37-51, 139-202`):

| Operator | Meaning | `value` must be |
|:---------|:--------|:----------------|
| `eq` | Equals | a **string** — an array is reference identity, so it never matches |
| `neq` | Not equals | a **string** — an array would always fire |
| `in` | In list | an **array** (empty `[]` is allowed and is a real predicate) |
| `not_in` | Not in list | an **array** |
| `contains` | Substring, or array subset | **either** — both spellings execute |

Nothing matches phrases: write routing as `triggerConditions` and
natural-language intent in `description` / `instructions`, where the model reads it.

---

## Actions as AI Tools — the default path ☁️

You usually **don't author tool definitions by hand** for action invocation. An
`Action` attached to an object via `defineObject({ actions: [...] })` becomes a
tool named `action_<actionName>` **only when it opts in** — `ai.exposed: true`
(default `false`) plus an `ai.description` of ≥ 40 chars, refused by the parse
without it (ADR-0011). `registerActionsAsTools()` walks the opted-in ones;
exposure is never automatic, and there is no opt-out key.

Three action types dispatch headlessly:

| `action.type` | Dispatch | Wiring |
|:---|:---|:---|
| `script` | `IDataEngine.executeAction(object, target, ctx)` — same as Studio's row toolbar | none |
| `api` | HTTP call to `action.target` (`fetch`-based by default) | `AIServicePlugin({ apiActionBaseUrl, apiActionHeaders })` or a custom `apiClient` |
| `flow` | `IAutomationService.execute(target, { triggerData })` | `automation` service registered with the kernel |

**Skipped even when opted in:** UI-only types (`url`, `modal`, `form`); and
dangerous variants — the declared `mode: 'delete'` / `variant: 'danger'` only
(`confirmText` is dialog copy, *not* a destructive signal; `ai.requiresConfirmation`
overrides either way) — **unless** the plugin runs with `enableActionApproval: true`,
which routes them through the approval queue instead.

**`type:'api'` body assembly** (last wins): user params → `recordIdParam` (using
`recordIdField`, default `'id'`) → `bodyExtra`. `bodyShape: { wrap: 'data' }`
nests user params under `data` while keeping `recordIdParam` flat.

**Human-in-the-loop.** `AIServicePlugin({ enableActionApproval: true })` (default
`false`) persists an `ai_pending_actions` row instead of running a dangerous
action and returns `{ status: 'pending_approval', pendingActionId }`; an operator
approves or rejects in Studio's **AI Pending Actions** inbox (or via
`GET/POST /api/v1/ai/pending-actions/...`). Whether *your* action is held is
decided entirely by the skip rule above — `actionSkipReason(action, ctx)` and
`actionRequiresApproval(action)` (from `@objectstack/service-ai`) answer both
questions, and Studio's "AI exposure" diagnostics use the same predicates.

---

## MCP — the open-edition AI path

`@objectstack/mcp` publishes your app over the Model Context Protocol, so an
external agent (Claude, Cursor, Codex, …) can read it and act on it with **no
cloud licence**. (Consuming *external* MCP servers is the inbound sibling,
`@objectstack/connector-mcp`.)

```ts
import { MCPServerPlugin } from '@objectstack/mcp';

kernel.use(new MCPServerPlugin());
```

The HTTP surface is **default-on**, served per-request by the runtime dispatcher
at **`POST /api/v1/mcp`** — nothing to start (`OS_MCP_SERVER_ENABLED=false` opts
out). The long-lived **stdio** transport has its own switch and defaults off:
`autoStart: true`, or `OS_MCP_STDIO_ENABLED=true`. (`OS_MCP_SERVER_ENABLED=true`
still starts it — deprecated, and it warns at boot.)

The tools a client then sees — from `registerObjectTools` / `registerActionTools`,
each family gated by the caller's OAuth scopes, every call under the caller's
permissions and row-level security:

| Tools | What they do |
|:--|:--|
| `list_objects`, `describe_object` | schema introspection (system objects filtered out by default) |
| `query_records`, `get_record` | reads — filter, field selection, sorting, pagination |
| `aggregate_records` | GROUP BY totals; registered only when the data bridge implements `aggregate` |
| `validate_expression` | build-accurate CEL check before a formula is authored into metadata |
| `create_record`, `update_record`, `delete_record` | writes; `delete_record` is annotated destructive |
| `list_actions`, `run_action` | your AI-exposed business Actions — the same `ai.exposed` opt-in as above |

---

## Knowledge Sources (RAG)

The RAG primitive is the **KnowledgeSource** (`KnowledgeSourceSchema` in
`@objectstack/spec/ai`): declarative metadata pairing *what to index* with the id
of an `IKnowledgeAdapter` that does the work. There is no `defineStack`
collection for them — they are registered at runtime, and the ☁️
`search_knowledge` tool exposes registered sources to agents.

**Wiring (open packages).** `KnowledgeServicePlugin({ sources })` from
`@objectstack/service-knowledge` registers `IKnowledgeService` with the kernel and
each source at boot (`service.registerSource` still works later). The `adapter`
id resolves against an adapter plugin — `@objectstack/knowledge-memory`
(`'memory'`, dev/test) or `@objectstack/knowledge-ragflow` (`'ragflow'`);
without one the id is unresolvable.

| Property | Purpose |
|:---------|:--------|
| `id` | Snake_case source id |
| `label` / `description` | Display metadata |
| `adapter` | Adapter id (e.g. `'ragflow'`, `'memory'`), resolved via `IKnowledgeService.registerAdapter` |
| `adapterConfig` | Adapter-specific configuration (opaque to the service) |
| `source` | What gets indexed — discriminated on `kind`: `'object'` \| `'file'` \| `'http'` |
| `embedding` | Optional `EmbeddingModelSchema` ref (`provider`, `model`, `dimensions`) — adapters managing embeddings internally (RAGFlow, Dify, Vectara) may ignore it |
| `vectorStore` | Optional `VectorStoreSchema` ref (`provider`, `collection`) — same caveat |
| `refresh` | `onRecordChange` (default `true` for object sources) + optional `cron` (for an external scheduler; not self-scheduled) |
| `aiExposed` | May `search_knowledge` expose this source to agents (default `true`) — `false` indexes it without making it agent-searchable |

| `source.kind` | Fields | Hygiene |
|:--------------|:-------|:--------|
| `object` | `object`, `contentFields[]` (min 1; `*` = every readable text field), `metadataFields?`, `where?` (ObjectQL `where` syntax) | `where` keeps drafts and archived rows out of the index; `contentFields` takes meaningful text only (never system fields or ids, `*` sparingly); project what you will filter on at query time (`status`, `owner_id`, `tags`) into `metadataFields` |
| `file` | `prefix` (storage prefix, e.g. `kb/handbooks/`), `mimeTypes?` | narrow the prefix instead of indexing a whole bucket |
| `http` | `urls[]`, `userAgent?` | enumerate URLs explicitly — there is no crawler |

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

> **Chunking, top-K, score thresholds and rerankers are NOT platform metadata.**
> The spec scopes them out deliberately (`embedding.zod.ts`): they belong to the
> adapter (`adapterConfig`) or application code. The platform carries only the
> embed + vector primitives, so any RAG strategy can be built on top.

---

## Tool metadata (`defineTool`) — not the default path

**Default: declare no tool records.** A skill names a platform tool or an
`action_<name>` (ladder above). ADR-0109: a `stack.tools` record "exists only for
AI-presentation refinement (Phase 2: LLM description, parameter narrowing, flow
exposure) and has no runtime reader until that lands"
(`packages/spec/src/stack.zod.ts:595-602`). Author one only to refine how an
existing capability is *presented* — never to add one, and never to make
something executable: `ToolSchema` has no `handler` / `implementation` field, and
no framework executor loads a metadata-authored tool.

`ToolSchema` is **strict** — an unknown key (a typo, or a retired one) is a parse
error, not a silent strip. Required `name` / `label` / `description` and a JSON
Schema `parameters` object; optional `objectName` and `outputSchema` (⚠️
experimental — its top-level keys are folded into the tool description shown to
the model, and outputs are **not** validated). Retired in protocol 17:
`category`, `permissions`, `active`, `builtIn` — all authorable and inert —
joining `requiresConfirmation`; each rejection carries its replacement.

Gate what a tool can do on the underlying action (`action.requiredPermissions`,
ADR-0066) or the objects it touches; to withdraw one, remove it from the skills
referencing it. Categorization belongs on the action (`action.ai.category` —
live, but listing-only: carried onto the tool, never sent to the model).

---

## Model Configuration

Sampling parameters live under an agent's `model` (`AIModelConfigSchema`) —
there is **no top-level `temperature` / `maxTokens`** on an agent
(`packages/spec/src/ai/agent.zod.ts:36-40`):

| Key | Contract |
|:--|:--|
| `provider` | Inline enum `openai` \| `azure_openai` \| `anthropic` \| `local` (default `openai`). **Model-registry** entries (`ModelProviderSchema`) accept a wider set: also `google`, `cohere`, `huggingface`, `custom` |
| `model` | Free string — the provider's own model name |
| `temperature` | `min(0).max(2)`, default `0.7`. **Outside 0–2 is a parse error** |
| `maxTokens` / `topP` | Optional numbers, unbounded by the schema |

---

## Common Pitfalls

1. **Mistaking `guardrails` for a gate.** `guardrails` / `memory` /
   `structuredOutput` are declared only — no runtime reads them, and real limits
   come from the quota service. For a gate that is **enforced**, use
   `enableActionApproval: true` (approval queue ☁️), `ai.requiresConfirmation` on
   the **action**, or `approval: 'always'` on an MCP tool binding. AI metadata
   edits are already gated: they land as drafts a human must publish (ADR-0033).
   ⚠️ `requiresConfirmation` on the **tool** was REMOVED (ADR-0033 §2) — no
   execution path read it, so it produced no pause; `ToolSchema` is strict, so
   authoring it now fails the parse. There is no `requireApprovalFor` field.
2. **Indexing everything.** A knowledge source without a `where` filter and
   curated `contentFields` fills the index with drafts and boilerplate that
   pollute retrieval. Source hygiene is the metadata's job; relevance tuning
   belongs to the adapter.

---

## App AI Blueprint

| Layer | File | Pattern |
|:--|:--|:--|
| Reusable skill | `src/skills/lead-qualification.skill.ts` | `defineSkill` — `instructions` + trigger conditions + a toolset where every name resolves; pick a `surface` |
| Knowledge source | `src/knowledge/sales-kb.ts` | `KnowledgeSourceSchema` metadata, registered at boot via `KnowledgeServicePlugin({ sources })` |
| Central registration | `defineStack({ skills: [...] })` | `agents` / `tools` / `skills` are the only AI stack collections — knowledge sources have none, agents are platform-supplied, and `tools` is not the default path |

Default for metadata apps: push business capability into **skills**, expose
business logic as **AI-exposed Actions**, wire domain knowledge through
**knowledge sources**.

---

## Platform agents — reference only ☁️

The `agent` type is **closed** to third parties (`allowRuntimeCreate:false`,
`allowOrgOverride:false`; ADR-0063 §2) and `os g agent` is retired: a
stack-authored agent is filtered out of `listAgents()`, refused outright by
`loadAgent()`, and 404s on chat. You extend the platform with **skills**, never
by adding an agent. `AgentSchema`'s full field list is in
[references/_index.md](./references/_index.md).

The runtime ships **exactly two** agents, bound by *surface* — the user never
picks from a roster, the surface they are in selects the agent. **`ask`** is the
data product (≈ Claude Chat): conversational read / query / explore over records
plus running the business actions the app exposes, end-user audience,
RLS-bounded, canonical id `ask` (`ASK_AGENT_NAME`), and the implicit copilot for
any app that does not pin `app.defaultAgent`. **`build`** is the authoring
product (≈ Claude Code): agentic authoring of *metadata* through plan → draft →
verify → publish, builder audience, governance-gated, pinned by Studio via
`app.defaultAgent`. There is **no per-turn intent classifier** — a `build`-shaped
request arriving at `ask` is declined and redirected, never silently re-routed
into authoring (ADR-0063 §1/§5). `data_chat`→`ask` and
`metadata_assistant`→`build` resolve through the alias table for old bookmarks
and persisted `agent_id`s; they are **not** vocabulary — always write `ask` /
`build`.

An agent's tool set is the **union of its surface-compatible skills' tools** —
there is no global fall-through (ADR-0064), so `ask` cannot author by
construction; deactivating a skill (`active: false`) revokes that capability for
every agent referencing it. The built-in skills:

| Skill | `surface` | Owns |
|---|---|---|
| `schema_reader` | `both` | `list_objects`, `describe_object`, `query_data` |
| `data_explorer` | `ask` | `query_records`, `get_record`, `aggregate_data`, `visualize_data` |
| `actions_executor` | `ask` | `action_*` (the business actions an object exposes) |
| `metadata_authoring` + `solution_design` | `build` | metadata draft / verify / publish + blueprint propose / apply |

All four are cloud-runtime skills — none resolves on the open edition, so
`surface` / `tools` / `triggerConditions` on your own skills are authored for
cloud and inert there; their `instructions` are what MCP serves.
`visualize_data` is the only built-in that draws a chart (an inline `data-chart`
part), auto-registered **only** when an analytics service (`IAnalyticsService`)
is wired — `query_data` / `aggregate_data` return numbers, not charts.

Two `AgentSchema` keys are **tombstones**, not legacy options — authoring either
is a parse error carrying its migration
(`packages/spec/src/ai/agent.zod.ts:234, :251`):

| Retired key | REMOVED in protocol 17 — why, and what replaces it |
|:--|:--|
| `agent.tools` | The inline slot resolved names against the *full* registry with no surface check. Not a rename: the migration deletes the key and names each tool that was listed; re-declare each in a skill (ADR-0064) |
| `agent.knowledge` | Declaring sources/indexes on an agent never scoped retrieval — `search_knowledge` takes `sourceIds` from the model's tool-call arguments. Restrict at the knowledge-service / source level; describe intended grounding in `instructions` |

---

## Verify your work

After authoring a `*.skill.ts` / `*.tool.ts` or a model-registry entry, run the
author-time gate before reporting done:

```bash
os validate     # Zod schema + CEL predicate validation + bindings (no artifact)
# or: os build  # the same gates, plus emits dist/
```

It confirms the skill / tool / model metadata conforms to the protocol. This
domain has no CEL site — a model-registry `promptTemplate.system` / `.user` is
the `template` dialect (`{{var}}`); `ToolSchema` carries no expression field of
any kind. In a scaffolded project the gate is `npm run validate`. See
objectstack-platform → **Verify your work**.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.
