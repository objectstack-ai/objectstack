---
'@objectstack/service-settings': patch
---

fix(settings)!: the Knowledge settings page keeps only keys something reads — `adapter`, `over_fetch` and `enforce_rls` are retired

Clause-②: no (narrowing) — narrowed: `PUT /api/settings/knowledge` refuses a body naming `adapter`, `over_fetch` or `enforce_rls` (`400 UNKNOWN_KEY`) whole, where it stored them: no other key in that body is saved; `GET /api/settings/knowledge` no longer serves them; `POST /api/settings/knowledge/test` no longer answers from `adapter` (a stored or sent `ragflow` was "Unknown adapter", `memory` an in-memory warning) and answers every call from `turso_url` and `turso_auth_token` alone
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the three retired keys; `skills/objectstack-ai/SKILL.md` teaches `knowledge.chunk_target`, which stays. `content/docs/ai/knowledge-rag.mdx` says what the page holds.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: a settings manifest is a runtime registration, not authorable metadata. The narrowed answers are doors of one settings namespace, nothing that `objectstack migrate meta` reads names these keys, and stored rows are untouched. -->

**BREAKING** for a script or client that writes `adapter`, `over_fetch` or `enforce_rls` to the `knowledge` settings namespace: the write is now refused as an undeclared key, and refused whole — no other key in that body is saved, so a body that also changes `chunk_target` saves nothing. Drop the retired key from the body. Nothing in this repository ever read any of the three, so no deployment behaves differently.

On the Knowledge settings page (`knowledge` namespace, manifest `version` 4), every key left has a reader:

- `turso_url` and `turso_auth_token` are read by `@objectstack/knowledge-turso` at startup, where the knowledge store is libSQL — a platform database other than PostgreSQL. On PostgreSQL the store is pgvector, in the platform database, and neither is read.
- `chunk_target` is read by the knowledge service's splitter.

What leaves, and why:

- **Adapter** (and its "Existing indices are not migrated" banner). It chose nothing: a knowledge source uses the store its own `adapter` names, among those mounted, and `requires: ['knowledge']` mounts one store chosen by the platform database. `os knowledge status` reports each source's store.
- **Over-fetch multiplier**. Search refills from fixed factors, never from this setting.
- **Enforce RLS on search** (and its "Leave RLS on in production" banner). Every search re-checks each hit as the asking user, and nothing ever read this switch, so turning it off never turned the check off. A switch that appears to do so is not offered.

An environment that saved any of them keeps those `sys_platform_setting` rows; the settings service never deletes a stored row. The page loads as before without them: the values are not served, not shown, and not read by "Test connection". A stored `enforce_rls = false` shows no toggle and changes nothing, as it changed nothing before. To tidy up, delete the `knowledge` rows named `adapter`, `over_fetch` and `enforce_rls` from `sys_platform_setting`; nothing requires it.

"Test connection" checks the Turso fields only — a managed `libsql://` URL needs an auth token — and still opens no connection. The strings for the retired keys, the `Backend` and `Permissions` groups and both banners are gone from all eleven bundled locales.
