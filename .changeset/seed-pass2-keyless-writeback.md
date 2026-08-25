---
'@objectstack/metadata-protocol': patch
---

Seed pass 2 now writes a deferred reference back through the internal id captured at insert time, so a keyless dataset (`mode: 'insert'`, no `externalId` — the honest authoring for an engine-owned object with no natural key) heals an out-of-order reference exactly like a keyed one. Previously pass 2 re-resolved the source row through its `externalId`, so a keyless (or empty-keyed) row's resolved reference was dropped loudly and the load reported `success: false`; the same load now succeeds with the reference healed. The loud drop remains for the one case where it is true — the source row's pass-1 write failed, so there is nothing to write back onto. Unchanged and now measured against the real engine: a deferred column that is `required: true` is still rejected at pass-1 insert (the deferral deletes the column), so such datasets must still seed their target first.
