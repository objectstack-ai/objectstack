---
'@objectstack/service-ai': minor
'@objectstack/spec': minor
'@example/app-todo': patch
---

feat(ai): v1 AI capabilities — ModelRegistry, structured output, tracing, schema retrieval, and `query_data` tool

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

