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

/**
 * [#8013] A PUBLISHED app the session may only open with a capability it might
 * not hold. Its `requiredPermissions` is a different layer from ADR-0045 §3's
 * publish gate above, and the ONLY one this card converts into a denial.
 */
const FINANCE_APP = {
    name: 'finance',
    label: 'Finance',
    requiredPermissions: ['finance.access'],
    navigation: [{ id: 'nav_invoices', type: 'object', objectName: 'invoice' }],
};

/**
 * [#8013] A published app gated by ADR-0057 D10 capability presence rather than
 * by anything about the caller. Kept out of `ALL_APPS` for the same reason
 * `FINANCE_APP` is: the #4829 / #7566 suites above pin exact name lists.
 */
const OPTIONAL_SERVICE_APP = {
    name: 'telephony',
    label: 'Telephony',
    requiresService: 'voice',
    navigation: [{ id: 'nav_calls', type: 'object', objectName: 'call_log' }],
};

const ALL_APPS = [ACCOUNT_APP, UNPUBLISHED_APP, CRM_APP];

/** [#8013] `ALL_APPS` plus the two extra gate shapes this card partitions. */
const GATED_APPS = [ACCOUNT_APP, UNPUBLISHED_APP, CRM_APP, FINANCE_APP, OPTIONAL_SERVICE_APP];

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

/**
 * @param perms system permissions the caller holds
 * @param apps  the app corpus this server serves. Defaults to `ALL_APPS` so the
 *   #4829 / #7566 suites keep their exact name lists; #8013 passes `GATED_APPS`.
 */
function setup(perms: string[], apps: any[] = ALL_APPS, serviceExists?: (name: string) => boolean) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        // Deep-clone per call: the filter must never mutate stored metadata.
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '');
            return t === 'app' || t === 'apps' ? JSON.parse(JSON.stringify(apps)) : [];
        }),
        getMetaItem: vi.fn(async ({ name }: any) => {
            const found = apps.find((a: any) => a.name === name);
            return found ? { type: 'app', name, item: JSON.parse(JSON.stringify(found)) } : undefined;
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    // The RBAC filter only runs for a resolved caller; stubbing the context is
    // the established pattern in this package for exercising it by route.
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: perms });
    // [#8013] ADR-0057 D10's gate FAILS OPEN when it cannot be probed, and the
    // stubbed context carries no `__kernel`, so without a provider a
    // `requiresService` app is simply served and the `service` branch never
    // runs. Assigned rather than threaded through the constructor's 16th
    // positional parameter.
    if (serviceExists) rest.serviceExistsProvider = serviceExists;
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

// ── #8013 ───────────────────────────────────────────────────────────────────
//
// `GET /meta/app/<name>` answered ONE shape for three different refusals, so an
// app the session may never open and an app that does not exist were byte-
// identical on the wire. The console has nothing to branch on, so it renders its
// only copy for an absent app — "it may still be publishing" — over a permanent
// authorization denial. Measured cost (objectui#4252): two acceptance-test
// batches spent chasing a "platform defect" that was a missing permission-set
// binding.
//
// The maintainer ruling (2026-08-12) converts exactly ONE of the three: an app
// that EXISTS and whose `requiredPermissions` the session lacks now answers
// `403 PERMISSION_DENIED`. The other two keep answering absence, and the cases
// below pin that partition rather than assuming it, because it is the security
// boundary of the change:
//
//   - a DENIAL makes an app's existence observable to a caller who may not use
//     it. The ruling accepts that for a by-name probe, which already implies the
//     name.
//   - extending it to a name that resolves to NOTHING would make every app name
//     on the platform enumerable. That is a different, unruled change, and the
//     nonexistent-name cases are what stand between the two.
//
// So every case here asserts `status` AND `code` (ADR-0112), never "an error
// came back" — the two answers under test are both errors, one apart.

/** The declared refusal envelope, as the console will read it. */
const refusal = (body: any) => ({ code: body?.error?.code, message: body?.error?.message });

