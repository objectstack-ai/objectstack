---
'@objectstack/objectql': patch
---

fix(objectql): the no-operator-object filter refusal states what to write inside the 500-character client cap

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/OBJECT/query` (and `find` / `aggregate`) refuses a plain object with no `$` operator key written where a value belongs with `400 INVALID_FILTER`: beneath a scalar field, as the value of a structured-JSON field (`json`, `address`, …), and beneath a relation field in `aggregations[i].filter` and `having`. A client reads at most 500 characters of that message, and the refusal printed its route after "NOT applied" and the reasoning, so with a long field name the route was cut off — on a single-valued lookup in an aggregation's filter or `having`, the `{ "FIELD": { "$in": [ID, …] } }` example was cut even with a 15-character field. Each refusal now reads: where the object sits and what kind of column it is under, then what to write instead, then "NOT applied" and why. The routes themselves are unchanged in meaning; the relation routes now open "Move the condition to 'where'" and name the related object by its name alone. The cap, the truncation, the code and the status are unchanged, and so is the set of filters refused.
