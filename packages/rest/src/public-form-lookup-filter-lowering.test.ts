// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16581] `GET /forms/:slug/lookup/:field` answers a SEARCH, not a 400.
 *
 * ## The defect
 *
 * The route composed its filter list out of `ViewFilterRule` objects — the
 * `{ field, operator, value }` dialect `FormFieldPublicPickerSchema.filter`
 * declares in so many words ("Same `{ field, operator, value }` dialect as
 * list-view filters") — and put them on the `findData` filter slot, which
 * accepts a `FilterCondition` object or a `FilterArray` and refuses everything
 * else with `400 INVALID_FILTER`. ⭐ The `q` branch builds the SAME object shape
 * itself, so the refusal did not depend on an author declaring
 * `publicPicker.filter`: every non-empty search 400'd, and only the degenerate
 * empty-filter call could succeed. That is the endpoint's entire purpose, on an
 * anonymous surface an applicant has no way around.
 *
 * ## Why this file exists next to `public-form-lookup-picker.test.ts`
 *
 * That suite stubs `findData` and pins the route's request COMPOSITION, so it
 * could never have met the ingress's verdict on the value it composed — which
 * is exactly how a route shipped for this long building a filter nothing would
 * parse. Here the protocol's `findData` is the REAL
 * `ObjectStackProtocolImplementation`, so the request crosses the same
 * normalizer a served deployment uses and the assertions are on the ANSWER
 * (status and rows), not on the source this card wrote.
 *
 * ## ⭐ §3 is the discriminating control and is not optional
 *
 * "The route lowers correctly" and "the parser was loosened" produce the same
 * green in §1 and §2 and have opposite consequences. §3 keeps the card's own
 * control pair — the object shape and the triple shape, fed to the ingress
 * DIRECTLY through `GET /data/:object`'s `$filter` — and asserts the object
 * shape is still refused. ⛔ Never delete or "repair" §3 to make a change pass:
 * a green §1/§2 means nothing without it. (`rest-server-canonical-query-ast.ts`'s
 * §3 CONTROL pins the same fact from its own frozen literal; two independent
 * pins, deliberately.)
 */

import { describe, expect, it, vi } from 'vitest';
// The engine-double contract (#4434 / #5619): a fake engine's update/delete
// must be exactly as strict as ObjectQL's dispatch, or a dead route ships with
// its suite green. Both predicates live in metadata-core.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

// ─── the fixture: the card's own shape (an anonymous job-application form) ───

const JOBS = [
    { id: 'job_1', title: 'Senior software engineer', city: 'Berlin', status: 'published' },
    { id: 'job_2', title: 'Lead engineer', city: 'Lisbon', status: 'draft' },
    { id: 'job_3', title: 'Product designer', city: 'Berlin', status: 'published' },
    { id: 'job_4', title: 'Staff engineer', city: 'Remote', status: 'published' },
];

const jobObject = {
    name: 'ats_job',
    label: 'Job',
    nameField: 'title',
    fields: {
        id: { name: 'id', type: 'text' },
        title: { name: 'title', type: 'text', label: 'Title' },
        city: { name: 'city', type: 'text', label: 'City' },
        status: { name: 'status', type: 'text', label: 'Status' },
    },
};

const applicationObject = {
    name: 'ats_application',
    label: 'Application',
    fields: {
        id: { name: 'id', type: 'text' },
        job: { name: 'job', type: 'lookup', reference: 'ats_job', label: 'Job' },
    },
};

/** The picker the card declares, verbatim. */
const PICKER_WITH_FILTER = {
    displayFields: ['title', 'city'],
    filter: [{ field: 'status', operator: 'equals', value: 'published' }],
};

/** The same picker with NO declared filter — the case that 400'd anyway. */
const PICKER_NO_FILTER = { displayFields: ['title', 'city'] };

const applyForm = (picker: unknown) => ({
    name: 'ats_application.apply',
    object: 'ats_application',
    viewKind: 'form',
    label: 'Apply',
    config: {
        type: 'simple',
        data: { provider: 'object', object: 'ats_application' },
        sharing: { allowAnonymous: true, publicLink: '/forms/apply' },
        sections: [{ label: 'Your application', fields: [{ field: 'job', publicPicker: picker }] }],
    },
});

// ─── the real save path, so the fixture is a form the spec ACCEPTS ──────────

/** The slice of the engine the `sys_metadata` write path touches. */
function metadataEngine() {
    const rows: Array<Record<string, any>> = [];
    let nextId = 0;
    return {
        rows,
        engine: {
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query); return null;
            },
            async find() { return rows.slice(); },
            async insert(table: string, data: Record<string, any>) {
                if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
                nextId += 1;
                rows.push({ id: `r_${nextId}`, ...data });
                return { id: `r_${nextId}` };
            },
            async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
                assertEngineUpdateDispatch(data, opts);
                return { id: null };
            },
            async delete(_t: string, opts: { where: Record<string, unknown> }) {
                assertEngineDeleteDispatch(opts);
                return { deleted: 0 };
            },
            registry: { registerItem: () => {}, registerObject: () => {}, listItems: () => [] },
        } as any,
    };
}

