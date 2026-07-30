// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from './types.js';
import { createLogger, ObjectLogger } from './logger.js';
import type { LoggerConfig } from '@objectstack/spec/system';
import { ServiceRequirementDef } from '@objectstack/spec/system';
import { PluginLoader, PluginMetadata, ServiceLifecycle, ServiceFactory, PluginStartupResult } from './plugin-loader.js';
import { isNode, safeExit } from './utils/env.js';
import { CORE_FALLBACK_FACTORIES } from './fallbacks/index.js';

/**
 * Enhanced Kernel Configuration
 */
export interface ObjectKernelConfig {
    logger?: Partial<LoggerConfig>;
    
    /** Default plugin startup timeout in milliseconds */
    defaultStartupTimeout?: number;
    
    /** Whether to enable graceful shutdown */
    gracefulShutdown?: boolean;
    
    /** Graceful shutdown timeout in milliseconds */
    shutdownTimeout?: number;
    
    /** Whether to rollback on startup failure */
    rollbackOnFailure?: boolean;
    
    /** Whether to skip strict system requirement validation (Critical for testing) */
    skipSystemValidation?: boolean;
}

/**
 * Enhanced ObjectKernel with Advanced Plugin Management
 * 
 * Extends the basic ObjectKernel with:
 * - Async plugin loading with validation
 * - Version compatibility checking
 * - Plugin signature verification
 * - Configuration validation (Zod)
 * - Factory-based dependency injection
 * - Service lifecycle management (singleton/transient/scoped)
 * - Circular dependency detection
 * - Lazy loading services
 * - Graceful shutdown
 * - Plugin startup timeout control
 * - Startup failure rollback
 * - Plugin health checks
 */
export class ObjectKernel {
    private plugins: Map<string, PluginMetadata> = new Map();
    private services: Map<string, any> = new Map();
    private hooks: Map<string, Array<(...args: any[]) => void | Promise<void>>> = new Map();
    private state: 'idle' | 'initializing' | 'running' | 'stopping' | 'stopped' = 'idle';
    private logger: ObjectLogger;
    private context: PluginContext;
    private pluginLoader: PluginLoader;
    private config: ObjectKernelConfig;
    private startedPlugins: Set<string> = new Set();
    private pluginStartTimes: Map<string, number> = new Map();
    private shutdownHandlers: Array<() => Promise<void>> = [];

    constructor(config: ObjectKernelConfig = {}) {
        this.config = {
            defaultStartupTimeout: 30000, // 30 seconds
            gracefulShutdown: true,
            shutdownTimeout: 60000, // 60 seconds
            rollbackOnFailure: true,
            ...config,
        };

        this.logger = createLogger(config.logger);
        this.pluginLoader = new PluginLoader(this.logger);
        
        // Initialize context
        this.context = {
            registerService: (name, service) => {
                this.registerService(name, service);
            },
            registerServiceFactory: (name, factory, lifecycle, dependencies) => {
                this.registerServiceFactory(name, factory, lifecycle, dependencies);
            },
            getService: <T>(name: string) => {
                // 1. Try direct service map first (synchronous cache)
                const service = this.services.get(name);
                if (service) {
                    return service as T;
                }

                // 2. Try to get from plugin loader cache (Sync access to factories)
                const loaderService = this.pluginLoader.getServiceInstance<T>(name);
                if (loaderService) {
                    // Cache it locally for faster next access
                    this.services.set(name, loaderService);
                    return loaderService;
                }

                // 3. Neither sync map has it. Two very different faults share
                //    this branch and MUST NOT share one message (#4085):
                //      (a) nothing ever registered `name` — a composition /
                //          ordering fault at the CALLER (e.g. a plugin reaching
                //          for `manifest` in init() before the engine plugin
                //          registered it);
                //      (b) `name` IS registered, as a factory that has not been
                //          instantiated yet — the caller merely used the wrong
                //          accessor and needs `getServiceAsync`.
                //    `pluginLoader.getService` is an `async` method, so its
                //    return value is ALWAYS a Promise and its internal
                //    "not found" rejection can never surface synchronously.
                //    Reading (a) off that Promise therefore reported every
                //    missing service as "is async - use await" — the wrong fix,
                //    pointing at the wrong layer. Decide from the registry
                //    instead, which is synchronous and authoritative.
                if (!this.pluginLoader.hasService(name)) {
                    throw new Error(`[Kernel] Service '${name}' not found`);
                }

                // Registered but not instantiated ⇒ factory-backed. Message
                // kept verbatim: callers that tolerate an async-only service
                // (console static assets, the HTTP dispatcher) match on
                // `is async`.
                throw new Error(`Service '${name}' is async - use await`);
            },
            replaceService: <T>(name: string, implementation: T): void => {
                const hasService = this.services.has(name) || this.pluginLoader.hasService(name);
                if (!hasService) {
                    throw new Error(`[Kernel] Service '${name}' not found. Use registerService() to add new services.`);
                }
                this.services.set(name, implementation);
                this.pluginLoader.replaceService(name, implementation);
                this.logger.info(`Service '${name}' replaced`, { service: name });
            },
            hook: (name, handler) => {
                if (!this.hooks.has(name)) {
                    this.hooks.set(name, []);
                }
                this.hooks.get(name)!.push(handler);
            },
            trigger: async (name, ...args) => {
                const handlers = this.hooks.get(name) || [];
                for (const handler of handlers) {
                    await handler(...args);
                }
            },
            getServices: () => {
                return new Map(this.services);
            },
            getServiceScoped: <T>(name: string, scopeId: string): Promise<T> => {
                return this.pluginLoader.getService<T>(name, scopeId);
            },
            logger: this.logger,
            getKernel: () => this as any, // Type compatibility
        };

        this.pluginLoader.setContext(this.context);

        // Register shutdown handler
        if (this.config.gracefulShutdown) {
            this.registerShutdownSignals();
        }
    }

