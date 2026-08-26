// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Advanced Plugin Lifecycle — host-driven library vocabularies
 *
 * Declares the INPUT contracts of the host-driven lifecycle classes exported
 * by `@objectstack/core` — `PluginHealthMonitor` (reads `PluginHealthCheck`,
 * emits `PluginHealthStatus` / `PluginHealthReport`) and `HotReloadManager`
 * (reads `HotReloadConfig`, snapshots via `PluginStateSnapshot`). The kernel
 * does not construct either class: a HOST composes them and passes these
 * shapes directly (`content/docs/protocol/kernel/lifecycle.mdx`, the #11811
 * examples, is the supported usage).
 *
 * This module deliberately declares NO authorable configuration surface — see
 * the #11825 retirement record below.
 */

/**
 * Plugin Health Status
 * Represents the current operational state of a plugin
 */
import { lazySchema } from '../shared/lazy-schema';
export const PluginHealthStatusSchema = lazySchema(() => z.enum([
  'healthy',      // Plugin is operating normally
  'degraded',     // Plugin is operational but with reduced functionality
  'unhealthy',    // Plugin has critical issues but still running
  'failed',       // Plugin has failed and is not operational
  'recovering',   // Plugin is in recovery process
  'unknown',      // Health status cannot be determined
]).describe('Current health status of the plugin'));

/**
 * Plugin Health Check Configuration
 * Defines how to check plugin health
 */
export const PluginHealthCheckSchema = lazySchema(() => z.object({
  /**
   * Health check interval in milliseconds
   */
  interval: z.number().int().min(1000).default(30000)
    .describe('How often to perform health checks (default: 30s)'),
  
  /**
   * Timeout for health check in milliseconds
   */
  timeout: z.number().int().min(100).default(5000)
    .describe('Maximum time to wait for health check response'),
  
  /**
   * Number of consecutive failures before marking as unhealthy
   */
  failureThreshold: z.number().int().min(1).default(3)
    .describe('Consecutive failures needed to mark unhealthy'),
  
  /**
   * Number of consecutive successes to recover from unhealthy state
   */
  successThreshold: z.number().int().min(1).default(1)
    .describe('Consecutive successes needed to mark healthy'),
  
  /**
   * Custom health check function name or endpoint
   */
  checkMethod: z.string().optional()
    .describe('Method name to call for health check'),
  
  /**
   * Enable automatic restart on failure
   */
  autoRestart: z.boolean().default(false)
    .describe('Automatically restart plugin on health check failure'),
  
  /**
   * Maximum number of restart attempts
   */
  maxRestartAttempts: z.number().int().min(0).default(3)
    .describe('Maximum restart attempts before giving up'),
  
  /**
   * Backoff strategy for restarts
   */
  restartBackoff: z.enum(['fixed', 'linear', 'exponential']).default('exponential')
    .describe('Backoff strategy for restart delays'),
}));

/**
 * Plugin Health Report
 * Detailed health information from a plugin
 */
