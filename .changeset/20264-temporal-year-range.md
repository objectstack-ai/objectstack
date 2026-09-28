---
"@objectstack/core": minor
"@objectstack/objectql": minor
---

fix(core,objectql)!: a `date` or `datetime` value names a year from 0001 to 9999, or it is refused: `INVALID_FILTER` / 400 as a comparand on `where`, a per-aggregation `filter` and `having`, and `VALIDATION_FAILED` / 400 as a written value (#20264)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a temporal VALUE at the query door and the write door: no authorable key, spelling or stored shape moves, `packages/spec` is untouched, and a stored row keeps the form it has. What is refused is a day or an instant whose year falls outside 0001..9999, and which in-range year the caller meant is not something a ledger entry can decide. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a comparand or a written value (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a `date` or `datetime` field accepts, as a filter comparand and as a written value. A value whose year falls outside 0001..9999 used to answer 200 with the wrong rows, 201 with a non-day stored, or a 500 on PostgreSQL; it now answers 400. It ships as `minor` under the launch-window convention for accept-set narrowings.

FROM a `date` or `datetime` value in year 0, before it, or after 9999 (`"+010000-01-01T00:00:00.000Z"`, `"-000001-…"`, `"0000-06-15"`, or the epoch-millisecond number or `Date` of such an instant) → TO `INVALID_FILTER` / 400 as a comparand and `VALIDATION_FAILED` / 400 (`invalid_date`) as a written value. The fix is one line: write a year from 0001 to 9999.

Measured through `engine.find` / `engine.aggregate` / `engine.insert` and `POST /data/:object/query` / `POST /data/:object` (the two doors agree), over seven 2026 rows, `$gt` / `$lt` / `$eq`:

| position | value | before: memory · SQLite · PostgreSQL 16 | now, on all three |
|:--|:--|:--|:--|
| `where` on a `datetime` | year 10000 or −1: a number, `Date` or ISO string | 7/0/0 · 7/0/0 · `DATABASE_ERROR` (500) | `INVALID_FILTER` / 400 |
| per-aggregation `filter`, `having` on `min` of a `datetime` | the same, `$gt` | 7 rows, every group, on all three | `INVALID_FILTER` / 400 |
| `where` on a `datetime` | year 0, every spelling | 7/0/0 · 7/0/0 · 500 | `INVALID_FILTER` / 400 |
| `where` on a `date` | year 0: a number, `Date`, ISO string or bare `0000-06-15` | 7/0/0 · 7/0/0 · 500 | `INVALID_FILTER` / 400 |
| create a `date` | `"+010000-01-01T00:00:00.000Z"` | 201, read back verbatim (not a day) · the same · 500 | `VALIDATION_FAILED` / 400 |
| create a `date` or a `datetime` | year 0, year −1, year 10000 | 201 · 201 · 500 | `VALIDATION_FAILED` / 400 |

MySQL 8.0 answered the year-10000 and year-−1 cells with a 500 and the year-0 cells like SQLite. A `datetime` in year 10000 spells `+010000-…`, which sorts below every four-digit year as text (its `where` answer was 7/0/0 for `$gt` / `$lt` / `$eq`, where the right answer is 0/7/0); PostgreSQL's `DATE` and `timestamptz` have no year 0 (`22008`). Year 0 was answered right on memory and SQLite and a 500 on PostgreSQL; it is refused everywhere now, one answer on every driver. Each refused query or write now reaches no driver.

What changes:

- `@objectstack/core` exports `isOutsideTemporalYearRange(value, kind)`, the one range both doors ask. The year is the one the kind's storage rule reads: a `datetime`'s UTC year, a `date` string's leading `YYYY-MM-DD` year (otherwise the UTC year of the instant it names), never a `time`'s.
- `isUninterpretableTemporalComparand` is true for a `date` or `datetime` number, `Date` or readable string whose year falls outside 0001..9999; before, it judged only a `date` number or `Date`, against 0..9999. The engine's temporal-comparand door refuses such a comparand on `where` (every verb, both spellings), in a per-aggregation `filter` and on `having`, before any read, in words that name the year range. `IObjectQLEngine.judgeFilter` and `service-analytics`' raw-SQL decline read the same predicate.
- The record validator's `date` / `datetime` arm refuses a value outside the range on insert, update, a multi-row update and `engine.validate`, with the field's `invalid_date` code and its existing message.
- `temporalStorageForm(value, 'date')` pads a `Date`'s or a number's year to four digits for 0001..0999 only; year 0 keeps its unpadded spelling (`0-06-15`) like every other year outside the range. Only a direct driver write, which bypasses both doors, reaches that arm with year 0.

**Who is affected.** A caller that filters on or writes a `date` or `datetime` in year 0, before it, or after 9999. No writer that stores or queries such a year has been measured; the reach is the public query and write doors.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL through the engine and REST: every year from 0001 to 9999 (the edges 0001-01-01 and 9999-12-31T23:59:59.999Z included) and every 2026 control; every `time` cell; every string the rules could not read before, refused in its existing words, except a `date`-column string whose instant names a year outside 0001..9999 (`+010000-01-01T00:00:00.000Z`, `-000001-…`, an out-of-range epoch-millisecond string), refused with the same code and status on `where`, the per-aggregation `filter` and `having` but now in the year-class words; `NaN`, ±Infinity and an Invalid Date, which name no year; the `datetime` storage rule's own spelling of any instant on the write and read paths. On MySQL 8.0, a `datetime` in years 0001..0099 is still stored right and read back a century late through mysql2's instant parser (`0009-03-04T10:00Z` as `2004-09-03T10:00Z`), which ADR-0053 D-F2 keeps and this change does not touch; from year 0100 up it reads back as written. `driver-mongodb` keeps its own copy of the storage rule and is not changed; both doors sit in the engine, in front of it.
