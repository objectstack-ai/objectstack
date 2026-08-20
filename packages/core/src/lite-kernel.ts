// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin } from './types.js';
import { createLogger, ObjectLogger } from './logger.js';
import type { LoggerConfig } from '@objectstack/spec/system';
import { ObjectKernelBase } from './kernel-base.js';
import { registerPluginByName } from './plugin-registration.js';

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
     *
     * Duplicate names OVERWRITE, with one `warn` naming both versions — the
     * declared contract in `plugin-registration.ts`, applied identically by
     * `ObjectKernel.use()` (#9864, maintainer ruling 2026-08-19).
     *
     * This method used to `throw` `[Kernel] Plugin '<name>' already
     * registered` here while `ObjectKernel` overwrote silently, so one input
     * had two meanings depending on which kernel was running — and the kernel
     * that runs in production was the silent one. The ruling converged them on
     * the behaviour that already works (an app config superseding a plugin the
     * CLI auto-registered, #9863) and made it audible rather than removing it.
     */
    use(plugin: Plugin): this {
        this.validateIdle();

        registerPluginByName(this.plugins, plugin, this.logger);

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

        // The three boot-path lifecycle hooks all use PROPAGATING dispatch,
        // identical to `ObjectKernel.bootstrap()`'s `context.trigger` (a bare
        // awaited loop that never catches): a handler that throws FAILS THE
        // BOOT on both kernels, the remaining handlers are skipped, the
        // original error reaches the caller unwrapped, and the kernel is left
        // 'stopped' rather than 'running' so a failed boot never reads as a
        // live kernel. `kernel:ready` got this in #5170; `kernel:bootstrapped`
        // and `kernel:listening` in #5257.
        //
        // Why the boot path is the wrong place to be forgiving: everything
        // between here and the log line below is a PRECONDITION of the
        // "✅ Bootstrap complete" this method is about to print. Swallowing a
        // throw does not make the boot succeed — it only makes the failure
        // invisible while `bootstrap()` resolves normally. `kernel:listening`
        // is the sharpest case: it is where HTTP server plugins actually open
        // their socket (`HonoServerPlugin` awaits `server.listen(port)` with
        // no try/catch of its own, deliberately — propagation is the correct
        // behaviour there), so a swallowed EACCES / unavailable-listen on an
        // edge or serverless host produced a live process, a cheerful
        // "Bootstrap complete", and not one socket listening.
        try {
            // Route/middleware registration phase, and the only correct moment
            // for a plugin to assert that what it DECLARED can actually be
            // delivered — the registries are still filling during init(), so a
            // boot gate has nowhere earlier to run (#5170).
            await this.triggerHookOrThrow('kernel:ready');
            // "All synchronous bootstrap has settled" anchor, strictly after
            // every kernel:ready handler has settled and before any HTTP socket
            // opens. Carries reconcile/backfill/audit work. NOTE: does not
            // guarantee background app seed data has settled — subscribe
            // `app:seeded` for that (see plugin-lifecycle-events.ts).
            await this.triggerHookOrThrow('kernel:bootstrapped');
            // HTTP servers open their listening socket here — strictly after
            // every kernel:ready and kernel:bootstrapped handler has completed.
            await this.triggerHookOrThrow('kernel:listening');
        } catch (error) {
            this.state = 'stopped';
            throw error;
        }
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

        // Trigger shutdown hook — FAIL-SOFT dispatch ({@link triggerHook}),
        // deliberately, and NOT the propagating dispatcher the boot-path hooks
        // above use (#5257). This is a per-hook judgement written down, not an
        // inherited default: on the shutdown path there is no "refuse to
        // proceed" left to buy. The remaining work — every other subscriber's
        // cleanup, then each plugin's destroy() in reverse order — is what
        // flushes buffers, closes connections and releases locks, so letting
        // one subscriber's failure abort the rest converts a single bad
        // handler into leaked resources and unflushed writes. A failing
        // shutdown handler is logged (`Hook handler failed: kernel:shutdown`)
        // and the cleanup continues.
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
