// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host seam for package lifecycle state: where a module's enable/disable
 * choice lives when the HOST says so, instead of the file under `OS_HOME`.
 *
 * ## Why a seam
 *
 * The default store (`./package-state-store.ts`) is a JSON file under the
 * ObjectStack home directory. A hosted container loses that file when it is
 * replaced, and a second container never sees it at all, so a module an admin
 * switched off came back on. The host owns durable storage there, so the host
 * supplies the store, and the platform asks it at the three places that read
 * or write the state: the boot seed (`AppPlugin.seedPersistedDisabledPackages`)
 * and the package doors in `./domains/packages.ts` (install, enable, disable,
 * delete), and the uninstall cleanup that clears a deleted package's record
 * ({@link ensurePackageStateUninstallCleanup}).
 *
 * ## How a host supplies it
 *
 * Through the kernel's service registry, the seam every host already composes:
 * add `createPackageStateStorePlugin(store)` to the kernel's plugins. That
 * plugin registers the store as the {@link PACKAGE_STATE_STORE_SERVICE}
 * service, and `AppPlugin` names {@link PACKAGE_STATE_STORE_PLUGIN_NAME} in its
 * `optionalDependencies` (ADR-0116), so the store is registered before the boot
 * seed reads it, whatever slot the host composes it in. A kernel without it
 * keeps the file, byte for byte.
 *
 * ⛔ Register the store through this plugin, not under the service name from a
 * plugin of your own: nothing orders an arbitrary plugin ahead of `AppPlugin`,
 * so its boot seed would read the file instead. `AppPlugin.start()` refuses
 * that composition by name rather than boot with two stores in play.
 *
 * ## What a refusal means
 *
 * A host store that throws refuses the write. The enable and disable doors
 * then change nothing in memory and answer `503 SERVICE_UNAVAILABLE`, so a
 * module is never shown as switched off while the store still holds it on
 * (cloud#3636 ruling, acceptance line 1). A store whose boot read throws fails
 * the boot. The file default keeps its own behaviour on both counts.
 */

import type { Plugin, PluginContext } from '@objectstack/core';

import { loadDisabledPackageIds, setPackageDisabled } from './package-state-store.js';

/**
 * The kernel service a host's package-state store is registered under.
 *
 * ⛔ Spelled as a literal at the init-time read in `app-plugin.ts` too, because
 * `check:init-service-contract` judges literal service names only.
 */
export const PACKAGE_STATE_STORE_SERVICE = 'package-state-store';

/**
 * The name of the plugin {@link createPackageStateStorePlugin} builds. It is
 * listed in `AppPlugin.optionalDependencies`, which is what orders the store
 * ahead of the boot seed.
 */
export const PACKAGE_STATE_STORE_PLUGIN_NAME = 'com.objectstack.package-state-store';

/**
 * Where package lifecycle state lives: the ids an operator has disabled, per
 * environment. The default is the file under `OS_HOME`; a host supplies its
 * own through {@link createPackageStateStorePlugin}.
 *
 * `environmentId` is the environment the state belongs to, `undefined` when
 * the boot or the request carries none (the file store then reads
 * `OS_ENVIRONMENT_ID`, else `default`).
 */
export interface PackageStateStore {
    /**
     * The package ids persisted as disabled for this environment. Read once
     * per boot, before any package is registered. Throwing fails the boot.
     */
    loadDisabledPackageIds(environmentId: string | undefined): Iterable<string> | Promise<Iterable<string>>;
    /**
     * Persist one package's disabled flag. Throwing refuses the write: the
     * enable and disable doors then leave the running registry unchanged and
     * answer the failure.
     */
    setPackageDisabled(environmentId: string | undefined, packageId: string, disabled: boolean): void | Promise<void>;
}

function assertPackageStateStore(store: unknown): asserts store is PackageStateStore {
    const candidate = store as Partial<PackageStateStore> | null | undefined;
    if (
        !candidate
        || typeof candidate.loadDisabledPackageIds !== 'function'
        || typeof candidate.setPackageDisabled !== 'function'
    ) {
        throw new TypeError(
            `${PACKAGE_STATE_STORE_PLUGIN_NAME}: the package-state store must implement both `
            + '`loadDisabledPackageIds(environmentId)` and `setPackageDisabled(environmentId, packageId, disabled)`.',
        );
    }
}

/** Registers a host's {@link PackageStateStore}; see the module note. */
export class PackageStateStorePlugin implements Plugin {
    readonly name = PACKAGE_STATE_STORE_PLUGIN_NAME;
    readonly type = 'standard' as const;
    /** Literal for the same reason as {@link PACKAGE_STATE_STORE_SERVICE}. */
    readonly providesServices = ['package-state-store'];

    constructor(private readonly store: PackageStateStore) {
        assertPackageStateStore(store);
    }

    init = (ctx: PluginContext): void => {
        ctx.registerService(PACKAGE_STATE_STORE_SERVICE, this.store);
    };
}

/**
 * The plugin a host adds to its kernel so package lifecycle state lives in
 * `store` instead of the file under `OS_HOME`. Throws a `TypeError` when
 * `store` does not implement {@link PackageStateStore}.
 */
export function createPackageStateStorePlugin(store: PackageStateStore): PackageStateStorePlugin {
    return new PackageStateStorePlugin(store);
}

/** The file under `OS_HOME`, as a {@link PackageStateStore}: what every kernel without a host store uses. */
export const FILE_PACKAGE_STATE_STORE: PackageStateStore = {
    loadDisabledPackageIds: (environmentId) => loadDisabledPackageIds(environmentId),
    setPackageDisabled,
};

/**
 * What a lookup of {@link PACKAGE_STATE_STORE_SERVICE} answered, as a store:
 * `undefined` when nothing is registered. A registration that is not a
 * {@link PackageStateStore} throws, so a store the host meant to supply is
 * never silently replaced by the file.
 */
export function asPackageStateStore(registered: unknown): PackageStateStore | undefined {
    if (registered == null) return undefined;
    assertPackageStateStore(registered);
    return registered;
}

/**
 * [#31023] The name the disable-record clear is registered under on the
 * protocol's uninstall-cleanup registry, and the `name` of its outcome on an
 * uninstall's `cleanups`.
 */
export const PACKAGE_STATE_UNINSTALL_CLEANUP = 'runtime.package-state';

/** The protocols this process registered the disable-record clear on — once each. */
const PACKAGE_STATE_CLEANUP_REGISTERED = new WeakSet<object>();

/**
 * [#31023, #18877 ruling item 3] Register, once per kernel, the uninstall
 * cleanup that clears the uninstalled package's disable record:
 * {@link PACKAGE_STATE_UNINSTALL_CLEANUP}, on the protocol's uninstall-cleanup
 * registry (`registerUninstallCleanup`, ADR-0086 D3).
 *
 * A package that no longer exists has no lifecycle state, so the record goes
 * with it and the next install of the id lands at its declared default. Only
 * `DELETE /api/v1/packages/:id` cleared it, after the protocol's
 * `deletePackage` answered; every in-process caller of that verb (a host's
 * own uninstall tool, install-local's pair-install undo, the unmanaged-import
 * rollback) left the record behind, so the next boot seeded the id as
 * disabled and a reinstall came up disabled with nothing saying why. Through
 * the registry, because it is the hook the verb already runs as its last step
 * (and install-local's `DELETE` runs too): `@objectstack/metadata-protocol`
 * does not know the state store, which lives here, and must not import it.
 *
 * `environmentId` is the key the boot seed reads (`AppPlugin`'s project
 * context), so the record cleared is the one the next boot would seed. The
 * store is resolved when the cleanup runs, as the package doors resolve it:
 * the host's when one is registered as {@link PACKAGE_STATE_STORE_SERVICE},
 * the file under `OS_HOME` otherwise. A store that refuses throws, and the
 * registry's one runner reports it as the cleanup's failed outcome on the
 * uninstall's response. A kernel with no protocol, or a protocol without the
 * registry, registers nothing; the package door then clears the record itself.
 * The store answers no count, so the outcome reports `removed: 0`.
 */
export function ensurePackageStateUninstallCleanup(ctx: PluginContext, environmentId: string | undefined): void {
    let protocol: { registerUninstallCleanup?: (name: string, cleanup: (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>) => void } | undefined;
    try { protocol = ctx.getService<any>('protocol'); } catch { return; }
    if (!protocol || typeof protocol.registerUninstallCleanup !== 'function') return;
    if (PACKAGE_STATE_CLEANUP_REGISTERED.has(protocol)) return;
    PACKAGE_STATE_CLEANUP_REGISTERED.add(protocol);
    protocol.registerUninstallCleanup(PACKAGE_STATE_UNINSTALL_CLEANUP, async ({ packageId }) => {
        let registered: unknown;
        try { registered = ctx.getService(PACKAGE_STATE_STORE_SERVICE); } catch { registered = undefined; }
        const store = asPackageStateStore(registered) ?? FILE_PACKAGE_STATE_STORE;
        await store.setPackageDisabled(environmentId, packageId, false);
        return { success: true, removed: 0 };
    });
}
