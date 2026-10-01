---
'@objectstack/core': minor
---

fix(core)!: a date macro whose offset lands past every instant a JavaScript `Date` can hold is refused `INVALID_FILTER` / 400, naming the placeholder, instead of resolving to the text `Invalid Date` or throwing an uncoded `RangeError`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a VALUE in @objectstack/core's filter-placeholder resolver: a date macro (such as {300000_years_ago} or {99999999999999999999_minutes_ago}) whose offset lands past every instant a JavaScript Date can hold, refused INVALID_FILTER / 400 by resolveFilterToken and resolveFilterTokens. No authorable key, spelling, export or stored metadata shape moves: every filter, view, dataset and query shape parses as before, the date-macro vocabulary is unchanged, and @objectstack/core exports nothing new and nothing less (resolveFilterToken and resolveFilterTokens keep their signatures; the error class is module-private). The categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a value range or a resolved value and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what `resolveFilterToken` and `resolveFilterTokens` answer for one class of inputs, and so what every door that resolves filter placeholders answers. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What is refused now.** A relative-date placeholder whose offset lands past the instants a JavaScript `Date` can hold names no day and no time. The resolver used to answer a day-or-coarser one (`{300000_years_ago}`) with the text `Invalid Date`, which compares as text, and to throw an uncoded `RangeError: Invalid time value` for a sub-day one (`{99999999999999999999_minutes_ago}`). Measured before this through `engine.find` on InMemoryDriver and `POST /api/v1/data/:object/query` on SqlDriver over SQLite, over a `datetime` field with a row in 2026 and a row in 1500:

- `$lt {300000_years_ago}` answered both rows, and `judgeFilter` answered `{ ok: true }`;
- `$lt {99999999999999999999_minutes_ago}` threw the uncoded `RangeError` from `engine.find` and `judgeFilter`, and the REST door answered `500 INTERNAL_ERROR`.

Both are refused now with `INVALID_FILTER` / 400 at every position the engine resolves (`where` on `find`, `findOne`, `count`, `aggregate`, a multi-row `update` and `delete`, a per-aggregation `filter`, `having`) and through `judgeFilter`, before any driver read. Every other caller of `resolveFilterToken` / `resolveFilterTokens` receives the same coded error in place of the text or the `RangeError`. The refusal is the same on every column, because the resolver does not know the column: such a placeholder names no value at all.

**What an author sees.** `Relative-date placeholder "{300000_years_ago}" names no instant: its offset lands past every instant a JavaScript Date can hold, so it resolves to no day and no time, and it is refused rather than compared. A date value names a year from 0001 to 9999, and a datetime value a year from 1000 to 9999: use a relative-date placeholder whose offset lands inside those years.` The thrown error carries `code: 'INVALID_FILTER'`, `status: 400` and `token` (the placeholder's name), the code the engine already answers for a placeholder that resolves outside its column's years.

**Unchanged.** A placeholder that names an instant resolves as before, including one past the years 0001..9999 that a `Date` still holds (`{273847_years_ago}` resolves to `-271821-09-30`); the engine's per-column year range judges that one, as before. Context placeholders and an unknown placeholder answer as before.
