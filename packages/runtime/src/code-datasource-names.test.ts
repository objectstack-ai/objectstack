// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21922 / #21944] The host's code-datasource set: one set, contributed to
// from code in Phase 1, complete before ANY `start()` runs — which is when the
// datasource-admin plugin's boot restore reads it.
//
// The boot case composes its reader FIRST, ahead of every producer. Start
// order follows insertion where no plugin declares an edge, and none of
// AppPlugin, DefaultDatasourcePlugin and DatasourceAdminServicePlugin declares
// one to another — so a set contributed to in `start()` would be short here.
// Contributed to in `init()`, it is whole. (AppPlugin's contribution is a
// function the set resolves at that first read — `CodeDatasourceNames` says
// why; `plugin-dev`'s #15292 falsifier pins that `init()` itself never reads
// the artifact's `packages[]` for it.)

import { describe, it, expect } from 'vitest';
import type { Plugin, PluginContext } from '@objectstack/core';
import { Runtime } from './runtime.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { AppPlugin } from './app-plugin.js';
import { CODE_DATASOURCE_NAMES_SERVICE, CodeDatasourceNames, contributeCodeDatasourceNames } from './code-datasource-names.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD, not inside a clocked `it()` body (`scripts/check-test-source-alias.mjs`).
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 60_000;

/** A service registry with the kernel's two refusals: a miss throws, a duplicate throws. */
function registryCtx() {
    const services = new Map<string, unknown>();
    let registrations = 0;
    return {
        services,
        registrations: () => registrations,
        ctx: {
            getService<T>(name: string): T {
                if (!services.has(name)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services.get(name) as T;
            },
            registerService(name: string, service: unknown) {
                if (services.has(name)) throw new Error(`[Kernel] Service '${name}' already registered`);
                services.set(name, service);
                registrations += 1;
            },
        },
    };
}

describe('contributeCodeDatasourceNames — one set per kernel', () => {
    it('the first producer registers the set; every later one adds to that same set', () => {
        const { ctx, services, registrations } = registryCtx();

        contributeCodeDatasourceNames(ctx, ['default']);
        contributeCodeDatasourceNames(ctx, ['crm_wh', 'erp_wh']);

        expect(registrations()).toBe(1);
        const set = services.get(CODE_DATASOURCE_NAMES_SERVICE) as CodeDatasourceNames;
        expect(set.list()).toEqual(['crm_wh', 'default', 'erp_wh']);
        expect(set.has('crm_wh')).toBe(true);
        expect(set.has('runtime_wh')).toBe(false);
    });

    it('a contribution made as a function is resolved at the first read, not when it is made', () => {
        const { ctx, services } = registryCtx();
        let calls = 0;

        contributeCodeDatasourceNames(ctx, () => { calls += 1; return ['app_wh']; });
        expect(calls).toBe(0);

        const set = services.get(CODE_DATASOURCE_NAMES_SERVICE) as CodeDatasourceNames;
        expect(set.has('app_wh')).toBe(true);
        expect(set.has('app_wh')).toBe(true);
        expect(calls).toBe(1);
    });

    it('a contribution that throws stays pending and reaches every reader — the set never answers without it', () => {
        const { ctx, services } = registryCtx();
        contributeCodeDatasourceNames(ctx, ['default']);
        contributeCodeDatasourceNames(ctx, () => { throw new Error('the artifact cannot be read'); });

        const set = services.get(CODE_DATASOURCE_NAMES_SERVICE) as CodeDatasourceNames;
        expect(() => set.has('default')).toThrow(/the artifact cannot be read/);
        expect(() => set.has('default')).toThrow(/the artifact cannot be read/);
    });

    it('a name the kernel holds as something other than this set is a composition fault, refused loudly', () => {
        const { ctx, services } = registryCtx();
        services.set(CODE_DATASOURCE_NAMES_SERVICE, new Set(['default']));

        expect(() => contributeCodeDatasourceNames(ctx, ['default'])).toThrow(/already registered/);
    });
});

describe('the host\'s code-datasource set on a booted kernel', () => {
    it('holds `default` and every datasource the artifact declares before the first start() runs', async () => {
        const { ObjectQLPlugin } = await import('@objectstack/objectql');
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();

        let seenAtFirstStart: string[] | undefined;
        const reader: Plugin = {
            name: 'test.code-datasource-names.reader',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                seenAtFirstStart = ctx.getService<CodeDatasourceNames>(CODE_DATASOURCE_NAMES_SERVICE).list();
            },
        };

        await kernel.use(reader);
        await kernel.use(new DefaultDatasourcePlugin({ driver: 'memory' }));
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AppPlugin({
            manifest: { id: 'com.test.code-ds-names', name: 'Code DS Names', version: '1.0.0' },
            datasources: [{ name: 'app_wh', label: 'App warehouse', driver: 'memory', config: {} }],
        }));

        try {
            await kernel.bootstrap();
            expect(seenAtFirstStart).toEqual(['app_wh', 'default']);
            // One set: the kernel service the two readers resolve by name.
            expect(kernel.getService<CodeDatasourceNames>(CODE_DATASOURCE_NAMES_SERVICE).list()).toEqual(['app_wh', 'default']);
        } finally {
            await kernel.shutdown();
        }
    }, BOOT_TIMEOUT);

    it('an artifact that declares no datasource contributes nothing: the set holds only the host\'s `default`', async () => {
        const { ObjectQLPlugin } = await import('@objectstack/objectql');
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();
        await kernel.use(new DefaultDatasourcePlugin({ driver: 'memory' }));
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AppPlugin({ manifest: { id: 'com.test.no-ds', name: 'No DS', version: '1.0.0' } }));
        try {
            await kernel.bootstrap();
            expect(kernel.getService<CodeDatasourceNames>(CODE_DATASOURCE_NAMES_SERVICE).list()).toEqual(['default']);
        } finally {
            await kernel.shutdown();
        }
    }, BOOT_TIMEOUT);
});
