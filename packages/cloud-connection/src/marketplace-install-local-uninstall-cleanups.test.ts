// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21490 — `DELETE /api/v1/marketplace/install-local/:manifestId` runs the
 * protocol's registered uninstall cleanups, through the protocol's own runner,
 * once the ledger entry is gone, and reports each outcome as `cleanups`.
 *
 * The defect: the door removed the ledger entry and nothing else, so the
 * package's `managed_by: package` permission sets — and every grant of them —
 * outlived the uninstall (ADR-0090: "No ghost grants"). `plugin-security`
 * registers that revocation with the protocol (`security.package-permissions`);
 * only the protocol's own uninstall ran the registry.
 *
 * What this file pins about the plugin's half (the runner's half is pinned in
 * `@objectstack/metadata-protocol`, and end to end — the rows themselves,
 * before and after a restart — in the CLI suite
 * `package-install-local-uninstall-cleanups.integration.test.ts`):
 *
 *   - the runner is called once, with the MANIFEST id, the operator as actor
 *     and no organization, AFTER the ledger entry is gone, and its outcomes are
 *     answered verbatim;
 *   - a failed cleanup is reported on the response, never swallowed, and the
 *     operator log names it and the remedy;
 *   - nothing is revoked when the uninstall did not happen: a refused caller,
 *     an id this door never installed, a ledger write that failed;
 *   - the three composition answers: no protocol (nothing registered, `[]`),
 *     a protocol without the runner, a runner that throws (one failed outcome
 *     each, so "nothing to revoke" and "the revocation never ran" differ).
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
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-uninstall-')); });
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

type ProtocolMode =
    | { kind: 'runner'; outcomes?: unknown[] }
    | { kind: 'throws' }
    | { kind: 'no-runner' }
    | { kind: 'absent' };

/**
 * Boot the plugin to `kernel:ready` and hand back its DELETE route, with a
 * `protocol` service whose runner records every call — and, at the moment of
 * each, whether the ledger file was still on disk.
 */
async function bootPlugin(protocolMode: ProtocolMode = { kind: 'runner' }, opts: { auth?: unknown } = {}) {
    const calls: Array<{ request: unknown; ledgerOnDisk: boolean }> = [];
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const rawApp = makeRawApp();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: opts.auth ?? installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
    };
    if (protocolMode.kind === 'runner') {
        services.protocol = {
            runUninstallCleanups: vi.fn(async (request: unknown) => {
                calls.push({ request, ledgerOnDisk: existsSync(ledgerFile()) });
                return protocolMode.outcomes ?? [{ name: 'security.package-permissions', success: true, removed: 3 }];
            }),
        };
    } else if (protocolMode.kind === 'throws') {
        services.protocol = {
            runUninstallCleanups: vi.fn(async (request: unknown) => {
                calls.push({ request, ledgerOnDisk: existsSync(ledgerFile()) });
                throw new Error('runner exploded');
            }),
        };
    } else if (protocolMode.kind === 'no-runner') {
        services.protocol = { deletePackage: vi.fn() };
    }
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
    return { uninstall, calls, warnings };
}

describe('#21490: an install-local uninstall runs the registered uninstall cleanups', () => {
    it('calls the runner once — manifest id, the operator, no organization — after the ledger entry is gone, and answers its outcomes', async () => {
        seedLedger();
        const outcomes = [
            { name: 'security.package-permissions', success: true, removed: 3 },
            { name: 'another.cleanup', success: true, removed: 0 },
        ];
        const { uninstall, calls } = await bootPlugin({ kind: 'runner', outcomes });

        const res = await uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(calls).toEqual([{ request: { packageId: APP_ID, actor: INSTALLER_USER_ID }, ledgerOnDisk: false }]);
        expect(res.payload.data.cleanups).toEqual(outcomes);
        expect(existsSync(ledgerFile())).toBe(false);
    });

    it('a failed cleanup is reported on the response, and the log names it with the remedy', async () => {
        seedLedger();
        const failed = { name: 'security.package-permissions', success: false, removed: 0, error: 'cleanup failed' };
        const { uninstall, warnings } = await bootPlugin({ kind: 'runner', outcomes: [failed] });

        const res = await uninstall();

        // The uninstall itself happened — the ledger entry is gone — so the
        // request succeeded; what did not complete is reported, not swallowed.
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.cleanups).toEqual([failed]);
        const said = warnings().filter((w) => w.includes('did not complete'));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(APP_ID);
        expect(said[0]).toContain('security.package-permissions');
        expect(said[0]).toContain('install the package again and uninstall it again');
    });

    it('a refused caller revokes nothing', async () => {
        seedLedger();
        const { uninstall, calls } = await bootPlugin({ kind: 'runner' }, {
            auth: { api: { getSession: async () => null } },
        });

        const res = await uninstall();

        expect(res.status).toBe(401);
        expect(calls).toEqual([]);
        expect(existsSync(ledgerFile())).toBe(true);
    });

    it('an id this door never installed revokes nothing — another package\'s grants are not this door\'s to touch', async () => {
        const { uninstall, calls } = await bootPlugin({ kind: 'runner' });

        const res = await uninstall('com.example.someoneelse');

        expect(res.status).toBe(404);
        expect(res.payload.error.code).toBe('RESOURCE_NOT_FOUND');
        expect(calls).toEqual([]);
    });

    it('a ledger write that fails revokes nothing — the package is still installed and keeps its grants', async () => {
        seedLedger();
        vi.spyOn(LocalManifestSource.prototype, 'remove').mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });
        const { uninstall, calls } = await bootPlugin({ kind: 'runner' });

        const res = await uninstall();

        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        expect(calls).toEqual([]);
    });

    it('no protocol service — no cleanup registry, nothing registered: `cleanups` is empty', async () => {
        seedLedger();
        const { uninstall, warnings } = await bootPlugin({ kind: 'absent' });

        const res = await uninstall();

        expect(res.status).toBe(200);
        expect(res.payload.data.cleanups).toEqual([]);
        expect(warnings().filter((w) => w.includes('did not complete'))).toEqual([]);
    });

    it('a protocol without the runner — one failed outcome naming the upgrade, never an empty list', async () => {
        seedLedger();
        const { uninstall, warnings } = await bootPlugin({ kind: 'no-runner' });

        const res = await uninstall();

        expect(res.status).toBe(200);
        expect(res.payload.data.cleanups).toHaveLength(1);
        expect(res.payload.data.cleanups[0]).toMatchObject({
            name: 'protocol.runUninstallCleanups',
            success: false,
            removed: 0,
        });
        expect(res.payload.data.cleanups[0].error).toContain('@objectstack/metadata-protocol');
        expect(warnings().filter((w) => w.includes('did not complete') && w.includes(APP_ID))).toHaveLength(1);
    });

    it('a runner that throws — one failed outcome, the cause in the log, and the uninstall stands', async () => {
        seedLedger();
        const { uninstall, calls, warnings } = await bootPlugin({ kind: 'throws' });

        const res = await uninstall();

        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(calls).toHaveLength(1);
        expect(res.payload.data.cleanups).toEqual([
            { name: 'protocol.runUninstallCleanups', success: false, removed: 0, error: 'the uninstall cleanups could not be run' },
        ]);
        // The thrown text goes to the operator log only, never onto the wire.
        expect(JSON.stringify(res.payload)).not.toContain('runner exploded');
        expect(warnings().filter((w) => w.includes('runner exploded') && w.includes(APP_ID))).toHaveLength(1);
        expect(existsSync(ledgerFile())).toBe(false);
    });
});
