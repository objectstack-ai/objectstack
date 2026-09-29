---
"@objectstack/core": minor
"@objectstack/objectql": minor
---

fix(core,objectql)!: a temporal filter comparand is refused with `INVALID_FILTER` / 400 exactly when the same value is refused as a written value — a day that does not exist (`"2026-02-30"`) is no longer rolled over or compared as text, and a non-ISO `datetime` spelling (`"07/15/2026 10:00"`) is no longer read in the server's zone (#20549); and a `time` comparand whose instant has no four-digit UTC year (`"+010000-01-01T10:00:00Z"`) is refused rather than compared as text (#20480)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a filter comparand VALUE at the engine's temporal-comparand door (where, a per-aggregation filter, having) and, through the same predicate, the analytics raw-SQL decline: no authorable key, spelling or stored shape of metadata moves, `packages/spec` is untouched, and no stored row is read or rewritten. What is refused is a temporal string naming a day that does not exist, a datetime string outside the ISO spellings, and a bare integer string; which instant such a string meant (a host zone, a locale's day order, a year or epoch milliseconds) is not something a ledger entry can decide. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers a comparand value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a `date`, a `datetime` and a `time` field accept as a filter comparand. It ships as `minor` under the launch-window convention for accept-set narrowings (`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by this banner and the ADR-0087 disposition above).

The record validator already refused the `date` / `datetime` classes as written values (`VALIDATION_FAILED` / `invalid_date`). The comparand door was wider, so a filter admitted what a write refused and answered the wrong rows. The two predicates moved into `@objectstack/core`'s `isUninterpretableTemporalComparand`, and both doors now ask that one rule. A comparand is refused with `INVALID_FILTER` / 400, naming the field, before any driver read, at `where`, a per-aggregation `filter` and `having`:

- **A day that does not exist**, on a `date` or as the day part of a `datetime`: `"2026-02-30"`, `"2026-02-29"` (2026 is not a leap year), `"2026-04-31"`, `"2026-02-30T10:00:00Z"`. `"2028-02-29"` is a real day and is read.
- **A `datetime` string in any spelling but the ISO 8601 ones the platform writes**, after trimming: `YYYY-MM-DD` (midnight UTC); `YYYY-MM-DDTHH:MM[:SS[.fraction]]` followed by `Z`, a `±HH:MM` or `±HHMM` offset, or nothing (a zone-naive wall clock is UTC, ADR-0074); and `YYYY-MM-DD HH:MM[:SS[.fraction]]` with no zone. Refused now, for example: `"07/15/2026 10:00"`, `"2026/07/15 10:00"`, `"15 July 2026 10:00"`, `"07/08/2026"`, `"Wed, 15 Jul 2026 10:00:00 GMT"`, `"2026-07-15 10:00:00+08:00"` (write it with a `T`), and a bare integer string such as `"2026"` or `"1784109600000"`.
- **An instant on a `time` column in either class above.** A `time` column reads a comparand that is not a bare wall clock as an instant, by the `datetime` rule, and keeps its UTC time of day — so `"07/15/2026 10:00"` was the host zone's time of day, and `"1784109600000"` a string of epoch milliseconds. A wall clock (`"10:00"`, `"10:00:00.5"`), an ISO instant, a `Date` and an epoch-millisecond number are read as before, in a four-digit year (next).
- **An instant on a `time` column whose UTC year has no four-digit spelling**, in every spelling (#20480): `"+010000-01-01T10:00:00Z"`, `"-000001-01-01T10:00:00Z"`, `"9999-12-31T23:00:00-02:00"` (year 10000 in UTC), and the epoch-millisecond number or `Date` of any of them. A `time` column keeps the UTC time of day of an instant only when that instant spells a four-digit year; any other one reached the driver as written and was compared with the stored `HH:MM:SS` text. No time of day is read from an extended year. Year 0 (`"0000-06-15T10:00:00Z"`) spells four digits, and its time of day is read as before.

Epoch milliseconds stay a `datetime` comparand as a JSON number: `{ "$gt": 1784109600000 }` is read exactly as before. As a string, a bare integer was read as epoch milliseconds, so `"2026"` meant two seconds after 1970 and matched every later row; send the number, or an ISO instant.

What a caller sees through `POST /api/v1/data/:object/query`, the process in America/New_York, PostgreSQL 16 at `Asia/Shanghai`:

| `where` | memory | SQLite | PostgreSQL | now, on all three |
|:--|:--|:--|:--|:--|
| `datetime` `$eq "2026-02-30T10:00:00Z"` | 200, the row stored at `2026-03-02T10:00:00.000Z` | the same | the same | 400 `INVALID_FILTER` |
| `datetime` `$eq "07/15/2026 10:00"`, `"2026/07/15 10:00"` | 200, the row at `2026-07-15T14:00:00.000Z`, the server process's zone | the same | the same | 400 `INVALID_FILTER` |
| `date` `$eq "2026-02-30"` | 200 `[]`, compared as text | the same | 500 `DATABASE_ERROR` | 400 `INVALID_FILTER` |
| `datetime` `$gt "2026"` | 200, every row (read as 2026 epoch milliseconds) | the same | the same | 400 `INVALID_FILTER` |
| `time` `$gt "+010000-01-01T10:00:00Z"`, rows `09:00` / `10:30` / `12:00` | 200, 3 of 3 (compared as text) | the same | 500 `DATABASE_ERROR` | 400 `INVALID_FILTER` |
| `time` `$gt` the number of that instant | 200 `[]` | 200, 3 of 3 | 500 `DATABASE_ERROR` | 400 `INVALID_FILTER` |

The refusal names the field and the value, says the filter was not applied, and names the spellings that are read. The rows a non-ISO comparand matched were a property of the deployment host: the same request answered differently on two servers.

**Who is affected.** A caller that filters a `date` or `datetime` field with a string: a REST or SDK client, a saved report or view filter, a dashboard's analytics query (the raw-SQL strategy declines such a comparand, and the engine refuses it), an MCP `query_records` call written by a model. A `{placeholder}` such as `{30_days_ago}`, the empty string, a JS `Date` and an epoch-millisecond number are unchanged.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL:

- a real leap day: `date` `"2028-02-29"`, `datetime` `"2028-02-29T10:00:00Z"`;
- each ISO spelling above, compared as the same instant whatever the host's zone: `"2026-07-15T14:00:00Z"`, `"2026-07-15T22:00:00+08:00"`, `"2026-07-15 14:00"` (UTC, not the host zone);
- a `date` comparand with a leading real `YYYY-MM-DD`, still compared as that day (`"2026-07-15T10:00:00Z"` on a `date` is July 15);
- the same wall clock as a 2026 instant on a `time` column: `$gt "2026-07-15T10:00:00Z"` answers the `10:30` and `12:00` rows, as does its epoch-millisecond number or `Date`;
- the year range 0001..9999, and every written value (the record validator now asks the same rule it copied, and answers exactly as before).
