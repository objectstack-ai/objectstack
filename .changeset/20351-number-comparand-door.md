---
"@objectstack/objectql": minor
---

fix(objectql)!: a string compared against a number field must be a number: a non-numeric one is refused with `INVALID_FILTER` / 400 on `where`, a per-aggregation `filter` and `having`, and a numeric one is narrowed to its number (#20351)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a filter COMPARAND at the engine's query door: no authorable key, spelling or stored shape moves, `packages/spec` is untouched (the grammar, the verdict and the words shipped with the spec contract), and no stored row is read or rewritten. What is refused is a string that names no number, compared against a declared numeric field or a numeric aggregated column; which number the caller meant is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter comparand (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter may compare a number field with. A string the platform's numeric grammar does not read as a number used to answer 200 with no rows (every row under `$ne`) on memory and SQLite and a 500 on PostgreSQL; it now answers 400, before any read, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. `@objectstack/objectql`'s root exports are unchanged.

FROM a string that is not a JSON number spelling of a finite number (`"abc"`, `""`, `" 12 "`, `"0x10"`, `"1,000"`, `"+5"`, `"007"`, `"Infinity"`, a `{placeholder}`), compared against a `number`, `currency`, `percent`, `rating`, `slider`, `progress` or `summary` field (or a `count` / `sum` / `avg`, or a numeric `min` / `max` / groupBy column in `having`) at the implicit comparand, `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`, or a member of `$in` / `$nin` / `$between` → TO `INVALID_FILTER` / 400, naming the field, its declared type, the comparand, its position and what is wrong with it. The fix is one line: send the number (`12`, `-3.5`, `1e3`) or a string of exactly that spelling (`"12"`).

Measured through `engine.find` / `engine.aggregate` and `POST /data/:object/query` (the two doors agree), three rows (5, 12, 30):

| position | comparand on a `number` field | before: memory · SQLite · PostgreSQL 16 | now, on all three |
|:--|:--|:--|:--|
| `where` | `$gt` / `$eq` / implicit / a `$in` member `"abc"`; `$eq ""` | no rows · no rows · `DATABASE_ERROR` (500) | `INVALID_FILTER` / 400 |
| `where` | `$ne "abc"` | every row · every row · 500 | `INVALID_FILTER` / 400 |
| `where`, over REST | `$gt "{current_user_id}"` (resolved to the user's id) | no rows · no rows · 500 | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | `$gt "abc"` (`$ne "abc"`) | count 0 (3), on all three | `INVALID_FILTER` / 400 |
| `having` on `sum(amount)` | `$gt "abc"` (`$ne "abc"`) | no group (every group), on all three | `INVALID_FILTER` / 400 |
| `where` | `$gt "12"` / `$eq "12"` | **no rows** · 1 row · 1 row | 1 row, the number's answer |

What changes:

- A new door at the engine's single filter collection point, after the temporal-comparand door. It reads `@objectstack/spec/data`'s published contract (`numberComparandDoorVerdict` over `NUMERIC_VALUE_TYPES`, the numeric grammar, and `numberComparandRefusalMessage` for the words); the engine carries no numeric grammar of its own.
- It runs on `where` in both spellings (the filter object and the `FilterArray` sugar) on `find`, `findOne`, `count`, `aggregate`, `update` and `delete`, and on `IObjectQLEngine.judgeFilter`; on each per-aggregation `filter`, against the object's declared fields; and on `having`, over the columns the engine classes numeric.
- A numeric string is rewritten to its number, copy-on-write, before any driver or in-memory evaluator reads it. InMemoryDriver used to compare `"12"` as a string and match nothing; it now matches what `12` matches, as SQLite and PostgreSQL already did.
- A `{placeholder}` compared against a number field is refused unresolved: every filter token resolves to an id or a date, never a number.

**Who is affected.** A caller that compares a number field with a string that is not a plain number, through any door that reaches the engine: a REST query parameter (`?amount=abc`), a `where` / `$filter` / `filter` body of `POST /data/:object/query`, or an in-process engine call. A caller that sends a number, or a numeric string such as `"12"` or `"1e3"`, is unaffected, except that memory now answers it as the other drivers do.

**Unchanged.** A numeric comparand: the `$gt 10` controls at `where`, the per-aggregation `filter` and `having` answered identically before and after on memory, SQLite and PostgreSQL, through the engine and REST. Not judged by this door, so the filter reaches the driver as written (pinned per case in the engine suite): a string compared against a non-numeric field; `$null` / `$exists` / `$empty`; the text operators (a text operator over a number field keeps its own refusal); a `{ $field }` reference; a dotted key; a key that names no declared field. A `formula` field is still refused one door earlier with `INVALID_FIELD`. RLS, sharing and tenant predicates the security layer composes onto a query are not judged by this door; a policy predicate is judged at authoring where the host hands the rule the engine's `judgeFilter`. A boolean or a `Date` compared against a number field is outside this contract (it judges strings) and keeps its old answer, measured: `$gt true` no rows on memory, every row on SQLite and a 500 on PostgreSQL; a `Date` no rows on memory and SQLite and a 500 on PostgreSQL.
