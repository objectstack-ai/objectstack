---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a dialect error the driver cannot attribute leaves the read exits as an ADR-0112 backend-fault envelope instead of raw (#8931)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
added, renamed, retired or tombstoned — no metadata key, no spec surface, no
declaration an author writes. The change is entirely in what a failing READ
throws: an error that already declared no `status` and carried the compiled
statement now declares `DATABASE_ERROR` / 500 and does not. There is no source
file for a consumer to migrate and therefore no semantic-migration TODO to
emit; the accept set is unchanged, since every condition below failed before
this change and fails after it. -->

`SqlDriver.find()` / `findOne()` / `count()` had one exit that answered with the
**database's own error object**: a `code` from the backend's vocabulary
(`42P01`, `SQLITE_ERROR`, `42601`, `22P02`, …), **no `status`** at all, and a
message opening with the compiled statement. Two things travelled out of it that
should not have — the statement's shape, and on one measured row the caller's
own value.

Ruled 2026-08-17 on #8931: the driver stops answering an unenveloped dialect
error. Any dialect error the existing classification does not claim now leaves
as a **generic backend-fault envelope**, `DATABASE_ERROR` / 500, asserting only
*"the backend rejected this statement"*.

**Not a filter verdict, and that is the ruling rather than a preference.**
Measured live on PostgreSQL 16.13, a dotted WHERE key and a table that was never
created raise the *same* SQLSTATE:

```
dotted key        42P01  missing FROM-clause entry for table "title"
table not created 42P01  relation "no_such_object" does not exist
```

An `INVALID_FILTER` here would tell an operator whose schema sync had not run
that their *filter* was wrong. The signal cannot support the claim, so the
envelope does not make it — and the driver still never inspects the caller's key
for a `.` (that verdict is #8371's, and it landed there).

**Mechanism: a terminal catch-all, not a new recognizer.** No predicate learns
`42P01`. `isUnresolvableColumnError` and `isMissingTableError` are untouched, so
the #8790 refusal (`INVALID_FILTER` / 400 naming the column) still wins wherever
it applies, and the #3821 projection / ORDER-BY recoveries still return rows.

**What now takes the envelope**, measured on live PG 16.13 and better-sqlite3:
a table that was never provisioned; a dotted WHERE key on Postgres; a
comparand-shape syntax fault; a value the column type rejects; and connection,
pool-acquisition, timeout or permission failures.

**The disclosure this closes on a route nobody had named.** Postgres puts the
caller's rejected VALUE in its own `22P02` diagnostic (`invalid input syntax for
type integer: "…"`), *downstream* of everything knex parameterised — so no
statement cut removes it. Withholding the dialect text whole is what closes it.
(#8931's headline premise, a bound literal inlined on the *dotted* route, was
measured false and pinned by #9108; this is the neighbouring row where a value
really does travel.)

**The original error is kept as a non-enumerable `cause`.** That is load-bearing,
not tidiness: `isMissingTableError` follows `cause`, and thirteen read paths use
it to tell "the table was never provisioned" — a benign emptiness — from a
failure that must stay loud. Non-enumerable so the statement cannot ride back
out through `JSON.stringify(err)` or a spread.

**For callers.** At the REST boundary the wire answer for these conditions is
materially unchanged — `mapDataError` already derived `500` + `DATABASE_ERROR`
for them by sniffing the message; it is now *declared* by the producer that
knows, per ADR-0112, and every non-REST consumer (an in-process ObjectQL caller,
a plugin, an AI-authored action) gets the same declared answer instead of having
to pattern-match a SQLSTATE that differs per backend. Two consequences worth
naming: code that matched on the raw dialect `code` or message of a failing
**read** must read `error.cause` instead; and a read against a **registered
object whose table was never created** now answers `500 DATABASE_ERROR` where it
previously answered `404 OBJECT_NOT_FOUND` with the body `Object 'x' is not
registered` — a sentence that was false in exactly that state.
