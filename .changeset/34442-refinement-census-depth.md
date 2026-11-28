---
'@objectstack/spec': patch
---

fix(spec): the published JSON Schema names every refinement it drops, however deeply it is nested

Clause-②: no
Metadata-protocol: none

The generator's dropped-refinements census stopped walking a schema after 14 hops and still printed "all declared". A rule nested deeper was missing from the file's `x-dropped-refinements` annotation. The walk now has no depth limit; its identity-keyed visited set ends it. A walk that does not end now fails the build with the export and path named, instead of stopping early in silence.

Three published files under `json-schema/api/` now list sites they missed before: `InstalledPackageAtEitherStage` (1 more), `GetInstalledPackageResponse` (5 more) and `ListInstalledPackagesResponse` (8 more). The set of documents any schema accepts is unchanged, because `x-` keywords are ignored by every validator. Nothing to migrate.
