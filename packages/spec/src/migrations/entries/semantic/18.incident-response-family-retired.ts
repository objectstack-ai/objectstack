// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'incident-response-family-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the incident-response family, retired whole: the eight defs system/Incident, '
    + 'system/IncidentCategory, system/IncidentNotificationMatrix, '
    + 'system/IncidentNotificationRule, system/IncidentResponsePhase, '
    + 'system/IncidentResponsePolicy, system/IncidentSeverity and system/IncidentStatus, '
    + 'and every name system/incident-response.zod.ts exported from @objectstack/spec/system '
    + '(the eight *Schema consts, their z.input aliases and the three *Parsed aliases)',
  replacement:
    'nothing to re-declare — no incident-response engine exists on the platform, so there is '
    + 'no working configuration to migrate to. Nothing classified, tracked, escalated or '
    + 'notified an incident and nothing notified a regulator; a compliance record the '
    + 'organisation keeps is ordinary object data, declared as an object with its own '
    + 'fields and enforced by the object engine (validation, permissions, the '
    + 'object-level `lifecycle` block under ADR-0057). If incident response becomes a product '
    + 'capability it re-declares fresh, through the enforce route of ADR-0049 — the engine '
    + 'first, the vocabulary second',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 on #15513 (ruled A: retire the '
    + 'three compliance-shaped families whole via RETIRED_DEFS_BY_MAJOR, the '
    + 'integration/ErrorMappingConfig precedent; not roadmapped). Eight defs and roughly '
    + 'forty declared keys sat on the exported surface and in the generated reference docs, '
    + 'and were read by NOTHING: the schemas were exported from `@objectstack/spec/system`, '
    + 'mounted by no `stack.zod.ts` key, registered as no metadata type, absent from the '
    + '2026-06 liveness ledgers, and the reader census over every package outside '
    + '`packages/spec` (tests and changelogs excluded), over `examples/**` and `skills/**`, '
    + 'and over objectui at the pinned sha returned zero hits for every exported name, with '
    + 'a lit control. Several keys were boolean capability claims of exactly the shape '
    + 'ADR-0049 names — `IncidentNotificationRule.notifyRegulators`, '
    + '`IncidentResponsePolicy.requirePostIncidentReview` — so an author (very often an AI, '
    + 'ADR-0033) could write `notifyRegulators: true`, parse clean, and hold a compliance '
    + 'promise the platform never kept, with no error and no feedback. Tagging the family '
    + '`[EXPERIMENTAL — not enforced]` was the fallback the ruling did not take: it is a '
    + 'human-only signal, and an AI generating from the schema still writes the key and '
    + 'believes it. The #14477 deadline-key tombstones (six sites, `RETIRED_KEYS_BY_MAJOR[18]`, '
    + 'D3 `incident-response-deadline-keys-retired`) leave with their defs\' source; their '
    + 'registry entries stay as history. Why D3 semantic and not a D2 conversion: the chain '
    + 'walks a normalized STACK and `applyConversionsToStoredItem` maps a metadata type onto '
    + 'one of its collections; none of these schemas is either, so a conversion would be a '
    + 'transform with no seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes` '
    + 'precedent), and with no carrier key there is no shape on which a tombstone could sit.',
  acceptanceCriteria:
    'No code imports IncidentSchema, IncidentCategorySchema, IncidentNotificationMatrixSchema, '
    + 'IncidentNotificationRuleSchema, IncidentResponsePhaseSchema, '
    + 'IncidentResponsePolicySchema, IncidentSeveritySchema or IncidentStatusSchema — or any '
    + 'of their type aliases — from @objectstack/spec or @objectstack/spec/system: every such '
    + 'import is TS2305 after upgrade, and no working replacement exists to point at because '
    + 'the vocabulary described nothing real. The eight defs are absent from '
    + '`json-schema.manifest/system.json`, the api-surface / declaration-map / export-origins '
    + 'shards and the generated reference docs. ⚠️ Runtime behaviour is deliberately UNCHANGED '
    + 'and must be verified as such: nothing ever parsed or read these shapes, so removing '
    + 'them removes no behaviour.',
};