/**
 * Persist a view through the REAL `saveMetaItem` and return the stored body.
 * A 422 here would mean the picker fixture is not spec-valid, which would make
 * every route assertion below a statement about an unauthorable form.
 */
async function persistedBody(item: unknown): Promise<any> {
    const { engine, rows } = metadataEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const result = await protocol.saveMetaItem({ type: 'view', name: 'ats_application.apply', item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = rows.find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row').toBeDefined();
    return JSON.parse(row!.metadata);
}

// ─── the data engine: rows filtered by the condition that REALLY arrives ────

/**
 * Evaluate a lowered `FilterCondition` against a row.
 *
 * ⚠️ Deliberately tiny and deliberately LOUD. It implements exactly the three
 * comparisons this card's filters lower to and throws on anything else,
 * including an array — a filter still in the authoring dialect reaching a
 * driver is the defect itself, and a matcher that shrugged at it would let a
 * half-lowered filter pass as "the right rows". Case-sensitive `$contains`
 * follows the spec's split (`icontains` is the insensitive twin); which of the
 * two the route composes is #16581's business, not this matcher's.
 */
function matchesCondition(row: Record<string, unknown>, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    if (Array.isArray(cond)) {
        if (cond.length === 0) return true; // `[]` — "no filter", every path reads it so
        throw new Error(`an UNLOWERED filter reached the driver: ${JSON.stringify(cond)}`);
    }
    if (typeof cond !== 'object') throw new Error(`unexpected filter: ${JSON.stringify(cond)}`);
    for (const [key, expected] of Object.entries(cond as Record<string, unknown>)) {
        if (key === '$and') {
            if (!(expected as unknown[]).every((c) => matchesCondition(row, c))) return false;
            continue;
        }
        if (key === '$or') {
            if (!(expected as unknown[]).some((c) => matchesCondition(row, c))) return false;
            continue;
        }
        if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
            for (const [op, operand] of Object.entries(expected as Record<string, unknown>)) {
                if (op === '$eq') {
                    if (row[key] !== operand) return false;
                } else if (op === '$ne') {
                    if (row[key] === operand) return false;
                } else if (op === '$contains') {
                    if (!String(row[key] ?? '').includes(String(operand))) return false;
                } else {
                    throw new Error(`this suite's matcher does not implement "${op}"`);
                }
            }
            continue;
        }
        if (row[key] !== expected) return false; // implicit-equality form
    }
    return true;
}

/** The option bag `engine.find` last received, for the receipt assertions. */
type DataEngine = { engine: any; seen: () => Record<string, any> | undefined };

function dataEngine(): DataEngine {
    let seen: Record<string, any> | undefined;
    const objects: Record<string, unknown> = { ats_job: jobObject, ats_application: applicationObject };
    const engine = {
        registry: { getObject: (n: string) => objects[n] },
        find: async (object: string, options: Record<string, any>) => {
            seen = options;
            if (object !== 'ats_job') return [];
            const rows = JOBS.filter((r) => matchesCondition(r, options?.where));
            // Hold the caller's bound, AFTER the filter and by PRESENCE — a
            // limit-blind double reports a page size the engine never granted
            // (`check:objectql-double-limit`). The picker sends
            // `limit: maxResults`, so this is also the shape it really meets.
            return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
        },
        aggregate: async () => [],
        count: async () => 0,
    };
    return { engine, seen: () => seen };
}

// ─── the real routes over a REAL `findData` ─────────────────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}

/**
 * Mount the real routes. `getMetaItems` is stubbed (it serves the stored form
 * and the object definitions); `findData` is the REAL protocol's, bound to the
 * data engine above — so the filter this route composes crosses the real
 * ingress and the real lowering before any row is matched.
 */
function routesOver(storedView: any) {
    const { engine, seen } = dataEngine();
    const real = new ObjectStackProtocolImplementation(engine as never) as any;
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue(undefined),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [storedView];
            if (type === 'object') return [jobObject, applicationObject];
            return [];
        }),
        findData: (request: unknown) => real.findData(request),
    };
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = (method: string, suffix: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path.endsWith(suffix));
        if (!found) throw new Error(`route ${method} …${suffix} is not mounted`);
        return found as any;
    };
    return { seen, lookup: route('GET', '/forms/:slug/lookup/:field'), list: route('GET', '/data/:object') };
}

