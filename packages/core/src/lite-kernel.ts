// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin } from './types.js';
import { createLogger, ObjectLogger } from './logger.js';
import type { LoggerConfig } from '@objectstack/spec/system';
import { ObjectKernelBase } from './kernel-base.js';

/**
 * ObjectKernel - MiniKernel Architecture
 * 
 * A highly modular, plugin-based microkernel that:
 * - Manages plugin lifecycle (init, start, destroy)
 * - Provides dependency injection via service registry
 * - Implements event/hook system for inter-plugin communication
 * - Handles dependency resolution (topological sort)
 * - Provides configurable logging for server and browser
 * 
 * Core philosophy:
 * - Business logic is completely separated into plugins
 * - Kernel only manages lifecycle, DI, and hooks
 * - Plugins are loaded as equal building blocks
 */
export class LiteKernel extends ObjectKernelBase {
    constructor(config?: { logger?: Partial<LoggerConfig> }) {
        const logger = createLogger(config?.logger);
        super(logger);
        
        // Initialize context after logger is created
        this.context = this.createContext();
    }

    /**
     * Register a plugin
     * @param plugin - Plugin instance
     */
    use(plugin: Plugin): this {
        this.validateIdle();

        const pluginName = plugin.name;
        if (this.plugins.has(pluginName)) {
            throw new Error(`[Kernel] Plugin '${pluginName}' already registered`);
        }

        this.plugins.set(pluginName, plugin);
        return this;
    }

    /**
     * Bootstrap the kernel
     * 1. Resolve dependencies (topological sort)
     * 2. Init phase - plugins register services
     * 3. Start phase - plugins execute business logic
     * 4. Trigger 'kernel:ready' hook
     */
    async bootstrap(): Promise<void> {
        this.validateState('idle');

        this.state = 'initializing';
        this.logger.info('Bootstrap started');

        // Resolve dependencies
        const orderedPlugins = this.resolveDependencies();

        // Pre-Phase-1 ordering contract (ADR-0116, #4131): a plugin that
        // requires a service provided only by a later plugin fails HERE,
        // named, before any init side effects.
        this.validateInitServices(orderedPlugins);

        // Phase 1: Init - Plugins register services
        this.logger.info('Phase 1: Init plugins');
        for (const plugin of orderedPlugins) {
            await this.runPluginInit(plugin);
        }

        // Phase 2: Start - Plugins execute business logic
        this.logger.info('Phase 2: Start plugins');
        this.state = 'running';
        
        for (const plugin of orderedPlugins) {
            await this.runPluginStart(plugin);
        }

        // Trigger ready hook (route/middleware registration phase).
        //
        // PROPAGATING dispatch, identical to ObjectKernel's (#5170): a
        // `kernel:ready` handler that throws FAILS THE BOOT on both kernels.
        // This hook is where plugins assert that what they declared can
        // actually be delivered — the registries are still filling during
        // init(), so a boot gate has nowhere earlier to run — and a swallowed
        // assertion means the process keeps serving without the guarantee it
        // announced. The kernel is left 'stopped' rather than 'running',
        // mirroring `ObjectKernel.bootstrap()`'s catch, so a failed boot never
        // reads as a live kernel.
        try {
            await this.triggerHookOrThrow('kernel:ready');
        } catch (error) {
            this.state = 'stopped';
            throw error;
        }
        // Trigger bootstrapped hook — "all synchronous bootstrap has settled"
        // anchor, strictly after every kernel:ready handler has settled and
        // before any HTTP socket opens. NOTE: does not guarantee background app
        // seed data has settled — subscribe `app:seeded` for that
        // (see plugin-lifecycle-events.ts).
        await this.triggerHook('kernel:bootstrapped');
        // Trigger listening hook (HTTP servers open their socket here —
        // strictly after every kernel:ready handler has completed).
        await this.triggerHook('kernel:listening');
        this.logger.info('✅ Bootstrap complete', { 
            pluginCount: this.plugins.size 
        });
    }

    /**
     * Shutdown the kernel
     * Calls destroy on all plugins in reverse order
     */
    async shutdown(): Promise<void> {
        await this.destroy();
    }

    /**
     * Graceful shutdown - destroy all plugins in reverse order
     */
    async destroy(): Promise<void> {
        if (this.state === 'stopped') {
            this.logger.warn('Kernel already stopped');
            return;
        }

        this.state = 'stopping';
        this.logger.info('Shutdown started');

        // Trigger shutdown hook
        await this.triggerHook('kernel:shutdown');

        // Destroy plugins in reverse order
        const orderedPlugins = this.resolveDependencies();
        for (const plugin of orderedPlugins.reverse()) {
            await this.runPluginDestroy(plugin);
        }

        this.state = 'stopped';
        this.logger.info('✅ Shutdown complete');
        
        // Cleanup logger resources
        if (this.logger && typeof (this.logger as ObjectLogger).destroy === 'function') {
            await (this.logger as ObjectLogger).destroy();
        }
    }

    /**
     * Get a service from the registry
     * Convenience method for external access
     */
    getService<T>(name: string): T {
        return this.context.getService<T>(name);
    }

    /**
     * Check if kernel is running
     */
    isRunning(): boolean {
        return this.state === 'running';
    }
}
