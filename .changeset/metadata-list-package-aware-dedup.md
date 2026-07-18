---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): unscoped metadata list dedupes package-aware, not by bare name (ADR-0048 #1828)

`getMetaItems` merged registry items, `sys_metadata` overlay rows, draft-preview
rows, and MetadataService items into `Map`s keyed by bare `name`, so two installed
packages shipping the same `type/name` (e.g. `page/home`) collapsed to one row
(last-write-wins) on an unscoped `GET /meta/:type` whenever either package had an
overlay — and the frontend prefer-local resolution, which reads that list, could
no longer tell the two packages' rows apart.

The three merge sites (plus the env/org pre-merge) now key by `(package, name)`,
mirroring `getMetaItem`'s scoped-then-global-fallback resolution: colliding rows
stay distinct each with its own `_packageId`, a package-less (env-wide) overlay
still wins over the single artifact it customizes (ADR-0005 precedence and
single-package behaviour unchanged), and the registry-hydration artifact graft is
scoped to each row's own `package_id` so a collision no longer mislabels provenance.
