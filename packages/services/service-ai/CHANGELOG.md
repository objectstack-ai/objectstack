# @objectstack/service-ai

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/embedder-openai@7.0.0

## 6.9.0

### Minor Changes

- e9bacda: Auto-generate concise titles for AI conversations.

  `AIService` now exposes `summarizeConversation(id)` and fires it
  once per conversation after the first assistant turn lands. The
  generated title (≤ 16 chars by default) is PATCHed onto the
  `ai_conversations` row so the sidebar shows a meaningful label
  instead of "New conversation". Failures are silently swallowed —
  title generation is purely cosmetic and never blocks chat.

  Plumbing:

  - New AI settings (in the `ai` Settings namespace):
    - `title_generation_enabled` (toggle, default on for non-memory providers)
    - `title_max_length` (number, 8–80, default 16)
  - `AIService.setTitleGenerationConfig({ enabled, maxLength })` —
    called by `AIServicePlugin.bindSettings()` whenever the `ai`
    namespace changes, so admins can toggle the feature live from
    Setup without a restart.
  - `AIService` calls `summarizeConversation()` fire-and-forget at
    the natural end of `chatWithTools` and `streamChatWithTools`.
    Idempotent per service instance — a single titling attempt per
    conversation per process.

  Defaults are conservative: memory provider stays untouched
  (no LLM call is made), and any per-test `AIService` that doesn't
  explicitly call `setTitleGenerationConfig({ enabled: true })`
  behaves exactly as before.

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Minor Changes

- 6e88f77: Auto-persist chat history when a `conversationId` is supplied.

  - `AIService.chatWithTools` and `streamChatWithTools` now write the inbound user turn, each intermediate assistant/tool round, and the final assistant turn to `ai_messages` whenever `toolExecutionContext.conversationId` is set. Persistence is best-effort: failures are warned and never break the chat response.
  - Add `IAIConversationService.update(conversationId, { title?, metadata? })` and a matching `PATCH /api/v1/ai/conversations/:id` route so clients can rename conversations and edit metadata.
  - `ObjectQLConversationService` and `InMemoryConversationService` both implement the new `update` method.

### Patch Changes

- 50ccd9c: Fix peer-dependency version range from `workspace:*` to `workspace:^` to avoid
  forced major bumps in fixed-group releases. `workspace:*` expands to an exact
  version on publish; any minor bump of the peer then falls out of range and
  triggers a semver-major bump on the dependent. `workspace:^` expands to `^x.y.z`
  which correctly accepts minor bumps.

  Affects:

  - `service-ai` peer on `@objectstack/embedder-openai`
  - `runtime` peer on `@objectstack/driver-turso`

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

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

### Patch Changes

- a981d57: Auto-persist chat messages when `conversationId` is supplied. `AIService.chatWithTools` and `streamChatWithTools` now write the inbound user turn, every intermediate assistant/tool round, and the final assistant turn to `ai_messages` via the configured conversation service. Persistence is best-effort: failures are logged at `warn` level and never fail the chat request.
- b486666: Add `GET /api/v1/ai/conversations/:id` route to fetch a single conversation with its full message history. Enforces ownership via the authenticated user: returns `404` when the conversation does not exist and `403` when it belongs to another user. Enables clients to hydrate chat UIs from server-persisted history instead of relying on local storage.
- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Minor Changes

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

