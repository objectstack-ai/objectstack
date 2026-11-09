---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a declared measure behind the cube's own qualifier in a filter (`orders.total`) answers exactly what its bare spelling `total` answers

Clause-②: no — a `where` / `runtimeFilter` member spelled `<cube>.<measure>` or `<object>.<measure>`, where the measure is declared, was refused or failed on every strategy while the door's gate had already admitted it as the measure; it now answers exactly what the bare `<measure>` answers, the same statement and the same rows. Nothing that was served changes: a dotted member whose first segment is neither the cube nor its object is still a relationship path, judged as before. No export of the package root, error code or status is added.
Metadata-protocol: none

- **Before.** Measured on `main` `ac8fede8` with a real `SqlDriver`, a dataset `orders` over a deal object with a measure `total` (`sum` of `amount`): `runtimeFilter: { total: { $gt: 5 } }` filtered `amount > 5` row by row on both strategies, while `orders.total` was refused `DATASET_INVALID` / 400 on the native-SQL strategy ("join … is not backed") and as a cross-object filter on the engine-aggregate one, and the object's own name in front (`deal.total`) was refused `INVALID_FILTER` there. A hand-authored cube answered `<cube>.total` with a database refusal (`DATABASE_ERROR` / 500) from a join to a table named for the cube.
- **Now.** Every one of those spellings filters the measure's column exactly as `total` does, on both strategies and on the draft preview.
