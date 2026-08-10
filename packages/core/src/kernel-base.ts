// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from './types.js';
import type { Logger } from '@objectstack/spec/contracts';
import type { IServiceRegistry } from '@objectstack/spec/contracts';
import {
    resolvePluginOrder,
    validateInitServiceContract,
    assertInitServiceRequirements,
    describeInitOrderFault,
} from './plugin-order.js';
import { dispatchHookIsolating, dispatchHookPropagating } from './hook-dispatch.js';

/**
 * Kernel state machine
 */
export type KernelState = 'idle' | 'initializing' | 'running' | 'stopping' | 'stopped';

/**
 * ObjectKernelBase - Abstract Base Class for Microkernel
 * 
 * Provides common functionality for ObjectKernel and LiteKernel:
 * - Plugin management (Map storage)
 * - Dependency resolution (topological sort)
 * - Hook/Event system
 * - Context creation
 * - State validation
 * 
 * This eliminates code duplication between the implementations.
 */
export abstract class ObjectKernelBase {
    protected plugins: Map<string, Plugin> = new Map();
    protected services: IServiceRegistry | Map<string, any> = new Map();
    protected hooks: Map<string, Array<(...args: any[]) => void | Promise<void>>> = new Map();
    protected state: KernelState = 'idle';
    protected logger: Logger;
    protected context!: PluginContext;
    /**
     * Name of the plugin whose init() is currently executing (Phase 1 runs
     * sequentially, so there is at most one). Lets a getService miss during
     * init name the structural fault (#4131) instead of only the symptom.
     */
    protected currentlyInitializing?: string;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Validate kernel state
     * @param requiredState - Required state for the operation
     * @throws Error if current state doesn't match
     */
    protected validateState(requiredState: KernelState): void {
        if (this.state !== requiredState) {
            throw new Error(
                `[Kernel] Invalid state: expected '${requiredState}', got '${this.state}'`
            );
        }
    }

    /**
     * Validate kernel is in idle state (for plugin registration)
     */
    protected validateIdle(): void {
        if (this.state !== 'idle') {
            throw new Error('[Kernel] Cannot register plugins after bootstrap has started');
        }
    }

    /**
     * Create the plugin context
     * Subclasses can override to customize context creation
     */
    protected createContext(): PluginContext {
        return {
            registerService: (name, service) => {
                if (this.services instanceof Map) {
                    if (this.services.has(name)) {
                        throw new Error(`[Kernel] Service '${name}' already registered`);
                    }
                    this.services.set(name, service);
                } else {
                    // IServiceRegistry implementation
                    this.services.register(name, service);
                }
                this.logger.info(`Service '${name}' registered`, { service: name });
            },
            getService: <T>(name: string): T => {
                if (this.services instanceof Map) {
                    const service = this.services.get(name);
                    if (!service) {
                        throw new Error(
                            `[Kernel] Service '${name}' not found${this.describeInitOrderFault(name)}`
                        );
                    }
                    return service as T;
                } else {
                    // IServiceRegistry implementation
                    return this.services.get<T>(name);
                }
            },
            replaceService: <T>(name: string, implementation: T): void => {
                if (this.services instanceof Map) {
                    if (!this.services.has(name)) {
                        throw new Error(`[Kernel] Service '${name}' not found. Use registerService() to add new services.`);
                    }
                    this.services.set(name, implementation);
                } else {
                    // IServiceRegistry implementation
                    if (!this.services.has(name)) {
                        throw new Error(`[Kernel] Service '${name}' not found. Use registerService() to add new services.`);
                    }
                    this.services.register(name, implementation);
                }
                this.logger.info(`Service '${name}' replaced`, { service: name });
            },
            hook: (name, handler) => {
                if (!this.hooks.has(name)) {
                    this.hooks.set(name, []);
                }
                this.hooks.get(name)!.push(handler);
            },
            // PROPAGATING dispatch, and deliberately WITHOUT the trace line the
            // kernel's own dispatch sites emit — `context.trigger` has never
            // logged one, so no logger is handed over (#5282).
            trigger: async (name, ...args) => {
                await dispatchHookPropagating(name, this.hooks.get(name) || [], undefined, args);
            },
            getServices: () => {
                if (this.services instanceof Map) {
                    return new Map(this.services);
                } else {
                    // For IServiceRegistry, we need to return the underlying Map
                    // This is a compatibility method
                    return new Map();
                }
            },
            logger: this.logger,
            getKernel: () => this as any,
            registerServiceFactory: (_name, _factory, _lifecycle, _dependencies) => {
                throw new Error('[KernelBase] registerServiceFactory not supported — use ObjectKernel');
            },
            getServiceScoped: async <T>(_name: string, _scopeId: string): Promise<T> => {
                throw new Error('[KernelBase] getServiceScoped not supported — use ObjectKernel');
            },
        };
    }

