// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35609] The install-local door: an upgrade or a re-install of a package
 * whose new version no longer extends an object serves that object without
 * the dropped extension's fields, with no restart.
 *
 * The door registers the new version through the `manifest` service without
 * uninstalling the installed one first (an upgrade and a re-install of the
 * same id are both a hot re-register). Before the fix the registry withdrew a
 * package's previous extension of a target only when the new registration
 * named that target again, so a dropped extension kept serving its fields.
 *
 * Real here: an `ObjectKernel` with a SQL driver and `ObjectQLPlugin` (the
 * `manifest` service over the real `SchemaRegistry`, and the real schema
 * sync), the base package registered at boot as code. The door's side readers
 * (binder, translations, seeds) are recorders, as in the hot-resync suite.
 *
 * What it pins, per door: the served object; the dry run's plan names the
 * dropped field; the stored column and its value are untouched (the field is
 * no longer served, nothing is dropped); and the CONTROL, a version that keeps
 * the extension, keeps the field.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`): the plugin reaches the
// same module through a dynamic `import()` for its handler binder.
import '@objectstack/runtime';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const CORE = 'com.acme.core';
const MOD = 'com.acme.mod';
const SYSTEM = { context: { isSystem: true } } as const;

const core = {
    id: CORE,
    name: 'Core',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app',
    objects: [{ name: 'crm_line', label: 'Line', fields: { name: { type: 'text', label: 'Name' } } }],
};

/** The module's install body at `version`, extending `crm_line` with `cb_account` unless `extends` is false. */
const mod = (version: string, opts: { extends: boolean }) => ({
    manifest: {
        id: MOD,
        name: 'Mod',
        namespace: 'crmmod',
        version,
        type: 'module',
        dependencies: { [CORE]: '^1.0.0' },
        objectExtensions: opts.extends
            ? [{ extend: 'crm_line', fields: { cb_account: { type: 'text', label: 'Account' } } }]
            : [],
    },
});

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(body: any) {
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-35609-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function bootDoor() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    let kernelCtx: PluginContext | undefined;
    await kernel.use({
        name: 'test.35609.driver',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
        name: 'test.35609.core',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        async init(ctx: PluginContext) {
            kernelCtx = ctx;
            await ctx.getService<{ register(m: unknown): unknown }>('manifest').register(core);
        },
    } as Plugin);
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';

    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: kernel.getService('manifest'),
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
            registry: ql.registry,
            get manifests() { return (ql as unknown as { manifests: Map<string, unknown> }).manifests; },
            syncSchemas: () => ql.syncSchemas(),
            find: (...a: Parameters<ObjectQL['find']>) => ql.find(...a),
            count: (...a: Parameters<ObjectQL['count']>) => ql.count(...a),
        }),
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        trigger: (event: string, payload: unknown) => kernelCtx!.trigger(event, payload),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = async () => undefined;
    p.applySideEffects = async () => ({ translationsLoaded: 0, seeded: { mode: 'none' } });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();

    const post = async (body: unknown) => rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC(body));
    const servedFields = (): string[] => Object.keys((ql.registry.getObject('crm_line') as any)?.fields ?? {})
        .filter((f) => f === 'name' || f.startsWith('cb_')).sort();
    const knex = (driver as unknown as { knex: any }).knex;
    const column = async () => {
        const rows = await knex('crm_line').select('*');
        return { hasColumn: await knex.schema.hasColumn('crm_line', 'cb_account'), values: rows.map((r: any) => r.cb_account) };
    };
    return { kernel, ql, post, servedFields, column, logger };
}

async function settle(k: { kernel: ObjectKernel }) {
    await Promise.race([k.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
}

describe('[#35609] install-local: a version that no longer extends an object serves it without the extension', () => {
    it('an upgrade that drops the extension: the plan names the field, the object no longer serves it, the column keeps its value', async () => {
        const k = await bootDoor();
        try {
            expect((await k.post(mod('1.0.0', { extends: true }))).payload?.data?.hotLoaded).toBe(true);
            expect(k.servedFields()).toEqual(['cb_account', 'name']);
            await k.ql.insert('crm_line', { id: 'l1', name: 'one', cb_account: 'ACME', organization_id: 'org_a' }, SYSTEM);

            // The dry run already said so (unchanged by this fix): the field is removed, its column holds a row.
            const dry = await k.post({ ...mod('1.0.1', { extends: false }), dryRun: true });
            expect(dry.status).toBe(200);
            expect(dry.payload.data.plan.fields.removed).toEqual([expect.objectContaining({ object: 'crm_line', field: 'cb_account' })]);
            expect(dry.payload.data.environment.columns).toEqual([expect.objectContaining({ object: 'crm_line', field: 'cb_account', reasons: ['removed'], rows: 1 })]);

            const upgraded = await k.post(mod('1.0.1', { extends: false }));
            expect(upgraded.status, JSON.stringify(upgraded.payload)).toBe(200);
            expect(upgraded.payload.data.hotLoaded).toBe(true);

            expect(k.servedFields()).toEqual(['name']);
            const [row] = (await k.ql.find('crm_line', { where: {}, ...SYSTEM })) as Array<Record<string, unknown>>;
            expect(row).toMatchObject({ id: 'l1', name: 'one' });
            expect(row).not.toHaveProperty('cb_account');
            // Stored data is untouched: nothing drops the column.
            expect(await k.column()).toEqual({ hasColumn: true, values: ['ACME'] });
        } finally {
            await settle(k);
        }
    }, 60_000);

    it('a re-install of the same version without the extension withdraws it too', async () => {
        const k = await bootDoor();
        try {
            await k.post(mod('1.0.0', { extends: true }));
            expect(k.servedFields()).toEqual(['cb_account', 'name']);
            const res = await k.post(mod('1.0.0', { extends: false }));
            expect(res.status, JSON.stringify(res.payload)).toBe(200);
            expect(k.servedFields()).toEqual(['name']);
        } finally {
            await settle(k);
        }
    }, 60_000);

    it('CONTROL: an upgrade that keeps the extension keeps its field', async () => {
        const k = await bootDoor();
        try {
            await k.post(mod('1.0.0', { extends: true }));
            const res = await k.post(mod('1.0.1', { extends: true }));
            expect(res.status, JSON.stringify(res.payload)).toBe(200);
            expect(k.servedFields()).toEqual(['cb_account', 'name']);
        } finally {
            await settle(k);
        }
    }, 60_000);
});
