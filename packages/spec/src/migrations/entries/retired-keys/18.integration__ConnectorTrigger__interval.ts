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
//
// ⚠️ Superseded in the same unreleased step: the trigger shape was declared but
// never read (no polling loop was driven by it), and the whole `triggers` array
// was then retired under ADR-0049 — `integration/ConnectorTrigger` left whole
// (`RETIRED_DEFS_BY_MAJOR[18]`) and this tombstone left with it. The row STAYS —
// the whole-def removal steady state gate (b3) exempts — because it is still the
// record that the bare `interval` spelling was retired (the
// `integration/CircuitBreakerConfig:monitoringWindow` precedent). The rename
// conversion left the table, both of its halves absorbed; the trigger half by
// `connector-triggers-removed`, which strips the array an author holding either
// spelling still carries, and the `triggers` tombstone's prescription names both.
export const entry = 'integration/ConnectorTrigger:interval';
