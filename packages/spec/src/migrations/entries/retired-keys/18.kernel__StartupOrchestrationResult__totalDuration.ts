// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B.
// `StartupOrchestrationResult.totalDuration` said "Total time taken for all
// plugins in milliseconds" in prose and nothing else. Renamed to
// `totalDurationMs`; the value is unchanged, and it now agrees with the
// per-plugin `durationMs` it sums. Tombstoned with `retiredKey()`. No D2
// conversion: the result is EMITTED at the end of a boot, never authored. See
// `kernel-startup-orchestrator-durations-unit-in-key`.
export const entry = 'kernel/StartupOrchestrationResult:totalDuration';
