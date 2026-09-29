---
"@objectstack/objectql": minor
---

fix(objectql)!: a `date` string is written in its `YYYY-MM-DD` form, or it is refused with `VALIDATION_FAILED` / 400 (`invalid_date`) — `"2026/07/15"` is no longer stored verbatim as a non-day (#20481)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a written VALUE at the record validator's date arm: no authorable key, spelling or stored shape of metadata moves, `packages/spec` is untouched, and a stored row keeps whatever it holds. What is refused is a date string without a leading YYYY-MM-DD, and which calendar day such a string meant (07/08/2026 names two) is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a `date` field accepts as a written value. It ships as `minor` under the launch-window convention for accept-set narrowings (`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by this banner and the ADR-0087 disposition above).

FROM a `date` field written as a string with no leading `YYYY-MM-DD` that `Date.parse` still reads — `"2026/07/15"`, `"07/15/2026"`, `"07/08/2026"`, `"15 July 2026"`, `"July 15, 2026"`, `"2026-7-15"`, `"2026.07.15"`, `"+002026-07-15"` → TO `VALIDATION_FAILED` / 400 with the field code `invalid_date` and its existing message, nothing written. The fix is one line: send `YYYY-MM-DD` (`"2026-07-15"`), or a JS `Date`.

No other spelling is read for you, on purpose: `07/08/2026` is July 8 in one locale and August 7 in another, and a guess stores the wrong day silently.

Measured through `POST /api/v1/data/:object` and a read-back, before this change, the process in America/New_York and PostgreSQL 16 at `DateStyle` `ISO, MDY`:

| written to a `date` | memory | SQLite | PostgreSQL | now, on all three |
|:--|:--|:--|:--|:--|
| `"2026/07/15"`, `"07/15/2026"`, `"15 July 2026"`, `"2026-7-15"`, `"2026.07.15"`, `"July 15, 2026"` | 201, read back verbatim | 201, read back verbatim | 201, `"2026-07-15"` | 400 `invalid_date` |
| `"07/08/2026"` | 201, verbatim | 201, verbatim | 201, `"2026-07-08"` (a `DMY` server reads August 7) | 400 `invalid_date` |
| `"+002026-07-15"` | 201, verbatim | 201, verbatim | 500 | 400 `invalid_date` |

A verbatim `"2026/07/15"` is not a day: it sorts and compares as text beside real days, so it falls out of every date range and every date filter. PostgreSQL's reading was its server's `DateStyle`, not the writer's.

What changes:

- The record validator's `date` arm asks one more question of a string: does the `date` storage rule read it? That rule (`@objectstack/core`'s `temporalStorageForm`) collapses a string with a leading `YYYY-MM-DD` to that day and hands every other string back unchanged. The question is asked through `isUninterpretableTemporalComparand`, the predicate the engine's temporal-comparand door already refuses such a `date` comparand with, so a `date` string refused on `where` is refused as a written value too. It applies on insert, update, a multi-row update and `engine.validate` (the dry run), before any driver write.

**Who is affected.** A caller that writes a `date` field as a locale or free-form string: a REST or SDK client, a flow, an MCP `create_record` / `update_record` call written by a model. The server import (`POST /api/v1/data/:object/import`) is not affected: it already turns a date cell into `YYYY-MM-DD` before the write. A row that already holds such a string keeps it, since nothing re-reads stored rows. An update that omits the field is not affected; one that sends the old string back is refused, so re-write the field as `YYYY-MM-DD`.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL through REST:

- a string with a leading `YYYY-MM-DD`, still stored as that day: `"2026-07-15"`, `"2026-07-15T10:00:00Z"`, `"2026-07-15 10:00"`, `" 2026-07-15"`;
- a `Date`, still stored as its UTC calendar day;
- an epoch-millisecond number, still refused with `invalid_date`;
- a string `Date.parse` cannot read, still refused: `"20260715"`, `"15/07/2026"`;
- the year range 0001..9999;
- every `datetime` and `time` value.
