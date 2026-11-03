---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an offset with no limit reports the filtered total

Clause-②: no
Metadata-protocol: none

A Data API list read that skipped rows without naming a page size reported a wrong `total`: the number of matching rows minus the offset. `GET /api/v1/data/OBJECT?$skip=3&$count=true` over 14 rows answered `total: 11`, while the same query with `$top=100` answered 14, and `POST /api/v1/data/OBJECT/query` with `{"offset":999,"count":true}` answered `total: 0`. `total` is now the number of rows matching the filter whatever the offset, as it already was when a limit was present.

Such a request now runs the same count a paged request runs, over the same filter and search. `$count=false` with an offset issues no count and omits `total`, as it does with a limit. A read with neither an offset nor a limit is unchanged and issues no count.

What to do: nothing. A client that pages with `$skip` (or `offset`) alone now reads the true total.
