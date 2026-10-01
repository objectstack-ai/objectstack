---
'@objectstack/driver-sql': patch
---

fix(driver-sql): an autonumber format whose rendered prefix carries `_`, `%` or `\` seeds its counter from the stored MAX on SQLite

Clause-②: no

The SQL driver reads the highest counter already stored under an autonumber prefix in two places: the first issue of a counter (the cold bootstrap) and the re-seed after a create collides with a number that a seed replay, an import or direct SQL already wrote. Both escape the prefix's `\`, `%` and `_` with a backslash for a `LIKE` scan, but the scan declared no `ESCAPE` character, and SQLite's `LIKE` has none unless one is declared. On SQLite (better-sqlite3, and the Turso local and embedded-replica faces; the WebAssembly SQLite driver inherits the same scan) such a prefix therefore matched no stored row:

- **Cold**, the counter started at 1 under numbers already stored. Measured: a format `SO_{0000}` over a stored `SO_0007` issued `SO_0001`.
- **On the re-seed**, the counter could not move, so every retry collided again and the create was refused once the retries ran out.

The prefix is rendered, so the character can come from data as well as from the format: `{region}-{0000}` with a region value of `north_east` was affected in the same way.

The scan now binds the driver's one `LIKE` escape character on every dialect, as the driver's filter `LIKE` already does. PostgreSQL and MySQL already used a backslash as their default `LIKE` escape, so the answer there does not change; a prefix with none of the three characters is not affected anywhere. Counters already seeded too low are not rewritten: the next collision on one now re-seeds it from the stored MAX, as on any other prefix.
