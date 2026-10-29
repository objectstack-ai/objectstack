---
'@objectstack/objectql': patch
---

fix(objectql): temporal-comparand and text-operator filter refusals state what to write inside the 500-character client cap

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/OBJECT/query` refuses a comparand a temporal field cannot read (`{ "created_date": { "$gte": "last_30_days" } }`, a year outside the field's range, an impossible day, a non-ISO spelling, a relative-date placeholder resolved outside the years) and a text operator aimed at a field that never holds a string (`{ "amount": { "$contains": "5" } }`) with `400 INVALID_FILTER`, in `where`, `aggregations[i].filter` and `having`. A client reads at most 500 characters of that message, and these refusals printed the prescription last, after the consequence, so it was often cut off. Each refusal now reads: what was written and why it is not a value of its kind, then what to write instead, then "NOT applied" and what the value would have done. The `datetime` prescription now names the relative-date placeholder first (`"{30_days_ago}"`), and the year-range prescriptions are shorter. The cap, the truncation, the code and the status are unchanged, and so is the set of filters refused.
