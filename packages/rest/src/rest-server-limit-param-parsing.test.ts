// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20061 / #20062] A `?limit=` a door cannot read is REFUSED — never
 * substituted, clamped into range, or dropped.
 *
 * Four published doors read `?limit=` with a bare `Number(...)` and answered
 * `200` whatever came back:
 *
 * | door                          | unfixed read                                    | what a bad value did              |
 * | :---------------------------- | :---------------------------------------------- | :-------------------------------- |
 * | `GET /data/import/jobs`       | `Math.min(200, Math.max(1, Number(q.limit) \|\| 50))` | `0` → 50 rows, `500` → 200 rows |
 * | `GET /data/:object/export`    | `Math.max(1, Number(q.limit) \|\| 0)`            | `abc` / empty → a ONE-row export  |
 * | `GET /meta/:type/:name/history` | `Number(q.limit)`, dropped unless finite      | `abc` → the WHOLE change log      |
 * | `GET /search`                 | `q.limit ? Number(q.limit) : undefined`         | `abc` → `NaN`, so no overall cap  |
 *
 * Each door now reads the parameter against its own DECLARATION and answers a
 * value outside it with the data surface's `400 VALIDATION_FAILED` + `fields[]`
 * envelope. `fields[].code` is the ADR-0114 catalog member the declared schema's
 * failure maps to (`invalid_type`, `min_value`, `max_value`).
 *
 * ## Every case asserts BOTH halves
 *
 * A refusal case pins `status` + `code` + the named field AND that the service
 * was never called: "still answered something" is exactly what the defect
 * looked like. A preservation case (the lit control) pins the ARGUMENT the
 * service received for a conforming value, so a fix that refused everything
 * could not pass either.
 *
 * ## What is deliberately NOT asserted
 *
 * The bounds of the three doors whose request declares none (export, search,
 * history) — both cards take no position on them. So `?limit=0` still reaches
 * export's own `Math.max(1, …)` and search's `[1, 100]` clamp exactly as it did
 * (the preservation rows below pin those answers UNCHANGED), and history still
 * forwards whatever finite number its declared `z.number()` admits.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
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
        _headers: {} as Record<string, string>,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        write: vi.fn(function (this: any) { return true; }),
        end: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any, k: string, v: string) { this._headers[k] = v; return this; }),
    };
    return res;
}

/**
 * The real `RestServer` over a spy protocol. `isSystem` clears the capability
 * gates that run BEFORE the query is read, so every request reaches the read
 * it is named after, and a request that is not refused runs all the way to the
 * protocol call the preservation cases inspect.
 */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaItem: vi.fn().mockResolvedValue({
            type: 'object', name: 'account', item: { name: 'account', fields: {} }, lock: 'none',
        }),
        historyMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        searchAll: vi.fn().mockResolvedValue({
            query: 'acme', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false,
        }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        return found;
    };

    const drive = async (method: string, path: string, req: Record<string, unknown> = {}) => {
        const res = mockRes();
        await route(method, path).handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return {
            status: res.statusCode,
            body: res.json.mock.calls.at(-1)?.[0],
            headers: res._headers as Record<string, string>,
        };
    };

    return { protocol, drive };
}

type Answer = { status: number; body: any };

