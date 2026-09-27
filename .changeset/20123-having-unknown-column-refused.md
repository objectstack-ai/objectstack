---
"@objectstack/objectql": minor
---

fix(objectql)!: a `having` key that names no column of the aggregated row is refused on `engine.aggregate`, instead of answering as if that column had no value in every group (#20123)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. A `having` key that names no column of the aggregated row never had a meaning: the rows carry exactly the columns the query projects, so such a key could only ever read "no value". There is no accepted spelling it can be mechanically rewritten to — which of the query's columns the author meant is an authoring decision, and the refusal prints the list. `having` is a request-only key: no metadata type stores it, so there is no stored document for `objectstack migrate meta` to rewrite. The table below records the answer each shape had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what `having` accepts on `engine.aggregate`, and on the REST aggregate query (`POST /data/:object/query`) that forwards it there. A `having` key — at any depth under `$and` / `$or` / `$not` — must name a column of the aggregated row: a groupBy projection (the field name, or a structured item's `alias`) or an aggregation alias. Any other key is refused with `INVALID_FILTER` / 400, once per query, before any driver is asked for a row, on both the native `driver.aggregate()` path and the in-memory fallback, whether or not any group exists. It ships as `minor` under the launch-window convention for accept-set narrowings.

The engine evaluates `having` itself, per aggregated row, and read a key the row does not carry as a column with no value. So a typo for an alias answered like a real query. Measured on the base through `engine.aggregate` on `driver-memory` and `driver-sql`, both paths, and through `POST /data/:object/query` on both, over three groups by `customer_id`, each with a positive `total` (a `sum` alias) beside a `count` alias `n`:

| `having` | before | now |
|:--|:--|:--|
| `{ totl: { $gt: 100 } }`, `{ totl: 500 }`, or `{ amount: { $gt: 100 } }` (a source column the aggregated row does not project) | no group, no error | refused, naming the key, its position and the query's columns |
| `{ totl: { $ne: 1 } }`, `{ totl: { $exists: false } }`, or `{ $not: { totl: { $gt: 100 } } }` | EVERY group, no error | refused |
| `{ $or: [{ total: { $gt: 0 } }, { totl: { $gt: 100 } }] }` | every group whose `total` is positive: the walk stopped at the branch that held | refused |
| `{ $and: [{ total: { $gt: 0 } }, { totl: { $gt: 100 } }] }` | no group | refused |
| `{ 'customer_id.name': 'c1' }` (a dotted path) | no group | refused |
| `{ customer_id: 'c1' }` when the groupBy item is `{ field: 'customer_id', alias: 'cust' }` | no group: the row projects `cust` | refused; `{ cust: 'c1' }` answers |

The refusal opens the way the REST ingress's refusal of an unknown `where` field does ("filters on 'totl' … which is not a column of the aggregated row"), names every unknown key, and lists the aggregated row's columns. Its code is `INVALID_FILTER`, the code of every other `having` refusal: the name is a column of the query's own projection, not a field of the object. It is judged after the rest of the clause: a condition on an unknown column that also carries an unknown operator (`{ nope: { $median: 1 } }`) is still refused for its operator first, as before.

Who is affected: `having` is a request-only key (`QuerySchema.having`, `EngineAggregateOptions.having`), and no metadata type stores it. Every `having` in this repository's docs and published skills names an aggregation alias of its own query (`{ order_count: { $gt: 5 } }` and the like), which answers exactly as before. Callers of `engine.aggregate` and of the REST aggregate query in a deployment were NOT measured.

Not changed: a key naming a groupBy column, a structured item's alias, a `count` / `sum` / `max` alias, or any of those under `$and` / `$or` / `$not`, answers exactly as before on both paths, measured identical before and after.
