// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 Q3, #30884] The marketplace door's dry run: `dryRun: true`
 * answers the package upgrade plan of the installed version (its ledger
 * entry) against the incoming one, read from the `manifest` service's
 * `planUpgrade`, and writes nothing — no registration, no schema sync, no
 * ledger change.
 *
 * `planUpgrade` here is the comparison the real service runs
 * (`comparePackageVersions`, each side folded by `resolveStackCollection`)
 * with an empty environment reading: the readings themselves are pinned on
 * the real engine in `@objectstack/objectql`'s
 * `package-upgrade-environment.test.ts`. What this file pins is the door: what
 * it hands the service, what it answers, and that it writes nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// [#21321] An install binds the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top — never inside a clocked `it`.
import '@objectstack/runtime';
import { resolveStackCollection } from '@objectstack/core';
import { comparePackageVersions } from '@objectstack/metadata-core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, unknown>;

const VENDOR = 'com.acme.leads';
const INSTALLER = 'usr_installer';

function vendorBody(version: string, fields: Row, data: Row[] = []): Row {
    return {
        id: VENDOR,
        namespace: 'acme',
        version,
        objects: [{ name: 'acme_lead', label: 'Lead', fields }],
        ...(data.length > 0 ? { data } : {}),
    };
}

const V1 = vendorBody('1.0.0', { company: { type: 'text' } }, [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', company: 'Acme' }] }]);
const V2 = vendorBody('2.0.0', { account_name: { type: 'text' } }, [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', account_name: 'Acme' }] }]);

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
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-upgrade-plan-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const fold = (artifact: unknown) => ({ objects: resolveStackCollection(artifact, 'objects'), data: resolveStackCollection(artifact, 'data') });

async function mount(options: { installed?: Row; planUpgrade?: false } = {}) {
    const register = vi.fn();
    const syncSchemas = vi.fn(async () => undefined);
    const planUpgrade = vi.fn(async (installed: unknown, incoming: unknown) => ({
        plan: comparePackageVersions(fold(installed), fold(incoming)),
        environment: { columns: [], removedObjects: [], seeds: [] },
    }));
    const rawApp = makeRawApp();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, any> = {
        manifest: options.planUpgrade === false ? { register } : { register, planUpgrade },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({ syncSchemas }, INSTALLER),
    };
    const hooks = new Map<string, any>();
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const install = rawApp.routes.get('POST /api/v1/marketplace/install-local')!;
    if (options.installed) {
        const first = await install(makeC({ manifest: options.installed }));
        expect(first.status).toBe(200);
    }
    register.mockClear();
    syncSchemas.mockClear();
    return { install, register, syncSchemas, planUpgrade };
}

/** Every ledger file and its bytes. */
const ledgerFiles = (): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

describe('dryRun: true answers the upgrade plan and writes nothing', () => {
    it('a re-install: the installed ledger body against the incoming one; registry, schema and ledger untouched', async () => {
        const door = await mount({ installed: V1 });
        const before = ledgerFiles();

        const res = await door.install(makeC({ manifest: V2, dryRun: true }));

        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ dryRun: true, manifestId: VENDOR, version: '2.0.0', installedVersion: '1.0.0' });
        expect(res.payload.data.plan.suspectedRenames).toEqual([
            { object: 'acme_lead', field: 'company', type: 'text', candidates: [{ field: 'account_name', type: 'text' }] },
        ]);
        expect(res.payload.data.plan.seeds.changed).toEqual([expect.objectContaining({ key: 'acme_lead', mode: 'upsert', changed: ['records'] })]);
        expect(res.payload.data.environment).toEqual({ columns: [], removedObjects: [], seeds: [] });
        expect(res.payload.data.message).toMatch(/from 1\.0\.0 to 2\.0\.0\. Nothing was installed or written\./);

        // The service was handed the installed version from the ledger and the incoming one.
        const [installed, incoming] = door.planUpgrade.mock.calls[0];
        expect(resolveStackCollection(installed, 'objects')).toEqual(V1.objects);
        expect(resolveStackCollection(incoming, 'objects')).toEqual(V2.objects);

        // Nothing written: no registration, no schema sync, the ledger byte for byte.
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
        expect(new LocalManifestSource(dir).read(VENDOR).entry?.version).toBe('1.0.0');
    });

    it('a package not installed here: the plan lists what it adds, and no ledger entry appears', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: true }));
        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ dryRun: true, installedVersion: null });
        expect(res.payload.data.plan.objects.added).toEqual(['acme_lead']);
        expect(res.payload.data.message).toMatch(/is not installed here/);
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });

    it('CONTROL: the same request without dryRun installs', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(200);
        expect(door.register).toHaveBeenCalledTimes(1);
        expect(door.planUpgrade).not.toHaveBeenCalled();
        expect(new LocalManifestSource(dir).read(VENDOR).entry?.version).toBe('2.0.0');
    });

    it('a runtime whose manifest service answers no planUpgrade answers 503, never an empty plan', async () => {
        const door = await mount({ installed: V1, planUpgrade: false });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2, dryRun: true }));
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(res.payload.error.message).toMatch(/planUpgrade/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });
});

describe('a dryRun this door cannot honour is refused, never run as an install', () => {
    it('a dryRun that is not a boolean', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: 'yes' }));
        expect(res.status).toBe(400);
        expect(res.payload.error).toMatchObject({ code: 'INVALID_REQUEST' });
        expect(res.payload.error.message).toMatch(/`dryRun` must be true or false/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });

    it('a dry run of an unmanaged install', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: true, installMode: 'unmanaged' }));
        expect(res.status).toBe(400);
        expect(res.payload.error.message).toMatch(/an `unmanaged` install is a copy that follows no upgrade/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });
});
