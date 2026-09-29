---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
'@objectstack/formula': patch
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

fix(spec,drivers): a `datetime` filter `$lte '9999-12-31'`, or a `$between` whose maximum is that day, includes the whole last supported day on every backend (#20600)

Clause-②: yes (widening) — one new export, `UNBOUNDED_ABOVE`, on `@objectstack/spec` (`data`) and `@objectstack/core`; `nextUtcCalendarDay` answers it for one input that used to answer a string. Nothing any door accepted before is refused, and nothing is removed or renamed.

`9999-12-31` is the last day of the supported years (0001..9999). A bare-day upper bound on a `datetime` field — `$lte`, a `$between` maximum, an analytics `dateRange` end — means that whole day, and is compiled as "before the next day's midnight". That day has no next day with a `YYYY-MM-DD` spelling: `nextUtcCalendarDay('9999-12-31')` answered the five-digit `'10000-01-01'`, which sorts below `'2026-…'` as text. So on SQLite, where a `datetime` column is ISO text, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered no rows; PostgreSQL parsed the bound as an instant and answered them. The memory and mongo drivers, the analytics strategies and the draft preview built their bound from the same answer, and `formula`'s RLS `check` evaluator compared a `'2026-…'` value against it and denied the write.

Every supported value is at most the last millisecond of `9999-12-31`, so that day's whole-day bound bounds nothing. `nextUtcCalendarDay('9999-12-31')` now answers `UNBOUNDED_ABOVE`, a symbol that is neither `null` ("not a calendar day", which would compile the day's midnight and miss the rest of it) nor a string, and every backend compiles no upper bound for it:

- `$lte` / `<=` on that day asks only that the value is not null: `IS NOT NULL` on the SQL drivers and the analytics echo, `$ne: null` on the memory and mongo drivers.
- A `$between` / `between` whose maximum is that day, and an explicit analytics `dateRange` ending on it, keep only their minimum.
- The type-blind `formula` `check` evaluator and the draft preview admit every value that denotes an instant, and compare any other value as written.
- `$gte`, `$gt`, `$lt` and `$eq` on that day are unchanged: they anchor to its midnight, as on every other day. `9999-12-30` and every earlier day compile the same bound as before.

Measured through `POST /api/v1/data/:object/query`, rows at `2026-07-15T14:00Z`, `9999-12-30T10:00Z`, `9999-12-31T00:00Z`, `T10:00Z` and `T23:59:59.999Z`: on SQLite, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered none of them and now answer all five; `$between ['9999-12-31', '9999-12-31']` answered none and now answers the three on that day. PostgreSQL 16 answers the same before and after. `$lte '9999-12-30'` answers the first two rows on both, before and after.

For a TypeScript caller of `nextUtcCalendarDay`: its return type is now `string | typeof UNBOUNDED_ABOVE | null`. Compare the answer to `UNBOUNDED_ABOVE` before using it as a day; TypeScript refuses the symbol in a template literal, a relational comparison and a `string` parameter.

The shared temporal conformance kit (`TEMPORAL_ROWS` / `TEMPORAL_CASES` in `@objectstack/spec/data`) gains the row `z_last` (`9999-12-31T10:00:00.000Z`) and five last-day cases, so every backend it drives is held to this answer; three existing `$gte` / `$gt` cases now also expect `z_last`.
