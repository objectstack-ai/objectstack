// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). The error-budget burn-rate
// `window` said "Window size in seconds" in a source JSDoc while its
// `.describe()` read "Window size" and named no unit — the exact site #15939
// was filed on. Renamed to `durationSeconds`: it is the fourth window length on
// this file, and #15679 already settled that a window length here is spelled
// `durationSeconds` so the measurements read alike. `windowSeconds` is rejected
// for the reason #15679 recorded against `window.windowSeconds` — the enclosing
// array is already called `burnRateWindows`, so the key would stutter — and
// because on this tree `windowSeconds` is not an authorable key at all: its only
// key-position occurrence is an entry in `ServerRateLimitConfigSchema`'s alias
// map that maps the spelling AWAY to `windowMs`. The value is unchanged.
// Tombstoned with `retiredKey()`: this array-element object is not strict, so a
// bare deletion would silently strip the key.
//
// The path crosses an ARRAY (`errorBudget.burnRateWindows` is a `z.array`) and
// is spelled with plain dots, no bracket token, because that is the only
// notation this table uses: of its rows none carries a bracket, and the two
// historical rows that crossed an array — `system/RollbackPlan:steps.…` and
// `system/ChangeRequest:implementation.steps.…` — spelled it this way (their
// schemas have since been retired, so the precedent cannot be re-read on this
// tree; flagged for the contract review). A NESTED site: the authorable-surface
// ratchet walks top-level def properties only, so no `[RETIRED]` row exists for
// it and gate (b) of `build-schemas.ts` neither demands nor refuses this entry.
// No D2 conversion: an SLO is not a stack collection member and not a stored
// metadata row — the reading `system-metrics-window-durations-unit-in-key`
// already recorded for this same def.
// See `system-metrics-jsdoc-durations-unit-in-key`.
export const entry = 'system/ServiceLevelObjective:errorBudget.burnRateWindows.window';