describe('#8013 — by-name: a permission denial is REPORTED, absence still is not', () => {
    it('criterion 1: a session WITHOUT the capability gets a named 403, not an absence', async () => {
        const { rest } = setup(['manage_users'], GATED_APPS);
        const denied = await getItem(rest, 'finance');

        // The whole point of the card: `status` AND `code`, so objectui#4252 can
        // branch. `PERMISSION_DENIED` is the ADR-0112 STANDARD catalog member for
        // a generic authorization refusal (and what `standardErrorCodeForHttpStatus`
        // answers for 403) rather than a bespoke synonym.
        expect(denied.statusCode).toBe(403);
        expect(refusal(denied.body).code).toBe('PERMISSION_DENIED');
        // The DECLARED envelope (`BaseResponseSchema`) — `code` and `message`
        // nested INSIDE `error`, with the `success: false` flag. The console
        // therefore reads `body.error.code` here and on the 404 below: one
        // accessor for both answers, not a second dialect to special-case.
        expect(denied.body?.success).toBe(false);
        expect(typeof refusal(denied.body).message).toBe('string');
        expect(refusal(denied.body).message).toContain('finance');

        // Refused means refused: the document did not ride along with the
        // refusal, and neither did the objects it would have exposed.
        expect(denied.body?.item).toBeUndefined();
        expect(denied.body?.data).toBeUndefined();
        expect(JSON.stringify(denied.body ?? {})).not.toContain('invoice');
    });

    it('criterion 2: a session WITH the capability gets the app, unchanged', async () => {
        const { rest } = setup(['finance.access'], GATED_APPS);
        const allowed = await getItem(rest, 'finance');

        expect(allowed.statusCode).toBe(200);
        expect(allowed.body).toMatchObject({ type: 'app', name: 'finance' });
        expect(allowed.body?.item?.name).toBe('finance');
        // Including the navigation the denial withheld — the grant path is the
        // half a refusal change most easily breaks.
        expect(allowed.body?.item?.navigation?.map((n: any) => n.id)).toEqual(['nav_invoices']);
        expect(allowed.body?.error).toBeUndefined();
        expect(allowed.body?.success).toBeUndefined();
    });

    it('criterion 3: a NONEXISTENT app name keeps answering absence — never the denial', async () => {
        // THE security criterion. If this ever reports `PERMISSION_DENIED`, the
        // change has stopped being "an app you may not open says so" and become
        // "every app name on the platform is enumerable" — including by a caller
        // holding nothing. Asserted on the envelope, not on "still an error":
        // both answers are errors.
        for (const perms of [[], ['manage_users'], ['finance.access'], ['studio.access']]) {
            const missing = await getItem(setup(perms, GATED_APPS).rest, 'no_such_app');

            expect(missing.statusCode).not.toBe(403);
            expect(refusal(missing.body).code).not.toBe('PERMISSION_DENIED');
            expect(JSON.stringify(missing.body ?? {})).not.toContain('PERMISSION_DENIED');
        }
    });

    it('criterion 3: …and the real producer miss is still the 404 it has always been', async () => {
        // The fixture's `getMetaItem` answers `undefined` for an unknown name;
        // `metadata-protocol` REJECTS with a declared `RESOURCE_NOT_FOUND` /
        // `status: 404` (pinned in `rest-meta-outage-vs-miss.test.ts`). Both
        // reach this route, so the criterion is stated against the production
        // shape too rather than against the stub's alone.
        const { rest, protocol } = setup([], GATED_APPS);
        protocol.getMetaItem = vi.fn().mockRejectedValue(Object.assign(
            new Error('Metadata item app/no_such_app not found'),
            { code: 'RESOURCE_NOT_FOUND', status: 404 },
        ));

        const missing = await getItem(rest, 'no_such_app');

        expect(missing.statusCode).toBe(404);
        expect(missing.body?.code).toBe('RESOURCE_NOT_FOUND');
        expect(missing.statusCode).not.toBe(403);
        expect(JSON.stringify(missing.body ?? {})).not.toContain('PERMISSION_DENIED');
    });

    it('criterion 4: the LIST route is untouched — the app is absent, not flagged', async () => {
        const { rest } = setup(['manage_users'], GATED_APPS);
        const res = await getList(rest);

        // Read the list body and assert the ABSENCE, not "the endpoint still
        // 200s" — a leak would be a 200 too. The ruling keeps this route
        // filtered exactly as-is so the enumeration surface is not widened past
        // what a direct by-name probe already implies.
        expect(res.statusCode).toBe(200);
        expect(namesFrom(res.body)).not.toContain('finance');
        expect(namesFrom(res.body).sort()).toEqual(['account', 'crm', 'telephony']);

        // No `authorized: false` (or any sibling spelling) leaked into the list,
        // and no trace of what the withheld app would have exposed.
        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('authorized');
        expect(wire).not.toContain('PERMISSION_DENIED');
        expect(wire).not.toContain('invoice');
        expect(wire).not.toContain('finance');

        // …and the holder still gets it, so the list is filtered rather than
        // broken.
        expect(namesFrom((await getList(setup(['finance.access'], GATED_APPS).rest)).body))
            .toContain('finance');
    });

    it('the partition: an UNPUBLISHED app stays a 404 even when permissions are the reason too', async () => {
        // ADR-0045 §3 says an unpublished app is *externally unobservable*, and a
        // 403 confirms existence. The publish gate is judged FIRST, so an app
        // that is both unpublished and permission-gated reports absence — the
        // stricter contract wins over the new disclosure.
        const bothGated = [{ ...UNPUBLISHED_APP, requiredPermissions: ['finance.access'] }];
        const denied = await getItem(setup(['manage_users'], bothGated).rest, 'production_management');

        expect(denied.statusCode).toBe(404);
        expect(refusal(denied.body).code).toBe('RESOURCE_NOT_FOUND');
        expect(refusal(denied.body).code).not.toBe('PERMISSION_DENIED');
        expect(JSON.stringify(denied.body ?? {})).not.toContain('secret_production_line');
    });

    it('the partition: an app gated by an ABSENT SERVICE stays a 404 — nothing was denied to the caller', async () => {
        // ADR-0057 D10 capability absence is a deployment fact about the
        // platform, not a statement about this session: no permission of the
        // caller's is missing, so there is no denial to report. It keeps
        // answering absence.
        const { rest } = setup(['manage_users'], GATED_APPS, () => false);
        const denied = await getItem(rest, 'telephony');

        expect(denied.statusCode).toBe(404);
        expect(refusal(denied.body).code).toBe('RESOURCE_NOT_FOUND');
        expect(refusal(denied.body).code).not.toBe('PERMISSION_DENIED');

        // …and it is served once the service is present, so the case above is
        // the gate firing rather than the fixture being broken.
        const ok = await getItem(setup(['manage_users'], GATED_APPS, (n: string) => n === 'voice').rest, 'telephony');
        expect(ok.statusCode).toBe(200);
        expect(ok.body?.item?.name).toBe('telephony');
    });
});
