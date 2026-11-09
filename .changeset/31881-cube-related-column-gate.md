---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a hand-authored cube member naming a column its related object lacks is refused `INVALID_FIELD` / 400, not answered with a database error

Clause-②: no — a dotted member on a hand-authored cube that reads a column the related object does not have (`vendor.nope`, or `vendor.region` when the vendor object has no `region`) reached SQL on the native-SQL strategy and failed `DATABASE_ERROR` / 500; it is now refused `INVALID_FIELD` / 400 by the same related-column gate a compiled dataset already asked, in that gate's own sentence, naming the member and the related object. Nothing that was served changes: a related column that exists still joins and filters. No export, error code or status is added.
Metadata-protocol: none

- **Before.** Measured on `main` `80c4c9a2` with a real `SqlDriver`, a hand-authored cube over a deal whose `vendor` lookup points at an object with no `region`: `vendor.nope` and `vendor.region` answered `DATABASE_ERROR` / 500 on the native-SQL strategy as a `where` leaf, a dimension and a windowed time dimension. The engine-aggregate strategy refused them 400 in three different sentences (its cross-object filter refusal, the engine's group-by guard, its cross-object bucket refusal). A compiled dataset over the same object refused the same input `INVALID_FIELD` / 400 naming the member and the related object.
- **Now.** Both strategies answer the compiled dataset's refusal for these members on a hand-authored cube, before either compiles. A path the cube's configured relationship allowlist does not back keeps that allowlist's refusal. Unchanged: a hop the cube's object does not declare as a relationship field, and a cube whose `sql` is a statement rather than an object name, answer what they answered before.