    /**
     * Register a plugin with enhanced validation
     */
    async use(plugin: Plugin): Promise<this> {
        if (this.state !== 'idle') {
            throw new Error('[Kernel] Cannot register plugins after bootstrap has started');
        }

        // Load plugin through enhanced loader
        const result = await this.pluginLoader.loadPlugin(plugin);
        
        if (!result.success || !result.plugin) {
            throw new Error(`Failed to load plugin: ${plugin.name} - ${result.error?.message}`);
        }

        const pluginMeta = result.plugin;
        this.plugins.set(pluginMeta.name, pluginMeta);
        
        this.logger.info(`Plugin registered: ${pluginMeta.name}@${pluginMeta.version}`, {
            plugin: pluginMeta.name,
            version: pluginMeta.version,
        });

        return this;
    }

    /**
     * Register a service instance directly
     */
    registerService<T>(name: string, service: T): this {
        if (this.services.has(name)) {
            throw new Error(`[Kernel] Service '${name}' already registered`);
        }
        this.services.set(name, service);
        this.pluginLoader.registerService(name, service);
        this.logger.info(`Service '${name}' registered`, { service: name });
        return this;
    }

    /**
     * Register a service factory with lifecycle management
     */
    registerServiceFactory<T>(
        name: string,
        factory: ServiceFactory<T>,
        lifecycle: ServiceLifecycle = ServiceLifecycle.SINGLETON,
        dependencies?: string[]
    ): this {
        this.pluginLoader.registerServiceFactory({
            name,
            factory,
            lifecycle,
            dependencies,
        });
        return this;
    }

    /**
     * Pre-inject in-memory fallbacks for 'core' services that were not registered
     * by plugins during Phase 1. Called before Phase 2 so that all core services
     * (e.g. 'metadata', 'cache', 'queue') are resolvable via ctx.getService()
     * when plugin start() methods execute.
     */
    private preInjectCoreFallbacks() {
        if (this.config.skipSystemValidation) return;
        for (const [serviceName, criticality] of Object.entries(ServiceRequirementDef)) {
            if (criticality !== 'core') continue;
            const hasService = this.services.has(serviceName) || this.pluginLoader.hasService(serviceName);
            if (!hasService) {
                const factory = CORE_FALLBACK_FACTORIES[serviceName];
                if (factory) {
                    const fallback = factory();
                    this.registerService(serviceName, fallback);
                    this.logger.debug(`[Kernel] Pre-injected in-memory fallback for '${serviceName}' before Phase 2`);
                }
            }
        }
    }

