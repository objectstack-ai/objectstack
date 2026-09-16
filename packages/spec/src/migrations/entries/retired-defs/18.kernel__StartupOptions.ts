// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `StartupOptionsSchema` (`timeoutMs`, `rollbackOnFailure`,
// `healthCheck`, `parallel`, `context`) left with the `IStartupOrchestrator`
// contract it was the argument of: it was only ever the `options` parameter of
// `orchestrateStartup(plugins, options)`, and nothing in any repository
// implemented or called that method. The kernel's own boot loop reads its
// timeout from `PluginMetadata.startupTimeout` and its rollback policy from
// `KernelConfig.rollbackOnFailure`, never from this object. `healthCheck` named
// a startup probe system that does not exist. Route 3 (no authored document
// carries the def, so no tombstone and no D2 conversion): this table plus the
// D3 semantic entry `startup-orchestrator-retired` ARE the declaration.
export const entry = 'kernel/StartupOptions';
