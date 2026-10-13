---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(metadata-protocol): a stored-metadata migration records the user who ran it, or nobody, never a label

Clause-②: no

- **What was wrong.** The stored-metadata migration pass (`os migrate meta --stored`, `POST /api/v1/meta/_migrate-stored`, the runtime dispatcher's `POST /metadata/_migrate-stored`, and `migrateStoredMetadata()` called in process) recorded a label as the writer of every row it rewrote: `'os migrate meta --stored'`, `'<user id> (POST /api/v1/meta/_migrate-stored)'`, `'POST /api/v1/meta/_migrate-stored'`, or `'migrate-stored'`. The writer lands in `sys_metadata_history.recorded_by` and in the row's `updated_by`. Both columns are references to `sys_user`, so the label pointed at no user. Nothing refused it, because metadata writes run as the system.
- **What it does now.** The pass records the id of the user who ran it, exactly as every other metadata write does. A REST or runtime call by a signed-in user with `manage_metadata` records that user's id. A run with no user records `null`, which means "system-initiated". That covers the CLI, which opens the database directly with no session, and a system caller. The pass still names itself on each history row's `source` (`migrate-stored`), as it did before.
- **What an operator sees.** History rows and rewritten rows written by a migration from this release on name the person who ran it, or nobody. They never name a command or a route. Rows a migration rewrote before this release keep the label they were given.
- **Contract text.** `MetadataItem.authoredBy`'s description now gives the same rule as `PutOptions.actor`: the acting user's id, or `null` for a system-initiated write, never a label such as `"system"` or `"cli"`. The schema accepts the same values as before.
