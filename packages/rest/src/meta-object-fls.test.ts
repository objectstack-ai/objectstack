// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 / #3682] Every REST `/meta` outlet that serves an object schema is
 * driven through the SAME case table (`@objectstack/metadata-core/testing`).
 *
 * The invariant, once: for a restricted caller an unreadable field is
 * COMPLETELY ABSENT from every exit — not a bare name, not a `null`, not a 200
 * with empty `fields`. The reason the table is shared rather than written per
 * suite is D5's own sentence, "every schema-serving outlet, or the mask is
 * decoration": five paths on this route reach a body, and before this suite
 * nothing would have gone red if a sixth arrived without the projection.
 *
 * The five outlets pinned here:
 *   1. `GET /meta/object/:name`, cached branch (THE DEFAULT — `enableCache`
 *      defaults to `true`);
 *   2. the same route, uncached branch (no `getMetaItemCached`; also what
 *      `?state=draft` / `?preview=draft` / `?package=` take);
 *   3. `?layers=true`, the layered diagnostic view — three full schemas
 *      (`code` / `overlay` / `effective`) reached by a query flag;
 *   4. `GET /meta/:type/:section/:name`, the compound-name read;
 *   5. `GET /meta/object`, the list read.
 *
 * Beyond the table, this file pins the properties the table cannot express:
 * D3's ETag fingerprint (byte-identical for an unrestricted caller; cohort
 * 304s; a permission change invalidating a stale 304), and D6 tier 2's cache
 * downgrade.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    OBJECT_SCHEMA_MASK_CASES,
    FLS_CONTRACT_OBJECT,
    assertObjectSchemaMaskCase,
    securityDoubleFor,
    type ObjectSchemaMaskCase,
    type ObjectSchemaMaskExit,
    type ObjectSchemaMaskOutcome,
} from '@objectstack/metadata-core/testing';
import { RestServer } from './rest-server';

const ACCOUNT = FLS_CONTRACT_OBJECT as unknown as Record<string, unknown>;

/** A fresh deep copy per call — an exit that mutates the cached body must not leak into the next case. */
const account = () => JSON.parse(JSON.stringify(ACCOUNT));

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const headers: Record<string, string> = {};
    return {
        headers,
        statusCode: 200,
        json: vi.fn(),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn((name: string, value: string) => { headers[name] = value; }),
    };
}

interface BootOptions {
    testCase: ObjectSchemaMaskCase;
    /** Supply `getMetaItemCached` (cached branch) or leave it off (uncached branch). */
    cached?: boolean;
    etag?: string;
}

function boot(opts: BootOptions) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async () => [account()]),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: account(), lock: 'none' })),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => ({
            type, name, code: account(), overlay: account(), effective: account(),
        })),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
    if (opts.cached) {
        protocol.getMetaItemCached = vi.fn(async () => ({
            data: account(),
            etag: { value: opts.etag ?? 'shared-validator', weak: false },
            cacheControl: { directives: ['private', 'no-cache'] },
            notModified: false,
        }));
    }

    const security = securityDoubleFor(opts.testCase);
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        {
            api: { requireAuth: false },
            // ADR-0106 D8 — the escape hatch is a per-server config key.
            metadata: opts.testCase.maskingDisabled ? { maskObjectFields: false } : {},
        } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        security ? (async () => security as any) : undefined,
    );
    (rest as any).resolveExecCtx = async () => ({ ...opts.testCase.context });
    rest.registerRoutes();
    return { rest, protocol };
}

