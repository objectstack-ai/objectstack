// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29156] `POST /analytics/dataset/query` judges its OUTER body, not only
 * `selection`.
 *
 * The defect: the handler read `selection`, `previewDrafts`, `dataset` and
 * `datasetName` off the body and ignored every other key. A `runtimeFilter`
 * placed beside `selection` instead of inside it answered 200 with the
 * UNFILTERED aggregate — a predicate silently dropped, a wider number on the
 * dashboard, and nothing in the answer to tell it apart from a filter that
 * matched everything. A bare `bogus: 1` answered 200 too. Meanwhile the sibling
 * door (`POST /analytics/query`) refuses an unknown key, and this door's own
 * `selection` refuses one with a "did you mean" hint: one family, two postures.
 *
 * Pinned here, through the REAL route (the harness `analytics-routes.test.ts`
 * and `analytics-dataset-selection-door.test.ts` use), both halves:
 *
 * - **Refusal** — status, `code`, the named key(s) and the remedy, AND the
 *   analytics service was never called (a refusal that still ran the query
 *   would be the defect with a different status line).
 * - **Preservation** — every key the door reads keeps working, and the service
 *   receives exactly the arguments it received before.
 *
 * And the one ambiguity the outer body could still carry: `dataset` beside
 * `datasetName`, where the inline definition used to win without a word.
 */

// Paid at module scope so the first load lands during collection, not inside
// a clocked window (`pnpm check:test-source-alias`).
import '@objectstack/spec/api';
import '@objectstack/spec/data';
import '@objectstack/spec/ui';

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// ── harness ──────────────────────────────────────────────────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

const inlineDataset = {
    name: 'sales',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

function mockProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        // A saved dataset by the inline one's name, so `datasetName` resolves.
        getMetaItems: vi.fn().mockResolvedValue({ items: [inlineDataset] }),
    };
}

function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.end = vi.fn(() => res);
    return res;
}

/** POST a body through the REAL route; returns the response and both doubles. */
async function post(body: unknown) {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const protocol = mockProtocol();
    const rest = new RestServer(
        mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        async () => ({ queryDataset }),
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
    expect(route, 'POST …/analytics/dataset/query must be registered').toBeTruthy();
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, query: {}, body } as any, res);
    return { res, queryDataset, getMetaItems: protocol.getMetaItems };
}

const selection = { dimensions: ['region'], measures: ['revenue'] };
const runtimeFilter = { region: 'NA' };

type FieldEntry = { field: string; code: string; message: string };

