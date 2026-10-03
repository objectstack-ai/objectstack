// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21576 — `DELETE /api/v1/marketplace/install-local/:manifestId` withdraws the
 * package from the running kernel, through `SchemaRegistry.uninstallPackage` —
 * the verb the protocol's own uninstall (`deletePackage`) uses — on the
 * `objectql` engine's registry.
 *
 * The defect: the door removed the ledger entry and ran the uninstall cleanups,
 * but left the package registered until the next restart. Another package's hot
 * install then announced `metadata:reloaded`, plugin-security re-ran its
 * declared-permission seeding over every registered package, and the
 * uninstalled package's permission set came back as an orphan `managed_by:
 * package` row (ADR-0090: "No ghost grants").
 *
 * What this file pins about the plugin's half (end to end — the object's hot
 * answer, the re-seed window, a same-process reinstall — lives in the CLI suite
 * `package-install-local-uninstall-cleanups.integration.test.ts`):
 *
 *   - the withdrawal names the MANIFEST id, runs once, after the ledger entry
 *     is gone and BEFORE the cleanups, and adds nothing to `cleanups` when it
 *     succeeds;
 *   - nothing is withdrawn when the uninstall did not happen: a refused caller,
 *     an id this door never installed (even one the registry holds), a ledger
 *     write that failed;
 *   - a refused withdrawal is reported on the response as a failed outcome,
 *     never swallowed, the cleanups still run, and the cause goes to the
 *     operator log only;
 *   - a registry that does not hold the package has nothing to withdraw.
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
/** A cloud install's ledger `packageId` — the catalog's id, NOT the manifest id the registry knows. */
const CATALOG_ID = 'pkg_01tasksapp';
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
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-withdraw-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/** A ledger entry as a CLOUD install writes it: catalog `packageId`, manifest `manifestId`. */
function seedLedger(): void {
    new LocalManifestSource(dir).write({
        packageId: CATALOG_ID,
        versionId: 'v1',
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
 * `objectql` engine whose registry holds `registered` and a `protocol` runner —
 * both recording, in ONE ordered list, each call and whether the ledger file
 * was still on disk at that moment.
 */
async function bootPlugin(opts: {
    registered?: string[];
    refuseWithdrawal?: string;
    auth?: unknown;
} = {}) {
    const events: Array<{ step: string; id: string; ledgerOnDisk: boolean }> = [];
    const packages = new Map((opts.registered ?? [APP_ID, USER_CODE_ID]).map((id) => [id, { manifest: { id } }]));
    const registry = {
        getAllPackages: () => [...packages.values()],
        getPackage: (id: string) => packages.get(id),
        uninstallPackage: vi.fn((id: string) => {
            events.push({ step: 'withdraw', id, ledgerOnDisk: existsSync(ledgerFile()) });
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
                events.push({ step: 'cleanups', id: request.packageId, ledgerOnDisk: existsSync(ledgerFile()) });
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
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    const uninstall = async (manifestId = APP_ID) =>
        rawApp.routes.get('DELETE /api/v1/marketplace/install-local/:manifestId')!(makeDeleteC(manifestId));
    const warnings = () => logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    return { uninstall, events, packages, registry, warnings };
}

describe('#21576: an install-local uninstall withdraws the package from the running kernel', () => {
    it('withdraws by the manifest id, once, after the ledger entry is gone and before the cleanups run', async () => {
        seedLedger();
        const { uninstall, events, packages, warnings } = await bootPlugin();

        const res = await uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(events).toEqual([
            { step: 'withdraw', id: APP_ID, ledgerOnDisk: false },
            { step: 'cleanups', id: APP_ID, ledgerOnDisk: false },
        ]);
        expect(packages.has(APP_ID)).toBe(false);
        // Another package the registry holds is not this uninstall's to touch.
        expect(packages.has(USER_CODE_ID)).toBe(true);
        // A withdrawal that succeeded adds nothing to the outcomes.
        expect(res.payload.data.cleanups).toEqual(CLEANUP_OUTCOMES);
        expect(warnings()).toEqual([]);
    });

    it('a refused caller withdraws nothing', async () => {
        seedLedger();
        const { uninstall, registry, packages } = await bootPlugin({
            auth: { api: { getSession: async () => null } },
        });

        const res = await uninstall();

        expect(res.status).toBe(401);
        expect(registry.uninstallPackage).not.toHaveBeenCalled();
        expect(packages.has(APP_ID)).toBe(true);
        expect(existsSync(ledgerFile())).toBe(true);
    });

    it('an id this door never installed withdraws nothing — even one the running registry holds', async () => {
        seedLedger();
        const { uninstall, registry, packages } = await bootPlugin();

        const res = await uninstall(USER_CODE_ID);

        expect(res.status).toBe(404);
        expect(res.payload.error.code).toBe('RESOURCE_NOT_FOUND');
        expect(registry.uninstallPackage).not.toHaveBeenCalled();
        expect(packages.has(USER_CODE_ID)).toBe(true);
    });

    it('a ledger write that fails withdraws nothing — the package is still installed and stays registered', async () => {
        seedLedger();
        vi.spyOn(LocalManifestSource.prototype, 'remove').mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });
        const { uninstall, events, packages } = await bootPlugin();

        const res = await uninstall();

        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        expect(events).toEqual([]);
        expect(packages.has(APP_ID)).toBe(true);
    });

    it('a refused withdrawal is one failed outcome on the response, the cleanups still run, and the cause stays in the log', async () => {
        seedLedger();
        const cause = 'Cannot uninstall package: an object it owns is extended by another package';
        const { uninstall, events, warnings } = await bootPlugin({ refuseWithdrawal: cause });

        const res = await uninstall();

        // The uninstall itself happened — the ledger entry is gone — so the
        // request succeeded; what did not complete is reported, not swallowed.
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(existsSync(ledgerFile())).toBe(false);
        expect(events.map((e) => e.step)).toEqual(['withdraw', 'cleanups']);
        const [withdrawal, ...rest] = res.payload.data.cleanups;
        expect(withdrawal).toMatchObject({ name: 'registry.uninstallPackage', success: false, removed: 0 });
        expect(typeof withdrawal.error).toBe('string');
        expect(rest).toEqual(CLEANUP_OUTCOMES);
        // The thrown text goes to the operator log only, never onto the wire.
        expect(JSON.stringify(res.payload)).not.toContain(cause);
        expect(warnings().filter((w) => w.includes(cause) && w.includes(APP_ID))).toHaveLength(1);
    });

    it('a registry that does not hold the package has nothing to withdraw — no call, no failed outcome', async () => {
        seedLedger();
        const { uninstall, registry, warnings } = await bootPlugin({ registered: [USER_CODE_ID] });

        const res = await uninstall();

        expect(res.status).toBe(200);
        expect(registry.uninstallPackage).not.toHaveBeenCalled();
        expect(res.payload.data.cleanups).toEqual(CLEANUP_OUTCOMES);
        expect(warnings()).toEqual([]);
    });
});