function routeFor(rest: RestServer, path: string) {
    return (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
}

/** Turn a handler run into the contract's `document | fault` outcome. */
async function outcomeOf(
    run: (res: any) => Promise<void>,
    pick: (body: any) => unknown,
): Promise<ObjectSchemaMaskOutcome & { res?: any }> {
    const res = mockRes();
    await run(res);
    const body = res.json.mock.calls.at(-1)?.[0];
    if (res.statusCode >= 400) return { kind: 'fault', status: res.statusCode, res };
    return { kind: 'document', document: pick(body), res };
}

const SINGLE_PATH = '/api/v1/meta/:type/:name';
const LIST_PATH = '/api/v1/meta/:type';
const COMPOUND_PATH = '/api/v1/meta/:type/:section/:name';

const EXITS: ObjectSchemaMaskExit[] = [
    {
        name: 'GET /meta/object/:name — cached branch (default)',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, SINGLE_PATH)!.handler(
                    { params: { type: 'object', name: 'account' }, query: {}, headers: {} }, res,
                ),
                (body) => body?.item,
            );
        },
    },
    {
        name: 'GET /meta/object/:name — uncached branch',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: false });
            return outcomeOf(
                (res) => routeFor(rest, SINGLE_PATH)!.handler(
                    { params: { type: 'object', name: 'account' }, query: {}, headers: {} }, res,
                ),
                (body) => body?.item,
            );
        },
    },
    {
        name: 'GET /meta/objects/:name?state=draft — uncached branch via the canonical PLURAL spelling',
        run: (testCase) => {
            // #3984/#6241: the plural spelling is canonical, and a gate keyed on
            // the raw `:type` param is a gate it walks past. Driving one row of
            // the table through it keeps that from being re-learned.
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, SINGLE_PATH)!.handler(
                    { params: { type: 'objects', name: 'account' }, query: { state: 'draft' }, headers: {} }, res,
                ),
                (body) => body?.item,
            );
        },
    },
    {
        name: 'GET /meta/object/:name?layers=true — layered diagnostic view (`effective`)',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, SINGLE_PATH)!.handler(
                    { params: { type: 'object', name: 'account' }, query: { layers: 'true' }, headers: {} }, res,
                ),
                (body) => body?.effective,
            );
        },
    },
    {
        name: 'GET /meta/object/:name?layers=true — layered diagnostic view (`code`)',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, SINGLE_PATH)!.handler(
                    { params: { type: 'object', name: 'account' }, query: { layers: 'true' }, headers: {} }, res,
                ),
                (body) => body?.code,
            );
        },
    },
    {
        name: 'GET /meta/:type/:section/:name — compound-name read',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, COMPOUND_PATH)!.handler(
                    { params: { type: 'object', section: 'crm', name: 'account' }, query: {}, headers: {} }, res,
                ),
                (body) => body?.item,
            );
        },
    },
    {
        name: 'GET /meta/object — list read',
        run: (testCase) => {
            const { rest } = boot({ testCase, cached: true });
            return outcomeOf(
                (res) => routeFor(rest, LIST_PATH)!.handler(
                    { params: { type: 'object' }, query: {}, headers: {} }, res,
                ),
                (body) => (Array.isArray(body) ? body[0] : body?.items?.[0]),
            );
        },
    },
];

describe('[ADR-0106] REST /meta object-schema masking — one contract, every exit', () => {
    for (const exit of EXITS) {
        describe(exit.name, () => {
            for (const testCase of OBJECT_SCHEMA_MASK_CASES) {
                it(testCase.id, async () => {
                    const outcome = await exit.run(testCase);
                    assertObjectSchemaMaskCase(exit.name, testCase, outcome);
                });
            }
        });
    }
});

describe('[ADR-0106 D3] ETag carries the caller`s field-visibility fingerprint', () => {
    const RESTRICTED: ObjectSchemaMaskCase = {
        id: 'etag/restricted', why: 'D3', context: { userId: 'u_portal' },
        readable: ['id', 'name'], expect: { kind: 'fields', present: ['id'], absent: ['salary_grade'] },
    };
    const NARROWER: ObjectSchemaMaskCase = { ...RESTRICTED, id: 'etag/narrower', readable: ['id'] };
    const UNRESTRICTED: ObjectSchemaMaskCase = {
        ...RESTRICTED, id: 'etag/unrestricted',
        readable: ['id', 'name', 'salary_grade', 'bonus_formula'], expect: { kind: 'unmasked' },
    };

    async function read(testCase: ObjectSchemaMaskCase, ifNoneMatch?: string) {
        const { rest } = boot({ testCase, cached: true, etag: 'v1' });
        const res = mockRes();
        await routeFor(rest, SINGLE_PATH)!.handler(
            {
                params: { type: 'object', name: 'account' },
                query: {},
                headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
            },
            res,
        );
        return { etag: res.headers.ETag, status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0], res };
    }

    it('an unrestricted caller`s ETag is byte-identical to the shared validator', async () => {
        const { etag } = await read(UNRESTRICTED);
        expect(etag).toBe('"v1"');
    });

    it('a restricted caller`s ETag differs from the unrestricted one', async () => {
        const restricted = await read(RESTRICTED);
        expect(restricted.etag).not.toBe('"v1"');
        expect(restricted.etag).toMatch(/^"v1~[0-9a-f]{8}"$/);
    });

    it('same cohort → 304 (the fingerprinted validator round-trips)', async () => {
        const first = await read(RESTRICTED);
        const second = await read(RESTRICTED, first.etag!);
        expect(second.status).toBe(304);
    });

    it('permission change → the old ETag no longer hits 304, and the body is re-projected', async () => {
        const before = await read(RESTRICTED);
        const after = await read(NARROWER, before.etag!);
        expect(after.status).not.toBe(304);
        expect(Object.keys(after.body.item.fields)).toEqual(['id']);
    });

    it('two callers denying the same set share one validator (cohort 304s are real)', async () => {
        const a = await read({ ...RESTRICTED, context: { userId: 'a' } });
        const b = await read({ ...RESTRICTED, context: { userId: 'b' } });
        expect(a.etag).toBe(b.etag);
    });

    it('an unrestricted caller`s stale-validator 304 still works (zero regression)', async () => {
        const second = await read(UNRESTRICTED, '"v1"');
        expect(second.status).toBe(304);
    });
});

