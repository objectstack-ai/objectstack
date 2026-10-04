---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

The metadata reads' `lock` / `editable` / `deletable` now say what the write doors do with a packaged item

Clause-②: no

Both metadata reads publish the ADR-0010 protection envelope beside the item: `GET /api/v1/meta/:type/:name/layers` (and its deprecated `?layers=true` spelling), and the by-name read `GET /api/v1/meta/:type/:name` where it resolves the envelope. The envelope was resolved from the item's own `_lock` alone, so it ignored the other refusal the write doors apply: an item a code package ships, on a type with no per-org overlay channel, is locked against in-place edits.

**Before.** A packaged flow, action, object, hook, seed, mapping, datasource, external catalog, doc, picklist, field, job, api, capability or agent with no `_lock` read `lock: 'none'`, `editable: true` and `deletable: true`. A packaged page, app, dataset, book, permission set, position, tool or skill read the same. Yet `PUT` refused each of them with `403 NOT_OVERRIDABLE` (or `403 ITEM_LOCKED` when the write names the read-only package), and the removal of the first group was refused too.

**After.** Each read reports what its doors answer:

- The first group reads `lock: 'full'`, `editable: false` and `deletable: false`.
- The second group reads `lock: 'no-overlay'`, `editable: false` and `deletable: true`. Removing a leftover overlay row of these types is allowed: that is the repair path for overlays written before their per-org channel was withdrawn.
- Items of the overlay types (`view`, `dashboard`, `report`, `translation`, `email_template`) are unchanged. So are items no package ships, such as an organization's own flows and actions, and every item while the `OS_METADATA_WRITABLE` operator hatch opens its type.

An item's own `_lock` still applies on top: the two refusals join, and neither replaces the other. `lockReason`, `lockSource` and `lockDocsUrl` are still present only when the item declares them. `provenance` and `packageId` already name the package.

The verdict is the one the write doors already share, read rather than re-derived, so the read moves whenever a door moves. The `lock` field's description in `@objectstack/spec` now names both refusals it reports. No key, type or accepted value changes.

**What to do.** Nothing, unless a client gated an edit or delete affordance on `editable` / `deletable`: it now hides that affordance for packaged items the server refuses, instead of offering a write that answers 403. The refusal itself names the sanctioned route for each type: for a packaged flow, clone it under a new name or switch it off; for a packaged action, switch it off.
