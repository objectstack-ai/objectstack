---
'@objectstack/metadata-protocol': minor
---

**BREAKING** fix(metadata-protocol): the adopt-orphans door asks the save door's owner judges, before the `__c` judge (ADR-0029 D9.9, ADR-0086 D3, #28776)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches the adopt-orphans door (0 hits for `adopt-orphans` and `reassignOrphanedMetadata`).

<!-- adr-0087: not-required (no-migration-prescription) The narrowing refuses an adoption (`POST /api/v1/packages/:id/adopt-orphans`) that would rebind an active package-less object whose name another package owns in the registry, or an active package-less permission set whose body `packageId` names a package other than the target. Both refusals are the save door's own, asked at one more door with their existing envelopes. No metadata key, accepted value of a key, export or error code is removed or renamed, and no stored shape changes. The remedy is an authoring choice a person makes: bind the object to its owner, delete or rename one of the two rows, or drop or fix the set's `packageId`. There is no mechanical conversion between two metadata versions for `objectstack migrate meta` to apply. Measured at the PR's base: fresh CRM and showcase boots store 0 `sys_metadata` rows, and the 9 sites that seed `sys_metadata` rows in `packages/qa/**` hold 0 adoptable active rows either judge refuses. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no `packages/spec/**` file is touched, so no schema, type or runtime interface moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

`reassignOrphanedMetadata` (REST `POST /api/v1/packages/:id/adopt-orphans`) rebinds every active package-unbound row into the target package. Since #28735 it asks the `__c` judge first. It asked neither owner judge the save door asks before that one, so a package-less row could become a package's own item without them.

The door now asks both, in the save door's order (owner first, then the existing `__c` call), against the TARGET package and before the first storage update. Any refusal refuses the adoption whole: no row moves and nothing is written through to the registry.

- **An active orphan object whose name another package owns** (ADR-0029 D9.9): `422 OBJECT_OVERLAY_PACKAGE_MISMATCH`, the save door's message naming the owner. Adopted, the row was rebound in storage while the registry kept the other owner: two rows for one object. The `sys_metadata` sentinel owner is not judged. An orphan object is the sentinel's own registration, the owner the adoption hands over.
- **An active orphan permission set whose body `packageId` disagrees with the target** (ADR-0086 D3): `400 VALIDATION_ERROR`, the save door's message, `issues[0].path = 'packageId'`.

An adopted draft is judged by both when it is promoted, as before. The namespace-prefix judge is not asked at this door. Every installed package declares a namespace, so it would refuse nearly every real orphan object. Whether adoption refuses, renames or leaves the prefix unjudged is an open design question. No new error code.

**Migration.** None needed for this repository: 0 rows affected (measured above). An environment whose adoption is refused fixes the named row, as the message says, and adopts again.
