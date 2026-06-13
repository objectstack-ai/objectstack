---
"@objectstack/objectql": minor
"@objectstack/metadata-core": minor
---

feat(metadata): package-scoped customization overlays (ADR-0048 #1824)

A `sys_metadata` customization overlay is now keyed by `(type, name,
organization_id, package_id)`, so two installed packages shipping an item of the
same `type`/`name` can each carry their **own** overlay. Previously the overlay
uniqueness key was `(type, name, organization_id)` — physically one row per
name — so customizing one package's item shadowed both, and a package-scoped
read fell back to whichever row existed.

- **Index**: `idx_sys_metadata_overlay_active` / `…_draft` now include
  `package_id`. The runtime migration (`ensureOverlayIndex`) uses
  `COALESCE(package_id, '')` so package-less (global) overlays stay unique among
  themselves (a plain unique index treats NULLs as distinct). DROP-then-CREATE,
  idempotent; existing rows migrate safely (the old key already guaranteed one
  row per `(type, name, org)`).
- **Write**: `SysMetadataRepository.whereFor`/`put`/`get` scope the upsert to the
  requested package, so a save bound to package B no longer finds and overwrites
  package A's same-name overlay. A package-less save (`packageId` null) targets
  the global row.
- **Read**: `getMetaItem` / `getMetaItemLayered` overlay lookups already prefer
  the package-scoped row; the fallback now resolves only the **global**
  (`package_id IS NULL`) overlay, never a *different* package's row. Package-less
  readers are unchanged (match-any, back-compat).

Verified live against a real collision (two packages each shipping
`page/showcase_task_workbench`): two overlay rows coexist, and `?package=` single
reads + the `?layers=true` Studio editor view each return that package's own
overlay; the unique index migrated in place.

Known follow-up: the *unscoped list* (`GET /meta/:type` with no `?package=`)
still dedupes by bare name, so when two packages both carry an overlay on the
same name the list collapses them — the per-package single-item and editor paths
are unaffected. Tracked for the list-dedup-by-name work.
