// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21124] The dispatcher's `/meta` domain admits a WRITE of a `datasource`
 * definition on the capability the datasource admin door requires — and
 * answers the caller what `RestServer` answers — because both transports ask
 * ONE predicate (`metaTypeWriteRefusal` in `@objectstack/rest`) at their
 * `/meta` entry, before any branch resolves the protocol. The write-side twin
 * of `meta-type-read-capability-parity.test.ts`.
 *
 * A host that mounts only the `${prefix}/*` catch-all answers `/meta` from
 * `handleMetadataRequest` alone, so a check living only in `RestServer`'s
 * registrar would leave every such host taking a write `RestServer` refuses.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';

const WAREHOUSE = { name: 'warehouse', label: 'Warehouse', driver: 'postgres', config: { host: 'warehouse-db.fixture.internal', port: 5432 } };
const WAREHOUSE_EDIT = { ...WAREHOUSE, label: 'Warehouse (edited)' };
const LEADS_VIEW = { name: 'all_leads', label: 'All leads', object: 'lead', columns: ['name'] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

/**
 * `author` holds every authoring capability `/meta` knows, so its refusal can
 * only be the type-level gate's; `holder` holds the capability AND the
 * authoring capability the write doors' own admission still asks for.
 */
const CALLERS = {
    member: { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] },
    author: { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    holder: { userId: 'u_settings', isSystem: false, systemPermissions: ['manage_platform_settings', 'manage_metadata'] },
    // [ADR-0161 K4] The knowledge-source rows: full access to the indexed
    // object's records and no capability; the capability without
    // `manage_metadata`; and both.
    'record-grant': { userId: 'u_editor', isSystem: false, systemPermissions: [] as string[], permissions: ['article_editor'], positions: ['editor'] },
    'knowledge-only': { userId: 'u_half', isSystem: false, systemPermissions: ['manage_knowledge_sources'] },
    'knowledge-author': { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_knowledge_sources', 'manage_metadata'] },
} as const;
type CallerName = keyof typeof CALLERS;

/** A protocol over a REAL in-memory store; `calls()` counts every protocol call. */
function storeAndProtocol() {
    const store: Record<string, Record<string, any>> = {
        datasource: { warehouse: clone(WAREHOUSE) },
        view: { all_leads: clone(LEADS_VIEW) },
    };
    const bucket = (type: unknown) => (store[singular(type)] ??= {});
    const protocol = {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(store) })),
        getMetaItems: vi.fn(async ({ type }: any) => Object.values(bucket(type)).map(clone)),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type: singular(type), name, item: clone(bucket(type)[name]), lock: 'none' })),
        saveMetaItem: vi.fn(async ({ type, name, item }: any) => {
            bucket(type)[name] = clone(item);
            return { success: true, type: singular(type), name };
        }),
    };
    const calls = (): number => Object.values(protocol).reduce((n, fn: any) => n + fn.mock.calls.length, 0);
    return { store, protocol, calls };
}

/** [ADR-0161 K4] Both transports run on a deployment that mounts a knowledge service admitting every source. */
const KNOWLEDGE_ADMITS = { admitAuthoredSource: async () => ({ admitted: true }) };

const security = { resolvePermissionSetNames: async () => [], getMetadataReadableFields: async () => [] };

interface Answer { status: number; code?: string }

function bootDispatcher(callerName: CallerName) {
    const { store, protocol, calls } = storeAndProtocol();
    const list = vi.fn(async (type: string) => Object.values(store[singular(type)] ?? {}).map(clone));
    // [ADR-0161 K4] The deployment mounts a knowledge service that admits every source: on one with
    // none, an author's `knowledge_source` save is refused (ruled D), and this suite is about something else.
    const services: Record<string, unknown> = { protocol, security, metadata: { getPublished: async () => undefined, list }, knowledge: KNOWLEDGE_ADMITS };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLERS[callerName]);
    const send = async (method: string, path: string, body?: unknown): Promise<Answer> => {
        const res = await dispatcher.dispatch(method, path, body === undefined ? undefined : clone(body), {}, { request: { headers: {} } } as any);
        return { status: res.response?.status ?? 0, code: res.response?.body?.error?.code };
    };
    return { send, store, calls: () => calls() + list.mock.calls.length };
}

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
    res.send = vi.fn(() => res);
    res.header = vi.fn(() => res); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

