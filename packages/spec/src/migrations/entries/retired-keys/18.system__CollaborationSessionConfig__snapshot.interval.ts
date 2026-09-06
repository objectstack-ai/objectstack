// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `snapshot.interval` said
// "Snapshot interval in milliseconds" in prose and nothing else. It moves in the
// same stroke as its parent's `idleTimeout`: both are session-lifetime durations
// on one config object, and leaving one bare would have kept exactly the
// ambiguity the rename removes. Renamed to `intervalMs`; the value is unchanged.
// Tombstoned with `retiredKey()`. No D2 conversion, for its parent's reason.
// See `system-collaboration-durations-unit-in-key`.
export const entry = 'system/CollaborationSessionConfig:snapshot.interval';
