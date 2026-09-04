---
'@objectstack/metadata-protocol': patch
---

`listCommits` now emits the ISO-8601 string its declared return type
(`createdAt?: string`) promises, instead of asserting the raw driver value

`created_at` on `sys_metadata_commit` is an engine-injected audit column;
`SqlDriver#formatOutput` repairs it only inside its `if (this.isSqlite)`
arm, so Postgres and MySQL hand it out of the record read door as a JS
`Date` — a value every in-process consumer of `listCommits` received in a
field the type said was a `string`. The REST door (`GET
/packages/:id/commits`) was unaffected: `JSON.stringify` already renders a
`Date` as canonical ISO-Z text, so only in-process callers saw the mismatch.

The repair is a narrow per-site conversion at the producer: an already-
canonical SQLite string and an absent column both pass through unchanged,
and — deliberately — so does an Invalid `Date`, rather than adopting the
shared `canonicalIsoInstant` spelling, which raises `RangeError` on that one
shape (measured reachable on both live dialects; the open subject of a
separate, unresolved card this change does not decide).
