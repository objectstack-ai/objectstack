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

Clause-②: yes (widening) — three new exports on `@objectstack/spec` (`data`) and `@objectstack/core`: the constant `UNBOUNDED_ABOVE`, its type `UnboundedAbove` and the guard `isUnboundedAbove`; `nextUtcCalendarDay` answers the constant for one input that used to answer a string. Nothing any door accepted before is refused, and nothing is removed or renamed.

**BREAKING for TypeScript and JavaScript callers of `nextUtcCalendarDay`** (`@objectstack/spec/data`, re-exported by `@objectstack/core`): its return type gains a member and its answer for one input changes from a string to a symbol, landing in the launch window as `minor` (the lockstep convention: the bump level is not the carrier, this banner and the disposition below are). No filter an author writes and no stored row changes meaning except that a whole-day upper bound on `9999-12-31` now includes that day.

`9999-12-31` is the last day of the supported years (0001..9999). A bare-day upper bound on a `datetime` field — `$lte`, a `$between` maximum, an analytics `dateRange` end — means that whole day, and is compiled as "before the next day's midnight". That day has no next day with a `YYYY-MM-DD` spelling: `nextUtcCalendarDay('9999-12-31')` answered the five-digit `'10000-01-01'`, which sorts below `'2026-…'` as text. So on SQLite, where a `datetime` column is ISO text, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered no rows; PostgreSQL parsed the bound as an instant and answered them. The memory and mongo drivers, the analytics strategies and the draft preview built their bound from the same answer, and `formula`'s RLS `check` evaluator compared a `'2026-…'` value against it and denied the write.

Every supported value is at most the last millisecond of `9999-12-31`, so that day's whole-day bound bounds nothing. `nextUtcCalendarDay('9999-12-31')` now answers `UNBOUNDED_ABOVE`, a symbol that is neither `null` ("not a calendar day", which would compile the day's midnight and miss the rest of it) nor a string, and every backend compiles no upper bound for it:

- `$lte` / `<=` on that day asks only that the value is not null: `IS NOT NULL` on the SQL drivers and the analytics echo, `$ne: null` on the memory and mongo drivers.
- A `$between` / `between` whose maximum is that day, and an explicit analytics `dateRange` ending on it, keep only their minimum.
- The type-blind `formula` `check` evaluator and the draft preview admit every value that denotes an instant, and compare any other value as written.
- `$gte`, `$gt`, `$lt` and `$eq` on that day are unchanged: they anchor to its midnight, as on every other day. `9999-12-30` and every earlier day compile the same bound as before.

Measured through `POST /api/v1/data/:object/query`, rows at `2026-07-15T14:00Z`, `9999-12-30T10:00Z`, `9999-12-31T00:00Z`, `T10:00Z` and `T23:59:59.999Z`: on SQLite, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered none of them and now answer all five; `$between ['9999-12-31', '9999-12-31']` answered none and now answers the three on that day. PostgreSQL 16 answers the same before and after. `$lte '9999-12-30'` answers the first two rows on both, before and after.

**If your code stops compiling.** `nextUtcCalendarDay` now returns `string | UnboundedAbove | null`, where `UnboundedAbove` is a `symbol` with a structural brand. TypeScript refuses that member in a template literal (TS2731), a relational comparison (TS2469) and a `string` parameter (TS2345), so code that used the answer as a day string no longer compiles until it handles the last day. Test the answer with `isUnboundedAbove(answer)` (or `typeof answer === 'symbol'`) first: on its false branch the answer is `string | null` as before, and on its true branch there is no upper bound to compile. `answer === UNBOUNDED_ABOVE` compares correctly but does not narrow, because the branded type is not a unit type. The type is structural on purpose: `@objectstack/spec` ships `./data` as `index.d.mts` and `index.d.ts`, and a `unique symbol` would be two unrelated types in a program that meets both.

**If your JavaScript code handled the answer as text.** For `'9999-12-31'` it is now a registered symbol (`Symbol.for('objectstack.calendarDay.unboundedAbove')`), not `'10000-01-01'`: a template literal or a relational comparison on it throws a `TypeError`, and better-sqlite3 and `pg` refuse to bind it. Every other input answers exactly as before.

The shared temporal conformance kit (`TEMPORAL_ROWS` / `TEMPORAL_CASES` in `@objectstack/spec/data`) gains the row `z_last` (`9999-12-31T10:00:00.000Z`) and five last-day cases, so every backend it drives is held to this answer; three existing `$gte` / `$gt` cases now also expect `z_last`.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves — no spec key, no stored row and no accept set changes, so `objectstack migrate meta` has nothing to reach — and what moves is one published function's return type and its answer for one input, whose channel is the caller's compiler and the banner above. -->
