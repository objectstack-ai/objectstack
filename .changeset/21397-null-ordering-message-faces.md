---
'@objectstack/spec': patch
---

fix(spec): the null ordering-comparand refusals name only evaluation faces that exist, and say only what was measured

Clause-②: no

`FieldOperatorsSchema` and `ComparisonOperatorSchema` refuse a `null` comparand of `$gt` / `$gte` /
`$lt` / `$lte` with a pointed message. Its example of the evaluation faces disagreeing named
driver-memory's reference matcher, which has been deleted, so an author or agent reading the
refusal went looking for a face that no longer exists. The example now names two faces that exist
and were measured to disagree: driver-memory's query path reads a stored `null` as equal to the
comparand, so `{"$gte": null}` admits that row, while driver-sql compares against SQL `NULL` and
admits no row.

That refusal and its runtime twin, the `parseFilterAST` refusal for the same comparand
(`Operator "$gt" on field "…" does not accept a null comparand …`), both said "no two evaluation
faces agree" on what an ordering against `null` matches. Measured, two faces do agree (driver-sql
and formula both admit no row), so both now say "the evaluation faces do not agree".

Text only: each message's first sentence, its prescription (`{"$eq": null}` / `{"$ne": null}`), the
schema door's ruling sentence and the runtime door's "NOT applied" sentence are unchanged, and both
doors accept and refuse exactly the same filters. A client or log filter that matches the old
wording needs the new spelling.
