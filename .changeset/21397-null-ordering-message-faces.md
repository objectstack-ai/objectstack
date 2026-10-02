---
'@objectstack/spec': patch
---

fix(spec): the null ordering-comparand refusal names only evaluation faces that exist

Clause-②: no

`FieldOperatorsSchema` and `ComparisonOperatorSchema` refuse a `null` comparand of `$gt` / `$gte` /
`$lt` / `$lte` with a pointed message. Its example of the evaluation faces disagreeing named
driver-memory's reference matcher, which has been deleted, so an author or agent reading the
refusal went looking for a face that no longer exists. The example now names two faces that exist
and were measured to disagree: driver-memory's query path reads a stored `null` as equal to the
comparand, so `{"$gte": null}` admits that row, while driver-sql compares against SQL `NULL` and
admits no row.

Text only: the first sentence (`null is not a valid $gt comparand.` and its siblings), the prescription
(`{"$eq": null}` / `{"$ne": null}`) and the ruling sentence are unchanged, and the schemas accept
and refuse exactly the same filters. A client or log filter that matches the old parenthesis needs
the new spelling.
