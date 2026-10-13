---
'@objectstack/plugin-audit': minor
---

`sys_comment` edit marks are platform-written: an update that changes a comment's `body` stamps `is_edited: true` and `edited_at` from the server clock, and a client can no longer set or clear either field.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: `sys_comment` keeps both fields with their names and types, no spec key, authorable spelling, export or stored shape is added, removed, renamed or re-shaped, and a row stored before this change keeps its bytes, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: a client's value for two platform-written fields no longer lands, and a predicate body update whose matched rows disagree is refused; the remedy is in the request a caller sends to that door, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

- **Stamped by the platform.** The comment's `beforeUpdate` sets both fields when the update's `body` differs from the stored body, for every caller, the way the engine stamps `updated_at`. An update that does not name `body`, or sends the stored text again beside new `mentions`, is not an edit and stamps nothing. A create is not an edit either.
- **Read-only at the data door.** `is_edited` and `edited_at` now declare `readonly: true`. On an update that edits the body, the stamp replaces whatever the client sent; on any other update a non-system caller's value is dropped and reported in the response's `droppedFields`; on a create the platform sets both to "not edited" over a client value. Nothing is refused for carrying the fields — a client that still sends them on every edit, as the console released before this change does, keeps working and its values are ignored. Read both fields back from the row instead of writing them.
- **Predicate updates.** A `multi: true` update is stamped per matched row. One whose matched rows disagree — some bodies change, some already hold the new text — is now refused whole with `MULTI_UPDATE_HOOK_KEY_DIVERGENCE` (400) and writes nothing, because one SET clause cannot mark some rows and not others. Narrow the predicate to the rows whose text changes, or update by id.
- A `preserveAudit` (historical import) update keeps a mark it supplies, as it keeps `updated_at`.
