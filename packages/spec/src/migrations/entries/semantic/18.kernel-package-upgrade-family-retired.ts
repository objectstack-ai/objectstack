// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-package-upgrade-family-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the package upgrade model, retired whole: the ten defs kernel/MetadataChangeType, '
    + 'kernel/MetadataDiffItem, kernel/UpgradeImpactLevel, kernel/UpgradePlan, '
    + 'kernel/UpgradeSnapshot, kernel/UpgradePackageRequest, kernel/UpgradePhase, '
    + 'kernel/UpgradePackageResponse, kernel/RollbackPackageRequest and '
    + 'kernel/RollbackPackageResponse, and every name kernel/package-upgrade.zod.ts exported from '
    + '@objectstack/spec/kernel (the ten *Schema consts, their z.input aliases and their *Parsed '
    + 'aliases); the IPackageService members planUpgrade, upgrade, rollback and getSnapshot with '
    + 'their inputs PlanUpgradeInput, ExecuteUpgradeInput and RollbackInput from '
    + '@objectstack/spec/contracts; and the plan member of PackageUpgradeResponse.data from '
    + '@objectstack/spec/api',
  replacement:
    'nothing to re-declare — no package upgrade engine exists on the platform, so there is no '
    + 'working configuration to migrate to. Nothing generated an upgrade plan, diffed two package '
    + 'versions, took a pre-upgrade snapshot, three-way merged a customization or rolled a package '
    + 'back to a snapshot. What the platform does serve: an upgrade is a re-install of the new '
    + 'version (`POST /api/v1/packages` with `overwrite: true`), and the package rollback it '
    + 'serves is the commit rollback (`POST /api/v1/packages/:id/rollback` with a `commitId`, '
    + 'answered by `RollbackToPackageCommitResponseSchema` in `@objectstack/spec/api`). '
    + '`PackageUpgradeRequestSchema` and `PackageUpgradeResponseSchema` stay published, bound to no '
    + 'route, minus the response\'s `plan`. If a package upgrade becomes a product capability it '
    + 're-declares fresh, through the enforce route of ADR-0049 — the engine first, the '
    + 'vocabulary second',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling A of 2026-10-19 on the package lifecycle '
    + 'classes, item 3 ("Retired: packages/spec/src/kernel/package-upgrade.zod.ts (plan, diff, '
    + 'conflict, snapshot, rollback; zero runtime consumers), with its ADR-0087 conversion"), done '
    + 'directly in 18.x with no retirement stage. Ten defs sat on the exported surface and in the '
    + 'generated reference docs, and were read by NOTHING: the schemas were exported from '
    + '`@objectstack/spec/kernel`, mounted by no `stack.zod.ts` key, registered as no metadata '
    + 'type, and no provider ever implemented the four `IPackageService` upgrade members that '
    + 'returned them; the reader census over every package outside `packages/spec`, over '
    + '`examples/**` and `skills/**`, and over objectui and hotcrm returned zero hits for every '
    + 'exported name, with a lit control. `UpgradePackageRequest.createSnapshot` and '
    + '`mergeStrategy: three-way-merge` read as guarantees the platform kept, and neither ever '
    + 'did — the declared-but-unenforced shape on the one surface an operator trusts to protect '
    + 'their customizations. The `UpgradePlan.estimatedDuration` tombstone of the duration-unit '
    + 'ruling (`RETIRED_KEYS_BY_MAJOR[18]`, D3 `kernel-package-lifecycle-durations-unit-in-key`) '
    + 'leaves with its def\'s source; its registry entries stay as history. Why D3 semantic and '
    + 'not a D2 conversion: the chain walks a normalized STACK and `applyConversionsToStoredItem` '
    + 'maps a metadata type onto one of its collections; none of these schemas is either, so a '
    + 'conversion would be a transform with no seam that ever runs, and with no carrier key there '
    + 'is no shape on which a tombstone could sit. ADR-0087.',
  acceptanceCriteria:
    'No code imports MetadataChangeTypeSchema, MetadataDiffItemSchema, UpgradeImpactLevelSchema, '
    + 'UpgradePlanSchema, UpgradeSnapshotSchema, UpgradePackageRequestSchema, UpgradePhaseSchema, '
    + 'UpgradePackageResponseSchema, RollbackPackageRequestSchema or RollbackPackageResponseSchema '
    + '— or any of their type aliases — from @objectstack/spec or @objectstack/spec/kernel, and '
    + 'none imports PlanUpgradeInput, ExecuteUpgradeInput or RollbackInput from '
    + '@objectstack/spec/contracts: every such import is TS2305 after upgrade. No IPackageService '
    + 'implementation still declares planUpgrade, upgrade, rollback or getSnapshot (the contract '
    + 'no longer carries them, so no caller typed against it can reach them), and no reader of '
    + 'PackageUpgradeResponse.data.plan remains (TS2339). The ten defs are absent from '
    + '`json-schema.manifest/kernel.json`, the api-surface / declaration-map / export-origins '
    + 'shards and the generated reference docs. ⚠️ Runtime behaviour is deliberately UNCHANGED '
    + 'and must be verified as such: nothing ever parsed or read these shapes, so removing them '
    + 'removes no behaviour.',
};
