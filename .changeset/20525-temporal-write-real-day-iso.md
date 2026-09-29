---
"@objectstack/objectql": minor
---

fix(objectql)!: a `date` / `datetime` string is written on a calendar day that exists, and a `datetime` string in an ISO 8601 spelling, or it is refused with `VALIDATION_FAILED` / 400 (`invalid_date`) — `"2026-02-30T10:00:00Z"` is no longer stored as March 2, and `"07/15/2026 10:00"` is no longer read in the server's zone (#20525)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a written VALUE at the record validator's date / datetime arm: no authorable key, spelling or stored shape of metadata moves, `packages/spec` is untouched, and a stored row keeps whatever it holds. What is refused is a temporal string naming a day that does not exist, or a datetime string outside the ISO spellings, and which instant such a string meant (a host zone, a locale's day order) is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a `date` and a `datetime` field accept as a written value. It ships as `minor` under the launch-window convention for accept-set narrowings (`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by this banner and the ADR-0087 disposition above).

Two kinds of string are now refused with `VALIDATION_FAILED` / 400, the field code `invalid_date` and its existing message ("must be a valid date (ISO-8601)" / "must be a valid datetime (ISO-8601)"), naming the field, before anything is written:

- **A day that does not exist**, as a `date` or as the day part of a `datetime`: `"2026-02-30"`, `"2026-02-29"` (2026 is not a leap year), `"2026-04-31"`, `"2026-02-30T10:00:00Z"`. `"2028-02-29"` is a real day and is accepted.
- **A `datetime` string in any spelling but these ISO 8601 ones**, after trimming: `YYYY-MM-DD` (midnight UTC); `YYYY-MM-DDTHH:MM[:SS[.fraction]]` followed by `Z`, a `±HH:MM` or `±HHMM` offset, or nothing (a zone-naive wall clock is UTC, ADR-0074); and `YYYY-MM-DD HH:MM[:SS[.fraction]]` with no zone (UTC the same way). Refused now, for example: `"2026/07/15 10:00"`, `"07/15/2026 10:00"`, `"15 July 2026 10:00"`, `"07/08/2026"`, `"2026-07-15 10:00 PM"`, `"Wed, 15 Jul 2026 10:00:00 GMT"`, `"2026"`, `"2026-07"`, `"2026-07-15t10:00:00z"` (lower case), `"+002026-07-15T10:00:00Z"`, and a space-separated time carrying a zone, `"2026-07-15 10:00:00+08:00"` (write it with a `T`).

The fix is to send the value in one of those spellings — `"2026-07-15T10:00:00Z"`, `"2026-07-15T10:00:00+08:00"` or `"2026-07-15 10:00"` — or a JS `Date`. No other spelling is read for you, on purpose: `07/08/2026` is July 8 in one locale and August 7 in another, and a wall clock with no zone was read in whatever zone the server process ran in.

What a caller sees, before and after, through `POST /api/v1/data/:object` and a read-back, the process in America/New_York, PostgreSQL 16 at `Asia/Shanghai`:

| written | memory | SQLite | PostgreSQL | now, on all three |
|:--|:--|:--|:--|:--|
| `date` `"2026-02-30"` | 201, read back `"2026-02-30"`, a day that does not exist | the same | 500 `DATABASE_ERROR` | 400 `invalid_date` |
| `datetime` `"2026-02-30T10:00:00Z"` | 201, read back `"2026-03-02T10:00:00.000Z"` | the same | the same | 400 `invalid_date` |
| `datetime` `"2026/07/15 10:00"`, `"07/15/2026 10:00"`, `"15 July 2026 10:00"` | 201, `"2026-07-15T14:00:00.000Z"`, the server process's zone | the same | the same | 400 `invalid_date` |
| `datetime` `"07/08/2026"` | 201, `"2026-07-08T04:00:00.000Z"`, month-first in the process zone | the same | the same | 400 `invalid_date` |
| `datetime` `"2026"` | 201, `"1970-01-01T00:00:02.026Z"` | the same | the same | 400 `invalid_date` |

The stored instant of a non-ISO `datetime` was a property of the deployment host: the same request landed hours apart on two servers.

What changes: the record validator's `date` / `datetime` arm asks two more questions of a string, on insert, update, a multi-row update and `engine.validate` (the dry run), before any driver write. Does its leading `YYYY-MM-DD` name a day that exists (month 01..12, day up to that month's length, February 29 only in a leap year)? And, for a `datetime`, is it one of the ISO spellings above? A `Date` names a real instant and keeps its answer.

**Who is affected.** A caller that writes a `date` or `datetime` field as a string: a REST or SDK client, a flow, an MCP `create_record` / `update_record` call written by a model. A row that already holds such a value keeps it, since nothing re-reads stored rows. An update that omits the field is not affected; one that sends the old string back is refused, so re-write it in an ISO spelling. The server import (`POST /api/v1/data/:object/import`) turns a `datetime` cell into ISO text itself before the write, so its `datetime` cells reach this check already converted; a `date` cell naming a day that does not exist (`2026-02-30`) is now a per-row `invalid_date`, where memory and SQLite stored it and PostgreSQL failed the row.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL through REST:

- a real leap day: `date` `"2028-02-29"`, `datetime` `"2028-02-29T10:00:00Z"`;
- each ISO spelling above, stored as the same instant: `"2026-07-15T10:00:00Z"`, `"2026-07-15T10:00:00+08:00"` (`"2026-07-15T02:00:00.000Z"`), `"2026-07-15 10:00"` and `"2026-07-15T10:00"` (`"2026-07-15T10:00:00.000Z"`, UTC, not the host zone), `"2026-07-15"` (`"2026-07-15T00:00:00.000Z"`);
- a `date` string with a leading real `YYYY-MM-DD`, still stored as that day;
- a `Date`, still accepted; an epoch-millisecond number, still refused with `invalid_date`;
- the year range 0001..9999;
- every `time` value, and every filter comparand (`where`, a per-aggregation `filter`, `having`).
