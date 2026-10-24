---
'@objectstack/spec': minor
---

**BREAKING** — the package upgrade model (`kernel/package-upgrade.zod.ts`: upgrade plan, metadata diff, impact level, pre-upgrade snapshot, upgrade and rollback request/response, phase vocabulary), the four `IPackageService` upgrade members and the `plan` member of `PackageUpgradeResponse` leave the public surface (#25608).

A `major`-class change, recorded as `minor` under the launch-window convention. Maintainer ruling A (`6259332195`, item 3, 「其他同意」): "**Retired:** `packages/spec/src/kernel/package-upgrade.zod.ts` (plan, diff, conflict, snapshot, rollback; zero runtime consumers), with its ADR-0087 conversion." Done directly in 18.x, with no retirement stage; ADR-0049 enforce-or-remove.

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Ruling-ref: 6259332195

**Why.** `@objectstack/spec` declared a complete package upgrade lifecycle — plan the upgrade against a metadata diff, grade its impact, take a pre-upgrade snapshot, three-way merge the customer's customizations, roll back to the snapshot — and nothing on the platform implemented any of it. No provider implements `IPackageService`, so `planUpgrade`, `upgrade`, `rollback` and `getSnapshot` had no body anywhere; no route answers `UpgradePackageRequest` or `RollbackPackageRequest`; and no package, example, app or skill in this repository, in objectui or in hotcrm read any of the names. `UpgradePackageRequest.createSnapshot: true` and `mergeStrategy: 'three-way-merge'` read as protections the platform gave an operator's customizations, and it never did.

### FROM → TO

| removed | from | what to write instead |
| --- | --- | --- |
| `UpgradePlanSchema`, `MetadataDiffItemSchema`, `MetadataChangeTypeSchema`, `UpgradeImpactLevelSchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/kernel` | nothing — no code ever generated an upgrade plan or diffed two package versions. |
| `UpgradeSnapshotSchema`, `RollbackPackageRequestSchema`, `RollbackPackageResponseSchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/kernel` | nothing — no snapshot was ever taken. The package rollback the platform serves is the commit rollback, `POST /api/v1/packages/:id/rollback` with a `commitId`, answered by `RollbackToPackageCommitResponseSchema` (`@objectstack/spec/api`). |
| `UpgradePackageRequestSchema`, `UpgradePackageResponseSchema`, `UpgradePhaseSchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/kernel` | nothing — no upgrade ever ran. Installing a new version over an installed package is a re-install: `POST /api/v1/packages` with `overwrite: true` (the SDK's `packages.install(manifest, { overwrite: true })`). |
| `IPackageService.planUpgrade`, `.upgrade`, `.rollback`, `.getSnapshot`, and their inputs `PlanUpgradeInput`, `ExecuteUpgradeInput`, `RollbackInput` | `@objectstack/spec/contracts` | delete the members from your implementation and the imports of the three inputs — the contract no longer carries them. |
| `PackageUpgradeResponse.data.plan` | `@objectstack/spec/api` | nothing — it carried the retired `UpgradePlan`. `PackageUpgradeRequestSchema` and `PackageUpgradeResponseSchema` themselves stay published, bound to no route. |

**The one-line fix: delete every import of the names above and every read of `PackageUpgradeResponse.data.plan`.** The compiler finds them (`TS2305: Module '"@objectstack/spec/kernel"' has no exported member …`, and `TS2339` for `plan`). No behaviour is lost — nothing ever read or produced these shapes.

**What stays.** The package model beside it — `ManifestSchema`, `InstalledPackageSchema`, `PackageArtifactSchema`, the install, uninstall, enable/disable and dependency-resolution members of `IPackageService` — is unchanged. The `UpgradePlan.estimatedDuration` tombstone leaves with its def's source; its `RETIRED_KEYS_BY_MAJOR[18]` entry and the D3 entry `kernel-package-lifecycle-durations-unit-in-key` stay as history.

⚠️ Runtime behaviour is deliberately **unchanged**: nothing ever parsed a retired shape or called a retired member, so every request answers exactly as before. The removal retracts a false claim, not a capability. **No deprecation window** (startup-stage posture: retirements take effect immediately).

⚠️ **The out-of-repo consumer population beyond objectui and hotcrm is NOT MEASURED.** Inside this repository the names occurred only in their declarations, their own tests, generated artifacts and prose; objectui (main and the pinned `.objectui-sha`) and hotcrm name none of them; `@objectstack/spec` is published, so readers elsewhere were not measured.

The ADR-0087 D3 semantic entry `kernel-package-upgrade-family-retired` carries the judgement, and the ten defs are registered in `RETIRED_DEFS_BY_MAJOR[18]`: none of these shapes is a stack collection or a metadata type, so there is no source for a D2 conversion to rewrite and no carrier key for a tombstone.

<!-- adr-0087: registered kernel-package-upgrade-family-retired -->
