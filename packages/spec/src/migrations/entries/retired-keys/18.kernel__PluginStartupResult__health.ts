// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `PluginStartupResult.health` held the `HealthStatus` a startup
// health check would have produced. The health-check option, the orchestrator
// interface that declared the check and the `HealthStatus` vocabulary itself
// all leave in this major (`kernel/HealthStatus` in RETIRED_DEFS_BY_MAJOR[18]),
// and nothing ever filled the key. Tombstoned rather than dropped because the
// carrying def survives — see `18.kernel__PluginStartupResult__plugin.ts` for
// why that matters here.
export const entry = 'kernel/PluginStartupResult:health';
