---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': minor
---

feat(spec, metadata-protocol): a seed dataset can declare `dependsOn`, the objects it loads after, for an order no lookup field gives

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #34277 — `skills/objectstack-data/references/seeds.md` (its relationship section and its best-practice table tell the author to order seeds parent before child in the exported array, which orders nothing; `dependsOn` is not taught)

The seed loader orders a load's datasets by the `lookup`, `master_detail` and `user` fields between their objects; the order of the stack's `data` array only breaks ties. A dataset whose `beforeInsert` hook reads another seeded object had no way to say so, and its hook ran against whatever that object held at the moment, which an unrelated dataset could change. A rating scored from seeded bands, ordered by its one lookup to its rule, was written a wave before the bands and scored every row as if none existed.

- **`Seed.dependsOn: string[]` names objects.** Each name adds an edge to the same dependency graph the lookup fields feed, so the dataset's object loads after the named object's rows: `defineSeed(CustomerRating, { dependsOn: ['crm_rating_band'], records })`. The edges of several datasets of one object are pooled onto that object, and the returned `dependencyGraph.nodes[].dependsOn` lists them beside the lookup edges.
- **A load that declares none keeps its order exactly.** Nothing changes for an app that does not write the key.
- **A declaration the load cannot honour refuses the whole load, before any row is written.** The load answers `success: false` with one `errors[]` entry per refused declaration (`field: 'dependsOn'`, `sourceObject` the declaring object, `targetObject` the named one), and every caller reports it the way it reports any failed load. Three cases: a name that is the dataset's own object; a name no other dataset of the same load seeds (a misspelling, or an object whose datasets `env` or `locale` scoped out of this load, which the message says); and a declared edge that closes a cycle with the other edges, lookups included, with the cycle spelled out object by object. A cycle made of lookup fields alone still loads in deferred passes, as before.
- **A refused boot seed reads as a failed seed.** The single-tenant boot seed (`AppPlugin`) counts each error of a load refused before any dataset ran as a rejected row in the outcome it records, so `os dev` / `os serve` print the source with a warning on the banner's `Seeds:` line and the `objectstack:seed-settled` message answers `ok: false`; before, a refused load wrote nothing and read clean on both.
- **`defineSeed` refuses a dataset that names its own object** when it runs. The other two cases need the whole load, so only the loader can judge them.

A seed published on its own (a draft publish) is its own load, so a published seed whose `dependsOn` names an object seeded by another item is refused until the two are published together.