/** The refusal half: status, top-level code, and the named field with its catalog code. */
function expectLimitRefusal(answer: Answer, param: string, fieldCode: string) {
    expect(
        answer.status,
        `expected a 400 refusal for ${param}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    expect(answer.body?.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(answer.body?.fields), 'fields[] must be present').toBe(true);
    expect(answer.body.fields[0]?.field).toBe(param);
    expect(answer.body.fields[0]?.code).toBe(fieldCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /data/import/jobs — `ListImportJobsRequestSchema`:
//    limit `int().min(1).max(200).default(50)`, offset `int().min(0).default(0)`
// ─────────────────────────────────────────────────────────────────────────────

describe('#20061 — GET /data/import/jobs holds its declared `limit` / `offset` bounds', () => {
    const jobs = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/import/jobs`, { query });
        return { answer, protocol };
    };

    it.each([
        ['0', 'min_value'],        // was: `0 || 50` → the default 50 rows
        ['-3', 'min_value'],       // was: clamped up to 1
        ['201', 'max_value'],      // was: clamped down to 200
        ['500', 'max_value'],      // was: clamped down to 200
        ['abc', 'invalid_type'],   // was: `NaN || 50` → 50 rows
        ['1.5', 'invalid_type'],   // was: handed to the engine as 1.5
        ['Infinity', 'invalid_type'], // was: clamped down to 200
        [' ', 'invalid_type'],     // was: `0 || 50` → 50 rows
    ])('?limit=%j is refused as %s and no query runs', async (limit, fieldCode) => {
        const { answer, protocol } = await jobs({ limit });
        expectLimitRefusal(answer, 'limit', fieldCode);
        expect(protocol.findData, 'no import-job query may have been issued').not.toHaveBeenCalled();
    });

    it.each([
        ['-1', 'min_value'],       // was: clamped up to 0
        ['abc', 'invalid_type'],   // was: `NaN || 0` → 0
        ['1.5', 'invalid_type'],   // was: handed to the engine as 1.5
    ])('?offset=%j is refused as %s and no query runs', async (offset, fieldCode) => {
        const { answer, protocol } = await jobs({ offset });
        expectLimitRefusal(answer, 'offset', fieldCode);
        expect(protocol.findData).not.toHaveBeenCalled();
    });

    it.each([
        [{ limit: '1' }, 1, 0],
        [{ limit: '200' }, 200, 0],
        [{ limit: '25', offset: '0' }, 25, 0],
        [{ limit: '25', offset: '40' }, 25, 40],
    ])('lit control: %j reaches the engine as limit %i, offset %i', async (query, limit, offset) => {
        const { answer, protocol } = await jobs(query);
        expect(answer.status).toBe(200);
        expect(protocol.findData).toHaveBeenCalledTimes(1);
        expect(protocol.findData.mock.calls[0][0].query).toMatchObject({ limit, offset });
    });

    it.each([
        ['absent', {}],
        ['empty', { limit: '', offset: '' }],
    ])('%s limit/offset keep the declared defaults (50, 0)', async (_label, query) => {
        const { answer, protocol } = await jobs(query);
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query).toMatchObject({ limit: 50, offset: 0 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /data/:object/export — no declared request schema; a row count must
//    be a whole number. Range stays the door's own clamp, untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20062 — GET /data/:object/export refuses a `limit` it cannot read', () => {
    const exportRows = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object/export`, {
            params: { object: 'account' },
            query: { format: 'csv', ...query },
        });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: `NaN || 0` → a ONE-row export
        ['', 'invalid_type'],         // was: `Number('') || 0` → a ONE-row export
        [' ', 'invalid_type'],        // was: a ONE-row export
        ['1.5', 'invalid_type'],      // was: `X-Export-Limit: 1.5`
        ['Infinity', 'invalid_type'], // was: silently capped to 50000
    ])('?limit=%j is refused as %s and no export query runs', async (limit, fieldCode) => {
        const { answer, protocol } = await exportRows({ limit });
        expectLimitRefusal(answer, 'limit', fieldCode);
        expect(protocol.findData, 'no export query may have been issued').not.toHaveBeenCalled();
    });

    it.each([
        ['25', '25'],
        // The door's own range handling is out of this card's scope and must
        // come through UNCHANGED: a floor of 1 and the 50000 hard cap.
        ['0', '1'],
        ['60000', '50000'],
    ])('lit control: ?limit=%j exports with X-Export-Limit %s', async (limit, effective) => {
        const { answer, protocol } = await exportRows({ limit });
        expect(answer.status).toBe(200);
        expect(answer.headers['X-Export-Limit']).toBe(effective);
        expect(protocol.findData).toHaveBeenCalled();
    });

    it('an absent limit keeps the 10000 default', async () => {
        const { answer } = await exportRows({});
        expect(answer.status).toBe(200);
        expect(answer.headers['X-Export-Limit']).toBe('10000');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /meta/:type/:name/history — `HistoryMetaItemRequestSchema.limit` is
//    `z.number().optional()`: any finite number, no int, no bounds.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20062 — GET /meta/:type/:name/history refuses what its declaration refuses', () => {
    const history = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/history`, {
            params: { type: 'view', name: 'all_accounts' },
            query,
        });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: NaN dropped → the WHOLE change log
        ['Infinity', 'invalid_type'], // was: dropped → the whole change log
        ['', 'invalid_type'],         // was: `Number('')` → 0 → zero events
        [' ', 'invalid_type'],        // was: 0 → zero events
    ])('?limit=%j is refused as %s and the log is never read', async (limit, fieldCode) => {
        const { answer, protocol } = await history({ limit });
        expectLimitRefusal(answer, 'limit', fieldCode);
        expect(protocol.historyMetaItem).not.toHaveBeenCalled();
    });

    it.each([
        ['5', 5],
        // Declared `z.number()` admits these; the door forwards them exactly as
        // before rather than inventing bounds the declaration does not carry.
        ['0', 0],
        ['1.5', 1.5],
    ])('lit control: ?limit=%j reaches historyMetaItem as %s', async (limit, expected) => {
        const { answer, protocol } = await history({ limit });
        expect(answer.status).toBe(200);
        expect(protocol.historyMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.historyMetaItem.mock.calls[0][0].limit).toBe(expected);
    });

    it('an absent limit still reads the full log (no limit member at all)', async () => {
        const { answer, protocol } = await history({});
        expect(answer.status).toBe(200);
        expect('limit' in protocol.historyMetaItem.mock.calls[0][0]).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /search — no declared request schema; a result cap must be a whole
//    number. The producer's own [1, 100] clamp is untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20062 — GET /search refuses a `limit` it cannot read', () => {
    const search = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', '/api/v1/search', { query: { q: 'acme', ...query } });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: `NaN` → the overall cap never triggered
        ['1.5', 'invalid_type'],      // was: an overall cap of 1.5 (two hits)
        ['Infinity', 'invalid_type'], // was: silently clamped to 100
        [' ', 'invalid_type'],        // was: 0 → clamped to 1
    ])('?limit=%j is refused as %s and no search runs', async (limit, fieldCode) => {
        const { answer, protocol } = await search({ limit });
        expectLimitRefusal(answer, 'limit', fieldCode);
        expect(protocol.searchAll).not.toHaveBeenCalled();
    });

    it.each([
        ['20', 20],
        // Range is the producer's business and reaches it unchanged.
        ['0', 0],
        ['500', 500],
    ])('lit control: ?limit=%j reaches searchAll as %s', async (limit, expected) => {
        const { answer, protocol } = await search({ limit });
        expect(answer.status).toBe(200);
        expect(protocol.searchAll.mock.calls[0][0].limit).toBe(expected);
    });

    it.each([
        ['absent', {}],
        ['empty', { limit: '' }],
    ])('%s limit leaves the cap to the producer default (undefined)', async (_label, query) => {
        const { answer, protocol } = await search(query);
        expect(answer.status).toBe(200);
        expect(protocol.searchAll.mock.calls[0][0].limit).toBeUndefined();
    });
});
