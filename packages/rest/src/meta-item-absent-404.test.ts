// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18066] `GET /meta/:type/:name` for a name with NOTHING behind it.
//
// Measured on a real server (`objectstack dev --seed-admin --fresh`,
// `examples/app-showcase`, API 17.4.0, four absent names, all identical):
//
//     GET /api/v1/meta/app/no_such_app_xyz
//     200 {"type":"app","name":"no_such_app_xyz","lock":"none",
//          "editable":true,"deletable":true,"resettable":false}
//
// — the declared envelope MINUS its `item` member, at 200. This file is the
// pin that the route now answers `404 RESOURCE_NOT_FOUND` instead, and that it
// answers it WITHOUT disturbing the #8013 partition beside it.
//
// ── Why this is execution and not a design question ─────────────────────────
//
// Three declarations in this repository already agreed with each other and
// against the live route; only the loudest of the three (the 200) was wrong.
//
//  1. `GetMetaItemResponseSchema` — the route's OWN `responseSchema`
//     (`rest-route-ledger.ts`) — declares `item` as a required member, while
//     every genuinely-optional key beside it is spelled `.optional()`. §4 below
//     asserts that against the spec schema itself rather than restating it.
//  2. The CACHED arm of this very route already answers absence with `404
//     RESOURCE_NOT_FOUND`: `getMetaItemCached` throws `metadataItemNotFoundError`
//     when `item` is falsy. §3 pins that the two arms now agree — which arm a
//     request took had been deciding whether absence was an error at all.
//  3. `runtime/src/domains/meta.ts` refuses to treat the same item-less answer
//     as a hit ("only treat the lookup as a hit when `item` is really there")
//     and 404s. Cited, not re-pinned: that door is another package's.
//
// ── The trap this file exists to hold ──────────────────────────────────────
//
// The 403 `PERMISSION_DENIED` #8013 introduced lives inside the same `if
// (isAppType && visible)` the 404 did, so the obvious repair — make the gate
// reachable for a missing document — turns every withheld app into a probe for
// which app names exist. §2 is the ordering pin: the absent name and the
// withheld-but-existing app must keep answering DIFFERENT things (404 vs 403),
// and the absent name and the unpublished app must keep answering the SAME
// thing, byte for byte.

import { describe, it, expect, vi } from 'vitest';
import { GetMetaItemResponseSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

/**
 * The document `metadata-protocol` resolves for a name that IS there, reduced
 * to the two keys every assertion below reads.
 */
const CRM_APP = { name: 'crm', label: 'CRM', navigation: [{ id: 'nav_leads', type: 'object', objectName: 'lead' }] };

/**
 * ⭐ THE FIXTURE THAT MATTERS: what `metadata-protocol`'s `getMetaItem` really
 * resolves for a miss, key for key.
 *
 * Its three lookups (overlay row → MetadataService → SchemaRegistry) all leave
 * `item` undefined, and the method then returns the protection envelope around
 * it regardless — `lock` / `editable` / `deletable` / `resettable` are computed
 * from `resolveLockState(undefined, false)` and are unconditional. So the
 * producer's return is `{ type, name, item: undefined, lock, … }`.
 *
 * ⚠️ That object PARSES against `GetMetaItemResponseSchema`. `item` is present
 * holding `undefined`, and `z.unknown()` admits an explicit `undefined`; it is
 * `JSON.stringify` at `res.json` that drops the member and produces the wire
 * body the schema rejects (§4 measures both halves). A double that answers
 * `undefined` for a miss — the shape this suite's siblings used — never
 * reproduces that, because it never had an envelope to lose a member from.
 */
function absentItemEnvelope(type: string, name: string) {
    return {
        type, name,
        item: undefined,
        lock: 'none', editable: true, deletable: true, resettable: false,
    };
}

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/**
 * @param corpus the items this protocol double knows, keyed `type/name`. Any
 *   other address answers {@link absentItemEnvelope} — the live producer's miss,
 *   not `undefined`.
 */
function setup(
    corpus: Record<string, unknown> = {},
    opts: { perms?: string[]; config?: any; cached?: any } = {},
) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const hit = corpus[`${type}/${name}`];
            return hit === undefined
                ? absentItemEnvelope(type, name)
                : { type, name, item: JSON.parse(JSON.stringify(hit)), lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        findData: vi.fn().mockResolvedValue([]),
        ...(opts.cached !== undefined ? { getMetaItemCached: opts.cached } : {}),
    };
    const rest = new RestServer(mockServer() as any, protocol as any, (opts.config ?? ANON_API) as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: opts.perms ?? [] });
    rest.registerRoutes();
    return { rest, protocol };
}

