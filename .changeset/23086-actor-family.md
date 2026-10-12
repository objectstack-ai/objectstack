---
'@objectstack/metadata-fs': patch
'@objectstack/runtime': patch
---

fix(metadata-fs, runtime): metadata writes record the acting user's id or nobody, never the label `'fs'`, and a signed-in save through the runtime dispatcher records the user

Clause-②: no

- **What was wrong (filesystem repository).** `FileSystemRepository` named the label `'fs'` as the writer whenever no user was given. That covered every edit it saw on disk, every file it found that no recorded write produced, and an actor-less `put()`, which read back as `'fs'`. `MetadataPlugin` attaches the repository without naming a user, so this happened on every host that boots it. The contract for these fields (`PutOptions.actor`, `MetadataItem.authoredBy`, `MetadataEvent.actor`) is the acting user's id, or `null` for "nobody".
- **What it does now.** With no user named, the repository records `null`. A write that names a user records that user, and a write that records `null` reads back as `null`. The `fsActor` option keeps its type. When it is set, it is the user id reported for changes the repository did not write itself, and it no longer replaces a writer that a write recorded. Every event still names its origin on `source: 'fs'`, as before.
- **What was wrong (runtime dispatcher).** `PUT /api/v1/meta/:type/:name` served by the runtime dispatcher (the `@objectstack/hono` catch-all) saved without the caller's identity, so a signed-in author's save recorded `null` in `sys_metadata.updated_by` / `created_by` and `sys_metadata_history.recorded_by`. `RestServer`'s route recorded the user.
- **What an operator sees.** Filesystem-backed metadata history and events from this release on no longer name `'fs'` as the writer. A save through the runtime dispatcher records the signed-in user's id, as the REST route does, and a system caller with no user records `null`. Entries written before this release keep what they recorded.
