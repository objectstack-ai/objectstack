// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6877] Repeated query parameters across `rest-server.ts`'s read points.
 *
 * `IHttpRequest.query` is declared `Record< string, string | string[] >`, and
 * the array arm is produced by a real first-party adapter — `NodeHttpServer`
 * hands `?x=1&x=2` through as `['1','2']`, measured over a socket on #6878.
 * `rest-server.ts` read ~50 of its query parameters as if the union had one
 * arm. None of them is a type error: each launders the array through `any`,
 * `String()` or `Number()`, which is why `packages/rest`'s type-check DEBT
 * count reached 0 while this whole class was still live.
 *
 * ## The three consequence classes, and why each needs its own case
 *
 * | class                 | measured outcome on `['a','b']`                          |
 * | :-------------------- | :------------------------------------------------------- |
 * | flows downstream      | `getMetaItems({ packageId: ['a','b'] })` — a package id no package has |
 * | `String()` join       | `'a,b'` — one name, belonging to nothing, answered 200    |
 * | `Number()` → `NaN`    | the bound is dropped, or clamps to a value nobody asked for |
 *
 * The two sharpest are not "degraded", they are INVERTED:
 *
 *   - `PUT /meta/:type/:name?force=false&force=false` — the `typeof` ternary
 *     falls through to `!!forceRaw`, and a non-empty array is truthy, so
 *     repeating an explicit opt-OUT turned the destructive-change guard ON.
 *   - `GET /data/:object/export?limit=1&limit=2` — `Number([...])` is `NaN`,
 *     `NaN || 0` is `0`, `Math.max(1, 0)` is `1`: a ONE-ROW export, 200 OK.
 *
 * ## What is asserted, and why `toThrow` would be worthless here
 *
 * These handlers *send*; they do not throw. A `toThrow`-shaped assertion would
 * report "the promise resolved" and could not tell "refused with the wrong
 * envelope" from "did not refuse at all" — and on the unfixed code the second
 * is what happens: every one of these requests answered **200**. So each
 * refusal case asserts the ADR-0112 pair — `status` AND the NESTED
 * `body.error.code` — the position PR #7293 (#7035) just converged this file's
 * `/meta` 501 refusals onto.
 *
 * ## The other half: preservation, and the multi-valued parameters
 *
 * A refusal sweep is only correct if it refuses the right parameters. Several
 * here are genuinely multi-valued and their consumers already read the array
 * arm on purpose — those must keep working untouched, and the cases at the
 * bottom pin them:
 *
 *   - `select` / `expand` on `GET /data/:object/:id`: `GetDataRequest` declares
 *     `z.array(z.string())` and `metadata-protocol`'s `getData` takes
 *     `string | string[]`. `?select=a&select=b` was ALREADY correct end to end.
 *   - `objects` on `GET /search`: the handler's own next line reads
 *     `Array.isArray(objectsParam)`.
 *
 * And every well-formed single-value request must behave exactly as before —
 * the spies below assert the ARGUMENT the protocol was handed, not merely that
 * a 200 came back, because "still 200" is what the defect looked like.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';
import { refuseRepeatedQueryParams, readSingleQueryValue } from './query-multiplicity.js';

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
 * A kernel that implements every protocol method these routes probe for, so a
 * request that is NOT refused runs all the way to the protocol call — which is
 * what lets the preservation cases assert the argument rather than the status.
 */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({
            type: 'object', name: 'account', item: { name: 'account' }, lock: 'none',
        }),
        saveMetaItem: vi.fn().mockResolvedValue({ success: true }),
        deleteMetaItem: vi.fn().mockResolvedValue({ success: true }),
        historyMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        auditMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        rollbackMetaItem: vi.fn().mockResolvedValue({ success: true }),
        diffMetaItem: vi.fn().mockResolvedValue({ changes: [] }),
        getMetaDiagnostics: vi.fn().mockResolvedValue({ entries: [] }),
        listDrafts: vi.fn().mockResolvedValue({ items: [] }),
        searchAll: vi.fn().mockResolvedValue({ results: [] }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
        getData: vi.fn().mockResolvedValue({ object: 'account', id: '1', record: {} }),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // `isSystem` clears the capability gates that run BEFORE the query is read,
    // so every request below reaches the multiplicity rule it is named after.
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
    ) => {
        const res = mockRes();
        await route(method, path).handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { protocol, drive };
}

