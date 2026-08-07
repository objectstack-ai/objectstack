// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Startup Orchestrator Protocol
 * 
 * Zod schemas for plugin startup orchestration data structures.
 * These schemas align with the IStartupOrchestrator contract interface.
 * 
 * Following ObjectStack "Zod First" principle - all data structures
 * must have Zod schemas for runtime validation and JSON Schema generation.
 */

// ============================================================================
// Startup Configuration Schemas
// ============================================================================

/**
 * Startup Options Schema
 * Configuration for plugin startup orchestration
 * 
 * @example
 * {
 *   "timeout": 30000,
 *   "rollbackOnFailure": true,
 *   "healthCheck": false,
 *   "parallel": false
 * }
 */
import { lazySchema } from '../shared/lazy-schema';
export const StartupOptionsSchema = lazySchema(() => z.object({
  /**
   * Maximum time (ms) to wait for each plugin to start
   * @default 30000 (30 seconds)
   */
  timeout: z.number().int().min(0).optional().default(30000)
    .describe('Maximum time in milliseconds to wait for each plugin to start'),
  
  /**
   * Whether to rollback (destroy) already-started plugins on failure
   * @default true
   */
  rollbackOnFailure: z.boolean().optional().default(true)
    .describe('Whether to rollback already-started plugins if any plugin fails'),
  
  /**
   * Whether to run health checks after startup
   * @default false
   */
  healthCheck: z.boolean().optional().default(false)
    .describe('Whether to run health checks after plugin startup'),
  
  /**
   * Whether to run plugins in parallel (if dependencies allow)
   * @default false (sequential startup)
   */
  parallel: z.boolean().optional().default(false)
    .describe('Whether to start plugins in parallel when dependencies allow'),
  
  /**
   * Custom context to pass to plugin lifecycle methods
   */
  context: z.unknown().optional().describe('Custom context object to pass to plugin lifecycle methods'),
}));

export type StartupOptions = z.infer<typeof StartupOptionsSchema>;
/** Post-parse shape of {@link StartupOptions} — defaults applied, transforms run (ADR-0122). */
export type StartupOptionsParsed = z.infer<typeof StartupOptionsSchema>;
export type StartupOptionsInput = z.input<typeof StartupOptionsSchema>;

// ============================================================================
// Health Status Schemas
// ============================================================================

/**
 * Health Status Schema
 * Health status for a plugin
 * 
 * @example
 * {
 *   "healthy": true,
 *   "timestamp": 1706659200000,
 *   "details": {
 *     "databaseConnected": true,
 *     "memoryUsage": 45.2
 *   }
 * }
 */
export const HealthStatusSchema = lazySchema(() => z.object({
  /**
   * Whether the plugin is healthy
   */
  healthy: z.boolean().describe('Whether the plugin is healthy'),
  
  /**
   * Health check timestamp (Unix milliseconds)
   */
  timestamp: z.number().int().describe('Unix timestamp in milliseconds when health check was performed'),
  
  /**
   * Optional health details (plugin-specific)
   */
  details: z.record(z.string(), z.unknown()).optional().describe('Optional plugin-specific health details'),
  
  /**
   * Optional error message if unhealthy
   */
  message: z.string().optional().describe('Error message if plugin is unhealthy'),
}));

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// ============================================================================
// Startup Result Schemas
// ============================================================================

/**
 * Plugin Startup Result Schema
 * Result of a single plugin startup operation
 * 
 * @example
 * {
 *   "plugin": { "name": "crm-plugin", "version": "1.0.0" },
 *   "success": true,
 *   "duration": 1250,
 *   "health": {
 *     "healthy": true,
 *     "timestamp": 1706659200000
 *   }
 * }
 */
export const PluginStartupResultSchema = lazySchema(() => z.object({
  /**
   * Plugin that was started
   */
  plugin: z.object({
    name: z.string(),
    version: z.string().optional(),
  }).passthrough().describe('Plugin metadata'),
  
  /**
   * Whether startup was successful
   */
  success: z.boolean().describe('Whether the plugin started successfully'),
  
  /**
   * Time taken to start (milliseconds)
   */
  duration: z.number().min(0).describe('Time taken to start the plugin in milliseconds'),
  
  /**
   * Error if startup failed
   */
  error: z.object({
    name: z.string().describe('Error class name'),
    message: z.string().describe('Error message'),
    stack: z.string().optional().describe('Stack trace'),
    code: z.string().optional().describe('Error code'),
  }).optional().describe('Serializable error representation if startup failed'),
  
  /**
   * Health status after startup (if healthCheck enabled)
   */
  health: HealthStatusSchema.optional().describe('Health status after startup if health check was enabled'),
}));

export type PluginStartupResult = z.infer<typeof PluginStartupResultSchema>;

// ============================================================================
// Startup Orchestration Result Schema
// ============================================================================

/**
 * Startup Orchestration Result Schema
 * Overall result of orchestrating startup for multiple plugins
 * 
 * @example
 * {
 *   "results": [
 *     { "plugin": { "name": "plugin1" }, "success": true, "duration": 1200 },
 *     { "plugin": { "name": "plugin2" }, "success": true, "duration": 850 }
 *   ],
 *   "totalDuration": 2050,
 *   "allSuccessful": true
 * }
 */
export const StartupOrchestrationResultSchema = lazySchema(() => z.object({
  /**
   * Individual plugin startup results
   */
  results: z.array(PluginStartupResultSchema).describe('Startup results for each plugin'),
  
  /**
   * Total time taken for all plugins (milliseconds)
   */
  totalDuration: z.number().min(0).describe('Total time taken for all plugins in milliseconds'),
  
  /**
   * Whether all plugins started successfully
   */
  allSuccessful: z.boolean().describe('Whether all plugins started successfully'),
  
  /**
   * Plugins that were rolled back (if rollbackOnFailure was enabled)
   */
  rolledBack: z.array(z.string()).optional().describe('Names of plugins that were rolled back'),
}));

export type StartupOrchestrationResult = z.infer<typeof StartupOrchestrationResultSchema>;
