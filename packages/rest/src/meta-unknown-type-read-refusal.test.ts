// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9488] `GET /api/v1/meta/:type` and `PUT /api/v1/meta/:type/:name` agree
// about which type names exist.
//
// The defect: `GET /api/v1/meta/totally_invented_type` answered
// `200 {"items":[]}` while the write door for the SAME name answered
// `400 '<type>' is not a metadata type`. A 200-with-an-empty-collection is
// indistinguishable from "this type exists and holds nothing", so a typo'd or
// renamed type read as an empty surface rather than as a mistake — the same
// shape `GET /meta/app?id=<unknown>` was already filed for.
//
// ## What this file pins, and why it is BOTH directions
//
// The refusal is only correct if it is narrow. The legitimate case it must not
// swallow — a type that EXISTS and has no items — is the very case the defect
// was indistinguishable from, so widening the refusal onto it would be a worse
// regression than the bug. Three populations therefore have to keep answering
// `200` with an empty collection, and each is here for a different reason:
//
//   * types in the static spelling contract (`sharing_rule`, `webhook`,
//     `objects`, `api`) — declared, addressable, frequently empty
//     (`theme` was one of them until #10485 retired its carrier out of the
//     contract — it now earns the refusal, pinned below);
//   * live-only keys an ordinary `registerApp` produces (`data`, `kind`,
//     `package`, `policy`) — outside the static contract but ENUMERATED by
//     `GET /meta/types`, which is precisely why #8421 refused to raise the
//     static verdict on the read entries;
//   * a plugin's own type, which enters the live set as a side effect of
//     registering items of it (`adding-a-metadata-type.mdx`).
//
// ## ADR-0112 — `code` AND `status`, never a bare "it refused"
//
// Every refusal assertion below reads the wire `status` and the wire `code`
// together. A bare `toThrow()`/"is not 200" cannot separate "answered with the
// wrong body" from "did not refuse at all", and the WRONG BODY is this defect:
// the pre-fix answer was a perfectly well-formed 200.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const LIST = '/api/v1/meta/:type';
const ITEM = '/api/v1/meta/:type/:name';

/** A name in neither the static spelling contract nor any live registry. */
const INVENTED = 'totally_invented_type';

/**
 * The live listing a stock deployment serves at `GET /meta/types`: the four
 * live-only keys `registerApp` produces, plus one plugin-registered type.
 * Deliberately NOT a copy of the static contract — the union under test is
 * only observable when the two halves differ.
 */
const LIVE_TYPES = ['object', 'app', 'view', 'api', 'data', 'kind', 'package', 'policy', 'my_widget'];

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
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/**
 * The refusal `@objectstack/metadata-protocol`'s `refuseUnmintableMetaType`
 * throws, stated literally rather than reconstructed through a real engine —
 * this file is about what the REST layer does with it, and the producer's own
 * end is pinned next door in `protocol.unrecognised-meta-type.test.ts`.
 */
function unmintable(type: string) {
    return Object.assign(
        new Error(`[invalid_request] '${type}' is not a metadata type. The platform declares no such type.`),
        { code: 'INVALID_REQUEST', status: 400 },
    );
}

function setup(overrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: [...LIVE_TYPES], entries: [] }),
        // Every type in this file is legitimately EMPTY. That is the point: the
        // refusal must come from the type NAME, never from the item count.
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        saveMetaItem: vi.fn(async (r: any) => { throw unmintable(r.type); }),
        findData: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    return { rest, protocol };
}

async function call(rest: any, method: string, path: string, params: any, query: any = {}, body?: any) {
    const res = makeRes();
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    await route.handler({ method, params, query, headers: {}, body }, res);
    return res;
}

const listType = (rest: any, type: string, query: any = {}) => call(rest, 'GET', LIST, { type }, query);

