// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2, ruling A on #28390; #28410] Step 2d of `POST
 * /api/v1/marketplace/install-local` — the override write gate at the managed
 * install, the door a package's items enter through as code, past every
 * publish door.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeOverrideWrite`, the
 * publish doors' own; its sentences are pinned in that package. What is
 * pinned here is the door:
 *
 *  - an incoming item the gate refuses stops the install `403
 *    NOT_OVERRIDABLE`, one entry per item in `details.refusals`, before any
 *    write — nothing registered, no ledger entry;
 *  - the base's paired `.custom` installs its admitted declarations;
 *  - an install of a base lists, on its answer (`overrideCollisions`), the
 *    names installed dependents already hold, undeclared, that it now ships —
 *    and omits the key when there are none.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin); its first load is paid here, at module
// top — never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { judgeOverrideWrite } from '@objectstack/metadata-protocol';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = 'POST /api/v1/marketplace/install-local';
const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.acme.partner';

const deps = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, '*']));

/** What each installed package holds, as the protocol's per-package listing answers it. */
type Holdings = Record<string, Record<string, Array<Record<string, unknown>>>>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/**
 * A kernel whose registry holds `installed` (BASE read-only — a code or
 * marketplace package is in `manifests`) and whose protocol lists `holdings`.
 */