async function getItem(rest: any, type: string, name: string, query: Record<string, unknown> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('GET /api/v1/meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query, body: {}, headers: {} }, res);
    return res;
}

describe('[#18066] §1 — a name with nothing behind it is an ERROR, not an item-less 200', () => {
    it('`app`: 404 + RESOURCE_NOT_FOUND, and no envelope rides along with it', async () => {
        const res = await getItem(setup({ 'app/crm': CRM_APP }).rest, 'app', 'no_such_app_xyz');

        // ADR-0112 — `status` AND `code`, never "something falsy came back".
        expect(res.statusCode).toBe(404);
        expect(res.body?.error?.code).toBe('RESOURCE_NOT_FOUND');

        // The reported body, stated as the report stated it: the 200 carried
        // `type` / `name` / `lock` / the three affordance verdicts and no
        // `item`. A refusal carries none of them.
        expect(res.body?.type).toBeUndefined();
        expect(res.body?.name).toBeUndefined();
        expect(res.body?.lock).toBeUndefined();
        expect(res.body?.editable).toBeUndefined();
        expect(res.body?.item).toBeUndefined();
    });

    it('the name that IS there is untouched — the envelope, its document and its lock keys', async () => {
        // The half a refusal change most easily breaks. Asserted on the same
        // fixture as the case above, so the 404 is the miss firing rather than
        // the double being broken.
        const res = await getItem(setup({ 'app/crm': CRM_APP }).rest, 'app', 'crm');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ type: 'app', name: 'crm', lock: 'none', editable: true });
        expect(res.body?.item?.label).toBe('CRM');
        expect(res.body?.error).toBeUndefined();
    });

    it('it is NOT an `app` rule — every type the uncached arm serves answers the same', async () => {
        // The card measured `app` alone and left "do other types behave the
        // same way?" open. They did: the fall-through was in the shared tail of
        // the uncached arm, below the per-type gates, so every type diverted
        // around the cache reached it. `dashboard` is diverted structurally
        // (#5881); `object` gets there whenever a deployment sets
        // `enableCache: false`, and `?state=draft` / `?package=` divert any type
        // at all.
        const byType = setup({ 'app/crm': CRM_APP });
        for (const type of ['dashboard', 'view', 'object', 'flow', 'page']) {
            const res = await getItem(byType.rest, type, 'no_such_thing');
            expect(`${type}:${res.statusCode}`).toBe(`${type}:404`);
            expect(res.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        }

        // …and through the query flags that divert a type around the cache,
        // where a deployment running the default `enableCache: true` meets it.
        const withCache = setup({}, { cached: vi.fn() });
        for (const query of [{ state: 'draft' }, { preview: 'draft' }, { package: 'pkg_x' }]) {
            const res = await getItem(withCache.rest, 'object', 'no_such_object', query);
            expect(res.statusCode).toBe(404);
            expect(res.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        }
        expect(withCache.protocol.getMetaItemCached).not.toHaveBeenCalled();
    });

    it('a protocol that resolves NOTHING at all is the same absence, not a crash', async () => {
        // Not every implementation of the verb is `metadata-protocol`: a plugin
        // protocol may answer a bare `undefined` for a miss rather than the
        // envelope above. Both are "no document", and the door must not tell
        // them apart — `envelope?.item` is `undefined` either way.
        const { rest, protocol } = setup();
        protocol.getMetaItem = vi.fn().mockResolvedValue(undefined);

        const res = await getItem(rest, 'app', 'no_such_app_xyz');

        expect(res.statusCode).toBe(404);
        expect(res.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
    });
});

describe('[#18066] §2 — the #8013 partition survives, in both directions', () => {
    /**
     * An app that EXISTS and is withheld for a reason that is NOT the caller's
     * permissions: ADR-0045 §3 says it is externally unobservable.
     */
    const UNPUBLISHED_APP = {
        name: 'production_management', label: '生产管理', _unpublished: true,
        navigation: [{ id: 'nav_secret_lines', type: 'object', objectName: 'secret_production_line' }],
    };
    /** An app that EXISTS and is withheld for exactly the caller's permissions. */
    const FINANCE_APP = {
        name: 'finance', label: 'Finance', requiredPermissions: ['finance.access'],
        navigation: [{ id: 'nav_invoices', type: 'object', objectName: 'invoice' }],
    };
    const GATED = { 'app/production_management': UNPUBLISHED_APP, 'app/finance': FINANCE_APP };

    it('THE security criterion: an absent name never becomes the 403', async () => {
        // If this ever reports `PERMISSION_DENIED`, the change has stopped
        // being "an app you may not open says so" and become "every app name on
        // the platform is enumerable" — by a caller holding nothing. Asserted
        // across the permission sets #8013 enumerates, because the 403's own
        // gate is permission-shaped.
        for (const perms of [[], ['manage_users'], ['finance.access'], ['studio.access']]) {
            const res = await getItem(setup(GATED, { perms }).rest, 'app', 'no_such_app_xyz');

            expect(res.statusCode).not.toBe(403);
            expect(res.body?.error?.code).not.toBe('PERMISSION_DENIED');
            expect(JSON.stringify(res.body ?? {})).not.toContain('PERMISSION_DENIED');
        }
    });

    it('the withheld-but-EXISTING app still answers 403 PERMISSION_DENIED, unchanged', async () => {
        // The other direction, and the one a careless repair breaks: making the
        // gate reachable for a missing document would have converted this arm
        // into an absence and deleted #8013's whole answer.
        const res = await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'finance');

        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(res.body?.success).toBe(false);
        expect(res.body?.error?.message).toContain('finance');
        expect(res.body?.item).toBeUndefined();
        expect(JSON.stringify(res.body ?? {})).not.toContain('invoice');

        // …and the holder still gets it, so the 403 is the gate firing.
        const held = await getItem(setup(GATED, { perms: ['finance.access'] }).rest, 'app', 'finance');
        expect(held.statusCode).toBe(200);
        expect(held.body?.item?.name).toBe('finance');
    });

    it('the same invariant on a NON-`app` type: a gated `book` that exists still answers 403', async () => {
        // The ordering pin generalised, because the fix is not app-scoped and
        // neither is the trap. ADR-0046 §6.7's audience gate is the other arm on
        // this handler that converts a withheld-but-EXISTING document into a
        // refusal — 401 anonymous, 403 for an authenticated non-holder — and it
        // is guarded by `&& visible` exactly as the app gate is. A check placed
        // after it, or one that fired on a document that exists, would turn a
        // gated book into an absence and lose the distinction; a caller could
        // then no longer tell "sign in / ask for the permission set" from "this
        // book does not exist".
        const GATED_BOOK = { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [] };
        const { rest } = setup({ 'book/admin_guide': GATED_BOOK });

        const withheld = await getItem(rest, 'book', 'admin_guide');
        expect(withheld.statusCode).toBe(403);
        // ⚠️ MEASURED, not assumed: this arm emits through `sendDeclaredFault`
        // -> `sendThrownError`, whose body is the FLAT `{ error: '<message>',
        // code }`, while the app gate's 403 one screen up emits
        // `sendEnvelopeError`'s nested `{ success: false, error: { code,
        // message } }`. So ONE handler answers `PERMISSION_DENIED` in two
        // dialects depending on which gate fired, and `body.error.code` — the
        // accessor #8013 settled on — reads `undefined` here. Asserted in the
        // shape the route really sends rather than the shape it ought to; the
        // divergence is reported as a finding, deliberately not converged in
        // this change (see §3 for the same split on the 404).
        expect(withheld.body?.code).toBe('PERMISSION_DENIED');
        expect(withheld.body?.item).toBeUndefined();

        // …and the name with nothing behind it, on the same type and the same
        // caller, is the absence instead.
        const absent = await getItem(rest, 'book', 'no_such_book');
        expect(absent.statusCode).toBe(404);
        expect(absent.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('⭐ absent and UNPUBLISHED are byte-identical — the enumeration hole this closes', async () => {
        // The half the card did not name and the reason the fix is not merely a
        // status-code correction. ADR-0045 §3 makes an unpublished app
        // *externally unobservable*, and #8013 states the contract as absence
        // and nonexistence being indistinguishable. They were not: the
        // unpublished app answered this 404 while a nonexistent name answered
        // 200, so the pair of responses enumerated exactly which app names
        // exist-but-are-unpublished. One emitter, one body.
        const unpublished = await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'production_management');
        const absent = await getItem(setup(GATED, { perms: ['manage_users'] }).rest, 'app', 'no_such_app_xyz');

        expect(unpublished.statusCode).toBe(absent.statusCode);
        expect(unpublished.body).toEqual(absent.body);
        expect(unpublished.statusCode).toBe(404);
        expect(unpublished.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(JSON.stringify(unpublished.body ?? {})).not.toContain('secret_production_line');

        // …and a builder, who MAY observe it, still gets the document — so the
        // equality above is the gate withholding rather than the app missing.
        const builder = await getItem(setup(GATED, { perms: ['studio.access'] }).rest, 'app', 'production_management');
        expect(builder.statusCode).toBe(200);
        expect(builder.body?.item?.name).toBe('production_management');
    });
});

describe('[#18066] §3 — the two arms of this route now answer absence alike', () => {
    it('the CACHED arm already 404s, and the uncached arm now matches its status and code', async () => {
        // The card left "does the cached arm agree?" unmeasured. It does not
        // reach `res.json` at all: `getMetaItemCached` throws
        // `metadataItemNotFoundError` on a falsy `item`, which the route's catch
        // reports through `handleRouteError`. So the SAME request answered 404
        // or 200 depending on a server-side cache setting the caller cannot see.
        const cachedMiss = Object.assign(new Error('Metadata item view/no_such_view not found'), {
            code: 'RESOURCE_NOT_FOUND', status: 404,
        });
        const cached = setup({}, { cached: vi.fn().mockRejectedValue(cachedMiss) });
        const viaCache = await getItem(cached.rest, 'view', 'no_such_view');
        expect(cached.protocol.getMetaItemCached).toHaveBeenCalled();
        expect(viaCache.statusCode).toBe(404);

        const viaUncached = await getItem(
            setup({}, { config: { api: { requireAuth: false }, metadata: { enableCache: false } } }).rest,
            'view', 'no_such_view',
        );
        expect(viaUncached.statusCode).toBe(viaCache.statusCode);

        // ⚠️ Status and CODE agree; the envelope DIALECT still differs and that
        // is deliberately not touched here. The thrown arm is rendered by
        // `resolveErrorResponse`'s declared-status passthrough, whose body is
        // the flat `{ error: '<message>', code }` pinned in
        // `rest-meta-outage-vs-miss.test.ts`; the in-route arm emits ADR-0112's
        // nested `{ error: { code, message } }`, which is what its own sibling
        // refusals on this handler emit and what objectui#4252 reads. Matching
        // the flat one HERE would have broken the §2 byte-identity, which is a
        // security property; converging the two dialects is a separate change
        // on the thrown side. Asserted rather than left implicit, so a future
        // convergence is a deliberate edit to this line.
        expect(viaCache.body?.code).toBe('RESOURCE_NOT_FOUND');
        expect(viaUncached.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('an unreadable metadata STORE is still a 503, never this 404', async () => {
        // The distinction #5532 bought and this condition must not flatten.
        // "The item is not there" and "we could not look" are different claims,
        // and the producer throws rather than resolving item-less for the
        // second — so it never reaches the new check at all.
        const { rest, protocol } = setup();
        protocol.getMetaItem = vi.fn().mockRejectedValue(Object.assign(
            new Error('The metadata store could not be read, so whether this item exists is unknown.'),
            { code: 'SERVICE_UNAVAILABLE', status: 503 },
        ));

        const res = await getItem(rest, 'object', 'acct');

        expect(res.statusCode).toBe(503);
        expect(res.statusCode).not.toBe(404);
        expect(JSON.stringify(res.body ?? {})).not.toContain('RESOURCE_NOT_FOUND');
    });
});

describe('[#18066] §4 — against `packages/spec`, not against a restatement of it', () => {
    it('the 200 this route used to send fails the route`s own declared responseSchema', async () => {
        // `rest-route-ledger.ts` declares `GetMetaItemResponseSchema` as this
        // route's `responseSchema`. The body is the one the real server sent,
        // transcribed from the report.
        const asSent = {
            type: 'app', name: 'no_such_app_xyz',
            lock: 'none', editable: true, deletable: true, resettable: false,
        };
        const verdict = GetMetaItemResponseSchema.safeParse(asSent);

        expect(verdict.success).toBe(false);
        expect(verdict.error?.issues?.map((i: any) => i.path.join('.'))).toContain('item');
    });

    it('⚠️ the PRODUCER`s in-process return passes the same parse — the break is at JSON', () => {
        // Why nobody caught this with a unit test on `getMetaItem`. `item` is
        // PRESENT holding `undefined` and `z.unknown()` admits that, so the
        // object conforms; `JSON.stringify` then drops the member on the way
        // out. A conformance probe written against the returned object rather
        // than the wire bytes reports agreement — which is the trap, not a
        // detail.
        const returned = absentItemEnvelope('app', 'no_such_app_xyz');

        expect(GetMetaItemResponseSchema.safeParse(returned).success).toBe(true);
        expect(JSON.parse(JSON.stringify(returned))).not.toHaveProperty('item');
        expect(GetMetaItemResponseSchema.safeParse(JSON.parse(JSON.stringify(returned))).success).toBe(false);
    });

    it('every 200 the route still serves conforms to that schema', async () => {
        // The positive half: the fix must not have bought conformance by
        // refusing things it should serve.
        const { rest } = setup({ 'app/crm': CRM_APP });

        for (const [type, name] of [['app', 'crm']] as const) {
            const res = await getItem(rest, type, name);
            expect(res.statusCode).toBe(200);
            expect(GetMetaItemResponseSchema.safeParse(res.body).success).toBe(true);
        }
    });
});
