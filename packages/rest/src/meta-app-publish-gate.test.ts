// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4829 — end-to-end proof, over the wire, that the ADR-0045 §3 publish gate
// judges `_unpublished` and NOT `hidden`.
//
// The unit pins in `rest.test.ts` exercise `filterAppForUser` directly. This
// file exists because the bug users actually hit was a RESPONSE BODY fact: the
// platform's built-in `account` app is authored `hidden: true` — deliberately,
// so it reaches users through the avatar dropdown rather than the App Switcher
// (`platform-objects`' ACCOUNT_APP: "Surface via the avatar dropdown, not the
// App Switcher") — and the gate read that flag as "unpublished". Every user
// without `studio.access` / `setup.access` therefore got a `GET /api/v1/meta/app`
// with no `account` in it at all: clicking the avatar → 个人资料 landed on
// "App not available — it may still be publishing", and password, avatar,
// linked accounts, active sessions and inbox were unreachable. Admins saw a
// healthy system, which is why it survived a whole release candidate.
//
// So the acceptance criterion is stated the way the report was: what is in the
// JSON the normal user receives. Both read paths are covered, because they are
// separate handlers that each re-derive the gate — `GET /meta/:type` (list) and
// `GET /meta/:type/:name` (single item).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

/**
 * The built-in Account app, in the shape `platform-objects` authors it: hidden
 * from the switcher, permission-gated by nothing, reachable by everyone.
 */
const ACCOUNT_APP = {
    name: 'account',
    label: 'Account',
    hidden: true,
    navigation: [
        { id: 'nav_profile', type: 'page', pageName: 'account_profile' },
        { id: 'nav_sessions', type: 'page', pageName: 'account_sessions' },
    ],
};

/**
 * An AI-materialized build mid-flight: real, active metadata that no end user
 * may observe until Publish clears the gate (ADR-0045 §2/§3).
 */
const UNPUBLISHED_APP = {
    name: 'production_management',
    label: '生产管理',
    _unpublished: true,
    navigation: [{ id: 'nav_secret_lines', type: 'object', objectName: 'secret_production_line' }],
};

const CRM_APP = {
    name: 'crm',
    label: 'CRM',
    navigation: [{ id: 'nav_leads', type: 'object', objectName: 'lead' }],
};

const ALL_APPS = [ACCOUNT_APP, UNPUBLISHED_APP, CRM_APP];

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

/** @param perms system permissions the caller holds */
function setup(perms: string[]) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        // Deep-clone per call: the filter must never mutate stored metadata.
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '');
            return t === 'app' || t === 'apps' ? JSON.parse(JSON.stringify(ALL_APPS)) : [];
        }),
        getMetaItem: vi.fn(async ({ name }: any) => {
            const found = ALL_APPS.find((a) => a.name === name);
            return found ? { type: 'app', name, item: JSON.parse(JSON.stringify(found)) } : undefined;
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    // The RBAC filter only runs for a resolved caller; stubbing the context is
    // the established pattern in this package for exercising it by route.
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: perms });
    rest.registerRoutes();
    return { rest, protocol };
}

async function getList(rest: any, type = 'app') {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
    if (!route) throw new Error('meta/:type route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type }, query: {}, body: {}, headers: {} }, res);
    return res;
}

async function getItem(rest: any, name: string, type = 'app') {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {}, headers: {} }, res);
    return res;
}

/** LIST elements are metadata documents (`{ type, items: [...] }`, or a bare array). */
const appsFrom = (body: any): any[] => (Array.isArray(body) ? body : (body?.items ?? []));
const namesFrom = (body: any): string[] => appsFrom(body).map((a: any) => a?.name);

describe('#4829 — `GET /meta/app` gates on `_unpublished`, never on `hidden`', () => {
    it('LIST: a user with NO permissions receives the hidden `account` app', async () => {
        const { rest } = setup([]);
        const res = await getList(rest);

        expect(res.statusCode).toBe(200);
        // The regression, stated as the bug report stated it.
        expect(namesFrom(res.body)).toContain('account');
        // …and its navigation targets came with it, so 个人资料 resolves.
        const wire = JSON.stringify(res.body);
        expect(wire).toContain('account_profile');
        expect(wire).toContain('account_sessions');
    });

    it('LIST: the same user does NOT receive an unpublished app, nor its targets', async () => {
        const { rest } = setup([]);
        const res = await getList(rest);

        expect(namesFrom(res.body)).not.toContain('production_management');
        // ADR-0045 §3 "externally unobservable" is about the wire bytes: an
        // unpublished build must not leak the names it is built on either.
        expect(JSON.stringify(res.body)).not.toContain('secret_production_line');
    });

    it('LIST: a normal user sees exactly the published set — account included, build excluded', async () => {
        const { rest } = setup(['manage_users']);
        expect(namesFrom((await getList(rest)).body).sort()).toEqual(['account', 'crm']);
    });

    it('LIST: a builder additionally receives the unpublished app (direct-URL preview)', async () => {
        for (const perm of ['studio.access', 'setup.access']) {
            const { rest } = setup([perm]);
            expect(namesFrom((await getList(rest)).body).sort())
                .toEqual(['account', 'crm', 'production_management']);
        }
    });

    it('LIST: `hidden` is served, not stripped — nav placement stays the shell\'s decision', async () => {
        const { rest } = setup([]);
        const account = appsFrom((await getList(rest)).body).find((a: any) => a.name === 'account');
        expect(account?.hidden).toBe(true);
    });

    it('SINGLE ITEM: the hidden account app resolves for a user with no permissions', async () => {
        const { rest } = setup([]);
        const res = await getItem(rest, 'account');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ type: 'app', name: 'account' });
        expect(res.body?.item?.name).toBe('account');
        expect(res.body?.item?.hidden).toBe(true);
    });

    it('SINGLE ITEM: the unpublished app 404s for a non-builder, with the named envelope', async () => {
        const denied = await getItem(setup([]).rest, 'production_management');
        // ADR-0112 — a refusal is asserted by `status` AND `code`, never by
        // "something falsy came back". The 404 is deliberate over a 403: the
        // ADR-0045 §3 contract is *unobservable*, and a 403 confirms existence.
        expect(denied.statusCode).toBe(404);
        expect(denied.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(denied.body?.item).toBeUndefined();
        expect(JSON.stringify(denied.body ?? {})).not.toContain('secret_production_line');

        const allowed = await getItem(setup(['studio.access']).rest, 'production_management');
        expect(allowed.statusCode).toBe(200);
        expect(allowed.body?.item?.name).toBe('production_management');
    });
});
