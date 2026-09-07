// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15513 — `system/TrainingCourse` — a course (`id` / `title` / `category` /
// `mandatory` / `targetRoles` / `passingScore` …, plus the #14477-retired
// `durationMinutes` / `validityDays`) — leaves whole with the training family
// under ADR-0049 enforce-or-remove (maintainer ruling 2026-09-05 on #15513,
// ruled A: retire the three compliance-shaped families whole; not roadmapped).
// It was exported from `@objectstack/spec/system` (`system/training.zod.ts`),
// mounted by no `stack.zod.ts` key, registered as no metadata type, absent from
// the 2026-06 liveness ledgers, and read by NOTHING: the reader census over
// every package outside `packages/spec` (tests and changelogs excluded), over
// `examples/**` and `skills/**`, and over objectui at the pinned sha returned
// zero hits for every one of the family's exported names, with a lit control on
// the same pattern. No training-management engine exists on the platform:
// nothing assigned a course, tracked a completion, sent a reminder or expired a
// certification — `mandatory: true`, `trackCompletion: true` and `sendReminders:
// true` were declarations nothing ever read. An exported value schema with no
// consumer reads as a capability (#3950); the generated reference docs
// advertised a compliance subsystem that does not exist. No carrier key, so no
// `retiredKey()` tombstone and no D2 conversion (none of these schemas is a
// stack collection member — the `kernel/MetadataPluginConfig:additionalTypes`
// reasoning): RETIRED_DEFS_BY_MAJOR plus the D3 semantic entry
// `training-family-retired` ARE the declaration. The family's #14477
// `RETIRED_KEYS_BY_MAJOR[18]` deadline-key entries stay as history — gate (b2)
// of build-schemas.ts accepts an entry naming a key the build no longer emits.
export const entry = 'system/TrainingCourse';
