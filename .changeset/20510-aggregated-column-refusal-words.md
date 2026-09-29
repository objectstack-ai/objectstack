---
"@objectstack/spec": patch
"@objectstack/objectql": patch
---

The number-comparand refusal now says "a numeric aggregated column" at `having`, and names PostgreSQL's server error only where a driver actually binds the comparand

Clause-②: no

**Two false phrases, at two positions.** At `having`, filtering a `count` /
`sum` / `avg` result (or a groupBy column) against a non-numeric comparand
answered `filter on 'total' compares a declared number field …` — `total` is
the aggregated row's own column, not a declared field of the object; the
verdict is handed the numeric class the column belongs to, which has no
`FieldType` of its own. And at `having` and the per-aggregation `filter`, the
`not-a-number`, `boolean` and `date` clauses each named "(PostgreSQL with a
server error)", a fact about `where`: the engine evaluates both of those
clauses itself, on every driver, before any row is read, so a comparand there
never reaches a driver bind and PostgreSQL never answers it.

**Measured, unchanged: the per-aggregation `filter`'s column IS a declared
field.** That position narrows the object's RAW rows before any aggregation
runs, against the object's real field map — so its refusal keeps "a declared …
field", exactly as `where`'s does. Only the PostgreSQL clause moves there,
because the engine evaluates that position itself too.

**FROM** `filter on 'total' compares a declared number field against "abc" at
having.total.$gt, which is not a number: it has no numeric reading, and
backends answer it differently (PostgreSQL with a server error). …`

**TO** `filter on 'total' compares a numeric aggregated column against "abc"
at having.total.$gt, which is not a number: it has no numeric reading. …`

The `where` message is unchanged, byte for byte, and so is the accept set: no
comparand that was refused before is now accepted, and none that passed is now
refused. This is a wording fix.

**What moved to carry it.** `NumberComparandRefusalSite` (`@objectstack/spec`)
gains two optional fields the engine door already knew and now passes along:
`aggregated` (the column is an aggregated-row column, not a declared field —
`having` sets it; `where` and the per-aggregation `filter` do not) and
`boundByDriver` (this position reaches a live driver bind — `where` alone sets
it true; unset defaults to `true`, so a site built before this change, or any
caller who never sets these fields, renders exactly as it always has).
`@objectstack/objectql`'s door passes both explicitly at each of its three
call sites; no second rule and no driver-level change.
