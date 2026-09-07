// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B. `dashboard.refreshInterval`
// said "Auto-refresh interval in seconds" in prose and nothing else. The three
// rename-hint aliases beside it — `refresh`, `autoRefresh`, `pollInterval` —
// measure how many spellings authors actually reach for, and not one of them
// named a unit either, so every door into this key left the cadence ambiguous.
// All three were repointed to the new spelling in the same edit. Renamed to
// `refreshIntervalSeconds`; the value is unchanged. Tombstoned with
// `retiredKey()`; the shape IS `strictObject`, so the tombstone is here for the
// prescription an unknown-key rejection cannot carry. Covered by the D2
// conversion `dashboard-refresh-interval-to-refresh-interval-seconds`:
// `dashboards:` is a stack collection and a dashboard is a registered metadata
// kind stored as a row.
// ⚠️ Unique in this stack: the consumer is in ANOTHER REPOSITORY. objectui's
// dashboard renderer reads this key and multiplies by 1000, and publishes it as
// a registry input, so its reader could not move in this PR the way every other
// reader in this card did. Sequenced as a follow-up card behind a release that
// actually ships the rename; until then the renderer sees an absent key and
// does not start its timer.
export const entry = 'ui/Dashboard:refreshInterval';
