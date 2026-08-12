// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7606] The closed query-parameter set on the FIRST TIER of data read
 * routes: `GET /data/:object/:id`, `GET /data/:object/export`, `GET /search`.
 *
 * ## What is being pinned, and why a status assertion alone would not do it
 *
 * These handlers read the keys they know off the query string and ignore the
 * rest, so a misspelled, renamed or invented parameter is silently dropped and
 * the caller gets a plausible-looking answer. The failure is undetectable from
 * the response in BOTH directions — a dropped `?objects=` fans a search across
 * every object, a dropped `?fields=` returns the whole record — and on the
 * unfixed code every one of those is an ordinary **200**. So each refusal case
 * below asserts three things, per the #7527 template: the ADR-0112 pair
 * (`status` AND the NESTED `body.error.code`), the located message, and — the
 * assertion that actually matters — **that the service was never called**.
 *
 * ## The other half: preservation
 *
 * A whitelist is only correct if the real traffic still passes, and the sharp
 * edge is that the closed set is not "the filters": it carries paging, output
 * format, ordering, and on the export route one name the handler body never
 * mentions (`locale`, read by `extractLocale` behind `translateMetaItem`).
 * Forgetting `limit` would trade a silent-widening bug for a loud export
 * outage. Every preservation case therefore asserts the ARGUMENT the service
 * received, not merely that a 200 came back — "still 200" is exactly what the
 * defect looked like.
 *
 * ## Composition (§4)
 *
 * Two guards already run on this surface and a request can trip both. The
 * order and the envelope are pinned here so the answer is defined rather than
 * incidental, and so the #8001 divergence is provably left where it was.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import {
    RestServer,
    DATA_RECORD_READ_PARAMS,
    DATA_EXPORT_PARAMS,
    GLOBAL_SEARCH_PARAMS,
} from './rest-server.js';
import { unknownQueryParamMessage } from './query-allowlist.js';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text', label: 'ID' },
        title: { name: 'title', type: 'text', label: 'Title' },
    },
};

/** Two rows, so "the unfiltered/unscoped answer came back" is visible. */
const ROWS = [{ id: '1', title: 'alpha' }, { id: '2', title: 'beta' }];

function mockServer() {
    const noop = () => { /* routes are driven directly, never through the adapter */ };
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => { /* never started */ },
        close: async () => { /* never started */ },
    };
}

function mockRes() {
    const chunks: string[] = [];
    const res: any = {
        statusCode: 200,
        write: vi.fn(function (this: any, s: any) { chunks.push(String(s)); return true; }),
        end: vi.fn(function (this: any) { return this; }),
        header: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        send: vi.fn(function (this: any) { return this; }),
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return { res, chunks };
}

/**
 * Boot a RestServer with the data protocol stubbed, and return a driver per
 * route under test. `isSystem` clears the capability gates that run BEFORE the
 * recognition rule, so every request below reaches the gate it is named after.
 */
function boot() {
    const getData = vi.fn().mockResolvedValue({ object: 'task', record: ROWS[0] });
    const findData = vi.fn().mockResolvedValue({ object: 'task', records: ROWS, total: 2 });
    const searchAll = vi.fn().mockResolvedValue({ results: [] });
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK }),
        getData,
        findData,
        searchAll,
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const driver = (method: string, path: string) => async (
        query: Record<string, unknown> = {},
        params: Record<string, unknown> = { object: 'task' },
    ) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const out = mockRes();
        await found.handler(
            { method, path, params, query, headers: {}, body: {} } as any,
            out.res,
        );
        return {
            status: out.res.statusCode,
            body: out.res.json.mock.calls.at(-1)?.[0],
            chunks: out.chunks.join(''),
        };
    };

    return {
        getData, findData, searchAll,
        readRecord: driver('GET', '/api/v1/data/:object/:id'),
        exportRows: driver('GET', '/api/v1/data/:object/export'),
        search: driver('GET', '/api/v1/search'),
        listRecords: driver('GET', '/api/v1/data/:object'),
    };
}