- bce47a0: Polish Studio HITL pending-action inbox UI

  The `AiPendingActionView` shipped by `service-ai` is now an actual operator
  console rather than a flat grid:

  - **Drawer detail panel** — clicking any row opens a side drawer
    (`navigation: { mode: 'drawer', view: 'detail' }`) with four sections:
    Proposal · Tool input · Conversation context · Decision.
  - **JSON widget** on `tool_input`, `result`, and `error` so structured tool
    arguments and responses are readable without copy-pasting into a formatter.
  - **Relative timestamps** (`type: 'datetime-relative'`) on `proposed_at` /
    `decided_at` columns and form fields.
  - **Conversation/message linkbacks** — the existing `Field.lookup` references
    to `ai_conversations` / `ai_messages` are surfaced in a collapsed
    "Conversation context" section, giving operators one-click access from a
    pending action back to the chat that proposed it.
  - **Status-conditional fields** via `visibleOn` predicates — `rejection_reason`
    only appears for rejected rows, `error` only for failed rows, etc.
  - **Per-row approve/reject buttons** on the Pending tab via `rowActions`
    pointing at the existing `approve_pending_action` / `reject_pending_action`
    object actions; the same actions also render in the drawer header.
  - **Status-coloured rows** to make pending vs failed vs executed scannable.

  Snapshot-style tests in `__tests__/ai-pending-action.view.test.ts` lock the
  shape so future Studio contract changes (widget renames, navigation modes)
  fail loudly in one place.

  This is a metadata-only change — Studio (`@object-ui/studio`) interprets the
  new view automatically. No backend, REST, or HITL semantics changed; the
  end-to-end demos in `examples/app-todo/test/ai-hitl*.test.ts` continue to
  pass unmodified.

### Patch Changes

- 13a4f38: **Actions-as-tools Phase 2:** the AI tool runtime can now dispatch `type:'api'` and `type:'flow'` actions in addition to `type:'script'`.

  - New exported `ApiActionClient` interface and `createFetchApiClient({ baseUrl, headers, fetch })` factory — default fetch-based dispatch resolves relative `target` paths against `baseUrl`, throws on non-2xx with `${method} ${url} → ${status}: ${body}`, and JSON-parses the response.
  - New exported `buildApiRequestBody(action, args, record, recordId)` helper — honours `bodyShape.wrap`, `recordIdParam` + `recordIdField` (defaults to `'id'`), and merges `bodyExtra` last so constants win.
  - `ActionToolsContext` extended (additive): `automation`, `apiClient`, `apiBaseUrl`, `apiHeaders`.
  - `actionSkipReason()` gains an optional second `ctx` parameter that returns precise wiring-availability reasons (`'no automation service available'`, `'no apiClient or apiBaseUrl configured'`). Studio-only types (`url` / `modal` / `form`) and all dangerous variants (`confirmText`, `mode:'delete'`, `variant:'danger'`) remain skipped.
  - `AIServicePlugin` options accept `apiActionBaseUrl` (falls back to `OS_AI_ACTION_API_BASE_URL`) and `apiActionHeaders`; the plugin now resolves the `automation` service silently and threads everything into `registerActionsAsTools`.

  Net result: every non-destructive declarative action with a target — `script`, `api`, `flow` — is now LLM-callable end-to-end as soon as the corresponding wiring is in place.

- bce47a0: **HITL Phase 3 — end-to-end demos + bug fix in handler-engine adapter.**

  Two runnable integration demos for the action-approval queue ship under `examples/app-todo/test/`:

  - `ai-hitl.test.ts` — drives the tool registry directly (no LLM). Asserts `variant:'danger'` actions register as tools, invocation returns `pending_approval`, row persists, `approvePendingAction(id, actor)` re-runs the handler, row flips to `executed`. Reject path covered too. Run with `pnpm --filter @example/app-todo test:hitl`.
  - `ai-hitl-llm.test.ts` — same scenario behind a real model on Vercel AI Gateway. The LLM autonomously picks `action_delete_completed`, the framework gates the call with `pending_approval`, the model summarises the wait without retrying, and the operator-side approve completes the deletion. Gated on `AI_GATEWAY_API_KEY`. Run with `AI_GATEWAY_API_KEY=... pnpm --filter @example/app-todo test:hitl:llm`.

  While wiring the demos, two bugs surfaced in the bypass-approval dispatcher and the handler-engine adapter:

  1. **Bulk delete from declarative handlers was silently failing.** The adapter built by `buildHandlerEngineAdapter()` wrapped multi-id deletes as `engine.delete(obj, { where: { id: { $in: ids } } })`, but `ObjectQLEngine.delete()` prefers the scalar `id` branch whenever `where.id` is set — so the `{ $in: [...] }` object was forwarded to `driver.delete(scalar)` and rejected as `"Wrong API use: tried to bind a value of an unknown type ([object Object])"`. The adapter now loops scalar deletes, which is correct and driver-agnostic.

  2. **Approval pathway swallowed handler errors.** `createActionToolHandler` returns a `{ ok: false, error }` envelope on failure rather than throwing. The pre-registered bypass dispatcher just JSON-parsed and returned that envelope, so `approvePendingAction` thought the run succeeded and flipped the row to `executed`. The dispatcher now treats `ok === false` as a thrown error, so failed approvals are correctly persisted as `status: 'failed'` with the original message.

  Also: added `delete`/`remove`/`purge`/`destroy`/`erase` to `MemoryLLMAdapter.ACTION_VERBS` so the in-memory adapter can route delete-style intents during tests that don't have a real LLM.

  Docs: `content/docs/guides/ai-capabilities.mdx` now points at the two integration demos with copy-pasteable run commands.

