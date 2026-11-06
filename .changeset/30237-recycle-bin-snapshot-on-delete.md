---
'@objectstack/objectql': minor
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(objectql,platform-objects): a by-id delete keeps its rows in the recycle bin (ADR-0148): the `sys_recycle_bin` object, the snapshot on delete, the retention stamp and the TTL reap

Clause-②: yes (widening)
Metadata-protocol: added

The recycle bin's write side. A delete is still a physical delete, and no read path changed: the rows are gone from every query the moment the delete commits. What is new is the copy kept beside them. Restoring, purging and emptying the bin, the two grants that govern them and their REST doors are not in this release.

- **`@objectstack/platform-objects`:** registers `sys_recycle_bin`, built from the spec's `RECYCLE_BIN_ENTRY_FIELDS`. One entry per delete operation. It is engine-owned, with no generic data-API method, because the snapshot holds every field of the deleted rows. Its tenant column cascades, so deleting an organization deletes its entries. The lifecycle sweep reaps an entry once its stamped `purge_after` has passed (`ttl` on `purge_after`, window `0h`), and asks no resolver.
- **`@objectstack/objectql`:** a by-id delete of a business record writes one entry in the delete's own unit of work, before the record's row is removed. The entry holds the record and its master-detail cascade, the master first. Each row keeps its declared columns, and `secret` columns are left out, so a restored record's secret fields come back empty. The entry also records the `set_null` references the delete cleared, and `deleted_by`, `deleted_at`, `retention_days` and `purge_after`. If removing the row fails, the entry goes too: the transaction rolls it back, or the engine removes it when no transaction covered it.
- **Retention:** `ObjectQLPlugin`'s new `recycleBinRetention: { resolve, token }` option takes the host's retention resolver, called once per delete with the token the host handed over. When the option is absent or the resolver answers `undefined`, the retention is `OS_RECYCLE_BIN_RETENTION_DAYS`, else 30 days. A value that is not a positive whole number of days is refused: from the resolver, the delete is refused before it writes anything; in the variable, the boot is refused, because the plugin reads it in `init()`.
- **Which deletes do NOT enter the bin:**
  - a delete by predicate (`multi: true`), which includes the lifecycle sweep;
  - a child the cascade deletes, which is a row of its root's entry instead;
  - any `sys_*` object, whose rows are also left out of a business record's snapshot;
  - any delete on a composition that does not register `PlatformObjectsPlugin`, which logs one `info` line saying so.
- **Forward-only:** records deleted before this release have no entry.
- **Storage:** every by-id delete of a business record now also writes one `sys_recycle_bin` row holding the deleted rows. The row is reaped once its retention has passed.
- **`@objectstack/spec`:** `PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` lists `sys_recycle_bin`, so a reference to it lints as a real platform object.
- **`@objectstack/cli`:** the organization-ownership inventory has a row for `sys_recycle_bin` (fate `attribution`).
