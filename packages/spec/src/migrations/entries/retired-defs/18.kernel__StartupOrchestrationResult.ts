// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `StartupOrchestrationResultSchema` (`results`, `totalDurationMs`,
// `allSuccessful`, `rolledBack`) was the aggregate `orchestrateStartup()`
// returned, and it left with that method: no implementation ever existed, so no
// aggregate was ever built. The kernel starts plugins one at a time and returns
// a `PluginStartupResult` per plugin; the per-plugin durations it does keep are
// reachable through `ObjectKernel.getPluginStartupDurations()`. Route 3; the D3
// semantic entry `startup-orchestrator-retired` carries the record.
export const entry = 'kernel/StartupOrchestrationResult';
