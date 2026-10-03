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