function makeCtx(rawApp: any, installed: Array<{ id: string; dependencies?: Record<string, string> }>, holdings: Holdings) {
    const hooks = new Map<string, any>();
    const registered: any[] = [];
    const records = installed.map((p) => ({ manifest: { id: p.id, version: '1.0.0', ...(p.dependencies ? { dependencies: p.dependencies } : {}) } }));
    const services: Record<string, any> = {
        manifest: { register: (m: any) => registered.push({ manifest: m }) },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            syncSchemas: async () => undefined,
            manifests: new Map(installed.some((p) => p.id === BASE) ? [[BASE, {}]] : []),
            registry: {
                getAllPackages: () => [...records, ...registered],
                getPackage: (id: string) => records.find((r) => r.manifest.id === id),
            },
        }),
        protocol: {
            getMetaItems: async ({ type, packageId }: { type: string; packageId?: string }) => ({
                type,
                items: (holdings[packageId ?? '']?.[type] ?? []).map((i) => ({ ...i, _packageId: packageId })),
            }),
        },
        metadata: { get: async () => undefined },
    };
    return {
        registered,
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            registerService: (name: string, svc: unknown) => { services[name] = svc; },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return { req: { url: 'http://localhost:3000/x', raw: new Request('http://localhost:3000/x'), json: async () => body, param: () => undefined }, json };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-override-gate-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const BASE_HOLDINGS: Holdings = {
    [BASE]: {
        dashboard: [{ name: 'crm_board', label: 'Board' }],
        object: [{ name: 'crm_account' }],
        flow: [{ name: 'crm_followup', label: 'Follow up' }],
        action: [{ name: 'crm_call', label: 'Call' }],
    },
};

async function install(
    manifest: Record<string, unknown>,
    installed: Array<{ id: string; dependencies?: Record<string, string> }> = [{ id: BASE }],
    holdings: Holdings = BASE_HOLDINGS,
) {
    const rawApp = makeRawApp();
    const k = makeCtx(rawApp, installed, holdings);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(k.ctx as any);
    await k.fire();
    const res = await rawApp.routes.get(ROUTE)!(makeC({ manifest }));
    const registered = k.registered.map((r) => r.manifest.id).filter((id) => id === manifest.id);
    return { res, registered, ledger: readdirSync(dir) };
}

const refusedOf = (res: any) => (res.payload?.error?.details?.refusals ?? []).map((r: any) => [r.type, r.name, r.rule]);

describe('install-local 2d — the override write gate at the managed install (ADR-0146 D2)', () => {
    it('a dependent shipping an item under the name its base ships is refused 403, and nothing is written', async () => {
        const item = { name: 'crm_board', label: 'Mine' };
        const { res, registered, ledger } = await install({
            id: PARTNER, version: '1.0.0', dependencies: deps(BASE), dashboards: [item],
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(403);
        expect(res.payload?.error?.code).toBe('NOT_OVERRIDABLE');
        const verdict = judgeOverrideWrite(
            { type: 'dashboard', name: 'crm_board', packageId: PARTNER, item },
            { dependencies: [BASE], shippers: [BASE] },
        );
        expect(res.payload.error.details.refusals).toEqual([
            { type: 'dashboard', name: 'crm_board', rule: 'undeclared_same_name', message: (verdict as any).message },
        ]);
        expect(res.payload.error.message).toContain((verdict as any).message);
        expect(registered).toEqual([]);
        expect(ledger).toEqual([]);
    });

    it('a dependent carrying `overrides` is refused: only the base\'s paired .custom declares', async () => {
        const { res, registered } = await install({
            id: PARTNER, version: '1.0.0', dependencies: deps(BASE),
            dashboards: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }],
        });
        expect(res.status).toBe(403);
        expect(refusedOf(res)).toEqual([['dashboard', 'crm_board', 'declared_outside_pair']]);
        expect(registered).toEqual([]);
    });

    it('the paired .custom declaring an object override is refused (objects are extended)', async () => {
        const { res } = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            objects: [{ name: 'crm_account', overrides: { package: BASE, basedOn: '1.0.0' }, fields: {} }],
        });
        expect(res.status).toBe(403);
        expect(refusedOf(res)).toEqual([['object', 'crm_account', 'declared_object']]);
    });

    it('the paired .custom installs its declared override of an item the base ships', async () => {
        const { res, registered } = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            dashboards: [{ name: 'crm_board', label: 'Ours', overrides: { package: BASE, basedOn: '1.0.0' } }],
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered).toEqual([PAIR]);
        expect(res.payload.data).not.toHaveProperty('overrideCollisions');
    });

    it('[#28412] the paired .custom installs its declared FLOW override; a declared action override still waits', async () => {
        // ADR-0146 D9: flow's conditions are delivered, so the gate admits it.
        const flow = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            flows: [{ name: 'crm_followup', label: 'Ours', overrides: { package: BASE, basedOn: '1.0.0' } }],
        });
        expect(flow.res.status, JSON.stringify(flow.res.payload)).toBe(200);
        expect(flow.registered).toEqual([PAIR]);

        const action = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            actions: [{ name: 'crm_call', label: 'Ours', overrides: { package: BASE, basedOn: '1.0.0' } }],
        });
        expect(action.res.status).toBe(403);
        expect(refusedOf(action.res)).toEqual([['action', 'crm_call', 'declared_type_not_yet_available']]);
    });

    it('CONTROL: a dependent shipping its own names installs, and its answer carries no collision key', async () => {
        const { res, registered } = await install({
            id: PARTNER, version: '1.0.0', dependencies: deps(BASE), dashboards: [{ name: 'partner_board' }],
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered).toEqual([PARTNER]);
        expect(res.payload.data).not.toHaveProperty('overrideCollisions');
    });

    it('an install of a base lists the names installed dependents already hold undeclared, and never a declared override', async () => {
        const partnerItem = { name: 'crm_new', label: 'Partner new' };
        const { res, registered } = await install(
            {
                id: BASE, version: '2.0.0',
                dashboards: [{ name: 'crm_board' }, { name: 'crm_new' }],
                pages: [{ name: 'crm_home' }],
            },
            [{ id: PARTNER, dependencies: deps(BASE) }, { id: PAIR, dependencies: deps(BASE) }],
            {
                [PARTNER]: { dashboard: [partnerItem] },
                [PAIR]: {
                    dashboard: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }],
                    page: [{ name: 'crm_home' }],
                },
            },
        );
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered).toEqual([BASE]);
        const collisions = res.payload.data.overrideCollisions;
        expect(collisions.map((c: any) => [c.packageId, c.type, c.name, c.rule])).toEqual([
            [PARTNER, 'dashboard', 'crm_new', 'undeclared_same_name'],
            [PAIR, 'page', 'crm_home', 'undeclared_same_name'],
        ]);
        expect(collisions[1].message).toMatch(/Declare it/);
    });

    // [#28746] An email template is one item per `(name, locale)`: the base
    // below ships `crm_welcome` in `en-US` only, so a member is judged alone.
    const TEMPLATE_HOLDINGS: Holdings = {
        [BASE]: { email_template: [{ name: 'crm_welcome', locale: 'en-US', subject: 'Welcome' }] },
    };
    const DECLARED = { package: BASE, basedOn: '1.0.0' } as const;

    it('[#28746] the paired .custom declaring an override of a locale the base does not ship is refused 403, and nothing is written', async () => {
        const { res, registered, ledger } = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            emailTemplates: [{ name: 'crm_welcome', locale: 'fr-FR', subject: 'Bienvenue', overrides: { ...DECLARED } }],
        }, [{ id: BASE }], TEMPLATE_HOLDINGS);
        expect(res.status, JSON.stringify(res.payload)).toBe(403);
        expect(res.payload?.error?.code).toBe('NOT_OVERRIDABLE');
        expect(refusedOf(res)).toEqual([['email_template', 'crm_welcome', 'declared_package_ships_no_such_item']]);
        expect(registered).toEqual([]);
        expect(ledger).toEqual([]);
    });

    it('[#28746] CONTROL: the pair overrides the locale the base ships, and adds an undeclared locale of its own', async () => {
        const { res, registered } = await install({
            id: PAIR, version: '1.0.0', dependencies: deps(BASE),
            emailTemplates: [
                { name: 'crm_welcome', locale: 'en-US', subject: 'Ours', overrides: { ...DECLARED } },
                { name: 'crm_welcome', locale: 'fr-FR', subject: 'Bienvenue' },
            ],
        }, [{ id: BASE }], TEMPLATE_HOLDINGS);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered).toEqual([PAIR]);
    });
});