/** The full ADR-0112 assertion for one recognition refusal. */
function expectRefusal(
    answer: { status: number; body: any },
    supported: readonly string[],
    ...unknown: string[]
) {
    expect(
        answer.status,
        `expected a 400 refusal for ${unknown.join(', ')}, got ${answer.status} `
        + `with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    // Nested, per ADR-0112 — the same position and code the multiplicity
    // refusal on these same handlers answers with (#6877 / #7527).
    expect(typeof answer.body?.error).toBe('object');
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.error?.message).toBe(
        unknownQueryParamMessage(unknown, [...supported].sort()),
    );
    // The refusal must not have leaked a row-shaped payload alongside itself.
    expect(answer.body?.records).toBeUndefined();
    expect(answer.body?.record).toBeUndefined();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /data/:object/:id — closed set {select, expand}
// ─────────────────────────────────────────────────────────────────────────────

describe('#7606 §1 — GET /data/:object/:id refuses what it would have dropped', () => {
    it('?fields= is refused — the CANONICAL spelling this route never implemented', async () => {
        // The spec alias table declares the slot as canonical `fields` with
        // alias `select`; this route folds no aliases and reads only `select`,
        // so `?fields=title` returned the FULL record with a 200. The refusal
        // makes that gap self-reporting instead of silent — whether the fold
        // should exist at all is #8039, deliberately not settled here.
        const { readRecord, getData } = boot();
        const answer = await readRecord({ fields: 'title' }, { object: 'task', id: '1' });
        expectRefusal(answer, DATA_RECORD_READ_PARAMS, 'fields');
        expect(
            getData,
            'the record must not have been read — answering the full record is the defect',
        ).not.toHaveBeenCalled();
    });

    it('?populate= — the expand slot\'s unimplemented alias — is refused the same way', async () => {
        const { readRecord, getData } = boot();
        const answer = await readRecord({ populate: 'owner' }, { object: 'task', id: '1' });
        expectRefusal(answer, DATA_RECORD_READ_PARAMS, 'populate');
        expect(getData).not.toHaveBeenCalled();
    });

    it('the refusal stays a 400 — the catch that rewrites 400→404 must not swallow it', async () => {
        // This route's catch turns every 400 into a 404 (a bad id is a miss,
        // not a malformed request). The gate RESPONDS rather than throwing
        // precisely so a refusal cannot reach the caller as "no such record" —
        // the silent-drop defect wearing a different status. If someone later
        // converts the gate to `throw`, this is the test that goes red.
        const { readRecord } = boot();
        const answer = await readRecord({ nope: '1' }, { object: 'task', id: '1' });
        expect(answer.status).toBe(400);
        expect(answer.status).not.toBe(404);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('several unknown names are all reported, in a deterministic order', async () => {
        const { readRecord } = boot();
        const answer = await readRecord(
            { zebra: '1', alpha: '2', select: 'title' },
            { object: 'task', id: '1' },
        );
        expectRefusal(answer, DATA_RECORD_READ_PARAMS, 'alpha', 'zebra');
    });

    it('PRESERVATION: select and expand still reach getData, verbatim', async () => {
        const { readRecord, getData } = boot();
        const answer = await readRecord(
            { select: 'title', expand: 'owner' },
            { object: 'task', id: '1' },
        );
        expect(answer.status).toBe(200);
        expect(getData).toHaveBeenCalledWith(
            expect.objectContaining({ object: 'task', id: '1', select: 'title', expand: 'owner' }),
        );
    });

    it('PRESERVATION: the repeated (array) arm of select/expand still flows through', async () => {
        // `?select=a&select=b` is ALREADY correct end to end here (#6877's
        // measured verdict — `getData` splits the comma form itself and takes
        // an array). Recognition must not have quietly flattened or refused it.
        const { readRecord, getData } = boot();
        const answer = await readRecord(
            { select: ['id', 'title'] },
            { object: 'task', id: '1' },
        );
        expect(answer.status).toBe(200);
        expect(getData).toHaveBeenCalledWith(
            expect.objectContaining({ select: ['id', 'title'] }),
        );
    });

    it('PRESERVATION: a bare read with no parameters is untouched', async () => {
        const { readRecord, getData } = boot();
        const answer = await readRecord({}, { object: 'task', id: '1' });
        expect(answer.status).toBe(200);
        expect(getData).toHaveBeenCalledTimes(1);
    });

    it('every name in the declared set is accepted — asserted against the export', async () => {
        for (const name of DATA_RECORD_READ_PARAMS) {
            const { readRecord } = boot();
            const answer = await readRecord({ [name]: 'x' }, { object: 'task', id: '1' });
            expect(answer.status, `"${name}" is declared supported but was refused`).toBe(200);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /data/:object/export — closed set of ten, one of them invisible
// ─────────────────────────────────────────────────────────────────────────────

describe('#7606 §2 — GET /data/:object/export', () => {
    it('an unknown parameter is refused and NOTHING is streamed', async () => {
        const { exportRows, findData } = boot();
        const answer = await exportRows({ format: 'csv', pageSize: '10' });
        expectRefusal(answer, DATA_EXPORT_PARAMS, 'pageSize');
        expect(
            findData,
            'a refusal must land before the first chunk — a dribbled row ahead of the '
            + 'status code is how a caller ends up with a truncated export',
        ).not.toHaveBeenCalled();
        expect(answer.chunks).toBe('');
    });

    it('the message lists every supported name, so the request is fixable from the response', async () => {
        const { exportRows } = boot();
        const { body } = await exportRows({ colums: 'id' });
        const message = String(body?.error?.message);
        expect(message).toContain('"colums"');
        for (const name of DATA_EXPORT_PARAMS) {
            expect(message, `supported parameter "${name}" must appear in the refusal`)
                .toContain(name);
        }
    });

    it('PRESERVATION: ?locale= survives — the name the handler body never mentions', async () => {
        // THE regression this file exists to prevent. `locale` is read one
        // frame down by `extractLocale` behind `translateMetaItem`, so a closed
        // set measured from the handler alone omits it — and every localised
        // export that works today would start answering 400. A measurement is
        // not finished until the helpers the handler calls have been read.
        const { exportRows, findData } = boot();
        const answer = await exportRows({ format: 'csv', locale: 'zh-CN' });
        expect(
            answer.status,
            '?locale= is read via extractLocale and MUST be inside the closed set',
        ).toBe(200);
        expect(findData).toHaveBeenCalled();
    });

    it('PRESERVATION: limit and page reach findData — forgetting them is a loud outage', async () => {
        // Both land on the SAME derived value — the chunk the read asks for is
        // `min(page, limit - exported)` — so the two are separated by choosing
        // which one is the smaller. Asserting the value rather than the status
        // is what makes this a preservation pin: `limit` silently dropped
        // exports the whole table with a perfectly ordinary 200.

        // `limit` is the binding cap here (25 < 100), so $top proves IT arrived.
        const capped = boot();
        const byLimit = await capped.exportRows({ format: 'csv', limit: '25', page: '100' });
        expect(byLimit.status).toBe(200);
        expect((capped.findData.mock.calls[0][0] as any)?.query?.$top).toBe(25);

        // `page` is the binding cap here (50 < 200), so $top proves IT arrived
        // — a default chunk would have read 500.
        const chunked = boot();
        const byPage = await chunked.exportRows({ format: 'csv', limit: '200', page: '50' });
        expect(byPage.status).toBe(200);
        expect((chunked.findData.mock.calls[0][0] as any)?.query?.$top).toBe(50);
    });

    it('PRESERVATION: the row-selection axes still narrow the export', async () => {
        const { exportRows, findData } = boot();
        const answer = await exportRows({
            format: 'json',
            filter: JSON.stringify({ title: 'alpha' }),
            search: 'alpha',
            searchFields: 'title',
            orderby: 'title:desc',
            fields: 'id,title',
            header: 'false',
        });
        expect(answer.status).toBe(200);
        expect(findData).toHaveBeenCalled();
        const arg = findData.mock.calls[0][0] as any;
        const q = arg?.query ?? arg;
        // The filter the caller expressed must be the one that ran — a dropped
        // filter exports MORE rows than asked for, indistinguishable from a
        // genuinely broad match.
        expect(JSON.stringify(q)).toContain('alpha');
    });

    it('every name in the declared set is accepted — asserted against the export', async () => {
        // A VALID value per name, so a 400 in this loop can only mean "the
        // recognition gate refused it" and never "the value was unusable" —
        // `filter` in particular is parsed as JSON and would 400 on `'x'` for
        // a reason that has nothing to do with the closed set.
        const validValue: Record<string, string> = {
            filter: JSON.stringify({ title: 'alpha' }),
            orderby: 'title:desc',
            limit: '10',
            page: '500',
            header: 'true',
            format: 'csv',
        };
        for (const name of DATA_EXPORT_PARAMS) {
            const { exportRows } = boot();
            const answer = await exportRows({ format: 'csv', [name]: validValue[name] ?? 'title' });
            expect(
                answer.status,
                `"${name}" is declared supported but was refused: `
                + JSON.stringify(answer.body),
            ).toBe(200);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /search — closed set {q, query, objects, limit, perObject}
// ─────────────────────────────────────────────────────────────────────────────

describe('#7606 §3 — GET /search', () => {
    it('an unknown scope parameter is refused instead of fanning out over everything', async () => {
        // The widening case at its worst: `?object=lead` (singular — the
        // plausible misspelling of `objects`) searched EVERY object while the
        // caller believed they had scoped it to one.
        const { search, searchAll } = boot();
        const answer = await search({ q: 'acme', object: 'lead' });
        expectRefusal(answer, GLOBAL_SEARCH_PARAMS, 'object');
        expect(
            searchAll,
            'the unscoped search must not have run — its result is shaped exactly '
            + 'like a correctly scoped one',
        ).not.toHaveBeenCalled();
    });

    it('every plausible misspelling of the same question fails the same way', async () => {
        for (const name of ['object', 'types', 'scope', 'Objects', 'per_object']) {
            const { search, searchAll } = boot();
            const answer = await search({ q: 'acme', [name]: 'lead' });
            expectRefusal(answer, GLOBAL_SEARCH_PARAMS, name);
            expect(searchAll).not.toHaveBeenCalled();
        }
    });

    it('PRESERVATION: the scope, both term spellings and both caps reach searchAll', async () => {
        const { search, searchAll } = boot();
        const answer = await search({
            q: 'acme', objects: 'lead,account', limit: '20', perObject: '5',
        });
        expect(answer.status).toBe(200);
        expect(searchAll).toHaveBeenCalledWith(expect.objectContaining({
            q: 'acme',
            objects: ['lead', 'account'],
            limit: 20,
            perObject: 5,
        }));
    });

    it('PRESERVATION: the `query` fallback spelling of the term still works', async () => {
        const { search, searchAll } = boot();
        const answer = await search({ query: 'acme' });
        expect(answer.status).toBe(200);
        expect(searchAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' }));
    });

    it('PRESERVATION: the multi-valued arm of objects is not flattened', async () => {
        // `objects` is deliberately absent from the route's multiplicity
        // declaration — a cross-object search over a LIST is the whole point.
        const { search, searchAll } = boot();
        const answer = await search({ q: 'acme', objects: ['lead', 'account'] });
        expect(answer.status).toBe(200);
        expect(searchAll).toHaveBeenCalledWith(expect.objectContaining({
            objects: ['lead', 'account'],
        }));
    });

    it('every name in the declared set is accepted — asserted against the export', async () => {
        for (const name of GLOBAL_SEARCH_PARAMS) {
            const { search } = boot();
            const answer = await search({ [name]: 'x' });
            expect(answer.status, `"${name}" is declared supported but was refused`).toBe(200);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. COMPOSITION — two guards on one request must have ONE defined answer
// ─────────────────────────────────────────────────────────────────────────────

describe('#7606 §4 — how the recognition and arity guards compose', () => {
    it('an UNKNOWN parameter outranks a repeated known one, on both tiered routes', async () => {
        // "I do not know this parameter" is the more fundamental error, so it
        // is the one the caller is told about. Pinned rather than left to the
        // order the two calls happen to sit in.
        const exp = boot();
        expectRefusal(
            await exp.exportRows({ bogus: '1', limit: ['1', '2'] }),
            DATA_EXPORT_PARAMS, 'bogus',
        );
        expect(exp.findData).not.toHaveBeenCalled();

        const srch = boot();
        expectRefusal(
            await srch.search({ bogus: '1', q: ['a', 'b'] }),
            GLOBAL_SEARCH_PARAMS, 'bogus',
        );
        expect(srch.searchAll).not.toHaveBeenCalled();
    });

    it('a request that is BOTH unknown AND repeated on the SAME name answers once', async () => {
        // One request, one response — never a refusal racing a second refusal.
        const { exportRows } = boot();
        const answer = await exportRows({ bogus: ['1', '2'] });
        expectRefusal(answer, DATA_EXPORT_PARAMS, 'bogus');
    });

    it('both guards answer ONE envelope, so composing them adds no dialect', async () => {
        const { exportRows } = boot();
        const unknown = await exportRows({ bogus: '1' });
        const repeated = await exportRows({ format: ['csv', 'json'] });
        // Same status, same nested position, same code — two flavours of "this
        // request is malformed", one machine-readable answer shape.
        expect(unknown.status).toBe(400);
        expect(repeated.status).toBe(400);
        expect(unknown.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(repeated.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('⛔ #8001 is left exactly where it was — a repeated ?filter= still answers as before', async () => {
        // `filter` is INSIDE the export route's closed set, so recognition
        // passes it through and the multiplicity gate still answers it. The
        // divergence #8001 records (this route's VALIDATION_ERROR vs the LIST
        // route's INVALID_FILTER, by the #7390 maintainer ruling) is neither
        // widened nor resolved here — that is the maintainer's call, and this
        // test goes red if a later change makes it unilaterally.
        const { exportRows } = boot();
        const answer = await exportRows({ filter: ['{"a":1}', '{"b":2}'] });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.code).not.toBe('INVALID_FILTER');
        expect(String(answer.body?.error?.message)).toContain('at most once');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE EXCLUSION — GET /data/:object must NOT be closed
// ─────────────────────────────────────────────────────────────────────────────

describe('#7606 §5 — the record LIST route is deliberately left open', () => {
    it('an unrecognised name still reaches findData as an implicit field filter', async () => {
        // ⛔ The one route in this family that must NOT get the recognition
        // gate. Its handler hands the WHOLE query record to `findData`, whose
        // normalizer lowers every leftover key into an implicit field-equality
        // predicate — `?status=open` IS the filter. The valid names are the
        // object's own fields (including the audit/tenant/owner columns the
        // registry injects), so a closed list here could only ever be wrong.
        // The authority for the name lives one layer down: #4134 / #7534 refuse
        // an unknown FIELD with 400 INVALID_FIELD, against the real field map.
        //
        // This test fails the moment someone "completes the sweep" by adding
        // the gate here — which would break every implicit filter on the
        // platform's most-used read route.
        const { listRecords, findData } = boot();
        const answer = await listRecords({ not_a_declared_param: 'x' });

        expect(
            answer.status,
            'GET /data/:object must NOT carry the closed-set gate — an unrecognised '
            + 'name here is an implicit FIELD filter, judged one layer down by #4134',
        ).toBe(200);
        expect(findData).toHaveBeenCalledTimes(1);
        // The name must reach the normalizer intact, since that is the only
        // layer holding the object's real field map.
        const arg = findData.mock.calls[0][0] as any;
        expect(arg?.query).toMatchObject({ not_a_declared_param: 'x' });
    });

    it('the ordinary implicit field filter still works — the capability being protected', async () => {
        const { listRecords, findData } = boot();
        const answer = await listRecords({ status: 'open', limit: '10' });
        expect(answer.status).toBe(200);
        expect((findData.mock.calls[0][0] as any)?.query)
            .toMatchObject({ status: 'open', limit: '10' });
    });

    it('#7390\'s repeated-filter refusal on this route is untouched', async () => {
        // The serial constraint: PR #8004 landed `400 INVALID_FILTER` here for
        // a repeated `?filter=`. This card must not undo or reroute it, and
        // since the recognition gate never runs on this route the two guards
        // never meet on one request.
        const { listRecords, findData } = boot();
        const answer = await listRecords({ filter: ['{"a":1}', '{"b":2}'] });
        expect(answer.status).toBe(400);
        // Flat `mapDataError` envelope, per the #7390 ruling — NOT the nested
        // VALIDATION_ERROR the recognition gate answers elsewhere.
        expect(answer.body?.code).toBe('INVALID_FILTER');
        expect(findData).not.toHaveBeenCalled();
    });
});
