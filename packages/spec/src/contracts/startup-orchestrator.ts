// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin } from './plugin-validator.js';
// [#4538] The startup-orchestration data shapes are the kernel domain's
// zod-derived types — one declaration per name (#4446), re-exported here so
// the contract surface and the schema surface can never drift again. The
// hand-written twins this file used to carry had already drifted twice:
// `error` was a live `Error` where the schema declares the serializable
// projection, and `StartupOptions` conflated the caller-authored (input)
// tier with the parsed tier.
import type {
    HealthStatus,
    PluginStartupResult,
    StartupOptions,
} from '../kernel/startup-orchestrator.zod';
export type {
    HealthStatus,
    PluginStartupResult,
    StartupOptions,
    StartupOptionsParsed,
} from '../kernel/startup-orchestrator.zod';

/**
 * IStartupOrchestrator - Startup Orchestrator Interface
 *
 * Abstract interface for orchestrating plugin startup with advanced features:
 * - Timeout handling
 * - Rollback on failure
 * - Health checks
 * - Startup metrics
 *
 * Extracted from PluginLoader to follow Single Responsibility Principle.
 */

/**
 * IStartupOrchestrator - Plugin startup orchestration interface
 */
export interface IStartupOrchestrator {
    /**
     * Orchestrate startup of multiple plugins
     * Handles timeout, rollback, and health checks
     * @param plugins - Array of plugins to start (in dependency order)
     * @param options - Startup options — the caller-authored (input) tier;
     *   implementations apply `StartupOptionsSchema` defaults
     * @returns Promise resolving to startup results for each plugin
     */
    orchestrateStartup(
        plugins: Plugin[],
        options: StartupOptions
    ): Promise<PluginStartupResult[]>;
    
    /**
     * Rollback (destroy) a set of plugins
     * Used when startup fails and rollback is enabled
     * @param startedPlugins - Plugins that were successfully started
     * @returns Promise that resolves when rollback is complete
     */
    rollback(startedPlugins: Plugin[]): Promise<void>;
    
    /**
     * Check health of a single plugin
     * @param plugin - Plugin to check
     * @returns Promise resolving to health status
     */
    checkHealth(plugin: Plugin): Promise<HealthStatus>;
    
    /**
     * Wait for a plugin to start with timeout
     * @param plugin - Plugin to start
     * @param context - Plugin context
     * @param timeoutMs - Maximum time to wait (milliseconds)
     * @returns Promise resolving when plugin starts or rejecting on timeout
     */
    startWithTimeout?(
        plugin: Plugin, 
        context: any, 
        timeoutMs: number
    ): Promise<void>;
}