const META = '/api/v1/meta';

function bootRest(callerName: CallerName) {
    const { store, protocol, calls } = storeAndProtocol();
    const rest: any = new RestServer(createMockServer() as any, protocol as any, {} as any);
    rest.resolveExecCtx = async () => clone(CALLERS[callerName]);
    rest.kernelServiceProvider = async (name: string) => {
        if (name === 'knowledge') return KNOWLEDGE_ADMITS;
        throw Object.assign(new Error(`Service '${name}' not found`), {
            __objectstackServiceNotRegistered: true, code: 'SERVICE_NOT_REGISTERED', serviceName: name,
        });
    };
    rest.registerRoutes();
    /** `path` is the dispatcher's spelling (`/meta/:type/:name`), mapped onto the REST item route. */
    const send = async (method: string, path: string, body?: unknown): Promise<Answer> => {
        const [type, name] = path.replace(/^\/meta\//, '').split('/');
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === `${META}/:type/:name`);
        if (!route) throw new Error(`${method} ${META}/:type/:name is not registered`);
        const res = makeRes();
        await route.handler({ method, path: `/api/v1${path}`, params: { type, name }, query: {}, body: clone(body ?? {}), headers: {} }, res);
        return { status: res.statusCode, code: res.body?.code ?? res.body?.error?.code };
    };
    return { send, store, calls };
}

describe('[#21124] both transports refuse a datasource write below the capability, alike, writing nothing', () => {
    for (const spelling of ['datasource', 'datasources']) {
        for (const who of ['member', 'author'] as const) {
            for (const name of ['warehouse', 'new_ds']) {
                it(`PUT /meta/${spelling}/${name} × ${who}`, async () => {
                    const rest = bootRest(who);
                    const disp = bootDispatcher(who);
                    const restBefore = clone(rest.store);
                    const dispBefore = clone(disp.store);
                    const viaRest = await rest.send('PUT', `/meta/${spelling}/${name}`, WAREHOUSE_EDIT);
                    const viaDispatcher = await disp.send('PUT', `/meta/${spelling}/${name}`, WAREHOUSE_EDIT);
                    expect(viaRest).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
                    expect(viaDispatcher).toEqual(viaRest);
                    expect(rest.store).toEqual(restBefore);
                    expect(disp.store).toEqual(dispBefore);
                    expect(rest.calls()).toBe(0);
                    expect(disp.calls()).toBe(0);
                });
            }
        }
    }

    it.each(['POST', 'PATCH', 'DELETE'])('dispatcher: %s on a datasource path is judged at the entry — 403 with no store call, on the list and item shapes', async (verb) => {
        for (const path of ['/meta/datasource', '/meta/datasources', '/meta/datasource/warehouse']) {
            const disp = bootDispatcher('author');
            const before = clone(disp.store);
            const answer = await disp.send(verb, path, {});
            expect({ path, ...answer }).toEqual({ path, status: 403, code: 'PERMISSION_DENIED' });
            expect(disp.store).toEqual(before);
            expect(disp.calls()).toBe(0);
        }
    });

    it('a holder writes through both transports', async () => {
        const rest = bootRest('holder');
        const disp = bootDispatcher('holder');
        expect((await rest.send('PUT', '/meta/datasource/warehouse', WAREHOUSE_EDIT)).status).toBe(200);
        expect((await disp.send('PUT', '/meta/datasource/warehouse', WAREHOUSE_EDIT)).status).toBe(200);
        expect(rest.store.datasource.warehouse.label).toBe('Warehouse (edited)');
        expect(disp.store.datasource.warehouse.label).toBe('Warehouse (edited)');
    });

    it('control — an unlisted type is still written by the author on both transports', async () => {
        const edit = { ...LEADS_VIEW, label: 'Leads (edited)' };
        const rest = bootRest('author');
        const disp = bootDispatcher('author');
        expect((await rest.send('PUT', '/meta/view/all_leads', edit)).status).toBe(200);
        expect((await disp.send('PUT', '/meta/view/all_leads', edit)).status).toBe(200);
        expect(rest.store.view.all_leads.label).toBe('Leads (edited)');
        expect(disp.store.view.all_leads.label).toBe('Leads (edited)');
    });
});

