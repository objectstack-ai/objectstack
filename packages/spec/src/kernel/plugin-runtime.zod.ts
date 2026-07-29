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
    'onStartup',         // Activate immediately on kernel startup
  ]).describe('Trigger type for lazy activation'),
  
  /**
   * Pattern to match (command name, route glob, object name, event pattern, etc.)
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
 * Plugin Discovery Source
 * Defines where to discover available plugins at runtime
 */
export const PluginDiscoverySourceSchema = lazySchema(() => z.object({
  /**
   * Discovery source type
   */
  type: z.enum([
    'registry',        // ObjectStack plugin registry API
    'npm',             // npm registry search
    'directory',       // Local filesystem directory scan
    'url',             // Remote manifest URL
  ]).describe('Discovery source type'),
  
  /**
   * Source endpoint or path
   */
  endpoint: z.string().describe('Registry URL, directory path, or manifest URL'),
  
  /**
   * Polling interval in milliseconds (0 = manual only)
   */
  pollInterval: z.number().int().min(0).default(0)
    .describe('How often to re-scan for new plugins (0 = manual)'),
  
  /**
   * Filter criteria for discovered plugins
   */
  filter: z.object({
    /**
     * Only discover plugins matching these tags
     */
    tags: z.array(z.string()).optional(),
    
    /**
     * Only discover plugins from these vendors
     */
    vendors: z.array(z.string()).optional(),
    
    /**
     * Minimum trust level
     */
    minTrustLevel: z.enum(['verified', 'trusted', 'community', 'untrusted']).optional(),
  }).optional(),
}).describe('Source for runtime plugin discovery'));

/**
 * Plugin Discovery Configuration
 * Controls how the kernel discovers available plugins at runtime
 */
export const PluginDiscoveryConfigSchema = lazySchema(() => z.object({
  /**
   * Enable runtime plugin discovery
   */
  enabled: z.boolean().default(false),
  
  /**
   * Discovery sources
   */
  sources: z.array(PluginDiscoverySourceSchema).default([]),
  
  /**
   * Auto-load discovered plugins matching criteria
   */
  autoLoad: z.boolean().default(false)
    .describe('Automatically load newly discovered plugins'),
  
  /**
   * Require approval before loading discovered plugins
   */
  requireApproval: z.boolean().default(true)
    .describe('Require admin approval before loading discovered plugins'),
}).describe('Runtime plugin discovery configuration'));

/**
 * Dynamic Loading Configuration
 * Top-level configuration for the dynamic plugin loading subsystem
 */
export const DynamicLoadingConfigSchema = lazySchema(() => z.object({
  /**
   * Enable dynamic loading/unloading at runtime
   */
  enabled: z.boolean().default(false)
    .describe('Enable runtime load/unload of plugins'),
  
  /**
   * Maximum number of dynamically loaded plugins
   */
  maxDynamicPlugins: z.number().int().min(1).default(50)
    .describe('Upper limit on runtime-loaded plugins'),
  
  /**
   * Plugin discovery configuration
   */
  discovery: PluginDiscoveryConfigSchema.optional(),
  
  /**
   * Default sandbox policy for dynamically loaded plugins
   */
  defaultSandbox: z.boolean().default(true)
    .describe('Sandbox dynamically loaded plugins by default'),
  
  /**
   * Allowed plugin sources — three-state, the same contract as
   * `object.apiMethods` (#3391/#3543): `undefined` = no source policy declared,
   * `[]` = deny-all, a subset = exactly those source types.
   *
   * The empty ARRAY is closed; only ABSENCE is open. The previous wording
   * collapsed the two, making this a vacuous allow-list — one where the value an
   * author reaches by mistake is also the widest grant. That is the shape #3896
   * turned into an over-share, and this is a supply-chain gate.
   *
   * Nothing enforces this field yet (hence the marker), which is precisely why
   * the wording mattered: an unimplemented property's description is the
   * specification whoever implements it builds to.
   */
  allowedSources: z.array(z.enum(['npm', 'local', 'url', 'registry', 'git'])).optional()
    .describe('[EXPERIMENTAL — not enforced] Restrict which plugin source types are permitted: undefined = any source, [] = deny-all, a subset = exactly those types'),
  
  /**
   * Require integrity verification for remote plugins
   */
  requireIntegrity: z.boolean().default(true)
    .describe('Require integrity hash verification for remote sources'),
  
  /**
   * Global timeout for dynamic operations in milliseconds
   */
  operationTimeout: z.number().int().min(1000).default(60000)
    .describe('Default timeout for load/unload operations in ms'),
}).describe('Dynamic plugin loading subsystem configuration'));

// Export types
export type DynamicPluginOperation = z.infer<typeof DynamicPluginOperationSchema>;
export type PluginSource = z.infer<typeof PluginSourceSchema>;
export type ActivationEvent = z.infer<typeof ActivationEventSchema>;
export type DynamicLoadRequest = z.infer<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequest = z.infer<typeof DynamicUnloadRequestSchema>;
export type DynamicPluginResult = z.infer<typeof DynamicPluginResultSchema>;
export type PluginDiscoverySource = z.infer<typeof PluginDiscoverySourceSchema>;
export type PluginDiscoveryConfig = z.infer<typeof PluginDiscoveryConfigSchema>;
export type DynamicLoadingConfig = z.infer<typeof DynamicLoadingConfigSchema>;

// Export input types for schemas with defaults
export type DynamicLoadRequestInput = z.input<typeof DynamicLoadRequestSchema>;
export type DynamicUnloadRequestInput = z.input<typeof DynamicUnloadRequestSchema>;
export type DynamicLoadingConfigInput = z.input<typeof DynamicLoadingConfigSchema>;
