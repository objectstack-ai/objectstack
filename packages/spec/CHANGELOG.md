# @objectstack/spec

## 6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- 6e88f77: Auto-persist chat history when a `conversationId` is supplied.

  - `AIService.chatWithTools` and `streamChatWithTools` now write the inbound user turn, each intermediate assistant/tool round, and the final assistant turn to `ai_messages` whenever `toolExecutionContext.conversationId` is set. Persistence is best-effort: failures are warned and never break the chat response.
  - Add `IAIConversationService.update(conversationId, { title?, metadata? })` and a matching `PATCH /api/v1/ai/conversations/:id` route so clients can rename conversations and edit metadata.
  - `ObjectQLConversationService` and `InMemoryConversationService` both implement the new `update` method.

## 6.7.1

## 6.7.0

### Minor Changes

- 430067b: Introduce `IEmbedder` protocol and extract `@objectstack/embedder-openai` plugin.

  **What's new**

  - **`IEmbedder` contract** (`@objectstack/spec/contracts/embedder.ts`) — protocol-level interface for text → vector providers. One contract covers cloud APIs (OpenAI / 阿里通义 / 智谱 / 硅基流动 / 火山 Doubao / MiniMax), local Ollama daemons, and in-process embedders.
  - **`@objectstack/embedder-openai`** — new package. Drop-in for any OpenAI-shape endpoint via `baseUrl`. Ships preset constants for 8 mainstream providers (`createOpenAIEmbedder({ preset: 'siliconflow', ... })`) and pre-baked dimensions for 16+ popular models.

  **Breaking changes (`@objectstack/knowledge-turso`)**

  - `OpenAIEmbeddingProvider` is **removed** — install `@objectstack/embedder-openai` and use `OpenAIEmbedder` instead (identical option shape).
  - `EmbeddingProvider` type alias kept as a deprecated re-export of `IEmbedder` for smoother migration; will be removed in a future major.
  - `HashEmbeddingProvider` is now an alias for the renamed `HashEmbedder` class — no functional change.

  **Migration**

  ```diff
  - import { OpenAIEmbeddingProvider } from '@objectstack/knowledge-turso';
  + import { OpenAIEmbedder } from '@objectstack/embedder-openai';

  - const embedding = new OpenAIEmbeddingProvider({ apiKey });
  + const embedding = new OpenAIEmbedder({ apiKey });
  ```

  For 国内 providers, use presets:

  ```ts
  import { createOpenAIEmbedder } from "@objectstack/embedder-openai";
  const embedding = createOpenAIEmbedder({
    preset: "siliconflow", // or 'dashscope', 'zhipu', 'doubao', 'ollama', …
    apiKey: process.env.SILICONFLOW_API_KEY!,
    model: "BAAI/bge-m3",
  });
  ```

- 4f9e9d4: Settings → runtime bridge: `embedder_*` settings now build a real
  `IEmbedder` and register it as a kernel-level DI service.

  **`@objectstack/spec`**

  - Exports `EMBEDDER_SERVICE = 'embedder'` from `contracts/embedder.ts`
    as the canonical DI token for the kernel-registered embedder.

  **`@objectstack/service-ai`**

  - Adds `@objectstack/embedder-openai` as an **optional peer dependency**
    (matches the `@ai-sdk/*` provider plugins pattern).
  - `AIServicePlugin.bindSettings()` now also:
    - Reads `embedder_provider` / `embedder_api_key` / `embedder_model` /
      `embedder_base_url` / `embedder_dimensions` from the `ai` namespace.
    - Dynamically imports `@objectstack/embedder-openai` and constructs
      an `OpenAIEmbedder` via `createOpenAIEmbedder({ preset, … })`.
    - Registers / replaces the instance under `EMBEDDER_SERVICE`. When
      the operator sets `embedder_provider = none`, the service is left
      unset so adapters can fail fast with a clear message.
    - Subscribes to `settings:changed` for the `ai` namespace so embedder
      swaps go live without restart (mirrors the chat-adapter pattern).
    - Overrides the manifest's fallback `ai/test_embedder` action with a
      live one-shot `embed(['ping'])` round-trip against the form's
      (possibly unsaved) values. Reports vector dims + latency.

  **`@objectstack/knowledge-turso`**

  - `KnowledgeTursoPlugin`'s `embedding` constructor option is now
    **optional**. When omitted, the plugin resolves `EMBEDDER_SERVICE`
    from the kernel at `start()` time — typically the embedder built by
    `@objectstack/service-ai` from the `ai` settings namespace.
  - Explicit `embedding` still wins when both are present (useful for
    tests and multi-embedder setups).
  - Logs `(embedder=<id>, dims=<n>)` on adapter registration so operators
    can confirm wiring at a glance.
  - When neither path resolves, the plugin warns with a one-line hint
    pointing to `Settings → AI & Embedder` and no-ops gracefully (the
    host kernel still boots).

  **Tests**

  - `service-ai`: +5 cases (now 85) covering `ai/test_embedder` action
    registration, `provider=none` warning, missing-api-key error,
    custom-provider-without-base-URL error, and the full happy path
    (mocked fetch → embedder registered under `EMBEDDER_SERVICE` →
    test_embedder action returns vector dims).
  - `knowledge-turso`: new `plugin.test.ts` (+5 cases) covering deferred
    construction, EMBEDDER_SERVICE fallback, explicit-wins precedence,
    missing-both warn-and-noop, and missing-knowledge-service warn.

  End-to-end now possible: operator opens **Settings → AI & Embedder**,
  picks 硅基流动 + paste API key + chooses `BAAI/bge-m3`, hits **Save**.
  Within the same process, `EMBEDDER_SERVICE` is registered/replaced,
  `KnowledgeTursoPlugin` (if started without an explicit embedder)
  picks it up, and subsequent `knowledge.search()` calls embed via the
  new provider — no restart, no env vars.

