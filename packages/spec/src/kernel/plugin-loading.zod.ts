// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Plugin Loading Protocol
 * 
 * Defines the enhanced plugin loading mechanism for the microkernel architecture.
 * Inspired by industry best practices from:
 * - Kubernetes CRDs and Operators
 * - OSGi Dynamic Module System
 * - Eclipse Plugin Framework
 * - Webpack Module Federation
 * 
 * This protocol enables:
 * - Lazy loading and code splitting
 * - Dynamic imports and parallel initialization
 * - Capability-based discovery
 * - Hot reload in development
 * - Advanced caching strategies
 */

/**
 * Plugin Loading Strategy
 * Determines how and when a plugin is loaded into memory
 */
import { lazySchema } from '../shared/lazy-schema';
export const PluginLoadingStrategySchema = lazySchema(() => z.enum([
  'eager',      // Load immediately during bootstrap (critical plugins)
  'lazy',       // Load on first use (feature plugins)
  'parallel',   // Load in parallel with other plugins
  'deferred',   // Load after initial bootstrap complete
  'on-demand',  // Load only when explicitly requested
]).describe('Plugin loading strategy'));

/**
 * Plugin Preloading Configuration
 * Configures preloading behavior for faster activation
 */
export const PluginPreloadConfigSchema = lazySchema(() => z.object({
  /**
   * Enable preloading for this plugin
   */
  enabled: z.boolean().default(false),
  
  /**
   * Preload priority (lower = higher priority)
   */
  priority: z.number().int().min(0).default(100),
  
  /**
   * Resources to preload
   */
  resources: z.array(z.enum([
    'metadata',      // Plugin manifest and metadata
    'dependencies',  // Plugin dependencies
    'assets',        // Static assets (icons, translations)
    'code',          // JavaScript code chunks
    'services',      // Service definitions
  ])).optional(),
  
  /**
   * Conditions for preloading
   */
  conditions: z.object({
    /**
     * Preload only on specific routes
     */
    routes: z.array(z.string()).optional(),
    
    /**
     * Preload only for specific user roles
     */
    roles: z.array(z.string()).optional(),
    
    /**
     * Preload based on device type
     */
    deviceType: z.array(z.enum(['desktop', 'mobile', 'tablet'])).optional(),
    
    /**
     * Network connection quality threshold
     */
    minNetworkSpeed: z.enum(['slow-2g', '2g', '3g', '4g']).optional(),
  }).optional(),
}).describe('Plugin preloading configuration'));

/**
 * Plugin Code Splitting Configuration
 * Configures how plugin code is split for optimal loading
 */
export const PluginCodeSplittingSchema = lazySchema(() => z.object({
  /**
   * Enable code splitting for this plugin
   */
  enabled: z.boolean().default(true),
  
  /**
   * Split strategy
   */
  strategy: z.enum([
    'route',         // Split by UI routes
    'feature',       // Split by feature modules
    'size',          // Split by bundle size threshold
    'custom',        // Custom split points defined by plugin
  ]).default('feature'),
  
  /**
   * Chunk naming strategy
   */
  chunkNaming: z.enum(['hashed', 'named', 'sequential']).default('hashed'),
  
  /**
   * Maximum chunk size in KB
   */
  maxChunkSize: z.number().int().min(10).optional().describe('Max chunk size in KB'),
  
  /**
   * Shared dependencies optimization
   */
  sharedDependencies: z.object({
    enabled: z.boolean().default(true),
    /**
     * Minimum times a module must be shared before extraction
     */
    minChunks: z.number().int().min(1).default(2),
  }).optional(),
}).describe('Plugin code splitting configuration'));

/**
 * Plugin Dynamic Import Configuration
 * Configures dynamic import behavior for runtime module loading
 */
