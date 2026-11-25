---
'@objectstack/service-knowledge': patch
'@objectstack/service-settings': patch
---

feat(service-knowledge): the open edition registers `EMBEDDER_SERVICE` from the `ai.embedder_*` settings when the knowledge service is mounted

Clause-②: no
Metadata-protocol: none

- **An embedder from the settings page.** `KnowledgeServicePlugin` reads the saved `ai.embedder_*` settings once, at `kernel:bootstrapped`, and registers an `@objectstack/embedder-openai` embedder as `EMBEDDER_SERVICE` (`'embedder'`) for the saved provider — its preset endpoint, or the saved Base URL for a custom or Azure endpoint. "Saved" means any layer but the manifest default; completeness is the Test embedder button's own check. `@objectstack/service-knowledge` now depends on `@objectstack/embedder-openai`.
- **An embedder already registered is kept.** One registered by ObjectOS Cloud or by a host's own plugin in `init()`, `start()` or a `kernel:ready` handler is kept, with one `info` line, and the settings are not applied.
- **The batch size is passed only when it was saved.** Unsaved (the form shows 64), the embedder batches at the model's documented cap. A saved value is passed as saved.
- **No embedder configured: the boot succeeds, and every use of the embedder answers an error naming the missing settings.** With no provider saved, `none` saved, or incomplete settings, `EMBEDDER_SERVICE` is an embedder whose `embed()` and `dimensions` refuse with that reason and the restart it needs, so an adapter that embeds refuses indexing and search with it. Nothing is sent to a provider until one is saved, and the API key is never logged or put in an error.
- **A saved change waits for a restart, and the page says so** — help under the Embedder provider field (`@objectstack/service-settings`, all locales). There is no hot replacement.
- If your own plugin registers `EMBEDDER_SERVICE` after `kernel:ready` (in `kernel:bootstrapped` or later, or after boot), move that registration into `init()`, `start()` or `kernel:ready`: the knowledge plugin has registered one by then, and a second registration of the name is refused.
