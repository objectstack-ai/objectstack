---
'@objectstack/driver-memory': minor
'@objectstack/driver-mongodb': minor
---

fix(driver-memory, driver-mongodb)!: a non-boolean `$exists` comparand is refused with `INVALID_FILTER` / 400, as `$null`'s is, instead of selecting the rows with no value (#20897)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered filter-query-face-comparands-refused-at-save) this narrows the query faces to the rule that registered entry already records: its reason states that every query face refuses a non-boolean $null / $exists flag, and its replacement is this change's whole migration (a flag is the boolean itself; $exists true is "has a value", false "has no value"). This change makes that statement true on the two drivers that did not yet refuse. No authorable key, spelling, export or published type moves, and no stored row is read or rewritten; a stored filter carrying such a flag is already refused when it is saved, by that entry. -->

**BREAKING**: this narrows what the in-memory driver and the MongoDB driver accept in a filter. A `$exists` comparand that is not a boolean (a string, a number, `null`, `undefined`, an object) is now refused with `INVALID_FILTER` / 400, where these two drivers used to answer it. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

`FieldOperatorsSchema` declares `$exists` as a boolean, and `driver-sql`, `driver-sqlite-wasm` and both Turso transports already refused any other comparand. The in-memory driver and the MongoDB driver did not: they read `$exists` as `value === true`, so every other value asked for the rows with NO value. `{ stage: { $exists: "yes" } }` and `{ stage: { $exists: 1 } }` returned the rows without a stage, the opposite of what was written. `0`, `null` and the string `"false"` landed on that same side by the same default, not because anything read them. The in-memory driver's analytics face read the same flag by truthiness and answered the valued rows for the same filter, so that driver gave two different answers.

**What an author sees now.** `400 INVALID_FILTER` with `driver-sql`'s message, beginning `Operator "$exists" on field "FIELD" requires a boolean comparand (true or false).` and naming the position (`filter.stage.$exists`). On the in-memory driver the refusal covers `find`, `findOne`, `count`, `aggregate`, `updateMany`, `deleteMany` and the analytics face (`query()` and `generateSql()`). There, an `undefined` or object comparand is refused first by that face's comparand-type check, also `INVALID_FILTER` / 400, in its own words. A refused write changes nothing.

**What to write instead.** Write the boolean itself. `"$exists": true` matches rows whose field has a value, and `"$exists": false` matches rows whose field has none.

**Who is affected.** A caller that sent a non-boolean `$exists` to `InMemoryDriver` or `MongoDBDriver` (a test suite, a local or embedded deployment, a flow or hook calling the engine in-process) and read the answer as a real one. On `SqlDriver` the same filter was already a 400.

**Unchanged.** `$exists: true` and `$exists: false` answer exactly as before. The aggregation `filter` and `having` positions, which the engine evaluates itself after the driver, are not changed by this entry.
