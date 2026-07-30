// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Plugin ordering + init-service contract (ADR-0116, #4131).
 *
 * The kernel resolves BOTH init and start order from the plugin dependency
 * graph, so `kernel.use()` registration order proves nothing. Twice a plugin
 * relied on list position anyway and shipped a boot that dies inside init —
 * the first cut of DefaultDatasourcePlugin (started after boot schema-sync;
 * server with no tables) and AppPlugin (#4085: `manifest` grabbed in init
 * before ObjectQLPlugin registered it). Both times the fix existed only as a
 * convention: put the plugin in the right slot, write a comment. This module
 * is the enforced form of that contract, shared by ObjectKernel and
 * LiteKernel so there is exactly one ordering semantic:
 *
 *  - `dependencies` — hard: hoisted ahead, missing ⇒ boot error (unchanged).
 *  - `optionalDependencies` — order-if-present: hoisted ahead when composed,
 *    silently skipped when absent. For plugins that DEGRADE without the
 *    dependency but must never init before it (AppPlugin on an engine-less
 *    metadata-only kernel).
 *  - `requiresServices` — services a plugin resolves SYNCHRONOUSLY during
 *    `init()`. Validated before Phase 1 (provable misordering ⇒ named error
 *    instead of a crash inside init) and again immediately before each init
 *    (authoritative: the service is either registered by now or init dies).
 *  - `providesServices` — services a plugin's `init()` UNCONDITIONALLY
 *    registers. Powers the pre-Phase-1 check and the named diagnostics.
 *    Declare only unconditional registrations: a conditional service (e.g.
 *    one gated behind an option) would indict this plugin for orderings it
 *    cannot actually satisfy.
 */

/**
 * The ordering-relevant surface of a kernel plugin. Structural on purpose:
 * ObjectKernel sorts `PluginMetadata`, LiteKernel sorts `Plugin`, and both
 * satisfy this shape.
 */
export interface OrderablePlugin {
    name: string;
    /** Hard dependencies — hoisted ahead; missing ⇒ boot error. */
    dependencies?: string[];
    /** Soft dependencies — hoisted ahead when composed, skipped when absent. */
    optionalDependencies?: string[];
    /** Services resolved synchronously during init(). */
    requiresServices?: string[];
    /** Services init() unconditionally registers. */
    providesServices?: string[];
}

/**
 * Topologically order plugins: every plugin's `dependencies` (throw when
 * missing) and `optionalDependencies` (skip when missing) init before it.
 * Insertion order is preserved for plugins with no edges between them.
 * Cycles through either edge kind throw — an optional dependency is a real
 * edge whenever both sides are composed.
 */
export function resolvePluginOrder<P extends OrderablePlugin>(plugins: Map<string, P>): P[] {
    const resolved: P[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (pluginName: string) => {
        if (visited.has(pluginName)) return;

        if (visiting.has(pluginName)) {
            throw new Error(`[Kernel] Circular dependency detected: ${pluginName}`);
        }

        const plugin = plugins.get(pluginName);
        if (!plugin) {
            throw new Error(`[Kernel] Plugin '${pluginName}' not found`);
        }

        visiting.add(pluginName);

        for (const dep of plugin.dependencies ?? []) {
            if (!plugins.has(dep)) {
                throw new Error(
                    `[Kernel] Dependency '${dep}' not found for plugin '${pluginName}'`
                );
            }
            visit(dep);
        }
        for (const dep of plugin.optionalDependencies ?? []) {
            if (plugins.has(dep)) visit(dep);
        }

        visiting.delete(pluginName);
        visited.add(pluginName);
        resolved.push(plugin);
    };

    for (const pluginName of plugins.keys()) {
        visit(pluginName);
    }

    return resolved;
}

/**
 * Pre-Phase-1 check: walk the resolved order and prove no plugin requires a
 * service whose only declared provider initializes AFTER it. A violation is
 * the exact #4085 class — misplaced composition — reported as a named,
 * structural boot error BEFORE any init side effects, instead of a bare
 * "Service not found" thrown from inside the victim's init.
 *
 * Deliberately does NOT fail when a required service has no declared provider
 * and is not yet registered: an earlier plugin may register it without
 * declaring `providesServices`. That case is settled authoritatively by
 * {@link assertInitServiceRequirements} immediately before the requiring
 * plugin's init runs.
 */
export function validateInitServiceContract<P extends OrderablePlugin>(
    ordered: P[],
    isServiceRegistered: (name: string) => boolean,
): void {
    const providerSlot = new Map<string, { plugin: string; slot: number }>();
    ordered.forEach((plugin, slot) => {
        for (const service of plugin.providesServices ?? []) {
            if (!providerSlot.has(service)) {
                providerSlot.set(service, { plugin: plugin.name, slot });
            }
        }
    });

    const violations: string[] = [];
    ordered.forEach((plugin, slot) => {
        for (const service of plugin.requiresServices ?? []) {
            if (isServiceRegistered(service)) continue;
            const provider = providerSlot.get(service);
            if (provider && provider.slot > slot) {
                violations.push(
                    `'${plugin.name}' requires service '${service}' during init, but '${service}' is ` +
                    `provided by '${provider.plugin}', which initializes later (slot ${provider.slot} vs ${slot}). ` +
                    `Registration order is not a contract — declare '${provider.plugin}' in ` +
                    `'${plugin.name}'.dependencies (hard) or .optionalDependencies (order-if-present) ` +
                    `so the kernel hoists it.`
                );
            }
        }
    });

    if (violations.length > 0) {
        throw new Error(
            `[Kernel] Plugin ordering contract violated (#4131):\n  - ${violations.join('\n  - ')}`
        );
    }
}

/**
 * Diagnosis suffix for a getService miss that happens WHILE a plugin's
 * init() is running: names the initializing plugin and — when a composed
 * plugin declares the service — the provider and the directive to declare
 * the ordering. Returns '' when no plugin is initializing, so non-boot
 * error messages stay byte-identical. Shared by both kernels.
 */
export function describeInitOrderFault(
    currentlyInitializing: string | undefined,
    plugins: Iterable<OrderablePlugin>,
    serviceName: string,
): string {
    if (!currentlyInitializing) return '';
    let providerHint = '';
    for (const plugin of plugins) {
        if (plugin.providesServices?.includes(serviceName)) {
            providerHint = ` '${serviceName}' is provided by composed plugin '${plugin.name}', which has ` +
                `not initialized yet — declare it in the requiring plugin's dependencies/optionalDependencies.`;
            break;
        }
    }
    return ` (while plugin '${currentlyInitializing}' was initializing — a composition/` +
        `ordering fault, #4131.${providerHint})`;
}

/**
 * Just-before-init check: every service in `requiresServices` must be
 * registered at the moment the plugin's init() is about to run. At this
 * point the verdict is authoritative — Phase 1 runs sequentially, so a
 * service absent now is absent for this init, and the init would die on a
 * bare "Service not found" anyway. This turns that crash into a named
 * composition error.
 */
export function assertInitServiceRequirements(
    plugin: OrderablePlugin,
    isServiceRegistered: (name: string) => boolean,
): void {
    for (const service of plugin.requiresServices ?? []) {
        if (isServiceRegistered(service)) continue;
        throw new Error(
            `[Kernel] Plugin '${plugin.name}' requires service '${service}' at init, but no such ` +
            `service is registered at this point of the boot. No composed plugin that initializes ` +
            `earlier provides it — compose a provider (and, if it initializes later without declaring ` +
            `'${service}' in providesServices, order it ahead via this plugin's dependencies/` +
            `optionalDependencies) (#4131).`
        );
    }
}
