---
'@objectstack/service-settings': patch
'@objectstack/service-knowledge': patch
'@objectstack/platform-objects': patch
---

fix(settings)!: the knowledge settings page and the AI page's embedder section appear only where the knowledge service is mounted

Clause-②: no (narrowing) — narrowed: on a deployment that does not mount `KnowledgeServicePlugin` (every stock boot), `GET` / `PUT /api/settings/knowledge` and `POST /api/settings/knowledge/test` now answer `404 UNKNOWN_NAMESPACE`, where they served the Knowledge page; a write of an `ai.embedder_*` key (`embedder_provider`, `embedder_api_key`, `embedder_model`, `embedder_base_url`, `embedder_dimensions`, `embedder_batch_size`) now answers `400 UNKNOWN_KEY`, and `POST /api/settings/ai/test_embedder` answers that no handler is registered; the hub list no longer carries `knowledge`, and the Setup sidebar no longer carries `nav_settings_knowledge`. `builtinSettingsManifests` drops `knowledgeSettingsManifest`, and `aiSettingsManifest` drops its embedder section.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the knowledge settings page or the `ai.embedder_*` keys; `skills/objectstack-ai` teaches wiring `KnowledgeServicePlugin`, which is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: settings manifests are runtime registrations, not authorable metadata. The moved answers are settings doors that a deployment without the knowledge service no longer serves; a deployment that mounts it serves them exactly as before, and stored rows are untouched, so there is nothing for a migration to rewrite. -->

**BREAKING** for a deployment that does not mount the knowledge service: the knowledge base is not a default capability, so its settings are no longer offered by default. The Knowledge page, the AI page's Embedder section, their "Test connection" / "Test embedder" buttons and the Setup entry are now contributed by `@objectstack/service-knowledge` when `KnowledgeServicePlugin` is mounted beside `SettingsServicePlugin`, and only then. Values already stored under `knowledge.*` or `ai.embedder_*` stay in the database and are served again as soon as the service is mounted.

The AI page's description no longer names the knowledge base, in every bundled locale.

`@objectstack/service-settings` now exports `knowledgeSettingsManifest`, `knowledgeTestActionHandler`, `aiSettingsManifest`, `aiEmbedderSettingsSpecifiers`, `withAiEmbedderSection` and `aiTestEmbedderActionHandler` from its package entry, and its default `actionHandlers` map no longer registers `knowledge.test` or `ai.test_embedder`. `@objectstack/service-knowledge` depends on `@objectstack/service-settings` and declares the settings plugin in `optionalDependencies`, so the kernel inits it first.

What to do: nothing, unless you configure an embedder or a knowledge backend from Setup. Then mount `KnowledgeServicePlugin` from `@objectstack/service-knowledge` (with a knowledge adapter plugin) beside `SettingsServicePlugin`; the page, the embedder section and the Setup entry come back with it. A host that passed its own `ai` manifest to `SettingsServicePlugin({ manifests })` adds `aiEmbedderSettingsSpecifiers` to it (or wraps it with `withAiEmbedderSection`) to keep the embedder keys. The embedder section joins only the bundled `ai` page, recognised as that very declaration; a host's own `ai` page (or one served through an option source) is left as it is, and the plugin logs a warning saying so. A host that passes its own `actionHandlers` to `SettingsServicePlugin` keeps a `knowledge` entry there only beside the knowledge manifest: without it the settings plugin refuses to register the handler for an unknown namespace at boot.

Stored credentials: on a deployment that does not mount the knowledge service, `ai.embedder_api_key`, `knowledge.turso_auth_token` and `knowledge.ragflow_api_key` stay stored (as `sys_secret` handles) but no settings door serves, edits or clears them, and the AI page's reset clears declared keys only. To remove them, mount `KnowledgeServicePlugin` once and clear the keys from Setup, or delete their rows from `sys_platform_setting` (the `knowledge` namespace and the `ai.embedder_*` keys) and the `sys_secret` rows whose `id` those rows hold in `value_enc` (a `sec_` handle); until then the `sys_secret` orphan report may list them.
