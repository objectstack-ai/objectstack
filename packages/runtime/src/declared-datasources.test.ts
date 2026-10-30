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
import { connectPackageDatasources } from './declared-datasources.js';
import { CODE_DATASOURCE_NAMES_SERVICE, CodeDatasourceNames } from './code-datasource-names.js';

type Verdict = { name: string; status: string; reason?: string };

/** A kernel's service registry with a metadata service, a connection service and a protocol. */
function kernel(opts: { failFast?: string; withConnection?: boolean } = {}) {
    const services = new Map<string, unknown>();
    const items = new Map<string, any>();
    const states = new Map<string, Verdict>();
    const cleanups = new Map<string, (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>>();
    const connectCalls: Array<{ datasources: any[]; objects?: unknown }> = [];
    const disconnected: string[] = [];

    services.set('metadata', {
        registerInMemory: (type: string, name: string, data: unknown) => items.set(`${type}/${name}`, data),
        get: async (type: string, name: string) => items.get(`${type}/${name}`),
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
                        : { name: ds.name, status: 'connected' };
                    states.set(ds.name, v);
                    results.push(v);
                }
                if (opts.failFast && states.has(opts.failFast)) throw new Error(`datasource '${opts.failFast}': connect failed`);
                return results;
            },
            getConnectionState: (name: string) => states.get(name),
            disconnect: async (name: string) => { disconnected.push(name); states.delete(name); },
        });
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
    return { ctx: ctx as never, items, states, cleanups, connectCalls, disconnected, logger, codeNames };
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
