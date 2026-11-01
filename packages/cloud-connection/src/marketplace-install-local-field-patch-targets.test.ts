// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] `POST /api/v1/marketplace/install-local` step
 * 2e: a package whose `objectExtensions[].fieldPatches` names a field its
 * target does not have, or an option value the field does not have, is refused
 * `400 VALIDATION_ERROR` before anything is registered, written or synced.
 *
 * The target is the registry's resolved object (ADR-0141 D2 admitted the base
 * first), or one the same artifact delivers. A patch that matches installs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
// An install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin); its first load is paid here, at module
// top, never inside a clocked `it`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const BASE = 'com.example.crm';

/** The installed vendor object, as the registry serves it. */
const ACCOUNT = {
    name: 'crm_account',
    fields: {
        industry: {
            type: 'select', label: 'Industry',
            options: [{ value: 'tech', label: 'Tech' }, { value: 'retail', label: 'Retail' }],
        },
    },
};

const extensionPackage = (fieldPatches: Record<string, unknown>) => ({
    id: 'com.example.crm-wording', name: 'CRM wording', version: '1.0.0', scope: 'project', type: 'module',
    dependencies: { [BASE]: '1.x' },
    objectExtensions: [{ extend: 'crm_account', fieldPatches }],
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
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

async function mount(dir: string) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const register = vi.fn();
    const syncSchemas = vi.fn(async () => undefined);
    const registry = {
        getAllPackages: () => [],
        getPackage: (id: string) => (id === BASE ? { manifest: { id, version: '1.2.0' } } : undefined),
        getObject: (name: string) => (name === ACCOUNT.name ? structuredClone(ACCOUNT) : undefined),
    };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry }),
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const registeredAtBoot = register.mock.calls.length;
    return {
        install: (body: unknown) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body)),
        installRegistrations: () => register.mock.calls.slice(registeredAtBoot),
        syncs: () => syncSchemas.mock.calls.length,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-field-patch-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function expectRefusal(res: { payload: any; status: number }, paths: string[]) {
    expect(res.status, JSON.stringify(res.payload)).toBe(400);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.error.code).toBe('VALIDATION_ERROR');
    expect(res.payload.error.details.refusals.map((r: any) => r.path)).toEqual(paths);
}

describe('install-local 2e — the field-patch target check (ADR-0146 D10)', () => {
    it('refuses a patch naming a field the installed target does not have, and installs nothing', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: extensionPackage({ sector: { label: 'Sector' } }) });
        expectRefusal(res, ['objectExtensions[0].fieldPatches.sector']);
        expect(h.installRegistrations()).toEqual([]);
        expect(h.syncs()).toBe(0);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('refuses a patch naming an option value the field does not have', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: extensionPackage({ industry: { options: { finance: { label: 'Finance' } } } }) });
        expectRefusal(res, ['objectExtensions[0].fieldPatches.industry.options.finance']);
        expect(res.payload.error.details.refusals[0]).toMatchObject({ object: 'crm_account', field: 'industry', option: 'finance', reason: 'option' });
        expect(h.installRegistrations()).toEqual([]);
    });

    it('judges a compiled artifact as `os package install <file>` sends it (the nested manifest flattened)', async () => {
        const h = await mount(dir);
        const pkg = extensionPackage({ sector: { label: 'Sector' } });
        const { objectExtensions, ...manifest } = pkg;
        const res = await h.install({ manifest: { manifest, objectExtensions, id: manifest.id, version: manifest.version } });
        expectRefusal(res, ['objectExtensions[0].fieldPatches.sector']);
    });

    it('judges a target the same artifact delivers, under its packages[] entry', async () => {
        const h = await mount(dir);
        const res = await h.install({
            manifest: {
                id: 'com.example.multi', name: 'Multi', version: '1.0.0', scope: 'project', type: 'app',
                packages: [
                    { manifest: { id: 'com.example.multi.core', name: 'Core', version: '1.0.0', type: 'app',
                        objects: [{ name: 'multi_ticket', fields: { status: { type: 'text', label: 'Status' } } }] } },
                    { manifest: { id: 'com.example.multi.wording', name: 'Wording', version: '1.0.0', type: 'module',
                        objectExtensions: [{ extend: 'multi_ticket', fieldPatches: { state: { label: 'State' } } }] } },
                ],
            },
        });
        expectRefusal(res, ['packages[1].manifest.objectExtensions[0].fieldPatches.state']);
    });

    it('lit control: a patch whose field and option the target has installs', async () => {
        const h = await mount(dir);
        const res = await h.install({
            manifest: extensionPackage({ industry: { label: 'Sector', options: { tech: { label: 'Technology' } } } }),
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations()).toHaveLength(1);
    });
});