export const PluginDynamicImportSchema = lazySchema(() => z.object({
  /**
   * Enable dynamic imports
   */
  enabled: z.boolean().default(true),
  
  /**
   * Import mode
   */
  mode: z.enum([
    'async',    // Asynchronous import (recommended)
    'sync',     // Synchronous import (blocking)
    'eager',    // Eager evaluation
    'lazy',     // Lazy evaluation
  ]).default('async'),
  
  /**
   * Prefetch strategy
   */
  prefetch: z.boolean().default(false).describe('Prefetch module in idle time'),
  
  /**
   * Preload strategy
   */
  preload: z.boolean().default(false).describe('Preload module in parallel with parent'),
  
  /**
   * Webpack magic comments support
   */
  webpackChunkName: z.string().optional().describe('Custom chunk name for webpack'),
  
  /**
   * Import timeout in milliseconds
   */
  timeout: z.number().int().min(100).default(30000).describe('Dynamic import timeout (ms)'),
  
  /**
   * Retry configuration on import failure
   */
  retry: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    backoffMs: z.number().int().min(0).default(1000).describe('Exponential backoff base delay'),
  }).optional(),
}).describe('Plugin dynamic import configuration'));

/**
 * Plugin Initialization Configuration
 * Configures how plugin initialization is executed
 */
export const PluginInitializationSchema = lazySchema(() => z.object({
  /**
   * Initialization mode
   */
  mode: z.enum([
    'sync',          // Synchronous initialization
    'async',         // Asynchronous initialization
    'parallel',      // Parallel with other plugins
    'sequential',    // Must complete before next plugin
  ]).default('async'),
  
  /**
   * Initialization timeout in milliseconds
   */
  timeout: z.number().int().min(100).default(30000),
  
  /**
   * Startup priority (lower = higher priority, earlier initialization)
   */
  priority: z.number().int().min(0).default(100),
  
  /**
   * Whether to continue bootstrap if this plugin fails
   */
  critical: z.boolean().default(false).describe('If true, kernel bootstrap fails if plugin fails'),
  
  /**
   * Retry configuration on initialization failure
   */
  retry: z.object({
    enabled: z.boolean().default(false),
    maxAttempts: z.number().int().min(1).max(5).default(3),
    backoffMs: z.number().int().min(0).default(1000),
  }).optional(),
  
  /**
   * Health check interval for monitoring
   */
  healthCheckInterval: z.number().int().min(0).optional().describe('Health check interval in ms (0 = disabled)'),
}).describe('Plugin initialization configuration'));

/**
 * Plugin Dependency Resolution Configuration
 * Advanced dependency resolution using semantic versioning
 */
export const PluginDependencyResolutionSchema = lazySchema(() => z.object({
  /**
   * Dependency resolution strategy
   */
  strategy: z.enum([
    'strict',        // Exact version match required
    'compatible',    // Semver compatible versions (^)
    'latest',        // Always use latest compatible
    'pinned',        // Lock to specific version
  ]).default('compatible'),
  
  /**
   * Peer dependency handling
   */
  peerDependencies: z.object({
    /**
     * Whether to resolve peer dependencies
     */
    resolve: z.boolean().default(true),
    
    /**
     * Action on missing peer dependency
     */
    onMissing: z.enum(['error', 'warn', 'ignore']).default('warn'),
    
    /**
     * Action on peer version mismatch
     */
    onMismatch: z.enum(['error', 'warn', 'ignore']).default('warn'),
  }).optional(),
  
  /**
   * Optional dependency handling
   */
  optionalDependencies: z.object({
    /**
     * Whether to attempt loading optional dependencies
     */
    load: z.boolean().default(true),
    
    /**
     * Action on optional dependency load failure
     */
    onFailure: z.enum(['warn', 'ignore']).default('warn'),
  }).optional(),
  
  /**
   * Conflict resolution
   */
  conflictResolution: z.enum([
    'fail',          // Fail on any version conflict
    'latest',        // Use latest version
    'oldest',        // Use oldest version
    'manual',        // Require manual resolution
  ]).default('latest'),
  
  /**
   * Circular dependency handling
   */
  circularDependencies: z.enum([
    'error',         // Throw error on circular dependency
    'warn',          // Warn but continue
    'allow',         // Allow circular dependencies
  ]).default('warn'),
}).describe('Plugin dependency resolution configuration'));

/**
 * Plugin Hot Reload Configuration
 * Enables hot module replacement for development and production environments.
 * 
 * Production mode adds safety features: health validation, rollback on failure,
 * connection draining, and concurrency control for zero-downtime reloads.
 */
