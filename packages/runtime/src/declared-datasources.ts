// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28039] The ONE path that makes the datasources a package declares live
 * (ADR-0015 Addendum, ADR-0062 D1/D2/D5):
 *
 *  1. registered in the metadata registry IN MEMORY as `origin: 'code'`,
 *     stamped with the package that declares each one (ADR-0010
 *     `_packageId` / `_packageVersion`), so the admin list returns them and
 *     the admin service enforces them as read-only;
 *  2. recorded in the host's code-datasource set
 *     ({@link CODE_DATASOURCE_NAMES_SERVICE}), so the admin door and the `/meta`
 *     door treat them as code-defined;
 *  3. auto-connected through the `datasource-connection` service's
 *     `connectDeclared`, which applies the D2 gate and the host's connect
 *     policy and records each verdict (`getConnectionState`).
 *
 * Two callers, one path:
 *
 *  - `AppPlugin.start()`, for the artifact the host boots. Its names joined
 *    the set in `init()` (Phase 1, before the datasource-admin plugin's
 *    restore — `code-datasource-names.ts` says why the phase matters), so step
 *    2 is already done; a fail-fast connect verdict refuses the boot.
 *  - the install-local plugin (`@objectstack/cloud-connection`), for a package
 *    installed into a RUNNING kernel — on install and on every rehydrate
 *    ({@link PackageDatasourceOptions.installed}). Before this, that door
 *    registered the package's objects and nothing of its datasources, so an
 *    object bound to one had no driver and the name was not code-defined.
 *    Here the names join the set now, a fail-fast verdict is reported rather
 *    than thrown (there is no boot left to refuse: the datasource answers its
 *    retained non-`ok` verdict, and a read of a bound object answers
 *    `ERR_DATASOURCE_UNAVAILABLE` naming it), and the package's uninstall
 *    undoes all three steps through the `runtime.package-datasources`
 *    uninstall cleanup, as `runtime.package-jobs` does for its jobs.
 *
 * ⛔ Where a declared credential comes from is not decided here (#27687): the
 * connection service resolves `external.credentialsRef` the one way it does
 * for every datasource, and a credential it cannot resolve is its
 * `failed-credentials` verdict.
 */

import type { PluginContext } from '@objectstack/core';
import { applyProtection } from '@objectstack/spec/shared';
import {
    CODE_DATASOURCE_NAMES_SERVICE,
    contributeCodeDatasourceNames,
    withdrawCodeDatasourceNames,
} from './code-datasource-names.js';

/** The package a declared datasource is stamped with (ADR-0010). */
export interface DeclaredDatasourceOwner {
    packageId?: string;
    packageVersion?: string;
}

/** What {@link connectPackageDatasources} is given. */
export interface PackageDatasourceOptions {
    /** The app / package id, for the log lines and the uninstall record. */
    appId: string;
    /** The log tag — `AppPlugin`, `MarketplaceInstallLocal`. Defaults to `AppPlugin`. */
    source?: string;
    /** The list `connectDeclared` receives. */
    datasources: readonly any[];
    /**
     * Each declared datasource with the package that declares it — what
     * registers in the metadata registry. Defaults to {@link datasources}, each
     * stamped with `appId`. A function is resolved inside the registration's
     * lenient catch: `AppPlugin`'s ownership resolution reads the artifact's
     * package bodies, and a refusal there leaves the datasources unlisted, never
     * the boot refused.
     */
    owned?: OwnedDatasources | (() => OwnedDatasources);
    /** The package's objects: the D2 gate's explicit bindings, and the schemas synced on connect. */
    objects?: ReadonlyArray<{ name?: string; datasource?: string }>;
    /** Datasource name → the objects a `datasourceMapping` rule routes to it (D2 (d)). */
    mappedObjects?: Readonly<Record<string, readonly string[]>>;
    /**
     * The package arrived in a running kernel (install, rehydrate). The names
     * join the code-datasource set now, the datasources the previous call for
     * this `appId` registered are withdrawn first (a reinstall replaces, never
     * accumulates), a fail-fast connect verdict is reported instead of thrown,
     * and the uninstall cleanup is registered.
     */
    installed?: boolean;
}

/** Each declared datasource with the package that declares it. */
export type OwnedDatasources = ReadonlyArray<{ datasource: any; owner: DeclaredDatasourceOwner }>;

/** One declared datasource's connect verdict, as the connection service retained it. */
export interface PackageDatasourceVerdict {
    name: string;
    status: string;
}

/** The `datasource-connection` surface this path drives. */
interface ConnectionServiceLike {
    connectDeclared?: (input: {
        datasources: any[];
        objects?: ReadonlyArray<{ name?: string; datasource?: string }>;
        mappedObjects?: Readonly<Record<string, readonly string[]>>;
    }) => Promise<Array<{ name: string; status: string }>>;
    getConnectionState?: (name: string) => { name: string; status: string } | undefined;
    disconnect?: (name: string) => Promise<void>;
}

/** The uninstall cleanup's name on the protocol's registry. */
const PACKAGE_DATASOURCES_UNINSTALL_CLEANUP = 'runtime.package-datasources';

/**
 * Per kernel (keyed by its code-datasource set), the datasource names an
 * installed package's call registered — what its reinstall and its uninstall
 * withdraw. A boot artifact's are never recorded: the boot owns them.
 */
const INSTALLED_BY_APP = new WeakMap<object, Map<string, string[]>>();

/** The kernel's code-datasource set, which keys {@link INSTALLED_BY_APP}; `undefined` before any producer contributed. */
function kernelKey(ctx: PluginContext): object | undefined {
    try {
        const set = ctx.getService<unknown>(CODE_DATASOURCE_NAMES_SERVICE);
        return set !== null && typeof set === 'object' ? set : undefined;
    } catch {
        return undefined;
    }
}

/** The protocols this process registered the datasource cleanup on — once each. */
const DATASOURCE_CLEANUP_REGISTERED = new WeakSet<object>();

/**
 * Register, record and connect the datasources one package declares — see the
 * module header. Returns the connect verdict of each declared datasource the
 * connection service attempted (`[]` with no connection service, which leaves
 * them metadata-only, as a runtime without the datasource-admin plugin always
 * has).
 *
 * Throws on a boot (`installed` unset) exactly where the boot path always
 * threw: a fail-fast connect verdict (ADR-0062 D5). A registration failure is
 * logged at `warn` and the connect still runs.
 */
export async function connectPackageDatasources(
    ctx: PluginContext,
    options: PackageDatasourceOptions,
): Promise<PackageDatasourceVerdict[]> {
    const { appId, datasources } = options;
    const tag = `[${options.source ?? 'AppPlugin'}]`;
    const installed = options.installed === true;
    const ownedOf = (): OwnedDatasources =>
        typeof options.owned === 'function'
            ? options.owned()
            : options.owned ?? datasources.map((datasource) => ({ datasource, owner: { packageId: appId } }));

    if (installed) await withdrawPackageDatasources(ctx, appId);
    if (datasources.length === 0) return [];

    if (installed) {
        const names = ownedOf()
            .map(({ datasource }) => datasource?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0);
        contributeCodeDatasourceNames(ctx, names);
        const key = kernelKey(ctx);
        if (key) recordInstalled(key, appId, names);
        ensureDatasourceUninstallCleanup(ctx);
    }

    // 1. The metadata registration — lenient: a registry that refuses leaves
    //    the datasource unlisted, never the package unloaded.
    try {
        const metadata = ctx.getService('metadata') as
            | { registerInMemory?: (t: string, n: string, d: unknown) => void }
            | undefined;
        if (typeof metadata?.registerInMemory === 'function') {
            for (const { datasource: ds, owner } of ownedOf()) {
                if (!ds?.name) continue;
                metadata.registerInMemory('datasource', ds.name, applyProtection({ ...ds, origin: 'code' }, owner));
            }
            ctx.logger.info('Registered code-defined datasources in metadata registry', {
                appId,
                count: datasources.length,
            });
        }
    } catch (err) {
        ctx.logger.warn(`${tag} failed to register code-defined datasources`, {
            error: (err as Error)?.message ?? String(err),
        });
    }

    // 2. The connect. `ctx.getService` throws when a service is absent, so it is
    //    resolved defensively — a runtime without the datasource-admin plugin
    //    has no connection service, and declared datasources stay metadata-only
    //    (the legacy `onEnable` escape hatch still works). That must NOT fall
    //    into the fail-fast catch below.
    let connection: ConnectionServiceLike | undefined;
    try {
        connection = ctx.getService('datasource-connection');
    } catch {
        connection = undefined;
    }
    if (typeof connection?.connectDeclared !== 'function') {
        ctx.logger.debug('No datasource-connection service — declared datasources stay metadata-only', { appId });
        return [];
    }
    try {
        const results = await connection.connectDeclared({
            // By reference: the boot hands the connect the very list its one
            // forward conversion produced (#23029 pins the identity).
            datasources: datasources as any[],
            objects: options.objects ?? [],
            mappedObjects: options.mappedObjects ?? {},
        });
        const connected = results.filter((r) => r.status === 'connected');
        if (connected.length > 0) {
            ctx.logger.info('Auto-connected declared datasources', {
                appId,
                connected: connected.map((r) => r.name),
            });
        }
        return results.map(({ name, status }) => ({ name, status }));
    } catch (err) {
        // A fail-fast verdict (ADR-0062 D5): the datasource has no fallback
        // path — `external` + onMismatch:'fail', or objects that bind to it
        // explicitly and would otherwise fail every query with "Datasource 'x'
        // is not registered" (#3758). Other errors are already degraded inside
        // the connection service. (Single-string message: the context logger
        // types `error(message, error?)`, not a meta object.)
        ctx.logger.error(
            `${tag} declared-datasource auto-connect failed for app '${appId}': ${(err as Error)?.message ?? String(err)}`,
        );
        // On a boot the kernel surfaces the real cause and the boot is refused.
        if (!installed) throw err;
        // In a running kernel there is no boot to refuse. `connectDeclared`
        // attempted every datasource before it threw, and the connection
        // service retained each verdict and marked an unusable one on the
        // engine, so the datasource answers that verdict and a read of a bound
        // object answers `ERR_DATASOURCE_UNAVAILABLE` naming it — never a
        // silent driver gap.
        const verdicts: PackageDatasourceVerdict[] = [];
        for (const ds of datasources) {
            const state = typeof ds?.name === 'string' ? connection.getConnectionState?.(ds.name) : undefined;
            if (state) verdicts.push({ name: state.name, status: state.status });
        }
        return verdicts;
    }
}

/** Record the names an installed package's call registered, for its reinstall and uninstall. */
function recordInstalled(key: object, appId: string, names: string[]): void {
    let byApp = INSTALLED_BY_APP.get(key);
    if (!byApp) {
        byApp = new Map();
        INSTALLED_BY_APP.set(key, byApp);
    }
    if (names.length > 0) byApp.set(appId, [...names]);
    else byApp.delete(appId);
}

/**
 * Withdraw every datasource an installed package's earlier call registered:
 * its pool disconnected (the connection service's own teardown, which evicts
 * the driver and drops the retained verdict), its metadata registration
 * removed — only a registration still stamped with this package's id — and its
 * name taken out of the code-datasource set. Answers the names withdrawn and
 * the names whose metadata registration could not be removed.
 */
async function withdrawPackageDatasources(
    ctx: PluginContext,
    appId: string,
): Promise<{ removed: string[]; kept: string[]; cause?: unknown }> {
    const key = kernelKey(ctx);
    const names = (key && INSTALLED_BY_APP.get(key)?.get(appId)) ?? [];
    if (!key || names.length === 0) return { removed: [], kept: [] };

    let metadata: { get?: (t: string, n: string) => Promise<unknown>; unregister?: (t: string, n: string, o?: { notify?: boolean }) => Promise<void> } | undefined;
    try {
        metadata = ctx.getService('metadata');
    } catch {
        metadata = undefined;
    }
    let connection: ConnectionServiceLike | undefined;
    try {
        connection = ctx.getService('datasource-connection');
    } catch {
        connection = undefined;
    }
    const removed: string[] = [];
    const kept: string[] = [];
    let cause: unknown;
    for (const name of names) {
        // Never throws: a failed close is logged by the service, and the driver
        // is evicted either way.
        if (typeof connection?.disconnect === 'function') await connection.disconnect(name);
        try {
            const item = await metadata?.get?.('datasource', name);
            if ((item as { _packageId?: unknown } | undefined)?._packageId === appId) {
                await metadata?.unregister?.('datasource', name, { notify: false });
            }
            removed.push(name);
        } catch (err) {
            kept.push(name);
            cause ??= err;
        }
    }
    withdrawCodeDatasourceNames(ctx, names);
    INSTALLED_BY_APP.get(key)?.delete(appId);
    return { removed, kept, cause };
}

/**
 * Register, once per kernel, the uninstall cleanup that withdraws an installed
 * package's datasources: `runtime.package-datasources`, on the protocol's
 * uninstall-cleanup registry (`registerUninstallCleanup`, #21490) — the ONE
 * place an uninstall's data-plane revocation runs from, so the protocol's
 * `deletePackage` and install-local's `DELETE` both withdraw them with no
 * per-door copy. It acts on what {@link connectPackageDatasources} recorded for
 * the package id only, so a package that installed no datasource — and a boot
 * artifact, which records none — is a no-op.
 *
 * Never throws: a registration it could not remove is an outcome
 * (`success: false`), which both doors report on their uninstall response.
 */
function ensureDatasourceUninstallCleanup(ctx: PluginContext): void {
    let protocol: { registerUninstallCleanup?: (name: string, cleanup: (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>) => void } | undefined;
    try { protocol = ctx.getService<any>('protocol'); } catch { return; }
    if (!protocol || typeof protocol.registerUninstallCleanup !== 'function') return;
    if (DATASOURCE_CLEANUP_REGISTERED.has(protocol)) return;
    DATASOURCE_CLEANUP_REGISTERED.add(protocol);
    const logger = ctx.logger;
    protocol.registerUninstallCleanup(PACKAGE_DATASOURCES_UNINSTALL_CLEANUP, async ({ packageId }) => {
        const { removed, kept, cause } = await withdrawPackageDatasources(ctx, packageId);
        if (kept.length === 0) return { success: true, removed: removed.length };
        logger?.warn?.(
            `[uninstall] the metadata registration of datasource(s) ${kept.map((n) => `'${n}'`).join(', ')} of `
            + `${packageId} could not be removed (${(cause as Error)?.message ?? String(cause)}) — their pools are `
            + 'closed, but Setup → Datasources lists them until the runtime restarts.',
        );
        return {
            success: false,
            removed: removed.length,
            error: `${kept.length} datasource registration(s) of the uninstalled package stay listed until the runtime restarts: `
                + kept.map((n) => `'${n}'`).join(', '),
        };
    });
}
