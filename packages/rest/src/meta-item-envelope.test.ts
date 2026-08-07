// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /meta/:type/:name` answers ONE body shape — the spec-declared
 * `GetMetaItemResponseSchema` envelope `{ type, name, item, … }` — on every
 * path that serves it (#5563).
 *
 * Before this pin the same request answered two different structures depending
 * on server configuration: the CACHED branch (the default, `enableCache`
 * defaults to `true`) handed back `getMetaItemCached`'s `result.data`, which is
 * the metadata document with the envelope already stripped, while the
 * non-cached branch handed back `getMetaItem`'s envelope. `packages/spec`
 * declares exactly one `responseSchema` for the route
 * (`plugin-rest-api.zod.ts`, `GetMetaItemResponseSchema`), so the declared
 * shape was the one a default deployment could not obtain — a
 * declared-but-not-enforced contract with no gate over it, and the reason
 * `client.meta.getItem` had no honest return annotation (#5545).
 *
 * The three branches pinned here are the three ways the route reaches a body:
 *   1. cached  — `getMetaItemCached` present and eligible (THE DEFAULT);
 *   2. non-cached — cache disabled / absent, straight `getMetaItem`;
 *   3. cache-bypassing — `app` (per-user RBAC filter) and `?state=draft`,
 *      which structurally skip the cache and previously went through the
 *      envelope-sniffing filter path.
 *
 * Each assertion reads the envelope's OWN keys (`type` / `name`) *and* the
 * document under `.item`, so a regression that hands back the bare document
 * fails on `item` rather than passing vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

const CUSTOMER = { name: 'customer', label: 'Customer', fields: { id: { type: 'text' } } };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

/** Base protocol double. `getMetaItem` speaks the producer's real envelope. */
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
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
        ...overrides,
    };
}

function itemRoute(rest: RestServer) {
    return (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
}

async function dispatch(protocol: any, params: any, query: any = {}, config: any = ANON_API) {
    const rest = new RestServer(mockServer() as any, protocol as any, config as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    const res = mockRes();
    await itemRoute(rest)!.handler({ params, query, headers: {} }, res);
    return { res, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('#5563 GET /meta/:type/:name — one body shape on every branch', () => {
    it('cached branch (THE DEFAULT) answers the { type, name, item } envelope', async () => {
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn().mockResolvedValue({
                // What `metadata-protocol.getMetaItemCached` really returns:
                // `data` is the ALREADY-UNWRAPPED document (it does
                // `const item = result?.item` internally). The REST layer owns
                // re-wrapping it into the declared envelope.
                data: CUSTOMER,
                etag: { value: 'abc', weak: false },
                cacheControl: { directives: ['private', 'no-cache'] },
                notModified: false,
            }),
        });

        const { body } = await dispatch(protocol, { type: 'object', name: 'customer' });

        expect(protocol.getMetaItemCached).toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'object', name: 'customer' });
        // The document is UNDER `item` — not spread at the top level.
        expect(body.item).toMatchObject({ name: 'customer', label: 'Customer' });
        expect(body.item.fields).toEqual({ id: { type: 'text' } });
        expect(body.label).toBeUndefined();
        expect(body.fields).toBeUndefined();
    });

    it('cached branch canonicalizes the plural URL spelling into the envelope `type`', async () => {
        // `/meta/objects/customer` and `/meta/object/customer` must not answer
        // two different `type` values — `metadata-protocol` folds the plural to
        // the singular canonical key (#4432) on the non-cached branch, so the
        // re-wrap has to fold it too or the envelope disagrees with itself
        // across a configuration switch.
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn().mockResolvedValue({
                data: CUSTOMER, etag: { value: 'abc', weak: false }, notModified: false,
            }),
        });

        const { body } = await dispatch(protocol, { type: 'objects', name: 'customer' });

        expect(body.type).toBe('object');
        expect(body.name).toBe('customer');
        expect(body.item).toMatchObject({ label: 'Customer' });
    });

    it('non-cached branch answers the same envelope, carrying the producer`s lock keys', async () => {
        // No `getMetaItemCached` on the protocol → the straight `getMetaItem`
        // read. ADR-0008 OCC (`If-Match`) rides on `lock`, so the envelope's
        // extra keys must survive, not be flattened to the three declared ones.
        const protocol = baseProtocol();

        const { body } = await dispatch(protocol, { type: 'object', name: 'customer' });

        expect(protocol.getMetaItem).toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'object', name: 'customer', lock: 'none', editable: true });
        expect(body.item).toMatchObject({ name: 'customer', label: 'Customer' });
    });

    it('non-cached branch answers the envelope when the cache is explicitly disabled', async () => {
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn(),
        });

        const { body } = await dispatch(
            protocol,
            { type: 'object', name: 'customer' },
            {},
            { api: { requireAuth: false }, metadata: { enableCache: false } },
        );

        expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'object', name: 'customer' });
        expect(body.item).toMatchObject({ label: 'Customer' });
    });

    it('`app` reads bypass the cache and STILL answer the envelope after RBAC filtering', async () => {
        // The per-user nav filter rewrites the document; the envelope must be
        // rebuilt around the filtered document, not replaced by it.
        const APP = {
            name: 'crm', label: 'CRM',
            navigation: [
                { name: 'open', label: 'Open' },
                { name: 'secret', label: 'Secret', requiredPermissions: ['admin.only'] },
            ],
        };
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn(),
            getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: APP, lock: 'none' })),
        });

        const { body } = await dispatch(protocol, { type: 'app', name: 'crm' });

        expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'app', name: 'crm', lock: 'none' });
        expect(body.item.label).toBe('CRM');
        // The gate really ran on the inner document.
        expect(body.item.navigation.map((n: any) => n.name)).toEqual(['open']);
    });

    it('`?state=draft` bypasses the cache and answers the envelope', async () => {
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn(),
            getMetaItem: vi.fn(async ({ type, name }: any) => ({
                type, name, item: { ...CUSTOMER, label: 'Customer (draft)' },
            })),
        });

        const { body } = await dispatch(
            protocol,
            { type: 'object', name: 'customer' },
            { state: 'draft' },
        );

        expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
        expect(body).toMatchObject({ type: 'object', name: 'customer' });
        expect(body.item.label).toBe('Customer (draft)');
    });
});
