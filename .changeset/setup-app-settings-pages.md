---
'@objectstack/service-settings': minor
'@objectstack/platform-objects': minor
---

Setup App: complete the Configuration settings pages.

**Setup App navigation**

The Configuration group now lists every built-in settings namespace
(previously Storage was missing entirely, and Knowledge had no entry):

- Branding · Email · **File Storage** · **AI & Embedder** · **Knowledge** · Feature Flags

Order in the left-nav now matches `builtinSettingsManifests` so the
"All Settings" index and the left-nav stay aligned.

**AI manifest — embedder section**

`ai.manifest.ts` now ships an Embedder section in addition to the
existing chat-LLM section. Knobs:

- `embedder_provider` — `none` (default) / `openai` / `azure` /
  `dashscope` (阿里通义) / `zhipu` (智谱) / `siliconflow` (硅基流动) /
  `doubao` (火山引擎) / `minimax` / `ollama` / `custom`. Preset list
  mirrors `@objectstack/embedder-openai`'s `OPENAI_COMPATIBLE_PRESETS`.
- `embedder_api_key` — encrypted password.
- `embedder_model` — free text with documented examples per provider.
- `embedder_base_url` — visible for `custom` / `azure` only.
- `embedder_dimensions` — optional Matryoshka override.
- `embedder_batch_size` — `embed()` chunk batch size.
- Test action wired to `POST /api/settings/ai/test_embedder` — fallback
  validates form completeness; real probe lives in `service-ai` /
  `service-knowledge`.

**New `knowledge` settings manifest**

`knowledge.manifest.ts` is the canonical surface for RAG infrastructure:

- `adapter` — `memory` / `turso` / `ragflow`.
- Turso group — `turso_url` (libsql://, file:, :memory:) + encrypted
  `turso_auth_token`. Leaving URL blank means "reuse the tenant's
  primary libSQL connection" — the recommended cloud setup.
- RAGFlow group — base URL + encrypted API key + default dataset id.
- Indexing defaults — `chunk_target`, `chunk_overlap`, `over_fetch`.
- Permissions — `enforce_rls` defaults to `true` (security-critical;
  toggling off skips the platform's unique RLS re-check on every hit).
- Test action wired to `POST /api/settings/knowledge/test`.

**Translations**

Full `ai` and `knowledge` translation blocks added to both `en.ts` and
`zh-CN.ts`. Storage block had translations already.

**Tests**

- `ai.manifest.test.ts`: +5 cases covering embedder select, encryption,
  test action wiring, and embedder handler validation across 5 provider
  shapes (none / ollama / OpenAI-compatible cloud / custom / azure).
- `knowledge.manifest.test.ts`: 20 new cases covering manifest shape,
  adapter selection, secret encryption, default `enforce_rls=true`,
  test handler validation across all 3 adapters and payload merging.

78/78 tests pass in `@objectstack/service-settings`.