- 449e35d: Real-LLM smoke test for the `data_chat` agent loop, plus two `query_data`
  robustness fixes shaken out by running it against `openai/gpt-4.1-mini` via
  the Vercel AI Gateway.

  **`query_data` tool fixes**

  - Removed the LLM-controllable `model` parameter from the public tool
    schema. Frontier models were hallucinating `text-davinci-003` and other
    long-dead model ids, breaking every plan generation.
  - Switched the structured-output filter shape from `z.record(...)` (which
    emits `propertyNames` in JSON Schema, rejected by OpenAI Structured
    Outputs) to a `whereJson` string field. The model emits a JSON-encoded
    ObjectQL filter; the tool parses & validates it before execution. This
    also fixes a parallel issue with OpenAI's strict mode requiring every
    property to appear in `required`.
  - Switched all optional fields to `.nullable()` so the planner Zod schema
    satisfies OpenAI Structured Outputs' "every property must be required"
    rule.
  - Beefed up the planner system prompt with explicit operator hints — most
    importantly: use `$contains` for partial string matches (`"task named
Foo"` → `{"subject":{"$contains":"Foo"}}`), not equality. Without this
    hint the model defaulted to exact-match equality and never found
    anything.

  **New smoke test**

  `examples/app-todo/test/ai-llm.test.ts` (gated on `AI_GATEWAY_API_KEY`):
  boots the full ObjectStack, registers `query_data` + the six auto-generated
  `action_*` tools, sends _"Please mark the 'Build' task as complete."_ to a
  real LLM, and asserts that

  1. the model picked the right tools in the right order
     (`query_data` → `action_complete_task`),
  2. a task row actually flipped to `completed`, and
  3. an `ai_traces` `chat_with_tools` row landed.

  Run with: `pnpm --filter @example/app-todo test:llm`.

  Verified end-to-end against `openai/gpt-4.1-mini` (~6.6 s, 2 tool calls,
  1 task completed, trace persisted).

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

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

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

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

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- ee39bff: fix ai.
  - @objectstack/spec@4.0.3
  - @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.1.0

### Minor Changes

- **Route auth/permissions metadata**: Every route definition (`RouteDefinition`) now declares `auth` and `permissions` fields, enabling HTTP server adapters to enforce authentication and authorization automatically.
- **User context on RouteRequest**: `RouteRequest` now carries an optional `user: RouteUserContext` object populated by the auth middleware, providing `userId`, `displayName`, `roles`, and `permissions`.
- **Conversation ownership enforcement**: Conversation routes (create, list, add message, delete) are scoped to the authenticated user when a user context is present and the conversation has a `userId`. For backward compatibility, requests without user context and conversations created without a `userId` remain accessible under the existing behavior.
- **Enhanced tool-call loop error handling**: `chatWithTools` now tracks tool execution errors across iterations and supports an `onToolError` callback (`'continue'` | `'abort'`) for fine-grained error control.
- **`streamChatWithTools`**: New streaming tool-call loop that yields SSE events while automatically resolving intermediate tool calls.
- **New `RouteUserContext` type**: Exported from the package for use by HTTP adapters and middleware.

## 4.0.0

### Major Changes

- ad4e04b: service ai

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- Initial release of AI Service plugin
  - LLM adapter layer with provider abstraction (memory adapter included)
  - Conversation management service with in-memory persistence
  - Tool registry for metadata/business tool registration
  - REST/SSE route self-registration (`/api/v1/ai/*`)
  - Kernel plugin registering as `'ai'` service conforming to `IAIService` contract
