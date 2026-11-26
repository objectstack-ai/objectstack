---
'@objectstack/service-knowledge': patch
'@objectstack/service-settings': patch
'@objectstack/embedder-openai': patch
---

feat(service-knowledge): the open edition registers `EMBEDDER_SERVICE` from the `ai.embedder_*` settings when the knowledge service is mounted

Clause-②: yes (widening) — `@objectstack/embedder-openai` gains one export, `documentedMaxBatchSize(model): number | undefined`
Metadata-protocol: none

- **An embedder from the settings page.** `KnowledgeServicePlugin` reads the saved `ai.embedder_*` settings once, at `kernel:bootstrapped`, and registers an `@objectstack/embedder-openai` embedder as `EMBEDDER_SERVICE` (`'embedder'`) for the saved provider. The saved Base URL applies only to the custom and Azure providers; other providers use their preset endpoint. The boot line names the endpoint host. "Saved" means any layer but the manifest default, an `OS_*` override included; `ai.embedder_dimensions` and `ai.embedder_batch_size` are read as positive integers whether they arrive as numbers or as text (an `OS_AI_EMBEDDER_DIMENSIONS=256` override), and a value that is not one is refused with a `warn`, not dropped. Completeness is the Test embedder button's own check. `@objectstack/service-knowledge` now depends on `@objectstack/embedder-openai`.
- **An embedder already registered is kept.** One registered by ObjectOS Cloud or by a host's own plugin in `init()`, `start()` or a `kernel:ready` handler is kept, with one `info` line, and the settings are not applied.
- **The batch size is passed only when it was saved, and is held to the model's documented cap.** Unsaved (the form shows 64), the embedder batches at the model's documented cap. Saved, it is passed as `min(saved, documented cap)` when the saved model has a documented cap (DashScope `text-embedding-v3`: a saved 64 sends 10 per request), and as saved for a model with none.
- **No embedder configured: the boot succeeds, and every use of the embedder answers an error naming the missing settings.** With no provider saved, `none` saved, or incomplete settings, `EMBEDDER_SERVICE` is an embedder whose `embed()` and `dimensions` refuse with that reason and the restart it needs, so an adapter that embeds refuses indexing and search with it. Nothing is sent to a provider until one is saved, and the API key is never logged or put in an error.
- **A saved change waits for a restart, and the page says so** — help under the Embedder provider field (`@objectstack/service-settings`, all locales). There is no hot replacement.
- **New export `documentedMaxBatchSize(model)` from `@objectstack/embedder-openai`**: the provider-documented per-request input cap for a model, read from the same known-model table `OpenAIEmbedder` batches by, or `undefined` for a model the table does not document. Read-only. `OpenAIEmbedder` is unchanged: an explicit `maxBatchSize` passed to it directly is still used as given, above the documented cap included.
- If your own plugin registers `EMBEDDER_SERVICE` after `kernel:ready` (in `kernel:bootstrapped` or later, or after boot), move that registration into `init()`, `start()` or `kernel:ready`: the knowledge plugin has registered one by then, and a second registration of the name is refused.
