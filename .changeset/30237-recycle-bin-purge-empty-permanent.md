---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

feat(objectql,spec): purge and empty the recycle bin, and delete a record for good (ADR-0148): `ObjectQL.purge(entryId)`, `ObjectQL.empty(object)` and `delete(object, { where: { id }, permanent: true })`, all authorized as the `purge` operation

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #30847 — `skills/objectstack-api/SKILL.md` :268, :417 teach that there is no recycle bin; the skills lane owns that file.

The recycle bin's removal side. All three acts are dispatched through the middleware chain as one new operation, `purge`, on the business object the rows belong to, so one grant will govern all three: `manageRecycleBin`, the recycle-bin manager's (ADR-0148 D5). **Until `@objectstack/plugin-security` maps `purge` to that grant, it refuses `purge` for every caller that is not the system**, the fail-closed rule it already applies to the destructive verbs. So in this release only the system, or a composition without the security plugin, can purge, empty or delete for good. Restoring, the two grants and the REST doors are not in this release.

- **`@objectstack/spec`:** `EngineDeleteOptions` gains `permanent?: boolean`: delete for good, so the rows skip the recycle bin and cannot be restored. It is authorized as the `purge` operation, not `delete`, and is honoured on a by-id delete only.
- **`@objectstack/objectql`, the permanent delete:** `delete(object, { where: { id }, permanent: true })` runs as the by-id delete does (its `beforeDelete` / `afterDelete` hooks, which read `permanent` off `input.options`, its cascade, its events), writes no recycle-bin entry, and is dispatched as `purge` with the row's id. These are refused `400 VALIDATION_ERROR` (`param: 'permanent'`) before any middleware or hook runs:
  - `permanent: true` on a delete that is not by id, or that asks `multi: true`;
  - `permanent: true` on a platform object (`sys_*`, `cloud_*`, `ai_*`), whose delete never enters the bin and is already permanent;
  - a `permanent` that is not a boolean.
  `permanent: false` is the ordinary delete.
- **`@objectstack/objectql`, `purge(entryId, { context })`:** removes one recycle-bin entry and answers `true`. It answers `false` when no entry with that id is visible to the caller's organization, or when the composition registers no bin. The entry is read first, scoped to the caller's organization, for the object its rows belong to; the removal is then dispatched as `purge` on that object, with no id.
- **`@objectstack/objectql`, `empty(object, { context })`:** removes every entry of one object that the caller's organization holds, and answers how many. It is one `purge` dispatch on `object`, so one authorization covers it. The object need not be registered any more, so an uninstalled package's entries can still be emptied. A platform object, or an empty name, is refused `400 VALIDATION_ERROR` (`param: 'object'`). It answers `0` when the composition registers no bin.
- **Middleware authors:** `OperationContext.operation` gains `'purge'`, which never carries an `ast`. A middleware that switches on the operation exhaustively, or keys write handling on `'delete'`, sees the permanent delete as `'purge'`. `purge` advances the engine's write epoch, as `insert`, `update` and `delete` do (`WRITE_EPOCH_OPERATIONS`). `beforePurge` / `afterPurge` are not engine hook events: registering one warns that it never fires, as before.
