// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15513 — `system/IncidentStatus` — the 7-value incident status enum — leaves
// whole with the incident-response family under ADR-0049 enforce-or-remove
// (maintainer ruling 2026-09-05 on #15513, ruled A: retire the three
// compliance-shaped families whole; not roadmapped). It was exported from
// `@objectstack/spec/system` (`system/incident-response.zod.ts`), mounted by no
// `stack.zod.ts` key, registered as no metadata type, absent from the 2026-06
// liveness ledgers, and read by NOTHING: the reader census over every package
// outside `packages/spec` (tests and changelogs excluded), over `examples/**`
// and `skills/**`, and over objectui at the pinned sha returned zero hits for
// every one of the family's exported names, with a lit control on the same
// pattern. No incident-response engine exists on the platform: nothing
// classified, tracked, escalated or notified an incident, and nothing notified a
// regulator — an author writing `notifyRegulators: true` held a compliance
// promise the platform never kept, with no error and no feedback. An exported
// value schema with no consumer reads as a capability (#3950); the generated
// reference docs advertised a compliance subsystem that does not exist. No
// carrier key, so no `retiredKey()` tombstone and no D2 conversion (none of
// these schemas is a stack collection member — the
// `kernel/MetadataPluginConfig:additionalTypes` reasoning):
// RETIRED_DEFS_BY_MAJOR plus the D3 semantic entry
// `incident-response-family-retired` ARE the declaration. The family's #14477
// `RETIRED_KEYS_BY_MAJOR[18]` deadline-key entries stay as history — gate (b2)
// of build-schemas.ts accepts an entry naming a key the build no longer emits.
export const entry = 'system/IncidentStatus';
