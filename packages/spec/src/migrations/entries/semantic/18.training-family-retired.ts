// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'training-family-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the training family, retired whole: the five defs system/TrainingCategory, '
    + 'system/TrainingCompletionStatus, system/TrainingCourse, system/TrainingPlan and '
    + 'system/TrainingRecord, and every name system/training.zod.ts exported from '
    + '@objectstack/spec/system (the five *Schema consts, their z.input aliases and the two '
    + '*Parsed aliases)',
  replacement:
    'nothing to re-declare — no training-management engine exists on the platform, so there '
    + 'is no working configuration to migrate to. Nothing assigned a course, tracked a '
    + 'completion, sent a reminder or expired a certification; a training record the '
    + 'organisation keeps is ordinary object data, declared as an object with its own fields '
    + 'and enforced by the object engine. If training management becomes a product capability '
    + 'it re-declares fresh, through the enforce route of ADR-0049 — the engine first, the '
    + 'vocabulary second',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 on #15513 (ruled A: retire the '
    + 'three compliance-shaped families whole via RETIRED_DEFS_BY_MAJOR, the '
    + 'integration/ErrorMappingConfig precedent; not roadmapped). Five defs and roughly '
    + 'twenty-five declared keys sat on the exported surface and in the generated reference '
    + 'docs, and were read by NOTHING: the schemas were exported from '
    + '`@objectstack/spec/system`, mounted by no `stack.zod.ts` key, registered as no metadata '
    + 'type, absent from the 2026-06 liveness ledgers, and the reader census over every '
    + 'package outside `packages/spec` (tests and changelogs excluded), over `examples/**` and '
    + '`skills/**`, and over objectui at the pinned sha returned zero hits for every exported '
    + 'name, with a lit control. `TrainingCourse.mandatory`, `TrainingPlan.trackCompletion` '
    + 'and `TrainingPlan.sendReminders` were boolean capability claims of exactly the shape '
    + 'ADR-0049 names: an author could write them, parse clean, and get no behaviour and no '
    + 'diagnostic. Tagging the family `[EXPERIMENTAL — not enforced]` was the fallback the '
    + 'ruling did not take (a human-only signal). The #14477 deadline-key tombstones (five '
    + 'sites, `RETIRED_KEYS_BY_MAJOR[18]`, D3 `training-deadline-keys-retired`) leave with '
    + 'their defs\' source; their registry entries stay as history. Why D3 semantic and not a '
    + 'D2 conversion: the chain walks a normalized STACK and `applyConversionsToStoredItem` '
    + 'maps a metadata type onto one of its collections; none of these schemas is either, so '
    + 'a conversion would be a transform with no seam that ever runs (the '
    + '`kernel/MetadataPluginConfig:additionalTypes` precedent), and with no carrier key there '
    + 'is no shape on which a tombstone could sit.',
  acceptanceCriteria:
    'No code imports TrainingCategorySchema, TrainingCompletionStatusSchema, '
    + 'TrainingCourseSchema, TrainingPlanSchema or TrainingRecordSchema — or any of their type '
    + 'aliases — from @objectstack/spec or @objectstack/spec/system: every such import is '
    + 'TS2305 after upgrade, and no working replacement exists to point at because the '
    + 'vocabulary described nothing real. The five defs are absent from '
    + '`json-schema.manifest/system.json`, the api-surface / declaration-map / export-origins '
    + 'shards and the generated reference docs. ⚠️ Runtime behaviour is deliberately UNCHANGED '
    + 'and must be verified as such: nothing ever parsed or read these shapes, so removing '
    + 'them removes no behaviour.',
};
