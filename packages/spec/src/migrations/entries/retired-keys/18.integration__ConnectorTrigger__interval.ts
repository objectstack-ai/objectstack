// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B. `ConnectorTrigger.interval`
// said "Polling interval in seconds" in prose and nothing else. A polling
// cadence is exactly the number a reader guesses at, and the bare name `interval`
// means MILLISECONDS elsewhere in this same spec — the identical spelling
// carrying two units a thousandfold apart is the collision that got this whole
// population ruled rather than merely noted. Renamed to `intervalSeconds`; the
// value is unchanged. Tombstoned with `retiredKey()`; the shape is not
// `.strict()`, so a bare deletion would strip in silence. Covered by the D2
// conversion `connector-health-and-trigger-durations-unit-in-key`.
// ⚠️ The trigger shape itself is declared-but-unread (no polling loop is driven
// by it). The rename does not change that; it makes the declaration honest
// about its unit for whoever implements the loop.
export const entry = 'integration/ConnectorTrigger:interval';