/** Drive the anonymous picker exactly as a browser does: no cookie, one `q`. */
async function lookup(storedView: any, q?: string) {
    const { lookup: route, seen } = routesOver(storedView);
    const res = mockRes();
    await route.handler({ params: { slug: 'apply', field: 'job' }, query: q === undefined ? {} : { q } } as any, res);
    return { status: res.statusCode, body: res.body, where: seen()?.where };
}

// ---------------------------------------------------------------------------
// §1 the `q` branch — the half that 400'd with NO declared filter at all
// ---------------------------------------------------------------------------

describe('[#16581] §1 the route lowers the search predicate it builds itself', () => {
    it('q=engineer answers 200 with the matching rows, not 400 INVALID_FILTER', async () => {
        // The card's headline call. Before the fix this was
        // `400 {"code":"INVALID_FILTER"}` — the route's own `{ field, operator:
        // 'contains', value: q }` row is the object dialect too, so no author
        // had to declare anything for the endpoint to be unusable.
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        const { status, body, where } = await lookup(stored, 'engineer');

        expect(status).toBe(200);
        expect(body.data).toEqual([
            { id: 'job_1', title: 'Senior software engineer', city: 'Berlin' },
            { id: 'job_2', title: 'Lead engineer', city: 'Lisbon' },
            { id: 'job_4', title: 'Staff engineer', city: 'Remote' },
        ]);
        // The receipt: what the ENGINE received is a lowered `FilterCondition`,
        // which is the only way the rows above could have been produced.
        expect(where).toEqual({ title: { $contains: 'engineer' } });
    });

    it('the degenerate empty search still answers 200 — the one call that always worked', async () => {
        // A guard, not a new capability: `filters: []` was the single shape the
        // ingress accepted before, and the lowering must not turn "no filter"
        // into `['and']`, a logical node with nothing to join that the ingress
        // refuses outright.
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        const { status, body, where } = await lookup(stored);

        expect(status).toBe(200);
        expect(body.data.map((r: any) => r.id)).toEqual(['job_1', 'job_2', 'job_3', 'job_4']);
        expect(where).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// §2 the declared `publicPicker.filter` branch, and the two composed
// ---------------------------------------------------------------------------

describe('[#16581] §2 the declared filter is lowered too, and ANDed ahead of the search', () => {
    it('the declared filter alone answers 200 and really restricts the rows', async () => {
        const stored = await persistedBody(applyForm(PICKER_WITH_FILTER));
        const { status, body, where } = await lookup(stored);

        expect(status).toBe(200);
        // `job_2` is `draft`: the declared pre-filter is APPLIED, not merely
        // accepted. On this surface that distinction is the security property —
        // the filter is what keeps an anonymous visitor inside the rows the form
        // is allowed to expose.
        expect(body.data.map((r: any) => r.id)).toEqual(['job_1', 'job_3', 'job_4']);
        expect(where).toEqual({ status: 'published' });
    });

    it('the declared filter AND the visitor search compose — the card\'s full combination', async () => {
        const stored = await persistedBody(applyForm(PICKER_WITH_FILTER));
        const { status, body, where } = await lookup(stored, 'engineer');

        expect(status).toBe(200);
        // `job_3` fails the search, `job_2` fails the declared filter: only rows
        // passing BOTH survive, which is what proves both branches lowered.
        expect(body.data).toEqual([
            { id: 'job_1', title: 'Senior software engineer', city: 'Berlin' },
            { id: 'job_4', title: 'Staff engineer', city: 'Remote' },
        ]);
        expect(where).toEqual({ $and: [{ status: 'published' }, { title: { $contains: 'engineer' } }] });
    });

    it('a legacy operator spelling in a STORED row folds through the spec\'s own normalizer', async () => {
        // `notEquals` is a `VIEW_FILTER_OPERATOR_ALIASES` row: authored today the
        // schema folds it on parse, but a row stored before that fold — and this
        // route reads STORED bodies, never re-parsed ones — still carries it.
        // The lowering reuses `normalizeFilterOperator`, the schema's own
        // preprocess, so the canonical spelling is what reaches the parser. ⛔ A
        // second alias table here is what that reuse exists to prevent.
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        stored.config.sections[0].fields[0].publicPicker.filter = [
            { field: 'status', operator: 'notEquals', value: 'draft' },
        ];
        const { status, body, where } = await lookup(stored);

        expect(status).toBe(200);
        expect(body.data.map((r: any) => r.id)).toEqual(['job_1', 'job_3', 'job_4']);
        expect(where).toEqual({ status: { $ne: 'draft' } });
    });

    it('an unreadable stored rule is FORWARDED, so the request is still refused — never served unfiltered', async () => {
        // The fail-closed direction, stated as a test because the tempting
        // repair is the opposite one. A row the lowering cannot read as a rule
        // is passed through and the ingress refuses the whole request; dropping
        // it would answer 200 over an UNFILTERED table on an anonymous surface —
        // a widening delivered silently by the code repairing a refusal.
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        stored.config.sections[0].fields[0].publicPicker.filter = [{ nonsense: true }];
        const { status, body } = await lookup(stored, 'engineer');

        expect(status).toBe(400);
        expect(body.code).toBe('INVALID_FILTER');
    });
});

// ---------------------------------------------------------------------------
// ⭐ §3 THE DISCRIMINATING CONTROL — the card's own control pair
// ---------------------------------------------------------------------------

describe('[#16581] §3 CONTROL: the parser was NOT loosened — the object shape still answers 400', () => {
    /** `GET /data/:object?$filter=…` on the same server, same ingress. */
    async function dataApi($filter: string) {
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        const { list } = routesOver(stored);
        const res = mockRes();
        await list.handler({ params: { object: 'ats_job' }, query: { $filter } } as any, res);
        return { status: res.statusCode, body: res.body };
    }

    it('the OBJECT shape fed straight to the parser is refused — 400 INVALID_FILTER', async () => {
        // ⭐ Without this assertion a green §1/§2 cannot be told apart from "the
        // parser was loosened to accept `ViewFilterRule` objects", which is the
        // repair the ruling excludes: it would maintain two filter grammars in
        // the data layer forever and spread the shape to every `findData`
        // caller. ⛔ Do not delete, weaken or "repair" this expectation.
        const { status, body } = await dataApi('[{"field":"status","operator":"equals","value":"published"}]');
        expect(status).toBe(400);
        expect(body.code).toBe('INVALID_FILTER');
        expect(body.error).toContain('is not a recognised filter shape');
    });

    it('…and the TRIPLE shape on the same call answers 200 — the pair attributes the failure to SHAPE', async () => {
        // The other half of the card's control: same server, same object, same
        // anonymity, only the filter's shape differs. That is what rules out
        // permissions, anonymity and every other part of the route as the cause.
        //
        // `records` is the key `findData` returns — this route hands its result
        // through untouched, which is also how the picker's own `data`/`items`
        // read was measured to match nothing (repaired in the same card).
        const { status, body } = await dataApi('[["status","=","published"]]');
        expect(status).toBe(200);
        expect(body.records.map((r: any) => r.id)).toEqual(['job_1', 'job_3', 'job_4']);
    });
});

// ---------------------------------------------------------------------------
// §4 the response the route READS back — the second half of "the right rows"
// ---------------------------------------------------------------------------

/**
 * The picker read `result.data ?? result.items` and never `result.records`,
 * which is the key `findData` returns (`{ object, records, total, hasMore }`)
 * and the order the file's three other read sites already use. So with the
 * filter lowered the route answered `200 {"data":[]}` — an empty picker for
 * every search, the same user-visible outcome as the 400 by a different route.
 *
 * It was invisible twice over: unreachable while every non-empty search 400'd,
 * and unreachable in `public-form-lookup-picker.test.ts`, whose `findData`
 * double answers `{ data: rows }` — a shape the real protocol does not produce.
 * A double that invents its subject's response shape cannot report that the
 * consumer reads the wrong key.
 */
describe('[#16581] §4 the projection reads `records`, the key `findData` actually returns', () => {
    it('rows survive the real response envelope — not 200 with an empty list', async () => {
        const stored = await persistedBody(applyForm(PICKER_WITH_FILTER));
        const { status, body } = await lookup(stored, 'engineer');

        expect(status).toBe(200);
        expect(body.total).toBe(2);
        expect(body.data.length).toBe(2);
    });

    it('the legacy `data` envelope a protocol double may answer with still works', async () => {
        // The aliases are kept, so the sibling suite's double and any alternate
        // protocol keep being read. Driven here rather than assumed.
        const stored = await persistedBody(applyForm(PICKER_NO_FILTER));
        const rest = new RestServer(mockServer() as any, {
            getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
            getMetaTypes: vi.fn().mockResolvedValue([]),
            getMetaItem: vi.fn().mockResolvedValue(undefined),
            getMetaItems: vi.fn(async ({ type }: { type: string }) => {
                if (type === 'view') return [stored];
                if (type === 'object') return [jobObject, applicationObject];
                return [];
            }),
            findData: vi.fn().mockResolvedValue({ data: [{ id: 'job_9', title: 'Legacy envelope', city: 'Oslo' }] }),
        } as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path.endsWith('/forms/:slug/lookup/:field'))!;
        const res = mockRes();
        await (route as any).handler({ params: { slug: 'apply', field: 'job' }, query: {} } as any, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ id: 'job_9', title: 'Legacy envelope', city: 'Oslo' }]);
    });
});
