---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a guarded increment is one atomic conditional write

Clause-②: no
Metadata-protocol: none

The auth adapter's `incrementOne` now honours better-auth's contract for that method under concurrency: its `where` clause is both the selector and the guard, and the guarded write is one conditional update judged by the database. Each attempt reads the guarded row and writes the new values with a single predicate update whose condition is the caller's guard, the row id and every incremented counter at the value read; the affected count decides. A guard that no longer holds answers `null`, an unguarded counter is retried from the new value, and contention that outlasts the bounded attempts throws rather than answering `null`.

The answer shapes are unchanged: the updated row, or `null` when the guard matches no row. The native `incrementOne` and `consumeOne` stay in place, so better-auth's own fallbacks are not used.