describe('[#9488] the /meta LIST door refuses a type name that names nothing', () => {
    it('answers 400 INVALID_REQUEST and names the type, instead of an empty collection', async () => {
        const { rest } = setup();

        const res = await listType(rest, INVENTED);

        // ADR-0112: code AND status together. `200 {"items":[]}` — the defect —
        // fails the status assertion; a refusal carrying some other code fails
        // the code assertion. Neither can pass by accident.
        expect(res.statusCode).toBe(400);
        expect(res.body?.code).toBe('INVALID_REQUEST');
        expect(String(res.body?.error)).toContain(`'${INVENTED}' is not a metadata type`);
    });

    it('does not ask the protocol to list a type it has refused', async () => {
        const { rest, protocol } = setup();

        await listType(rest, INVENTED);

        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('refuses on `?preview=draft` too — the drafts overlay is the same door', async () => {
        const { rest } = setup();

        const res = await listType(rest, INVENTED, { preview: 'draft' });

        expect(res.statusCode).toBe(400);
        expect(res.body?.code).toBe('INVALID_REQUEST');
    });
});

describe('[#9488] the read door and the write door agree on one invented name', () => {
    it('same status and same code from GET /meta/:type and PUT /meta/:type/:name', async () => {
        const { rest } = setup();

        const read = await listType(rest, INVENTED);
        const write = await call(rest, 'PUT', ITEM, { type: INVENTED, name: 'x' }, {}, { item: { name: 'x' } });

        // The agreement is the assertion — stated as an equality rather than as
        // two independent literals, so a future change that moves ONE door
        // fails here even if the moved value is itself defensible.
        expect(read.statusCode).toBe(write.statusCode);
        expect(read.body?.code).toBe(write.body?.code);
        // …and the value both doors settled on, so the pair cannot agree by
        // both regressing to 200 or to some unregistered code.
        expect(write.statusCode).toBe(400);
        expect(write.body?.code).toBe('INVALID_REQUEST');
    });
});

describe('[#9488] a type that EXISTS and has no items still answers 200 with an empty collection', () => {
    // The static spelling contract's own members — declared and addressable,
    // whether or not this deployment holds a single item of them.
    it.each(['sharing_rule', 'sharingRules', 'webhook', 'webhooks', 'objects', 'object', 'api', 'external_catalogs'])(
        'declared type %s', async (type) => {
            const { rest } = setup();

            const res = await listType(rest, type);

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual([]);
        },
    );

    it.each(['theme', 'themes'])(
        '[#10485] retired spelling %s is refused — it left the static contract with its carrier',
        async (type) => {
            // Until #10485 both spellings answered 200-empty here. The
            // retirement removed the `themes: 'theme'` fold, so a read now
            // gets the same ADR-0112 refusal an invented name does.
            const { rest } = setup();

            const res = await listType(rest, type);

            expect(res.statusCode).toBe(400);
            expect(res.body?.code).toBe('INVALID_REQUEST');
        },
    );

    // The population #8421 named when it REFUSED to raise the static verdict on
    // the read entries: live `SchemaRegistry` keys an ordinary `registerApp`
    // produces, which `GET /meta/types` enumerates. Refusing these would answer
    // 400 for types this same service advertises.
    it.each(['data', 'kind', 'package', 'policy'])(
        'live-only type %s, which GET /meta/types advertises', async (type) => {
            const { rest } = setup();

            const res = await listType(rest, type);

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual([]);
        },
    );

    it('a plugin type that entered the live set by registering items', async () => {
        const { rest } = setup();

        const res = await listType(rest, 'my_widget');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });
});

describe('[#9488] the refusal is never invented from an unreadable authority', () => {
    it('a rejecting getMetaTypes leaves the answer where it was — no refusal', async () => {
        const { rest } = setup({
            getMetaTypes: vi.fn().mockRejectedValue(
                Object.assign(new Error('metadata registry unreachable'), {
                    code: 'SERVICE_UNAVAILABLE', status: 503,
                }),
            ),
        });

        const res = await listType(rest, INVENTED);

        // "No such type" is an existence claim; stating it while the authority
        // that would know is unreachable is the mistake `metaTypeNamespaceExists`
        // avoids on the write door. Fail OPEN, exactly as before this change.
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('a host whose protocol carries no getMetaTypes keeps its prior answer', async () => {
        const { rest } = setup({ getMetaTypes: undefined });

        const res = await listType(rest, INVENTED);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });
});
