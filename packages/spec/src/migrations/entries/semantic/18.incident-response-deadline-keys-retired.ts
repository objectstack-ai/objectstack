// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'incident-response-deadline-keys-retired',
  surface:
    'incident-response deadline keys: `IncidentResponsePhase.targetHours`, '
    + '`IncidentNotificationRule.withinMinutes` / `regulatorDeadlineHours`, '
    + '`IncidentNotificationMatrix.escalationTimeoutMinutes`, '
    + '`IncidentResponsePolicy.triageDeadlineHours` / `retentionDays`',
  replacement:
    'nothing to re-declare — delete the keys. No incident-response engine exists on the '
    + 'platform: nothing tracks a phase against a clock, sends or times an incident '
    + 'notification, notifies a regulator, walks the escalation chain on a timer or sweeps '
    + 'incident records on a schedule, so there is no live mechanism to declare a deadline '
    + 'to. Retention of stored records is the object-level `lifecycle` block (ADR-0057), '
    + 'declared on the object that stores the records and enforced by the LifecycleService — '
    + 'not a number on this policy document',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-02 on #14477 (ruled A: retire per '
    + 'family). Six hour/minute/day-shaped keys sat on the published authorable surface and '
    + 'in the generated reference docs — an author could write `triageDeadlineHours: 4` and '
    + 'reasonably expect the platform to escalate after four hours — and read by NOTHING: '
    + 'the schemas are exported from `@objectstack/spec/system`, mounted by no stack key, '
    + 'registered as no metadata type, absent from the 2026-06 liveness ledgers, and the '
    + 'reader census over every package outside `packages/spec` (tests and changelogs '
    + 'excluded) and over objectui at the pinned sha returned zero hits for every key. Three '
    + 'of the six carried defaults (30 minutes, 1 hour, 2555 days) that were materialized '
    + 'into every parsed document without ever being consulted. A compliance-shaped deadline '
    + 'that fails silently is the worst form of the declared-but-unenforced shape ADR-0049 '
    + 'names; tagging it `[EXPERIMENTAL — not enforced]` was the fallback the ruling did not '
    + 'take. Why D3 semantic and not a D2 conversion: the chain walks a normalized STACK and '
    + '`applyConversionsToStoredItem` maps a metadata type onto one of its collections; none '
    + 'of these schemas is either, so a conversion would be a transform with no seam that '
    + 'ever runs (the `kernel/MetadataPluginConfig:additionalTypes` precedent).',
  acceptanceCriteria:
    'No `IncidentResponsePhase`, `IncidentNotificationRule`, `IncidentNotificationMatrix` or '
    + '`IncidentResponsePolicy` literal — standalone or nested in an `Incident` — carries '
    + '`targetHours`, `withinMinutes`, `regulatorDeadlineHours`, `escalationTimeoutMinutes`, '
    + '`triageDeadlineHours` or `retentionDays`. TypeScript authors get the refusal at compile '
    + 'time (each key is typed `never`); a value reaching the parse is refused with the '
    + 'prescription (`invalid_type` at the path of the key). Parsed documents no longer carry '
    + 'the three former defaults. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be '
    + 'verified as such: nothing ever read the keys, so removing them removes no behaviour.',
};
