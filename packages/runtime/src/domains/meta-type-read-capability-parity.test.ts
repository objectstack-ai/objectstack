// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21087] The dispatcher's `/meta` domain admits a read of a datasource-family
 * type on the capability that family's own door requires — and answers the
 * caller what `RestServer` answers — because both transports ask ONE
 * predicate (`metaTypeReadRefusal` in `@objectstack/rest`) at their `/meta`
 * entry, before any branch reads the store.
 *
 * A host that mounts only the `${prefix}/*` catch-all — `@objectstack/hono`'s
 * `createHonoApp`, the documented embed shape — answers `/meta` from
 * `handleMetadataRequest` alone, so a check living only in `RestServer`'s
 * registrar would leave every such host serving what `RestServer` refuses.
 * The rows below drive the same fixtures through both transports and compare.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const TOPOLOGY_MARKER = 'warehouse-db.fixture.internal';
const REMOTE_TABLE_MARKER = 'fixture_remote_ledger';

const STORE: Record<string, any[]> = {
    datasource: [{ name: 'warehouse', label: 'Warehouse', driver: 'postgres', config: { host: TOPOLOGY_MARKER, port: 5432 } }],
    external_catalog: [{ name: 'warehouse_catalog', datasource: 'warehouse', dialect: 'postgres', tables: [{ remoteName: REMOTE_TABLE_MARKER, columns: [] }] }],
    view: [{ name: 'all_leads', label: 'All leads', object: 'lead', columns: ['name'] }],
};
const MARKERS = [TOPOLOGY_MARKER, REMOTE_TABLE_MARKER];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any => (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

/**
 * `author` holds every authoring capability `/meta` knows, so its refusal can
 * only be the type-level gate's; `holder` holds the capability and nothing else.
 */
const CALLERS = {
    member: { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] },
    author: { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    holder: { userId: 'u_settings', isSystem: false, systemPermissions: ['manage_platform_settings'] },
} as const;
type CallerName = keyof typeof CALLERS;

function protocolDouble() {
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
    };
}

const security = { resolvePermissionSetNames: async () => [], getMetadataReadableFields: async () => [] };

interface Answer { status: number; code?: string; text: string }

function bootDispatcher(callerName: CallerName) {
    const protocol = protocolDouble();
    const getPublished = vi.fn(async (type: string, name: string) => clone(find(type, name)));
    const list = vi.fn(async (type: string) => clone(STORE[singular(type)] ?? []));
    const services: Record<string, unknown> = { protocol, security, metadata: { getPublished, list } };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLERS[callerName]);
    const read = async (path: string): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', path, undefined, {}, { request: { headers: {} } } as any);
        const body = res.response?.body;
        return { status: res.response?.status ?? 0, code: body?.error?.code, text: JSON.stringify(body ?? null) };
    };
    const reads = (): number =>
        Object.values(protocol).reduce((n, fn: any) => n + fn.mock.calls.length, 0) + getPublished.mock.calls.length + list.mock.calls.length;
    return { read, reads };
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

const META = '/api/v1/meta';

function bootRest(callerName: CallerName) {
    const rest: any = new RestServer(createMockServer() as any, protocolDouble() as any, {} as any);
    rest.resolveExecCtx = async () => clone(CALLERS[callerName]);
    rest.securityServiceProvider = async () => security;
    rest.serviceExistsProvider = () => true;
    rest.metadataServiceProvider = async () => ({ getPublished: async (type: string, name: string) => clone(find(type, name)) });
    rest.registerRoutes();
    /** `path` is the request path under `/meta` — the dispatcher's spelling — mapped onto its route. */
    const read = async (path: string): Promise<Answer> => {
        const [type, name, sub] = path.replace(/^\/meta\//, '').split('/');
        const routePath = name === undefined
            ? `${META}/:type`
            : sub === undefined ? `${META}/:type/:name` : `${META}/:type/:name/${sub}`;
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
        if (!route) throw new Error(`GET ${routePath} is not registered`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `/api/v1${path}`, params: { type, name }, query: {}, body: {}, headers: {} }, res);
        return { status: res.statusCode, code: res.body?.code ?? res.body?.error?.code, text: JSON.stringify(res.body ?? null) };
    };
    return { read };
}

/** The read shapes the dispatcher serves for one type: the list, the item, `/published`, `/layers`. */
const shapesOf = (type: string, name: string) => [`/meta/${type}`, `/meta/${type}/${name}`, `/meta/${type}/${name}/published`, `/meta/${type}/${name}/layers`];

const GATED = [
    { type: 'datasource', plural: 'datasources', name: 'warehouse' },
    { type: 'external_catalog', plural: 'external_catalogs', name: 'warehouse_catalog' },
] as const;

describe('[#21087] the dispatcher /meta domain — a datasource-family read admits the capability and nothing less', () => {
    for (const gated of GATED) {
        for (const spelling of [gated.type, gated.plural]) {
            for (const who of ['member', 'author'] as const) {
                it(`${spelling} × ${who}: every read shape is refused 403 PERMISSION_DENIED, nothing read`, async () => {
                    const { read, reads } = bootDispatcher(who);
                    for (const path of [...shapesOf(spelling, gated.name), `/meta/${spelling}/no_such_item`]) {
                        const answer = await read(path);
                        expect({ path, status: answer.status, code: answer.code }).toEqual({ path, status: 403, code: 'PERMISSION_DENIED' });
                        for (const marker of MARKERS) expect(answer.text).not.toContain(marker);
                    }
                    expect(reads()).toBe(0);
                });
            }

            it(`${spelling} × holder: every read shape is served`, async () => {
                const { read } = bootDispatcher('holder');
                for (const path of shapesOf(spelling, gated.name)) {
                    expect({ path, status: (await read(path)).status }).toEqual({ path, status: 200 });
                }
            });
        }
    }

    it('control — an unlisted type is served to a member', async () => {
        const { read } = bootDispatcher('member');
        expect((await read('/meta/view')).status).toBe(200);
        const item = await read('/meta/view/all_leads');
        expect(item.status).toBe(200);
        expect(item.text).toContain('All leads');
    });
});

describe('[#21087] both transports answer the same caller the same way', () => {
    for (const who of Object.keys(CALLERS) as CallerName[]) {
        for (const gated of GATED) {
            it(`${gated.type} × ${who}`, async () => {
                const dispatcher = bootDispatcher(who);
                const rest = bootRest(who);
                for (const path of [...shapesOf(gated.type, gated.name), ...shapesOf(gated.plural, gated.name)]) {
                    const [d, r] = [await dispatcher.read(path), await rest.read(path)];
                    expect({ path, status: d.status, refused: d.status === 403 ? d.code : undefined })
                        .toEqual({ path, status: r.status, refused: r.status === 403 ? r.code : undefined });
                }
            });
        }
    }
});