    /**
     * Resolve plugin dependencies using topological sort — `dependencies`
     * hard, `optionalDependencies` order-if-present (ADR-0116, #4131). One
     * implementation shared with ObjectKernel via `plugin-order.ts`.
     * @returns Ordered list of plugins (dependencies first)
     */
    protected resolveDependencies(): Plugin[] {
        return resolvePluginOrder(this.plugins);
    }

    /**
     * Whether a service is registered on this kernel right now. Backs the
     * init-service contract checks (#4131).
     */
    protected hasRegisteredService(name: string): boolean {
        // Both the plain Map and IServiceRegistry expose `has`.
        return this.services.has(name);
    }

    /**
     * Pre-Phase-1 ordering validation (ADR-0116, #4131): a plugin whose
     * `requiresServices` names a service provided only by a LATER plugin is
     * a named boot error before any init side effects.
     */
    protected validateInitServices(ordered: Plugin[]): void {
        validateInitServiceContract(ordered, (name) => this.hasRegisteredService(name));
    }

    /**
     * When a getService miss happens while a plugin's init() is running,
     * append the structural diagnosis (#4131): which plugin was initializing,
     * and — when a composed plugin declares the service — who provides it.
     * Empty string outside Phase 1, so non-boot messages stay unchanged.
     */
    protected describeInitOrderFault(serviceName: string): string {
        return describeInitOrderFault(this.currentlyInitializing, this.plugins.values(), serviceName);
    }

    /**
     * Run plugin init phase
     * @param plugin - Plugin to initialize
     */
    protected async runPluginInit(plugin: Plugin): Promise<void> {
        const pluginName = plugin.name;
        this.logger.info(`Initializing plugin: ${pluginName}`);

        // Authoritative init-service check (#4131): Phase 1 is sequential,
        // so a required service absent NOW is absent for this init.
        assertInitServiceRequirements(plugin, (name) => this.hasRegisteredService(name));

        this.currentlyInitializing = pluginName;
        try {
            await plugin.init(this.context);
            this.logger.info(`Plugin initialized: ${pluginName}`);
        } catch (error) {
            this.logger.error(`Plugin init failed: ${pluginName}`, error as Error);
            throw error;
        } finally {
            this.currentlyInitializing = undefined;
        }
    }

    /**
     * Run plugin start phase
     * @param plugin - Plugin to start
     */
    protected async runPluginStart(plugin: Plugin): Promise<void> {
        if (!plugin.start) return;
        
        const pluginName = plugin.name;
        this.logger.info(`Starting plugin: ${pluginName}`);
        
        try {
            await plugin.start(this.context);
            this.logger.info(`Plugin started: ${pluginName}`);
        } catch (error) {
            this.logger.error(`Plugin start failed: ${pluginName}`, error as Error);
            throw error;
        }
    }

    /**
     * Run plugin destroy phase
     * @param plugin - Plugin to destroy
     */
    protected async runPluginDestroy(plugin: Plugin): Promise<void> {
        if (!plugin.destroy) return;
        
        const pluginName = plugin.name;
        this.logger.info(`Destroying plugin: ${pluginName}`);
        
        try {
            await plugin.destroy();
            this.logger.info(`Plugin destroyed: ${pluginName}`);
        } catch (error) {
            this.logger.error(`Plugin destroy failed: ${pluginName}`, error as Error);
            throw error;
        }
    }

