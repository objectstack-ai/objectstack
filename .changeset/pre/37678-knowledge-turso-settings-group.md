---
'@objectstack/knowledge-turso': patch
'@objectstack/service-settings': patch
---

fix(knowledge-turso)!: the Knowledge page's Turso fields are contributed by the store that reads them — a deployment whose store is pgvector shows none

Clause-②: no (narrowing) — narrowed: where `@objectstack/knowledge-turso` is not mounted (the store is `@objectstack/knowledge-pgvector`, on PostgreSQL), or is mounted with a `url` or `client` of its own, `PUT /api/settings/knowledge` refuses a body naming `turso_url` or `turso_auth_token` (`400 UNKNOWN_KEY`, the whole body), where it stored them, and `GET /api/settings/knowledge` no longer serves them; where the store reads its URL from settings (the `requires: ['knowledge']` mount on any other database) both doors answer as before
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches `turso_url` or `turso_auth_token`. `content/docs/ai/knowledge-rag.mdx` says where the page shows them.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: a settings manifest is a runtime registration, not authorable metadata. The narrowed answers are doors of one settings namespace on deployments that do not read the two keys, nothing that `objectstack migrate meta` reads names them, and stored rows are untouched. -->

**BREAKING** for a script or client that writes `turso_url` or `turso_auth_token` to the `knowledge` settings namespace of a deployment that does not mount `@objectstack/knowledge-turso` reading its URL from settings: the write is now refused as an undeclared key, and refused whole — no other key in that body is saved. Nothing on such a deployment ever read either key, so no deployment behaves differently. Drop the two keys from the body.

The Turso group (`turso_url`, `turso_auth_token`) left `@objectstack/service-settings`' `knowledge` manifest (now `version` 5), whose remaining keys all have a reader on every deployment that mounts the knowledge service. `KnowledgeTursoPlugin` adds the group to that page in `init()` when it reads the two keys (`urlFromSettings` with no `url` or `client`, as the runtime's `knowledge` capability mount sets it), in front of the page as before, so:

- on PostgreSQL, where the store is pgvector in the platform database, the Knowledge page shows no Turso fields;
- where the store is the libSQL file, the page shows them, and a saved value is read by the store at the end of the boot exactly as before.

New exports of `@objectstack/knowledge-turso`: `knowledgeTursoSettingsSpecifiers`, `withKnowledgeTursoSection`, `contributeKnowledgeTursoSettings`, `knowledgeTursoSettingsTranslations` and `KNOWLEDGE_SETTINGS_NAMESPACE`. A host that declares the two keys in its own `knowledge` manifest keeps that manifest as written.

Stored values: an environment that saved either key keeps its `sys_platform_setting` row (the auth token's `sys_secret` handle included); the settings service never deletes a stored row. Where the store is not mounted the value is not served and changes nothing, as it changed nothing before; mounted again, the store reads it. To tidy up a PostgreSQL deployment, delete the `knowledge` rows named `turso_url` and `turso_auth_token`; nothing requires it.

The group's copy moved with it: `@objectstack/service-settings`' eleven locale bundles no longer carry the Turso group or its two fields, and `KnowledgeTursoPlugin` loads the same strings, in the same eleven locales, into the i18n service at `kernel:ready`.
