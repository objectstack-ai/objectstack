---
'@objectstack/driver-sql': patch
---

`distinct()` answers a backend refusal with the ADR-0112 envelope instead of leaking the dialect's own error

`SqlDriver.distinct` awaited its query builder bare — no `try`/`catch`, no
envelope — so any refusal the statement raised left the driver as the backend's
own object: a raw SQLSTATE in `code`, `status` **undefined**, and the compiled
statement as the message. `@objectstack/rest` builds a wire status from the
envelope, so an error carrying no `status` and a `code` that is a raw SQLSTATE
is on no list it reads: an ordinary caller shape — *list the distinct values of
this column* — surfaced as an UNHANDLED server fault rather than a declared
`DATABASE_ERROR` 500.

Measured on live PostgreSQL 16.13: this driver stores every `multiple: true`
column as `json`, and PostgreSQL's `json` defines no equality operator, so
`SELECT DISTINCT` over one is refused —
`code=42883 status=undefined`, `msg=select distinct "toggles" from "…" - could
not identify an equality operator for type json`. Class-wide across every JSON
column (`toggle`, `boolean` and `number` with `multiple: true`, and `tags`),
with a scalar `boolean` column in the same table answering normally.

The third read door now routes through the same terminal
`backendStatementFault` that `find()` and `count()` have used since
objectstack#8931 and `aggregate()` since objectstack#11455: one catalogued
code, one status, the dialect's own text written to the server log for an
operator and withheld from the caller, and the original error kept as a
non-enumerable `cause` so `isMissingTableError` still reads through it.

⛔ No new export, no new error code, no new envelope field, and the accepted
input set does not move: `status` and `code` are fields this envelope already
declares. ⛔ This does not make `distinct()` ANSWER over a `json` column — the
call fails either way; what changes is whether the failure is classified.
Whether such a column should support a distinct read belongs with
objectstack#17590.