    /**
     * Trigger a hook with all registered handlers, ISOLATING failures: a
     * handler that throws is logged and the remaining handlers still run.
     *
     * Use this for hooks where one subscriber's failure must not deny the
     * others their turn — notification-style hooks, and `kernel:shutdown`,
     * where the handlers still queued behind the failing one are the cleanup
     * that flushes buffers and releases resources (#5257).
     *
     * It is the WRONG dispatcher for anything on the BOOT path. Every hook
     * dispatched before "✅ Bootstrap complete" is a precondition of that
     * claim, so swallowing a throw there does not rescue the boot — it only
     * hides the failure behind a process that reports success. Those hooks
     * (`kernel:ready`, `kernel:bootstrapped`, `kernel:listening`) use
     * {@link triggerHookOrThrow} (#5170, #5257).
     *
     * The loop itself lives in {@link dispatchHookIsolating} — one
     * implementation shared with `ObjectKernel`'s own `kernel:shutdown`
     * dispatch, which cannot inherit this method (`ObjectKernel` does not
     * extend this class) and used to hand-mirror it (#5282).
     *
     * @param name - Hook name
     * @param args - Arguments to pass to handlers
     */
    protected async triggerHook(name: string, ...args: any[]): Promise<void> {
        await dispatchHookIsolating(name, this.hooks.get(name) || [], this.logger, args);
    }

    /**
     * Trigger a hook with all registered handlers, PROPAGATING the first
     * failure: the remaining handlers do not run and the original error
     * reaches the caller unwrapped.
     *
     * This is the dispatch semantics `ObjectKernel` has always had for every
     * lifecycle hook (its `context.trigger` is a bare awaited loop that never
     * catches). `LiteKernel` used the isolating {@link triggerHook} for all of
     * them, so one hook name meant two opposite things depending on which
     * kernel booted the same plugin code (#5170).
     *
     * `LiteKernel` now uses this dispatcher for all three BOOT-path hooks:
     *
     * - `kernel:ready` (#5170) — the only correct moment for a plugin to
     *   assert that the preconditions it declared were actually met (the
     *   registries are still filling during `init()`), so "declared but not
     *   deliverable ⇒ refuse to boot" gates live there. On LiteKernel, which
     *   is what vitest/serverless/edge run, they were downgraded to an error
     *   log while the process carried on serving traffic without the
     *   guarantee it claimed.
     * - `kernel:bootstrapped` and `kernel:listening` (#5257) — the same
     *   argument one hook later. `kernel:listening` is where HTTP server
     *   plugins open their socket, so a swallowed failure there produced the
     *   worst shape available: a live process printing "✅ Bootstrap complete"
     *   with nothing listening. `kernel:bootstrapped` carries reconcile and
     *   audit passes whose silent failure is a quieter version of the same
     *   lie.
     *
     * Deliberately NOT applied to `kernel:shutdown`, which keeps
     * {@link triggerHook}: on the teardown path a failing handler must not
     * block the cleanup queued behind it. That is a per-hook judgement
     * recorded at the dispatch site in `lite-kernel.ts`, not an inherited
     * default — and it is the reason this dispatcher is chosen per hook rather
     * than swapped in wholesale.
     *
     * The loop itself lives in {@link dispatchHookPropagating} — the same
     * function `PluginContext.trigger` runs on both kernels, so "propagating"
     * means one thing repo-wide (#5282).
     *
     * @param name - Hook name
     * @param args - Arguments to pass to handlers
     */
    protected async triggerHookOrThrow(name: string, ...args: any[]): Promise<void> {
        await dispatchHookPropagating(name, this.hooks.get(name) || [], this.logger, args);
    }

    /**
     * Get current kernel state
     */
    getState(): KernelState {
        return this.state;
    }

    /**
     * Get all registered plugins
     */
    getPlugins(): Map<string, Plugin> {
        return new Map(this.plugins);
    }

    /**
     * Abstract methods to be implemented by subclasses
     */
    abstract use(plugin: Plugin): this | Promise<this>;
    abstract bootstrap(): Promise<void>;
    abstract destroy(): Promise<void>;
}
