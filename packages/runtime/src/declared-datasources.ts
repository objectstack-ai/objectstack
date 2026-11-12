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
 *
 * [#28143] An installed package never takes over a name another holder owns.
 * {@link datasourceNameHolder} is the ONE judge of "who holds this name": the
 * install door refuses on it before any write (`409` held, `503` when a holder
 * cannot be read), and an installed call — the rehydrate above all, which
 * replays packages installed before the door judged names at all — leaves a
 * held name alone and reports it, rather than registering it as code over the
 * holder's registration, recording it in the code-datasource set and answering
 * the holder's pool as its own. The uninstall then withdraws only what the
 * package's own call recorded, and closes only the pools that call opened.
 *
 * A boot judges no holder and refuses nothing: every package it composes
 * registers again at every boot. When two of them declare one datasource
 * name, one connection serves the name — the one opened from the first
 * declaration to connect — and the boot logs that once, at `error`, naming
 * the name and both packages, and continues (`reportBootNameClashes`).
 *
 * One identity per datasource name in an environment (ADR-0150): the metadata
 * registration of such a name is the declaration of the package that holds it
 * — the one whose connection serves it, else the first to declare it — never
 * another declarer's, as the rehydrate leaves a held name with its holder. A
 * declaration the connect may still make the holder is registered once the
 * connect verdict says so (`settleBootNames`), so Setup → Datasources lists the
 * configuration that serves the name and {@link datasourceNameHolder} names
 * its holder.
 */

import type { PluginContext } from '@objectstack/core';
import { applyProtection } from '@objectstack/spec/shared';
import { isDatasourceAddressed } from '@objectstack/service-datasource';
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
 * What one installed package's call registered: the datasource names its
 * reinstall and its uninstall withdraw, and of those the ones whose pool the
 * connect found already registered rather than opened (`already-registered`) —
 * a pool somebody else opened, which the withdrawal never closes.
 */
interface InstalledDatasources {
    names: string[];
    found: Set<string>;
}

/**
 * Per kernel (keyed by its code-datasource set), what each installed package's
 * call registered ({@link InstalledDatasources}). A boot artifact's are never
 * recorded: the boot owns them.
 */
const INSTALLED_BY_APP = new WeakMap<object, Map<string, InstalledDatasources>>();

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

    // [#28143] An installed package's names are judged after its own earlier
    // registrations are withdrawn, so whatever still holds one is another
    // holder's. A held name — or one whose holder cannot be read — is left out
    // of all three steps below, and reported.
    let left: ReadonlySet<string> = new Set();
    let key: object | undefined;
    if (installed) {
        left = await leaveHeldNames(ctx, appId, tag, ownedOf().map(({ datasource }) => datasource?.name));
        const names = ownedOf()
            .map(({ datasource }) => datasource?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0 && !left.has(name));
        contributeCodeDatasourceNames(ctx, names);
        key = kernelKey(ctx);
        if (key) recordInstalled(key, appId, names);
        ensureDatasourceUninstallCleanup(ctx);
    }
    const taken = left.size === 0
        // By reference when nothing is left out: the boot hands the connect the
        // very list its one forward conversion produced (#23029 pins the identity).
        ? datasources
        : datasources.filter((ds) => !left.has(ds?.name));
    if (taken.length === 0) return [];

    // A boot notes the names this package declares beside every other package
    // the boot composes, and reports a name two packages declare once the
    // connect has said whose connection serves it (`reportBootNameClashes`).
    const boot = installed
        ? undefined
        : noteBootDeclarations(ctx, appId, ownedOf, datasources, {
            objects: options.objects ?? [],
            mappedObjects: options.mappedObjects ?? {},
        });

    // 1. The metadata registration — lenient: a registry that refuses leaves
    //    the datasource unlisted, never the package unloaded.
    try {
        const metadata = ctx.getService('metadata') as
            | { registerInMemory?: (t: string, n: string, d: unknown) => void }
            | undefined;
        if (typeof metadata?.registerInMemory === 'function') {
            for (const { datasource: ds, owner } of ownedOf()) {
                if (!ds?.name || left.has(ds.name)) continue;
                // A boot registers a name two packages declare as its holder's
                // declaration only (`settleBootNames` follows the connect).
                const packageId = declaringPackage(owner, appId);
                if (boot && !holdsBootName(boot, ds.name, packageId)) continue;
                metadata.registerInMemory('datasource', ds.name, applyProtection({ ...ds, origin: 'code' }, owner));
                const record = boot?.names.get(ds.name);
                if (record) record.registered = packageId;
            }
            ctx.logger.info('Registered code-defined datasources in metadata registry', {
                appId,
                count: taken.length,
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
        if (boot) settleBootNames(ctx, tag, boot, []);
        return [];
    }
    try {
        const results = await connection.connectDeclared({
            datasources: taken as any[],
            objects: options.objects ?? [],
            mappedObjects: options.mappedObjects ?? {},
        });
        if (key) recordFound(key, appId, results);
        if (boot) settleBootNames(ctx, tag, boot, results);
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
        if (boot) {
            const retained: PackageDatasourceVerdict[] = [];
            for (const name of boot.declared.keys()) {
                const state = connection.getConnectionState?.(name);
                if (state) retained.push({ name: state.name, status: state.status });
            }
            settleBootNames(ctx, tag, boot, retained);
        }
        if (!installed) throw err;
        // In a running kernel there is no boot to refuse. `connectDeclared`
        // attempted every datasource before it threw, and the connection
        // service retained each verdict and marked an unusable one on the
        // engine, so the datasource answers that verdict and a read of a bound
        // object answers `ERR_DATASOURCE_UNAVAILABLE` naming it — never a
        // silent driver gap.
        const verdicts: PackageDatasourceVerdict[] = [];
        for (const ds of taken) {
            const state = typeof ds?.name === 'string' ? connection.getConnectionState?.(ds.name) : undefined;
            if (state) verdicts.push({ name: state.name, status: state.status });
        }
        if (key) recordFound(key, appId, verdicts);
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
    if (names.length > 0) byApp.set(appId, { names: [...names], found: new Set() });
    else byApp.delete(appId);
}

/**
 * [#28143] Record which of the package's datasources the connect found already
 * registered (`already-registered`): a driver it did not open, and that the
 * package's withdrawal therefore never closes.
 */
function recordFound(key: object, appId: string, verdicts: ReadonlyArray<{ name: string; status: string }>): void {
    const record = INSTALLED_BY_APP.get(key)?.get(appId);
    if (!record) return;
    for (const { name, status } of verdicts) {
        if (status === 'already-registered') record.found.add(name);
    }
}

/** The app id whose installed call recorded `name`, other than `appId`; `undefined` when none did. */
function recordedByAnother(key: object | undefined, appId: string, name: string): string | undefined {
    if (!key) return undefined;
    for (const [other, record] of INSTALLED_BY_APP.get(key) ?? []) {
        if (other !== appId && record.names.includes(name)) return other;
    }
    return undefined;
}

/** A service the kernel may not have: `undefined` when it is absent. */
function optionalService<T>(ctx: PluginContext, name: string): T | undefined {
    try {
        return ctx.getService<T>(name);
    } catch {
        return undefined;
    }
}

/**
 * [#28143] Who holds a datasource name, as an installed package declaring it
 * must see it — {@link datasourceNameHolder}'s answer.
 *
 *  - `free`: nobody but the package itself (its own earlier registration or
 *    pool) holds the name.
 *  - `held`: another holder does, named in words for the refusal and the log.
 *  - `unreadable`: a place a holder lives could not be read. ⛔ Never read as
 *    `free`: a check that did not run is not "no holder".
 */
export type DatasourceNameHolding =
    | { status: 'free' }
    | { status: 'held'; holder: string }
    | { status: 'unreadable'; reading: string; cause: unknown };

/**
 * [#28143] The ONE judge of who holds a datasource name a package installed
 * into the running kernel declares. The install door refuses on it before any
 * write; {@link connectPackageDatasources} leaves a held name alone on every
 * installed call, the rehydrate included.
 *
 * Every place a holder lives is read, in this order, and the first holder
 * found answers:
 *
 *  1. the host's `default` — always held;
 *  2. the metadata registry: a datasource item stamped with another package, a
 *     datasource created in Setup (`origin: 'runtime'`), or any other item. An
 *     item stamped with this package is its own earlier registration: `free`;
 *  3. the code-datasource set: a name another installed package recorded, or
 *     one the host registers from code (the boot artifact's, whose metadata
 *     registration is lenient and may be missing);
 *  4. the data engine: a driver registered under the name with no metadata
 *     item — the legacy `onEnable` bridge (ADR-0062 D8). A pool this package's
 *     own earlier call recorded is its own.
 *
 * A service the kernel does not have holds nothing; a read that throws is
 * `unreadable`.
 */
export async function datasourceNameHolder(
    ctx: PluginContext,
    appId: string,
    name: string,
): Promise<DatasourceNameHolding> {
    if (name === 'default') return { status: 'held', holder: "the host's primary datasource" };

    const metadata = optionalService<{ get?: (type: string, name: string) => Promise<unknown> }>(ctx, 'metadata');
    if (typeof metadata?.get === 'function') {
        let item: unknown;
        try {
            item = await metadata.get('datasource', name);
        } catch (cause) {
            return { status: 'unreadable', reading: 'the metadata registry', cause };
        }
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            const { _packageId: owner, origin } = item as { _packageId?: unknown; origin?: unknown };
            if (owner === appId) return { status: 'free' };
            return {
                status: 'held',
                holder: typeof owner === 'string' && owner.length > 0
                    ? `the package '${owner}'`
                    : origin === 'runtime' ? 'a datasource created in Setup' : 'a datasource',
            };
        }
    }

    const key = kernelKey(ctx);
    const ownNames = (key && INSTALLED_BY_APP.get(key)?.get(appId)?.names) ?? [];
    const other = recordedByAnother(key, appId, name);
    if (other !== undefined) return { status: 'held', holder: `the package '${other}'` };
    if (key && !ownNames.includes(name)) {
        let coded: boolean;
        try {
            coded = typeof (key as { has?: unknown }).has === 'function' && (key as { has(n: string): boolean }).has(name);
        } catch (cause) {
            return { status: 'unreadable', reading: "the host's code-datasource set", cause };
        }
        if (coded) return { status: 'held', holder: 'a datasource this host registers from code' };
    }

    const engine = optionalService<{ getDriverByName?: (name: string) => unknown }>(ctx, 'objectql');
    if (typeof engine?.getDriverByName === 'function') {
        let driver: unknown;
        try {
            driver = engine.getDriverByName(name);
        } catch (cause) {
            return { status: 'unreadable', reading: 'the data engine', cause };
        }
        if (driver && !ownNames.includes(name)) {
            return { status: 'held', holder: 'a driver registered on the data engine outside Setup' };
        }
    }
    return { status: 'free' };
}

/**
 * [#28143] Judge each name an installed call declares and answer the ones it
 * leaves alone — held by another holder, or with a holder that cannot be read
 * — after one `error` line naming each and what it means.
 *
 * `error`, not `warn`: the ledger says the package is installed with these
 * datasources while the running kernel registers none of them as the
 * package's, and nothing else looks wrong. On a rehydrate this is a package
 * installed before the install door judged names; the install door itself
 * refuses before it gets here.
 */
async function leaveHeldNames(
    ctx: PluginContext,
    appId: string,
    tag: string,
    declared: ReadonlyArray<unknown>,
): Promise<Set<string>> {
    const left = new Set<string>();
    const lines: string[] = [];
    for (const name of declared) {
        if (typeof name !== 'string' || name.length === 0 || left.has(name)) continue;
        const holding = await datasourceNameHolder(ctx, appId, name);
        if (holding.status === 'free') continue;
        left.add(name);
        lines.push(holding.status === 'held'
            ? `'${name}' is held by ${holding.holder}`
            : `'${name}' could not be judged: ${holding.reading} could not be read (${(holding.cause as Error)?.message ?? String(holding.cause)})`);
    }
    if (lines.length > 0) {
        ctx.logger.error(
            `${tag} the package '${appId}' declares datasource name(s) it does not hold, and they are NOT registered, `
            + `recorded or connected for it: ${lines.join('; ')}. The package's objects bound to them are served by `
            + "whatever holds the name, and the package's uninstall leaves that holder alone. Rename the package's "
            + 'datasource and install it again, or remove the datasource holding the name and restart.',
        );
    }
    return left;
}

/**
 * One datasource name the packages a boot composes declare: each declaring
 * package in boot order, the one whose declaration opened the connection that
 * serves the name, the packages already reported against it, each declaring
 * package's declaration of it (its last one, as a lone package's registration
 * is), and the package whose declaration the boot registered under the name.
 */
interface BootDatasourceName {
    declarers: string[];
    opener?: string;
    reported: Set<string>;
    declarations: Map<string, { datasource: any; owner: DeclaredDatasourceOwner }>;
    registered?: string;
}

/** The package a declaration is stamped with, else the call's own app id. */
function declaringPackage(owner: DeclaredDatasourceOwner | undefined, appId: string): string {
    return typeof owner?.packageId === 'string' && owner.packageId.length > 0 ? owner.packageId : appId;
}

/** The package holding a boot's datasource name: the opener of its connection, else its first declarer. */
function bootHolder(record: BootDatasourceName): string | undefined {
    return record.opener ?? record.declarers[0];
}

/**
 * Whether `packageId`'s declaration of `name` is the one a boot registers: a
 * name one package declares is registered as it always was, and a name two
 * packages declare only as its holder's.
 */
function holdsBootName(boot: BootDeclarations, name: string, packageId: string): boolean {
    const record = boot.names.get(name);
    return !record || record.declarers.length < 2 || bootHolder(record) === packageId;
}

/**
 * Per kernel (keyed by its code-datasource set, which every `AppPlugin.init()`
 * puts in place before any `start()`), the datasource names the packages its
 * boot composes declare. Only a boot writes it: an installed call is judged by
 * {@link datasourceNameHolder} instead.
 */
const BOOT_DECLARED = new WeakMap<object, Map<string, BootDatasourceName>>();

/** What one boot call declared, and the kernel's record of every boot declaration. */
interface BootDeclarations {
    /**
     * Each name this call declares → the package whose declaration of it the
     * connect takes first (the first one not `active: false`), `undefined`
     * when every declaration of it is switched off.
     */
    declared: Map<string, string | undefined>;
    /** Each name this call declares → its declarations, in order, with the package each is stamped with. */
    attempts: Map<string, Array<{ packageId: string; datasource: any }>>;
    /** What this call's connect is given to judge which declarations it addresses (D2); absent ⇒ every one. */
    gate?: Parameters<typeof isDatasourceAddressed>[1];
    names: Map<string, BootDatasourceName>;
}

/**
 * Note, for one boot call, which package declares each datasource name — the
 * package an `owned` entry is stamped with, else the call's own app id. A
 * package that declares a name twice, or is composed twice, is one declarer.
 */
function noteBootDeclarations(
    ctx: PluginContext,
    appId: string,
    owned: () => OwnedDatasources,
    datasources: readonly any[],
    gate?: Parameters<typeof isDatasourceAddressed>[1],
): BootDeclarations {
    let list: OwnedDatasources;
    let resolved = true;
    try {
        list = owned();
    } catch {
        // The ownership resolution is lenient (the registration's catch says
        // why); the call's own id then stands for every declaration, and none
        // of them is kept for registration — the registration lists nothing.
        list = datasources.map((datasource) => ({ datasource, owner: { packageId: appId } }));
        resolved = false;
    }
    const key = kernelKey(ctx);
    let names = key ? BOOT_DECLARED.get(key) : undefined;
    if (!names) {
        names = new Map();
        if (key) BOOT_DECLARED.set(key, names);
    }
    const declared = new Map<string, string | undefined>();
    const attempts = new Map<string, Array<{ packageId: string; datasource: any }>>();
    for (const { datasource, owner } of list) {
        const name = datasource?.name;
        if (typeof name !== 'string' || name.length === 0) continue;
        const packageId = declaringPackage(owner, appId);
        if (declared.get(name) === undefined) declared.set(name, datasource?.active === false ? undefined : packageId);
        attempts.set(name, [...(attempts.get(name) ?? []), { packageId, datasource }]);
        let record = names.get(name);
        if (!record) {
            record = { declarers: [], reported: new Set(), declarations: new Map() };
            names.set(name, record);
        }
        if (!record.declarers.includes(packageId)) record.declarers.push(packageId);
        if (resolved) record.declarations.set(packageId, { datasource, owner });
    }
    return { declared, attempts, gate, names };
}

/**
 * A name whose connect answered `connected` in this call was opened from this
 * call's declaration of it — the one that verdict answers. The connect
 * attempts, in order, each declaration not switched off that the D2 gate
 * addresses ({@link isDatasourceAddressed}), one verdict per attempt, so the
 * `connected` verdict's position among the name's verdicts is its
 * declaration's position among those attempts: a later declaration when an
 * earlier one's connect failed. Verdicts that do not line up with the attempts
 * (a connect that threw, read back from its retained state) answer the first
 * declaration not switched off.
 */
function noteBootOpeners(boot: BootDeclarations, verdicts: ReadonlyArray<{ name: string; status: string }>): void {
    const position = new Map<string, number>();
    for (const { name, status } of verdicts) {
        const index = position.get(name) ?? 0;
        position.set(name, index + 1);
        if (status !== 'connected') continue;
        const record = boot.names.get(name);
        if (!record || record.opener !== undefined) continue;
        const attempted = (boot.attempts.get(name) ?? []).filter(({ datasource }) =>
            datasource?.active !== false && (boot.gate === undefined || isDatasourceAddressed(datasource, boot.gate)));
        const answered = verdicts.filter((verdict) => verdict.name === name).length;
        const opener = attempted.length === answered ? attempted[index]?.packageId : boot.declared.get(name);
        if (opener !== undefined) record.opener = opener;
    }
}

/**
 * Record a connect a boot ran before any `start()` — `AppPlugin`'s
 * `datasourceMapping` connect at the drivers-ready hook — so the package whose
 * declaration opened a connection there is the holder
 * {@link connectPackageDatasources} names when another package declares the
 * same name.
 */
export function recordBootDatasourceConnect(
    ctx: PluginContext,
    appId: string,
    owned: OwnedDatasources | (() => OwnedDatasources),
    verdicts: ReadonlyArray<{ name: string; status: string }>,
): void {
    const resolve = typeof owned === 'function' ? owned : () => owned;
    noteBootOpeners(noteBootDeclarations(ctx, appId, resolve, []), verdicts);
}

/**
 * After a boot call's connect (or with no connection service to run one):
 * note whose declaration opened each connection, register each name two
 * packages declare as its holder's declaration ({@link registerBootHolders}),
 * and report each clash once ({@link reportBootNameClashes}).
 */
function settleBootNames(
    ctx: PluginContext,
    tag: string,
    boot: BootDeclarations,
    verdicts: ReadonlyArray<{ name: string; status: string }>,
): void {
    noteBootOpeners(boot, verdicts);
    registerBootHolders(ctx, tag, boot);
    reportBootNameClashes(ctx, tag, boot);
}

/**
 * One identity per datasource name: each name this call declares that two
 * packages declare is registered as its holder's declaration — the package
 * whose connection serves it, else its first declarer — whenever the
 * registration is not that package's yet. Registration runs before the
 * connect, so this is where a declaration the connect made the holder (an
 * earlier declarer's connect failed) replaces the earlier one. Lenient, as the
 * registration is: a registry that refuses leaves the item as it was.
 */
function registerBootHolders(ctx: PluginContext, tag: string, boot: BootDeclarations): void {
    const metadata = optionalService<{ registerInMemory?: (t: string, n: string, d: unknown) => void }>(ctx, 'metadata');
    if (typeof metadata?.registerInMemory !== 'function') return;
    for (const name of boot.declared.keys()) {
        const record = boot.names.get(name);
        if (!record || record.declarers.length < 2) continue;
        const holder = bootHolder(record);
        const declaration = holder === undefined ? undefined : record.declarations.get(holder);
        if (holder === undefined || !declaration || record.registered === holder) continue;
        try {
            metadata.registerInMemory(
                'datasource',
                name,
                applyProtection({ ...declaration.datasource, origin: 'code' }, declaration.owner),
            );
            record.registered = holder;
        } catch (err) {
            ctx.logger.warn(`${tag} failed to register code-defined datasources`, {
                error: (err as Error)?.message ?? String(err),
            });
        }
    }
}

/**
 * A boot composing two packages that declare one datasource name keeps ONE
 * connection for the name — the one opened from the first declaration to
 * connect — and every other declaring package's objects bound to the name are
 * served by it. The boot continues; this says so once per clash per boot, at
 * `error`, naming the name and both packages, and never a configuration value.
 *
 * `error`, not `warn`: the second package's rows land in the holder's
 * database while everything looks normal, the same consequence the rehydrate
 * of an older install reports ({@link leaveHeldNames}).
 */
function reportBootNameClashes(ctx: PluginContext, tag: string, boot: BootDeclarations): void {
    for (const name of boot.declared.keys()) {
        const record = boot.names.get(name);
        if (!record || record.declarers.length < 2) continue;
        const holder = bootHolder(record)!;
        const others = record.declarers.filter((packageId) => packageId !== holder && !record.reported.has(packageId));
        if (others.length === 0) continue;
        for (const packageId of others) record.reported.add(packageId);
        ctx.logger.error(bootNameClashMessage(tag, name, holder, others, record.opener !== undefined));
    }
}

/** The one line {@link reportBootNameClashes} logs: names and package ids only. */
function bootNameClashMessage(tag: string, name: string, holder: string, others: readonly string[], opened: boolean): string {
    const one = others.length === 1;
    const subject = `the package${one ? '' : 's'} ${others.map((id) => `'${id}'`).join(', ')}`;
    const served = opened
        ? `One connection serves the name, opened from the declaration of '${holder}': the objects ${subject} `
            + `bind${one ? 's' : ''} to '${name}' are served by that connection, and ${one ? 'its' : 'their'} own `
            + 'declaration of the name is not connected. '
        : `No connection is open under the name, and '${holder}' declared it first. `;
    return `${tag} the datasource name '${name}' is declared by more than one package this boot composes: `
        + `'${holder}' holds it, and ${subject} declare${one ? 's' : ''} it too. ${served}`
        + 'The boot continues. Rename the datasource in one of the packages, or remove one of them from this '
        + 'composition, and restart.';
}

/**
 * Withdraw every datasource an installed package's earlier call registered:
 * its pool disconnected (the connection service's own teardown, which evicts
 * the driver and drops the retained verdict) unless that call found the pool
 * already registered by another holder, its metadata registration
 * removed — only a registration still stamped with this package's id — and its
 * name taken out of the code-datasource set. Answers the names withdrawn and
 * the names whose metadata registration could not be removed.
 */
async function withdrawPackageDatasources(
    ctx: PluginContext,
    appId: string,
): Promise<{ removed: string[]; kept: string[]; cause?: unknown }> {
    const key = kernelKey(ctx);
    const record = key ? INSTALLED_BY_APP.get(key)?.get(appId) : undefined;
    const names = record?.names ?? [];
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
        // is evicted either way. [#28143] Only a pool this package's connect
        // opened: one it found already registered is its holder's to close.
        if (typeof connection?.disconnect === 'function' && !record?.found.has(name)) await connection.disconnect(name);
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
