---
"@objectstack/driver-sql": patch
---

`aggregate()` now answers an unresolvable column with the same refusal class as `find()` and `count()` instead of the generic `DATABASE_ERROR`/500 terminal — the #8790 refusal reaching the third read door (#11541). The dialect-named column is attributed to the clause the caller's own query names it in: a `groupBy` field or an aggregation `field` refuses with `INVALID_FIELD`/400 naming the column and the clause (the same code the protocol ingress gives this condition, #4254); a column named by neither clause is the WHERE, which answers #8790's `INVALID_FILTER`/400 refusal verbatim; a dialect wording that yields no column name keeps the #11455 terminal envelope unchanged, because no attribution is supportable there (#8931). Drivers extending `SqlDriver` (`driver-turso`'s embedded face, `driver-sqlite-wasm`) inherit the same answers.
