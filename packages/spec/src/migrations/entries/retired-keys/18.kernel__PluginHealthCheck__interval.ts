// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `PluginHealthCheck.interval`
// said "Health check interval in milliseconds" in a source JSDoc, and the
// `.describe()` the reference pages publish said "How often to perform health
// checks (default: 30s)" — its one unit-shaped token naming SECONDS for a value
// the schema bounds at min 1000 and defaults to 30000 MILLISECONDS. Measured by
// the gate's own census, the key read [name: -] [prose: -]: no unit in the name,
// and none the gate recognises in the prose either. Renamed to `intervalMs` —
// the family's own spelling on this tree (100 key-position `*Ms` declarations in
// packages/spec, `intervalMs` 3 of them). The value and the 30000 default are
// unchanged. Tombstoned with `retiredKey()`: `PluginHealthCheckSchema` is not
// `.strict()`, so a bare deletion would silently strip the key and hand
// `setInterval` no period at all. No D2 conversion: not a stack collection
// member, not a stored row — `PluginHealthCheck` is a library parameter a host
// passes to `PluginHealthMonitor` in TypeScript, the same reading
// `plugin-auto-restart-never-reinitialised` recorded for this def. See
// `kernel-health-check-and-hot-reload-durations-unit-in-key`.
export const entry = 'kernel/PluginHealthCheck:interval';
