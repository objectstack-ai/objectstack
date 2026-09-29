// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B.
// `CircuitBreakerConfig.monitoringWindow` said "Rolling window for failure
// count in ms" in prose and nothing else — ONE key below `resetTimeoutMs`,
// which already spelled its unit, on the same six-key shape. That is the
// sharpest case in this card: a single schema already carried both
// conventions, so a reader had no rule to apply, only two examples that
// disagreed. Renamed to `monitoringWindowMs`; the value and the 60000 default
// are unchanged. Tombstoned with `retiredKey()` — the shape is not `.strict()`,
// so a bare deletion would strip in silence and the breaker would fall back to
// its default window while the author believed they had widened it. Covered by
// the D2 conversion `connector-health-and-trigger-durations-unit-in-key`:
// `connectors:` is a stack collection and a published connector row lands whole
// in `sys_metadata`, so the chain has a seam that sees it.
//
// ⚠️ Superseded in the same unreleased step: the whole `health` block was then
// retired under ADR-0049 (the connector resilience family), so
// `integration/CircuitBreakerConfig` left whole (`RETIRED_DEFS_BY_MAJOR[18]`) and
// this tombstone left with it. The row STAYS — the whole-def removal steady
// state gate (b3) exempts — because it is still the record that the bare
// `monitoringWindow` spelling was retired. The rename's breaker half was absorbed
// by `connector-resilience-keys-removed`, which strips the block an author
// holding either spelling still carries; the `health` tombstone's prescription
// names both spellings. (Its trigger half was absorbed later in the same step by
// `connector-triggers-removed`, so the rename conversion itself left the table.)
export const entry = 'integration/CircuitBreakerConfig:monitoringWindow';
