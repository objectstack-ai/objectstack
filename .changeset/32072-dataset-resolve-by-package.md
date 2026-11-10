---
'@objectstack/rest': patch
'@objectstack/service-analytics': patch
'@objectstack/objectql': patch
---

fix(rest, service-analytics, objectql): the dataset query door and the dataset AI tools resolve a saved dataset by package (ADR-0150 D3)

Clause-②: yes (widening)
Metadata-protocol: none

`POST /analytics/dataset/query` with `datasetName` and the dataset AI tool `query_dataset` no longer take the first dataset of that name in the environment's list. Both resolve the name by the one package-scoped rule of ADR-0150 D3, for a caller with no package: the environment's own dataset, else the one package that holds the name. When two packages hold the same dataset name, both now answer `409 RESOURCE_CONFLICT` naming both packages, where they used to run whichever was listed first. A deployment boots in that state today only with the phase-1 cold-boot warning.

The query door also accepts an optional `?package=PACKAGE_ID`, the same exact qualifier `/meta/:type/:name?package=` reads: it runs that package's dataset, or answers `409 RESOURCE_CONFLICT` naming the packages that hold the name. An empty value or `all` names no package, as on `/meta`. A repeated `?package=` is refused `400`.

`dataset` joins `PACKAGE_SCOPED_READ_TYPES`, so `GET /meta/dataset/NAME` with two holders answers `409 RESOURCE_CONFLICT` naming both, and `/meta/dataset/NAMESPACE/NAME` and `?package=` reach each holder's own dataset.

A dataset one package holds, or one authored in the environment, is answered exactly as before on every door. If the metadata protocol a deployment composes has no by-name read, the query door now answers `503 SERVICE_UNAVAILABLE` for a `datasetName` instead of reading a list.
