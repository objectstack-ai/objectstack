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
 * Distributed State Configuration
 * Configuration for distributed state management in cluster environments
 */
export const DistributedStateConfigSchema = lazySchema(() => z.object({
  /**
   * Distributed cache provider
   */
  provider: z.enum(['redis', 'etcd', 'custom'])
    .describe('Distributed state backend provider'),
  
  /**
   * Connection URL or endpoints
   */
  endpoints: z.array(z.string()).optional()
    .describe('Backend connection endpoints'),
  
  /**
   * Key prefix for namespacing
   */
  keyPrefix: z.string().optional()
    .describe('Prefix for all keys (e.g., "plugin:my-plugin:")'),
  
  /**
   * Time to live in seconds
   */
  ttl: z.number().int().min(0).optional()
    .describe('State expiration time in seconds'),
  
  /**
   * Authentication configuration
   */
  auth: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    certificate: z.string().optional(),
  }).optional(),
  
  /**
   * Replication settings
   */
  replication: z.object({
    enabled: z.boolean().default(true),
    minReplicas: z.number().int().min(1).default(1),
  }).optional(),
  
  /**
   * Custom provider configuration
   */
  customConfig: z.record(z.string(), z.unknown()).optional()
    .describe('Provider-specific configuration'),
}));

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
   * State serialization strategy
   */
  stateStrategy: z.enum(['memory', 'disk', 'distributed', 'none']).default('memory')
    .describe('How to preserve state during reload'),
  
  /**
   * Distributed state configuration (required when stateStrategy is "distributed")
   */
  distributedConfig: DistributedStateConfigSchema.optional()
    .describe('Configuration for distributed state management'),
  
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
// / `PluginHealthReport`, `HotReloadConfig` (with its embedded
// `DistributedStateConfig`) and `PluginStateSnapshot`. They are library
// parameter types, not an authorable config surface: a host constructs the
// classes and passes these shapes in TypeScript, which is exactly what the
// #4914 ruling kept `HotReloadConfigSchema` for.
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
export type DistributedStateConfig = z.input<typeof DistributedStateConfigSchema>;
/** Post-parse shape of {@link DistributedStateConfig} — defaults applied, transforms run (ADR-0122). */
export type DistributedStateConfigParsed = z.infer<typeof DistributedStateConfigSchema>;
export type HotReloadConfig = z.input<typeof HotReloadConfigSchema>;
/** Post-parse shape of {@link HotReloadConfig} — defaults applied, transforms run (ADR-0122). */
export type HotReloadConfigParsed = z.infer<typeof HotReloadConfigSchema>;
export type PluginStateSnapshot = z.input<typeof PluginStateSnapshotSchema>;
/** Post-parse shape of {@link PluginStateSnapshot} — defaults applied, transforms run (ADR-0122). */
export type PluginStateSnapshotParsed = z.infer<typeof PluginStateSnapshotSchema>;
