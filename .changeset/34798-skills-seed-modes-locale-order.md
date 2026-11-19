---
'@objectstack/skills': patch
---

docs(skills): the seeds reference drops the retired seed modes `insert` / `replace`, names `locale`, `fallback` and `dependsOn`, and stops teaching array order as load order

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s `references/seeds.md` no longer lists `insert` or `replace` as import modes: both are refused, and a dataset with no single natural key keeps the default mode with a composite `externalId` (a junction table's `['team', 'project']`), or `'id'` when the records carry their own ids. `objectstack-platform`'s Seed Data passage lists only `ignore`, `upsert` and `update`.

The seeds field table now names `locale` (the BCP-47 tags a dataset loads for), `fallback` (`true` on one locale-scoped set per object, which also loads for a resolved locale no set of that object lists) and `dependsOn`.

The relationship section says lookups order the load and the exported array's order only breaks ties; a lifecycle hook that reads a seeded object no lookup links to declares `dependsOn` with object names, and a name that is the dataset's own object, is not seeded by the same load, or closes a cycle refuses the whole load with nothing written. Two eval cases cover the composite-key conversion and `fallback`.

`seeds.md` pays first by deleting restatement in the same file (three best-practice rows, the `upsert` re-assert clause, "no other mode updates a matched row", "Natural keys remain the portable default"); its token ceiling moves +13, the measured remainder. `objectstack-platform/SKILL.md` re-locks 15 tokens lower.
