// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `HealthStatusSchema` (`healthy`, `checkedAt`, `details`, `message`)
// was the return vocabulary of `IStartupOrchestrator.checkHealth(plugin)` and
// the value of `PluginStartupResult.health`. Both carriers left in this same
// major, and no probe system was ever built behind either: the kernel does not
// check a plugin's health at startup, so nothing ever produced a HealthStatus.
// An exported health vocabulary with no producer reads as proof the platform
// health-checks plugins (#3950, ADR-0033). The `health` member of the surviving
// `PluginStartupResult` is tombstoned rather than dropped, because that def
// keeps emitting — see `18.kernel__PluginStartupResult__health.ts`. Route 3;
// the D3 semantic entry `startup-orchestrator-retired` carries the record.
export const entry = 'kernel/HealthStatus';
