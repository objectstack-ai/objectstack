// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27627] The `/meta` reads the shared item cache cannot serve answer an
// `ETag`, `Cache-Control: private, no-cache` and `304` on a matching
// `If-None-Match` — the type list, every `/meta/:type` list, and the uncached
// item exit (`app`, `dashboard`, `doc`, `book`, drafts, scoped reads). Measured
// on `main` before this change: none of those sent any of the three.
//
// The validator hashes the SERVED body (`representationEtag`,
// `@objectstack/types`), after every per-caller step. So the load-bearing pin
// is the cross-caller one: two callers whose gates differ are handed different
// validators, and one caller's tag never revalidates the other's body. A
// validator computed over the stored list before the gate turns it red.
//
// The `meta` Server-Timing mark is pinned at the foot: each metadata read the
// route makes counts into one aggregate member.

import { describe, it, expect, vi } from 'vitest';
import { PerfTiming, runWithPerfTiming } from '@objectstack/observability';
import { RestServer } from './rest-server';
import { createMetaListAnswer, createMetaItemAnswer, META_UNDETERMINED_CACHE_CONTROL } from './meta-item-read-gate';
import { metaRepresentationCaching } from './meta-representation-validator';

const CRM_APP = { name: 'crm', label: 'CRM', navigation: [{ id: 'nav_leads', type: 'object', objectName: 'lead' }] };
/** Real, active metadata only a builder may observe (ADR-0045 §3) — the per-caller gate this file leans on. */
const UNPUBLISHED_APP = { name: 'build_in_flight', label: 'Build', _unpublished: true, navigation: [] };
const DASHBOARD = { name: 'ops', label: 'Ops', widgets: [{ id: 'w1', type: 'metric' }] };

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

/** A server over a mutable corpus, for a caller holding `perms`. */
function setup(perms: string[], corpus: { apps: any[]; dashboards: any[]; types: string[] }) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn(async () => ({ types: [...corpus.types] })),
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '');
            if (t === 'app' || t === 'apps') return JSON.parse(JSON.stringify(corpus.apps));
            if (t === 'dashboard' || t === 'dashboards') return JSON.parse(JSON.stringify(corpus.dashboards));
            return [];
        }),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const pool = String(type).startsWith('dashboard') ? corpus.dashboards : corpus.apps;
            const found = pool.find((a: any) => a.name === name);
            return { type, name, item: found ? JSON.parse(JSON.stringify(found)) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: perms });
    rest.registerRoutes();
    return { rest, protocol };
}

const route = (rest: any, path: string) => {
    const r = rest.getRoutes().find((x: any) => x.method === 'GET' && x.path === path);
    if (!r) throw new Error(`${path} not registered`);
    return r;
};

async function read(rest: any, path: string, params: Record<string, string>, ifNoneMatch?: string) {
    const res = makeRes();
    const headers = ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch };
    await route(rest, path).handler({ method: 'GET', params, query: {}, body: {}, headers }, res);
    return res;
}

const LIST = '/api/v1/meta/:type';
const ITEM = '/api/v1/meta/:type/:name';
const TYPES = '/api/v1/meta';
const fresh = () => ({ apps: [CRM_APP, UNPUBLISHED_APP], dashboards: [DASHBOARD], types: ['app', 'dashboard'] });

describe('[#27627] GET /meta/:type — the list carries the validator of the list THIS caller is served', () => {
    it('an ETag (weak) and private, no-cache', async () => {
        const { rest } = setup([], fresh());
        const res = await read(rest, LIST, { type: 'app' });
        expect(res.statusCode).toBe(200);
        expect(res.headers.ETag).toMatch(/^W\/"[0-9a-f]{16}"$/);
        expect(res.headers['Cache-Control']).toBe('private, no-cache');
        expect(res.headers.Vary).toBe('Accept-Language');
    });

    it('an unchanged list answers its own tag with a bodiless 304', async () => {
        const { rest } = setup([], fresh());
        const first = await read(rest, LIST, { type: 'app' });
        const again = await read(rest, LIST, { type: 'app' }, first.headers.ETag);
        expect(again.statusCode).toBe(304);
        expect(again.json).not.toHaveBeenCalled();
        expect(again.headers.ETag).toBe(first.headers.ETag);
    });

    it('two callers whose gate differs get different tags, and neither tag revalidates the other\'s body', async () => {
        const corpus = fresh();
        const member = await read(setup([], corpus).rest, LIST, { type: 'app' });
        const builder = await read(setup(['studio.access'], corpus).rest, LIST, { type: 'app' });
        // The gate really did vary the body — otherwise this pin proves nothing.
        expect(member.body.map((a: any) => a.name)).toEqual(['crm']);
        expect(builder.body.map((a: any) => a.name).sort()).toEqual(['build_in_flight', 'crm']);

        expect(member.headers.ETag).not.toBe(builder.headers.ETag);
        const crossed = await read(setup([], corpus).rest, LIST, { type: 'app' }, builder.headers.ETag);
        expect(crossed.statusCode).toBe(200);
        expect(crossed.body.map((a: any) => a.name)).toEqual(['crm']);
    });

    it('two callers the gate treats alike share a tag — the validator carries no caller dimension of its own', async () => {
        const corpus = fresh();
        const a = await read(setup([], corpus).rest, LIST, { type: 'app' });
        const b = await read(setup(['manage_users'], corpus).rest, LIST, { type: 'app' });
        expect(a.headers.ETag).toBe(b.headers.ETag);
    });

    it('a change moves the tag, and the old tag is answered in full', async () => {
        const corpus = fresh();
        const { rest } = setup([], corpus);
        const before = await read(rest, LIST, { type: 'app' });
        corpus.apps = [...corpus.apps, { name: 'hr', label: 'HR', navigation: [] }];
        const after = await read(rest, LIST, { type: 'app' }, before.headers.ETag);
        expect(after.statusCode).toBe(200);
        expect(after.headers.ETag).not.toBe(before.headers.ETag);
        expect(after.body.map((a: any) => a.name)).toEqual(['crm', 'hr']);
    });
});

