// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel } from './kernel.js';
import type { Logger, LifecycleEventName } from '@objectstack/spec/contracts';
import type { CORE_PLUGIN_TYPES, PluginDefinition } from '@objectstack/spec/kernel';

/**
 * PluginContext - Runtime context available to plugins
 * 
 * Provides access to:
 * - Service registry (registerService/getService)
 * - Event/Hook system (hook/trigger)
 * - Logger
 * - Kernel instance (for advanced use cases)
 */
export interface PluginContext {
    /**
     * Register a service that can be consumed by other plugins
     * @param name - Service name (e.g., 'db', 'http-server', 'objectql')
     * @param service - Service instance
     */
    registerService(name: string, service: any): void;

    /**
     * Register a service factory with lifecycle management.
     * Use `ServiceLifecycle.SCOPED` for per-project services — the factory
     * receives `(ctx, scopeId)` where `scopeId` is the project ID.
     */
    registerServiceFactory(name: string, factory: (ctx: PluginContext, scopeId?: string) => any, lifecycle?: import('./plugin-loader.js').ServiceLifecycle, dependencies?: string[]): void;

    /**
     * Get a service registered by another plugin
     * @param name - Service name
     * @returns Service instance
     * @throws Error if service not found
     */
    getService<T>(name: string): T;

    /**
     * Replace an existing service with a new implementation.
     * Useful for optimization plugins that wrap or swap kernel internals
     * (e.g., metadata registry, connection pooling).
     * 
     * @param name - Service name to replace
     * @param implementation - New service implementation
     * @throws Error if the service does not exist
     */
    replaceService<T>(name: string, implementation: T): void;

    /**
     * Get a scoped service instance for a given scope (e.g., environmentId).
     * Creates the instance on first access; reuses on subsequent calls within the same scope.
     */
    getServiceScoped<T>(name: string, scopeId: string): Promise<T>;

    /**
     * Get all registered services
     */
    getServices(): Map<string, any>;

    /**
     * Register a hook handler.
     *
     * Known lifecycle-bus names (see `IPluginLifecycleEvents` in
     * `@objectstack/spec`) autocomplete; the bus stays open to custom
     * cross-plugin event names, so any string remains valid.
     *
     * @param name - Hook name (e.g., 'kernel:ready', 'data:beforeInsert')
     * @param handler - Hook handler function
     */
    hook(
        name: LifecycleEventName | (string & {}),
        handler: (...args: any[]) => void | Promise<void>,
    ): void;

    /**
     * Trigger a hook
     * @param name - Hook name (known lifecycle names autocomplete; custom names stay legal)
     * @param args - Arguments to pass to hook handlers
     */
    trigger(name: LifecycleEventName | (string & {}), ...args: any[]): Promise<void>;

    /**
     * Logger instance
     */
    logger: Logger;
    
    /**
     * Get the kernel instance (for advanced use cases)
     * @returns Kernel instance
     */
    getKernel(): ObjectKernel;
}

/**
 * The closed set of plugin types (#13925): `'standard'` plus the seven
 * `CORE_PLUGIN_TYPES` members, in exactly the shape `PluginSchema.type`
 * declares in `@objectstack/spec` (`kernel/plugin.zod.ts`:
 * `z.enum(['standard', ...CORE_PLUGIN_TYPES])`). Derived from the spec's own
 * constant rather than re-spelled here, so the compiler's accept set and the
 * Zod gate's cannot drift apart: `plugin-type-closed-set.test.ts` pins the
 * parity at runtime, and `packages/rest`'s `plugin-type-closed-set.pin.test.ts`
 * pins the published `.d.ts` at compile time.
 */
export type PluginType = 'standard' | (typeof CORE_PLUGIN_TYPES)[number];

