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
import { retiredKey } from '../shared/retired-key';
export const PluginHealthStatusSchema = lazySchema(() => z.enum([
  'healthy',      // Plugin is operating normally
  'degraded',     // Plugin is operational but with reduced functionality
  'unhealthy',    // Plugin has critical issues but still running
  'failed',       // Plugin has failed and is not operational
  'recovering',   // Plugin is in recovery process
  'unknown',      // Health status cannot be determined
]).describe('Current health status of the plugin'));

/**
 * Prescriptions for the three restart keys retired in 18 (#12032).
 *
 * Deliberately carry NO `os migrate meta --from 17` sentence, for exactly the
 * reason `HOT_RELOAD_STATE_STRATEGY_RETIRED` and
 * `HOT_RELOAD_WATCH_PATTERNS_RETIRED` below do not: that command replays the
 * conversion chain over authored METADATA SOURCES, and `PluginHealthCheck` is
 * not an authorable surface — it is a library parameter a host passes to
 * `PluginHealthMonitor` in TypeScript (the #4914 / #11825 keep). No authored
 * document has ever been able to carry these keys, so naming the command would
 * promise an affordance that cannot apply, which is the same false-promise
 * defect ADR-0049 exists to prevent. The migrate-sentence pin judges only
 * prescriptions that DO name the command, so this absence is in scope by
 * construction rather than by exemption.
 *
 * The three retire together because two of them are the VOCABULARY OF the
 * first: with no restart, "maximum restart attempts" and "backoff strategy for
 * restart delays" have nothing left to be the vocabulary of — the same reason
 * `distributedConfig` could not honestly outlive the `stateStrategy` value it
 * was documented as being required for (#12340).
 */
const RESTART_NOT_IMPLEMENTED =
  'A `PluginHealthMonitor` never restarted anything. `attemptRestart` called '
  + "`plugin.destroy()` and stopped there — the in-source comment said \"Call "
  + 'destroy and init to restart", but `init` appeared in `health-monitor.ts` '
  + 'ONLY inside that comment. What a plugin actually got was: destroy, a log '
  + "line reading 'Plugin restarted', status `recovering`, and periodic health "
  + 'checks continuing against the destroyed instance — which the default '
  + "check (`{ name: 'plugin-loaded', status: 'passed' }`, used whenever no "
  + '`checkMethod` resolves) passes forever, so the terminal report on a '
  + 'destroyed, never-re-initialised plugin was `healthy`.';

/** What a host does instead. Names only affordances that exist. */
const RESTART_REPLACEMENT =
  'Restarting a plugin is the HOST\'s job in this host-driven library, and '
  + 'the monitor could not do it even in principle: `Plugin.init(ctx)` needs a '
  + '`PluginContext`, which only the kernel constructs and which it exposes to '
  + 'nobody (`ObjectKernel.context` is private; `KernelBase.createContext` is '
  + 'protected). Poll `getHealthStatus(pluginName)` / '
  + '`getHealthReport(pluginName)` and act on `unhealthy` / `failed` at the '
  + 'level that owns the plugin\'s lifetime — recreate the kernel, or let your '
  + 'supervisor restart the process. The monitor reports; it does not act.';

const AUTO_RESTART_RETIRED =
  '`PluginHealthCheck.autoRestart` was removed in @objectstack/spec 18 '
  + '(ADR-0049 enforce-or-remove) — it never restarted a plugin. '
  + RESTART_NOT_IMPLEMENTED
  + ' Delete the key. ' + RESTART_REPLACEMENT;

const MAX_RESTART_ATTEMPTS_RETIRED =
  '`PluginHealthCheck.maxRestartAttempts` was removed in @objectstack/spec 18 '
  + '(ADR-0049 enforce-or-remove) — it capped a restart that never '
  + 'happened. ' + RESTART_NOT_IMPLEMENTED
  + ' The cap counted destroy calls, so raising it only scheduled further '
  + '"restarts" of a plugin that was never brought back up. Delete the key. '
  + RESTART_REPLACEMENT;

