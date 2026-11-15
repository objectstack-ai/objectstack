// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21322 — a HOT install re-runs the boot's `kernel:ready` sweeps by announcing
 * `metadata:reloaded`; the rehydrate does not.
 *
 * The defect: `os package install` into a running runtime registered the
 * package, bound its handlers (#21321) and stopped. The two consumers that read
 * a package only at `kernel:ready` — the automation engine's flow bind and the
 * security plugin's declared-permission seeding — had already run, so the
 * package's record-change flows never fired and its permission sets had no
 * `sys_permission_set` row until a restart. A restart was right because its
 * rehydrate registers the package INSIDE `kernel:ready`, ahead of both sweeps.
 *
 * What this file pins about the plugin's half (the subscribers' half is pinned
 * in their own packages, and end to end in the CLI suite
 * `package-install-local-boot-steps.integration.test.ts`):
 *
 *   - install: exactly one `metadata:reloaded`, naming the app it registered,
 *     announced only once the package is registered AND persisted;
 *   - rehydrate: none — it runs ahead of the sweeps it would re-run;
 *   - a subscriber that throws does not fail the install, and the log names
 *     what is lost and the restart that repairs it;
 *   - a context that cannot announce says so instead of staying silent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`): the plugin reaches the
// same module through a dynamic `import()` for its handler binder.
import '@objectstack/runtime';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

const APP_ID = 'com.example.tasksapp';

/** The install route's inline body: the compiled artifact `os package install` sends. */
const ARTIFACT = {
    manifest: { id: APP_ID, namespace: 'tasks_app', version: '0.1.0', type: 'app', name: 'Tasks App' },
    objects: [{ name: 'tasks_app_task', label: 'Task', fields: { name: { type: 'text', label: 'Name' } } }],
};

type Handler = (c: any) => Promise<any>;

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
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-resync-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * Boot the plugin to `kernel:ready` over a kernel context whose `trigger`
 * records every announce — and, at the moment of each one, what had already
 * happened: whether the package was registered and whether its ledger entry
 * was on disk.
 */
async function bootPlugin(opts: { trigger?: 'record' | 'throw' | 'absent' } = {}) {
    const mode = opts.trigger ?? 'record';
    const register = vi.fn();
    const announced: Array<{ event: string; payload: unknown; registered: boolean; persisted: boolean }> = [];
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const rawApp = makeRawApp();
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    if (mode !== 'absent') {
        ctx.trigger = async (event: string, payload: unknown) => {
            announced.push({
                event,
                payload,
                // The PACKAGE's registration — `register` also receives the
                // plugin's own Setup nav bundle at `kernel:ready`.
                registered: register.mock.calls.some(([m]: any[]) => m?.id === APP_ID),
                persisted: existsSync(join(dir, `${APP_ID}.json`)),
            });
            if (mode === 'throw') throw new Error('subscriber exploded');
        };
    }
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    const install = async () => rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: ARTIFACT }));
    const reloads = () => announced.filter((a) => a.event === 'metadata:reloaded');
    const warnings = () => logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    return { install, reloads, warnings, register };
}

describe('#21322: a hot install re-runs the boot sweeps through metadata:reloaded', () => {
    it('install — announces metadata:reloaded exactly once, naming the app, after it is registered and persisted', async () => {
        const { install, reloads } = await bootPlugin();
        expect(reloads(), 'precondition: an empty ledger rehydrates nothing and announces nothing').toEqual([]);

        const res = await install();

        expect(res.payload?.success, JSON.stringify(res.payload)).toBe(true);
        expect(reloads()).toEqual([
            { event: 'metadata:reloaded', payload: { changed: [`app/${APP_ID}`] }, registered: true, persisted: true },
        ]);
    });

    it('reinstall — announces again, so an upgraded package re-syncs too', async () => {
        const { install, reloads } = await bootPlugin();
        await install();
        await install();
        expect(reloads()).toHaveLength(2);
    });

    it('rehydrate — announces nothing: it runs inside kernel:ready, ahead of the sweeps', async () => {
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            manifest: { ...ARTIFACT.manifest, objects: ARTIFACT.objects },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });
        const { reloads, register } = await bootPlugin();
        // `register` also receives the plugin's own Setup nav bundle at
        // `kernel:ready`; the package's own registration is the one that matters.
        expect(
            register.mock.calls.filter(([m]: any[]) => m?.id === APP_ID),
            'precondition: the ledger entry was rehydrated',
        ).toHaveLength(1);
        expect(reloads()).toEqual([]);
    });

    it('a subscriber that throws does not fail the install, and the log names the restart', async () => {
        const { install, reloads, warnings } = await bootPlugin({ trigger: 'throw' });
        const res = await install();
        expect(res.status).toBe(200);
        expect(res.payload?.success).toBe(true);
        expect(reloads()).toHaveLength(1);
        const said = warnings().filter((w) => w.includes('metadata:reloaded re-sync FAILED'));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(APP_ID);
        expect(said[0]).toContain('restarts');
    });

    it('a context that cannot announce says so, and the install still lands', async () => {
        const { install, warnings } = await bootPlugin({ trigger: 'absent' });
        const res = await install();
        expect(res.payload?.success).toBe(true);
        expect(warnings().filter((w) => w.includes('cannot announce metadata:reloaded') && w.includes(APP_ID))).toHaveLength(1);
    });
});

/**
 * [#33238] The announcement's subscriber, end to end through this door: a HOT
 * UPGRADE whose new version renames a position carries that position's
 * holders at once, with no restart.
 *
 * Real here: an `ObjectKernel` with a SQL driver, `ObjectQLPlugin` (the
 * `manifest` service over the real `SchemaRegistry`) and `SecurityPlugin` (the
 * `metadata:reloaded` subscriber whose holder carry is under test), booted to
 * `kernel:bootstrapped`; the door's `trigger` is a real plugin context's, so
 * the announcement reaches the kernel's own hook bus. The door's side readers
 * (binder, translations, seeds) are recorders, as in the bare-name suite.
 *
 * The upgrade is over a version the running kernel still serves: the
 * re-register withdraws the position v2 no longer ships (#33050), so the old
 * name is no current position and the reload run judges the package's rename.
 */
const HOT_ID = 'com.acme.hotrename';

/** v1 ships `hotrename_sales_rep`; v2 renames it, declaring the old name. Both ship the CONTROL `hotrename_auditor`. */
const hotRenameVersion = (version: '1.0.0' | '2.0.0') => ({
    manifest: {
        id: HOT_ID,
        name: 'Hot rename',
        namespace: 'hotrename',
        version,
        type: 'app',
        positions: [
            version === '1.0.0'
                ? { name: 'hotrename_sales_rep', label: 'Sales rep' }
                : { name: 'hotrename_crm_sales_rep', label: 'Sales rep', renamedFrom: ['hotrename_sales_rep'] },
            { name: 'hotrename_auditor', label: 'Auditor' },
        ],
    },
});

const SYSTEM = { context: { isSystem: true } } as const;

async function bootRealKernelDoor() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    let kernelCtx: PluginContext | undefined;
    await kernel.use({
        name: 'test.hotrename.driver',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }));
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new SecurityPlugin({ fallbackPermissionSet: null }));
    await kernel.use({
        name: 'test.hotrename.identity',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        async init(ctx: PluginContext) {
            kernelCtx = ctx;
            // The identity objects the security plugin's store reads.
            await ctx.getService<{ register(m: unknown): unknown }>('manifest')
                .register({ id: 'test.hotrename.identity', name: 'Identity', version: '1.0.0', type: 'plugin', objects: [SysUser, SysMember, SysOrganization] });
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
            syncSchemas: async () => undefined,
        }),
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        // The kernel's own hook bus: `SecurityPlugin` hears the announcement.
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

    const install = async (version: '1.0.0' | '2.0.0') => {
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC(hotRenameVersion(version)));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.hotLoaded, JSON.stringify(res.payload)).toBe(true);
        return res;
    };
    const holders = async (): Promise<Record<string, unknown>> => {
        const rows = (await ql.find('sys_user_position', { where: {}, ...SYSTEM })) as Array<Record<string, unknown>>;
        return Object.fromEntries(rows.map((r) => [String(r.id), r.position]));
    };
    const served = (): string[] => ql.registry.listItems<{ name: string }>('position', HOT_ID).map((i) => i.name);
    return { kernel, ql, install, holders, served };
}

describe('#33238: a hot upgrade through this door carries the holders of a position its new version renames, with no restart', () => {
    it('v1 → v2 renaming a position: the holder holds the new name at once; the CONTROL holder is untouched; the same v2 again moves no row', async () => {
        const k = await bootRealKernelDoor();
        try {
            await k.install('1.0.0');
            expect(k.served().sort()).toEqual(['hotrename_auditor', 'hotrename_sales_rep']);
            for (const row of [
                { id: 'h1', user_id: 'u1', position: 'hotrename_sales_rep', organization_id: 'org_a' },
                { id: 'h2', user_id: 'u2', position: 'hotrename_auditor', organization_id: 'org_a' },
            ]) await k.ql.insert('sys_user_position', row, SYSTEM);

            await k.install('2.0.0');

            // [#33050] v1's position is withdrawn by the re-register, so the reload run carries its holder.
            expect(k.served().sort()).toEqual(['hotrename_auditor', 'hotrename_crm_sales_rep']);
            expect(await k.holders()).toEqual({ h1: 'hotrename_crm_sales_rep', h2: 'hotrename_auditor' });

            // Idempotent: the same upgrade again finds nobody on the old name and writes no holder row.
            const update = vi.spyOn(k.ql, 'update');
            await k.install('2.0.0');
            expect(update.mock.calls.filter(([object]) => object === 'sys_user_position')).toEqual([]);
            expect(await k.holders()).toEqual({ h1: 'hotrename_crm_sales_rep', h2: 'hotrename_auditor' });
        } finally {
            await Promise.race([k.kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
        }
    }, 60_000);
});
