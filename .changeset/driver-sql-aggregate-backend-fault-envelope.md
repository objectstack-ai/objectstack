---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `aggregate()` joins the enveloped read exits — a dialect error it
cannot attribute now leaves as `DATABASE_ERROR` / 500 instead of raw (#11455)

`SqlDriver.aggregate()` executed its statement **bare**. Every dialect error the
backend raised left the driver as the backend's own error object: a `code` from
the backend's vocabulary, **no `status`** at all, and a message opening with the
compiled statement. `find()` and `count()` have carried the terminal ADR-0112
envelope since #8931; this third read door was simply never given it.

Measured on live PostgreSQL 16.13. The driver maps a `boolean` field to a real PG
`boolean` column and `SQL_AGGREGATE_FUNCTIONS` lowers the arithmetic aggregates to
a bare function name with no cast, so an ordinary analytics shape — a rate measure
over a flag column — reached the server as `avg("flag")`:

```
sum(flag) => THREW code=42883 status=undefined
             msg=select sum("flag") as "n" from "…" - function sum(boolean) does not exist
```

A raw `42883` is on no list `@objectstack/rest` reads, so with `status` undefined
a caller-shaped mistake was logged as an **unhandled server fault**, and the
statement's shape travelled to the caller with it.

`aggregate()` now composes the same `backendStatementFaultError` its two siblings
do: `DATABASE_ERROR` / 500, asserting exactly one thing — *the backend would not
run this statement* — with the dialect's own diagnostic written to the **server
log** rather than the caller's message, and the original error kept as a
non-enumerable `cause` so `isMissingTableError` and every other cause-following
predicate stay truthful.

**No new error code.** ADR-0112 D3/D4 closed the `StandardErrorCode` vocabulary,
and D2's 2026-08-18 amendment retired three members on the reasoning that an
unreachable-but-declared code teaches a branch that can never fire. The code here
is the catalogued member the sibling read exits already answer with.

**This is the envelope half only, and it decides no contract.** Whether the
platform should *answer a number* for an arithmetic aggregate over a boolean (by
casting in the lowering) or *refuse* is #11152's question, and #11249's for
`min`/`max`. Nothing here pre-empts it: the envelope is raised from the **exit**,
not from recognising `42883` or any wording, so it holds whichever way that card
is ruled — and the three dialects' arithmetic answers are deliberately left
unpinned (measured 2026-08-24: SQLite and MySQL's `tinyint(1)` both answer,
Postgres refuses).

Unchanged, and pinned as controls: the precise refusals this door already
composed — an undeclared function (`INVALID_QUERY` / 400, #5907), a
`count_distinct` with no `field` (`INVALID_QUERY` / 400, #6409), a
per-aggregation `filter` (`NOT_IMPLEMENTED` / 501, #10576) — are all raised while
the statement is *built*, upstream of the guarded execution, so none can be buried
under the generic envelope. The accept set does not move: every condition that now
takes the envelope failed before this change and fails after it.
