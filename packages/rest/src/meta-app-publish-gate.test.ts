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

async function getList(rest: any, type = 'app', query: Record<string, unknown> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
    if (!route) throw new Error('meta/:type route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type }, query, body: {}, headers: {} }, res);
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

// ── #7566 ───────────────────────────────────────────────────────────────────
//
// `GET /api/v1/meta/app?id=…` accepted the parameter and then dropped it: the
// SAME apps came back for every value, including one that names no app. The
// acceptance criterion is therefore a BODY fact, not a status code — a route
// that 200s either way is exactly what the reporter saw. Every case below
// asserts the app names in the response.
//
// The defect's cost is that a caller cannot tell a working filter from a
// dropped one: a client that asks for one app and renders `items[0]` gets a
// plausible, wrong answer, and a bogus id can never come back empty.
//
// This file already owns `GET /meta/app`'s list body (the #4829 gate above),
// and the filter has to COMPOSE with that gate rather than sit beside it — an
// `?id=` naming an unpublished app must still be withheld from a non-builder —
// so the cases live here with the fixture that has an unpublished app in it.

describe('#7566 — `GET /meta/app?id=` narrows the list instead of being dropped', () => {
    it('a MATCHING id returns exactly that app', async () => {
        const { rest } = setup(['manage_users']);
        const res = await getList(rest, 'app', { id: 'crm' });

        expect(res.statusCode).toBe(200);
        expect(namesFrom(res.body)).toEqual(['crm']);
        // The stated failure mode: the unasked-for apps are gone. Before this
        // change the assertion below is what failed — `account` came back too.
        expect(namesFrom(res.body)).not.toContain('account');
    });

    it('a NON-MATCHING id returns an empty list — a 200, not a 404, and not every app', async () => {
        const { rest } = setup(['manage_users']);
        const res = await getList(rest, 'app', { id: 'no_such_app' });

        // Empty-vs-404 is measured off this route's siblings, not chosen: the
        // list route serves an empty list for `?package=<no such package>` and
        // for `/meta/view?object=<no such object>`, and the only 404 on the meta
        // surface is the single-item address `GET /meta/:type/:name` (pinned
        // above). A list filter that matched nothing is a list of nothing.
        expect(res.statusCode).toBe(200);
        expect(namesFrom(res.body)).toEqual([]);
        expect(res.body?.error).toBeUndefined();
    });

    it('an ABSENT id still returns the whole published set (the preservation half)', async () => {
        const { rest } = setup(['manage_users']);

        expect(namesFrom((await getList(rest, 'app')).body).sort()).toEqual(['account', 'crm']);
        // `?id=` (empty) is the "no filter" spelling an unset `<select>` submits
        // — the same falsy gate `?package=` on this route has always used. It
        // must not become a new 400 or an empty list.
        expect(namesFrom((await getList(rest, 'app', { id: '' })).body).sort())
            .toEqual(['account', 'crm']);
    });

    it('a MALFORMED id — supplied twice — is refused with 400, not silently resolved', async () => {
        const { rest } = setup(['manage_users']);
        const res = await getList(rest, 'app', { id: ['crm', 'account'] });

        // Two conflicting intents in one well-formed request. Picking one is a
        // wrong answer delivered as a success, and `String(['crm','account'])`
        // would have made it the single app name `'crm,account'` — a name no app
        // has, so the filter would silently empty. ADR-0112 nested envelope with
        // the standard catalog's 400 member, the same answer this route already
        // gives for a repeated `?package=` / `?object=` / `?include=` (#6877).
        expect(res.statusCode).toBe(400);
        expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(res.body?.error?.message).toContain('"id"');
        // Refused means refused: no app list rode along with the error.
        expect(res.body?.items).toBeUndefined();
        expect(Array.isArray(res.body)).toBe(false);
    });

    it('a one-element array is ONE occurrence and still filters', async () => {
        // `?id=crm` reaches some adapters as `['crm']`; that is one occurrence
        // encoded differently, not a repetition, so it must narrow rather than
        // 400 — and it must not survive as an array into the comparison, where
        // `['crm'] === 'crm'` is false and the filter would empty.
        const { rest } = setup(['manage_users']);
        const res = await getList(rest, 'app', { id: ['crm'] });

        expect(res.statusCode).toBe(200);
        expect(namesFrom(res.body)).toEqual(['crm']);
    });

    it('the PLURAL spelling filters identically — `/meta/apps?id=`', async () => {
        // Prime Directive #3 makes plural the canonical REST spelling, and every
        // other per-type filter on this handler keys off the singular through
        // `metaTypeSingular`. A filter that only ran on `/meta/app` would be the
        // #6238-class spelling hole one parameter over.
        const { rest } = setup(['manage_users']);

        expect(namesFrom((await getList(rest, 'apps', { id: 'crm' })).body)).toEqual(['crm']);
        expect(namesFrom((await getList(rest, 'apps', { id: 'no_such_app' })).body)).toEqual([]);
    });

    it('composes WITH the publish gate — `?id=<unpublished>` stays withheld from a non-builder', async () => {
        // The filter narrows within what the caller may observe, never around
        // it. ADR-0045 §3 says an unpublished app is externally unobservable, so
        // naming it must answer the same empty list as naming a nonexistent one
        // — the two are indistinguishable to a non-builder by design.
        const denied = await getList(setup(['manage_users']).rest, 'app', { id: 'production_management' });
        expect(denied.statusCode).toBe(200);
        expect(namesFrom(denied.body)).toEqual([]);
        expect(JSON.stringify(denied.body)).not.toContain('secret_production_line');

        // …and a builder, who may observe it, gets it — narrowed to just it.
        const allowed = await getList(setup(['studio.access']).rest, 'app', { id: 'production_management' });
        expect(namesFrom(allowed.body)).toEqual(['production_management']);
    });

    it('does not depend on what the caller holds — a caller with NO permissions filters too', async () => {
        // The permission filter above lives in a branch of its own, guarded by
        // a resolved `ctx?.userId`. The `id` filter is deliberately NOT inside
        // that branch: narrowing to the app you named is not a privilege, and a
        // caller holding nothing asked the same question as an admin.
        //
        // (An anonymous caller is not the case to state this with: the
        // anonymous-deny gate refuses `GET /meta/:type` with 401 before the
        // handler body runs at all, unconditionally since #3963 — measured, not
        // assumed. The least-privileged caller who reaches the filter is this
        // one.)
        const { rest } = setup([]);

        expect(namesFrom((await getList(rest, 'app', { id: 'account' })).body)).toEqual(['account']);
        expect(namesFrom((await getList(rest, 'app', { id: 'no_such_app' })).body)).toEqual([]);
        // Unfiltered, the same caller still receives everything the gate lets
        // through — the filter is what changed, not the gate.
        expect(namesFrom((await getList(rest, 'app')).body).length).toBeGreaterThan(1);
    });

    it('is scoped to `app` — another type\'s list is not narrowed by `?id=`', async () => {
        // Deliberately not generalised: #7566 is filed on the app list, and
        // teaching every meta type an `id` filter in the same change would be
        // surface expansion with nothing measured behind it. `?id=` on another
        // type keeps being ignored exactly as before.
        const { rest, protocol } = setup(['manage_users']);
        protocol.getMetaItems = vi.fn(async ({ type }: any) =>
            String(type ?? '') === 'view' ? [{ name: 'all_leads' }, { name: 'my_leads' }] : []);

        const res = await getList(rest, 'view', { id: 'all_leads' });
        expect(res.statusCode).toBe(200);
        expect(namesFrom(res.body)).toEqual(['all_leads', 'my_leads']);
    });
});
