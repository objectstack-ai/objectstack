// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28039] `connectPackageDatasources` — the ONE path that registers, records
// and connects the datasources a package declares, for the boot artifact
// (`AppPlugin.start`) and for a package installed into a running kernel
// (install-local, `installed: true`).
//
// The two callers differ in exactly three ways, each pinned here:
//   - a boot leaves the names to `init()`'s contribution; an install records
//     them in the code-datasource set itself;
//   - a fail-fast connect verdict refuses a boot (it throws), and is reported
//     by an install as the retained verdict;
//   - an install's reinstall withdraws what the previous call registered, and
//     its uninstall cleanup (`runtime.package-datasources`) withdraws the rest.
// The end-to-end half (a real install door, driver and read) is the dogfood
// file `install-local-declared-datasources.dogfood.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { connectPackageDatasources, datasourceNameHolder } from './declared-datasources.js';
import { CODE_DATASOURCE_NAMES_SERVICE, CodeDatasourceNames, contributeCodeDatasourceNames } from './code-datasource-names.js';

type Verdict = { name: string; status: string; reason?: string };

/** A kernel's service registry with a metadata service, a connection service and a protocol. */
function kernel(opts: {
    failFast?: string;
    withConnection?: boolean;
    /** A data engine whose driver registry the connect fills, as the real one does. */
    withEngine?: boolean;
    /** A `metadata.get` of this datasource name throws — a loader outage. */
    metadataFault?: string;
    /** Force the connect's verdict for a name. */
    answer?: Record<string, string>;
} = {}) {
    const services = new Map<string, unknown>();
    const items = new Map<string, any>();
    const states = new Map<string, Verdict>();
    const cleanups = new Map<string, (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>>();
    const connectCalls: Array<{ datasources: any[]; objects?: unknown }> = [];
    const disconnected: string[] = [];
    const drivers = new Set<string>();

    services.set('metadata', {
        registerInMemory: (type: string, name: string, data: unknown) => items.set(`${type}/${name}`, data),
        get: async (type: string, name: string) => {
            if (name === opts.metadataFault) throw new Error('metadata loader unavailable');
            return items.get(`${type}/${name}`);
        },
        unregister: async (type: string, name: string) => { items.delete(`${type}/${name}`); },
    });
    if (opts.withConnection !== false) {
        services.set('datasource-connection', {
            connectDeclared: async (input: { datasources: any[]; objects?: unknown }) => {
                connectCalls.push(input);
                const results: Verdict[] = [];
                for (const ds of input.datasources) {
                    const v: Verdict = ds.name === opts.failFast
                        ? { name: ds.name, status: 'failed-credentials', reason: `credential '${ds.external?.credentialsRef}' could not be resolved` }
                        : opts.answer?.[ds.name] !== undefined
                            ? { name: ds.name, status: opts.answer[ds.name] }
                            : drivers.has(ds.name)
                                ? { name: ds.name, status: 'already-registered' }
                                : { name: ds.name, status: 'connected' };
                    if (v.status === 'connected') drivers.add(ds.name);
                    states.set(ds.name, v);
                    results.push(v);
                }
                if (opts.failFast && states.has(opts.failFast)) throw new Error(`datasource '${opts.failFast}': connect failed`);
                return results;
            },
            getConnectionState: (name: string) => states.get(name),
            disconnect: async (name: string) => { disconnected.push(name); states.delete(name); drivers.delete(name); },
        });
    }
    if (opts.withEngine) {
        services.set('objectql', { getDriverByName: (name: string) => (drivers.has(name) ? { name } : undefined) });
    }
    services.set('protocol', {
        registerUninstallCleanup: (name: string, cleanup: any) => cleanups.set(name, cleanup),
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctx = {
        getService<T>(name: string): T {
            if (!services.has(name)) throw new Error(`[Kernel] Service '${name}' not found`);
            return services.get(name) as T;
        },
        registerService(name: string, service: unknown) {
            if (services.has(name)) throw new Error(`[Kernel] Service '${name}' already registered`);
            services.set(name, service);
        },
        logger,
    };
    const codeNames = () => (services.get(CODE_DATASOURCE_NAMES_SERVICE) as CodeDatasourceNames | undefined)?.list() ?? [];
    return { ctx: ctx as never, items, states, cleanups, connectCalls, disconnected, drivers, logger, codeNames };
}

const STORE = { name: 'pkg_store', driver: 'sqlite', config: { filename: ':memory:' } };
const VAULT = { name: 'pkg_vault', driver: 'postgres', schemaMode: 'external', external: { credentialsRef: 'sys_secret:nope' } };
const OBJECTS = [{ name: 'pkg_note', datasource: 'pkg_store' }, { name: 'pkg_secret', datasource: 'pkg_vault' }];

describe('connectPackageDatasources — an installed package', () => {
    it('registers each datasource as code stamped with the package, records the names, and connects them', async () => {
        const k = kernel();
        const verdicts = await connectPackageDatasources(k.ctx, {
            appId: 'com.example.pkg',
            source: 'MarketplaceInstallLocal',
            datasources: [STORE],
            owned: [{ datasource: STORE, owner: { packageId: 'com.example.pkg', packageVersion: '1.0.0' } }],
            objects: OBJECTS,
            installed: true,
        });
        expect(verdicts).toEqual([{ name: 'pkg_store', status: 'connected' }]);
        expect(k.items.get('datasource/pkg_store')).toMatchObject({
            name: 'pkg_store',
            origin: 'code',
            _packageId: 'com.example.pkg',
            _packageVersion: '1.0.0',
        });
        expect(k.codeNames()).toEqual(['pkg_store']);
        expect(k.connectCalls).toEqual([{ datasources: [STORE], objects: OBJECTS, mappedObjects: {} }]);
        expect([...k.cleanups.keys()]).toEqual(['runtime.package-datasources']);
    });

    it('a fail-fast verdict is reported, not thrown: each attempted datasource answers its retained verdict', async () => {
        const k = kernel({ failFast: 'pkg_vault' });
        const verdicts = await connectPackageDatasources(k.ctx, {
            appId: 'com.example.pkg',
            datasources: [STORE, VAULT],
            objects: OBJECTS,
            installed: true,
        });
        expect(verdicts).toEqual([
            { name: 'pkg_store', status: 'connected' },
            { name: 'pkg_vault', status: 'failed-credentials' },
        ]);
        expect(k.logger.error).toHaveBeenCalledTimes(1);
        // Recorded and registered all the same: the datasource answers its verdict.
        expect(k.codeNames()).toEqual(['pkg_store', 'pkg_vault']);
        expect(k.items.get('datasource/pkg_vault')?.origin).toBe('code');
    });

    it('a reinstall replaces: what the previous version registered and the new one drops is withdrawn', async () => {
        const k = kernel();
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE, VAULT], installed: true });
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE], installed: true });
        expect(k.disconnected).toEqual(['pkg_store', 'pkg_vault']);
        expect(k.codeNames()).toEqual(['pkg_store']);
        expect(k.items.has('datasource/pkg_vault')).toBe(false);
        expect(k.states.get('pkg_store')?.status).toBe('connected');
    });

    it('the uninstall cleanup withdraws the package\'s datasources, and only its own', async () => {
        const k = kernel();
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE], installed: true });
        await connectPackageDatasources(k.ctx, { appId: 'com.example.other', datasources: [VAULT], installed: true });
        const cleanup = k.cleanups.get('runtime.package-datasources')!;

        expect(await cleanup({ packageId: 'com.example.pkg' })).toEqual({ success: true, removed: 1 });
        expect(k.disconnected).toEqual(['pkg_store']);
        expect(k.items.has('datasource/pkg_store')).toBe(false);
        expect(k.codeNames()).toEqual(['pkg_vault']);

        // A package that registered nothing here — a boot artifact's, another door's — is a no-op.
        expect(await cleanup({ packageId: 'com.example.unknown' })).toEqual({ success: true, removed: 0 });
        expect(k.items.has('datasource/pkg_vault')).toBe(true);
    });

    it('a metadata registration stamped with another package is not removed by this one\'s withdrawal', async () => {
        const k = kernel();
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE], installed: true });
        k.items.set('datasource/pkg_store', { name: 'pkg_store', origin: 'code', _packageId: 'com.example.later' });
        await k.cleanups.get('runtime.package-datasources')!({ packageId: 'com.example.pkg' });
        expect(k.items.get('datasource/pkg_store')?._packageId).toBe('com.example.later');
    });
});

