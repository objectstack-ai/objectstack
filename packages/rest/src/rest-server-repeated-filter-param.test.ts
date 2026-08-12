// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7390] A repeated `?filter=` on `GET /data/:object` is REFUSED, and refused
 * as what it is.
 *
 * ## Why this needed its own gate, and its own file
 *
 * #7386 gave `findData`'s shared list-query normalizer an arity gate keyed off
 * each slot's DECLARED value type, because that normalizer serves two ingresses
 * it cannot tell apart: `GET /data/:object`, where a repeated parameter arrives
 * as `string[]`, and `POST /data/:object/query`, whose body is arbitrary JSON.
 * On a slot whose type never admits an array, `Array.isArray` is unambiguous
 * evidence of repetition.
 *
 * The filter slot is the one member where that costs something, because a
 * filter AST *is* an array — `['status','=','open']`. A repeated `?filter=` and
 * a body-form AST are byte-identical down there, so the arity gate had to leave
 * the slot alone, and two shapes survived:
 *
 * | shape | answer BEFORE this gate |
 * | :--- | :--- |
 * | `?filter={"a":1}&filter={"b":2}` | `400 INVALID_FILTER` — but diagnosed as a MALFORMED filter |
 * | `?filter=status&filter=%3D&filter=open` | **`200`**, carrying `{status:'open'}` — a filter nobody expressed |
 *
 * Both were live: the production Hono adapter surfaces repeats as arrays since
 * #6878 route 2 (PR #7396).
 *
 * ## What is asserted, and why a status-only assertion would be worthless
 *
 * The common shape was ALREADY a 400 before this change. A test asserting only
 * `400` — or only `400` plus `INVALID_FILTER`, since the old diagnosis carried
 * that same code — passes just as green against the WRONG diagnosis. So every
 * refusal case here asserts the ADR-0112 pair (`status` AND `code`) **and**
 * that the message names REPETITION rather than malformedness. That third
 * assertion is the one carrying the card.
 *
 * §4 pins the old behaviour permanently by driving the real normalizer
 * directly, one layer below the gate: it still misdiagnoses the first shape and
 * still lowers the second to a working filter. Those two cases are the
 * reverse-verification, kept as tests rather than as a transcript — they go red
 * the day someone "simplifies" the gate away, and they document why deleting it
 * is not a cleanup.
 *
 * Maintainer ruling (2026-08-11) behind the shape: refuse, narrowest form —
 * last-wins and AND-merge were both rejected, because silent selection among
 * duplicates serves one of two intents a caller actually expressed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import {
    FILTER_SLOT_QUERY_PARAMS,
    assertFilterParamSuppliedOnce,
    repeatedFilterParamMessage,
} from './query-multiplicity.js';

const DATA = '/api/v1/data';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: unknown) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        write: vi.fn(function (this: any) { return true; }),
        end: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/**
 * A mocked protocol, so a request that is NOT refused reaches `findData` and
 * the preservation cases can assert the ARGUMENT it was handed. "Still 200" is
 * what one of the two defects looked like, so a status-only preservation case
 * would prove nothing either.
 */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        findData: vi.fn().mockResolvedValue({ object: 'task', records: [] }),
        getData: vi.fn().mockResolvedValue({ object: 'task', id: '1', record: {} }),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // Clears the capability gates that run BEFORE the query is read, so every
    // request below reaches the rule it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        return found;
    };

    const drive = async (
        method: string,
        path: string,
        req: Record<string, unknown> = {},
    ): Promise<{ status: number; body: any }> => {
        const res = mockRes();
        await route(method, path).handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { protocol, drive };
}

/**
 * The full assertion for one repeated-filter refusal: the ADR-0112 pair, the
 * FLAT `mapDataError` envelope this route's other filter refusals use, and —
 * the point of the card — that the message diagnoses REPETITION.
 */
