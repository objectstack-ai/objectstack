// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /meta/:type/:name/layers` — the three-layer diagnostic projection as its
 * own resource, and the deprecation window on the `?layers=true` spelling it
 * replaces (#5882).
 *
 * ## What was wrong
 *
 * One route answered TWO unrelated resource representations, chosen by a query
 * flag: the ordinary read's `{ type, name, item, … }` envelope, and — under
 * `?layers=true` — a projection with the packaged baseline, the tenant overlay
 * and the merged result side by side. `packages/spec` declared exactly one
 * `responseSchema` for the route, so anything generating a client from the
 * route table produced a parser that was simply wrong for the flagged call.
 *
 * The maintainer ruled (2026-08-06) for one path per response shape rather than
 * teaching the route declaration to express "two shapes, chosen by a flag":
 * conditional response selection is a new primitive every future tool would
 * have to understand, and it is precisely where codegen and AI-written clients
 * go wrong.
 *
 * ## What these tests hold down
 *
 * 1. the new path answers the layered projection, with the three layers SEPARATE
 *    (collapsing them would delete the diagnostic, which is the whole reason the
 *    shape exists);
 * 2. the deprecated `?layers=` spelling still answers the IDENTICAL body during
 *    its window — a deprecation that silently changed the body would be a
 *    breakage wearing a deprecation label — and advertises its successor;
 * 3. the ordinary read is undisturbed by either.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { GetMetaItemLayeredResponseSchema, GetMetaItemResponseSchema } from '@objectstack/spec/api';

const ANON_API = { api: { requireAuth: false } };

const CUSTOMER = { name: 'customer', label: 'Customer', fields: { id: { type: 'text' } } };

/** The real `getMetaItemLayered` return shape, as `metadata-protocol` builds it. */
const LAYERED = {
    type: 'object',
    name: 'customer',
    code: { name: 'customer', label: 'Customer' },
    overlay: { label: 'Client' },
    overlayScope: 'org',
    effective: { name: 'customer', label: 'Client' },
    _diagnostics: { valid: true },
    lock: 'none',
    editable: true,
    deletable: true,
    resettable: false,
};

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const headers: Record<string, string> = {};
    return {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
        header: vi.fn((k: string, v: string) => { headers[k] = v; }),
        send: vi.fn(),
        headers,
    };
}

function baseProtocol(overrides: Record<string, any> = {}) {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type, name, item: CUSTOMER, lock: 'none', editable: true, deletable: true, resettable: false,
        })),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => ({ ...LAYERED, type, name })),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
        ...overrides,
    };
}

