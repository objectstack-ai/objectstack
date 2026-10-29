// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27395 — `DELETE /api/v1/marketplace/install-local/:manifestId` announces
 * the withdrawal to the running kernel as `metadata:reloaded`, the re-sync
 * signal the install door's hot load announces.
 *
 * The defect: the door withdrew the package from the registry and ran the
 * uninstall cleanups, and announced nothing. The automation engine withdraws a
 * flow only in its re-sync on that signal (`resyncFlowsFromProtocol`), so the
 * uninstalled package's flows stayed registered and triggerable — their
 * record and schedule triggers armed — until an unrelated reload, while the
 * door's note said the package was withdrawn from the running kernel.
 * Triage's ruling: the uninstall drives the same unregister path a reload
 * uses; one teardown, not a second engine-side list.
 *
 * What this file pins about the plugin's half (the engine's half — a re-sync
 * withdraws a flow the protocol's view no longer lists, and unbinds its
 * trigger — is pinned in service-automation; end to end, on the real showcase
 * composition, in the dogfood suite
 * `install-local-uninstall-flows-withdrawn.dogfood.test.ts`):
 *
 *   - exactly one `metadata:reloaded`, naming the app the install registered,
 *     announced LAST: after the registry withdrawal and after the cleanups —
 *     never before, for the window the door's own comment describes;
 *   - nothing announced when the uninstall did not happen: a refused caller,
 *     an id this door never installed, a ledger write that failed;
 *   - nothing announced when the registry refused the withdrawal — the
 *     package is still registered, so a re-sync would only read it back;
 *   - a re-sync that throws, or a context that cannot announce, is one failed
 *     outcome on the response (`cleanups`), never swallowed, and the cause
 *     goes to the operator log only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`): the plugin reaches the
// same module through a dynamic `import()` for its handler binder on rehydrate.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { INSTALLER_USER_ID, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

const APP_ID = 'com.example.tasksapp';
/** A package the running registry holds that this door never installed — config-defined code. */
const USER_CODE_ID = 'com.example.usercode';
const CLEANUP_OUTCOMES = [{ name: 'security.package-permissions', success: true, removed: 3 }];

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

function makeDeleteC(manifestId: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000/api/v1/marketplace/install-local/${manifestId}`,
            raw: new Request('http://localhost:3000/x'),
            json: async () => ({}),
            param: (name: string) => (name === 'manifestId' ? manifestId : undefined),
        },
        json,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-uninstall-resync-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function seedLedger(): void {
    new LocalManifestSource(dir).write({
        packageId: APP_ID,
        versionId: 'local',
        manifestId: APP_ID,
        version: '0.1.0',
        manifest: { id: APP_ID, name: 'Tasks App', objects: [] },
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: INSTALLER_USER_ID,
        withSampleData: false,
    });
}

const ledgerFile = () => join(dir, `${APP_ID}.json`);

/**
 * Boot the plugin to `kernel:ready` and hand back its DELETE route, over an
 * `objectql` registry, a `protocol` cleanup runner and a kernel `trigger` —
 * all three recording, in ONE ordered list, each call, whether the package
 * was still registered and whether its ledger entry was still on disk.
 */
async function bootPlugin(opts: {
    trigger?: 'record' | 'throw' | 'absent';
    refuseWithdrawal?: string;
    auth?: unknown;
} = {}) {
    const mode = opts.trigger ?? 'record';
    const events: Array<{ step: string; detail: unknown; registered: boolean; ledgerOnDisk: boolean }> = [];
    const packages = new Map([APP_ID, USER_CODE_ID].map((id) => [id, { manifest: { id } }]));
    const record = (step: string, detail: unknown) =>
        events.push({ step, detail, registered: packages.has(APP_ID), ledgerOnDisk: existsSync(ledgerFile()) });
    const registry = {
        getAllPackages: () => [...packages.values()],
        getPackage: (id: string) => packages.get(id),
        uninstallPackage: vi.fn((id: string) => {
            record('withdraw', id);
            if (opts.refuseWithdrawal) throw new Error(opts.refuseWithdrawal);
            return packages.delete(id);
        }),
    };
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const rawApp = makeRawApp();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: opts.auth ?? installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined, registry }),
        protocol: {
            runUninstallCleanups: vi.fn(async (request: { packageId: string }) => {
                record('cleanups', request.packageId);
                return CLEANUP_OUTCOMES;
            }),
        },
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
            record(event, payload);
            if (mode === 'throw') throw new Error('subscriber exploded');
        };
    }
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    // Only what the DELETE does is read below.
    events.length = 0;
    const uninstall = async (manifestId = APP_ID) =>
        rawApp.routes.get('DELETE /api/v1/marketplace/install-local/:manifestId')!(makeDeleteC(manifestId));
    const reloads = () => events.filter((e) => e.step === 'metadata:reloaded');
    const warnings = () => logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    return { uninstall, events, reloads, warnings };
}