/**
 * [ADR-0161 K4, guard one; ruled on #37304, Q2 = B] The same parity for the
 * table's second row: a `knowledge_source` is written through either transport
 * only beside `manage_knowledge_sources`. The MCP draft door asks the same
 * predicate with the human as the caller (`mcp-authoring.test.ts`).
 */
describe('[ADR-0161 K4] both transports refuse a knowledge_source write below `manage_knowledge_sources`, alike, writing nothing', () => {
    const FAQ = { name: 'faq', label: 'FAQ', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['body'] } };

    for (const spelling of ['knowledge_source', 'knowledge_sources', 'knowledgeSources']) {
        for (const who of ['author', 'holder', 'record-grant'] as const) {
            it(`PUT /meta/${spelling}/faq × ${who}`, async () => {
                const rest = bootRest(who);
                const disp = bootDispatcher(who);
                const restBefore = clone(rest.store);
                const dispBefore = clone(disp.store);
                const viaRest = await rest.send('PUT', `/meta/${spelling}/faq`, FAQ);
                const viaDispatcher = await disp.send('PUT', `/meta/${spelling}/faq`, FAQ);
                expect(viaRest).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
                expect(viaDispatcher).toEqual(viaRest);
                expect(rest.store).toEqual(restBefore);
                expect(disp.store).toEqual(dispBefore);
                expect(rest.calls()).toBe(0);
                expect(disp.calls()).toBe(0);
            });
        }
    }

    it.each(['POST', 'PATCH', 'DELETE'])('dispatcher: %s on a knowledge_source path is judged at the entry — 403 with no store call', async (verb) => {
        for (const path of ['/meta/knowledge_source', '/meta/knowledge_sources', '/meta/knowledge_source/faq']) {
            const disp = bootDispatcher('author');
            const answer = await disp.send(verb, path, {});
            expect({ path, ...answer }).toEqual({ path, status: 403, code: 'PERMISSION_DENIED' });
            expect(disp.calls()).toBe(0);
        }
    });

    it('beside, never instead — the capability without `manage_metadata` writes nothing through either transport', async () => {
        const rest = bootRest('knowledge-only');
        const disp = bootDispatcher('knowledge-only');
        expect((await rest.send('PUT', '/meta/knowledge_source/faq', FAQ)).status).toBe(403);
        expect((await disp.send('PUT', '/meta/knowledge_source/faq', FAQ)).status).toBe(403);
        expect(rest.store.knowledge_source).toBeUndefined();
        expect(disp.store.knowledge_source).toBeUndefined();
    });

    it('a holder of both writes through both transports', async () => {
        const rest = bootRest('knowledge-author');
        const disp = bootDispatcher('knowledge-author');
        expect((await rest.send('PUT', '/meta/knowledge_source/faq', FAQ)).status).toBe(200);
        expect((await disp.send('PUT', '/meta/knowledge_source/faq', FAQ)).status).toBe(200);
        expect(rest.store.knowledge_source.faq).toEqual(FAQ);
        expect(disp.store.knowledge_source.faq).toEqual(FAQ);
    });
});
