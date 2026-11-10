---
'@objectstack/objectql': patch
'@objectstack/rest': patch
'@objectstack/service-automation': patch
---

fix(objectql, rest, service-automation): a mapping name two packages hold is refused naming both, at `/meta`, the import door and the connector pull, instead of serving the first holder (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which mapping a by-name read answers when two packages hold its name, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`mapping` is now one of the types whose by-name readers consult `(package, name)`. The import door's `mappingName` (`POST /api/v1/data/:object/import` and the async import job) and the connector pull (a job's `pull`) read the mapping naming no package, so they resolve it as a caller with no package: the environment's own mapping, else the one package that holds the name. One holder answers exactly as before, including a package's mapping imported into an object another package owns.

**BREAKING** for answers that served one of two holders by registration order, now refused naming every holder (first-party count: 0; no example app or first-party package declares a mapping name another package declares):

1. `GET /api/v1/meta/mapping/NAME` for a name two packages hold answered `200` with the first registered package's mapping. It is now `409 RESOURCE_CONFLICT` naming both.
2. An import by `mappingName` for such a name read the first holder's mapping: `200` when its target was the request's object, else `400 MAPPING_TARGET_MISMATCH` (the importer of the other package's object could never use its own mapping). It is now `409 RESOURCE_CONFLICT` naming both, and no row is written.
3. A connector pull of such a name pulled through the first holder's mapping, writing into that mapping's target. It is now refused before any call or write: the pull fails with `409 RESOURCE_CONFLICT` (reason `mapping_name_refused`) naming both, and the job run records that failure.
4. `GET /api/v1/meta/mapping/NAME?package=X`, `/meta/mapping/NS/NAME` and `/meta/mapping/_env/NAME`, where `X`, `NS` or the environment does not hold the name, answered `200` with the holder's mapping. They are now `409 RESOURCE_CONFLICT` naming the holder: the address is the exact qualifier (ADR-0150 D5), as it already is for apps, pages, dashboards, reports, books, analytics cubes, tools, skills and agents.

The fix for each:

- FROM a bare read of a two-holder name TO `?package=<id>` or `/meta/mapping/<namespace>/NAME`.
- FROM importing or pulling by a two-holder name TO renaming one of the two mappings; the import door and the pull do not yet take a package.
- FROM an address naming a package that does not hold the name TO the holder the refusal names.
