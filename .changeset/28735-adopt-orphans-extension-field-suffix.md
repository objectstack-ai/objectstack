---
'@objectstack/metadata-protocol': minor
---

**BREAKING** fix(metadata-protocol): the adopt-orphans door refuses to rebind a package-less object carrying a `__c` field into a plain package (ADR-0146 D10, #28735)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches the adopt-orphans door or a field spelled `__c` (0 hits for `adopt-orphans`, `reassignOrphanedMetadata` and `[a-z0-9]__c`).

<!-- adr-0087: not-required (no-migration-prescription) The narrowing refuses one more door into the `__c` reservation #28564 declared: an adoption (`POST /api/v1/packages/:id/adopt-orphans`) that would rebind a package-less active object row carrying a field spelled `__c` into a package that is not a base's paired `.custom`. No metadata key, accepted value of a key, export or error code is removed or renamed, and no stored shape changes. The remedy is a rename of the field, or adopting into the base's `.custom` pair, an authoring choice a person makes; there is no mechanical conversion between two metadata versions for `objectstack migrate meta` to apply. Measured at the PR's base: 0 fields spelled `[a-z0-9]__c` in `examples/**` and `packages/*/src` outside tests (every textual hit is a doc comment). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no `packages/spec/**` file is touched, so no schema, type or runtime interface moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

`reassignOrphanedMetadata` (REST `POST /api/v1/packages/:id/adopt-orphans`) rebinds every active package-unbound row into the target package. The save door does not judge a package-unbound object against the `__c` reservation (a row bound to no package is the environment's own), so an object carrying `x__c` is stored package-less; adopted into a plain package, `x__c` became that package's own field, the case (a) every other door refuses.

The door now asks the save door's judge (`judgeExtensionFieldSuffix`) for every active `object` row it would rebind, judged against the TARGET package id, before the first storage update. Any refused field refuses the adoption whole: `400 VALIDATION_ERROR`, the message case (a)'s sentence ("the `__c` suffix is reserved to a base's paired `.custom` package (ADR-0146 D10); rename the field."), `issues[]` locating each field at `objects.OBJECT.fields.FIELD`. No row moves and nothing is written through to the registry. An adoption into the base's `.custom` pair is admitted, since its objects are the pair's own. An adopted draft is judged when it is promoted, by the promotion's own call to the same judge. No new error code.

Also, the draft promotion's suffix block is no longer asked of sealed managed content (an object a code package ships), like the two promotion blocks above it: such a draft gets the store's one `NOT_OVERRIDABLE` / 403 refusal instead of "rename the field".

**Migration.** None needed for this repository: 0 fields affected (measured above). An environment holding a package-less object with a `__c` field renames the field before adopting into a plain package, or adopts into the base's `.custom` pair.
