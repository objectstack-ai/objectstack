---
'@objectstack/rest': patch
'@objectstack/service-analytics': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(rest, service-analytics, objectql, metadata-protocol)!: the dataset query door, the dataset AI tools and `/meta/dataset` resolve a saved dataset by package — a name two packages hold is refused naming both, and a qualified read reaches only its own holder (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which saved dataset a by-name read answers, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`POST /analytics/dataset/query` with `datasetName`, the dataset AI tool `query_dataset` and `GET /api/v1/meta/dataset/:name` no longer take the first dataset of a name. Each resolves the name by the one package-scoped rule of ADR-0150 D3, for a caller with no package: the environment's own dataset, else the one package that holds the name. A dataset one package holds, or one authored in the environment, is answered exactly as before on every door, bare or at its holder's qualified addresses.

The query door also accepts an optional `?package=PACKAGE_ID`, the same exact qualifier `/meta/:type/:name?package=` reads: it runs that package's dataset, or answers `409 RESOURCE_CONFLICT` naming the packages that hold the name. An empty value or `all` names no package, as on `/meta`. A repeated `?package=` is refused `400`. If the metadata protocol a deployment composes has no by-name read, the query door answers `503 SERVICE_UNAVAILABLE` for a `datasetName` instead of reading a list.

A publish's build probes read a dashboard widget's dataset by name, so a name several packages hold has no dataset to probe: the widget now gets one warning-tier `widget_not_probed` issue naming every holder, where it was skipped without a word.

**BREAKING** for answers that served one package's dataset for an address that does not name it (first-party count: 0 — no first-party package ships a dataset name another package also ships, and nothing first-party sends `?package=` to the query door or reads a dataset at a package that does not hold it):

1. A bare `datasetName` two packages hold, on the query door and on `query_dataset`, ran the first listed. It is now `409 RESOURCE_CONFLICT` naming both, and nothing runs. Phase 1's install door already refuses the second holder, so only a deployment that booted with the clash (and was warned at boot) holds one.
2. A bare `GET /meta/dataset/:name` of a name two packages hold served the first registered. It is now `409 RESOURCE_CONFLICT` naming both.
3. A qualified read that names a package not holding the name (`/meta/dataset/NAMESPACE/:name`, `?package=ID`, or `/meta/dataset/_env/:name` when only packages hold it) answered `200` with another package's dataset. It is now `409 RESOURCE_CONFLICT` naming the holder.
4. `?package=ID` on the query door was ignored: the door ran the first listed dataset of the name. It now runs ID's own dataset, or refuses as in 3.

The fix for each:

- FROM a bare name two packages hold TO `?package=ID` on the query door or `/meta/dataset/NAMESPACE/:name`; on `query_dataset`, rename one of the two datasets, since the tool takes no package.
- FROM a qualified read naming a non-holder TO the holder's own namespace or id (the refusal names it), or the bare address.