export const PluginHealthReportSchema = lazySchema(() => z.object({
  /**
   * Overall health status
   */
  status: PluginHealthStatusSchema,
  
  /**
   * Timestamp of the health check
   */
  timestamp: z.string().datetime(),
  
  /**
   * Human-readable message about health status
   */
  message: z.string().optional(),
  
  /**
   * Detailed metrics
   */
  metrics: z.object({
    uptime: z.number().describe('Plugin uptime in milliseconds'),
    memoryUsage: z.number().optional().describe('Memory usage in bytes'),
    cpuUsage: z.number().optional().describe('CPU usage percentage'),
    activeConnections: z.number().optional().describe('Number of active connections'),
    errorRate: z.number().optional().describe('Error rate (errors per minute)'),
    responseTime: z.number().optional().describe('Average response time in ms'),
  }).partial().optional(),
  
  /**
   * List of checks performed
   */
  checks: z.array(z.object({
    name: z.string().describe('Check name'),
    status: z.enum(['passed', 'failed', 'warning']),
    message: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  
  /**
   * Dependencies health
   */
  dependencies: z.array(z.object({
    pluginId: z.string(),
    status: PluginHealthStatusSchema,
    message: z.string().optional(),
  })).optional(),
}));


/**
 * Prescription for the two `stateStrategy` values retired in 18 (#12340).
 *
 * Deliberately carries NO `os migrate meta --from 17` sentence. That command
 * replays the conversion chain over authored METADATA SOURCES, and
 * `HotReloadConfig` is not an authorable surface — it is a library parameter a
 * host passes to `HotReloadManager` in TypeScript (the #4914 / #11825 keep).
 * No authored document has ever been able to carry `stateStrategy`, so naming
 * the command here would promise an affordance that cannot apply — the same
 * false-promise defect ADR-0049 exists to prevent. The migrate-sentence pin
 * judges only prescriptions that DO name the command, so its absence is in
 * scope by construction, not by exemption.
 */
const HOT_RELOAD_STATE_STRATEGY_RETIRED =
  "`HotReloadConfig.stateStrategy: 'disk'` and `HotReloadConfig.stateStrategy: "
  + "'distributed'` were removed in @objectstack/spec 18 (#12340, ADR-0049 "
  + 'enforce-or-remove) — neither was ever implemented. Both switch arms in '
  + "`PluginStateManager.saveState` wrote to the SAME in-memory Map as 'memory' "
  + "(the in-source comments said 'memory fallback'), and the only trace was a "
  + 'debug-level log line, so a host that asked for disk or cluster-replicated '
  + 'state got process-local memory and no error — state that does not survive '
  + "the restart it was configured to survive. Use 'memory' if in-process "
  + "state preservation across a reload is what you want, or 'none' to disable "
  + 'it; there is no in-tree replacement for durable or distributed plugin '
  + 'state. Persist it in the host instead — the host owns the process '
  + 'lifetime these strategies pretended to outlive. Real disk or distributed '
  + 'persistence returns only via the ENFORCE route of ADR-0049: the '
  + 'implementation first, the declaration with it.';

/**
 * Hot Reload Configuration
 * Controls how plugins handle live updates
 */
export const HotReloadConfigSchema = lazySchema(() => z.object({
  /**
   * Enable hot reload capability
   */
  enabled: z.boolean().default(false),
  
  /**
   * Watch file patterns for auto-reload
   */
  watchPatterns: z.array(z.string()).optional()
    .describe('Glob patterns to watch for changes'),
  
  /**
   * Debounce delay before reloading (milliseconds)
   */
  debounceDelay: z.number().int().min(0).default(1000)
    .describe('Wait time after change detection before reload'),
  
  /**
   * Preserve plugin state during reload
   */
  preserveState: z.boolean().default(true)
    .describe('Keep plugin state across reloads'),
  
  /**
   * State serialization strategy.
   *
   * `'disk'` and `'distributed'` were REMOVED in 18 (#12340) — see
   * `HOT_RELOAD_STATE_STRATEGY_RETIRED` above. Only the two values
   * `PluginStateManager` actually implements are declarable.
   */
  stateStrategy: z.enum(['memory', 'none'], {
    // Only the two values that USED to be legal get the retirement
    // prescription; every other input keeps zod's own enum message, which
    // already lists the legal tokens. (`HookBodyCapability`'s `crypto.hash`
    // is the model, itself following `object.managedBy: 'system'`.)
    error: (issue) =>
      issue.input === 'disk' || issue.input === 'distributed'
        ? HOT_RELOAD_STATE_STRATEGY_RETIRED
        : undefined,
  }).default('memory')
    .describe('How to preserve state during reload'),
  
  /**
   * Graceful shutdown timeout
   */
  shutdownTimeout: z.number().int().min(0).default(30000)
    .describe('Maximum time to wait for graceful shutdown'),
  
  /**
   * Pre-reload hooks
   */
  beforeReload: z.array(z.string()).optional()
    .describe('Hook names to call before reload'),
  
  /**
   * Post-reload hooks
   */
  afterReload: z.array(z.string()).optional()
    .describe('Hook names to call after reload'),
}));

// ─── [#11825] The authorable lifecycle-config surface is RETIRED ────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-08-25 (route 2). This
// module used to end in `AdvancedPluginLifecycleConfigSchema` — an aggregating
// `{ health, hotReload, degradation, updates, resources, observability }`
// config container — plus the `GracefulDegradationSchema` and
// `PluginUpdateStrategySchema` value schemas two of its keys carried. All
// three defs are REMOVED.
//
// Why: none of it had a runtime reader, re-measured per group at the
// retirement's base commit with positive controls. The kernel never parses,
// stores or forwards the container; no manifest, stack collection or
// metadata-type binding ever embedded it (so no authored document could carry
// it); and a scan of objectstack + objectui put every reference inside
// `packages/spec` itself — the declaration, its own unit test and the
// generated artifacts. Group by group:
//
// - `health` — `PluginHealthMonitor` reads `PluginHealthCheck` (control:
//   `checkMethod`, `core/src/health-monitor.ts`), but no runtime constructs
//   the monitor; only its unit test and `core/examples/phase2-integration.ts`
//   do, and both pass the config DIRECTLY to the class, never through this
//   container.
// - `hotReload` — same shape: `HotReloadManager` reads `HotReloadConfig`
//   (control: `debounceDelay` / `stateStrategy`, `core/src/hot-reload.ts`),
//   and nothing composes the manager at runtime either.
// - `degradation` / `updates` — zero readers of any key, anywhere: no
//   implementation body even exists for `fallbackMode`, `criticalDependencies`,
//   `autoUpdateConstraints`, `rollback` et al. An author declaring a rollback
//   policy or a degraded-mode contract got a clean parse and NOTHING — the
//   #3950 shape (an exported schema with no consumer reads as a capability),
//   sharpened by the vocabulary promising production-safety behaviour.
// - `resources` / `observability` — inline sub-objects of the container with
//   zero readers (`maxMemory` / `maxCpu` here were never the
//   plugin-security-advanced `resourceLimits` that `sandbox-runtime.ts` DOES
//   read); they leave with it.
//
// What SURVIVES, deliberately: the input vocabularies of the host-driven
// library classes the ruling keeps — `PluginHealthStatus` / `PluginHealthCheck`
// / `PluginHealthReport`, `HotReloadConfig` and `PluginStateSnapshot`. They are library
// parameter types, not an authorable config surface: a host constructs the
// classes and passes these shapes in TypeScript, which is exactly what the
// #4914 ruling kept `HotReloadConfigSchema` for.
//
// ── [#12340] AMENDED 2026-08-26: the kept library keeps only what it honours ─
//
// The keep above is INTACT — `HotReloadConfigSchema` and `HotReloadManager`
// stay. What left is the part of the kept vocabulary that was itself
// declared-but-unenforced, measured at cdbd9204b6 with a firing positive
// control (`stateStrategy` resolves to real readers in
// `core/src/hot-reload.ts`; `distributedConfig` resolves to nothing outside
// `packages/spec` in objectstack, and to nothing in objectui):
//
//   - `stateStrategy` narrowed ['memory','disk','distributed','none'] ->
//     ['memory','none']. The 'disk' and 'distributed' arms of
//     `PluginStateManager.saveState` both wrote to the in-memory Map and said
//     so only at debug level. An enum-VALUE narrowing is invisible to the four
//     ratchets (the def still emits), so the prescription hangs on the enum's
//     own `error` map — `HOT_RELOAD_STATE_STRATEGY_RETIRED`, dispatched by
//     `issue.input`.
//   - `DistributedStateConfigSchema` / `distributedConfig` REMOVED. Zero
//     readers anywhere: an author could name a Redis endpoint and a TTL and
//     nothing ever opened a connection. It was the orphan value schema of the
//     one key that referenced it, and its documented trigger ("required when
//     stateStrategy is \"distributed\"") names a value that no longer exists —
//     so it could not honestly outlive the narrowing. A whole def leaving MUST
//     move the ratchets; that movement is the route's own evidence.
//
// The 2026-08-25 keep listed `DistributedStateConfig` among the survivors, so
// this card REVERSES a named line of that ruling on new evidence (that ruling
// measured the CONTAINER's groups, never this key's own readers). The pin in
// `plugin-lifecycle-advanced-retirement.test.ts` moves with it, deliberately
// and in the same commit — never as a quiet edit to make a red pin green.
//
// Route 3 (no tombstone, no conversion): with no carrier key and no authored
// document there is nothing to tombstone and no seam for a D2 conversion —
// `RETIRED_DEFS_BY_MAJOR[18]` (`kernel/AdvancedPluginLifecycleConfig`,
// `kernel/GracefulDegradation`, `kernel/PluginUpdateStrategy`) plus the D3
// semantic entry `advanced-plugin-lifecycle-config-retired` ARE the
// declaration. Degradation / update-strategy vocabularies return only via the
// ENFORCE route of ADR-0049 through a new ADR: the implementation first, then
// a declaration of exactly what it honours.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Plugin State Snapshot
 * Captures plugin state for preservation during updates/reloads
 */
export const PluginStateSnapshotSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Version at time of snapshot
   */
  version: z.string(),
  
  /**
   * Snapshot timestamp
   */
  timestamp: z.string().datetime(),
  
  /**
   * Serialized state data
   */
  state: z.record(z.string(), z.unknown()),
  
  /**
   * State metadata
   */
  metadata: z.object({
    checksum: z.string().optional().describe('State checksum for verification'),
    compressed: z.boolean().default(false),
    encryption: z.string().optional().describe('Encryption algorithm if encrypted'),
  }).optional(),
}));

// Export types
export type PluginHealthStatus = z.input<typeof PluginHealthStatusSchema>;
export type PluginHealthCheck = z.input<typeof PluginHealthCheckSchema>;
/** Post-parse shape of {@link PluginHealthCheck} — defaults applied, transforms run (ADR-0122). */
export type PluginHealthCheckParsed = z.infer<typeof PluginHealthCheckSchema>;
export type PluginHealthReport = z.input<typeof PluginHealthReportSchema>;
export type HotReloadConfig = z.input<typeof HotReloadConfigSchema>;
/** Post-parse shape of {@link HotReloadConfig} — defaults applied, transforms run (ADR-0122). */
export type HotReloadConfigParsed = z.infer<typeof HotReloadConfigSchema>;
export type PluginStateSnapshot = z.input<typeof PluginStateSnapshotSchema>;
/** Post-parse shape of {@link PluginStateSnapshot} — defaults applied, transforms run (ADR-0122). */
export type PluginStateSnapshotParsed = z.infer<typeof PluginStateSnapshotSchema>;
