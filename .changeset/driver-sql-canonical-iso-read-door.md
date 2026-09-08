---
"@objectstack/driver-sql": minor
---

The record read doors present the builtin audit stamps (`created_at`, `updated_at`) and every declared `Field.datetime` column as the canonical instant text `YYYY-MM-DDTHH:MM:SS.sssZ` on EVERY dialect — Postgres and MySQL now included, exactly as SQLite always has (ADR-0053 addendum D-F1..D-F3, #13973).

**Consumer-visible change, Postgres and MySQL only.** An in-process consumer reading such a column off a `find()` / `findOne()` row, off the row `create()` / `update()` / `upsert()` / `bulkCreate()` / `bulkUpdate()` return, or out of `aggregate()` (`min` / `max`, a raw temporal group key) or `distinct()`, receives a `string` where it received a JS `Date`. The wire is unchanged: `JSON.stringify` already serialised that `Date` as the same ISO text, so REST, MCP and SDK callers see nothing move. A consumer that called a `Date` method directly on the field (`.getTime()`, `.toISOString()`, `.getFullYear()`) now fails loudly with a `TypeError` instead of silently working on one dialect; the sweep behind this change found none in the repository's non-test sources. A consumer that compared, sorted, keyed or formatted the value as text — the shape eight production-driver defects had (#13382, #13993–#13999) — is now correct by construction on every dialect.

- **Where the fold happens.** At the driver's own read boundary (`formatOutput` for rows, `presentReadValue` for the aggregate/distinct doors). The `pg` and `mysql2` client parsers are untouched: a `Date` is still what the client materialises, and a raw knex read still hands it back. Only the driver's read doors changed.
- **The builtin audit columns gain an `aggregate()` / `distinct()` arm on every dialect.** `max(updated_at)` and `distinct('created_at')` had no read presentation at all before — on SQLite they even missed ADR-0074's legacy-row repair — and now present exactly what `find()` presents.
- **An Invalid `Date` is the one shape the fold hands through unchanged** (#14078: a MySQL zero `DATETIME`; a Postgres year past 275760). It has no canonical text; the fold never throws on it, and the consumer-side guards #14078 landed absorb it as before.

The per-site canonicalisations landed for #13993–#13999 and #14078 stay correct and become no-ops on driver rows; nothing is removed here.
