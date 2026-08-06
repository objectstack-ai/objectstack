---
'@objectstack/objectql': patch
---

lifecycle: the Archiver's batch loop now honours the teardown abort bit (#4747)

`LifecycleService.stop()` raises an abort bit that the sweep checks at each leg
boundary — between objects, and (since #5753) between reap pages. The Archiver's
own batch loop did not check it, so teardown landing mid-archive still ran the
remaining batches out: up to 20 × 500 rows of `find` + per-row `upsert` +
`bulkDelete` issued across two datasources the host is already closing.

It now breaks at the batch boundary like the reap loop does. The "hot-delete only
what the cold store took" safety rule is unaffected: the batch in flight finishes
its `upsert` → `bulkDelete` pair, and batches not yet begun are left for the next
sweep to re-read.

Not reachable in any of today's deployments — the Archiver only engages once an
object declares `archive` with a provisioned cold datasource, and no platform
object does. This is prevention for the first deployment that declares one.
