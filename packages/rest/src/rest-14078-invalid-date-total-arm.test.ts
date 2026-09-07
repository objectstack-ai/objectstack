// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14078] The two `@objectstack/rest` arms of the shared canonical-ISO
 * spelling are TOTAL — an Invalid `Date` is served as the visible text
 * `"Invalid Date"`, never as a `RangeError` at the serialisation seam.
 *
 * ## The defect
 *
 * `canonicalIsoStamp` (the import-job DTO) and `formatCsvCell` (the export
 * writer) both reached `value.toISOString()` for ANY `Date`, and that call
 * raises `RangeError: Invalid time value` for the one `Date` whose time value
 * is `NaN`. Both are READ paths, so the loudness landed as a 500 the operator
 * cannot trace to a row — where the spelling both repairs replaced,
 * `String(value)`, had served the text `"Invalid Date"` in the cell.
 *
 * ## Reachability is measured, not argued
 *
 * PR #14409 (landed `3ecb7dc1a`) drove both live client libraries: mysql2
 * 3.23.1 returns a module constant literally named `INVALID_DATE` for a zero
 * `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in
 * 275760..294276 — a range Postgres itself stores. The maintainer ruled option
 * B on 2026-09-02, on all five arms of the shared spelling at once.
 *
 * ## Why the terminal value here is the TEXT, not `undefined`
 *
 * The ruling sets it per call site: visible text where the field is required
 * and an operator reads it. Both arms here are that case, and the declared
 * contracts are what prove it rather than intuition —
 * `ImportJobProgressSchema.createdAt` is a REQUIRED **plain** `z.string()`
 * (`packages/spec/src/api/export.zod.ts`), not `z.string().datetime()`, so the
 * text satisfies the contract and reaches the operator watching the job; a CSV
 * cell has no schema at all and is read by a human in a spreadsheet. ⛔ Not a
 * blanket `''`: a silent blank is the shape that hides the producer's bug —
 * and in the CSV case it is what `JSON.stringify` would have produced anyway
 * (`Date.prototype.toJSON` answers `null` for an Invalid `Date`), which is
 * exactly why that arm needs its own guard rather than a fall-through.
 *
 * ## Both CSV paths land on the same arm
 *
 * With field metadata, a `datetime` cell goes through `export-format.ts`'s
 * `formatDate`, whose `toDate` helper REJECTS an Invalid `Date` and returns
 * the value unchanged — so the raw path and the formatted path both hand the
 * `Date` to `formatCsvCell`. §B drives both.
 *
 * ## What makes these cases non-vacuous
 *
 * Every case proves its planted value is a `Date` with a `NaN` time value and
 * evaluates the OLD arm's expression on that same object, asserting it raises
 * `RangeError`. §C is the discrimination limb: a valid `Date` is still
 * canonicalised and a canonical string is still a fixed point, so a guard that
 * had simply disabled the arm it guards cannot pass.
 *
 * ⛔ No driver dependency: the shape under test is the one a SQLite-backed
 * engine cannot produce, and that unreachability is what hid the family of
 * defects this card closes. The read door is stubbed, deliberately, exactly as
 * the #13994 sibling in this package argues.
 */

import { describe, it, expect } from 'vitest';
import { ImportJobProgressSchema, ImportJobSummarySchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

/** Canonical ISO-8601 UTC with milliseconds — what the DTO contract promises. */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The rendering the pre-repair spelling produced for this shape. */
const INVALID_TEXT = 'Invalid Date';

const CREATED = '2026-08-30T10:19:25.947Z';
const STARTED = '2026-08-30T10:20:31.001Z';

/**
 * The removed guard, reproduced: the OLD arm's expression on the very object
 * a case plants. Red here means the fixture is no longer the contested shape
 * and every assertion around it would be vacuous.
 */
function assertOldSpellingWouldThrow(value: Date): void {
    expect(value, 'fixture degraded — not a Date').toBeInstanceOf(Date);
    expect(Number.isNaN(value.getTime()), 'fixture is a VALID Date — case is vacuous').toBe(true);
    expect(() => value.toISOString()).toThrow(RangeError);
}

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const chunks: string[] = [];
    const res: any = {
        write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
        end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return { res, chunks };
}

/** The REAL routes, over a protocol whose read door returns exactly `rows`. */
function boot(rows: unknown[], schema?: unknown) {
    const protocol: Record<string, unknown> = {
        findData: async () => ({ records: rows }),
    };
    if (schema) protocol.getMetaItem = async () => ({ item: schema });
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const routes = rest.getRoutes();
    const find = (method: string, path: string) => routes.find((r: any) => r.method === method && r.path === path);
    return {
        progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
        list: find('GET', '/api/v1/data/import/jobs'),
        exportRoute: find('GET', '/api/v1/data/:object/export'),
    };
}

function importJobRow(stamp: unknown): Record<string, unknown> {
    return {
        id: 'imp_14078', object_name: 'task', status: 'succeeded',
        dry_run: false, write_mode: 'insert',
        total_rows: 1, processed_rows: 1,
        created_count: 1, updated_count: 0, skipped_count: 0, error_count: 0,
        created_at: stamp,
        started_at: STARTED,
    };
}

async function callJson(route: any, req: any = {}) {
    const { res } = makeRes();
    await route.handler({ params: { jobId: 'imp_14078' }, query: {}, ...req } as any, res);
    return (res as any)._json;
}

async function callCsv(route: any, rowKeys: Record<string, unknown>) {
    const { res, chunks } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv', ...rowKeys } } as any, res);
    return chunks.join('');
}

describe('[#14078] §A canonicalIsoStamp — the import-job DTO serves text, not a 500', () => {
    it('renders `Invalid Date` for a required stamp and still satisfies the declared contract', async () => {
        const bad = new Date(NaN);
        assertOldSpellingWouldThrow(bad);

        const body = await callJson(boot([importJobRow(bad)]).progress);

        expect(body.createdAt).toBe(INVALID_TEXT);
        // The rendering is the pre-repair spelling's own, not a literal
        // invented here: `String(new Date(NaN))` is `"Invalid Date"`.
        expect(body.createdAt).toBe(String(bad));
        // ⛔ The blank the ruling forbids by name.
        expect(body.createdAt).not.toBe('');

        // The contract — `createdAt` is a REQUIRED plain `z.string()`, which is
        // precisely why the visible text is servable at THIS call site.
        const parsed = ImportJobProgressSchema.safeParse(body);
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);

        // The good stamp beside it is untouched — one bad column does not take
        // the row down with it.
        expect(body.startedAt).toBe(STARTED);
    });

    it('serves the summary (list) DTO the same way', async () => {
        const bad = new Date(NaN);
        assertOldSpellingWouldThrow(bad);

        const body = await callJson(boot([importJobRow(bad)]).list);
        const [job] = body.jobs;

        expect(job.createdAt).toBe(INVALID_TEXT);
        expect(ImportJobSummarySchema.safeParse(job).success).toBe(true);
    });
});

describe('[#14078] §B formatCsvCell — the export writer emits the cell an operator reads', () => {
    const TASK_SCHEMA = { name: 'task', fields: { id: { type: 'text', label: 'ID' }, due: { type: 'datetime', label: '截止' } } };

    it('writes `Invalid Date` on the RAW path (no field metadata)', async () => {
        const bad = new Date(NaN);
        assertOldSpellingWouldThrow(bad);

        const csv = await callCsv(boot([{ id: '1', due: bad }]).exportRoute, {});

        expect(csv).toContain(INVALID_TEXT);
        // The whole file, not a fragment: header + one data row, and the cell
        // is exactly the text — never a blank cell, never `null`.
        expect(csv.split('\r\n').filter((l) => l.length > 0).at(-1)).toBe(`1,${INVALID_TEXT}`);
    });

    it('writes `Invalid Date` on the FORMATTED path too (declared `datetime` field)', async () => {
        const bad = new Date(NaN);
        assertOldSpellingWouldThrow(bad);

        const csv = await callCsv(boot([{ id: '1', due: bad }], TASK_SCHEMA).exportRoute, {});

        // `formatDate` -> `toDate` rejects an Invalid `Date` and returns the
        // value UNCHANGED, so this path reaches the same arm.
        const lines = csv.split('\r\n').filter((l) => l.length > 0);
        expect(lines[0]).toBe('ID,截止');
        expect(lines[1]).toBe(`1,${INVALID_TEXT}`);
    });

    it('⛔ is NOT the `JSON.stringify` arm — that would have written a blank the ruling forbids', async () => {
        const bad = new Date(NaN);
        // The arm the value would have fallen into without its own guard:
        // `toJSON()` answers null for an Invalid `Date`.
        expect(JSON.stringify(bad)).toBe('null');
        expect(bad.toJSON()).toBeNull();

        const csv = await callCsv(boot([{ id: '1', due: bad }]).exportRoute, {});
        expect(csv).not.toContain('null');
    });
});

describe('[#14078] §C the guards discriminate — the arms they guard still work', () => {
    it('canonicalises a VALID Date in the DTO, byte-exactly', async () => {
        const good = new Date(CREATED);
        const body = await callJson(boot([importJobRow(good)]).progress);

        expect(body.createdAt).toBe(CREATED);
        expect(body.createdAt).toMatch(CANONICAL_ISO);
        expect(ImportJobProgressSchema.safeParse(body).success).toBe(true);
    });

    it('leaves an already-canonical string a fixed point in the DTO', async () => {
        const body = await callJson(boot([importJobRow(CREATED)]).progress);
        expect(body.createdAt).toBe(CREATED);
    });

    it('canonicalises a VALID Date in a CSV cell, byte-exactly', async () => {
        const good = new Date(CREATED);
        const csv = await callCsv(boot([{ id: '1', due: good }]).exportRoute, {});
        expect(csv.split('\r\n').filter((l) => l.length > 0).at(-1)).toBe(`1,${CREATED}`);
    });

    it('still writes an empty cell for an absent value — that meaning is unchanged', async () => {
        const csv = await callCsv(boot([{ id: '1', due: null }]).exportRoute, {});
        expect(csv.split('\r\n').filter((l) => l.length > 0).at(-1)).toBe('1,');
    });
});
