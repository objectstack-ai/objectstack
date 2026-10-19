// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24371] One `GET /api/v1/data/:object` reads the target object's own
// stored `sys_metadata` rows ONCE.
//
// The defect: the API-exposure gate reads the object by name
// (`getMetaItem`), and that read sent its active-row selections to the store
// one by one — the package-less binding, the served row once per spelling
// (`object`, then `objects`), and the lock's scope once per spelling. Five
// serial reads of the same rows on every data read, about 250 ms of a data
// read at a hosted 50 ms round trip (measured on Postgres; four data reads per
// console open). Now the item's active rows are ONE read of both spellings
// (`type: { $in: ['object', 'objects'] }`), and each selection takes its rows
// from it.
//
// What this file holds, over the REAL protocol (`ObjectStackProtocolImplementation`)
// over a REAL `SchemaRegistry`, with the REAL `findData` behind the route:
//
//  1. COUNT — a list and a get of a code-defined object (no stored row) make
//     exactly ONE `sys_metadata` read. An object stored in the environment
//     makes that one read plus the ONE head read behind the item read's
//     `version` (the repository's write-address resolution, which this card
//     does not re-derive).
//  2. ANSWERS — the gate still judges the object the read serves: a stored
//     row's `enable` whitelist (stored under either spelling) still refuses a
//     method, and a code object with no row is still served.
//  3. FRESHNESS — a row written after one request is seen by the next. This
//     file's engine has no write-epoch seam, so the protocol's overlay cache
//     declines and nothing is kept between requests here. On a real engine
//     the served by-name read IS cached across requests, and a `sys_metadata`
//     write through the engine retires it (`meta-overlay-cache.ts` in
//     `@objectstack/metadata-protocol`, pinned there).
//
// ⛔ The count rows are the regression this file exists for: put the per-
// spelling reads back and they go red while every answer row stays green —
// "still 200" is exactly what the slow read looked like too.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Code-registered; no stored row. */
const CODE = { name: 'code_widget', label: 'Code Widget', fields: { title: { name: 'title', type: 'text' } } };
/**
 * Stored in the environment (`sys_metadata`), registered by no package; reads
 * only. The gate's verdict on it can come from the stored row alone, and the
 * data path then 404s the unregistered object itself (#3770).
 */
const STORED = {
    name: 'stored_widget', label: 'Stored Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get'] },
};

type Row = Record<string, unknown>;

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

/** One `where` value as a store reads it: `$in` membership, `null` as IS NULL, else equality. */
const valueMatches = (actual: unknown, want: unknown): boolean => {
    if (want !== null && typeof want === 'object') {
        const set = (want as { $in?: unknown }).$in;
        if (!Array.isArray(set)) throw new Error(`fake engine: unsupported operator in ${JSON.stringify(want)}`);
        return set.includes(actual ?? null);
    }
    return (actual ?? null) === (want ?? null);
};
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported combinator ${k}`);
    return v === undefined || valueMatches(row[k], v);
});

function host() {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(CODE) as never, 'pkg_code', undefined, 'own');
    const rows: Row[] = [];
    /** Every `sys_metadata` read the engine served, in order. */
    const reads: Array<{ verb: 'find' | 'findOne'; where: Row }> = [];
    const engine = {
        registry,
        find: async (table: string, q: { where?: Row; limit?: number } = {}) => {
            if (table !== 'sys_metadata') return [];
            reads.push({ verb: 'find', where: q.where ?? {} });
            const hits = rows.filter((r) => matches(r, q.where));
            return typeof q.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where?: Row } = {}) => {
            assertEngineFindOnePredicate(table, q as never);
            if (table !== 'sys_metadata') return null;
            reads.push({ verb: 'findOne', where: q.where ?? {} });
            return rows.find((r) => matches(r, q.where)) ?? null;
        },
        count: async () => 0,
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine as never, () => new Map());
    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const store = (type: 'object' | 'objects', body: Row): Row => {
        const row: Row = {
            id: `row_${rows.length + 1}`, type, name: body.name, state: 'active', package_id: null, bundle_member: null,
            metadata: JSON.stringify(body),
        };
        rows.push(row);
        return row;
    };
    return { rest, protocol, reads, store };
}

async function call(h: ReturnType<typeof host>, door: 'list' | 'get', object: string) {
    const path = door === 'list' ? '/api/v1/data/:object' : '/api/v1/data/:object/:id';
    const route = (h.rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    let status = 200;
    let body: any;
    const res: any = {
        status: (c: number) => { status = c; return res; },
        json: (b: unknown) => { body = b; return res; },
        send: (b: unknown) => { body = b; return res; },
        header: () => res, setHeader: () => res, write: () => true, end: () => res,
    };
    const params: Record<string, string> = door === 'list' ? { object } : { object, id: 'r1' };
    await route.handler({ method: 'GET', path, params, query: {}, headers: {}, body: {} }, res);
    return { status, body };
}

const errorCode = (body: any): unknown => body?.code ?? body?.error?.code;

describe('[#24371] one GET /api/v1/data/:object reads the object\'s own sys_metadata rows once', () => {
    it.each(['list', 'get'] as const)('a %s of a code-defined object makes exactly ONE sys_metadata read, of both spellings', async (door) => {
        const h = host();
        const out = await call(h, door, CODE.name);
        expect(out.status, JSON.stringify(out.body)).toBeLessThan(500);
        expect(h.reads).toEqual([
            { verb: 'find', where: { type: { $in: ['object', 'objects'] }, name: CODE.name, state: 'active' } },
        ]);
    });

    it('a list of a code-defined object is served (no row, nothing to refuse)', async () => {
        const h = host();
        const out = await call(h, 'list', CODE.name);
        expect(out.status, JSON.stringify(out.body)).toBe(200);
    });

    it('an object stored in the environment: the ONE row read, then the ONE head read behind `version`', async () => {
        const h = host();
        h.store('object', STORED);
        const out = await call(h, 'get', STORED.name);
        expect(out.status, JSON.stringify(out.body)).toBeLessThan(500);
        expect(h.reads.map((r) => r.verb)).toEqual(['find', 'findOne']);
        expect(h.reads[0]!.where).toEqual({ type: { $in: ['object', 'objects'] }, name: STORED.name, state: 'active' });
        expect(h.reads[1]!.where).toMatchObject({ type: 'object', name: STORED.name, state: 'active', package_id: null });
    });

    it.each(['object', 'objects'] as const)('the gate still judges the STORED row served (stored as `%s`): a list it does not allow is refused 405', async (spelling) => {
        const h = host();
        h.store(spelling, STORED);
        const out = await call(h, 'list', STORED.name);
        expect(out.status, JSON.stringify(out.body)).toBe(405);
        expect(errorCode(out.body)).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
        expect(out.body.allowed).toEqual(['get']);
        expect(h.reads.filter((r) => r.verb === 'find')).toHaveLength(1);
    });

    it('nothing is kept between requests: a row edited after one request is judged by the next', async () => {
        const h = host();
        const row = h.store('object', { ...STORED, enable: { apiMethods: ['get', 'list'] } });
        const before = await call(h, 'list', STORED.name);
        // Cleared by the gate; the data path's own registry 404 answers.
        expect(before.status, JSON.stringify(before.body)).toBe(404);
        expect(errorCode(before.body)).toBe('OBJECT_NOT_FOUND');
        row.metadata = JSON.stringify(STORED);
        const after = await call(h, 'list', STORED.name);
        expect(after.status, JSON.stringify(after.body)).toBe(405);
        expect(errorCode(after.body)).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    });
});
