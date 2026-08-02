---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): boot hydration grafts each overlay row's protection envelope from ITS OWN package (#4624)

`loadMetaFromDb` (boot hydration) kept a **third** inline copy of the
overlay→SchemaRegistry registration rule, and its artifact lookup was
**unscoped** — the exact pre-#1828 shape ADR-0048 removed from `getMetaItems`:
with two installed packages shipping the same `type`/`name`, a name-colliding
overlay row grafted the **first-registered** package's
`_lock`/`_lockReason`/`_packageId`/`_provenance` onto another package's row at
every kernel boot. A row customized under package B could come up wearing
package A's identity and lock.

The non-object branch now delegates to the ONE shared
`hydrateOverlayIntoRegistry` (introduced by #4521 for the read-side hydration
and the write-through), passing the row's own `package_id` — one rule, one
implementation, and the ADR-0048 package-scoped lookup applies at boot exactly
as it does on read and write.

No other boot behaviour changes:

- **Boot order** — when packaged artifacts have not loaded yet at hydration
  time, the scoped lookup finds nothing, exactly like the unscoped one did,
  and the row registers unchanged.
- **Package-less (global) rows** — `package_id IS NULL` keeps the legacy
  best-effort first-match graft, identical to the read-side hydration.
- **Row selection** — the helper carries no environment gate; which rows
  `loadMetaFromDb` loads is decided by its query, unchanged here.
