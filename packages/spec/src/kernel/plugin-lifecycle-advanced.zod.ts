// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Advanced Plugin Lifecycle Protocol
 * 
 * Defines advanced lifecycle management capabilities including:
 * - Hot reload and live updates
 * - Graceful degradation and fallback mechanisms
 * - Health monitoring and auto-recovery
 * - State preservation during updates
 * 
 * This protocol extends the basic plugin lifecycle with enterprise-grade
 * features for production environments.
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

/**
 * Graceful Degradation Configuration
 * Defines how plugin degrades when dependencies fail
 */
export const GracefulDegradationSchema = lazySchema(() => z.object({
  /**
   * Enable graceful degradation
   */
  enabled: z.boolean().default(true),
  
  /**
   * Fallback mode when dependencies fail
   */
  fallbackMode: z.enum([
    'minimal',      // Provide minimal functionality
    'cached',       // Use cached data
    'readonly',     // Allow read-only operations
    'offline',      // Offline mode with local data
    'disabled',     // Disable plugin functionality
  ]).default('minimal'),
  
  /**
   * Critical dependencies that must be available
   */
  criticalDependencies: z.array(z.string()).optional()
    .describe('Plugin IDs that are required for operation'),
  
  /**
   * Optional dependencies that can fail
   */
  optionalDependencies: z.array(z.string()).optional()
    .describe('Plugin IDs that are nice to have but not required'),
  
  /**
   * Feature flags for degraded mode
   */
  degradedFeatures: z.array(z.object({
    feature: z.string().describe('Feature name'),
    enabled: z.boolean().describe('Whether feature is available in degraded mode'),
    reason: z.string().optional(),
  })).optional(),
  
  /**
   * Automatic recovery attempts
   */
  autoRecovery: z.object({
    enabled: z.boolean().default(true),
    retryInterval: z.number().int().min(1000).default(60000)
      .describe('Interval between recovery attempts (ms)'),
    maxAttempts: z.number().int().min(0).default(5)
      .describe('Maximum recovery attempts before giving up'),
  }).optional(),
}));

/**
 * Plugin Update Strategy
 * Defines how plugin handles version updates
 */
export const PluginUpdateStrategySchema = lazySchema(() => z.object({
  /**
   * Update mode
   */
  mode: z.enum([
    'manual',       // Manual updates only
    'automatic',    // Automatic updates
    'scheduled',    // Scheduled update windows
    'rolling',      // Rolling updates with zero downtime
  ]).default('manual'),
  
  /**
   * Version constraints for automatic updates
   */
  autoUpdateConstraints: z.object({
    major: z.boolean().default(false).describe('Allow major version updates'),
    minor: z.boolean().default(true).describe('Allow minor version updates'),
    patch: z.boolean().default(true).describe('Allow patch version updates'),
  }).optional(),
  
  /**
   * Update schedule (for scheduled mode)
   */
  schedule: z.object({
    /**
     * Cron expression for update window
     */
    cron: z.string().optional(),
    
    /**
     * Timezone for schedule
     */
    timezone: z.string().default('UTC'),
    
    /**
     * Maintenance window duration in minutes
     */
    maintenanceWindow: z.number().int().min(1).default(60),
  }).optional(),
  
  /**
   * Rollback configuration
   */
  rollback: z.object({
    enabled: z.boolean().default(true),
    
    /**
     * Automatic rollback on failure
     */
    automatic: z.boolean().default(true),
    
    /**
     * Keep N previous versions for rollback
     */
    keepVersions: z.number().int().min(1).default(3),
    
    /**
     * Rollback timeout in milliseconds
     */
    timeout: z.number().int().min(1000).default(30000),
  }).optional(),
  
  /**
   * Pre-update validation
   */
  validation: z.object({
    /**
     * Run compatibility checks before update
     */
    checkCompatibility: z.boolean().default(true),
    
    /**
     * Run tests before applying update
     */
    runTests: z.boolean().default(false),
    
    /**
     * Test suite to run
     */
    testSuite: z.string().optional(),
  }).optional(),
}));

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

/**
 * Advanced Plugin Lifecycle Configuration
 * Complete configuration for advanced lifecycle management
 */
export const AdvancedPluginLifecycleConfigSchema = lazySchema(() => z.object({
  /**
   * Health monitoring configuration
   */
  health: PluginHealthCheckSchema.optional(),
  
  /**
   * Hot reload configuration
   */
  hotReload: HotReloadConfigSchema.optional(),
  
  /**
   * Graceful degradation configuration
   */
  degradation: GracefulDegradationSchema.optional(),
  
  /**
   * Update strategy
   */
  updates: PluginUpdateStrategySchema.optional(),
  
  /**
   * Resource limits
   */
  resources: z.object({
    maxMemory: z.number().int().optional().describe('Maximum memory in bytes'),
    maxCpu: z.number().min(0).max(100).optional().describe('Maximum CPU percentage'),
    maxConnections: z.number().int().optional().describe('Maximum concurrent connections'),
    timeout: z.number().int().optional().describe('Operation timeout in milliseconds'),
  }).optional(),
  
  /**
   * Monitoring and observability
   */
  observability: z.object({
    enableMetrics: z.boolean().default(true),
    enableTracing: z.boolean().default(true),
    enableProfiling: z.boolean().default(false),
    metricsInterval: z.number().int().min(1000).default(60000)
      .describe('Metrics collection interval in ms'),
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
export type GracefulDegradation = z.input<typeof GracefulDegradationSchema>;
/** Post-parse shape of {@link GracefulDegradation} — defaults applied, transforms run (ADR-0122). */
export type GracefulDegradationParsed = z.infer<typeof GracefulDegradationSchema>;
export type PluginUpdateStrategy = z.input<typeof PluginUpdateStrategySchema>;
/** Post-parse shape of {@link PluginUpdateStrategy} — defaults applied, transforms run (ADR-0122). */
export type PluginUpdateStrategyParsed = z.infer<typeof PluginUpdateStrategySchema>;
export type PluginStateSnapshot = z.input<typeof PluginStateSnapshotSchema>;
/** Post-parse shape of {@link PluginStateSnapshot} — defaults applied, transforms run (ADR-0122). */
export type PluginStateSnapshotParsed = z.infer<typeof PluginStateSnapshotSchema>;
export type AdvancedPluginLifecycleConfig = z.input<typeof AdvancedPluginLifecycleConfigSchema>;
/** Post-parse shape of {@link AdvancedPluginLifecycleConfig} — defaults applied, transforms run (ADR-0122). */
export type AdvancedPluginLifecycleConfigParsed = z.infer<typeof AdvancedPluginLifecycleConfigSchema>;
