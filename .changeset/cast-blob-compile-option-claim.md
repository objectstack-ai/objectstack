---
"@objectstack/spec": patch
"@objectstack/driver-turso": patch
"@objectstack/driver-sql": patch
"@objectstack/service-analytics": patch
---

Correct the documented reason for rejecting `CAST(col AS BLOB) LIKE ?` as a portable case-exact construct.

Four headers stated, as a universal fact about SQLite, that the construct "was measured to return NOTHING". That is not a property of SQLite: whether `LIKE` is false for a BLOB operand is fixed when SQLite is compiled, by `SQLITE_LIKE_DOESNT_MATCH_BLOBS`, and the two SQLite builds this project ships disagree about it. Measured over the shared `FILTER_TEXT_ROWS` fixture, `{ name: { $contains: 'acme' } }` compiled to that construct returns `[]` on better-sqlite3 13.0.3 (SQLite 3.53.4, flag compiled in) and `['1','2']` on sql.js 1.14.1 (SQLite 3.49.1, flag absent) — the latter being exactly the ASCII case-folding defect the construct was being considered to avoid.

No behaviour changes and no conclusion changes: all four sites still reject the construct and still choose `GLOB`. The rejection is now stated in a form that does not depend on any particular return value — a construct whose meaning is decided by an upstream compile flag cannot carry a read scope, because it means two different things on the two builds shipped here. Two supporting readings are recorded alongside it: `typeof CAST(name AS BLOB)` is `'blob'` on both builds, so the CAST is not the part that differs, and `GLOB` answers identically on both.

Documentation only. `@objectstack/spec` and `@objectstack/driver-turso` ship the corrected text in their published type declarations (and `spec` also publishes the corrected source file directly, via its `src/**/*.zod.ts` entry); for `@objectstack/driver-sql` and `@objectstack/service-analytics` the change reaches published output only through sourcemaps.
