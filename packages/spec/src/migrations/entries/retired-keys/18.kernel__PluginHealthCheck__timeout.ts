// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `PluginHealthCheck.timeout`
// said "Timeout for health check in milliseconds" in a source JSDoc and
// "Maximum time to wait for health check response" in the `.describe()` the
// reference pages publish, so the published channel named no unit at all and the
// reference-page reader got a bare 5000. Renamed to `timeoutMs` — the family's
// most attested spelling on this tree (29 key-position `timeoutMs` declarations
// in packages/spec). The value and the 5000 default are unchanged. Tombstoned
// with `retiredKey()`: `PluginHealthCheckSchema` is not `.strict()`, so a bare
// deletion would silently strip the key and race the health check against no
// deadline. No D2 conversion: not a stack collection member, not a stored row —
// `PluginHealthCheck` is a library parameter a host passes to
// `PluginHealthMonitor` in TypeScript, the same reading
// `plugin-auto-restart-never-reinitialised` recorded for this def. See
// `kernel-health-check-and-hot-reload-durations-unit-in-key`.
export const entry = 'kernel/PluginHealthCheck:timeout';
