---
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
---

fix(driver-memory, driver-mongodb): a non-boolean `$exists` comparand is refused with `INVALID_FILTER` / 400, as `$null`'s is, instead of selecting the rows with no value (#20897)

Clause-②: no

`FieldOperatorsSchema` declares `$exists` as a boolean, and `driver-sql`, `driver-sqlite-wasm` and both Turso transports already refused any other comparand. The in-memory driver and the MongoDB driver did not: they read `$exists` as `value === true`, so every other value asked for the rows with NO value. `{ stage: { $exists: "yes" } }` and `{ stage: { $exists: 1 } }` returned the rows without a stage, the opposite of what was written. `0`, `null` and the string `"false"` landed on that same side by the same default, not because anything read them.

Both drivers now refuse a non-boolean `$exists` (a string, a number, `null`, `undefined`, an object) with `INVALID_FILTER` / 400. The message is `driver-sql`'s, beginning `Operator "$exists" on field "FIELD" requires a boolean comparand (true or false).`, and names the position (`filter.stage.$exists`). On the in-memory driver the refusal covers `find`, `findOne`, `count`, `aggregate`, `updateMany`, `deleteMany` and the analytics face (`query()` and `generateSql()`). There, an `undefined` or object comparand is refused first by that face's comparand-type check, also `INVALID_FILTER` / 400, in its own words. A refused write changes nothing. The analytics face had read the flag by truthiness and answered the valued rows for the same filter, so the in-memory driver used to give two different answers.

`$exists: true` and `$exists: false` are unchanged: `true` selects the rows that have a value, `false` the rows that have none.

**If a query now fails:** write the boolean itself. `"$exists": true` matches rows whose field has a value, and `"$exists": false` matches rows whose field has none.