describe('connectPackageDatasources — the boot artifact', () => {
    it('a fail-fast verdict refuses the boot, as it always did', async () => {
        const k = kernel({ failFast: 'pkg_vault' });
        await expect(
            connectPackageDatasources(k.ctx, { appId: 'com.example.app', datasources: [STORE, VAULT], objects: OBJECTS }),
        ).rejects.toThrow("datasource 'pkg_vault': connect failed");
        expect(k.logger.error).toHaveBeenCalledWith(
            expect.stringContaining("[AppPlugin] declared-datasource auto-connect failed for app 'com.example.app'"),
        );
    });

    it('records no name and registers no uninstall cleanup: the boot owns them', async () => {
        const k = kernel();
        await connectPackageDatasources(k.ctx, { appId: 'com.example.app', datasources: [STORE] });
        expect(k.codeNames()).toEqual([]);
        expect(k.cleanups.size).toBe(0);
        expect(k.items.get('datasource/pkg_store')?.origin).toBe('code');
    });

    it('with no connection service the datasources stay metadata-only, and nothing throws', async () => {
        const k = kernel({ withConnection: false });
        expect(await connectPackageDatasources(k.ctx, { appId: 'com.example.app', datasources: [STORE] })).toEqual([]);
        expect(k.items.get('datasource/pkg_store')?.origin).toBe('code');
    });
});

