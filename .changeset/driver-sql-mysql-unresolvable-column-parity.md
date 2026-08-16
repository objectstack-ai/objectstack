---
"@objectstack/driver-sql": minor
---

feat(driver-sql): MySQL joins the unresolvable-column predicate — the `INVALID_FILTER` refusal envelope AND the #3821 recoveries, full dialect parity (#8926)

**BREAKING** accept-set change on a GA public data API — in both directions at
once, on MySQL only — shipped as `minor` under the lockstep launch-window
convention, like the #8790 change it completes.

<!-- adr-0087: not-required (already-registered driver-sql-unresolvable-where-column-refused) MySQL joining the refusal is a reach extension of the migration #8790 registered one card earlier; the surface and the prescription are unchanged — name a column the object actually has, or run schema sync. The entry's dialect-reach paragraph is amended in a follow-up spec PR, filed from #8926 -->

## What changes, on MySQL only

`isUnresolvableColumnError` — the ONE predicate `SqlDriver.findRows()`'s #3821
recovery ladder and `SqlDriver.count()` both read — now recognises MySQL's
spelling of "the statement named a column the backend could not resolve":
`Unknown column 'x' in 'where clause'` / `'field list'` / `'order clause'`
(`ER_BAD_FIELD_ERROR`). SQLite and Postgres behaviour is untouched.

Measured on live MySQL 8.0.46 (`SqlDriver` over mysql2), before → after:

- **WHERE** — `find()` and `count()` alike: raw `ER_BAD_FIELD_ERROR`, no
  `status` (an unclassified 5xx at the REST boundary), the statement's bound
  literals inlined in the message → refused with `INVALID_FILTER` / 400 naming
  the column; the dialect message goes to the server log. The narrowing — the
  #7929 predicate-text disclosure shape closed on the last dialect that still
  had it.
- **Projection** — `find({ fields: [...] })` naming a column the table lacks
  threw the raw error → retries selecting `*`; the rows come back, WHERE
  honoured. The widening.
- **ORDER BY** — sorting by a column the table lacks threw the raw error →
  drops the sort and returns the rows unordered, WHERE honoured. The widening.

Both directions were ruled together on #8926 (option A, maintainer,
2026-08-16); a split predicate — the envelope without the recoveries — was
refused. The widening cannot drop a predicate: every ladder rung is rebuilt
from `buildBase()`, which unconditionally re-applies `query.where`, so the
recoveries reach the projection and the sort only.

## Migration

Nothing stored needs rewriting. A MySQL caller that relied on catching the raw
`ER_BAD_FIELD_ERROR` from `find()`/`count()` should catch `INVALID_FILTER` /
400 instead — the same envelope SQLite and Postgres already answer, and the
same prescription the registered
`driver-sql-unresolvable-where-column-refused` migration carries.
