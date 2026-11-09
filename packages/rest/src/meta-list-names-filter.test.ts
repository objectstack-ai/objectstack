// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29236, ruling 6580261740 letter A] `?names=a,b,c` on every `/meta/:type`
 * list — the batch by-names read.
 *
 * Before it, the list read no names filter: `?names=` was ignored and answered
 * the whole type list, so the Console's Home roster gate read each required
 * object by name, one request per name (8 on app-crm). The ruling binds:
 *
 *  - ONE comma-separated value; an empty one is refused `400`, like `?id=`;
 *  - a name that matches nothing is simply absent (no 404);
 *  - the narrowing runs after the per-caller gate and before the object mask,
 *    so masking and translation run only on the named items;
 *  - the filter is pushed down to the store read (`GetMetaItemsRequest.names`).
 *
 * The chain's step is pinned here directly (`createMetaListAnswer`), and the
 * door through `RestServer`. The protocol's push-down is pinned in
 * `packages/metadata-protocol/src/protocol.meta-list-names.test.ts`; the
 * runtime dispatcher's twin in the parity census
 * (`packages/runtime/src/domains/meta-list-projection-parity.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { createMetaListAnswer, metaListNames } from './meta-item-read-gate.js';
import { RestServer } from './rest-server.js';

const OBJECTS = [
    { name: 'account', label: 'Account', fields: { name: { type: 'text' } } },
    { name: 'contact', label: 'Contact', fields: { name: { type: 'text' } } },
    { name: 'lead', label: 'Lead', fields: { name: { type: 'text' } } },
];
const APPS = [
    { name: 'crm', label: 'CRM', navigation: [] },
    // Real, active metadata only a builder may observe (ADR-0045 §3): the gate withholds it from anyone else.
    { name: 'build_in_flight', label: 'Build', _unpublished: true, navigation: [] },
    { name: 'helpdesk', label: 'Helpdesk', navigation: [] },
];

const EMPTY_NAMES_MESSAGE = (got: string) =>
    `Query parameter 'names' names no item; got ${JSON.stringify(got)}. The list was not served: `
    + 'a list of no names is not a filter. Name at least one item, spelled ?names=A,B, or leave the '
    + 'parameter out to list every item you can see.';

describe('metaListNames — the one reading of `?names=`', () => {
    it('reads one comma-separated value: trimmed, blanks dropped, repeats folded', () => {
        expect(metaListNames({ names: 'account,contact' })).toEqual(['account', 'contact']);
        expect(metaListNames({ names: ' account , contact,,account ' })).toEqual(['account', 'contact']);
        expect(metaListNames({ names: 'account' })).toEqual(['account']);
    });

    it('is no filter when the key is absent', () => {
        expect(metaListNames({})).toBeUndefined();
        expect(metaListNames(undefined)).toBeUndefined();
    });

    it.each(['', ',', ' , '])('refuses %j — a value naming no item — with a located 400, never every item', (raw) => {
        let thrown: any;
        try { metaListNames({ names: raw }); } catch (e) { thrown = e; }
        expect({ status: thrown?.status, code: thrown?.code, param: thrown?.param, message: thrown?.message })
            .toEqual({ status: 400, code: 'VALIDATION_ERROR', param: 'names', message: EMPTY_NAMES_MESSAGE(raw) });
    });
});

/** Chain sources for a caller the gate does not narrow, with a masker that records what it is asked. */
function chainSources(opts: { caller?: unknown; perms?: string[] } = {}) {
    const masked: string[] = [];
    const translated: unknown[] = [];
    const sources: any = {
        resolveCaller: async () => opts.caller,
        resolveExecCtx: async () => opts.caller,
        resolveSecurityService: async () => undefined,
        serviceProbe: () => null,
        listMetaItems: () => Promise.resolve([]),
        navPruneLogged: new Set<string>(),
        requestLocale: () => undefined,
        translateList: async (_t: string, list: unknown) => { translated.push(list); return list; },
        resolveEndpointMatcher: async () => undefined,
        notifyMissingEndpointMatcher: () => {},
        resolveObjectMasker: async () => async (name: string) => {
            masked.push(name);
            return { kind: 'passthrough', reason: 'exempt' };
        },
    };
    return { sources, masked, translated };
}

const listOf = (answer: any): string[] => {
    const data = answer.ok ? answer.data : undefined;
    return ((Array.isArray(data) ? data : data?.items) ?? []).map((it: any) => it.name);
};

describe('the list chain\'s `?names=` step', () => {
    it('`object`: narrows to the named items, and the mask and the translation run on those alone', async () => {
        const { sources, masked, translated } = chainSources();
        const answer = await createMetaListAnswer(sources, { metaType: 'object', query: { names: 'contact,account' }, previewDrafts: false })(
            { type: 'object', items: structuredClone(OBJECTS) },
        );
        expect(listOf(answer)).toEqual(['account', 'contact']);
        expect(masked).toEqual(['account', 'contact']);
        expect(((translated[0] as any).items as any[]).map((it) => it.name)).toEqual(['account', 'contact']);
    });

    it('`object`, control: no `names` masks and lists every item', async () => {
        const { sources, masked } = chainSources();
        const answer = await createMetaListAnswer(sources, { metaType: 'object', query: {}, previewDrafts: false })(
            { type: 'object', items: structuredClone(OBJECTS) },
        );
        expect(listOf(answer)).toEqual(['account', 'contact', 'lead']);
        expect(masked).toEqual(['account', 'contact', 'lead']);
    });

    it('a name that matches no item is simply absent — never a 404, never the whole list', async () => {
        const { sources, masked } = chainSources();
        const some = await createMetaListAnswer(sources, { metaType: 'object', query: { names: 'account,nope' }, previewDrafts: false })(
            structuredClone(OBJECTS),
        );
        expect(listOf(some)).toEqual(['account']);
        const none = await createMetaListAnswer(sources, { metaType: 'object', query: { names: 'nope' }, previewDrafts: false })(
            structuredClone(OBJECTS),
        );
        expect({ ok: none.ok, names: listOf(none) }).toEqual({ ok: true, names: [] });
        expect(masked).toEqual(['account']);
    });

    it('an EMPTY `names` rejects the answer with the 400, before the mask', async () => {
        const { sources, masked } = chainSources();
        await expect(createMetaListAnswer(sources, { metaType: 'object', query: { names: '' }, previewDrafts: false })(
            structuredClone(OBJECTS),
        )).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'names' });
        expect(masked).toEqual([]);
    });

    it('`app`: narrows AFTER the per-caller gate — a named item the caller may not see stays withheld', async () => {
        // A member: a caller with system permissions, none of them the builder's.
        const member = { userId: 'u1', systemPermissions: [] };
        const { sources } = chainSources({ caller: member });
        const answer = await createMetaListAnswer(sources, {
            metaType: 'app', query: { names: 'build_in_flight,helpdesk' }, previewDrafts: false,
        })(structuredClone(APPS));
        expect(listOf(answer)).toEqual(['helpdesk']);
        // Control: the same gate, no filter — the withheld app is not listed either.
        const all = await createMetaListAnswer(sources, { metaType: 'app', query: {}, previewDrafts: false })(structuredClone(APPS));
        expect(listOf(all)).toEqual(['crm', 'helpdesk']);
    });
});

function mockRes() {
    const res: any = { statusCode: 200, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.send = vi.fn(() => res); res.end = vi.fn(() => res); res.write = vi.fn();
    return res;
}

/** `RestServer`'s list door over a protocol that answers `items` — and, unless `honoursNames`, ignores `names`. */
function bootRest(items: Record<string, any[]>, opts: { honoursNames?: boolean } = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(items) }),
        getMetaItems: vi.fn(async (req: any) => {
            const list = structuredClone(items[req.type] ?? []);
            const kept = opts.honoursNames && req.names ? list.filter((it: any) => req.names.includes(it.name)) : list;
            return { type: req.type, items: kept };
        }),
    };
    const server = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
    const read = async (type: string, query: Record<string, unknown>) => {
        const res = mockRes();
        await route.handler({ method: 'GET', path: '/api/v1/meta/:type', params: { type }, query, headers: {}, body: {} }, res);
        const body = res.body;
        const data = body?.data ?? body;
        return { status: res.statusCode, body, names: ((Array.isArray(data) ? data : data?.items) ?? []).map((it: any) => it?.name) };
    };
    return { protocol, read };
}

describe('RestServer `GET /meta/:type?names=` — the door', () => {
    it('pushes the names down to the store read, as `GetMetaItemsRequest.names`', async () => {
        const { protocol, read } = bootRest({ object: OBJECTS }, { honoursNames: true });
        const res = await read('object', { names: 'contact,account' });
        expect(res.status).toBe(200);
        expect(res.names).toEqual(['account', 'contact']);
        expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ type: 'object', names: ['contact', 'account'] });
    });

    it('narrows the answer of a store that does not filter, on `object` and on `view`', async () => {
        const views = [
            { name: 'lead_all', viewKind: 'list', object: 'lead' },
            { name: 'lead_open', viewKind: 'list', object: 'lead' },
            { name: 'account_all', viewKind: 'list', object: 'account' },
        ];
        const { read } = bootRest({ object: OBJECTS, view: views });
        expect((await read('object', { names: 'lead' })).names).toEqual(['lead']);
        expect((await read('view', { names: 'lead_open,account_all' })).names).toEqual(['lead_open', 'account_all']);
        // …and composes with the view switcher: the named views OF that object.
        expect((await read('view', { names: 'lead_open,account_all', object: 'lead' })).names).toEqual(['lead_open']);
    });

    it('sends no `names` to the store when the key is absent (control)', async () => {
        const { protocol, read } = bootRest({ object: OBJECTS });
        expect((await read('object', {})).names).toEqual(['account', 'contact', 'lead']);
        expect(protocol.getMetaItems.mock.calls[0][0]).not.toHaveProperty('names');
    });

    it('refuses an EMPTY `names` with 400 VALIDATION_ERROR before the store read', async () => {
        const { protocol, read } = bootRest({ object: OBJECTS });
        const res = await read('object', { names: '' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).toContain(JSON.stringify(EMPTY_NAMES_MESSAGE('')).slice(1, -1));
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('answers an unknown name as absent, with 200', async () => {
        const { read } = bootRest({ object: OBJECTS });
        const res = await read('object', { names: 'nope' });
        expect({ status: res.status, names: res.names }).toEqual({ status: 200, names: [] });
    });
});
