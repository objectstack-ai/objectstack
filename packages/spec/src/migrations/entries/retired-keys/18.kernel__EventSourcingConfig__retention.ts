// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `EventSourcingConfig.retention`
// said "Days to retain events" in prose and nothing else — two keys above the
// count-valued `snapshotRetention`, so `retention: 365` and
// `snapshotRetention: 10` read as the same kind of number and are not. Renamed
// to `retentionDays`; the value is unchanged, and `snapshotRetention` keeps its
// name because a count has no unit to carry. Tombstoned with `retiredKey()`.
// No D2 conversion, for the reason the sibling `EventPersistence:retention`
// entry records; `kernel-event-bus-retention-unit-in-key` is the prescription.
export const entry = 'kernel/EventSourcingConfig:retention';
