// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `PluginStartupResult.duration`
// said "Time taken to start the plugin in milliseconds" in prose and nothing
// else. Renamed to `durationMs`; the value is unchanged. Tombstoned with
// `retiredKey()`. No D2 conversion: the result is EMITTED by the orchestrator
// per plugin at boot, never authored.
//
// ⚠️ Note for anyone grepping: `packages/core/src/plugin-loader.ts` declares
// its OWN local `PluginStartupResult` interface — a DIFFERENT type
// (`{ success, pluginName, startTime?, error?, timedOut? }`) with no
// `duration` key at all. It is not a reader of this schema, it is untouched by
// this rename, and the divergence between the two shapes is filed separately.
// See `kernel-startup-orchestrator-durations-unit-in-key`.
export const entry = 'kernel/PluginStartupResult:duration';
