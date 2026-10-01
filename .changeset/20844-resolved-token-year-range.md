---
'@objectstack/core': minor
'@objectstack/objectql': minor
---

fix(core,objectql)!: a relative-date placeholder that resolves outside its field's years is refused `INVALID_FILTER` / 400, naming the placeholder and the year it resolved to, instead of reaching the driver and answering the wrong rows

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a VALUE at the engine's filter-resolution stage: a relative-date placeholder (a date macro such as {8000_years_from_now}) whose resolved day or instant falls outside its column's years, refused INVALID_FILTER / 400 on where, a per-aggregation filter and having. No authorable key, spelling, export or stored metadata shape moves: every filter, view, dataset and query shape parses as before, the date-macro vocabulary is unchanged, and @objectstack/core and @objectstack/objectql export nothing new and nothing less (resolveFilterToken and resolveFilterTokens keep their signatures). The resolver's spelling of a day outside 0001..9999 changes, and that day was never a value any reader read as the day it names. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers a value range or a resolved value and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what the engine answers for a filter carrying a relative-date placeholder. A date macro is resolved after the temporal-comparand door, which steps around a placeholder, so the year range that door asks of a literal never saw the value one resolved to. It does now, through the same function, core's `isOutsideTemporalYearRange`, by the column's kind: a `date` takes the years 0001 to 9999 and a `datetime` 1000 to 9999. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What is refused now.** A date macro whose resolved value falls outside its column's years, on a declared `date` or `datetime` field (or, on a `time` field, one that resolves to an instant whose UTC year has no four-digit spelling), at `where` (on `find`, `findOne`, `count`, `aggregate`, a multi-row `update` and `delete`), at a per-aggregation `filter`, at `having` (by the aggregated column's kind), and through `judgeFilter`. On REST that is `POST /api/v1/data/:object/query` and every other door that reads through the engine. Measured before this on InMemoryDriver and SqlDriver on SQLite, over a `datetime` field with a row in 2026 and a row in 1500:

- `$gt {8000_years_from_now}` answered both rows, and the right answer was none;
- `$lt {2027_years_ago}` answered the 1500 row, because the resolver spelled year -1 as `-1-10-01` and that text was read as a day in 2001, and the right answer was none;
- `$lt {1977_years_ago}` resolved to year 49, below the `datetime` floor of 1000, which now applies to a resolved placeholder as it does to a literal;
- on a `time` field, `$gt {8000_years_from_now}` answered every row: the `time` rule keeps no time of day from an instant whose UTC year has no four-digit spelling, so it compared as text. Such a placeholder is refused now in the words a literal of that instant gets.

**What an author sees.** The refusal names the field, the placeholder as written, its position, the value it resolved to and that value's year, in the temporal-comparand door's words for the year class: `filter on 'opened_at' compares a declared datetime field against "{8000_years_from_now}" at where.opened_at.$gt, a relative-date placeholder that resolved to "+010026-10-01" (the year 10026), an instant whose UTC year falls outside the years 1000 to 9999 …`. It ends by asking for a placeholder whose offset lands inside those years.

**The resolver's spelling** (`@objectstack/core`). A date macro that lands on a day outside 0001..9999 now resolves to that day in the expanded-year form of ECMAScript's date time string format, `+010026-10-01` or `-000001-10-01` (year 0 is `0000-10-01`). It used to take the storage rule's unpadded spelling, `10026-10-01` or `-1-10-01`, which `Date.parse` reads through the host's legacy parser in the host's zone, so a day in year -1 read as one in 2001 and could not be judged. Every consumer of `resolveFilterToken` and `resolveFilterTokens` sees the new spelling for such a day only. A day inside 0001..9999 and a sub-day placeholder's instant are spelled as before.

**Unchanged.** A placeholder that resolves inside its column's years answers as before; a `date` keeps the years 0001 to 0999, which a `datetime` refuses, and a `time` field reads the time of day of any instant with a four-digit year, year 0 included. A placeholder on a column with no temporal kind (text, number) and a context placeholder such as `{current_user_id}` are not judged by this range. Every literal comparand answers as before.
