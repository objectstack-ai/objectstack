// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10235] `GET /meta/:type/:name` serves the per-column sortability
 * projection beside the object document — on EVERY branch (2026-08-23 ruling,
 * option A: the platform serves the signal; the grid never re-derives
 * "virtual ⇒ unsortable" from field type).
 *
 * Why the branch coverage is the load-bearing part: the ADR-0010 protection
 * keys are famously absent on the cached branch (THE DEFAULT — `enableCache`
 * defaults to `true`), because they come from the lock resolver the cached
 * path never consults. A sortability signal with that presence profile would
 * be a half-signal: the default deployment's grid would never see it. The
 * projection is therefore computed in `translateMetaEnvelope` — the one seam
 * every single-item exit passes through (#5563) — from the served document
 * itself, and this file pins it on both branches.
 *
 * AGREEMENT over hardcoding (the `meta-object-search-companion-agreement`
 * posture): each host also asserts the served projection deep-equals
 * `resolveObjectSortability(<served item>)` — the spec resolver the runtime
 * doors' predicate feeds — so the pin follows the predicate rather than a
 * copied verdict table.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

/**
 * The #10235 oracle shape: a grid-displayed formula column beside ordinary
 * persisted ones — `crm_opportunity.expected_revenue`'s structure, inlined.
 */
const OPPORTUNITY = {
    name: 'crm_opportunity',
    label: 'Opportunity',
    fields: {
        name: { type: 'text' },
        amount: { type: 'currency' },
        expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
    },
};

const LIST_VIEW = {
    name: 'opportunity_all',
    object: 'crm_opportunity',
    viewKind: 'list',
    columns: ['name', 'amount', 'expected_revenue'],
};

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

/** Protocol double speaking the producer's real envelope (see meta-item-envelope.test.ts). */
function baseProtocol(overrides: Record<string, any> = {}) {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            // The real producer folds the plural URL spelling to the canonical
            // singular (#4432) — mirror it, so the plural-spelling host below
            // exercises the server against the envelope the producer actually
            // speaks rather than against a double that skipped the fold.
            type: ({ objects: 'object', views: 'view' } as Record<string, string>)[type] ?? type,
            name,
            item: name === 'opportunity_all' ? LIST_VIEW : OPPORTUNITY,
            lock: 'none', editable: true, deletable: true, resettable: false,
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

describe('#10235 GET /meta/object/:name — the sortability projection rides the envelope', () => {
    it('non-cached branch: formula unsortable, persisted columns sortable, id appended', async () => {
        const { body } = await dispatch(baseProtocol(), { type: 'object', name: 'crm_opportunity' });

        expect(body.type).toBe('object');
        expect(body.sortability).toBeDefined();
        const fields = body.sortability.fields;
        // The refusal-backed cell (#6994/#7095: 400 INVALID_SORT).
        expect(fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
        // Anti-vacuity: the projection must not go green by refusing everything.
        expect(fields.name).toEqual({ sortable: true });
        expect(fields.amount).toEqual({ sortable: true });
        // The driver-provisioned primary key is addressable and sortable.
        expect(fields.id).toEqual({ sortable: true });
        // AGREEMENT: the wire projection IS the spec resolver's verdict over
        // the served document — no second verdict table anywhere.
        expect(body.sortability).toEqual(resolveObjectSortability(body.item));
    });

    it('cached branch (THE DEFAULT) serves the same projection — unlike the lock keys', async () => {
        const protocol = baseProtocol({
            getMetaItemCached: vi.fn().mockResolvedValue({
                // `metadata-protocol.getMetaItemCached` hands back the
                // already-unwrapped document; the REST layer rebuilds the envelope.
                data: OPPORTUNITY,
                etag: { value: 'abc', weak: false },
                cacheControl: { directives: ['private', 'no-cache'] },
                notModified: false,
            }),
        });

        const { body } = await dispatch(protocol, { type: 'object', name: 'crm_opportunity' });

        expect(protocol.getMetaItemCached).toHaveBeenCalled();
        // The cached branch deliberately serves no `lock` — establishing that
        // this test really is on the cached branch...
        expect(body.lock).toBeUndefined();
        // ...where the sortability projection must STILL be present: it is
        // computed from the served document, not from the lock resolver.
        expect(body.sortability).toEqual(resolveObjectSortability(OPPORTUNITY));
        expect(body.sortability.fields.expected_revenue).toEqual({
            sortable: false, reason: 'virtual-type',
        });
        expect(body.sortability.fields.amount).toEqual({ sortable: true });
    });

    it('plural URL spelling reaches the same projection (type folding, #4432)', async () => {
        const { body } = await dispatch(baseProtocol(), { type: 'objects', name: 'crm_opportunity' });
        expect(body.type).toBe('object');
        expect(body.sortability.fields.expected_revenue).toEqual({
            sortable: false, reason: 'virtual-type',
        });
    });

    it('a non-object read carries NO sortability key', async () => {
        // The projection is an OBJECT-schema fact; a view read must not grow a
        // vacuous `sortability: { fields: {} }` that consumers then read as
        // "this view's columns are all unknown".
        const { body } = await dispatch(baseProtocol(), { type: 'view', name: 'opportunity_all' });
        expect(body.item).toMatchObject({ name: 'opportunity_all' });
        expect(body.sortability).toBeUndefined();
    });
});