describe('datasourceNameHolder — who holds a name an installed package declares', () => {
    const judge = (k: ReturnType<typeof kernel>, name: string) => datasourceNameHolder(k.ctx, 'com.example.pkg', name);

    it('the host\'s default, a Setup row, another package and an engine-only driver each hold their name', async () => {
        const k = kernel({ withEngine: true });
        k.items.set('datasource/setup_ds', { name: 'setup_ds', origin: 'runtime' });
        k.items.set('datasource/other_ds', { name: 'other_ds', origin: 'code', _packageId: 'com.example.other' });
        k.drivers.add('bridge_ds');
        expect(await judge(k, 'default')).toEqual({ status: 'held', holder: "the host's primary datasource" });
        expect(await judge(k, 'setup_ds')).toEqual({ status: 'held', holder: 'a datasource created in Setup' });
        expect(await judge(k, 'other_ds')).toEqual({ status: 'held', holder: "the package 'com.example.other'" });
        expect(await judge(k, 'bridge_ds')).toEqual({ status: 'held', holder: 'a driver registered on the data engine outside Setup' });
    });

    it('a name in the code-datasource set this package did not record is held by the host\'s code', async () => {
        const k = kernel();
        contributeCodeDatasourceNames(k.ctx as never, ['boot_ds']);
        expect(await judge(k, 'boot_ds')).toEqual({ status: 'held', holder: 'a datasource this host registers from code' });
    });

    it('a holder that cannot be read is unreadable, never free', async () => {
        const k = kernel({ metadataFault: 'pkg_store' });
        const holding = await judge(k, 'pkg_store');
        expect(holding).toMatchObject({ status: 'unreadable', reading: 'the metadata registry' });

        const e = kernel();
        (e.ctx as any).getService = ((orig) => (name: string) => {
            if (name === 'objectql') return { getDriverByName: () => { throw new Error('engine gone'); } };
            return orig(name);
        })((e.ctx as any).getService.bind(e.ctx));
        expect(await datasourceNameHolder(e.ctx, 'com.example.pkg', 'pkg_store')).toMatchObject({
            status: 'unreadable',
            reading: 'the data engine',
        });
    });

    it('the package\'s own registration and pool are free: a reinstall passes', async () => {
        const k = kernel({ withEngine: true });
        await connectPackageDatasources(k.ctx, {
            appId: 'com.example.pkg',
            datasources: [STORE],
            objects: OBJECTS,
            installed: true,
        });
        expect(k.drivers.has('pkg_store')).toBe(true);
        expect(await judge(k, 'pkg_store')).toEqual({ status: 'free' });
        // …and with its metadata registration gone, the pool it recorded is still its own.
        k.items.delete('datasource/pkg_store');
        expect(await judge(k, 'pkg_store')).toEqual({ status: 'free' });
        // CONTROL: to another package, the same pool is this one's.
        expect(await datasourceNameHolder(k.ctx, 'com.example.other', 'pkg_store')).toEqual({
            status: 'held',
            holder: "the package 'com.example.pkg'",
        });
    });

    it('nothing anywhere: free', async () => {
        expect(await judge(kernel({ withEngine: true }), 'pkg_store')).toEqual({ status: 'free' });
    });
});