const RESTART_BACKOFF_RETIRED =
  '`PluginHealthCheck.restartBackoff` was removed in @objectstack/spec 18 '
  + '(ADR-0049 enforce-or-remove) — it delayed a restart that never '
  + 'happened. ' + RESTART_NOT_IMPLEMENTED
  + ' The chosen strategy only moved when the destroy landed. Delete the key. '
  + RESTART_REPLACEMENT;

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
   * REMOVED in 18 (#12032) — tombstoned, not deleted.
   *
   * This object is not `.strict()`, so a bare deletion would be a SILENT
   * STRIP (#3733, ADR-0104): a clean parse and a setting that never takes
   * effect — which is a milder version of the very defect being retired.
   * The tombstone makes the removal audible on both channels: `tsc` types
   * the key `never`, and a value that reaches the parse raises the
   * prescription itself rather than a generic unrecognised-key error.
   */
  autoRestart: retiredKey(AUTO_RESTART_RETIRED),

  /**
   * REMOVED in 18 (#12032) — the cap on a restart that never happened.
   */
  maxRestartAttempts: retiredKey(MAX_RESTART_ATTEMPTS_RETIRED),

  /**
   * REMOVED in 18 (#12032) — the delay before a restart that never happened.
   */
  restartBackoff: retiredKey(RESTART_BACKOFF_RETIRED),
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
 * Prescription for the watch-placeholder key retired in 18 (#12428).
 *
 * Carries NO `os migrate meta --from 17` sentence, for exactly the reason
 * `HOT_RELOAD_STATE_STRATEGY_RETIRED` above does not: that command replays the
 * conversion chain over authored METADATA SOURCES, and `HotReloadConfig` is
 * not an authorable surface — it is a library parameter a host passes to
 * `HotReloadManager` in TypeScript (the #4914 / #11825 keep). No authored
 * document has ever been able to carry `watchPatterns`, so naming the command
 * would promise an affordance that cannot apply, which is the same
 * false-promise defect ADR-0049 exists to prevent. The migrate-sentence pin
 * judges only prescriptions that DO name the command, so this absence is in
 * scope by construction rather than by exemption.
 */
const HOT_RELOAD_WATCH_PATTERNS_RETIRED =
  '`HotReloadConfig.watchPatterns` was removed in @objectstack/spec 18 '
  + '(ADR-0049 enforce-or-remove) — nothing ever read it. Its only two '
  + 'uses were log lines in `HotReloadManager`, and one of them announced '
  + "'File watching started' at INFO level while no watcher was ever "
  + 'constructed: `startWatching` held a placeholder, and `watchHandles` was '
  + 'read, deleted, iterated and cleared but never set. So an author could '
  + 'declare a glob and no file change could ever trigger a reload. Delete the '
  + 'key. File watching is the HOST\'s job in this host-driven library: run '
  + 'your own watcher, declare your globs wherever that watcher reads them, '
  + 'and call `HotReloadManager.scheduleReload(pluginName, reloadFn)` when one '
  + 'matches — the debounced integration point this class does implement, and '
  + 'which is unchanged.';

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
   * REMOVED in 18 (#12428) — tombstoned, not deleted.
   *
   * This object is not `.strict()`, so a bare deletion would be a SILENT
   * STRIP (#3733, ADR-0104): a clean parse and a setting that never takes
   * effect — which is the very defect being retired, one layer down. The
   * tombstone makes the removal audible on both channels: `tsc` types the
   * key `never`, and a value that reaches the parse raises the
   * prescription itself rather than a generic unrecognised-key error.
   */
  watchPatterns: retiredKey(HOT_RELOAD_WATCH_PATTERNS_RETIRED),

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
// ── [#12428] AMENDED 2026-08-26: the placeholder that reported success ──────
//
// The keep is STILL intact — `HotReloadConfigSchema` and `HotReloadManager`
// stay. `watchPatterns` is REMOVED, on the same per-key test #12340 applied to
// `distributedConfig` and measured the same way (positive control fired:
// `reloadTimers.set` resolves a real writer in `core/src/hot-reload.ts`, so
// the scan sees writers; `watchHandles.set` resolves nothing anywhere).
//
// What was measured: `HotReloadManager.startWatching` contained NO watcher —
// a guard plus `logger.info('File watching started', { patterns })` over an
// in-source note saying real watching "would require chokidar or similar".
// `watchHandles` was only ever read, deleted, iterated and cleared and NEVER
// set, so `stopWatching`'s cleanup branch and the teardown loop over its keys
// were structurally UNREACHABLE, not merely untaken. So `watchPatterns` had
// no reader that ACTED on it: an author could declare a glob and no file
// change could ever trigger a reload.
//
// Worse than #12340's silence, in one specific way: that fallback at least
// announced itself at DEBUG. This one said "File watching started" at INFO —
// positive confirmation of a capability that did not exist, which an operator
// (or an AI author, ADR-0033) reads as proof and stops looking.
//
// Why REMOVE and not the other two ADR-0049 states: ENFORCE would build for a
// caller that does not exist (no runtime composes `HotReloadManager`; only
// its own unit test and `core/examples/phase2-integration.ts` construct it) —
// the same fact that decided #12340's route. EXPERIMENTAL requires a
// roadmap, and a scan of every planning doc found zero mentions of hot-reload
// file watching against 145 control hits in the same files. Real watching
// already lives where it is implemented: `chokidar` is a dependency of
// `@objectstack/metadata`, `@objectstack/metadata-fs` and `@objectstack/cli`,
// never of `@objectstack/core`.
//
// Route: TOMBSTONE, not #12340's route 3, and the build is what decided it.
// The plain deletion was tried first and `gen:schema` gate (a) refused it —
// 'authorable key(s) disappeared from the contract' — because this object is
// not `.strict()` and a bare deletion is a SILENT STRIP (#3733, ADR-0104).
// #12340 could take route 3 because what left there was a whole DEF; a key
// leaving a SURVIVING def has no such exit. So `watchPatterns` is
// `retiredKey()`-tombstoned and registered by exact key in
// RETIRED_KEYS_BY_MAJOR[18], its surface line carrying `[RETIRED]` rather
// than disappearing. A key tombstone on a surviving def moves
// `authorable-surface` only — the def still emits, so `api-surface` and
// `json-schema.manifest` do not.
//
// The tombstone answers the parse; the registration-time refusal in
// `HotReloadManager` answers the audience that does NOT parse — a host
// handing the object straight to the class, which is every host there is,
// since nothing in the tree parses `HotReloadConfigSchema` outside its own
// unit test. The D3 semantic entry
// `hot-reload-watch-placeholder-retired` records the reasoning.
//
// Route 3 (no tombstone, no conversion): with no carrier key and no authored
// document there is nothing to tombstone and no seam for a D2 conversion —
// `RETIRED_DEFS_BY_MAJOR[18]` (`kernel/AdvancedPluginLifecycleConfig`,
// `kernel/GracefulDegradation`, `kernel/PluginUpdateStrategy`) plus the D3
// semantic entry `advanced-plugin-lifecycle-config-retired` ARE the
// declaration. Degradation / update-strategy vocabularies return only via the
// ENFORCE route of ADR-0049 through a new ADR: the implementation first, then
// a declaration of exactly what it honours.
//
// ── [#12032] AMENDED 2026-08-26: the restart that was only a destroy ────────
//
// The keep is STILL intact — `PluginHealthCheckSchema` and
// `PluginHealthMonitor` stay. `autoRestart`, `maxRestartAttempts` and
// `restartBackoff` are REMOVED, on the same per-key test #12340 and #12428
// applied one file over, and for the sharper reason: this key HAD a reader
// that acted, and what it did was not what the key declared.
//
// What was measured, at ee3595cefd:
//
//   `attemptRestart` called `plugin.destroy()` and stopped. The comment above
//   the call read "Call destroy and init to restart"; `init` appeared in
//   `health-monitor.ts` ONLY inside that comment. The sequence a plugin got
//   was destroy -> `logger.info('Plugin restarted')` -> status `recovering`
//   -> periodic checks continuing against the destroyed instance. The default
//   check when no `checkMethod` resolves is
//   `{ name: 'plugin-loaded', status: 'passed' }`, which a destroyed plugin
//   passes indefinitely, so the TERMINAL report was `healthy`. Reproduced
//   before anything was changed, with `successThreshold: 3`:
//
//     round 1 (failing): status=failed     destroyed=0 alive=true
//     after backoff:     status=recovering destroyed=1 alive=false
//     recovery round 1:  status=recovering destroyed=1 alive=false
//     recovery round 2:  status=recovering destroyed=1 alive=false
//     recovery round 3:  status=healthy    destroyed=1 alive=false
//
//   #11955 made that worse rather than better: reaching `healthy` now costs
//   `successThreshold` CONSECUTIVE passing rounds, so the false report is more
//   convincing, not less.
//
// Why REMOVE and not the other two ADR-0049 states. ENFORCE would have to
// BUILD the restart, and the class cannot host one: `Plugin.init(ctx)` needs a
// `PluginContext`, and the only two `plugin.init(...)` call sites in the tree
// are the kernel's own boot loops (`kernel-base.ts:202`, `kernel.ts:607`),
// both over the full plugin list with a context that is `private` on
// `ObjectKernel` and `protected` on `KernelBase` — no host can obtain one
// (positive control: the same scan resolves five real non-test
// `plugin.destroy()` call sites, so it sees lifecycle drivers). Building a
// per-plugin re-init API plus a host callback for a caller that does not exist
// is exactly the speculation ADR-0049's staged decision names as the wrong
// default at this milestone. EXPERIMENTAL requires a roadmap, and a scan of
// the whole `docs/` planning + ADR corpus returned ZERO mentions of plugin
// auto-restart against 118 control hits for "health" and 13 for "hot reload"
// in the same corpus.
//
// The other two keys leave with it, not as a tidy-up: with no restart,
// "Maximum restart attempts before giving up" and "Backoff strategy for
// restart delays" have nothing left to be the vocabulary OF — the same test
// that took `distributedConfig` out with the `stateStrategy` value it was
// documented as being required for (#12340).
//
// Route: TOMBSTONE, for #12428's reason — a key leaving a SURVIVING def has
// no route-3 exit, and this object is not `.strict()`, so a bare deletion is
// a silent strip. All three are registered by exact key in
// RETIRED_KEYS_BY_MAJOR[18]; their surface lines carry `[RETIRED]` rather
// than disappearing, and the def still emits, so `api-surface` and
// `json-schema.manifest` do not move. The tombstone answers the parse; the
// registration-time refusal in `PluginHealthMonitor.registerPlugin` answers
// the audience that does NOT parse — a host handing the object straight to
// the class, which is every host there is. The D3 semantic entry
// `plugin-auto-restart-never-reinitialised` records the reasoning.
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