function routeFor(rest: RestServer, path: string) {
    return (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
}

async function dispatch(protocol: any, path: string, params: any, query: any = {}) {
    const rest = new RestServer(mockServer() as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    const route = routeFor(rest, path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    const res = mockRes();
    await route.handler({ params, query, headers: {} }, res);
    return { res, body: res.json.mock.calls.at(-1)?.[0] };
}

const LAYERS_PATH = '/api/v1/meta/:type/:name/layers';
const ITEM_PATH = '/api/v1/meta/:type/:name';

describe('#5882 GET /meta/:type/:name/layers — the declared layered resource', () => {
    it('is registered as its own route', async () => {
        const rest = new RestServer(mockServer() as any, baseProtocol() as any, ANON_API as any);
        rest.registerRoutes();
        expect(routeFor(rest, LAYERS_PATH)).toBeDefined();
    });

    it('is registered BEFORE the routes that would otherwise capture its path', async () => {
        // `/:type/:name` cannot match a 3-segment path, but
        // `/:type/:section/:name` CAN — it would bind section=<name>,
        // name="layers" and answer an ordinary metadata read for an item called
        // "layers". Under a first-match router, registration order is the only
        // thing preventing that, so the order is the assertion.
        const rest = new RestServer(mockServer() as any, baseProtocol() as any, ANON_API as any);
        rest.registerRoutes();
        const paths = (rest as any).getRoutes()
            .filter((r: any) => r.method === 'GET')
            .map((r: any) => r.path);
        const layers = paths.indexOf(LAYERS_PATH);
        const compound = paths.indexOf('/api/v1/meta/:type/:section/:name');
        expect(layers).toBeGreaterThanOrEqual(0);
        expect(compound).toBeGreaterThanOrEqual(0);
        expect(layers).toBeLessThan(compound);
    });

    it('answers the three-layer projection, with the layers SEPARATE', async () => {
        const protocol = baseProtocol();
        const { body } = await dispatch(protocol, LAYERS_PATH, { type: 'object', name: 'customer' });

        expect(protocol.getMetaItemLayered).toHaveBeenCalled();
        // The diagnostic's substance: `code` is the packaged baseline, `overlay`
        // the customization row ALONE, `effective` the merge — three distinct
        // values, not one merged document.
        expect(body.code).toEqual({ name: 'customer', label: 'Customer' });
        expect(body.overlay).toEqual({ label: 'Client' });
        expect(body.effective).toEqual({ name: 'customer', label: 'Client' });
        expect(body.overlayScope).toBe('org');
        expect(body.code).not.toEqual(body.effective);
        // And it is NOT the ordinary envelope.
        expect(body.item).toBeUndefined();
    });

    it('answers a body that parses against its DECLARED schema', async () => {
        // The point of the member: the shape on the wire and the shape
        // `packages/spec` declares for this path are now the same object.
        const { body } = await dispatch(baseProtocol(), LAYERS_PATH, { type: 'object', name: 'customer' });
        const parsed = GetMetaItemLayeredResponseSchema.safeParse(body);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('threads `?package=` through for the package-scoped editor view (ADR-0048)', async () => {
        const protocol = baseProtocol();
        await dispatch(protocol, LAYERS_PATH, { type: 'object', name: 'customer' }, { package: 'com.acme.crm' });
        expect(protocol.getMetaItemLayered).toHaveBeenCalledWith(
            expect.objectContaining({ packageId: 'com.acme.crm' }),
        );
    });

    it('answers 501 when the protocol implements no layered view', async () => {
        // A dedicated path must not fall through to the plain read the way the
        // `?layers=` flag did — that would answer a different resource under a
        // shape this path never declares.
        const protocol = baseProtocol({ getMetaItemLayered: undefined });
        const { res, body } = await dispatch(protocol, LAYERS_PATH, { type: 'object', name: 'customer' });
        expect(res.status).toHaveBeenCalledWith(501);
        expect(body.code).toBe('NOT_IMPLEMENTED');
    });
});

describe('#5882 `?layers=true` — the deprecation window', () => {
    it('still answers the layered body, byte for byte the same as the new path', async () => {
        // The window's whole promise. Both entry points run ONE helper, and this
        // is what would fail if someone re-forked them.
        const viaFlag = await dispatch(
            baseProtocol(), ITEM_PATH, { type: 'object', name: 'customer' }, { layers: 'true' },
        );
        const viaPath = await dispatch(
            baseProtocol(), LAYERS_PATH, { type: 'object', name: 'customer' },
        );
        expect(viaFlag.body).toEqual(viaPath.body);
    });

    it('advertises the successor path in machine-readable headers', async () => {
        const { res } = await dispatch(
            baseProtocol(), ITEM_PATH, { type: 'object', name: 'customer' }, { layers: 'true' },
        );
        expect(res.header).toHaveBeenCalledWith('Deprecation', 'true');
        expect(res.headers.Link).toBe(
            '</api/v1/meta/object/customer/layers>; rel="successor-version"',
        );
    });

    it('does not mark the ordinary read deprecated', async () => {
        const { res } = await dispatch(baseProtocol(), ITEM_PATH, { type: 'object', name: 'customer' });
        expect(res.header).not.toHaveBeenCalledWith('Deprecation', 'true');
    });
});

describe('#5882 the ordinary read is undisturbed', () => {
    it('answers the `{ type, name, item }` envelope with its protection keys', async () => {
        const protocol = baseProtocol();
        const { body } = await dispatch(protocol, ITEM_PATH, { type: 'object', name: 'customer' });

        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'object', name: 'customer', lock: 'none', editable: true });
        expect(body.item).toMatchObject({ name: 'customer', label: 'Customer' });
        // No layer leaked into the ordinary envelope.
        expect(body.code).toBeUndefined();
        expect(body.overlay).toBeUndefined();
        expect(body.effective).toBeUndefined();
    });

    it('answers a body that parses against `GetMetaItemResponseSchema` on BOTH branches (#5950)', async () => {
        // The end-to-end half of #5950, and what entitles this route's ledger
        // row to name a `responseSchema`: the declaration is measured against
        // the real mount, on both branches that reach a body, rather than
        // against a schema-level fixture that no handler produced.

        // Uncached: carries the full ADR-0010 protection envelope.
        const uncached = await dispatch(baseProtocol(), ITEM_PATH, { type: 'object', name: 'customer' });
        const uncachedParse = GetMetaItemResponseSchema.safeParse(uncached.body);
        expect(uncachedParse.error?.issues ?? []).toEqual([]);
        // The carriers survive the parse — the point of the member. Before the
        // declaration widened, `.parse()` dropped every one of them.
        expect((uncachedParse.data as any).lock).toBe('none');
        expect((uncachedParse.data as any).editable).toBe(true);

        // Cached (THE DEFAULT): three keys, no lock resolved — still valid,
        // which is why the envelope is declared optional rather than required.
        const cachedProtocol = baseProtocol({
            getMetaItemCached: vi.fn().mockResolvedValue({
                data: CUSTOMER, etag: { value: 'abc', weak: false }, notModified: false,
            }),
        });
        const cached = await dispatch(cachedProtocol, ITEM_PATH, { type: 'object', name: 'customer' });
        expect(cachedProtocol.getMetaItemCached).toHaveBeenCalled();
        const cachedParse = GetMetaItemResponseSchema.safeParse(cached.body);
        expect(cachedParse.error?.issues ?? []).toEqual([]);
        expect((cachedParse.data as any).lock).toBeUndefined();
    });

    it('treats `?layers=` with an empty value as NOT a layered request', async () => {
        // Pre-existing semantics, pinned so the new route does not quietly
        // change which requests are layered.
        const protocol = baseProtocol();
        const { body } = await dispatch(protocol, ITEM_PATH, { type: 'object', name: 'customer' }, { layers: '' });
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(body.item).toMatchObject({ label: 'Customer' });
    });
});
