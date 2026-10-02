---
'@objectstack/spec': minor
'@objectstack/service-analytics': patch
---

fix(spec)!: an analytics query's `limit` and `offset` are non-negative integers, and the native face runs an `offset` with no `limit` on SQLite

Clause-②: yes (narrowing)

<!-- adr-0087: registered analytics-query-window-non-negative-integer -->

**BREAKING** — an accept-set narrowing of a published request schema, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads it: the `/analytics` doors, which parse every body with `AnalyticsQueryRequestSchema` (`POST /analytics/query`, `POST /analytics/sql`) or `DatasetSelectionSchema` (`POST /analytics/dataset/query`), and answer `400 VALIDATION_FAILED` before any engine runs.

**`@objectstack/spec`**

- **`AnalyticsQuerySchema.limit` and `.offset`** were a bare `z.number()`. They are `z.number().int().nonnegative()` now. A negative number, a fraction, and an integer above `Number.MAX_SAFE_INTEGER` are refused at the member. `limit: 0` stays legal and answers no rows.
- **`DatasetSelectionSchema`** reads the same two declarations off `AnalyticsQuerySchema.shape`, so the dataset door holds the same accept set with no second copy. **`AnalyticsQueryRequestSchema`** extends the query, so it holds it too.
- The TypeScript types are unchanged (`number`). Only the parse narrows.

Before, no refused value had one answer. Measured at `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14, `order { note: 'asc' }` over four groups:

| window | native SQLite | native PostgreSQL | ObjectQL face |
|:--|:--|:--|:--|
| `limit: -1` | every row | 500 | all but the last row |
| `limit: 1.5` | 500 | two rows | one row |
| `offset: -1` | 500 | 500 | every row |

Each one now answers `400 VALIDATION_FAILED`, with `details.fields[].field` naming `limit` or `offset` (`selection.limit` / `selection.offset` at the dataset door), on both drivers and both faces.

**`@objectstack/service-analytics`**

- **An `offset` with no `limit`** is a valid window: every row after the offset. The native-SQL strategy wrote `OFFSET n` with no `LIMIT` in front of it, and SQLite's grammar has no `OFFSET` without a `LIMIT`, so the query answered `500` (`near "OFFSET": syntax error`) on SQLite, while PostgreSQL and the ObjectQL face answered rows. The statement now carries the executing driver's no-limit spelling, read off the `sqlDialect` hook: `LIMIT -1 OFFSET n` on SQLite, `OFFSET n` alone on PostgreSQL (unchanged bytes), and `LIMIT 9223372036854775807 OFFSET n` when the host names no dialect. The MySQL arm is `LIMIT 18446744073709551615`, asserted as text only (no MySQL server was available to run it).
- The echoed `sql` and `POST /analytics/sql` show the statement that ran, byte for byte, on this face.

## FROM → TO

| you wrote in an analytics query or dataset selection | write instead |
|:--|:--|
| `limit: -1` (meant: no limit) | omit `limit` |
| `limit: 1.5` | the integer page size you meant, for example `limit: 2` |
| `offset: -1` | omit `offset`, or `offset: 0` |
| `offset: 2.5` | the integer number of rows to skip, for example `offset: 2` |

The one-line fix: write `limit` and `offset` as non-negative integers, or leave them out.

## Who is affected, measured

At `origin/main` `ee75aae1a`: no example, package fixture, document or published skill writes a negative or fractional analytics `limit` or `offset`. The one stored producer that lowers into a dataset selection, a dashboard widget's `limit`, is already declared a positive integer (`z.number().int().positive()`). The sibling console repository and deployed metadata were not measured. The service does not parse a query passed to it in-process, so a host that builds an `AnalyticsQuery` in code parses it with `AnalyticsQuerySchema` before handing it over.