describe('connectPackageDatasources — a name another holder already holds (a rehydrate of an older install)', () => {
    it('a Setup row\'s name is not taken over: not registered as code, not recorded, not connected, and reported', async () => {
        const k = kernel({ withEngine: true });
        const setupRow = { name: 'pkg_store', origin: 'runtime', driver: 'postgres' };
        k.items.set('datasource/pkg_store', setupRow);
        k.drivers.add('pkg_store'); // the Setup row's pool
        const verdicts = await connectPackageDatasources(k.ctx, {
            appId: 'com.example.pkg',
            source: 'MarketplaceInstallLocal',
            datasources: [STORE, VAULT],
            objects: OBJECTS,
            installed: true,
        });
        expect(verdicts).toEqual([{ name: 'pkg_vault', status: 'connected' }]);
        expect(k.items.get('datasource/pkg_store')).toBe(setupRow);
        expect(k.codeNames()).toEqual(['pkg_vault']);
        expect(k.connectCalls.map((c) => c.datasources.map((d) => d.name))).toEqual([['pkg_vault']]);
        expect(k.logger.error).toHaveBeenCalledTimes(1);
        const line = String(k.logger.error.mock.calls[0][0]);
        expect(line).toContain("'pkg_store'");
        expect(line).toContain('a datasource created in Setup');

        // The uninstall leaves the Setup row's pool and registration alone.
        expect(await k.cleanups.get('runtime.package-datasources')!({ packageId: 'com.example.pkg' })).toEqual({
            success: true,
            removed: 1,
        });
        expect(k.disconnected).toEqual(['pkg_vault']);
        expect(k.drivers.has('pkg_store')).toBe(true);
        expect(k.items.get('datasource/pkg_store')).toBe(setupRow);
    });

    it('an engine-only holder (the legacy onEnable bridge) is not taken over either', async () => {
        const k = kernel({ withEngine: true });
        k.drivers.add('pkg_store');
        const verdicts = await connectPackageDatasources(k.ctx, {
            appId: 'com.example.pkg',
            datasources: [STORE],
            objects: OBJECTS,
            installed: true,
        });
        expect(verdicts).toEqual([]);
        expect(k.items.has('datasource/pkg_store')).toBe(false);
        expect(k.codeNames()).toEqual([]);
        expect(k.connectCalls).toEqual([]);
        expect(String(k.logger.error.mock.calls[0]?.[0])).toContain('a driver registered on the data engine outside Setup');
    });

    it('a holder that cannot be read is not taken over: the name is left alone and the fault is reported', async () => {
        const k = kernel({ withEngine: true, metadataFault: 'pkg_store' });
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE], installed: true });
        expect(k.codeNames()).toEqual([]);
        expect(k.connectCalls).toEqual([]);
        expect(String(k.logger.error.mock.calls[0]?.[0])).toContain('metadata loader unavailable');
    });

    it('a pool the connect only found (already-registered) is not the package\'s to evict on uninstall', async () => {
        const k = kernel({ answer: { pkg_store: 'already-registered' } });
        await connectPackageDatasources(k.ctx, { appId: 'com.example.pkg', datasources: [STORE, VAULT], installed: true });
        expect(await k.cleanups.get('runtime.package-datasources')!({ packageId: 'com.example.pkg' })).toEqual({
            success: true,
            removed: 2,
        });
        expect(k.disconnected).toEqual(['pkg_vault']);
        expect(k.codeNames()).toEqual([]);
    });
});
