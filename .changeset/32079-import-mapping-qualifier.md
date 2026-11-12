---
'@objectstack/rest': patch
---

feat(rest): the import door's `mappingName` takes the `/meta` door's qualified address `NAMESPACE/NAME`, so a mapping name two packages hold can be imported by naming its holder (ADR-0150 D5)

Clause-②: yes
Metadata-protocol: none

`POST /api/v1/data/:object/import` and `POST /api/v1/data/:object/import/jobs` read `mappingName: "<namespace>/<name>"` as the address `GET /api/v1/meta/mapping/<namespace>/<name>` reads, through the same protocol reads (`resolveMetaItemAddress`, then the exact qualifier `?package=` naming the namespace's holder): the import applies exactly that package's mapping. `"_env/<name>"` names the mapping saved in the environment (`admitEnvironmentQualifier`). A qualifier naming a namespace, or the environment, that holds no mapping of the name while a package does is refused `409 RESOURCE_CONFLICT` with the `not-held-by-qualifier` sentence that read answers, naming every holder, and no row is written.

Only a new optional spelling is added. A `mappingName` with no `/` reads and answers exactly as before: the environment's own mapping, else the one package holder, else `409` naming both holders. A first segment that is neither `_env` nor an installed namespace is no address, and the whole string is read as the name it always was read as (a mapping name is snake_case, so it answers `404 MAPPING_NOT_FOUND`), never the part after the `/`. The address keeps the metadata read's two limits: a shareable namespace (`base`, `system`, `sys`) two of whose packages hold the name answers `409` naming both, and a mapping named like a `/meta` sub-resource segment (`history`, `layers`, …) has no qualified address.
