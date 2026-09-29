---
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

fix(objectql)!: a `time` field is a zone-less wall clock — a time of day written with a `Z` or an offset (`"10:00Z"`, `"10:00+08:00"`), and an instant whose UTC year has no four-digit spelling (`"+010000-01-01T10:00:00Z"`), are refused with `VALIDATION_FAILED` / 400 (`invalid_time`) instead of being stored verbatim on memory and SQLite and read back differently, or failing with a 500, on PostgreSQL (#20671)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a written VALUE at the record validator's time arm: no authorable key, spelling or stored shape of metadata moves, and no schema, type or export changes. `packages/spec` gains one sentence in the built-in validation-message catalog (`invalid_time_zoned`, a rendering variant of the existing `invalid_time` wire code, which is unchanged). A stored row keeps whatever it holds, and which wall clock a zone-suffixed time of day meant is not something a ledger entry can decide. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a `time` field accepts as a written value. It ships as `minor` under the launch-window convention for accept-set narrowings (`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by this banner and the ADR-0087 disposition above).

The record validator's `time` arm now asks `@objectstack/core`'s one temporal rule, the same one the `time` filter comparand door asks, so a value is refused as a written `time` exactly when it is refused as a `time` comparand. It reads two things: a bare wall clock `HH:MM[:SS[.fraction]]` in range, and an instant in one of the ISO 8601 spellings a `datetime` is written in, on a calendar day that exists, whose UTC year has four digits (its UTC time of day is stored). Everything else is refused with `VALIDATION_FAILED` / 400 and the field code `invalid_time`, naming the field, on insert, update, a multi-row update and `engine.validate`, before anything is written.

Refused now, where they were accepted:

- **A time of day with a zone suffix**: `"10:00Z"`, `"10:00+08:00"`, `"10:00:00+0800"`, `"10:00:00.250Z"`. A `time` field carries no zone. The refusal has its own sentence, which `@objectstack/spec`'s validation-message catalog now carries in all four locales (`invalid_time_zoned`; English: "… is a time of day with no time zone: drop the Z or offset (HH:MM or HH:MM:SS), or use a datetime field for an instant"). The wire code stays `invalid_time`.
- **An instant the rule does not read as a time of day**: an extended year (`"+010000-01-01T10:00:00Z"`, or a `Date` of it), an instant whose UTC year is 10000 (`"9999-12-31T23:00:00-02:00"`), a day that does not exist (`"2026-02-30T10:00:00Z"`), and a spelling the `datetime` arm already refuses (`"2026-07-15 10:00Z"`, a space and a zone; `"2026-07-15t10:00:00z"`, lower case).

What a caller sees, before and after, through `POST /api/v1/data/:object` and a read-back, the process in America/New_York, PostgreSQL 16 at `Asia/Shanghai`:

| written to a `time` | memory | SQLite | PostgreSQL | now, on all three |
|:--|:--|:--|:--|:--|
| `"+010000-01-01T10:00:00Z"`, `"9999-12-31T23:00:00-02:00"` | 201, read back as written | the same | 500 `DATABASE_ERROR` | 400 `invalid_time` |
| `"10:00Z"`, `"10:00+08:00"`, `"10:00:00+0800"` | 201, read back as written | the same | 201, read back `"10:00:00"` | 400 `invalid_time`, the zone sentence |
| `"2026-07-15 10:00Z"` | 201, `"10:00:00"` | the same | the same | 400 `invalid_time` |

**Who is affected.** A caller that writes a `time` field as a string with a `Z` or an offset, or as an out-of-range instant: a REST or SDK client, a flow, an MCP `create_record` / `update_record` call written by a model. A row already stored with such a value keeps it; nothing rewrites it. PostgreSQL stored a zone-suffixed time of day as its bare wall clock, so only a memory or SQLite deployment can hold one. An update that omits the field is not affected; one that sends the old value back is refused, naming the field. A `time` field whose literal `defaultValue` carries a `Z` or an offset has each insert that falls back to that default refused the same way. The server import (`POST /api/v1/data/:object/import`) turns a `time` cell into `HH:MM:SS` itself before the write, and already refused a zone-suffixed time-of-day cell, so its cells are unchanged.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL through REST:

- a bare wall clock: `"10:00"` and `"10:00:00"` read back `"10:00:00"`, `"10:00:00.250"` reads back `"10:00:00.250"`;
- a full ISO instant with a four-digit year, stored as its UTC time of day: `"2026-07-15T10:00:00Z"` and `"2026-07-15T18:00:00+08:00"` read back `"10:00:00"`;
- a `Date` with a four-digit year, still accepted; an epoch-millisecond number, a `{placeholder}` and an out-of-range clock (`"25:00"`), still refused with `invalid_time`;
- every `date` and `datetime` value, and every filter comparand.
