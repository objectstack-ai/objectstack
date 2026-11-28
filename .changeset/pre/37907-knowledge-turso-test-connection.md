---
'@objectstack/knowledge-turso': patch
'@objectstack/service-settings': patch
'@objectstack/service-knowledge': patch
---

fix(knowledge-turso)!: the Knowledge page's "Test connection" comes with the Turso fields it checks — a page without them has no such action

Clause-②: yes (narrowing) — the public surface grows by four exports of `@objectstack/knowledge-turso` (listed below); narrowed: where `@objectstack/knowledge-turso` does not contribute its Turso group (the store is `@objectstack/knowledge-pgvector`, on PostgreSQL, or the store is mounted with a `url` or `client` of its own), the Knowledge page has no "Test connection" action and `POST /api/settings/knowledge/test` answers `400 SETTINGS_ACTION_FAILED` (no handler registered), as every undeclared action does, where it answered the Turso form check with `200`; where the store reads its URL from settings, the action is on the page, beside the two fields, and answers as before. `@objectstack/service-settings` no longer exports `knowledgeTestActionHandler`; `@objectstack/knowledge-turso` does
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the Knowledge page's test action or `knowledgeTestActionHandler`.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: a settings manifest and its action handlers are runtime registrations, not authorable metadata, and nothing `objectstack migrate meta` reads names the action. -->

**BREAKING** for three readers:

- A script or client that posts to `POST /api/settings/knowledge/test` on a deployment where the Turso fields are not on the page now gets `400 SETTINGS_ACTION_FAILED`. The check it answered there read fields nothing on that deployment reads, and opened no connection. Stop calling it there.
- Code that imports `knowledgeTestActionHandler` from `@objectstack/service-settings`: import it from `@objectstack/knowledge-turso` instead (`import { knowledgeTestActionHandler } from '@objectstack/knowledge-turso'`). Same check, same answers. `@objectstack/knowledge-turso` depends on the native libSQL client (`@libsql/client`); importing the handler loads nothing native, but installing the package installs that dependency.
- A host that registers its own `knowledge` settings page declaring `turso_url`, `turso_auth_token` and the `test` action: `KnowledgeTursoPlugin` leaves that page as written and registers no handler for it, so its `test` button now answers `400 SETTINGS_ACTION_FAILED`. Register the handler yourself after registering the page: `settings.registerAction('knowledge', 'test', knowledgeTestActionHandler)`, with `knowledgeTestActionHandler` imported from `@objectstack/knowledge-turso`.

The `test` action left `@objectstack/service-settings`' `knowledge` manifest, and `@objectstack/service-knowledge` no longer registers its handler. `KnowledgeTursoPlugin` declares it as the last entry of the Turso group, after `turso_auth_token`, and registers `knowledgeTestActionHandler` with it, only where it contributes the group. The action's label moved with it, in all eleven locales: out of `@objectstack/service-settings`' bundles, into `knowledgeTursoSettingsTranslations`.

New exports of `@objectstack/knowledge-turso`: `knowledgeTestActionHandler`, `KNOWLEDGE_TURSO_TEST_ACTION`, and the types `KnowledgeTursoActionInput` and `KnowledgeTursoActionResult`.

`KnowledgeTursoPlugin` now warns once, at `init()`, when it reads its URL from settings but the Knowledge page cannot carry `turso_url` and `turso_auth_token` (no settings service, no `knowledge` page, or a host page that declares one of the group's ids without both keys): nothing can be saved there, and the store opens its default file, which the line names.

The Turso group's description no longer says that a cloud deployment with a database per organization reuses that organization's database for a blank URL (no deployment does: a blank URL opens `knowledge.db` in the data directory), and no longer says the fields are not read on PostgreSQL (the group is never on the page there). It says instead that a blank URL uses `knowledge.db` in the data directory, in all eleven locales.
