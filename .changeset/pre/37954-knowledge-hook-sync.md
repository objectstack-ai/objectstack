---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): record changes reach the knowledge index on a kernel with no realtime service

Clause-②: no
Metadata-protocol: none

On a kernel that composes no `realtime` service (every hosted kernel), the knowledge index was built once at boot and then never saw a later create, update or user delete: the engine publishes no `data.record.*` event there, so `KnowledgeServicePlugin` only warned "event sync disabled". It now registers the data engine's `afterInsert` / `afterUpdate` / `afterDelete` hooks on every object a record-change source indexes, and each hook calls the same `handleRecordUpsert` / `handleRecordDelete` the realtime subscription calls. A new record is searchable without a rebuild, an updated one is found by its new text, and a deleted one is gone.

- **One trigger per kernel.** With a `realtime` service the subscription stays the trigger and no hook is registered, so each write is synced once.
- **Off the write's response.** The hook only hands the sync off: the re-read, the split and the embed run after the write has answered, so a slow embedding provider no longer slows the write.
- **After the commit.** The sync starts through the engine's `runAfterOpenUnitsCommit`: once the unit of work open at the write commits, and never when it rolls back.
- **Predicate writes** (`multi: true`) are synced row by row, since an object with an `afterUpdate` / `afterDelete` hook gets one dispatch per matched row. Such a write is then held to the engine's per-row hook ceiling (10,000 matched rows), as on every object that already carries a per-row hook such as the audit plugin's: on a kernel with neither a `realtime` service nor the audit plugin, a predicate write over more than 10,000 rows of an indexed object is now refused, with nothing written. Narrow the write's `where` to stay under it.
- **A source added later** for a new object gets its hooks when it arrives; the plugin's teardown removes them.
- A recycle-bin restore runs no hooks, so on such a kernel a restored row is not re-indexed by itself; `reindexSource` brings it back.