/**
 * Plugin Interface
 *
 * All ObjectStack plugins must implement this interface.
 *
 * ## Two halves, one contract (#16334)
 *
 * **The metadata half is inherited, not restated.** Every key `PluginSchema`
 * declares (`@objectstack/spec`, `kernel/plugin.zod.ts`) — `id`, `type`,
 * `staticPath`, `slug`, `default`, `version`, `description`, `author`,
 * `homepage` — arrives here through `PluginDefinition`
 * (`z.input<typeof PluginSchema>`), so the keys the compiler accepts on a
 * plugin object and the keys `kernel.use()` validates
 * (`PluginLoader.validatePluginContract`, #16049) are ONE declaration. Before
 * this the interface spelled `type` and `version` itself and declared neither
 * `staticPath` nor `slug`, so an in-repo `ui` plugin could not carry the two
 * keys the schema requires of it without widening its own type — two shapes
 * for one contract, free to drift.
 *
 * **The runtime half is declared here and only here**: `name`, the ADR-0116
 * ordering declarations, and the `init` / `start` / `destroy` lifecycle. The
 * spec's schema describes what a plugin OBJECT may say about itself, never
 * what it does.
 *
 * ### `type`
 *
 * The inherited `type` is a {@link PluginType} — the closed set the spec
 * declares (`'standard'` plus `CORE_PLUGIN_TYPES`); `packages/rest`'s
 * `plugin-type-closed-set.pin.test.ts` pins that the inherited key and the
 * exported alias are the same union. Absent means `'standard'` at the schema
 * (`.default('standard')`), and the loader never writes that default back
 * onto the object. A value outside the set no longer type-checks, and since
 * #16049 `kernel.use()` REFUSES it at boot — `assertPluginContract`
 * (`plugin-contract.ts`, run by BOTH `ObjectKernel.use()` and `LiteKernel.use()`
 * since #16721) runs `PluginSchema` over every plugin object and raises
 * `PLUGIN_CONTRACT_VIOLATION` naming the plugin and the first violated key.
 * `type: 'ui'` additionally owes `staticPath` and `slug` (#16334,
 * `PLUGIN_UI_REQUIRED_KEY_MISSING`), refused on the same path.
 *
 * ⚠️ This comment used to say a bad `type` was refused "at parse". It was
 * measured false (#16049, from #15638): `PluginSchema` had no runtime caller,
 * kernel plugin objects were never parsed, and a `type` outside the set was
 * accepted and stored verbatim. The refusal described here is the one that
 * now exists, on the boot path, and the compiler's arm is the second half
 * rather than the only one — `kernel.use(plugin as any)` is a shipped
 * in-repo pattern, and externally authored plugins never meet this compiler
 * at all.
 */
export interface Plugin extends PluginDefinition {
    /**
     * Unique plugin name (e.g., 'com.objectstack.engine.objectql')
     */
    name: string;

    /**
     * List of other plugin names that this plugin depends on.
     * The kernel ensures these plugins are initialized before this one.
     * A name that is not registered on the kernel is a boot error.
     */
    dependencies?: string[];

    /**
     * Soft dependencies — order-if-present (ADR-0116, #4131).
     * Registered names are hoisted ahead exactly like `dependencies`;
     * absent names are silently skipped instead of failing the boot.
     * For plugins that DEGRADE gracefully without the dependency but must
     * never initialize before it when both are composed (e.g. AppPlugin on
     * an engine-less metadata-only kernel).
     */
    optionalDependencies?: string[];

    /**
     * Services this plugin resolves SYNCHRONOUSLY during `init()`
     * (ADR-0116, #4131). The kernel validates the resolved order before
     * Phase 1 (a required service whose only declared provider initializes
     * later is a named boot error) and re-checks immediately before this
     * plugin's init runs. Declare only hard init-time needs — a service the
     * init merely probes behind a try/catch does not belong here.
     */
    requiresServices?: string[];

    /**
     * Services this plugin's `init()` UNCONDITIONALLY registers
     * (ADR-0116, #4131). Powers the pre-Phase-1 ordering validation and
     * lets misordering errors name the provider. Never declare a service
     * that is registered conditionally (option-gated, environment-gated):
     * the kernel would blame orderings this plugin cannot satisfy.
     */
    providesServices?: string[];

    /**
     * Init Phase: Register services
     * Called when kernel is initializing.
     * Use this to register services that other plugins might need.
     */
    init(ctx: PluginContext): Promise<void> | void;

    /**
     * Start Phase: Execute business logic
     * Called after all plugins have been initialized.
     * Use this to start servers, connect to DBs, or execute main logic.
     */
    start?(ctx: PluginContext): Promise<void> | void;

    /**
     * Destroy Phase: Cleanup
     * Called when kernel is shutting down.
     */
    destroy?(): Promise<void> | void;
}
