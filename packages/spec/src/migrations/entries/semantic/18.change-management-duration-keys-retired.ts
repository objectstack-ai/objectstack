// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'change-management-duration-keys-retired',
  surface:
    'change-management duration keys: `ChangeImpact.downtime.durationMinutes`, '
    + '`RollbackPlan.steps[].estimatedMinutes`, '
    + '`ChangeRequest.implementation.steps[].estimatedMinutes`',
  replacement:
    'nothing to re-declare — delete the keys. No change-management engine exists on the '
    + 'platform: nothing schedules a maintenance window, executes or times an implementation '
    + 'or rollback step, or compares an estimate with what happened, so there is no live '
    + 'mechanism to declare a duration to',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-02 on #14477 (ruled A: retire per '
    + 'family). Three minute-shaped keys, at three nested sites, sat in the exported '
    + 'change-management schemas and in the generated reference docs — an author could write '
    + '`estimatedMinutes: 15` on a rollback step and reasonably expect it to feed a schedule — '
    + 'and read by NOTHING: the schemas are exported from `@objectstack/spec/system`, mounted '
    + 'by no stack key, registered as no metadata type, absent from the 2026-06 liveness '
    + 'ledgers, and the reader census over every package outside `packages/spec` (tests and '
    + 'changelogs excluded) and over objectui at the pinned sha returned zero hits for every '
    + 'key. All three sites are NESTED (`downtime.durationMinutes`, `steps[].estimatedMinutes` '
    + 'twice), so the authorable-surface ratchet — which walks top-level def properties — never '
    + 'listed them; their `RETIRED_KEYS_BY_MAJOR[18]` entries carry the nested spelling for the '
    + 'spec-changes / upgrade-guide projection. Why D3 semantic and not a D2 conversion: the '
    + 'chain walks a normalized STACK and `applyConversionsToStoredItem` maps a metadata type '
    + 'onto one of its collections; none of these schemas is either, so a conversion would be '
    + 'a transform with no seam that ever runs (the '
    + '`kernel/MetadataPluginConfig:additionalTypes` precedent).',
  acceptanceCriteria:
    'No `ChangeImpact.downtime` block carries `durationMinutes`, and no implementation or '
    + 'rollback step — in a `RollbackPlan` or inside a `ChangeRequest` — carries '
    + '`estimatedMinutes`. TypeScript authors get the refusal at compile time (each key is '
    + 'typed `never`); a value reaching the parse is refused with the prescription '
    + '(`invalid_type` at the nested path of the key, e.g. `rollbackPlan.steps.0.estimatedMinutes`). '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: nothing '
    + 'ever read the keys, so removing them removes no behaviour.',
};
