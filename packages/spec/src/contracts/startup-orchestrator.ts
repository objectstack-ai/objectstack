// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// [#4538] The startup-result data shape is the kernel domain's zod-derived type
// — one declaration per name (#4446), re-exported here so the contract surface
// and the schema surface can never drift.
//
// ── [#16059] The orchestrator contract itself is RETIRED ────────────────────
//
// `IStartupOrchestrator` — `orchestrateStartup(plugins, options)`, `rollback`,
// `checkHealth`, `startWithTimeout` — is removed under ADR-0049
// enforce-or-remove (maintainer ruling, director seat decision batch #60,
// 2026-09-06). Nothing in any repository implemented it and nothing called it:
// plugin startup is the kernel's own boot loop (`ObjectKernel.start()` →
// `startPluginWithTimeout()`), which races each plugin's `start()` against its
// `startupTimeout`, rolls back on failure, and never consults a health probe —
// there is no probe system for `checkHealth` to be the interface of. The three
// data schemas the interface tied together (`StartupOptions`, `HealthStatus`,
// `StartupOrchestrationResult`) leave with it; the full record, the measurement
// and the route live in the retirement block in
// `../kernel/startup-orchestrator.zod.ts`.
//
// What survives is the one shape the kernel really produces, still re-exported
// here so a consumer that imports its contracts from `@objectstack/spec/contracts`
// keeps the name it already had.
export type { PluginStartupResult } from '../kernel/startup-orchestrator.zod';
