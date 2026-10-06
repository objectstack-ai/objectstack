// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host's code-datasource set (#21922, #21944): the ONE in-memory set of
 * datasource names this host registers from code, kept on the kernel's
 * {@link CODE_DATASOURCE_NAMES_SERVICE} service.
 *
 * ## Who fills it, and when
 *
 * The two producers that register a datasource from code, each from its own
 * `init()`:
 *
 *  - `AppPlugin` — every datasource the installed artifact declares
 *    (`*.datasource.ts`), the same list its `start()` registers in the
 *    MetadataService as `origin: 'code'`;
 *  - `DefaultDatasourcePlugin` — the host's own `default`.
 *
 * `init()` is Phase 1, and Phase 1 completes before ANY `start()` runs
 * (`ObjectKernel.bootstrap()`). The datasource-admin plugin restores stored
 * rows in its `start()`, so it reads a complete set in every composition,
 * whatever order the plugins were `use()`d in. The `start()`-time in-memory
 * registrations are ordered against that restore by insertion order alone —
 * no plugin of the three declares an edge to another, and ADR-0116 is explicit
 * that registration order proves nothing — so they cannot be what the restore
 * decides from.
 *
 * ## Who reads it
 *
 *  - `@objectstack/service-datasource`'s boot restore: a stored row under a
 *    name in this set is not registered over the code definition;
 *  - `@objectstack/metadata-protocol`'s `isDeclaredCodeDatasource`: a name in
 *    this set is a code-defined datasource for the `/meta` door.
 *
 * Both read the service by name and use only `has(name)`. Neither package
 * depends on this one, and `metadata-protocol` depends on neither of the
 * others, so the kernel's service registry — the map both already resolve —
 * is the seam. That is the shape `seed-summary` (`recordSeedOutcome`,
 * `seed-summary.ts`) uses for the same reason: a boot fact rides a boundary
 * that is already crossed, and no package gains an export for it.
 *
 * ## What it is never derived from
 *
 * ⛔ A stored row's `origin`, the MetadataService slot's `origin`, the
 * connection service's retained `ConnectResult`, or a request body's
 * `origin`. The caller sets a stored row's and a body's freely, and a stored
 * row the restore registers overwrites the slot's, so each would answer what
 * was written last rather than what the host registers from code.
 *
 * ## What it does not hold
 *
 * A package installed after boot (an HTTP install, or the Phase 2 rehydrate
 * from `sys_packages`). Nothing registers such a package's datasources in the
 * MetadataService as code, so the admin door does not treat them as code
 * either; the `/meta` door's resolver reads the installed package records
 * live, beside this set.
 */

/** The kernel service the host's code-datasource set is registered under. */
export const CODE_DATASOURCE_NAMES_SERVICE = 'code-datasource-names';

/** The slice of a plugin context the producers need: the service registry. */
interface ServiceRegistryContext {
    getService<T>(name: string): T;
    registerService(name: string, service: unknown): void;
}

/**
 * Add `names` to the host's code-datasource set, registering the set on the
 * kernel the first time any producer contributes. Called from a producer's
 * `init()` only — see the module header for why the phase matters.
 *
 * `getService` throws while the service is unregistered; that miss is the
 * one case that creates the set. A name occupied by something that is not a
 * set is a composition fault, and `registerService` throws on it, loudly:
 * failing open there would leave every stored row free to shadow the code
 * definitions this set exists to protect.
 */
export function contributeCodeDatasourceNames(ctx: ServiceRegistryContext, names: Iterable<string>): void {
    let set: unknown;
    try {
        set = ctx.getService<unknown>(CODE_DATASOURCE_NAMES_SERVICE);
    } catch {
        set = undefined;
    }
    if (!(set instanceof Set)) {
        set = new Set<string>();
        ctx.registerService(CODE_DATASOURCE_NAMES_SERVICE, set);
    }
    for (const name of names) {
        if (typeof name === 'string' && name.length > 0) (set as Set<string>).add(name);
    }
}
