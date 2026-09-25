---
'@objectstack/service-analytics': patch
---

fix(service-analytics): `$icontains` works on a query the ObjectQL strategy serves (#20098)

Clause-②: no

`ObjectQLStrategy` had no translation for the case-insensitive `$icontains`
operator, so every such filter on a datasource it serves failed. A valid
`{ name: { $icontains: 'acme' } }` included. `POST /analytics/query` answered
`500 INTERNAL_ERROR` ("ObjectQL strategy cannot express filter operator
"icontains""), while the native SQL face and the `/analytics/sql` echo served
the rows.

The strategy now hands the engine the canonical `$icontains`, the same way it
passes `$contains`, `$notContains`, `$startsWith` and `$endsWith`. The engine
and the driver apply the case fold, so the ObjectQL face answers the same rows
as every other face: the fold is ASCII-only, so `'CAFÉ'` does not match
`'café'`. This covers the query's `where` in both spellings (`$icontains` and
the `FilterArray` `icontains`), under `$not`, a compiled dataset's scope and a
measure filter. An empty or non-string comparand is still refused with
`INVALID_FILTER` / 400 before the strategy runs.