export const PluginHotReloadSchema = lazySchema(() => z.object({
  /**
   * Enable hot reload
   */
  enabled: z.boolean().default(false),
  
  /**
   * Target environment for hot reload behavior
   */
  environment: z.enum([
    'development',   // Fast reload with relaxed safety (file watchers, no health validation)
    'staging',       // Production-like reload with validation but relaxed rollback
    'production',    // Full safety: health validation, rollback, connection draining
  ]).default('development').describe('Target environment controlling safety level'),
  
  /**
   * Hot reload strategy
   */
  strategy: z.enum([
    'full',          // Full plugin reload (destroy and reinitialize)
    'partial',       // Partial reload (update changed modules only)
    'state-preserve', // Preserve plugin state during reload
  ]).default('full'),
  
  /**
   * Files to watch for changes
   */
  watchPatterns: z.array(z.string()).optional().describe('Glob patterns for files to watch'),
  
  /**
   * Files to ignore
   */
  ignorePatterns: z.array(z.string()).optional().describe('Glob patterns for files to ignore'),
  
  /**
   * Debounce delay in milliseconds
   */
  debounceMs: z.number().int().min(0).default(300),
  
  /**
   * Whether to preserve state during reload
   */
  preserveState: z.boolean().default(false),
  
  /**
   * State serialization
   */
  stateSerialization: z.object({
    enabled: z.boolean().default(false),
    /**
     * Path to state serialization handler
     */
    handler: z.string().optional(),
  }).optional(),
  
  /**
   * Hooks for hot reload lifecycle
   */
  hooks: z.object({
    beforeReload: z.string().optional().describe('Function to call before reload'),
    afterReload: z.string().optional().describe('Function to call after reload'),
    onError: z.string().optional().describe('Function to call on reload error'),
  }).optional(),
  
  /**
   * Production safety configuration
   * Applied when environment is 'staging' or 'production'
   */
  productionSafety: z.object({
    /**
     * Validate plugin health before completing reload
     */
    healthValidation: z.boolean().default(true)
      .describe('Run health checks after reload before accepting traffic'),
    
    /**
     * Automatically rollback to previous version on reload failure
     */
    rollbackOnFailure: z.boolean().default(true)
      .describe('Auto-rollback if reloaded plugin fails health check'),
    
    /**
     * Maximum time to wait for health validation after reload (ms)
     */
    healthTimeout: z.number().int().min(1000).default(30000)
      .describe('Health check timeout after reload in ms'),
    
    /**
     * Drain active connections before reload
     */
    drainConnections: z.boolean().default(true)
      .describe('Gracefully drain active requests before reloading'),
    
    /**
     * Maximum time to wait for connection draining (ms)
     */
    drainTimeout: z.number().int().min(0).default(15000)
      .describe('Max wait time for connection draining in ms'),
    
    /**
     * Maximum number of concurrent plugin reloads
     */
    maxConcurrentReloads: z.number().int().min(1).default(1)
      .describe('Limit concurrent reloads to prevent system instability'),
    
    /**
     * Minimum interval between reloads of the same plugin (ms)
     */
    minReloadInterval: z.number().int().min(1000).default(5000)
      .describe('Cooldown period between reloads of the same plugin'),
  }).optional(),
}).describe('Plugin hot reload configuration'));

/**
 * Plugin Caching Configuration
 * Configures caching strategy for faster subsequent loads
 */
export const PluginCachingSchema = lazySchema(() => z.object({
  /**
   * Enable caching
   */
  enabled: z.boolean().default(true),
  
  /**
   * Cache storage type
   */
  storage: z.enum([
    'memory',        // In-memory cache (fastest, not persistent)
    'disk',          // Disk cache (persistent)
    'indexeddb',     // Browser IndexedDB (persistent, browser only)
    'hybrid',        // Memory + Disk hybrid
  ]).default('memory'),
  
  /**
   * Cache key strategy
   */
  keyStrategy: z.enum([
    'version',       // Cache by plugin version
    'hash',          // Cache by content hash
    'timestamp',     // Cache by last modified timestamp
  ]).default('version'),
  
  /**
   * Cache TTL in seconds
   */
  ttl: z.number().int().min(0).optional().describe('Time to live in seconds (0 = infinite)'),
  
  /**
   * Maximum cache size in MB
   */
  maxSize: z.number().int().min(1).optional().describe('Max cache size in MB'),
  
  /**
   * Cache invalidation triggers
   */
  invalidateOn: z.array(z.enum([
    'version-change',
    'dependency-change',
    'manual',
    'error',
  ])).optional(),
  
  /**
   * Compression
   */
  compression: z.object({
    enabled: z.boolean().default(false),
    algorithm: z.enum(['gzip', 'brotli', 'deflate']).default('gzip'),
  }).optional(),
}).describe('Plugin caching configuration'));