## 6.6.0

### Minor Changes

- a49cfc2: Add `compareTo` field to `DashboardWidgetSchema` and `variant` / `dashArray` /
  `opacity` to `ChartSeriesSchema` so renderers can express period-over-period
  overlays on metric / gauge / chart widgets.

  `compareTo` accepts `'previousPeriod'`, `'previousYear'`, or
  `{ offset: '7d' | '4w' | '1M' | '1y' }`. The renderer issues a second query
  against the shifted filter and either (a) derives a trend delta for KPI
  widgets or (b) overlays a muted comparison series on cartesian charts.

## 6.5.1

## 6.5.0

### Patch Changes

- Fix: update `package.json` `exports` to use nested `import`/`require` conditions with per-condition `types` fields (e.g. `import.types → index.d.mts`, `require.types → index.d.ts`). This ensures TypeScript with `moduleResolution: "bundler"` resolves to the ESM declaration file (`.d.mts`) which uses explicit `.mjs` chunk imports — eliminating the intermittent TS2306 "is not a module" error that occurred when tsup's DTS worker processed the CJS declaration chain.

## 6.4.0

### Minor Changes

- f8651cc: Knowledge Protocol MVP — protocol-first RAG via adapter plugins.

  **What's new:**

  - `@objectstack/spec` — new `KnowledgeSource` / `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeHit` schemas (under `@objectstack/spec/ai`) and `IKnowledgeService` / `IKnowledgeAdapter` contracts (under `@objectstack/spec/contracts`).
  - `@objectstack/service-knowledge` — `KnowledgeService` orchestrator + `KnowledgeServicePlugin`. Routes search/index calls to the appropriate adapter, runs **permission-aware retrieval** by re-checking every hit's `sourceRecordId` against the caller's `ExecutionContext` via `IDataEngine` (same RLS that gates plain ObjectQL), and subscribes to `IRealtimeService` for inline record→adapter sync.
  - `@objectstack/knowledge-memory` — deterministic, dependency-free in-memory adapter for dev/tests/reference. Hash-token embedder + brute-force cosine + paragraph chunking.
  - `@objectstack/knowledge-ragflow` — production-grade adapter against the Apache-2.0 [RAGFlow](https://github.com/infiniflow/ragflow) REST API. Plug in your dataset id; ObjectStack handles permission filtering after retrieval.
  - `@objectstack/service-ai` — new `search_knowledge` tool wired through the registry. Threads the LLM caller's actor into `KnowledgeService.search` so retrieval honours RLS automatically.

  **Why this design:** ObjectStack does NOT own chunking / embedding / vector storage / rerank — those are commodity capabilities best handled by mature OSS (RAGFlow, LlamaIndex, Dify, …). What ObjectStack uniquely owns is the protocol + permission-aware orchestration on top.

  See `content/docs/protocol/knowledge.mdx` for the full design.

- f8651cc: AI tools now execute with the end-user's `ExecutionContext`, so the
  existing ObjectQL row-level-security rules automatically scope what an
  agent can read and mutate.

  **What changed**

  - New `ToolExecutionContext` (on `@objectstack/spec/contracts`'s
    `ChatWithToolsOptions`) carries the authenticated actor, conversation
    id, and environment id through to tool handlers.
  - The built-in data tools (`query_records`, `get_record`,
    `aggregate_data`, legacy `query_data`) and the auto-generated
    `action_*` tools now pass `options.context` to `IDataEngine` calls,
    mapping the actor to `{ userId, roles, permissions, isSystem: false }`.
  - Assistant + agent REST routes forward `req.user` into the new
    context automatically — no caller changes required.
  - When no actor is provided (cron jobs, internal callers, existing tests)
    the helpers fall back to `{ isSystem: true }`, preserving today's
    behaviour. **Fully backward compatible.**

  **Why this matters**

  Before this change, an AI tool call ran with system privileges and saw
  every row in the tenant. Now the agent sees exactly what the human
  operator would see — same RLS, same field-level masking, same audit
  trail. This is the foundation for trustworthy autonomous agents.

  **For custom call sites**

  If you invoke `aiService.chatWithTools(...)` from your own route, pass
  `toolExecutionContext: { actor: { id, roles, permissions } }` to inherit
  the user's permissions. Omit it to keep the legacy system-level
  behaviour.

- 0bf6f9a: Add `Portal` metadata kind for external-user UI projections.

  A `Portal` declares a public-facing "site" derived from an existing `App` (or a curated subset of objects/views), with its own theme, authentication mode (anonymous / passwordless / sso), custom routes, and per-route guards. This is the protocol surface for the "customer portal" use case — partner sites, public booking, support knowledge bases — without forking the back-office `App`.

  **New exports under `@objectstack/spec/ui`:**

  - `PortalSchema`, `Portal` — Zod schema + inferred type.
  - `PortalRouteSchema`, `PortalRoute` — per-route configuration (view ref, layout, auth requirement, sharing scope).
  - `PortalAuthModeSchema` — enum of auth strategies (`anonymous`, `passwordless`, `oauth`, `sso`).
  - `definePortal()` — DX builder mirroring `defineApp()`.

  **Stack composition:** `composeStacks()` now accepts and merges `portals` alongside `apps`, `objects`, `views`, etc.

  No runtime / app behaviour change — this ships the protocol contract first so plugins, Studio, and the runtime can land Portal support in subsequent releases.

## 6.3.0

## 6.2.0

### Patch Changes

- b4c74a9: **Actions-as-tools Phase 3 — Human-In-The-Loop approval queue.**

  Dangerous declarative actions (`confirmText`, `mode:'delete'`, `variant:'danger'`) can now be exposed to the LLM safely. Instead of being skipped outright, they are registered as tools whose handler enqueues a pending request and returns `{ status: 'pending_approval', pendingActionId }` to the model. A human approves (or rejects) from Studio's pending-actions inbox; the service then re-runs the exact same dispatcher.

  ### New surface

  - New system object `ai_pending_actions` (id, conversation_id?, message_id?, object_name, action_name, tool_name, tool_input, status [`pending`|`approved`|`executed`|`failed`|`rejected`], result?, error?, rejection_reason?, proposed_by, decided_by?, proposed_at, decided_at?).
  - New built-in Studio view `AiPendingActionView` with `pending` / `executed` / `rejected` / `failed` sub-views and per-row **Approve** / **Reject** API actions.
  - New methods on `IAIService` (all optional, gated on a wired `IDataEngine`):
    - `proposePendingAction(input) → { id }`
    - `approvePendingAction(id, actorId) → { status, result?, error? }`
    - `rejectPendingAction(id, actorId, reason?)`
    - `listPendingActions(filter?) → PendingActionRow[]`
  - New exported types: `PendingActionStatus`, `ProposePendingActionInput`, `PendingActionRow`.
  - New REST routes (auth required):
    - `GET    /api/v1/ai/pending-actions` (`ai:read`)
    - `GET    /api/v1/ai/pending-actions/:id` (`ai:read`)
    - `POST   /api/v1/ai/pending-actions/:id/approve` (`ai:approve`)
    - `POST   /api/v1/ai/pending-actions/:id/reject` (`ai:approve`)
  - New exported predicate `actionRequiresApproval(action)` for Studio's exposure surface.

  ### Wiring

  `AIServicePluginOptions` gains `enableActionApproval?: boolean` (default `false`). When `true` and an `IDataEngine` is available, dangerous actions are registered and routed through the queue.

  ```ts
  kernel.use(
    new AIServicePlugin({
      enableActionApproval: true, // opt in
      apiActionBaseUrl: "http://localhost:3000",
    })
  );
  ```

  ### Internals

  - `actionSkipReason()` accepts `enableActionApproval` + `aiService` in its ctx and stops returning `"requires confirmation"` / `"mode='delete'"` / `"variant='danger'"` when HITL is wired.
  - `registerActionsAsTools()` pre-registers a _bypass-approval_ dispatcher per dangerous tool via `aiService.registerPendingActionDispatcher(toolName, fn)`; approval calls back into the same code path with `enableActionApproval` flipped off, so a single handler implementation serves both proposal and execution.
  - `createActionToolHandler()` short-circuits to `proposePendingAction()` when `enableActionApproval && actionRequiresApproval(action) && ctx.aiService?.proposePendingAction`.

  ### Out of scope (deferred)

  Slack/email notifications, approver routing (any signed-in user can approve in v1), auto-expiry of pending requests, resuming the same LLM turn after approval (operators get a fresh assistant message instead).

## 6.1.1

## 6.1.0

### Minor Changes

- 93c0589: **AI v1: Actions-as-Tools** — every declarative UI `Action` of `type: 'script'`
  is now auto-exposed as an AI-callable tool named `action_<name>`. Agents can
  perform business operations ("complete the groceries task") via natural
  language, routed through the same `dataEngine.executeAction()` dispatcher
  Studio uses. This is the write-side counterpart to `query_data`.

  **Highlights**

  - `registerActionsAsTools(toolRegistry, { metadata, dataEngine })` walks every
    object's `actions[]` and registers script-type ones, auto-injecting a
    `recordId` argument for row-context actions and inheriting JSON-Schema
    parameter types from the owning object's fields.
  - Safety filters skip destructive actions by default: `confirmText`,
    `mode: 'delete'`, `variant: 'danger'`, or explicit `aiExposed: false`.
  - New `aiExposed?: boolean` flag on `ActionSchema` for fine-grained opt-out.
  - New `actions_executor` skill bundle subscribes to `action_*` (wildcard
    tool names now supported in `SkillSchema.tools`).
  - The built-in `data_chat` agent now references both `data_explorer` and
    `actions_executor` skills, so users get read + write capabilities out of
    the box.
  - `MemoryLLMAdapter` learned a small two-step heuristic — when it sees an
    action verb ("complete", "start", "clone", ...) it routes to the matching
    `action_*` tool, resolving `recordId` from any prior `query_data` result.
  - New `examples/app-todo/test/ai-action.test.ts` demo proves the loop:
    user says "please complete the groceries task" → agent finds the task →
    agent calls `action_complete_task` → task status flips → `ai_traces`
    records the run.

  **Breaking changes**

  None. `aiExposed` is additive; existing actions remain exposed unless
  they fail an existing safety filter.

  **Phase-1 limitations** (Phase-2 roadmap items)

  - Only `type: 'script'` actions; `api`/`flow`/`url`/`modal`/`form` skipped.
  - No human-in-the-loop approval flow for destructive actions yet.
  - No CEL evaluation of `visible`/`disabled` predicates against agent context.
  - No bulk action support (single-record only).

## 6.0.0

### Major Changes

- 629a716: # v1 AI Protocol focusing — remove application-template schemas

  The `@objectstack/spec/ai` protocol is reduced to **only the primitives
  the runtime directly consumes**. Eight schemas that described
  application templates or product features (not platform contracts) are
  removed; three more are slimmed to their primitive cores.

  ## Removed (8 files, ~4,700 lines)

  | File                           | Reason for removal                                                                |
  | ------------------------------ | --------------------------------------------------------------------------------- |
  | `ai/devops-agent.zod.ts`       | A specific Agent template, not a primitive. Compose with `Agent + Skill + Tool`.  |
  | `ai/plugin-development.zod.ts` | Specific workflow; same reasoning.                                                |
  | `ai/runtime-ops.zod.ts`        | AIOps is a vertical product, not a backend platform concern.                      |
  | `ai/predictive.zod.ts`         | ML pipeline product (DataRobot/H2O space), orthogonal to metadata-driven backend. |
  | `ai/agent-action.zod.ts`       | 100% conceptual overlap with `tool` + `flow`.                                     |
  | `ai/orchestration.zod.ts`      | Multi-agent plans can be expressed as agents-as-tools. Premature.                 |
  | `ai/nlq.zod.ts`                | NLQ is LLM-native capability + a `query_data` tool over ObjectQL, not a protocol. |
  | `ai/feedback-loop.zod.ts`      | RLHF / training-side concern; not platform-owned.                                 |

  ## Slimmed (3 files)

  - **`ai/rag-pipeline.zod.ts` → `ai/embedding.zod.ts`** (318 → 80 lines).
    Keeps `EmbeddingModelSchema` + `VectorStoreSchema` primitives.
    Removed: chunking strategies, retrieval pipelines, rerankers,
    document loaders, end-to-end RAG pipeline DSL. The `ragPipelines`
    field on `defineStack()` is removed.
  - **`ai/cost.zod.ts` → `ai/usage.zod.ts`** (431 → ~70 lines).
    Keeps `TokenUsageSchema` + `AIUsageRecordSchema`. Model pricing is
    the canonical `ModelPricingSchema` already exported from
    `ai/model-registry.zod.ts`. Removed: budget definitions,
    enforcement, alerts, allocation reports, optimization
    recommendations.
  - **`ai/mcp.zod.ts`** (629 → ~100 lines). Defines only how to
    _reference_ an external MCP server and _bind_ its tools to an
    agent. The MCP protocol itself is owned by Anthropic's published
    spec and the `@modelcontextprotocol/sdk`; we no longer re-declare
    transport/capability/resource/prompt/streaming/sampling shapes.

  ## Migration

  No production code in this repository depended on the removed
  schemas. Downstream consumers that imported any of the removed types
  from `@objectstack/spec/ai` must:

  1. **Remove the import.** The platform no longer provides these types.
  2. **Define your own application-level shape** in your project / plugin
     if you still need the concept. The primitives (`Agent`, `Skill`,
     `Tool`, `Conversation`, `Embedding`, `Usage`, `MCP{ServerRef,ToolBinding}`)
     are sufficient to express every removed schema.
  3. For RAG: replace `RAGPipelineConfig` with your own pipeline
     description built on `EmbeddingModelSchema` + `VectorStoreSchema`.
  4. For cost: replace budget enforcement with your own service built
     on `AIUsageRecordSchema` records.

  ## Why

  The platform's job is to define **primitives that any AI feature can
  be built on top of**, leveraging the metadata-driven nature of
  ObjectStack. The removed schemas described specific product features
  (DevOps agent, AIOps, RAG pipeline DSL, budget enforcement) that
  should live in plugins or applications — not in the canonical
  protocol. Shipping a 6,245-line AI protocol where 80% of it has no
  runtime implementation creates false promises to integrators.

  After this change the AI protocol is:

  ```
  ai/
  ├── agent.zod.ts          ← who
  ├── skill.zod.ts          ← when
  ├── tool.zod.ts           ← what
  ├── conversation.zod.ts   ← what to remember
  ├── model-registry.zod.ts ← which LLMs
  ├── embedding.zod.ts      ← embedding + vector store primitives
  ├── usage.zod.ts          ← token + cost accounting
  └── mcp.zod.ts            ← external ecosystem bridge
  ```

  8 files, ~1,200 lines. Every schema has a runtime implementation in
  `@objectstack/service-ai` or `@objectstack/plugin-mcp-server`.

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Minor Changes

- dbc4f7d: feat(ai): v1 AI capabilities — ModelRegistry, structured output, tracing, schema retrieval, and `query_data` tool

  This release lights up the first concrete capabilities on the slimmed AI protocol. All additions are
  non-breaking — new contract methods are optional and existing callers keep working unchanged.

  ### What's new

  - **ModelRegistry** (`@objectstack/service-ai`): in-memory runtime registry for `AI.ModelConfig`.
    Wire models via `AIServicePluginOptions.models` / `defaultModelId`. Exposes `get`, `getOrThrow`,
    `getDefault`, `list`, and `estimateCost(modelId, usage)` for ex-post token cost computation.

  - **ai_traces object + auto-tracing**: every LLM call from `AIService` (`chat`, `complete`,
    `stream_chat`, `chat_with_tools`, `generate_object`, `embed`) is now instrumented with latency,
    token usage, status, and (when pricing is registered) cost. The default `ObjectQLTraceRecorder`
    is auto-wired when the runtime exposes an `IDataEngine`, persisting rows to the new `ai_traces`
    object. Drop in a custom `TraceRecorder` via `AIServicePluginOptions.traceRecorder`, or pass
    `null` to opt out.

  - **Structured output (`IAIService.generateObject`)**: new optional method on `IAIService` and
    `LLMAdapter` that returns a parsed, schema-validated object instead of free-form text.
    Implemented end-to-end in `VercelLLMAdapter` (uses the AI SDK's `generateObject` — provider
    strict-mode is automatic when supported). `MemoryLLMAdapter` ships a deterministic heuristic
    implementation so tests and demos work without an API key.

  - **SchemaRetriever**: lightweight keyword-based retriever over `IMetadataService.listObjects()`.
    Scores by object name (×3), label/plural (×2), description (×1), field name (×2), and field
    label (×1) with English stop-word filtering. Tokenisation splits snake_case so `todo_task` in
    a query matches `name: 'todo_task'`. `SchemaRetriever.renderSnippet()` produces a Markdown
    block ready to inject into a system prompt — no embeddings, no extra infra.

  - **`query_data` tool**: auto-registered when AI + Metadata + Data engine are all present. Takes
    a natural-language `request`, retrieves relevant schemas, asks the model for a structured
    `QueryPlan` via `generateObject`, validates the plan targets a real object, and executes it
    through `IDataEngine.find`. Returns `{ plan, count, records }`. The composed primitive that
    closes the loop from "ask in English" → "validated SQL-shaped result".

  - **Working demo in `examples/app-todo`**: `pnpm --filter @example/app-todo test:ai` boots the
    full Todo stack, invokes `query_data` against the seeded tasks, and verifies the call lands
    in `ai_traces`. Zero API keys, ~3 seconds end-to-end. Serves as the canonical reference for
    wiring AI into a real app.

  ### Hardening

  - Strict tool schemas: nested `orderBy` and `aggregations` items in `data-tools` now declare
    `additionalProperties: false` + `required`, matching the top-level contract and making them
    safe for provider strict mode.

  ### Breaking-ish

  - `TraceOperation` values are now snake_case (`stream_chat`, `chat_with_tools`, `generate_object`)
    to match the project's data-value convention and so the `ai_traces.operation` select validates.
    Custom `TraceRecorder` implementations that hard-code the old camelCase names need to be
    updated. The values are an internal observability artefact — no public protocol surface
    exposes them.

  ### Notes

  - `zod` is now a direct dependency of `@objectstack/service-ai` (previously transitive via `ai`)
    because contract signatures and the new tool definition use `z.ZodType` types directly.
  - All new methods on `IAIService` / `LLMAdapter` are optional — existing custom adapters and
    callers continue to work without changes.
  - 12 new unit tests cover `ModelRegistry` (cost math, defaults, throwing lookups) and
    `SchemaRetriever` (scoring, snake_case tokenisation, limits, snippet rendering).
    Full suite: 323/323 ✓.

## 5.2.0

### Minor Changes

- fa011d8: feat(studio): metadata history timeline viewer

  Adds a new `history` view mode that surfaces the audit timeline produced by `sys_metadata_history` (ADR-0008 §5) inside Studio. Available for every metadata type as a wildcard built-in plugin.

  - `@objectstack/spec`: extend `ViewModeSchema` with `'history'`.
  - `@objectstack/studio`: new `historyViewerPlugin` rendering an event timeline (create/update/delete/rename) with op icons, short hash, actor, source, expandable detail panel. ADR-0009 `executionPinned` types (`flow`, `workflow`, `approval`) show a "Pinned" badge explaining that historical versions are retained for in-flight executions.

  Reads from the existing `GET /meta/:type/:name/history` REST endpoint via `client.meta.getHistory()`; no new server surface.

### Patch Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

## 5.1.0

### Minor Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

## 5.0.0

### Minor Changes

- 2f9073a: Add `_sections` to `ObjectTranslationData` so per-section labels on detail
  pages can be authored alongside `_views` and `_actions`. Convention:
  `objects.<object>._sections.<section_name>.label`. Consumed by
  `@object-ui/plugin-detail` when sections declare a stable `name`.

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

## 4.1.1

## 4.1.0

### Minor Changes

- 23db640: `record:highlights` now accepts richer field items.

  Each entry in `fields` may be either a bare field name (backward compatible) or an object `{ name, label?, icon?, type? }` that lets the schema override the displayed label, attach a Lucide icon, or force a specific cell renderer without editing the underlying object metadata. Useful when the same field appears in multiple highlight strips with different framing (e.g. "Annual Revenue" vs "ARR") or when you want a tiny icon for status-like fields.

### Patch Changes

- 2108c30: `ActionParamSchema.required` now defaults to `false` (was effectively `undefined`). Functionally equivalent for existing consumers (which check truthiness), but makes the parsed object shape complete and unblocks downstream type narrowing. Fixes pre-existing failing test `action.test.ts > should accept minimal action parameter`.

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

### Patch Changes

- 326b66b: fix: studio CI test failures and metadata protocol mock handler improvements

## 4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai

## 4.0.0

### Minor Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

## 3.3.1

### Minor Changes

- AI Agent/Skill/Tool metadata protocol refactoring (aligned with Salesforce Agentforce, Microsoft Copilot Studio, ServiceNow Now Assist)
  - **Tool as first-class metadata** (`src/ai/tool.zod.ts`): `ToolSchema`, `ToolCategorySchema`, `defineTool()` factory. Fields: name, label, description, category, parameters (JSON Schema), outputSchema, objectName, requiresConfirmation, permissions, active, builtIn.
  - **Skill as ability group** (`src/ai/skill.zod.ts`): `SkillSchema`, `SkillTriggerConditionSchema`, `defineSkill()` factory. Fields: name, label, description, instructions, tools (tool name references), triggerPhrases, triggerConditions, permissions, active.
  - **Agent protocol updated**: Added `skills: string[]` for Agent→Skill→Tool architecture; existing `tools` retained as backward-compatible fallback. Added `permissions: string[]` for access control.
  - **Metadata registry**: `tool` and `skill` registered as first-class metadata types in `MetadataTypeSchema` and `DEFAULT_METADATA_TYPE_REGISTRY` (domain: `ai`, filePatterns: `**/*.tool.ts`, `**/*.skill.ts`, etc.)
  - **Exports**: `defineTool`, `defineSkill`, `Tool`, `Skill` exported from `@objectstack/spec` root and `@objectstack/spec/ai` subpath.

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

### Patch Changes

- 46defbb: Fix filter operators (contains, notContains, startsWith, endsWith, between, null) broken across spec and memory driver

  - Add `$notContains` to `StringOperatorSchema`, `FieldOperatorsSchema`, `FILTER_OPERATORS`, and `Filter` type
  - Add `notcontains` / `not_contains` to `VALID_AST_OPERATORS` and `AST_OPERATOR_MAP`
  - Fix memory driver `convertToMongoQuery()` passthrough to normalize non-standard operators to Mingo-compatible format
  - Add `$notContains` and `$null` operators to memory matcher
  - Fix undefined value guard in memory matcher to exclude `$exists`, `$ne`, and `$null`

## 3.2.1

### Patch Changes

- 850b546: Maintenance patch release

## 3.2.0

### Minor Changes

- 5901c29: feat: auto-merge actions into object metadata via objectName

  - Added optional `objectName` field to `ActionSchema` for associating actions with specific objects
  - Added optional `actions` field to `ObjectSchema` to hold object-scoped actions
  - `defineStack()` and `composeStacks()` now auto-merge top-level actions with `objectName` into their target object's `actions` array
  - Added cross-reference validation for `action.objectName` referencing undefined objects
  - Top-level `actions` array is preserved for global access (platform overview, search)
  - Updated example apps (CRM, Todo) to use `objectName` on their action definitions

## 3.1.1

### Patch Changes

- 953d667: Add modal cross-reference validation, action handler examples, and action.mdx doc sync

## 3.1.0

### Minor Changes

- 0088830: Minor version release

## 3.0.11

### Patch Changes

- 92d9d99: Add auto-detect persistence strategy for memory driver: automatically selects localStorage (browser) or file system (Node.js) based on runtime environment

## 3.0.10

### Patch Changes

- d1e5d31: Fix UI protocol design issues

## 3.0.9

### Patch Changes

- 15e0df6: chore: unify all package versions to 3.0.8

## 3.0.8

### Patch Changes

- 5a968a2: Unify all package version numbers across the monorepo. All packages now share the same version and are released together via the changeset fixed group.

## 3.0.7

### Patch Changes

- 0119bd7: Implement DatabaseLoader for production metadata persistence
- 5426bdf: Migrate CLI architecture to oclif framework
  Improve chart

## 3.0.6

### Patch Changes

- 5df254c: Patch version release

## 3.0.5

### Patch Changes

- 23a4a68: Patch release for ObjectStack spec

## 3.0.4

### Patch Changes

- d738987: chore: patch release

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.

## 3.0.2

### Patch Changes

- 28985f5: **Breaking Change: Strict Validation Enabled by Default**

  `defineStack()` now validates configurations by default to enforce naming conventions and catch errors early.

  **What Changed:**

  - `defineStack()` now defaults to `strict: true` (was `strict: false`)
  - Field names are now validated to ensure snake_case format
  - Object names, field types, and all schema definitions are validated

  **Migration Guide:**

  If you have existing code that violates naming conventions:

  ```typescript
  // Before (would silently accept invalid names):
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        firstName: { type: 'text' }  // ❌ Invalid: camelCase
      }
    }]
  });

  // After (will throw validation error):
  // Error: Field names must be lowercase snake_case

  // Fix: Use snake_case
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        first_name: { type: 'text' }  // ✅ Valid: snake_case
      }
    }]
  });
  ```

  **Temporary Workaround:**

  If you need to temporarily disable validation while fixing your code:

  ```typescript
  defineStack(config, { strict: false }); // Bypass validation
  ```

  **Why This Change:**

  1. **Catches Errors Early**: Invalid field names caught during development, not runtime
  2. **Enforces Conventions**: Ensures consistent snake_case naming across all projects
  3. **Prevents AI Hallucinations**: AI-generated objects must follow proper conventions
  4. **Database Compatibility**: snake_case prevents case-sensitivity issues in queries

  **Impact:**

  - Projects with properly named fields (snake_case): ✅ No changes needed
  - Projects with camelCase/PascalCase fields: ⚠️ Must update field names or use `strict: false`

## 3.0.1

### Patch Changes

- 389725a: Fix build and test stability improvements

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

## 2.0.7

### Patch Changes

- Modularized kernel/events.zod.ts into 6 focused sub-modules for better tree-shaking and maintainability:

  - events/core.zod.ts: Priority, metadata, type definition, base event
  - events/handlers.zod.ts: Event handlers, routes, persistence
  - events/queue.zod.ts: Queue config, replay, sourcing
  - events/dlq.zod.ts: Dead letter queue, event log entries
  - events/integrations.zod.ts: Webhooks, message queues, notifications
  - events/bus.zod.ts: Complete event bus config and helpers

  kernel/events.zod.ts now re-exports from sub-modules (backward compatible).
  Created v3.0 migration guide.

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.5

### Patch Changes

- Unify all package versions with a patch release

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.0

### Minor Changes

- 38e5dd5: feat: Studio DX, REST extraction, Dispatcher plugin
- 38e5dd5: test minor bump

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration

## 1.0.11

## 1.0.10

## 1.0.9

## 1.0.8

## 1.0.7

## 1.0.6

### Patch Changes

- a7f7b9d: fix(data): add missing expand, top, having, distinct fields to QuerySchema for OData/ObjectQL compatibility

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance

## 1.0.4

## 1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.

## 1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

## 0.9.2

### Patch Changes

- Refactor documentation architecture and terminology (Data/System/UI Protocols).

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.

## 0.8.2

### Patch Changes

- 555e6a7: Refactor: Deprecated View Storage protocol in favor of Metadata Views.

  - **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`.
  - **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface.
  - **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`.
  - **UPDATE**: `@objectstack/plugin-msw` now dynamically loads `@objectstack/objectql` to avoid hard dependencies.

## 0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.3.1

## 0.3.0

### Minor Changes

- Documentation and project structure improvements

  - Comprehensive documentation structure with CONTRIBUTING.md
  - Documentation hub at docs/README.md
  - Standards documentation (naming-conventions, api-design, error-handling)
  - Architecture deep dives (data-layer, ui-layer, system-layer)
  - Code of Conduct
  - Enhanced documentation organization following industry best practices

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

## 0.1.2

### Patch Changes

- Remove debug logs from registry and protocol modules

## 0.1.1

### Patch Changes

- b58a0ef: Initial release of ObjectStack Protocol & Specification.
