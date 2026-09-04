// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'training-deadline-keys-retired',
  surface:
    'training duration and deadline keys: `TrainingCourse.durationMinutes` / `validityDays`, '
    + '`TrainingPlan.recertificationIntervalDays` / `gracePeriodDays` / `reminderDaysBefore`',
  replacement:
    'nothing to re-declare — delete the keys. No training-management engine exists on the '
    + 'platform: nothing schedules or times a course, computes a certification expiry, '
    + 're-assigns training on an interval, escalates an expired certification or sends a '
    + 'reminder, so there is no live mechanism to declare a duration or deadline to',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-02 on #14477 (ruled A: retire per '
    + 'family). Five minute/day-shaped keys sat on the published authorable surface and in the '
    + 'generated reference docs — an author could write `validityDays: 365` and reasonably '
    + 'expect a certificate to expire — and read by NOTHING: the schemas are exported from '
    + '`@objectstack/spec/system`, mounted by no stack key, registered as no metadata type, '
    + 'absent from the 2026-06 liveness ledgers, and the reader census over every package '
    + 'outside `packages/spec` (tests and changelogs excluded) and over objectui at the pinned '
    + 'sha returned zero hits for every key. Three of the five carried defaults (365, 30 and 14 '
    + 'days) that were materialized into every parsed plan without ever being consulted. Why '
    + 'D3 semantic and not a D2 conversion: the chain walks a normalized STACK and '
    + '`applyConversionsToStoredItem` maps a metadata type onto one of its collections; none of '
    + 'these schemas is either, so a conversion would be a transform with no seam that ever '
    + 'runs (the `kernel/MetadataPluginConfig:additionalTypes` precedent).',
  acceptanceCriteria:
    'No `TrainingCourse` or `TrainingPlan` literal — standalone or as a `courses[]` entry — '
    + 'carries `durationMinutes`, `validityDays`, `recertificationIntervalDays`, '
    + '`gracePeriodDays` or `reminderDaysBefore`. TypeScript authors get the refusal at compile '
    + 'time (each key is typed `never`); a value reaching the parse is refused with the '
    + 'prescription (`invalid_type` at the path of the key). Parsed plans no longer carry the '
    + 'three former defaults. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be '
    + 'verified as such: nothing ever read the keys, so removing them removes no behaviour.',
};
