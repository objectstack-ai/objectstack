---
'@objectstack/service-analytics': minor
---

fix(service-analytics): on the engine-aggregate path, a `$not`, `$notContains` or null test over a multi-valued lookup now gets the engine's rows instead of `400 INVALID_FILTER` (#20918)

Clause-②: yes

**What changed.** `POST /api/v1/analytics/query` and `POST /api/v1/analytics/dataset/query`, when served by the engine-aggregate strategy (a query with a granularity, or a host with no raw SQL), used to refuse these filters on a SQL driver when the field is a multi-valued lookup (or any other JSON-stored multi-value field). The engine's `find()` and the native-SQL strategy answered them:

- `{ $not: { owners: { $contains: 'u1' } } }`, and any `$not` whose operand tests such a field;
- `{ owners: { $notContains: 'u1' } }`;
- `{ owners: { $null: false } }`, `{ owners: { $exists: true } }`, `{ owners: { $null: true } }`, and the same tests in a dataset measure's own `filter`.

Each now answers the rows the native-SQL strategy answers. Where `engine.find()` serves the same filter, those are its rows too.

**Why.** The analytics `where` door adds a NULL test beside each leaf of a `$not` operand, so that a row holding no value is still answered by the negation. It adds a NULL alternative to the negative-polarity operators too. The engine-aggregate strategy passed both tests to the engine as `{ $ne: null }` and the bare `{ field: null }`. `driver-sql` refuses both spellings over a JSON column, so the whole filter was refused. They now reach the engine as `{ $null: false }` and `{ $null: true }`. The engine's own filter lowering writes the same tests in those spellings for every driver, and `driver-sql` applies them on a JSON column.

**Unchanged.** Every filter on a single-valued field gets the same rows as before. The native-SQL strategy and the `POST /api/v1/analytics/sql` echo are unchanged: they compile their own SQL. A read scope is unchanged too.

**One difference from the engine remains.** `{ owners: { $ne: null } }` and the bare `{ owners: null }` are null tests at the analytics door. Both strategies now answer them, the native strategy as before. `engine.find()` refuses them, because `driver-sql` reads `$ne` and the bare equality as value comparisons on a JSON column. `{ $null: false }` / `{ $null: true }` is the spelling both read the same way.
