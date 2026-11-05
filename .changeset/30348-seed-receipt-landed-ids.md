---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': patch
---

feat(spec,metadata-protocol): the publish receipt's `seedApplied.landed` names the rows a seed created and the rows it only matched, per object, capped at 200 ids per list

Clause-②: yes (widening)
Metadata-protocol: added

- **`@objectstack/spec`: `seedApplied.landed`** on both publish responses (`PublishMetaItemResponseSchema`, `PublishPackageDraftsResponseSchema`), one shared schema `SeedAppliedLandedSchema`: per object, `inserted` (the rows this publish created) and `matched` (pre-existing rows a seed record's key matched: updated, left as they were, or refused an update), each a `SeedAppliedIdListSchema` `{ ids, total, truncated }`. `ids` carries at most `SEED_APPLIED_LANDED_IDS_CAP` (200) ids, in the loader's record order (datasets in load order, records as authored); past it `truncated` is `true` and `total` is the uncut count. Absent `landed` means "not reported" (a load that threw, or a producer that reports no ids), never "nothing landed". Only `inserted` names rows the seed created: a `matched` row may be a customer's own record that shares the seed's natural key, and under `ignore` (the default) such a row is matched without being written.
- **`@objectstack/spec`: `SeedLoadResult.insertedIds`**, the ids among `landedIds` whose row the load created. Per load: a row an earlier load inserted is matched on a replay, so a reader tracking a seed's rows across publishes accumulates `insertedIds` over every load. `landedIds`' TSDoc now says what each seed mode puts in it.
- **`@objectstack/metadata-protocol`**: `applySeedBodies` returns `landed`, so `publishPackageDrafts` and `publishMetaItem` both carry it; the loader records which landed rows it inserted. `seedAppliedLanded(results)` is exported, the one projection both receipt producers fold the loader's ids through.
- **`@objectstack/runtime`**: the package-publish door's fallback seed apply (for protocols that do not self-apply) reports the same `landed`.
- Accepted cost (objectstack-ai/cloud#3598 ruling A): row ids appear on the public publish responses, bounded by the cap.
