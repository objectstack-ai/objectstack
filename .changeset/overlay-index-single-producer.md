---
"@objectstack/metadata": major
---

fix(metadata): remove the second, stale-keyed producer of `idx_sys_metadata_overlay_active` (#6771)

**Breaking:** `addSysMetadataOverlayIndex` and its `AddSysMetadataOverlayIndexResult`
type are removed from `@objectstack/metadata/migrations`. Nothing needs to replace
them — see below.

One index name, `idx_sys_metadata_overlay_active`, had **two** producers with
**different** keys:

| producer | key |
|---|---|
| `metadata-protocol`'s `ensureMetadataOverlayIndexes` (runtime, ADR-0048) | `(type, name, organization_id, COALESCE(package_id, ''))` `WHERE state = 'active'` |
| this package's `addSysMetadataOverlayIndex` | `(type, name, organization_id, environment_id, scope)` |

The second key is the pre-ADR-0048 one. `environment_id` has been retired since
ADR-0005 (2026-05 revision) — `saveMetaItem` no longer writes it and overlay reads
never consult it, so it is NULL on every new row, and SQL UNIQUE treats NULLs as
DISTINCT. `scope` is not part of the current discriminator at all. Both producers
used `IF NOT EXISTS`, so whichever ran first claimed the name and the other
silently became a no-op — decided by boot order, not by any declaration.

Measured against real SQLite before removal:

- On a normal `DatabaseLoader` boot the stored DDL is
  ``CREATE UNIQUE INDEX `idx_sys_metadata_overlay_active` on `sys_metadata` (`type`, `name`, `organization_id`, `package_id`)`` —
  the **declared** index from `metadata-core`'s `sys-metadata.object.ts`, materialized
  by `SqlDriver.syncDeclaredIndexes`, already holds the name with the current key.
  `addSysMetadataOverlayIndex` therefore changed nothing, while still returning
  `status: 'created'`.
- In the one window where it was *not* a no-op — the table present but its declared
  indexes not yet materialized, which the engine path hits by construction because
  ObjectQL's startup owns the sync — it installed the **retired** key. Since
  `syncDeclaredIndexes` skips by name, nothing ever repaired it afterwards, and
  overlay uniqueness was left unenforced on every new row.

So the function could only ever do nothing or do harm. Overlay uniqueness keeps the
two producers that are correctly keyed and deliberate: the runtime partial,
NULL-safe index from `metadata-protocol`, and — for stacks assembled without it —
the coarser unrestricted UNIQUE that the declaration in `metadata-core` materializes,
exactly as that file documents.

Both call sites in `DatabaseLoader.ensureSchema()` are gone with it, and the empty
`catch` that surrounded the engine-path one now reports per the ADR-0120 D4 shape
(name what did not happen, point at the fix, never block the boot) instead of
swallowing driver-resolution failures.

**Migration:** if you called `addSysMetadataOverlayIndex(driver)` directly, delete
the call. Assemble `metadata-protocol` for the partial, active-scoped index, or rely
on the declared index that `syncSchema` already builds.

<!-- adr-0087: not-required (no-migration-prescription) what is removed is a TypeScript function export, not an authored metadata surface: no metadata key, no key spelling and no stored value moves, so `objectstack migrate meta` has nothing to rewrite and the ledger has no upgrader to reach. The index itself is unchanged in the only spelling that ever reached a database from a correct producer. Measured: the export had zero call sites outside its own package across objectstack, cloud and objectui. -->

