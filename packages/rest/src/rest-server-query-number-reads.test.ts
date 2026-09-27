// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20139] The rest of `rest-server.ts`'s numeric query reads: a value the door
 * cannot read is REFUSED — never dropped, substituted or handed on as `NaN`.
 *
 * The family's first four doors (`?limit=` on import jobs, export, meta history
 * and search) were closed by `readDeclaredQueryNumber`
 * (`rest-server-limit-param-parsing.test.ts`). These are the remaining members,
 * found by the census (`rest-server-query-number-census.test.ts`), each of which
 * read its parameter with a bare `Number(...)` and answered `200`:
 *
 * | door                                   | parameter              | what an unreadable value did                      |
 * | :------------------------------------- | :--------------------- | :------------------------------------------------ |
 * | `GET /meta/:type/:name/history`        | `sinceSeq`             | dropped: the log was read from the start          |
 * | `GET /meta/:type/:name/audit`          | `limit`                | dropped: the producer's default 100 was served    |
 * | `GET /meta/:type/:name/diff`           | `from` / `to` (+alias) | dropped: a DIFFERENT pair of versions was diffed  |
 * | `GET /search`                          | `perObject`            | `NaN` handed to `searchAll`: no per-object cap    |
 * | `GET /approvals/requests`              | `limit` / `offset`     | dropped: the unpaged 500-row window / first page  |
 *
 * `/diff` is not on the card's list. The census found it: its `Number(raw)` sat
 * in a local `parseV` helper, one frame away from the `req.query` it read, so a
 * search for `Number(req.query` never saw it.
 *
 * Each door now reads the parameter against its own DECLARATION where one
 * exists (`HistoryMetaItemRequestSchema.sinceSeq`,
 * `AuditMetaItemRequestSchema.limit`, both `z.number().optional()`) and as a
 * whole number where none does (`/diff`, `/search`, approvals). The refusal is
 * the data surface's `400 VALIDATION_FAILED` + `fields[]` envelope, with
 * `fields[0].field` naming the parameter as the caller spelled it and
 * `fields[0].code` the ADR-0114 catalog member.
 *
 * ## Every case asserts BOTH halves
 *
 * A refusal case pins `status` + `code` + the named field AND that the service
 * was never called: "still answered something" is exactly what the defect
 * looked like. A lit control pins the ARGUMENT the service received for a
 * conforming value, so a fix that refused everything could not pass either.
 *
 * ## The empty string, per door
 *
 * Decided the way the family's reader decides it: from what the door answered
 * for `?x=` before. Where that already WAS the absent answer (search's falsy
 * guard, `/diff`'s `parseV('')`), empty stays absent. Where `Number('')`
 * invented a `0` that changed the answer (history's `sinceSeq: 0`, which the
 * SQL repository's `event_seq <= 0` test turns into a filter; audit's one-event
 * clamp; approvals' one-row page or paged mode), empty is refused.
 *
 * ## What is deliberately NOT asserted
 *
 * Bounds. No card here takes a position on them: `0`, negatives and (where the
 * declaration has no `int()`) fractions reach each service exactly as before,
 * and each service's own clamp is untouched.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const APPROVALS = '/api/v1/approvals/requests';

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
 * The real `RestServer` over a spy protocol and a spy approvals service.
 * `isSystem` clears the capability gates that run BEFORE the query is read,
 * so every request reaches the read it is named after, and a request that is
 * not refused runs all the way to the service call the lit controls inspect.
 * `view` is a type no per-caller gate judges, so the event and diff doors
 * reach their protocol verb with no extra read in between.
 */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaItem: vi.fn().mockResolvedValue({
            type: 'view', name: 'all_accounts', item: { name: 'all_accounts' }, lock: 'none',
        }),
        historyMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        auditMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        diffMetaItem: vi.fn().mockResolvedValue({
            type: 'view', name: 'all_accounts', fromVersion: null, toVersion: null,
            added: [], removed: [], changed: [],
        }),
        searchAll: vi.fn().mockResolvedValue({
            query: 'acme', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false,
        }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };
    const approvals = {
        listRequests: vi.fn().mockResolvedValue([{ id: 'req_1' }, { id: 'req_2' }]),
        countRequests: vi.fn().mockResolvedValue(2),
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        undefined, // authServiceProvider
        undefined, // objectQLProvider
        undefined, // emailServiceProvider
        undefined, // sharingServiceProvider
        undefined, // reportsServiceProvider
        async () => approvals, // approvalsServiceProvider
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const drive = async (method: string, path: string, req: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { protocol, approvals, drive };
}

type Answer = { status: number; body: any };

/** The refusal half: status, top-level code, and the named field with its catalog code. */
function expectRefusal(answer: Answer, param: string, fieldCode: string) {
    expect(
        answer.status,
        `expected a 400 refusal for ${param}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    expect(answer.body?.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(answer.body?.fields), 'fields[] must be present').toBe(true);
    expect(answer.body.fields[0]?.field).toBe(param);
    expect(answer.body.fields[0]?.code).toBe(fieldCode);
}

const ITEM = { type: 'view', name: 'all_accounts' };

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /meta/:type/:name/history — `HistoryMetaItemRequestSchema.sinceSeq`
//    is `z.number().optional()`: any finite number, no int, no bounds.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 — GET /meta/:type/:name/history refuses a `sinceSeq` its declaration refuses', () => {
    const history = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/history`, { params: ITEM, query });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: `NaN`, dropped → the log read from the start
        ['Infinity', 'invalid_type'], // was: dropped → the log read from the start
        ['', 'invalid_type'],         // was: `Number('')` → `sinceSeq: 0`, a filter nobody asked for
        [' ', 'invalid_type'],        // was: `sinceSeq: 0`
    ])('?sinceSeq=%j is refused as %s and the log is never read', async (sinceSeq, fieldCode) => {
        const { answer, protocol } = await history({ sinceSeq });
        expectRefusal(answer, 'sinceSeq', fieldCode);
        expect(protocol.historyMetaItem, 'the change log may not have been read').not.toHaveBeenCalled();
    });

    it.each([
        ['5', 5],
        // Declared `z.number()` admits these; forwarded exactly as before.
        ['0', 0],
        ['1.5', 1.5],
    ])('lit control: ?sinceSeq=%j reaches historyMetaItem as %s', async (sinceSeq, expected) => {
        const { answer, protocol } = await history({ sinceSeq });
        expect(answer.status).toBe(200);
        expect(protocol.historyMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.historyMetaItem.mock.calls[0][0].sinceSeq).toBe(expected);
    });

    it('an absent sinceSeq still reads from the beginning (no sinceSeq member at all)', async () => {
        const { answer, protocol } = await history({});
        expect(answer.status).toBe(200);
        expect('sinceSeq' in protocol.historyMetaItem.mock.calls[0][0]).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /meta/:type/:name/audit — `AuditMetaItemRequestSchema.limit` is
//    `z.number().optional()`; the implementation's [1, 500] clamp is its own.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 — GET /meta/:type/:name/audit refuses a `limit` its declaration refuses', () => {
    const audit = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/audit`, { params: ITEM, query });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: `NaN`, dropped → the producer default 100
        ['Infinity', 'invalid_type'], // was: dropped → 100
        ['', 'invalid_type'],         // was: `Number('')` → 0 → clamped to ONE event
        [' ', 'invalid_type'],        // was: 0 → one event
    ])('?limit=%j is refused as %s and the trail is never read', async (limit, fieldCode) => {
        const { answer, protocol } = await audit({ limit });
        expectRefusal(answer, 'limit', fieldCode);
        expect(protocol.auditMetaItem, 'the audit trail may not have been read').not.toHaveBeenCalled();
    });

    it.each([
        ['25', 25],
        // Declared `z.number()` admits these; the implementation's clamp is its own business.
        ['0', 0],
        ['1.5', 1.5],
        ['900', 900],
    ])('lit control: ?limit=%j reaches auditMetaItem as %s', async (limit, expected) => {
        const { answer, protocol } = await audit({ limit });
        expect(answer.status).toBe(200);
        expect(protocol.auditMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.auditMetaItem.mock.calls[0][0].limit).toBe(expected);
    });

    it('an absent limit leaves the default to the producer (no limit member at all)', async () => {
        const { answer, protocol } = await audit({});
        expect(answer.status).toBe(200);
        expect('limit' in protocol.auditMetaItem.mock.calls[0][0]).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /meta/:type/:name/diff — no declared request schema; a history
//    version must be a whole number. `from`/`to` win over their
//    `fromVersion`/`toVersion` spellings, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 — GET /meta/:type/:name/diff refuses a version it cannot read', () => {
    const diff = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/diff`, { params: ITEM, query });
        return { answer, protocol };
    };

    it.each([
        [{ from: 'abc' }, 'from'],        // was: dropped → "the version before `to`" diffed instead
        [{ from: '1.5' }, 'from'],        // was: forwarded; no version 1.5 exists → a diff against nothing
        [{ from: 'Infinity' }, 'from'],   // was: dropped
        [{ from: ' ' }, 'from'],          // was: `Number(' ')` → version 0
        [{ to: 'abc' }, 'to'],            // was: dropped → the CURRENT body diffed instead
        [{ to: '2.5' }, 'to'],
        [{ fromVersion: 'abc' }, 'fromVersion'],
        [{ toVersion: 'abc' }, 'toVersion'],
        [{ from: '2', to: 'abc' }, 'to'],
    ])('%j is refused naming %s, and no diff is computed', async (query, param) => {
        const { answer, protocol } = await diff(query);
        expectRefusal(answer, param, 'invalid_type');
        expect(protocol.diffMetaItem, 'no diff may have been computed').not.toHaveBeenCalled();
    });

    it.each([
        [{ from: '2', to: '3' }, { fromVersion: 2, toVersion: 3 }],
        [{ fromVersion: '1', toVersion: '4' }, { fromVersion: 1, toVersion: 4 }],
        // `from` wins over `fromVersion`, as the old `??` had it.
        [{ from: '2', fromVersion: '7' }, { fromVersion: 2 }],
        // No position on bounds: a whole number reaches the verb unchanged.
        [{ from: '0' }, { fromVersion: 0 }],
    ])('lit control: %j reaches diffMetaItem as %j', async (query, expected) => {
        const { answer, protocol } = await diff(query);
        expect(answer.status).toBe(200);
        expect(protocol.diffMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.diffMetaItem.mock.calls[0][0]).toMatchObject(expected);
    });

    it.each([
        ['absent', {}],
        // `parseV('')` answered `undefined`: empty already meant absent here.
        ['empty', { from: '', to: '' }],
    ])('%s from/to still mean previous-vs-current (no version members)', async (_label, query) => {
        const { answer, protocol } = await diff(query);
        expect(answer.status).toBe(200);
        const request = protocol.diffMetaItem.mock.calls[0][0];
        expect('fromVersion' in request).toBe(false);
        expect('toVersion' in request).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /search — no declared request schema; `perObject` is a result cap
//    and must be a whole number. `searchAll`'s own [1, 25] clamp is untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 — GET /search refuses a `perObject` it cannot read', () => {
    const search = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', '/api/v1/search', { query: { q: 'acme', ...query } });
        return { answer, protocol };
    };

    it.each([
        ['abc', 'invalid_type'],      // was: `NaN` → the per-object cap never applied
        ['1.5', 'invalid_type'],      // was: a per-object cap of 1.5
        ['Infinity', 'invalid_type'], // was: silently clamped to 25
        [' ', 'invalid_type'],        // was: `Number(' ')` → 0 → clamped to 1
    ])('?perObject=%j is refused as %s and no search runs', async (perObject, fieldCode) => {
        const { answer, protocol } = await search({ perObject });
        expectRefusal(answer, 'perObject', fieldCode);
        expect(protocol.searchAll).not.toHaveBeenCalled();
    });

    it.each([
        ['5', 5],
        // Range is the producer's business and reaches it unchanged.
        ['0', 0],
        ['50', 50],
    ])('lit control: ?perObject=%j reaches searchAll as %s', async (perObject, expected) => {
        const { answer, protocol } = await search({ perObject });
        expect(answer.status).toBe(200);
        expect(protocol.searchAll.mock.calls[0][0].perObject).toBe(expected);
    });

    it.each([
        ['absent', {}],
        // The old falsy guard read `?perObject=` as absent; it stays so.
        ['empty', { perObject: '' }],
    ])('%s perObject leaves the cap to the producer default (undefined)', async (_label, query) => {
        const { answer, protocol } = await search(query);
        expect(answer.status).toBe(200);
        expect(protocol.searchAll.mock.calls[0][0].perObject).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /approvals/requests — no declared request schema; `limit` / `offset`
//    must be whole numbers. The service's own [1, 200] clamp is untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 — GET /approvals/requests refuses a `limit` / `offset` it cannot read', () => {
    const list = async (query: Record<string, unknown>) => {
        const { drive, approvals } = boot();
        const answer = await drive('GET', APPROVALS, { query });
        return { answer, approvals };
    };

    it.each([
        [{ limit: 'abc' }, 'limit'],       // was: dropped → the unpaged 500-row window, no `total`
        [{ limit: '1.5' }, 'limit'],       // was: 1.5 handed to the engine
        [{ limit: 'Infinity' }, 'limit'],  // was: dropped → unpaged
        [{ limit: '' }, 'limit'],          // was: `Number('')` → 0 → a ONE-row page
        [{ limit: ' ' }, 'limit'],         // was: 0 → a one-row page
        [{ offset: 'abc' }, 'offset'],     // was: dropped → the first page
        [{ offset: '1.5' }, 'offset'],     // was: 1.5 handed to the engine
        [{ offset: '' }, 'offset'],        // was: 0 → the service's 50-row paged mode, never asked for
        [{ limit: '10', offset: 'abc' }, 'offset'], // was: page 1 served for "page N"
    ])('%j is refused naming %s and no list is read', async (query, param) => {
        const { answer, approvals } = await list(query);
        expectRefusal(answer, param, 'invalid_type');
        expect(approvals.listRequests, 'no approval list may have been read').not.toHaveBeenCalled();
        expect(approvals.countRequests).not.toHaveBeenCalled();
    });

    it.each([
        [{ limit: '50', offset: '0' }, 50, 0],
        [{ limit: '25', offset: '50' }, 25, 50],
        // No position on bounds: the service's own clamp decides these.
        [{ limit: '0' }, 0, undefined],
        [{ offset: '-1' }, undefined, -1],
    ])('lit control: %j reaches listRequests as limit %s, offset %s', async (query, limit, offset) => {
        const { answer, approvals } = await list(query);
        expect(answer.status).toBe(200);
        expect(approvals.listRequests).toHaveBeenCalledTimes(1);
        const filter = approvals.listRequests.mock.calls[0][0];
        expect(filter.limit).toBe(limit);
        expect(filter.offset).toBe(offset);
    });

    it('absent limit/offset keep the unpaged list (both undefined, no `total`)', async () => {
        const { answer, approvals } = await list({});
        expect(answer.status).toBe(200);
        const filter = approvals.listRequests.mock.calls[0][0];
        expect(filter.limit).toBeUndefined();
        expect(filter.offset).toBeUndefined();
        expect(answer.body).toEqual({ data: [{ id: 'req_1' }, { id: 'req_2' }] });
    });
});