describe('#27395: an install-local uninstall announces metadata:reloaded, so the engine withdraws the package\'s flows', () => {
    it('announces exactly once, naming the app, LAST — after the registry withdrawal and after the cleanups', async () => {
        seedLedger();
        const { uninstall, events, warnings } = await bootPlugin();

        const res = await uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(events).toEqual([
            { step: 'withdraw', detail: APP_ID, registered: true, ledgerOnDisk: false },
            { step: 'cleanups', detail: APP_ID, registered: false, ledgerOnDisk: false },
            { step: 'metadata:reloaded', detail: { changed: [`app/${APP_ID}`] }, registered: false, ledgerOnDisk: false },
        ]);
        // A re-sync that ran adds nothing to the outcomes.
        expect(res.payload.data.cleanups).toEqual(CLEANUP_OUTCOMES);
        expect(warnings()).toEqual([]);
    });

    it('a refused caller announces nothing', async () => {
        seedLedger();
        const { uninstall, reloads } = await bootPlugin({ auth: { api: { getSession: async () => null } } });

        const res = await uninstall();

        expect(res.status).toBe(401);
        expect(reloads()).toEqual([]);
    });

    it('an id this door never installed announces nothing — even one the running registry holds', async () => {
        seedLedger();
        const { uninstall, reloads } = await bootPlugin();

        const res = await uninstall(USER_CODE_ID);

        expect(res.status).toBe(404);
        expect(reloads()).toEqual([]);
    });

    it('a ledger write that fails announces nothing — the package is still installed', async () => {
        seedLedger();
        vi.spyOn(LocalManifestSource.prototype, 'remove').mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });
        const { uninstall, events } = await bootPlugin();

        const res = await uninstall();

        expect(res.status).toBe(500);
        expect(events).toEqual([]);
    });

    it('a refused registry withdrawal announces nothing — the package is still registered', async () => {
        seedLedger();
        const { uninstall, events } = await bootPlugin({
            refuseWithdrawal: 'Cannot uninstall package: an object it owns is extended by another package',
        });

        const res = await uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(events.map((e) => e.step)).toEqual(['withdraw', 'cleanups']);
        expect(res.payload.data.cleanups.map((o: { name: string }) => o.name)).toEqual([
            'registry.uninstallPackage',
            ...CLEANUP_OUTCOMES.map((o) => o.name),
        ]);
    });

    it('a re-sync that throws is one failed outcome on the response, LAST, and the cause stays in the log', async () => {
        seedLedger();
        const { uninstall, reloads, warnings } = await bootPlugin({ trigger: 'throw' });

        const res = await uninstall();

        // The uninstall itself happened — the ledger entry is gone, the
        // registry withdrew — so the request succeeded; what did not complete
        // is reported, not swallowed.
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(existsSync(ledgerFile())).toBe(false);
        expect(reloads()).toHaveLength(1);
        const outcomes = res.payload.data.cleanups;
        expect(outcomes.slice(0, -1)).toEqual(CLEANUP_OUTCOMES);
        expect(outcomes.at(-1)).toMatchObject({ name: 'metadata:reloaded', success: false, removed: 0 });
        expect(typeof outcomes.at(-1).error).toBe('string');
        // The note no longer claims a withdrawal the engine did not see.
        expect(res.payload.data.note).toContain('`metadata:reloaded`');
        // The thrown text goes to the operator log only, never onto the wire.
        expect(JSON.stringify(res.payload)).not.toContain('subscriber exploded');
        const said = warnings().filter((w) => w.includes('subscriber exploded'));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(APP_ID);
        expect(said[0]).toContain('restart');
    });

    it('a context that cannot announce is the same failed outcome, and says so in the log', async () => {
        seedLedger();
        const { uninstall, warnings } = await bootPlugin({ trigger: 'absent' });

        const res = await uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.cleanups.at(-1)).toMatchObject({ name: 'metadata:reloaded', success: false, removed: 0 });
        expect(warnings().filter((w) => w.includes('cannot announce metadata:reloaded') && w.includes(APP_ID))).toHaveLength(1);
    });
});
