---
"@objectstack/metadata-protocol": minor
"@objectstack/metadata-core": minor
"@objectstack/platform-objects": minor
---

feat(metadata-protocol): the draft save records `draftChanges` — which surface, actor and instant last changed each key path of a pending draft — and the strict draft read serves it

Clause-②: yes (widening)

- **Recorded by the draft save.** `saveMetaItem({ mode: 'draft', surface })` compares the body it writes with the body it replaces, inside the write's own transaction: the draft row, else (the draft's first save) the active row its publish would replace, else nothing, which records `[]`, the whole body. A path is the object keys from the body root to the deepest changed key; an array is one leaf, with no index. Each changed path is stamped `{ by: surface ?? 'api', actor, at }`, where `actor` is the value the save's history event carries (or `null`) and `at` is the write's instant as `toISOString()`.
- **Kept until publish or discard.** No two entries share a path: a save replaces every entry at or under each path it changes, so the longest prefix answers for a key. A save that changes no key path leaves the entries as they were. Publish and discard delete the draft row, and the entries with it, so the next draft starts clean. A `migrate-stored` rewrite and an active save record nothing.
- **Served on the strict draft read only.** `getMetaItem({ state: 'draft' })` answering a stored draft row carries `draftChanges` beside `item`. It is absent on the active read, the cached branch, the `?preview=draft` read, and a draft row whose saves recorded none (one saved before this release) — never `[]`.
- **Stored on the row.** `sys_metadata` gains a nullable `draft_changes` column (`@objectstack/metadata-core`'s `SysMetadataObject`), never inside the stored body. Schema sync adds it to an existing table on boot with no manual step (measured on SQLite and the memory driver).
- **Translated labels.** `@objectstack/platform-objects`' translation bundles carry the new column's label and help text in every shipped locale.
- **An unknown `surface` is refused.** In-process, a value outside `copilot | studio | api` is refused `400 INVALID_REQUEST` before anything is written.
