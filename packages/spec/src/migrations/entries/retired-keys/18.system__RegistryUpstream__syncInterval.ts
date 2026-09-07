// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `RegistryUpstream.syncInterval`
// said "Auto-sync interval in seconds" in prose and nothing else, on a block
// whose `timeout` two keys down was MILLISECONDS: one upstream declaration, two
// units, neither spelled at the authoring site. Renamed to `syncIntervalSeconds`;
// the value and the min-60 bound are unchanged. Tombstoned with `retiredKey()`.
// No D2 conversion: `stack.zod.ts` declares no `registry` collection and a
// registry config is host configuration, not a stored metadata row.
// See `system-registry-config-durations-unit-in-key`.
export const entry = 'system/RegistryUpstream:syncInterval';
