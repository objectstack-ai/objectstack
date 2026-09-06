// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `ServiceLevelObjective.period.duration`
// said "Duration in seconds" in prose and nothing else. Renamed to
// `durationSeconds`; the value is unchanged. This key is why the two `window.size`
// keys above land on `durationSeconds` rather than `sizeSeconds`: the file already
// spelled a window length as a `duration` one schema down, so the three
// measurements now read alike instead of one of them borrowing byte vocabulary.
// Tombstoned with `retiredKey()`. No D2 conversion: an SLO is not a stack
// collection member and not a stored metadata row.
// See `system-metrics-window-durations-unit-in-key`.
export const entry = 'system/ServiceLevelObjective:period.duration';
