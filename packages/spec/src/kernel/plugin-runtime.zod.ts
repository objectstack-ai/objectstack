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
 * - VS Code Extension Host (activation events)
 * 
 * This protocol enables:
 * - Runtime load/unload of plugins without kernel restart
 * - Plugin discovery from registries and local filesystem
 * - Activation events (load plugin only when needed)
 * - Safe unload with dependency awareness
 */

/**
 * Dynamic Plugin Operation Type
 * Operations that can be performed on plugins at runtime
 */
import { lazySchema } from '../shared/lazy-schema';
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
 * Activation Event
 * Defines when a dynamically available plugin should be activated.
 * Plugins remain dormant until an activation event fires.
 *
 * [#4653] **This is the platform's single activation vocabulary.** Until v17
 * the name `ActivationEventSchema` resolved to two DIFFERENT declarations
 * depending on the import path (#4411's trap): this structured
 * `{ type, pattern }` on `./kernel`, and a bare `z.string()` on `./studio`.
 * A studio plugin author wrote `activationEvents: ['onMetadataType:flow']` and
 * got no validation at all — `z.string()` accepts `'onMetadatType:flow'`, and
 * every other typo, forever. `./studio` now re-exports THIS declaration, so
 * there is one trigger vocabulary and one place to extend it.
 *
 * The enum below is the **union of both sides' pre-v17 vocabularies**, because
 * dropping either side's values would have silently removed a capability its
 * authors were already using:
 *
 * | value            | came from                                                  |
 * |:-----------------|:-----------------------------------------------------------|
 * | `onCommand`      | kernel enum + studio docs (`onCommand:myPlugin.doSomething`) |
 * | `onRoute`        | kernel enum                                                 |
 * | `onObject`       | kernel enum                                                 |
 * | `onEvent`        | kernel enum                                                 |
 * | `onService`      | kernel enum                                                 |
 * | `onSchedule`     | kernel enum                                                 |
 * | `onStartup`      | kernel enum; also the target of studio's eager `'*'`         |
 * | `onMetadataType` | studio docs/tests (`onMetadataType:object`) — kernel lacked it |
 * | `onView`         | studio docs/tests (`onView:myPlugin.myPanel`) — kernel lacked it |
 *
 * Deliberately NOT adopted: `priority`, and the `onInstall` / `onWebhook`
 * values that cloud-v1's unreleased marketplace runtime carries. Nothing in
 * any repo reads them, and adding an unenforced key is the exact debt ADR-0049
 * is retiring — they can be proposed when there is an executor that honours
 * them.
 */
export const ActivationEventSchema = lazySchema(() => z.object({
  /**
   * Event type
   */
  type: z.enum([
    'onCommand',         // Activate when a specific command is executed
    'onRoute',           // Activate when a URL route is matched
    'onObject',          // Activate when a specific object type is accessed
    'onEvent',           // Activate when a system event fires
    'onService',         // Activate when a service is requested
    'onSchedule',        // Activate on a cron schedule
    'onStartup',         // Activate immediately on startup (eager)
    'onMetadataType',    // Activate when a metadata type is loaded
    'onView',            // Activate when a view / panel is opened
  ]).describe('Trigger type for lazy activation'),

  /**
   * Pattern to match (command name, route glob, object name, event pattern, etc.)
   *
   * The pre-v17 studio string form packed this into the same token after a
   * colon — `'onCommand:myPlugin.doSomething'` is `{ type: 'onCommand',
   * pattern: 'myPlugin.doSomething' }`, and eager `'*'` is
   * `{ type: 'onStartup', pattern: '*' }`.
   */
  pattern: z.string().describe('Match pattern for the activation trigger'),
}).describe('Lazy activation trigger for a dynamic plugin'));

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
   * Activation events (if omitted, plugin activates immediately)
   */
  activationEvents: z.array(ActivationEventSchema).optional()
    .describe('Lazy activation triggers; if omitted plugin starts immediately'),
  
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
export type ActivationEvent = z.infer<typeof ActivationEventSchema>;
export type DynamicLoadRequest = z.infer<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequest = z.infer<typeof DynamicUnloadRequestSchema>;
export type DynamicPluginResult = z.infer<typeof DynamicPluginResultSchema>;

// Export input types for schemas with defaults
export type DynamicLoadRequestInput = z.input<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequestInput = z.input<typeof DynamicUnloadRequestSchema>;
