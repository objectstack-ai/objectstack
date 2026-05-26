---
'@objectstack/spec': minor
'@objectstack/service-ai': minor
'@objectstack/knowledge-turso': minor
---

Settings → runtime bridge: `embedder_*` settings now build a real
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