/**
 * Plugin Sandboxing Configuration
 * Security isolation for plugins with configurable scope.
 * 
 * Supports isolation beyond automation scripts: any plugin can be sandboxed
 * with process-level isolation and inter-plugin communication (IPC).
 */
export const PluginSandboxingSchema = lazySchema(() => z.object({
  /**
   * Enable sandboxing
   */
  enabled: z.boolean().default(false),
  
  /**
   * Isolation scope - which plugins are subject to sandboxing
   */
  scope: z.enum([
    'automation-only',  // Sandbox automation/scripting plugins only (current behavior)
    'untrusted-only',   // Sandbox plugins below a trust threshold
    'all-plugins',      // Sandbox all plugins (maximum isolation)
  ]).default('automation-only').describe('Which plugins are subject to isolation'),
  
  /**
   * Sandbox isolation level
   */
  isolationLevel: z.enum([
    'none',          // No isolation
    'process',       // Separate process (Node.js worker threads)
    'vm',            // VM context isolation
    'iframe',        // iframe isolation (browser)
    'web-worker',    // Web Worker (browser)
  ]).default('none'),
  
  /**
   * Allowed capabilities
   */
  allowedCapabilities: z.array(z.string()).optional().describe('List of allowed capability IDs'),
  
  /**
   * Resource quotas
   */
  resourceQuotas: z.object({
    /**
     * Maximum memory usage in MB
     */
    maxMemoryMB: z.number().int().min(1).optional(),
    
    /**
     * Maximum CPU time in milliseconds
     */
    maxCpuTimeMs: z.number().int().min(100).optional(),
    
    /**
     * Maximum number of file descriptors
     */
    maxFileDescriptors: z.number().int().min(1).optional(),
    
    /**
     * Maximum network bandwidth in KB/s
     */
    maxNetworkKBps: z.number().int().min(1).optional(),
  }).optional(),
  
  /**
   * Permissions
   */
  permissions: z.object({
    /**
     * Allowed API access
     */
    allowedAPIs: z.array(z.string()).optional(),
    
    /**
     * Allowed file system paths
     */
    allowedPaths: z.array(z.string()).optional(),
    
    /**
     * Allowed network endpoints
     */
    allowedEndpoints: z.array(z.string()).optional(),
    
    /**
     * Allowed environment variables
     */
    allowedEnvVars: z.array(z.string()).optional(),
  }).optional(),
  
  /**
   * Inter-Plugin Communication (IPC) configuration
   * Enables isolated plugins to communicate with the kernel and other plugins
   */
  ipc: z.object({
    /**
     * Enable IPC for sandboxed plugins
     */
    enabled: z.boolean().default(true)
      .describe('Allow sandboxed plugins to communicate via IPC'),
    
    /**
     * IPC transport mechanism
     */
    transport: z.enum([
      'message-port',   // MessagePort (worker threads / Web Workers)
      'unix-socket',    // Unix domain sockets (process isolation)
      'tcp',            // TCP sockets (container isolation)
      'memory',         // Shared memory channel (in-process VM)
    ]).default('message-port')
      .describe('IPC transport for cross-boundary communication'),
    
    /**
     * Maximum message size in bytes
     */
    maxMessageSize: z.number().int().min(1024).default(1048576)
      .describe('Maximum IPC message size in bytes (default 1MB)'),
    
    /**
     * Message timeout in milliseconds
     */
    timeout: z.number().int().min(100).default(30000)
      .describe('IPC message response timeout in ms'),
    
    /**
     * Allowed service calls through IPC
     */
    allowedServices: z.array(z.string()).optional()
      .describe('Service names the sandboxed plugin may invoke via IPC'),
  }).optional(),
}).describe('Plugin sandboxing configuration'));

