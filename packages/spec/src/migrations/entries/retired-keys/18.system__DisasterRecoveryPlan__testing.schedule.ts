// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — the backup / DR-testing family's second position,
// `DisasterRecoveryPlan.testing.schedule`: the periodic DR-test cron, read by
// NOTHING (`DisasterRecoveryPlanSchema` has no consumer outside
// `packages/spec`). Same route (a `retiredKey()` tombstone on a non-strict
// `z.object`, ADR-0104), same major, same absence of a D2 conversion (see
// `18.system__BackupConfig__schedule.ts` for the retirement record).
//
// A NESTED site: the authorable-surface ratchet walks top-level def
// properties only (`system/DisasterRecoveryPlan:testing` is the row), so no
// `[RETIRED]` row exists for the cron itself and gate (b) of
// `build-schemas.ts` neither demands nor refuses this entry — it is here for
// the spec-changes / upgrade-guide projection, spelled the way
// `api/BatchEndpointsConfig:operations.upsertMany` is.
// D3 semantic entry: `disaster-recovery-schedules-retired`.
export const entry = 'system/DisasterRecoveryPlan:testing.schedule';