    /**
     * Validate Critical System Requirements
     */
    private validateSystemRequirements() {
        if (this.config.skipSystemValidation) {
            this.logger.debug('System requirement validation skipped');
            return;
        }

        this.logger.debug('Validating system service requirements...');
        const missingServices: string[] = [];
        const missingCoreServices: string[] = [];
        
        // Iterate through all defined requirements
        for (const [serviceName, criticality] of Object.entries(ServiceRequirementDef)) {
            const hasService = this.services.has(serviceName) || this.pluginLoader.hasService(serviceName);
            
            if (!hasService) {
                if (criticality === 'required') {
                    this.logger.error(`CRITICAL: Required service missing: ${serviceName}`);
                    missingServices.push(serviceName);
                } else if (criticality === 'core') {
                    // Auto-inject in-memory fallback if available
                    const factory = CORE_FALLBACK_FACTORIES[serviceName];
                    if (factory) {
                        const fallback = factory();
                        this.registerService(serviceName, fallback);
                        this.logger.warn(`Service '${serviceName}' not provided — using in-memory fallback`);
                    } else {
                        this.logger.warn(`CORE: Core service missing, functionality may be degraded: ${serviceName}`);
                        missingCoreServices.push(serviceName);
                    }
                } else {
                    this.logger.info(`Info: Optional service not present: ${serviceName}`);
                }
            }
        }

        if (missingServices.length > 0) {
            const errorMsg = `System failed to start. Missing critical services: ${missingServices.join(', ')}`;
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        if (missingCoreServices.length > 0) {
            this.logger.warn(`System started with degraded capabilities. Missing core services: ${missingCoreServices.join(', ')}`);
        }
        
        this.logger.info('System requirement check passed');
    }

    /**
     * Bootstrap the kernel with enhanced features
     */
    async bootstrap(): Promise<void> {
        if (this.state !== 'idle') {
            throw new Error('[Kernel] Kernel already bootstrapped');
        }

        this.state = 'initializing';
        this.logger.info('Bootstrap started');

        try {
            // Check for circular dependencies
            const cycles = this.pluginLoader.detectCircularDependencies();
            if (cycles.length > 0) {
                this.logger.warn('Circular service dependencies detected:', { cycles });
            }

            // Resolve plugin dependencies
            const orderedPlugins = this.resolveDependencies();

            // Phase 1: Init - Plugins register services
            this.logger.info('Phase 1: Init plugins');
            for (const plugin of orderedPlugins) {
                await this.initPluginWithTimeout(plugin);
            }

            // Pre-inject in-memory fallbacks for 'core' services that were not
            // registered by any plugin during Phase 1. This ensures services like
            // 'metadata', 'cache', 'queue', etc. are always available when plugins
            // call ctx.getService() during their start() methods.
            this.preInjectCoreFallbacks();

            // Phase 2: Start - Plugins execute business logic
            this.logger.info('Phase 2: Start plugins');
            this.state = 'running';
            
            for (const plugin of orderedPlugins) {
                const result = await this.startPluginWithTimeout(plugin);
                
                if (!result.success) {
                    this.logger.error(`Plugin startup failed: ${plugin.name}`, result.error);
                    const origMsg = result.error instanceof Error ? result.error.message : String(result.error);
                    const origStack = result.error instanceof Error ? result.error.stack : '';
                    console.error(`[Kernel] Plugin startup failed: ${plugin.name}`, origMsg, origStack);

                    if (this.config.rollbackOnFailure) {
                        this.logger.warn('Rolling back started plugins...');
                        await this.rollbackStartedPlugins();
                        // Propagate the original cause through the thrown error
                        // so callers (e.g. cloud auth-proxy) can surface the
                        // real failure instead of an opaque "rollback complete"
                        // string. Without this, every kernel-boot failure looks
                        // identical from the outside.
                        const err: any = new Error(
                            `Plugin ${plugin.name} failed to start - rollback complete: ${origMsg}`,
                        );
                        if (result.error instanceof Error) {
                            err.cause = result.error;
                            err.originalStack = origStack;
                        }
                        throw err;
                    }
                }
            }

            // Phase 3: Trigger kernel:ready hook
            this.validateSystemRequirements(); // Final check before ready
            this.logger.debug('Triggering kernel:ready hook');
            await this.context.trigger('kernel:ready');

            // Phase 3.5: Trigger kernel:bootstrapped AFTER every kernel:ready
            // handler has settled — the "all synchronous bootstrap has settled"
            // anchor. Reconcile/backfill work that consumes data produced by a
            // later-starting plugin's kernel:ready handler belongs here, not in
            // kernel:ready (where handler order would race the data). NOTE: this
            // does NOT guarantee background app seed data has settled (an inline
            // seed that overruns OS_INLINE_SEED_BUDGET_MS finishes later) —
            // subscribe `app:seeded` for that. See
            // packages/spec/src/contracts/plugin-lifecycle-events.ts.
            this.logger.debug('Triggering kernel:bootstrapped hook');
            await this.context.trigger('kernel:bootstrapped');

            // Phase 4: Trigger kernel:listening hook AFTER all kernel:ready
            // handlers have completed. This is the cue for HTTP server
            // plugins to actually open the listening socket — by now every
            // other plugin has finished registering routes/middleware.
            // See `kernel:listening` docs in
            // packages/spec/src/contracts/plugin-lifecycle-events.ts
            // for the race-condition rationale.
            this.logger.debug('Triggering kernel:listening hook');
            await this.context.trigger('kernel:listening');

            this.logger.info('✅ Bootstrap complete');
        } catch (error) {
            this.state = 'stopped';
            throw error;
        }
    }

    /**
     * Graceful shutdown with timeout
     */
    async shutdown(): Promise<void> {
        if (this.state === 'stopped' || this.state === 'stopping') {
            this.logger.warn('Kernel already stopped or stopping');
            return;
        }

        if (this.state !== 'running') {
            throw new Error('[Kernel] Kernel not running');
        }

        this.state = 'stopping';
        this.logger.info('Graceful shutdown started');

        try {
            const shutdownPromise = this.performShutdown();
            const timeoutPromise = new Promise<void>((_, reject) => {
                const t = setTimeout(() => {
                    reject(new Error('Shutdown timeout exceeded'));
                }, this.config.shutdownTimeout);
                // Don't let this timer keep the event loop alive
                if (t.unref) t.unref();
            });

            await Promise.race([shutdownPromise, timeoutPromise]);

            this.state = 'stopped';
            this.logger.info('✅ Graceful shutdown complete');
        } catch (error) {
            this.logger.error('Shutdown timed out — forcing exit', error as Error);
            this.state = 'stopped';
            // Flush logger then hard-exit; the process would otherwise hang
            await this.logger.destroy();
            process.exit(1);
        } finally {
            await this.logger.destroy();
        }
    }

    /**
     * Check health of a specific plugin
     */
    async checkPluginHealth(pluginName: string): Promise<any> {
        return await this.pluginLoader.checkPluginHealth(pluginName);
    }

    /**
     * Check health of all plugins
     */
    async checkAllPluginsHealth(): Promise<Map<string, any>> {
        const results = new Map();
        
        for (const pluginName of this.plugins.keys()) {
            const health = await this.checkPluginHealth(pluginName);
            results.set(pluginName, health);
        }
        
        return results;
    }

    /**
     * Get plugin startup metrics
     */
    getPluginMetrics(): Map<string, number> {
        return new Map(this.pluginStartTimes);
    }

    /**
     * Whether a plugin with the given name has been registered on this kernel.
     *
     * Registration happens synchronously in `use()` before any plugin's
     * `start()` runs, so a plugin may use this during its own start() to make
     * composition-dependent decisions deterministically — e.g. the dispatcher
     * bridge cedes `${prefix}/discovery` to `com.objectstack.rest.api` when
     * both are mounted (ADR-0076 D11: single owner per route, not
     * first-registration-wins).
     */
    hasPlugin(name: string): boolean {
        return this.plugins.has(name);
    }

    /**
     * Get a service (sync helper)
     */
    getService<T>(name: string): T {
        return this.context.getService<T>(name);
    }

    /**
     * Get a service asynchronously (supports factories)
     */
    async getServiceAsync<T>(name: string, scopeId?: string): Promise<T> {
        return await this.pluginLoader.getService<T>(name, scopeId);
    }

    /**
     * Clear all scoped service instances for a given scope (e.g., environmentId).
     * Releases driver connections and metadata caches for idle projects.
     */
    clearScope(scopeId: string): void {
        this.pluginLoader.clearScope(scopeId);
    }

    /**
     * Check if kernel is running
     */
    isRunning(): boolean {
        return this.state === 'running';
    }

    /**
     * Get kernel state
     */
    getState(): string {
        return this.state;
    }

    // Private methods

    private async initPluginWithTimeout(plugin: PluginMetadata): Promise<void> {
        const timeout = plugin.startupTimeout || this.config.defaultStartupTimeout!;
        
        this.logger.debug(`Init: ${plugin.name}`, { plugin: plugin.name });
        
        const initPromise = plugin.init(this.context);
        const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Plugin ${plugin.name} init timeout after ${timeout}ms`));
            }, timeout);
        });

        await Promise.race([initPromise, timeoutPromise]);
    }

    private async startPluginWithTimeout(plugin: PluginMetadata): Promise<PluginStartupResult> {
        if (!plugin.start) {
            return { success: true, pluginName: plugin.name };
        }

        const timeout = plugin.startupTimeout || this.config.defaultStartupTimeout!;
        const startTime = Date.now();
        
        this.logger.debug(`Start: ${plugin.name}`, { plugin: plugin.name });
        
        try {
            const startPromise = plugin.start(this.context);
            const timeoutPromise = new Promise<void>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Plugin ${plugin.name} start timeout after ${timeout}ms`));
                }, timeout);
            });

            await Promise.race([startPromise, timeoutPromise]);
            
            const duration = Date.now() - startTime;
            this.startedPlugins.add(plugin.name);
            this.pluginStartTimes.set(plugin.name, duration);
            
            this.logger.debug(`Plugin started: ${plugin.name} (${duration}ms)`);
            
            return {
                success: true,
                pluginName: plugin.name,
                startTime: duration,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            const isTimeout = (error as Error).message.includes('timeout');
            
            return {
                success: false,
                pluginName: plugin.name,
                error: error as Error,
                startTime: duration,
                timedOut: isTimeout,
            };
        }
    }

    private async rollbackStartedPlugins(): Promise<void> {
        const pluginsToRollback = Array.from(this.startedPlugins).reverse();
        
        for (const pluginName of pluginsToRollback) {
            const plugin = this.plugins.get(pluginName);
            if (plugin?.destroy) {
                try {
                    this.logger.debug(`Rollback: ${pluginName}`);
                    await plugin.destroy();
                } catch (error) {
                    this.logger.error(`Rollback failed for ${pluginName}`, error as Error);
                }
            }
        }
        
        this.startedPlugins.clear();
    }

    private async performShutdown(): Promise<void> {
        // Trigger shutdown hook
        await this.context.trigger('kernel:shutdown');

        // Destroy plugins in reverse order
        const orderedPlugins = Array.from(this.plugins.values()).reverse();
        for (const plugin of orderedPlugins) {
            if (plugin.destroy) {
                this.logger.debug(`Destroy: ${plugin.name}`, { plugin: plugin.name });
                try {
                    await plugin.destroy();
                } catch (error) {
                    this.logger.error(`Error destroying plugin ${plugin.name}`, error as Error);
                }
            }
        }

        // Execute custom shutdown handlers
        for (const handler of this.shutdownHandlers) {
            try {
                await handler();
            } catch (error) {
                this.logger.error('Shutdown handler error', error as Error);
            }
        }
    }

    private resolveDependencies(): PluginMetadata[] {
        const resolved: PluginMetadata[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (pluginName: string) => {
            if (visited.has(pluginName)) return;
            
            if (visiting.has(pluginName)) {
                throw new Error(`[Kernel] Circular dependency detected: ${pluginName}`);
            }

            const plugin = this.plugins.get(pluginName);
            if (!plugin) {
                throw new Error(`[Kernel] Plugin '${pluginName}' not found`);
            }

            visiting.add(pluginName);

            // Visit dependencies first
            const deps = plugin.dependencies || [];
            for (const dep of deps) {
                if (!this.plugins.has(dep)) {
                    throw new Error(`[Kernel] Dependency '${dep}' not found for plugin '${pluginName}'`);
                }
                visit(dep);
            }

            visiting.delete(pluginName);
            visited.add(pluginName);
            resolved.push(plugin);
        };

        // Visit all plugins
        for (const pluginName of this.plugins.keys()) {
            visit(pluginName);
        }

        return resolved;
    }

    private registerShutdownSignals(): void {
        const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        let shutdownInProgress = false;
        
        const handleShutdown = async (signal: string) => {
            if (shutdownInProgress) {
                this.logger.warn(`Shutdown already in progress, ignoring ${signal}`);
                return;
            }
            
            shutdownInProgress = true;
            this.logger.info(`Received ${signal} - initiating graceful shutdown`);
            
            try {
                await this.shutdown();
                safeExit(0);
            } catch (error) {
                this.logger.error('Shutdown failed', error as Error);
                safeExit(1);
            }
        };
        
        if (isNode) {
            for (const signal of signals) {
                process.on(signal, () => handleShutdown(signal));
            }
        }
    }

    /**
     * Register a custom shutdown handler
     */
    onShutdown(handler: () => Promise<void>): void {
        this.shutdownHandlers.push(handler);
    }
}