describe('[ADR-0106 D6] failure postures on the wire', () => {
    const UNDETERMINED: ObjectSchemaMaskCase = {
        id: 'wire/undetermined', why: 'D6 tier 2', context: { userId: 'u' },
        readable: undefined, expect: { kind: 'unmasked' },
    };
    const THROWS: ObjectSchemaMaskCase = {
        id: 'wire/throws', why: 'D6 tier 3', context: { userId: 'u' },
        readable: 'throw', expect: { kind: 'fault' },
    };

    async function read(testCase: ObjectSchemaMaskCase) {
        const { rest, protocol } = boot({ testCase, cached: true, etag: 'v1' });
        const res = mockRes();
        await routeFor(rest, SINGLE_PATH)!.handler(
            { params: { type: 'object', name: 'account' }, query: {}, headers: {} }, res,
        );
        return { res, protocol, body: res.json.mock.calls.at(-1)?.[0] };
    }

    it('tier 2 downgrades to `private, no-store` and emits NO shared ETag', async () => {
        const { res } = await read(UNDETERMINED);
        expect(res.headers['Cache-Control']).toBe('private, no-store');
        expect(res.headers.ETag).toBeUndefined();
    });

    it('tier 3 answers 5xx and the cached FULL body never reaches the wire', async () => {
        const { res, body, protocol } = await read(THROWS);
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(body)).not.toContain('salary_grade');
        expect(body?.item).toBeUndefined();
        // STRONGER than D3's "fetch → mask → send": the posture is resolved
        // before the fetch, so on the throw tier the cached document is never
        // even produced. Pinned as measured, because the weaker claim ("we
        // fetched it and then withheld it") would still be satisfied by a
        // future refactor that reorders the two and leaks on an early `return`.
        expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
    });

    it('a successful projection DOES go through the shared cache (mask-after-cache, not cache-bypass)', async () => {
        // The other half of the ordering claim: D3 rejected "bypass the cache
        // for restricted callers" as the end state, so a restricted read must
        // still take the cached path — this is what stops the implementation
        // from quietly degrading into the `doc`/`book` fallback.
        const { protocol } = await read({
            id: 'wire/projected', why: 'D3', context: { userId: 'u' },
            readable: ['id'], expect: { kind: 'fields', present: ['id'], absent: ['salary_grade'] },
        });
        expect(protocol.getMetaItemCached).toHaveBeenCalled();
    });

    it('tier 3 never answers an empty-fields 200', async () => {
        const { res, body } = await read({ ...THROWS, id: 'wire/throws-2' });
        expect(res.statusCode).not.toBe(200);
        expect(body?.item?.fields).toBeUndefined();
    });

    it('an all-denied projection refuses rather than serving `fields: {}`', async () => {
        const { res, body } = await read({
            id: 'wire/empty', why: 'D6', context: { userId: 'u' },
            readable: [], expect: { kind: 'fault' },
        });
        expect(res.statusCode).toBe(503);
        expect(body?.item).toBeUndefined();
    });
});