/** The full ADR-0112 assertion for one multiplicity refusal. */
function expectRefusal(
    answer: { status: number; body: any },
    param: string,
    count = 2,
) {
    expect(
        answer.status,
        `expected a 400 refusal for a repeated "${param}", got ${answer.status} `
        + `with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    // Nested, per ADR-0112 and PR #7293's convergence. A status-only assertion
    // would pass on any 400 this file already emits for other reasons.
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.error?.message).toBe(
        `The "${param}" query parameter was supplied ${count} times. Supply it at most once — `
        + 'this endpoint will not choose between conflicting values.',
    );
    // `error` is the object, not a bare string — the dialect #7035 retired.
    expect(typeof answer.body?.error).toBe('object');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REFUSALS — one per consequence class, plus the two inversions
// ─────────────────────────────────────────────────────────────────────────────

describe('#6877 §1 — a repeated single-valued parameter is refused, not resolved', () => {
    it('PUT /meta/:type/:name?force — the INVERSION: two explicit opt-outs used to force', async () => {
        // The unfixed read: `typeof forceRaw === 'string' ? [...] : !!forceRaw`.
        // `!!['false','false']` is `true`, so the caller who said "do NOT force"
        // twice got the destructive-change guard switched off, with a 200.
        const { drive, protocol } = boot();
        const answer = await drive('PUT', `${META}/:type/:name`, {
            params: { type: 'object', name: 'account' },
            query: { force: ['false', 'false'] },
            body: { name: 'account' },
        });
        expectRefusal(answer, 'force');
        expect(protocol.saveMetaItem, 'the save must not have run at all').not.toHaveBeenCalled();
    });

    it('GET /data/:object/export?limit — the INVERSION: a two-value limit exported ONE row', async () => {
        // `Number(['1','2'])` → NaN → `NaN || 0` → 0 → `Math.max(1, 0)` → 1.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object/export`, {
            params: { object: 'account' },
            query: { limit: ['1', '2'] },
        });
        expectRefusal(answer, 'limit');
        expect(protocol.findData, 'no export query may have been issued').not.toHaveBeenCalled();
    });

    it('GET /meta/:type?object — the `String()` join class: `["a","b"]` became the name "a,b"', async () => {
        const { drive } = boot();
        const answer = await drive('GET', `${META}/:type`, {
            params: { type: 'view' },
            query: { object: ['account', 'contact'] },
        });
        expectRefusal(answer, 'object');
    });

    it('GET /meta/:type/:name/history?limit — the `Number()` → NaN class: the page bound vanished', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/history`, {
            params: { type: 'object', name: 'account' },
            query: { limit: ['5', '10'] },
        });
        expectRefusal(answer, 'limit');
        expect(protocol.historyMetaItem).not.toHaveBeenCalled();
    });

    it('GET /meta/:type?package — the flows-downstream class: an array reached `getMetaItems`', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type`, {
            params: { type: 'object' },
            query: { package: ['com.a', 'com.b'] },
        });
        expectRefusal(answer, 'package');
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('DELETE /data/:object/:id?expectedVersion — an OCC token no row can carry', async () => {
        // `String(['1','2'])` is `'1,2'`, so the optimistic-concurrency check on
        // a DESTRUCTIVE verb became a guaranteed mismatch.
        const { drive, protocol } = boot();
        const answer = await drive('DELETE', `${DATA}/:object/:id`, {
            params: { object: 'account', id: 'r1' },
            query: { expectedVersion: ['1', '2'] },
        });
        expectRefusal(answer, 'expectedVersion');
        expect(protocol.deleteData).not.toHaveBeenCalled();
    });

    it('GET /search?q — the search term became the literal string "a,b"', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', '/api/v1/search', {
            query: { q: ['acme', 'globex'] },
        });
        expectRefusal(answer, 'q');
        expect(protocol.searchAll).not.toHaveBeenCalled();
    });

    it('GET /meta/diagnostics?package — the `as string` cast that hid the union from tsc', async () => {
        const { drive } = boot();
        const answer = await drive('GET', `${META}/diagnostics`, {
            query: { package: ['com.a', 'com.b'] },
        });
        expectRefusal(answer, 'package');
    });

    it('GET /meta/_drafts?type', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/_drafts`, {
            query: { type: ['object', 'view'] },
        });
        expectRefusal(answer, 'type');
        expect(protocol.listDrafts).not.toHaveBeenCalled();
    });

    it('DELETE /meta/:type/:name?dropStorage — a destructive opt-in that stopped matching', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('DELETE', `${META}/:type/:name`, {
            params: { type: 'object', name: 'account' },
            query: { dropStorage: ['true', 'true'] },
        });
        expectRefusal(answer, 'dropStorage');
        expect(protocol.deleteMetaItem).not.toHaveBeenCalled();
    });

    it('POST /meta/:type/:name/rollback?toVersion — refused BY NAME, not as "required"', async () => {
        // The pre-existing `Number(...)` guard already answered 400 here — but
        // with `INVALID_REQUEST` "'toVersion' (positive integer) is required",
        // telling a caller who supplied two valid integers that they supplied
        // none. The message is the fix on this route, which is why the case
        // asserts the message and not only the status.
        const { drive, protocol } = boot();
        const answer = await drive('POST', `${META}/:type/:name/rollback`, {
            params: { type: 'object', name: 'account' },
            query: { toVersion: ['2', '3'] },
        });
        expectRefusal(answer, 'toVersion');
        expect(protocol.rollbackMetaItem).not.toHaveBeenCalled();
    });

    it('GET /meta/:type/:name/diff?from', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:name/diff`, {
            params: { type: 'object', name: 'account' },
            query: { from: ['1', '2'] },
        });
        expectRefusal(answer, 'from');
        expect(protocol.diffMetaItem).not.toHaveBeenCalled();
    });

    it('GET /meta/:type/:section/:name?package — the compound-name read', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type/:section/:name`, {
            params: { type: 'object', section: 'crm', name: 'account' },
            query: { package: ['com.a', 'com.b'] },
        });
        expectRefusal(answer, 'package');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('GET /data/import/jobs?status — the filter that silently stopped filtering', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/import/jobs`, {
            query: { status: ['queued', 'running'] },
        });
        expectRefusal(answer, 'status');
        expect(protocol.findData).not.toHaveBeenCalled();
    });

    it('the refusal names the count it saw, not just "more than one"', async () => {
        const { drive } = boot();
        const answer = await drive('GET', `${META}/:type`, {
            params: { type: 'object' },
            query: { package: ['a', 'b', 'c'] },
        });
        expectRefusal(answer, 'package', 3);
    });

    it('two repeated parameters on one request answer deterministically (declaration order)', async () => {
        // Not cosmetic: an answer that depended on object key order would make
        // this rule untestable and unpredictable for a client.
        const { drive } = boot();
        const answer = await drive('GET', `${META}/diagnostics`, {
            query: { package: ['a', 'b'], severity: ['error', 'warning'] },
        });
        expectRefusal(answer, 'severity');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PRESERVATION — a well-formed single-value request is untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('#6877 §2 — well-formed single-value requests behave exactly as before', () => {
    it('PUT /meta/:type/:name?force=true still forces, ?force=false still does not', async () => {
        const forced = boot();
        await forced.drive('PUT', `${META}/:type/:name`, {
            params: { type: 'object', name: 'account' },
            query: { force: 'true' },
            body: { name: 'account' },
        });
        expect(forced.protocol.saveMetaItem.mock.calls[0][0]).toMatchObject({ force: true });

        const unforced = boot();
        await unforced.drive('PUT', `${META}/:type/:name`, {
            params: { type: 'object', name: 'account' },
            query: { force: 'false' },
            body: { name: 'account' },
        });
        expect(unforced.protocol.saveMetaItem.mock.calls[0][0]).not.toHaveProperty('force');
    });

    it('GET /meta/:type?package=com.acme still scopes the list to that package', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${META}/:type`, {
            params: { type: 'object' },
            query: { package: 'com.acme' },
        });
        expect(answer.status).toBe(200);
        expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ packageId: 'com.acme' });
    });

    it('GET /meta/:type/:name/history?limit=5 still pages at 5', async () => {
        const { drive, protocol } = boot();
        await drive('GET', `${META}/:type/:name/history`, {
            params: { type: 'object', name: 'account' },
            query: { limit: '5', sinceSeq: '3' },
        });
        expect(protocol.historyMetaItem.mock.calls[0][0]).toMatchObject({ limit: 5, sinceSeq: 3 });
    });

    it('GET /meta/_drafts?type=object&packageId=com.acme still narrows both ways', async () => {
        const { drive, protocol } = boot();
        await drive('GET', `${META}/_drafts`, { query: { type: 'object', packageId: 'com.acme' } });
        expect(protocol.listDrafts.mock.calls[0][0]).toEqual({ type: 'object', packageId: 'com.acme' });
    });

    it('a parameter that is simply absent is still absent — the gate adds no key', async () => {
        const { drive, protocol } = boot();
        await drive('GET', `${META}/:type`, { params: { type: 'object' }, query: {} });
        expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ packageId: undefined });
    });

    it('DELETE /data/:object/:id?expectedVersion=7 still sends the OCC token through', async () => {
        const { drive, protocol } = boot();
        await drive('DELETE', `${DATA}/:object/:id`, {
            params: { object: 'account', id: 'r1' },
            query: { expectedVersion: '7' },
        });
        expect(protocol.deleteData.mock.calls[0][0]).toMatchObject({ expectedVersion: '7' });
    });

    it('a ONE-element array is one occurrence: accepted AND unwrapped to the string', async () => {
        // The rule counts occurrences, so `['com.acme']` is a single supply that
        // some adapter chose to encode as an array. Accepting it without
        // unwrapping would leave the array for the very `String()`/`Number()`
        // reads this change exists to protect — the acceptance would be a hole.
        const { drive, protocol } = boot();
        await drive('GET', `${META}/:type`, {
            params: { type: 'object' },
            query: { package: ['com.acme'] },
        });
        expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ packageId: 'com.acme' });
    });

    it('an EMPTY array is no occurrence — same answer as an absent parameter', async () => {
        const { drive, protocol } = boot();
        await drive('GET', `${META}/:type`, {
            params: { type: 'object' },
            query: { package: [] },
        });
        expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ packageId: undefined });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MULTI-VALUED PARAMETERS — measured, and deliberately NOT refused
// ─────────────────────────────────────────────────────────────────────────────

describe('#6877 §3 — genuinely multi-valued parameters keep both arms', () => {
    it('GET /data/:object/:id?select=a&select=b reaches `getData` as an ARRAY', async () => {
        // `GetDataRequest.select` is `z.array(z.string())` and
        // `metadata-protocol`'s `getData` takes `string | string[]`, splitting
        // the comma form itself. The card listed this line as a defect;
        // measurement says the consumer was built for the array. Refusing it
        // here would be the regression, so this case exists to make that
        // verdict fail loudly if a later sweep "completes" the pattern.
        const { drive, protocol } = boot();
        const answer = await drive('GET', `${DATA}/:object/:id`, {
            params: { object: 'account', id: 'r1' },
            query: { select: ['name', 'email'], expand: ['owner', 'account'] },
        });
        expect(answer.status).toBe(200);
        expect(protocol.getData.mock.calls[0][0]).toMatchObject({
            select: ['name', 'email'],
            expand: ['owner', 'account'],
        });
    });

    it('GET /data/:object/:id?select=a,b — the comma form is still passed through untouched', async () => {
        const { drive, protocol } = boot();
        await drive('GET', `${DATA}/:object/:id`, {
            params: { object: 'account', id: 'r1' },
            query: { select: 'name,email' },
        });
        expect(protocol.getData.mock.calls[0][0]).toMatchObject({ select: 'name,email' });
    });

    it('GET /search?objects=a&objects=b still searches BOTH objects', async () => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', '/api/v1/search', {
            query: { q: 'acme', objects: ['account', 'contact'] },
        });
        expect(answer.status).toBe(200);
        expect(protocol.searchAll.mock.calls[0][0]).toMatchObject({
            q: 'acme',
            objects: ['account', 'contact'],
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE RULE ITSELF — the shared helper, independent of any route
// ─────────────────────────────────────────────────────────────────────────────

describe('#6877 §4 — `refuseRepeatedQueryParams` / `readSingleQueryValue`', () => {
    const res = () => {
        const r: any = {
            statusCode: 200,
            body: undefined,
            status(c: number) { r.statusCode = c; return r; },
            json(b: any) { r.body = b; return r; },
        };
        return r;
    };

    it('counts occurrences rather than distinct values — two identical values are still two', () => {
        // "At most one *distinct* value" would be a de-duplication rule no
        // caller can predict; "supply it at most once" is checkable client-side.
        const r = res();
        expect(refuseRepeatedQueryParams({ query: { v: ['1.0.0', '1.0.0'] } }, r, ['v'])).toBe(true);
        expect(r.statusCode).toBe(400);
        expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('normalises a one-element array IN PLACE so nothing downstream sees the union', () => {
        const req = { query: { v: ['x'] } as Record<string, unknown> };
        expect(refuseRepeatedQueryParams(req, res(), ['v'])).toBe(false);
        expect(req.query.v).toBe('x');
    });

    it('leaves a plain string untouched — the byte-identical path', () => {
        const req = { query: { v: 'x' } as Record<string, unknown> };
        expect(refuseRepeatedQueryParams(req, res(), ['v'])).toBe(false);
        expect(req.query.v).toBe('x');
    });

    it('never touches a parameter the route did not declare single-valued', () => {
        const req = { query: { declared: 'x', multi: ['a', 'b'] } as Record<string, unknown> };
        expect(refuseRepeatedQueryParams(req, res(), ['declared'])).toBe(false);
        expect(req.query.multi).toEqual(['a', 'b']);
    });

    it('tolerates a missing/odd `query` rather than throwing inside a handler', () => {
        expect(refuseRepeatedQueryParams({}, res(), ['v'])).toBe(false);
        expect(refuseRepeatedQueryParams({ query: undefined }, res(), ['v'])).toBe(false);
    });

    it('`readSingleQueryValue` — the count rule, at the three boundaries', () => {
        expect(readSingleQueryValue(undefined)).toEqual({ ok: true, value: undefined });
        expect(readSingleQueryValue('x')).toEqual({ ok: true, value: 'x' });
        expect(readSingleQueryValue([])).toEqual({ ok: true, value: undefined });
        expect(readSingleQueryValue(['x'])).toEqual({ ok: true, value: 'x' });
        expect(readSingleQueryValue(['x', 'y'])).toEqual({ ok: false, count: 2 });
    });
});
