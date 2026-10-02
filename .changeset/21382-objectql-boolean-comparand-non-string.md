---
"@objectstack/objectql": minor
---

fix(objectql)!: a number other than `1` / `0`, a `Date` or an array compared against a boolean field is refused with `INVALID_FILTER` / 400 at `where`, a per-aggregation `filter` and `having`, instead of a PostgreSQL 500 or an empty 200

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of filter COMPARANDS at the engine's query door, against a declared boolean or toggle field or a boolean aggregated column. No authorable key, spelling, export or stored shape moves: every query shape, every FilterCondition and every object definition parse as before, @objectstack/objectql exports nothing new and nothing less, and no stored row is read or rewritten. What is refused is a comparand that answered a server error on PostgreSQL and an empty 200 on InMemoryDriver and SQLite, and which boolean a caller meant by 2 is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand, and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what a filter may compare a declared `boolean` or `toggle` field with, at every filter position and through every door that reaches the engine's filter walk (`engine.find` / `findOne` / `count` / `aggregate` / `update` / `delete`, and every spelling the data API hands it). It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type of this package changes; the rule is `@objectstack/spec/data`'s `booleanComparandDoorVerdict`, whose own changeset lists what moved there.

**What was answered before.** A non-string comparand outside the accepted set reached the driver as written. Measured on two rows (one `true`, one `false`) through `engine.find` / `engine.aggregate`, on InMemoryDriver, SqlDriver over SQLite and SqlDriver over PostgreSQL 16:

| position | comparand | before: memory · SQLite · PostgreSQL | now, on all three |
|:--|:--|:--|:--|
| `where` | implicit / `$eq` `2`, `-1`, `0.5`, a `Date` | no row · no row · `DATABASE_ERROR` (500) | `INVALID_FILTER` / 400 |
| `where` | `$ne` the same | both rows · both rows · 500 | `INVALID_FILTER` / 400 |
| `where` | a `$in` member `2` or a `Date` | the other members' rows · the same · 500 | `INVALID_FILTER` / 400 |
| `where` | a `$in` member `[true]` | the other members' rows (200) · a driver 400 · a driver 400 | `INVALID_FILTER` / 400, in one set of words |
| per-aggregation `filter` / `having` | any of the above | count 0 and no group (every row and group under `$ne`), a `$in` member ignored, on all three | `INVALID_FILTER` / 400 |
| all three positions | `true`, `1`, `"true"` (the controls) | the true row, count 1, the true group | the same |

**The remedy.** Write `true` or `false` (or `1` / `0`). To match either value, use `$in`, each member a boolean. Compare a `Date` with a date or datetime field.

**Unchanged.** `true` / `false` pass as written, the accepted spellings (`1` / `0`, `"1"` / `"0"`, `"true"` / `"false"`) narrow as before, and any other string is refused in the same words as before. `null` (the null test) and the flag operators answer as before. A value outside the accepted comparand types (`undefined`, a plain object, a `Map`) keeps the comparand-type door's own refusal and words. A filter on a `formula` field is still refused one step earlier. Driver-direct callers that never pass through the engine keep each driver's native binding.