/**
 * Plugin Performance Monitoring Configuration
 * Telemetry and performance tracking
 */
export const PluginPerformanceMonitoringSchema = lazySchema(() => z.object({
  /**
   * Enable performance monitoring
   */
  enabled: z.boolean().default(false),
  
  /**
   * Metrics to collect
   */
  metrics: z.array(z.enum([
    'load-time',
    'init-time',
    'memory-usage',
    'cpu-usage',
    'api-calls',
    'error-rate',
    'cache-hit-rate',
  ])).optional(),
  
  /**
   * Sampling rate (0-1, where 1 = 100%)
   */
  samplingRate: z.number().min(0).max(1).default(1),
  
  /**
   * Reporting interval in seconds
   */
  reportingInterval: z.number().int().min(1).default(60),
  
  /**
   * Performance budget thresholds
   */
  budgets: z.object({
    /**
     * Maximum load time in milliseconds
     */
    maxLoadTimeMs: z.number().int().min(0).optional(),
    
    /**
     * Maximum init time in milliseconds
     */
    maxInitTimeMs: z.number().int().min(0).optional(),
    
    /**
     * Maximum memory usage in MB
     */
    maxMemoryMB: z.number().int().min(0).optional(),
  }).optional(),
  
  /**
   * Action on budget violation
   */
  onBudgetViolation: z.enum(['warn', 'error', 'ignore']).default('warn'),
}).describe('Plugin performance monitoring configuration'));

/**
 * Complete Plugin Loading Configuration
 * Combines all loading-related configurations
 */
export const PluginLoadingConfigSchema = lazySchema(() => z.object({
  /**
   * Loading strategy
   */
  strategy: PluginLoadingStrategySchema.default('lazy'),
  
  /**
   * Preloading configuration
   */
  preload: PluginPreloadConfigSchema.optional(),
  
  /**
   * Code splitting configuration
   */
  codeSplitting: PluginCodeSplittingSchema.optional(),
  
  /**
   * Dynamic import configuration
   */
  dynamicImport: PluginDynamicImportSchema.optional(),
  
  /**
   * Initialization configuration
   */
  initialization: PluginInitializationSchema.optional(),
  
  /**
   * Dependency resolution configuration
   */
  dependencyResolution: PluginDependencyResolutionSchema.optional(),
  
  /**
   * Hot reload configuration (development and production)
   */
  hotReload: PluginHotReloadSchema.optional(),
  
  /**
   * Caching configuration
   */
  caching: PluginCachingSchema.optional(),
  
  /**
   * Sandboxing configuration
   */
  sandboxing: PluginSandboxingSchema.optional(),
  
  /**
   * Performance monitoring
   */
  monitoring: PluginPerformanceMonitoringSchema.optional(),
}).describe('Complete plugin loading configuration'));

/**
 * Plugin Loading Event
 * Emitted during plugin loading lifecycle
 */
export const PluginLoadingEventSchema = lazySchema(() => z.object({
  /**
   * Event type
   */
  type: z.enum([
    'load-started',
    'load-completed',
    'load-failed',
    'init-started',
    'init-completed',
    'init-failed',
    'preload-started',
    'preload-completed',
    'cache-hit',
    'cache-miss',
    'hot-reload',
    'dynamic-load',       // Plugin loaded at runtime
    'dynamic-unload',     // Plugin unloaded at runtime
    'dynamic-discover',   // Plugin discovered via registry
  ]),
  
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Timestamp
   */
  timestamp: z.number().int().min(0),
  
  /**
   * Duration in milliseconds
   */
  durationMs: z.number().int().min(0).optional(),
  
  /**
   * Additional metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  
  /**
   * Error if event represents a failure
   */
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
  }).optional(),
}).describe('Plugin loading lifecycle event'));

/**
 * Plugin Loading State
 * Tracks the current loading state of a plugin
 */
