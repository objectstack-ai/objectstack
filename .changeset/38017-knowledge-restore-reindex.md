---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): a recycle-bin restore re-indexes its rows on a kernel with no realtime service

Clause-②: no
Metadata-protocol: none

On a kernel that composes no `realtime` service, record changes sync on the data engine's after-write hooks. A recycle-bin restore runs no hook (a restore is never a create, ADR-0148 D2), and its `data.record.restored` events go only to a realtime service, so a restored record stayed out of the index, and search did not find it, until a rebuild or the reconcile.

The knowledge plugin now also registers one engine middleware there that hears the `restore` operation. Once a restore has answered, each row it wrote back is synced, the master first, through the same seams as a write: through the `knowledge-record-sync` queue when one is composed, otherwise once the unit of work open at the restore commits, off the restore's response. A restore that refuses or fails syncs nothing, and a restore inside a caller's `engine.transaction()` that rolls back syncs nothing. A restore that landed with a stale roll-up (`ERR_SUMMARY_RECOMPUTE`) syncs its rows. With a realtime service composed nothing changes: the `data.record.restored` subscription stays the only trigger, so a restore is synced once. The boot line says whether restores are covered. Nothing to migrate.
