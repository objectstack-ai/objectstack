---
"@objectstack/service-analytics": minor
"@objectstack/driver-sql": minor
---

The analytics SQL compilers compile the case-sensitive text family per dialect, so a `$contains` policy on SQLite stops admitting rows it excludes (#15684)

`$contains` / `$notContains` / `$startsWith` / `$endsWith` are case-SENSITIVE on every backend (#4706 Q2 = A). All three of `service-analytics`' SQL compilers emitted `col LIKE ? ESCAPE ?` on every dialect, and SQLite's `LIKE` folds ASCII case unconditionally — the fold cannot be turned off per statement, because `PRAGMA case_sensitive_like` is a connection-global switch. Measured on sql.js over the shared `FILTER_TEXT_ROWS` fixture, `{ name: { $contains: 'acme' } }` answered `['1','2']` — `ACME Corp` **and** `acme corp` — where `FILTER_TEXT_CASES` says `['2']`.

On two of the three compilers that is a wrong chart. The third is `read-scope-sql.ts`, the ADR-0021 D-C read scope: a scope that **admits** rows the policy's case-sensitive predicate excludes is over-reach, not a loose filter — the same reading that file already applied to its own `LIKE` escaping. The `/analytics/sql` echo was wrong in a third way: it printed `LIKE` while the statement it claims to reproduce ran through a driver that has emitted `GLOB` on the SQLite dialects since #6518.

What changed:

- **The construct is chosen per dialect** (`text-match-sql.ts`), arm for arm with `driver-sql`'s own table: `GLOB` on SQLite (case-exact by definition, with its own `*` / `?` / `[` escaped class and no `ESCAPE` clause), `LIKE` over `CAST(… AS BINARY)` on MySQL, and `LIKE` **unchanged** on Postgres, where it is already exactly the ruled semantics. There is no single construct that is case-exact and parses on all three, so the dialect had to become an input rather than a guess.
- **The dialect arrives from the driver that will execute the statement.** New optional `AnalyticsServiceConfig.sqlDialect`, wired by `AnalyticsServicePlugin` from `IDataEngine.getDriverForObject`. `SqlDriver.dialectName` is now public so that answer can be read without a second dialect-resolution table drifting behind the driver's own knex spellings; it is derived and read-only.
- **A host that answers no dialect keeps the `LIKE` it always got** — "cannot answer, do not block". Postgres deployments see byte-identical SQL.

`$icontains` is untouched: it keeps its own ASCII-only fold on both sides, and collapsing the two families onto one path would hand the case-exact family back the fold the ruling took away from it. `LIKE` escaping is unchanged wherever a `LIKE` is still emitted.
