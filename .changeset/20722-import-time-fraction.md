---
"@objectstack/rest": minor
---

fix(rest)!: `POST /api/v1/data/:object/import` reads a `time` cell by `@objectstack/core`'s one `time` rule, the rule the write door asks, so the `10:00:00.250` that `/export` writes for a `time` with milliseconds re-imports as itself instead of failing its row as `invalid_date`, and a cell the write door refuses is refused with the write door's code, `invalid_time` (#20722)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of an import CELL value at the `/import` reader's time arm, and the field code that refusal reports: no authorable key, spelling or stored shape of metadata moves, and no schema, type or export changes; `packages/spec` is untouched. The code a refused `time` cell reports moves between two existing members of the closed `FieldErrorCode` catalog (ADR-0114), so nothing is minted or retired, and nothing branches on a field code. An import file is caller input, not stored metadata, and a row already stored keeps whatever it holds, so there is nothing a ledger entry could rewrite. The other categories are closed on facts: `@objectstack/rest` publishes (not `unpublished`); no ADR-0087 id covers an import cell check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what `/import` accepts in a `time` cell. An ISO 8601 instant whose UTC year has no four-digit spelling (`"9999-12-31T23:00:00-02:00"`, which is UTC year 10000) was stored as its UTC time of day (`01:00:00`). It now fails its row with `invalid_time`, as the write door has refused the same value since #20671. A refused `time` cell's row code also moves from `invalid_date` to `invalid_time`, the code the write door gives for the same value. It ships as `minor` under the launch-window convention for accept-set narrowings (`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by this banner and the ADR-0087 disposition above).

The import's `time` reader was a private pattern with no fractional part. A `time` stored with milliseconds (`10:00:00.250`, which the write door accepts and `/export` writes as it is stored) failed its row on re-import with `Clock: "10:00:00.250" is not a valid time`, on every backend, so an export did not re-import. The reader now asks the same rule the write door asks of a written `time`: `isUninterpretableTemporalComparand('time', …)` for the verdict and `temporalStorageForm(…, 'time')` for the stored value. A cell is admitted exactly when the write door admits the same value, and stored as the same wall clock.

Through the route, the process in America/New_York, on memory, SQLite and PostgreSQL 16 (at `Asia/Shanghai`), before and after:

| `time` cell | before | now |
|:--|:--|:--|
| `10:00:00.250`, `23:59:59.999` (what `/export` writes) | row failed, `invalid_date` | stored as written |
| `10:00:00.5`, `10:00:00.000` | row failed, `invalid_date` | `10:00:00.500`, `10:00:00` |
| `2026-07-15T10:00:00.250Z`, `2026-07-15 10:00:00.250` | stored `10:00:00`, the fraction dropped | `10:00:00.250`, as the write door stores it |
| `9999-12-31T23:00:00-02:00` (an instant in UTC year 10000) | stored `01:00:00` | row failed, `invalid_time`, as the write door refuses it |
| `10:00Z`, `10:00+08:00`, `07/15/2026 10:00`, `25:00` | row failed, `invalid_date` | row failed, `invalid_time` |
| `10:00`, `10:00:00`, `2026-07-15T18:00:00+08:00` | `10:00:00` | unchanged |
| `2026/7/15 9:00` (the year-first form) | `09:00:00` | unchanged |

A zone-naive `2026-07-15 24:00` in a `time` cell, refused before, is now read as `00:00:00`: core's rule reads it so, and the write door admits it. A `date` or `datetime` cell keeps `invalid_date`, and the row's sentence is unchanged for every kind. A time of day with a `Z` or an offset stays refused: a `time` carries no zone. The year-first date-time (`2026/7/15 9:00`) is still read as its wall clock; it is the one reading the import has that the write door has not. The dry run reports the same verdicts.

**Who is affected.** A caller of `POST /api/v1/data/:object/import`, including the dry run, whose file carries such an instant in a `time` column now gets that row refused. A client that matched the row report's `code` for a refused `time` cell now reads `invalid_time`. Rows already stored are not rewritten.

This supersedes the note in the `@objectstack/objectql` entry for #20671 that the server import turns a `time` cell into `HH:MM:SS`: the import now keeps a non-zero fraction (`HH:MM:SS.fff`).
