// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `StartupOptions.timeout` said
// "Maximum time in milliseconds to wait for each plugin to start" in prose and
// nothing else — while the very contract that consumes it,
// `IStartupOrchestrator.startWithTimeout(plugin, context, timeoutMs)`, already
// named its own parameter `timeoutMs`. One boundary, two spellings. Renamed to
// `timeoutMs`; the value and the 30000 default are unchanged. Tombstoned with
// `retiredKey()`. No D2 conversion: `StartupOptions` is the argument a host
// passes to `orchestrateStartup()` at boot, never a stack collection member or
// a stored row. See `kernel-startup-orchestrator-durations-unit-in-key`.
export const entry = 'kernel/StartupOptions:timeout';