export const PluginLoadingStateSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Current state
   */
  state: z.enum([
    'pending',       // Not yet loaded
    'loading',       // Currently loading
    'loaded',        // Code loaded, not initialized
    'initializing',  // Currently initializing
    'ready',         // Fully initialized and ready
    'failed',        // Failed to load or initialize
    'reloading',     // Hot reloading in progress
    'unloading',     // Being unloaded at runtime
    'unloaded',      // Successfully unloaded (dynamic loading)
  ]),
  
  /**
   * Load progress (0-100)
   */
  progress: z.number().min(0).max(100).default(0),
  
  /**
   * Loading start time
   */
  startedAt: z.number().int().min(0).optional(),
  
  /**
   * Loading completion time
   */
  completedAt: z.number().int().min(0).optional(),
  
  /**
   * Last error
   */
  lastError: z.string().optional(),
  
  /**
   * Retry count
   */
  retryCount: z.number().int().min(0).default(0),
}).describe('Plugin loading state'));

// Export types
export type PluginLoadingStrategy = z.input<typeof PluginLoadingStrategySchema>;
export type PluginPreloadConfig = z.input<typeof PluginPreloadConfigSchema>;
/** Post-parse shape of {@link PluginPreloadConfig} — defaults applied, transforms run (ADR-0122). */
export type PluginPreloadConfigParsed = z.infer<typeof PluginPreloadConfigSchema>;
export type PluginCodeSplitting = z.input<typeof PluginCodeSplittingSchema>;
/** Post-parse shape of {@link PluginCodeSplitting} — defaults applied, transforms run (ADR-0122). */
export type PluginCodeSplittingParsed = z.infer<typeof PluginCodeSplittingSchema>;
export type PluginDynamicImport = z.input<typeof PluginDynamicImportSchema>;
/** Post-parse shape of {@link PluginDynamicImport} — defaults applied, transforms run (ADR-0122). */
export type PluginDynamicImportParsed = z.infer<typeof PluginDynamicImportSchema>;
export type PluginInitialization = z.input<typeof PluginInitializationSchema>;
/** Post-parse shape of {@link PluginInitialization} — defaults applied, transforms run (ADR-0122). */
export type PluginInitializationParsed = z.infer<typeof PluginInitializationSchema>;
export type PluginDependencyResolution = z.input<typeof PluginDependencyResolutionSchema>;
/** Post-parse shape of {@link PluginDependencyResolution} — defaults applied, transforms run (ADR-0122). */
export type PluginDependencyResolutionParsed = z.infer<typeof PluginDependencyResolutionSchema>;
export type PluginHotReload = z.input<typeof PluginHotReloadSchema>;
/** Post-parse shape of {@link PluginHotReload} — defaults applied, transforms run (ADR-0122). */
export type PluginHotReloadParsed = z.infer<typeof PluginHotReloadSchema>;
export type PluginCaching = z.input<typeof PluginCachingSchema>;
/** Post-parse shape of {@link PluginCaching} — defaults applied, transforms run (ADR-0122). */
export type PluginCachingParsed = z.infer<typeof PluginCachingSchema>;
export type PluginSandboxing = z.input<typeof PluginSandboxingSchema>;
/** Post-parse shape of {@link PluginSandboxing} — defaults applied, transforms run (ADR-0122). */
export type PluginSandboxingParsed = z.infer<typeof PluginSandboxingSchema>;
export type PluginPerformanceMonitoring = z.input<typeof PluginPerformanceMonitoringSchema>;
/** Post-parse shape of {@link PluginPerformanceMonitoring} — defaults applied, transforms run (ADR-0122). */
export type PluginPerformanceMonitoringParsed = z.infer<typeof PluginPerformanceMonitoringSchema>;
export type PluginLoadingConfig = z.input<typeof PluginLoadingConfigSchema>;
/** Post-parse shape of {@link PluginLoadingConfig} — defaults applied, transforms run (ADR-0122). */
export type PluginLoadingConfigParsed = z.infer<typeof PluginLoadingConfigSchema>;
export type PluginLoadingEvent = z.input<typeof PluginLoadingEventSchema>;
export type PluginLoadingState = z.input<typeof PluginLoadingStateSchema>;
/** Post-parse shape of {@link PluginLoadingState} — defaults applied, transforms run (ADR-0122). */
export type PluginLoadingStateParsed = z.infer<typeof PluginLoadingStateSchema>;
