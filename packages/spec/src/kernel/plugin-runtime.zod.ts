// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Plugin Runtime Management Protocol
 * 
 * Defines the protocol for dynamic plugin loading, unloading, and discovery
 * at runtime. Addresses the "Dynamic Loading" gap in the microkernel architecture
 * by enabling plugins to be loaded and unloaded without restarting the kernel.
 * 
 * Inspired by:
 * - OSGi Dynamic Module System (bundle lifecycle)
 * - Kubernetes Operator pattern (reconciliation loop)
 *
 * This protocol enables:
 * - Runtime load/unload of plugins without kernel restart
 * - Plugin discovery from registries and local filesystem
 * - Safe unload with dependency awareness
 */

/**
 * Dynamic Plugin Operation Type
 * Operations that can be performed on plugins at runtime
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const DynamicPluginOperationSchema = lazySchema(() => z.enum([
  'load',        // Load and initialize a plugin at runtime
  'unload',      // Gracefully unload a running plugin
  'reload',      // Unload then load (e.g., version upgrade)
  'enable',      // Enable a loaded but disabled plugin
  'disable',     // Disable a running plugin without unloading
]).describe('Runtime plugin operation type'));

/**
 * Plugin Source
 * Where to resolve a plugin for dynamic loading
 */
export const PluginSourceSchema = lazySchema(() => z.object({
  /**
   * Source type
   */
  type: z.enum([
    'npm',            // npm registry package
    'local',          // Local filesystem path
    'url',            // Remote URL (tarball or module)
    'registry',       // ObjectStack plugin registry
    'git',            // Git repository
  ]).describe('Plugin source type'),
  
  /**
   * Source location (package name, path, URL, or git repo)
   */
  location: z.string().describe('Package name, file path, URL, or git repository'),
  
  /**
   * Version constraint (semver range)
   */
  version: z.string().optional().describe('Semver version range (e.g., "^1.0.0")'),
  
  /**
   * Integrity hash for verification
   */
  integrity: z.string().optional().describe('Subresource Integrity hash (e.g., "sha384-...")'),
}).describe('Plugin source location for dynamic resolution'));

/**
 * REMOVED — `ActivationEventSchema` / `ActivationEvent` (#4657, ADR-0049).
 *
 * The schema declared a lazy-activation trigger vocabulary (`onCommand`,
 * `onRoute`, …, `onView` after the #4653 convergence) that NO runtime in any
 * repo (objectstack / cloud / cloud-v1 / objectui) ever read: every plugin has
 * always activated immediately on load/registration — cloud-v1's own ROADMAP
 * recorded lazy activation as ❌ unimplemented. A published trigger vocabulary
 * with zero executors is the ADR-0049 false-compliance shape: an author (very
 * often an AI, ADR-0033) writes `activationEvents` expecting deferral and gets
 * eager activation with a clean parse.
 *
 * Both keys that embedded it are retired in the same change —
 * `DynamicLoadRequestSchema.activationEvents` (tombstoned below) and
 * `StudioPluginManifestSchema.activationEvents` (rejected by that schema's
 * strict parse with its own prescription) — which left the def an orphaned
 * value schema: an export with no consumer is read as a capability by whoever
 * finds it (#3950), so it goes with the keys rather than outliving them. Its
 * `json-schema.manifest.json` entries (`kernel/ActivationEvent`,
 * `studio/ActivationEvent`) and `authorable-surface.json` lines are dropped
 * deliberately in the same PR; the removal is pinned by
 * `activation-events-retirement.test.ts`.
 *
 * Lazy activation, if ever built, returns via the enforce route of ADR-0049:
 * write the executor first, then declare exactly the vocabulary it honours.
 */

const ACTIVATION_EVENTS_RETIRED =
  '`dynamicLoadRequest.activationEvents` was removed in @objectstack/spec 17.0.0 '
  + '(#4657, ADR-0049) — no runtime ever read it: every plugin activates immediately '
  + 'on load, so the declared lazy-activation window never existed. Delete the key; '
  + 'eager activation is the only behaviour there has ever been. Lazy activation, if '
  + 'built, returns via the enforce route of ADR-0049 with a vocabulary its executor '
  + 'actually honours.';

/**
 * Dynamic Load Request
 * Request to load a plugin at runtime
 */
