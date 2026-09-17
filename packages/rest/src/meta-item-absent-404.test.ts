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

        // [#18402] BYTE-for-byte, on the SERIALIZED body — the wire is what
        // ADR-0045 §3 is about, and `toEqual` below is a statement about two
        // in-process objects. They can agree while the bytes do not: a member
        // holding `undefined` is equal to an absent one here and disappears at
        // `JSON.stringify` (§4 measures exactly that trap on the 200 this
        // route used to send), and key ORDER is invisible to `toEqual` while
        // being the first thing a response diff shows. Asserted first, so a
        // future change that keeps the objects equal and moves the bytes fails
        // on the line that names the property rather than on a weaker one.
        expect(JSON.stringify(unpublished.body)).toBe(JSON.stringify(absent.body));

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

        // [#18402] THE LINE #18066 SAID A CONVERGENCE WOULD HAVE TO EDIT, and
        // this is that edit. It used to read `viaCache.body?.code` against
        // `viaUncached.body?.error?.code` — one status, one code, TWO
        // envelopes, chosen by `metadata.enableCache`. Both arms now answer
        // ADR-0112's nested `{ error: { code, message } }` through the single
        // emitter, which is the accessor objectui#4252 reads and the shape the
        // sibling refusals on this handler already emitted.
        //
        // ⚠️ The direction matters and is NOT symmetric: the flat arm was
        // pulled back to the nested one. Matching the FLAT shape here is what
        // #18066 fenced off — it would have moved the emitter, and with it the
        // §2 byte-identity, which is a security property rather than a style
        // preference.
        expect(viaCache.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(viaUncached.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(viaCache.body?.code).toBeUndefined();
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

describe('[#18402] §5 — ONE absence body on this route, whichever arm produced it', () => {
    /**
     * Every way `GET /meta/:type/:name` can arrive at "you get nothing",
     * driven side by side. The card that filed this measured THREE refusal
     * dialects from this one handler and named the severe half: which dialect
     * a caller must parse *for absence* was decided by `metadata.enableCache`
     * — a server-side setting the caller cannot see (the #7035 class).
     *
     * @returns the serialized wire body, because that is the artefact ADR-0045
     *   §3 is a statement about. An in-process `toEqual` is satisfied by two
     *   objects that `JSON.stringify` differently (§4 measures that exact trap
     *   on the 200 this route used to send), so the arms are compared as bytes.
     */
    const wire = (res: any) => `${res.statusCode} ${JSON.stringify(res.body)}`;

    const UNPUBLISHED = { name: 'production_management', label: 'PM', _unpublished: true, navigation: [] };

    async function thrownMiss(err: unknown, opts: { perms?: string[]; config?: any; cached?: any } = {}) {
        const { rest, protocol } = setup({}, opts);
        protocol.getMetaItem = vi.fn().mockRejectedValue(err);
        return getItem(rest, 'view', 'no_such_view');
    }

    it('⭐ the three absence arms are byte-identical — the dialect fork closes', async () => {
        // ① the uncached arm's item-less RETURN (the #18066 condition).
        const returned = await getItem(
            setup({}, { config: { api: { requireAuth: false }, metadata: { enableCache: false } } }).rest,
            'view', 'no_such_view',
        );
        // ② the CACHED arm's throw — `getMetaItemCached` raises
        //    `metadataItemNotFoundError` on a falsy `item`. This arm is the
        //    DEFAULT (`enableCache` defaults to true).
        const cached = await getItem(
            setup({}, {
                cached: vi.fn().mockRejectedValue(Object.assign(
                    new Error('Metadata item view/no_such_view not found'),
                    { code: 'RESOURCE_NOT_FOUND', status: 404 },
                )),
            }).rest,
            'view', 'no_such_view',
        );
        // ③ a protocol whose UNCACHED `getMetaItem` throws the miss instead of
        //    resolving item-less. Not hypothetical: it is the shape
        //    `rest-meta-outage-vs-miss.test.ts` drives.
        const thrown = await thrownMiss(
            Object.assign(new Error('Metadata item view/no_such_view not found'), {
                code: 'RESOURCE_NOT_FOUND', status: 404,
            }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        const arms = { returned, cached, thrown };
        for (const [name, res] of Object.entries(arms)) {
            expect(`${name}: ${wire(res)}`).toBe(`${name}: ${wire(returned)}`);
        }
        expect(wire(returned)).toBe('404 {"error":{"code":"RESOURCE_NOT_FOUND","message":"Metadata item not found or access denied."}}');
    });

    it('the producer`s own prose stops reaching the wire — one fixed sentence, no type/name echo', async () => {
        // Not tidiness. The thrown arms shipped `Metadata item <type>/<name>
        // not found`; the emitter says one sentence that names nothing. An
        // unpublished app answers the emitter's sentence, so an absence that
        // echoed the producer told the two apart in prose even once the
        // envelope matched.
        const res = await thrownMiss(
            Object.assign(new Error('Metadata item view/secret_thing not found'), {
                code: 'RESOURCE_NOT_FOUND', status: 404,
            }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(JSON.stringify(res.body)).not.toContain('secret_thing');
        expect(res.body?.error?.message).toBe('Metadata item not found or access denied.');
        expect(res.body?.declaredCode).toBeUndefined();
        expect(res.body?.error?.declaredCode).toBeUndefined();
    });

    it('…and the UNPUBLISHED app matches the thrown arm byte for byte, across the cache fork', async () => {
        // §2 proved absent == unpublished while both took the returning arm.
        // This is the same property across the fork that used to decide the
        // dialect: the unpublished app (uncached by construction — `app`
        // bypasses the cache) against an absence rendered by the throwing one.
        const unpublished = await getItem(setup({ 'app/production_management': UNPUBLISHED }, { perms: ['manage_users'] }).rest, 'app', 'production_management');
        const thrown = await thrownMiss(
            Object.assign(new Error('Metadata item app/production_management not found'), {
                code: 'RESOURCE_NOT_FOUND', status: 404,
            }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(wire(thrown)).toBe(wire(unpublished));
    });

    it('⛔ NOT every 404 — a producer-NAMED 404 keeps its own refusal, envelope and all', async () => {
        // The narrowing that the first draft of this change did not have, and
        // the reason it is measured rather than reasoned. `404` on this route
        // is not a synonym for absence.
        //
        //  - `NO_DRAFT` is the Studio designer's `?state=draft` probe. It says
        //    the ITEM is there and its DRAFT is not. Folding it into
        //    `RESOURCE_NOT_FOUND` would tell a designer the object does not
        //    exist — #5532's flattening, reintroduced by the repair for a
        //    sibling of it. Its wire answer is pinned byte-for-byte in
        //    `rest-expected-error-logging.test.ts` and
        //    `rest-4xx-message-truncation.test.ts`; those pins must keep
        //    passing, and this states here WHY they are not collateral.
        //  - a code the ADR-0112 ledger does not know is DEMOTED to
        //    `declaredCode`, the open author-authored channel the ADR declares.
        //    Converting would delete the one field it exists to carry.
        const noDraft = await thrownMiss(
            Object.assign(new Error('[no_draft] No pending draft exists for view/no_such_view.'), {
                code: 'NO_DRAFT', status: 404,
            }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(noDraft.statusCode).toBe(404);
        expect(noDraft.body).toEqual({
            error: '[no_draft] No pending draft exists for view/no_such_view.',
            code: 'NO_DRAFT',
        });

        const bespoke = await thrownMiss(
            Object.assign(new Error('gone'), { code: 'MY_OWN_MISS', status: 404 }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(bespoke.statusCode).toBe(404);
        expect(bespoke.body?.declaredCode).toBe('MY_OWN_MISS');

        // ⚠️ MEASURED, and it corrected this file's first draft. A producer
        // that declares a 404 and NO code does not get `RESOURCE_NOT_FOUND`
        // derived into its body — `thrownCodeFields` answers `{}`, ADR-0112's
        // own rule that nothing is invented for the half the producer did not
        // name. So the door emits neither `code` nor `declaredCode` here, the
        // predicate reads false, and this arm keeps the answer it had. Folding
        // it in would mean INVENTING the vocabulary member the ADR declines to
        // invent, in order to make a table look tidier.
        const uncoded = await thrownMiss(
            Object.assign(new Error('nothing there'), { status: 404 }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(uncoded.statusCode).toBe(404);
        expect(uncoded.body).toEqual({ error: 'nothing there' });
        expect(uncoded.body?.code).toBeUndefined();
    });

    it('⛔ 503, 403 and 401 are untouched — the three other boundaries', async () => {
        // The three boundaries this must not flatten, each one a refusal that
        // means something else.
        //
        //  - 503: #5532's outage. "We could not look" is not "it is not there",
        //    and a converted 503 would tell a caller the item does not exist
        //    during a metadata-plane outage.
        //  - 403 PERMISSION_DENIED on an app that EXISTS: #8013's partition.
        //  - 401/403 on an audience-gated book: ADR-0046 §6.7. Still the FLAT
        //    dialect, deliberately — that position belongs to ratchet #9559,
        //    and converting it here would leave `/meta/book/:name/tree` and
        //    this route answering the same refusal two ways.
        const outage = await thrownMiss(
            Object.assign(new Error('The metadata store could not be read.'), {
                code: 'SERVICE_UNAVAILABLE', status: 503,
            }),
            { config: { api: { requireAuth: false }, metadata: { enableCache: false } } },
        );
        expect(outage.statusCode).toBe(503);
        expect(JSON.stringify(outage.body ?? {})).not.toContain('RESOURCE_NOT_FOUND');

        const FINANCE = { name: 'finance', label: 'Finance', requiredPermissions: ['finance.access'], navigation: [] };
        const denied = await getItem(setup({ 'app/finance': FINANCE }, { perms: ['manage_users'] }).rest, 'app', 'finance');
        expect(denied.statusCode).toBe(403);
        expect(denied.body?.error?.code).toBe('PERMISSION_DENIED');

        const GATED_BOOK = { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [] };
        const gated = await getItem(setup({ 'book/admin_guide': GATED_BOOK }).rest, 'book', 'admin_guide');
        expect(gated.statusCode).toBe(403);
        expect(gated.body?.code).toBe('PERMISSION_DENIED');
    });
});