/** The refusal half: status, code, named keys, and the service never ran. */
function expectUnknownKeyRefusal(
    out: Awaited<ReturnType<typeof post>>,
    keys: string[],
): { message: string; fields: FieldEntry[] } {
    const { res, queryDataset } = out;
    expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const message = String(res.body.message);
    expect(message.startsWith(`Unrecognized key(s) on this dataset query: \`${keys[0]}\``), message).toBe(true);
    // Every key named, in the sorted order the field entries carry.
    const at = keys.map((k) => message.indexOf(`\`${k}\``));
    expect(at.every((i) => i > 0), message).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const fields: FieldEntry[] = res.body.details?.fields ?? [];
    expect(fields.map((f) => f.field)).toEqual(keys);
    for (const f of fields) expect(f.code).toBe('unknown_field');
    expect(queryDataset).not.toHaveBeenCalled();
    return { message, fields };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the refusals (each one answered 200 before #29156)
// ─────────────────────────────────────────────────────────────────────────────

describe('#29156 §1 — an unknown top-level key is refused, the query never runs', () => {
    it('a top-level `runtimeFilter` (saved dataset) → 400 naming it, remedy `selection.runtimeFilter`', async () => {
        const out = await post({ datasetName: 'sales', selection, runtimeFilter });
        const { fields } = expectUnknownKeyRefusal(out, ['runtimeFilter']);
        expect(fields[0].message).toContain('did you mean `selection.runtimeFilter`?');
    });

    it('a top-level `runtimeFilter` (inline dataset) → the same refusal', async () => {
        const out = await post({ dataset: inlineDataset, selection, runtimeFilter });
        const { message } = expectUnknownKeyRefusal(out, ['runtimeFilter']);
        expect(message).toContain('did you mean `selection.runtimeFilter`?');
    });

    for (const key of ['filter', 'filters', 'where'] as const) {
        it(`a top-level \`${key}\` → 400, remedy \`selection.runtimeFilter\``, async () => {
            const out = await post({ datasetName: 'sales', selection, [key]: runtimeFilter });
            const { fields } = expectUnknownKeyRefusal(out, [key]);
            expect(fields[0].message).toContain('did you mean `selection.runtimeFilter`?');
        });
    }

    it('a misplaced selection member (`dimensions` beside `selection`) → remedy `selection.dimensions`', async () => {
        const out = await post({ datasetName: 'sales', selection: { measures: ['revenue'] }, dimensions: ['region'] });
        const { fields } = expectUnknownKeyRefusal(out, ['dimensions']);
        expect(fields[0].message).toContain('did you mean `selection.dimensions`?');
    });

    it('`bogus: 1` beside a valid selection → 400 naming `bogus`, with no invented remedy', async () => {
        const out = await post({ datasetName: 'sales', selection, bogus: 1 });
        const { fields } = expectUnknownKeyRefusal(out, ['bogus']);
        expect(fields[0].message).not.toContain('did you mean');
    });

    it('several unknown keys are all named, sorted, one field entry each', async () => {
        const out = await post({ datasetName: 'sales', selection, zeta: 1, runtimeFilter, bogus: true });
        expectUnknownKeyRefusal(out, ['bogus', 'runtimeFilter', 'zeta']);
    });

    it('the message lists the keys the body does take, so the caller can fix it from the answer', async () => {
        const out = await post({ datasetName: 'sales', selection, bogus: 1 });
        const { message } = expectUnknownKeyRefusal(out, ['bogus']);
        for (const k of ['dataset', 'datasetName', 'previewDrafts', 'selection']) expect(message).toContain(`\`${k}\``);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the ambiguous body: `dataset` AND `datasetName`
// ─────────────────────────────────────────────────────────────────────────────

describe('#29156 §2 — `dataset` beside `datasetName` is refused instead of the inline one winning silently', () => {
    it('both supplied → 400 VALIDATION_FAILED naming both; no lookup, no query', async () => {
        const { res, queryDataset, getMetaItems } = await post({ dataset: inlineDataset, datasetName: 'sales', selection });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const message = String(res.body.message);
        expect(message).toContain('`dataset`');
        expect(message).toContain('`datasetName`');
        const fields: FieldEntry[] = res.body.details?.fields ?? [];
        expect(fields.map((f) => f.field)).toEqual(['dataset', 'datasetName']);
        expect(queryDataset).not.toHaveBeenCalled();
        expect(getMetaItems).not.toHaveBeenCalled();
    });

    // The handler's branch reads both keys by truthiness, so a falsy name was
    // never a name: `dataset` beside it ran inline, and still does.
    for (const datasetName of ['', null] as const) {
        it(`CONTROL: \`dataset\` beside a falsy \`datasetName\` (${JSON.stringify(datasetName)}) still runs inline, as it did`, async () => {
            const { res, queryDataset, getMetaItems } = await post({ dataset: inlineDataset, datasetName, selection });
            expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
            expect(queryDataset).toHaveBeenCalledTimes(1);
            expect(queryDataset.mock.calls[0][0].measures[0].name).toBe('revenue');
            expect(getMetaItems).not.toHaveBeenCalled();
        });
    }

    it('CONTROL: a null `dataset` beside `datasetName` still runs the saved dataset, as it did', async () => {
        const { res, queryDataset } = await post({ dataset: null, datasetName: 'sales', selection });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
        expect(queryDataset.mock.calls[0][0].name).toBe('sales');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — preservation: every key the door reads keeps working exactly as before
// ─────────────────────────────────────────────────────────────────────────────

describe('#29156 §3 — CONTROLS: every key the door reads is served, and reaches the service unchanged', () => {
    it('`{ datasetName, selection }` → 200; the service receives the caller\'s selection', async () => {
        const { res, queryDataset } = await post({ datasetName: 'sales', selection });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
        expect(queryDataset.mock.calls[0][0].name).toBe('sales');
        expect(queryDataset.mock.calls[0][1]).toEqual(selection);
    });

    it('`{ dataset, selection }` (inline) → 200', async () => {
        const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(queryDataset.mock.calls[0][0].measures[0].name).toBe('revenue');
        expect(queryDataset.mock.calls[0][1]).toEqual(selection);
    });

    it('`selection.runtimeFilter` (the right place) → 200, and the filter reaches the service', async () => {
        const withFilter = { ...selection, runtimeFilter };
        const { res, queryDataset } = await post({ datasetName: 'sales', selection: withFilter });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(queryDataset.mock.calls[0][1]).toEqual(withFilter);
        expect(queryDataset.mock.calls[0][1].runtimeFilter).toEqual(runtimeFilter);
    });

    it('`previewDrafts` is a key the door reads → 200', async () => {
        const { res, queryDataset } = await post({ datasetName: 'sales', selection, previewDrafts: true });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
    });

    it('the selection-level refusal is unchanged (an unknown key INSIDE `selection`)', async () => {
        const { res, queryDataset } = await post({ datasetName: 'sales', selection: { ...selection, bogus: 1 } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(String(res.body.message)).toContain('Invalid dataset selection');
        expect(queryDataset).not.toHaveBeenCalled();
    });

    it('a body with neither `dataset` nor `datasetName` keeps its own message', async () => {
        const { res } = await post({ selection });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Provide body.dataset (inline) or body.datasetName.');
    });
});