describe('[#27627] GET /meta (the type list) carries its validator too', () => {
    it('ETag, private, no-cache, 304 on its own tag, and a new type moves it', async () => {
        const corpus = fresh();
        const { rest } = setup([], corpus);
        const first = await read(rest, TYPES, {});
        expect(first.headers.ETag).toMatch(/^W\/"[0-9a-f]{16}"$/);
        expect(first.headers['Cache-Control']).toBe('private, no-cache');
        expect((await read(rest, TYPES, {}, first.headers.ETag)).statusCode).toBe(304);

        corpus.types = [...corpus.types, 'view'];
        const moved = await read(rest, TYPES, {}, first.headers.ETag);
        expect(moved.statusCode).toBe(200);
        expect(moved.headers.ETag).not.toBe(first.headers.ETag);
    });
});

describe('[#27627] the uncached item exit — app and dashboard, which the shared cache never serves', () => {
    for (const [type, name] of [['app', 'crm'], ['dashboard', 'ops']] as const) {
        it(`GET /meta/${type}/${name}: ETag, private, no-cache, 304, and a change moves it`, async () => {
            const corpus = fresh();
            const { rest, protocol } = setup([], corpus);
            const first = await read(rest, ITEM, { type, name });
            expect(protocol.getMetaItem).toHaveBeenCalled();
            expect(first.statusCode).toBe(200);
            expect(first.headers.ETag).toMatch(/^W\/"[0-9a-f]{16}"$/);
            expect(first.headers['Cache-Control']).toBe('private, no-cache');

            const again = await read(rest, ITEM, { type, name }, first.headers.ETag);
            expect(again.statusCode).toBe(304);
            expect(again.json).not.toHaveBeenCalled();

            const pool = type === 'app' ? 'apps' : 'dashboards';
            corpus[pool] = corpus[pool].map((d: any) => (d.name === name ? { ...d, label: `${d.label} v2` } : d));
            const moved = await read(rest, ITEM, { type, name }, first.headers.ETag);
            expect(moved.statusCode).toBe(200);
            expect(moved.headers.ETag).not.toBe(first.headers.ETag);
        });
    }

    it('an app a member may not see is refused, never answered 304 against a builder\'s tag', async () => {
        const corpus = fresh();
        const builder = await read(setup(['studio.access'], corpus).rest, ITEM, { type: 'app', name: 'build_in_flight' });
        expect(builder.statusCode).toBe(200);
        const member = await read(setup([], corpus).rest, ITEM, { type: 'app', name: 'build_in_flight' }, builder.headers.ETag);
        expect(member.statusCode).toBe(404);
        expect(member.headers.ETag).toBeUndefined();
    });
});

describe('[#27627] the chains issue no validator on an undetermined posture (ADR-0106 D6 tier 2)', () => {
    it('metaRepresentationCaching keeps private, no-store and issues no ETag', () => {
        expect(metaRepresentationCaching({ items: [] }, META_UNDETERMINED_CACHE_CONTROL)).toEqual({ cacheControl: 'private, no-store' });
        expect(metaRepresentationCaching({ items: [] })).toEqual({ cacheControl: 'private, no-cache', etag: expect.stringMatching(/^W\//) });
    });

    it('both chains hash what they answer, not what they were handed', async () => {
        const sources: any = {
            translateList: async (_t: string, list: unknown) => list,
            translateEnvelope: async (env: any, doc: unknown) => ({ ...env, item: doc }),
            requestLocale: () => undefined,
            resolveExecCtx: async () => ({ userId: 'u1', systemPermissions: [] }),
        };
        const list = await createMetaListAnswer(sources, { metaType: 'position', query: {}, previewDrafts: false })([{ name: 'p1' }]);
        expect(list.ok && list.etag).toBe(metaRepresentationCaching(list.ok ? list.data : null).etag);
        const item = await createMetaItemAnswer(sources, {
            metaType: 'position', name: 'p1', policy: { arms: 'all', app: 'gate' }, maskPosture: { kind: 'passthrough' } as any,
        })({ type: 'position', name: 'p1', item: { name: 'p1' } });
        expect(item.kind === 'serve' && item.etag).toBe(metaRepresentationCaching(item.kind === 'serve' ? item.envelope : null).etag);
    });
});

describe('[#27627] the meta Server-Timing mark — every metadata read counts into one member', () => {
    it('a list read records `meta` with its read count', async () => {
        const { rest } = setup([], fresh());
        const timing = new PerfTiming();
        await runWithPerfTiming(timing, () => read(rest, LIST, { type: 'app' }));
        const meta = timing.marks().find((m) => m.name === 'meta');
        expect(meta?.desc).toBe('1 reads');
    });

    it('an uncached item read and the type list record it too', async () => {
        const { rest } = setup([], fresh());
        for (const [path, params] of [[ITEM, { type: 'app', name: 'crm' }], [TYPES, {}]] as const) {
            const timing = new PerfTiming();
            await runWithPerfTiming(timing, () => read(rest, path, params));
            expect(timing.marks().find((m) => m.name === 'meta')?.desc, path).toBe('1 reads');
        }
    });
});
