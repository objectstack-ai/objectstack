// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B.
// `MultiVersionSupport.rollout.duration` said "Rollout duration in
// milliseconds" in prose and nothing else, directly beside the unit-less
// `percentage` — two bare numbers on one block, one a proportion and one a
// span. Renamed to `durationMs`; the value is unchanged, and `percentage`
// keeps its name because a proportion has no time unit to carry. Tombstoned
// with `retiredKey()`. No D2 conversion: `MultiVersionSupport` is a plugin
// version-routing configuration a host constructs, never a stack collection
// member. See `kernel-package-lifecycle-durations-unit-in-key`.
export const entry = 'kernel/MultiVersionSupport:rollout.duration';