function expectRepetitionRefusal(
    answer: { status: number; body: any },
    param: string,
    count: number,
) {
    expect(
        answer.status,
        `expected a 400 for a repeated "${param}", got ${answer.status} `
        + `with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    expect(answer.body?.code).toBe('INVALID_FILTER');
    // THE assertion. `400` + `INVALID_FILTER` alone were both already true of
    // the malformed-filter misdiagnosis this replaces.
    expect(answer.body?.error).toBe(repeatedFilterParamMessage(param, count));
    expect(String(answer.body?.error)).toContain('Repeated');
    expect(String(answer.body?.error)).toContain('send exactly one');
    expect(
        String(answer.body?.error).toLowerCase(),
        'the message must not diagnose a malformed filter — that is the wrong cause',
    ).not.toContain('malformed');
    // The FLAT data envelope (`{ error, code, object }`), not the nested
    // `/meta` dialect: one slot, one body shape, however the filter failed.
    expect(typeof answer.body?.error).toBe('string');
    expect(answer.body?.object).toBe('task');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REFUSALS — both shapes the card names, on every spelling of the one slot
// ─────────────────────────────────────────────────────────────────────────────

describe('#7390 §1 — a repeated filter parameter is refused, and named', () => {
    it('the COMMON shape: two well-formed filters were diagnosed as one malformed one', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: ['{"a":1}', '{"b":2}'] },
        });
        expectRepetitionRefusal(answer, 'filter', 2);
        expect(
            protocol.findData,
            'the query must not have reached the normalizer that would misdiagnose it',
        ).not.toHaveBeenCalled();
    });

    it('the ACCIDENTAL-SUCCESS shape: `?filter=status&filter=%3D&filter=open` used to answer 200', async () => {
        // Three occurrences of one parameter spell `['status','=','open']`,
        // which `isFilterAST` accepts and `parseFilterAST` lowers to
        // `{status:'open'}` — a working filter nobody expressed. §4 pins that
        // the layer below still does exactly this.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: ['status', '=', 'open'] },
        });
        expectRepetitionRefusal(answer, 'filter', 3);
        expect(
            protocol.findData,
            'the accidental AST must never reach the engine',
        ).not.toHaveBeenCalled();
    });

    it.each(FILTER_SLOT_QUERY_PARAMS.map((name: string) => [name]))(
        'every wire spelling of the ONE slot is gated: ?%s repeated',
        async (name: string) => {
            const { drive, protocol } = boot();
            const answer = await drive('GET', `${DATA}/:object`, {
                params: { object: 'task' },
                query: { [name]: ['{"a":1}', '{"b":2}'] },
            });
            expectRepetitionRefusal(answer, name, 2);
            expect(protocol.findData).not.toHaveBeenCalled();
        },
    );

    it('two IDENTICAL values are still two occurrences, and still refused', async () => {
        // "At most one distinct value" would be a de-duplication rule no caller
        // can predict; "supply it once" is checkable client-side. Same rule the
        // #6877 module header states for every other single-valued parameter.
        const { drive } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: ['{"a":1}', '{"a":1}'] },
        });
        expectRepetitionRefusal(answer, 'filter', 2);
    });

    it('the refusal is a client-caused 400, not an unhandled fault (no stack-trace log)', async () => {
        // `INVALID_FILTER` is already in `isExpectedQueryRejection`'s
        // vocabulary, so throwing it must not print "[REST] Unhandled error".
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            const { drive } = boot();
            await drive('GET', `${DATA}/:object`, {
                params: { object: 'task' },
                query: { filter: ['{"a":1}', '{"b":2}'] },
            });
            const logged = spy.mock.calls.map((c: unknown[]) => String(c[0] ?? '')).join('\n');
            expect(logged).not.toContain('Unhandled error');
        } finally {
            spy.mockRestore();
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PRESERVATION — a single filter still works, in BOTH its wire forms
// ─────────────────────────────────────────────────────────────────────────────

describe('#7390 §2 — one filter is untouched, in both accepted forms', () => {
    it('the JSON-object form reaches `findData` byte-identical', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: '{"status":"open"}' },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData).toHaveBeenCalledTimes(1);
        expect(protocol.findData.mock.calls[0][0].query.filter).toBe('{"status":"open"}');
    });

    it('the bare-AST form reaches `findData` byte-identical', async () => {
        // A single `?filter=["status","=","open"]` arrives as one STRING — the
        // gate reads arity, never shape, so the AST spelling is not its
        // business and the acceptance surface does not move.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: '["status","=","open"]' },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query.filter).toBe('["status","=","open"]');
    });

    it('a ONE-element array is one occurrence: unwrapped, not refused', async () => {
        // An adapter that always arrays (`NodeHttpServer`) hands one occurrence
        // through as `['…']`. Refusing it would punish a caller who did nothing
        // wrong; leaving it wrapped would hand the normalizer the very array
        // shape it reads as a malformed AST.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { filter: ['{"status":"open"}'] },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query.filter).toBe('{"status":"open"}');
    });

    it('the genuinely multi-valued parameters keep their array arm', async () => {
        // `$select` / `$expand` / `$searchFields` are declared arrays and their
        // consumers read them as such. The gate names one slot precisely so a
        // repeated projection is not collateral damage.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { $select: ['id', 'title'], filter: '{"status":"open"}' },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query.$select).toEqual(['id', 'title']);
    });

    it('a request with no filter at all is not touched', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object`, {
            params: { object: 'task' },
            query: { $top: '25' },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query).toEqual({ $top: '25' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE NEGATIVE PIN — the body face legitimately sends an array
// ─────────────────────────────────────────────────────────────────────────────

describe('#7390 §3 — `POST /data/:object/query` is untouched', () => {
    it('a body-form AST array is forwarded, not refused', async () => {
        // This is the pin proving the INGRESS was gated rather than the parser.
        // The same `['status','=','open']` that is a repetition on a
        // querystring is an ordinary AST in a JSON body, and must stay one.
        const { drive, protocol } = boot();
        const answer = await drive('POST', `${DATA}/:object/query`, {
            params: { object: 'task' },
            body: { filter: ['status', '=', 'open'] },
        });
        expect(
            answer.status,
            `the body face must not inherit the querystring rule; got ${JSON.stringify(answer.body)}`,
        ).toBe(200);
        expect(protocol.findData).toHaveBeenCalledTimes(1);
        expect(protocol.findData.mock.calls[0][0].query.filter).toEqual(['status', '=', 'open']);
    });

    it('a body-form nested AST is forwarded too', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('POST', `${DATA}/:object/query`, {
            params: { object: 'task' },
            body: { filter: [['status', '=', 'open'], 'and', ['done', '=', false]] },
        });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query.filter).toEqual(
            [['status', '=', 'open'], 'and', ['done', '=', false]],
        );
    });

    it('the helper itself never reads a body — it is handed `req.query` only', () => {
        // Structural, not incidental: the gate takes the query bag as its whole
        // input, so there is no path by which a body could reach it.
        const body: Record<string, unknown> = { filter: ['status', '=', 'open'] };
        expect(() => assertFilterParamSuppliedOnce(undefined)).not.toThrow();
        expect(() => assertFilterParamSuppliedOnce('not an object')).not.toThrow();
        // Handed the SAME shape as a query bag it would refuse — proving the
        // separation is the call site, which §3's route cases pin.
        expect(() => assertFilterParamSuppliedOnce(body)).toThrow(/Repeated/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LAYER BELOW — the old behaviour, pinned rather than remembered
// ─────────────────────────────────────────────────────────────────────────────

function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

const TASK = {
    name: 'task',
    label: 'Task',
    systemFields: false,
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        status: { name: 'status', type: 'text' as const },
    },
};

async function bootReal() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    // `packageId` supplied explicitly: `registerObject` declares it required,
    // and this package's TEST_DEBT ledger has zero margin for another TS2554.
    engine.registry.registerObject(TASK as any, 'test');
    await engine.syncSchemas();
    await engine.insert('task', { id: '1', title: 'open one', status: 'open' });
    await engine.insert('task', { id: '2', title: 'closed one', status: 'closed' });

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const found = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === `${DATA}/:object`,
    );
    const drive = async (query: Record<string, unknown>): Promise<{ status: number; body: any }> => {
        const res = mockRes();
        await found.handler(
            { method: 'GET', path: `${DATA}/:object`, params: { object: 'task' }, query, headers: {}, body: {} } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { protocol, drive };
}

describe('#7390 §4 — the real normalizer still does BOTH wrong things, one layer down', () => {
    it('reverse verification A: handed the repetition directly, it diagnoses MALFORMEDNESS', async () => {
        // The gate's own reverse verification, kept as a test. Reaching
        // `findData` with the array the route no longer forwards reproduces the
        // pre-#7390 answer exactly: a 400 whose text sends the caller to check
        // AST syntax that was never wrong.
        const { protocol } = await bootReal();
        let thrown: any;
        try {
            await protocol.findData({
                object: 'task',
                query: { filter: ['{"a":1}', '{"b":2}'] },
            } as any);
        } catch (e: unknown) { thrown = e; }

        expect(thrown, 'the normalizer must still refuse this — only the DIAGNOSIS moved').toBeTruthy();
        expect(thrown.status).toBe(400);
        expect(thrown.code).toBe('INVALID_FILTER');
        expect(String(thrown.message)).toContain('Malformed');
        expect(
            String(thrown.message),
            'this is the wrong-cause message #7390 exists to stop reaching callers',
        ).not.toContain('Repeated');
    });

    it('reverse verification B: handed the accidental AST directly, it returns the WRONG rows happily', async () => {
        // `['status','=','open']` lowers to `{status:'open'}` and answers rows.
        // Nothing below the transport can tell this from a body-form AST, which
        // is the entire argument for gating at the ingress.
        const { protocol } = await bootReal();
        const result: any = await protocol.findData({
            object: 'task',
            query: { filter: ['status', '=', 'open'] },
        } as any);
        expect(result.records.length, 'a filter nobody expressed, applied and answered').toBe(1);
        expect(result.records[0].id).toBe('1');
    });

    it('through the ROUTE, the same repetition is now named correctly', async () => {
        const { drive } = await bootReal();
        const answer = await drive({ filter: ['{"a":1}', '{"b":2}'] });
        expectRepetitionRefusal(answer, 'filter', 2);
    });

    it('through the ROUTE, the accidental-success shape is closed', async () => {
        const { drive } = await bootReal();
        const answer = await drive({ filter: ['status', '=', 'open'] });
        expectRepetitionRefusal(answer, 'filter', 3);
    });

    it('through the ROUTE, ONE filter still filters — end to end on a real engine', async () => {
        const { drive } = await bootReal();
        const json = await drive({ filter: '{"status":"open"}' });
        expect(json.status).toBe(200);
        expect(json.body.records.length).toBe(1);
        expect(json.body.records[0].id).toBe('1');
    });

    it('through the ROUTE, one filter in BARE-AST form still filters', async () => {
        const { drive } = await bootReal();
        const json = await drive({ filter: '["status","=","open"]' });
        expect(json.status).toBe(200);
        expect(json.body.records.length).toBe(1);
        expect(json.body.records[0].id).toBe('1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SPELLING SET — derived, not copied, where the spec owns it
// ─────────────────────────────────────────────────────────────────────────────

describe('#7390 §5 — filterSlotSpellingsAreComplete', () => {
    it('covers all four wire spellings of the one filter slot', () => {
        // `where` / `filter` are read off `RPC_QUERY_ALIAS_SLOTS`; `filters` /
        // `$filter` are wire-only and named in this package. If the spec table
        // drops or renames the `where` slot, the derived half empties and this
        // goes red — rather than silently ungating a spelling.
        expect([...FILTER_SLOT_QUERY_PARAMS].sort()).toEqual(
            ['$filter', 'filter', 'filters', 'where'],
        );
    });

    it('names only the filter slot — no multi-valued parameter is in the set', () => {
        for (const multi of ['select', '$select', 'expand', '$expand', 'searchFields', 'sort']) {
            expect(FILTER_SLOT_QUERY_PARAMS).not.toContain(multi);
        }
    });
});