export const DynamicLoadRequestSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier to load
   */
  pluginId: z.string().describe('Unique plugin identifier'),
  
  /**
   * Plugin source
   */
  source: PluginSourceSchema,

  /**
   * RETIRED (#4657, ADR-0049) — tombstoned, not deleted: this schema is not
   * `.strict()`, so a plain delete would have Zod silently STRIP the key and
   * replace one silent no-op with another (#2169 shape). The tombstone keeps
   * the removal audible in both channels: `tsc` (input type `never`) and the
   * parse (the prescription itself).
   */
  activationEvents: retiredKey(ACTIVATION_EVENTS_RETIRED),

  /**
   * Configuration overrides for the plugin
   */
  config: z.record(z.string(), z.unknown()).optional()
    .describe('Runtime configuration overrides'),
  
  /**
   * Loading priority (lower = higher priority)
   */
  priority: z.number().int().min(0).default(100)
    .describe('Loading priority (lower is higher)'),
  
  /**
   * Whether to enable sandboxing for this dynamically loaded plugin
   */
  sandbox: z.boolean().default(false)
    .describe('Run in an isolated sandbox'),
  
  /**
   * Timeout for the load operation in milliseconds
   */
  timeout: z.number().int().min(1000).default(60000)
    .describe('Maximum time to complete loading in ms'),
}).describe('Request to dynamically load a plugin at runtime'));

/**
 * Dynamic Unload Request
 * Request to unload a plugin at runtime
 */
export const DynamicUnloadRequestSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier to unload
   */
  pluginId: z.string().describe('Plugin to unload'),
  
  /**
   * Unload strategy
   */
  strategy: z.enum([
    'graceful',     // Wait for in-flight requests, then unload
    'forceful',     // Unload immediately, cancel pending work
    'drain',        // Stop accepting new work, finish existing, then unload
  ]).default('graceful').describe('How to handle in-flight work during unload'),
  
  /**
   * Timeout for the unload operation in milliseconds
   */
  timeout: z.number().int().min(1000).default(30000)
    .describe('Maximum time to complete unloading in ms'),
  
  /**
   * Whether to remove cached artifacts
   */
  cleanupCache: z.boolean().default(false)
    .describe('Remove cached code and assets after unload'),
  
  /**
   * Action for dependents: plugins that depend on this one
   */
  dependentAction: z.enum([
    'cascade',     // Also unload dependent plugins
    'warn',        // Warn about dependents but proceed
    'block',       // Block unload if dependents exist
  ]).default('block').describe('How to handle plugins that depend on this one'),
}).describe('Request to dynamically unload a plugin at runtime'));

/**
 * Dynamic Plugin Operation Result
 * Result of a dynamic load/unload/reload operation
 */
export const DynamicPluginResultSchema = lazySchema(() => z.object({
  /**
   * Whether the operation succeeded
   */
  success: z.boolean(),
  
  /**
   * The operation that was performed
   */
  operation: DynamicPluginOperationSchema,
  
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Operation duration in milliseconds
   */
  durationMs: z.number().int().min(0).optional(),
  
  /**
   * Resulting plugin version (for load/reload)
   */
  version: z.string().optional(),
  
  /**
   * Error details if operation failed
   */
  error: z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error message'),
    details: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  
  /**
   * Warnings (e.g., dependents affected)
   */
  warnings: z.array(z.string()).optional(),
}).describe('Result of a dynamic plugin operation'));

/**
 * REMOVED — the plugin DISCOVERY + DYNAMIC-LOADING config surface (#3896 follow-up).
 *
 * `DynamicLoadingConfigSchema`, `PluginDiscoveryConfigSchema` and
 * `PluginDiscoverySourceSchema` declared a plugin sandboxing / integrity /
 * source-allow-list / approval-before-load control set. None of it was ever
 * composed into a parent schema, exported from the package root, or read by any
 * runtime: the three schemas were an ISLAND, reachable only from their own
 * round-trip tests — yet still published into `json-schema/` and the authorable
 * key surface, where an author (very often an AI, ADR-0033) would read them as a
 * capability this platform has.
 *
 * That is the ADR-0049 false-compliance shape, and the precedent for a
 * SAFETY-shaped one is to REMOVE rather than mark dead: `tool.requiresConfirmation`
 * was pruned in #3715 for exactly this reason — "unenforced on every path, so it
 * was false compliance, not merely dead".
 *
 * No `retiredKey()` tombstones. A tombstone earns its keep by making the removal
 * audible at a parse the author actually reaches, and NOTHING parses these
 * schemas — a prescription nobody can receive is noise, and the silent-strip the
 * key-vanish guard protects against was already these keys' permanent condition,
 * not something this change introduces. The guard's baseline entries are dropped
 * deliberately in this PR instead; see the changeset.
 *
 * Rebuilding this surface is a design job, not a schema job: write the runtime
 * first, then declare only what it enforces.
 */

// Export types
export type DynamicPluginOperation = z.infer<typeof DynamicPluginOperationSchema>;
export type PluginSource = z.infer<typeof PluginSourceSchema>;
export type DynamicLoadRequest = z.infer<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequest = z.infer<typeof DynamicUnloadRequestSchema>;
export type DynamicPluginResult = z.infer<typeof DynamicPluginResultSchema>;

// Export input types for schemas with defaults
export type DynamicLoadRequestInput = z.input<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequestInput = z.input<typeof DynamicUnloadRequestSchema>;
