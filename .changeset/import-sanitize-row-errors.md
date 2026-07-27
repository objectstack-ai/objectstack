---
"@objectstack/rest": patch
"@objectstack/plugin-auth": patch
---

fix(import): sanitize row errors — never leak raw SQL, map constraint failures to human wording (#3566)

A failing import row surfaced the driver's raw error verbatim. When a write hit
a DB constraint (e.g. `sys_user.phone_number` is `unique`), the query builder
embeds the entire failing statement in `err.message`, and `toFailedResult`
handed that straight back — so the importer saw ``insert into `sys_user`
(...) values (...) - UNIQUE constraint failed: sys_user.phone_number``. That is
both unreadable and an information disclosure of the schema.

- `sanitizeRowError()` (import-runner) maps the common constraint failures —
  SQLite / MySQL / Postgres `UNIQUE` and `NOT NULL` — to human wording
  ("A record with this `<column>` already exists.", "`<column>` is required.")
  and, as a backstop, never lets a message that still reads as a SQL statement
  reach the client (it salvages the driver's trailing reason, or falls back to
  a generic message). Already-friendly messages (e.g. better-auth's "User
  already exists") pass through unchanged. Applies to every import path.
- `isLikelyEmail` now rejects non-ASCII addresses, so an address like
  `x@柴仟.com` fails the import **dry-run** pre-check instead of passing client
  and dry-run validation only to be rejected by better-auth's strict ASCII
  validator at real-import time.
