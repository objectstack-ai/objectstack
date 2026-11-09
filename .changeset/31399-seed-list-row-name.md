---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the metadata list serves every stored `seed` item, named by its row

Clause-②: no
Metadata-protocol: none

`getMetaItems({ type: 'seed' })`, the read behind `GET /api/v1/meta/seed`, listed no stored seed item while `GET /api/v1/meta/seed/:name` served each one. A seed body states no name (`SeedSchema` declares none; the name lives on the stored row), and the list merge keyed every stored body by its own `name`, so it skipped each seed. The merge now slots a stored body that states no name by its row's name, the name the by-name read finds it under, and serves it carrying that name. This holds on the environment's list, the package-scoped list and the draft preview, and a package's shipped seed of the same name shares that one slot. A body that states its own name keeps it, the stored body is not written, and `SeedSchema` is unchanged.
