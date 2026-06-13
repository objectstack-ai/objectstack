---
"@objectstack/objectql": patch
---

fix(metadata): keep each colliding item's own `_packageId` provenance (ADR-0048)

When two installed packages ship an item of the same `type`/`name`, the
single-item and list reads grafted the artifact protection envelope from a
**first-match** artifact lookup (`lookupArtifactItem(type, name)`), so the
second package's item inherited the FIRST package's `_packageId`. The frontend
prefer-local resolution (dashboard/report/page) filters the unscoped list by
`_packageId`, so this mislabel made it resolve a collision to the wrong package
(or fail to find the local item entirely).

- `getMetaItem` now scopes the artifact lookup to `request.packageId`.
- `getMetaItems` scopes the per-item decorate to the requested package (when the
  whole list is package-scoped) else to each item's own `_packageId`.

`getItem` ordering is unchanged — a bare-key runtime/DB overlay still takes
ADR-0005 precedence over the packaged item (clarifying comment added). An
env-wide (package-less) overlay of a name that collides across packages remains
inherently ambiguous by schema (`sys_metadata` is unique on `type+name+org`, not
package); pure-artifact collisions (the marketplace default) now resolve and
list correctly per package.
