// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'change-management-family-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the change-management family, retired whole: the six defs system/ChangeImpact, '
    + 'system/ChangePriority, system/ChangeRequest, system/ChangeStatus, system/ChangeType '
    + 'and system/RollbackPlan, and every name system/change-management.zod.ts exported from '
    + '@objectstack/spec/system (the six *Schema consts, their z.input aliases and the '
    + 'ChangeRequestParsed alias)',
  replacement:
    'nothing to re-declare — no change-management engine exists on the platform, so there is '
    + 'no working configuration to migrate to. Nothing routed a change request for approval, '
    + 'walked its implementation steps, honoured a rollback plan or gated on '
    + '`securityImpact.requiresSecurityApproval` / `approval.required`; a change record the '
    + 'organisation keeps is ordinary object data, declared as an object with its own fields, '
    + 'and an approval that must actually gate something is a flow (ADR-0018) with an approval '
    + 'node. Metadata change tracking on the platform is `sys_metadata` history and the '
    + 'package model (ADR-0126), unrelated to this vocabulary. If ITIL change management '
    + 'becomes a product capability it re-declares fresh, through the enforce route of '
    + 'ADR-0049 — the engine first, the vocabulary second',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 on #15513 (ruled A: retire the '
    + 'three compliance-shaped families whole via RETIRED_DEFS_BY_MAJOR, the '
    + 'integration/ErrorMappingConfig precedent; not roadmapped). Six defs and roughly fifty '
    + 'declared keys sat on the exported surface and in the generated reference docs, and were '
    + 'read by NOTHING: the schemas were exported from `@objectstack/spec/system`, mounted by '
    + 'no `stack.zod.ts` key, registered as no metadata type, absent from the 2026-06 liveness '
    + 'ledgers, and the reader census over every package outside `packages/spec` (tests and '
    + 'changelogs excluded), over `examples/**` and `skills/**`, and over objectui at the '
    + 'pinned sha returned zero hits for every exported name, with a lit control. '
    + '`ChangeRequest.approval.required` and `ChangeRequest.securityImpact.requiresSecurityApproval` '
    + 'read as gates the platform enforced, and neither ever did — the worst form of the '
    + 'declared-but-unenforced shape, on a security-adjacent surface. Tagging the family '
    + '`[EXPERIMENTAL — not enforced]` was the fallback the ruling did not take (a human-only '
    + 'signal). The #14477 duration-key tombstones (three nested sites, '
    + '`RETIRED_KEYS_BY_MAJOR[18]`, D3 `change-management-duration-keys-retired`) leave with '
    + 'their defs\' source; their registry entries stay as history. Why D3 semantic and not a '
    + 'D2 conversion: the chain walks a normalized STACK and `applyConversionsToStoredItem` '
    + 'maps a metadata type onto one of its collections; none of these schemas is either, so '
    + 'a conversion would be a transform with no seam that ever runs (the '
    + '`kernel/MetadataPluginConfig:additionalTypes` precedent), and with no carrier key there '
    + 'is no shape on which a tombstone could sit.',
  acceptanceCriteria:
    'No code imports ChangeImpactSchema, ChangePrioritySchema, ChangeRequestSchema, '
    + 'ChangeStatusSchema, ChangeTypeSchema or RollbackPlanSchema — or any of their type '
    + 'aliases — from @objectstack/spec or @objectstack/spec/system: every such import is '
    + 'TS2305 after upgrade, and no working replacement exists to point at because the '
    + 'vocabulary described nothing real. `kernel/MetadataChangeType` (M92 of the type-alias '
    + 'pin, a different declaration with a live consumer) is unaffected. The six defs are '
    + 'absent from `json-schema.manifest/system.json`, the api-surface / declaration-map / '
    + 'export-origins shards and the generated reference docs. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED and must be verified as such: nothing ever parsed or read these '
    + 'shapes, so removing them removes no behaviour.',
};
