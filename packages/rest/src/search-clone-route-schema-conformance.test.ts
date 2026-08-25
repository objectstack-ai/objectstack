// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11924] `GET /api/v1/search` and `POST /data/:object/:id/clone` answer
// bodies that conform to their newly declared `@objectstack/spec/api` schemas
// — the RELAY half of the conformance coverage that entitles these two
// route-ledger rows to name a `responseSchema` (#3877: ⛔ no row filled
// without conformance coverage).
//
// The split, same as the discovery gates: the PRODUCER half lives in
// `packages/metadata-protocol/src/search-clone-schema-conformance.test.ts`,
// which drives the REAL `searchAll` / `cloneData` over a fixture engine and
// parses what they emit. This half proves the mounted routes RELAY those
// returns bare — `res.json(result)` / `res.status(201).json(result)`, no
// `{ success, data }` envelope, no re-shaping — so the schema each row names
// describes the WHOLE wire body, and proves the rows point at the very schema
// objects this suite parses with.
//
// The protocol doubles below return bodies in the producers' measured shape
// (the fixture mirrors what the producer half proves the real methods emit);
// what is under test here is the relay and the ledger binding, never the
// producer.

import { describe, it, expect, vi } from 'vitest';
import * as specApi from '@objectstack/spec/api';
import { CloneDataResponseSchema, SearchAllResponseSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

const ANON_API = { api: { requireAuth: false } };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

/** The producers' measured return shapes — see the producer-half suite. */
const SEARCH_BODY = {
    query: 'acme',
    hits: [
        {
            object: 'lead',
            id: 'lead_1',
            title: 'Acme Industrial',
            snippet: '…acme is evaluating the pilot…',
            record: { id: 'lead_1', name: 'Acme Industrial' },
        },
        // `snippet` genuinely conditional: absent when no searchable column
        // literally contains a term (#7643).
        {
            object: 'lead',
            id: 'lead_2',
            title: 'Beta Corp',
            record: { id: 'lead_2', name: 'Beta Corp' },
        },
    ],
    totalObjects: 1,
    totalHits: 2,
    truncated: false,
};

const CLONE_BODY = {
    object: 'account',
    id: 'acc_2',
    sourceId: 'acc_1',
    record: { id: 'acc_2', name: 'Acme Copy' },
};

function makeProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
        searchAll: vi.fn().mockResolvedValue(SEARCH_BODY),
        cloneData: vi.fn().mockResolvedValue(CLONE_BODY),
    };
}

function routeFor(rest: RestServer, method: string, path: string) {
    return (rest as any).getRoutes().find((r: any) => r.method === method && r.path === path);
}

async function dispatch(method: string, path: string, req: Record<string, unknown>) {
    const protocol = makeProtocol();
    const rest = new RestServer(mockServer() as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    const route = routeFor(rest, method, path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    const res = mockRes();
    await route.handler({ headers: {}, params: {}, query: {}, ...req }, res);
    return { protocol, res, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('[#11924] GET /api/v1/search — declared body, relayed bare', () => {
    it('answers a body that parses against `SearchAllResponseSchema`, relayed from `searchAll`', async () => {
        const { protocol, body } = await dispatch('GET', '/api/v1/search', { query: { q: 'acme' } });

        expect(protocol.searchAll).toHaveBeenCalled();
        const parsed = SearchAllResponseSchema.safeParse(body);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
        // Relay, not re-shape: the wire body IS the producer's return.
        expect(body).toBe(SEARCH_BODY);
    });

    it('describes the WHOLE body — this mount answers bare, no envelope', async () => {
        const { body } = await dispatch('GET', '/api/v1/search', { query: { q: 'acme' } });
        expect(body).not.toHaveProperty('success');
        expect(body).not.toHaveProperty('data');
    });
});

describe('[#11924] POST /data/:object/:id/clone — declared body, relayed bare at 201', () => {
    it('answers a 201 body that parses against `CloneDataResponseSchema`, relayed from `cloneData`', async () => {
        const { protocol, res, body } = await dispatch('POST', '/api/v1/data/:object/:id/clone', {
            params: { object: 'account', id: 'acc_1' },
            body: { overrides: { name: 'Acme Copy' } },
        });

        expect(protocol.cloneData).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        const parsed = CloneDataResponseSchema.safeParse(body);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
        expect(body).toBe(CLONE_BODY);
    });

    it('describes the WHOLE body — this mount answers bare, no envelope', async () => {
        const { body } = await dispatch('POST', '/api/v1/data/:object/:id/clone', {
            params: { object: 'account', id: 'acc_1' },
            body: {},
        });
        expect(body).not.toHaveProperty('success');
        expect(body).not.toHaveProperty('data');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// [#11924] The ledger rows point AT this suite
// ═══════════════════════════════════════════════════════════════════════════
//
// Same closure as the discovery gate's #5791 pin: `responseSchema` may only be
// written where conformance coverage runs, that rule lives in a JSDoc which
// cannot fail a build, so the loop is closed here — in the file the rows name.
// `packages/client/src/route-ledger-response-schema.test.ts` carries the
// resolve-against-live-exports half for every ledger.
describe('[#11924] the ledger declares the schemas this suite parses with', () => {
    it('the search row names `SearchAllResponseSchema`, resolving to the very object asserted above', () => {
        const row = REST_ROUTE_LEDGER.find((e) => e.route === 'GET /api/v1/search');
        expect(row, 'the search row must exist in REST_ROUTE_LEDGER').toBeDefined();
        expect(row!.responseSchema).toBe('SearchAllResponseSchema');
        // Identity, not just resolvability: a name resolving to some OTHER
        // schema would satisfy the client-side resolver and still describe the
        // wrong contract — `SearchResult` sits one import away (#8140's trap).
        expect((specApi as unknown as Record<string, unknown>)[row!.responseSchema!])
            .toBe(SearchAllResponseSchema);
    });

    it('the clone row names `CloneDataResponseSchema`, resolving to the very object asserted above', () => {
        const row = REST_ROUTE_LEDGER.find((e) => e.route === 'POST /api/v1/data/:object/:id/clone');
        expect(row, 'the clone row must exist in REST_ROUTE_LEDGER').toBeDefined();
        expect(row!.responseSchema).toBe('CloneDataResponseSchema');
        expect((specApi as unknown as Record<string, unknown>)[row!.responseSchema!])
            .toBe(CloneDataResponseSchema);
    });
});
