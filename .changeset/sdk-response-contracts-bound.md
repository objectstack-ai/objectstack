---
"@objectstack/spec": minor
"@objectstack/client": minor
"@objectstack/runtime": patch
"@objectstack/rest": patch
---

feat(spec,client): bind published response contracts for the 17 unbound client-SDK methods; retire the false `PackageRollbackResponseSchema` (#12038, ruling 1C · 2C · 3A · 4A · 5A)

<!-- adr-0087: registered package-rollback-response-retired -->

**BREAKING** export removal, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18 — `RETIRED_DEFS_BY_MAJOR[18]` `api/PackageRollbackResponse`
plus the D3 semantic entry `package-rollback-response-retired` — where
`os migrate meta` users will look).

FROM → TO:

- `PackageRollbackResponseSchema` / `PackageRollbackResponse` /
  `PackageRollbackResponseParsed` → `RollbackToPackageCommitResponseSchema` /
  `RollbackToPackageCommitResponse` (`@objectstack/spec/api`). The retired
  schema declared a VERSION rollback (`{ success, restoredVersion?,
  message? }`) while the live `POST /packages/:id/rollback` route posts
  `{ commitId }` and answers the ADR-0067 COMMIT rollback —
  `{ success, revertedCommits: string[], failed: [{ commitId, error }] }`.
  Read `revertedCommits` / `failed`; there is no `restoredVersion`.
- `PackageApiContracts.rollbackPackage` → *(removed)* — it bound the
  wrong-operation schema to the exact live path. No route registration or
  SDK generation ever consumed it (zero consumers measured across
  objectstack, objectui and cloud; only its own unit test and the #11925
  compile-time guard, both updated in this PR).

One-line fix: replace any import of `PackageRollbackResponse(Schema)` with
`RollbackToPackageCommitResponse(Schema)` and read `revertedCommits` /
`failed` instead of `restoredVersion`. `PackageRollbackRequestSchema` stays
published (ruled out of the retirement), bound to no route.

The rest of the change is additive — the recorded five-part maintainer
ruling (2026-08-27) for the 17 client-SDK methods that had no published
response contract:

- **12 describe-only transcriptions** into `@objectstack/spec/api`, each
  from the return type its producer already declares inline (no wire byte
  changes): `ListDraftsResponseSchema`, `GetMetaDiagnosticsResponseSchema`,
  `FindReferencesToMetaResponseSchema`, `RollbackMetaItemResponseSchema`,
  `DiffMetaItemResponseSchema`, `ResolvedBookSchema` (authored beside its
  interfaces in `system/book.zod.ts`), `DiscardPackageDraftsResponseSchema`,
  `ListPackageCommitsResponseSchema` (the `{ commits }` wrapper declared as
  the handler's own), `RevertPackageCommitResponseSchema`,
  `RollbackToPackageCommitResponseSchema`,
  `ReassignOrphanedMetadataResponseSchema`, `DuplicatePackageResponseSchema`.
- **Ruling 1C**: `GetPublishedMetaItemResponseSchema` is deliberately opaque
  (`z.unknown()`) — the route answers an arbitrary metadata item body, never
  a union frozen against the type registry.
- **Ruling 2C**: `meta.migrateStored` stays UNBOUND, documented at its two
  ledger rows and in the SDK — `StoredMigrationReport` lives in
  `@objectstack/metadata-protocol`, and a second declaration would drift.
- **Ruling 4A**: `PackageExportManifestSchema` pins the four fixed keys
  (`id`, `name`, `version`, `label?`) and stays honestly open for the
  registry-derived plural keys.
- **Ruling 5A**: `PackagePublishResultSchema` and the `ResolvedBook` family
  are re-exported into `@objectstack/spec/api` (the namespace the
  route-ledger resolver searches) — never a second copy.
- The 18 boundable route-ledger rows in `@objectstack/runtime` and
  `@objectstack/rest` now name their `responseSchema`, each stating which
  surface's envelope it describes; every named schema carries conformance
  coverage (the #3877 rule).
- The client SDK binds 16 of the 17 methods to the published payload types,
  replaces four invented test mocks with producer-true shapes, and pins the
  `unwrapResponse` mis-unwrap hazard so no bound payload can declare both a
  boolean `success` and a `data` key.
