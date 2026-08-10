---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): classify a failed index build from the ERROR, not its message (#6699)

`classifyIndexFailure` — the function both runtime partial-index migrations in
this package classify a failed `CREATE UNIQUE INDEX` with — carried its own
private unique-violation vocabulary and answered from the **message channel
only**. That made it the fifth such copy in the repo, and the one #6250's
inventory missed: it lives in a package none of the other four touched, so it
was never in that table and none of the queued follow-ups covered it.

The first arm now delegates to `@objectstack/types`' `isUniqueViolationError`
(#6250 / PR #6541) — the one named answer to "is this a unique-constraint
violation?" — and `probeThenReplaceIndex` passes it the **caught error object**
instead of `err.message`. A string-only swap would have compiled unchanged and
kept the defect: the point of the shared predicate is the `code` / `errno` /
`cause` channels, which unwrapping the message throws away.

**What changes at runtime.** A driver that reports the conflict on `code` or
`errno` while giving unhelpful prose — SQLite's `SQLITE_CONSTRAINT_UNIQUE`,
MySQL's `ER_DUP_ENTRY` / errno `1062`, Postgres' SQLSTATE `23505`, or the
condition one step down `error.cause` behind a pooled wrapper's `Write failed`
— was classified `failed`. It is now `conflict`, which is the verdict that
produces the report ADR-0120 D4 requires: the key that is not enforced, the
query that lists the offending rows, and the pointer at `os migrate plan`.
Every message-channel verdict is unchanged — the shared predicate's message
limb covers all three shipped dialects' prose.

**Two things deliberately preserved.** The arm order still checks the
duplicate-row question BEFORE the dialect question, because MySQL's duplicate
error mentions the key and some drivers wrap both facts in one string; and the
dialect arm (`unsupported`) is still this module's own message-based
vocabulary, since the shared predicate answers the first arm only and has no
opinion about dialect support.

`classifyIndexFailure`'s parameter widens from `string` to `unknown`, so every
existing string call still compiles and is judged exactly as before. Callers
holding a caught error should pass it directly rather than `err.message`.
