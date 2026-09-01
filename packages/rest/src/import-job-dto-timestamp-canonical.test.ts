// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13994] The import-job DTO serves CANONICAL ISO-8601 for its four timestamp
 * fields, on every dialect and under every process timezone.
 *
 * ## The defect
 *
 * `importJobToProgress` rendered all four stamps through `String(v)`. On
 * Postgres and MySQL — the production default driver — those columns arrive as
 * JS `Date`s, so `String` ran `Date.prototype.toString` and the REST contract
 * served
 *
 *     "Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"
 *
 * where `ImportJobProgressSchema` promises `"2026-08-30T10:19:25.947Z"`:
 * milliseconds dropped, the SERVER's timezone baked in, no `Z`, and not
 * `Date.parse`-safe for a client doing strict ISO parsing.
 *
 * Why all four, and why nothing upstream repaired them: `formatOutput`'s two
 * timestamp repairs — the `AUDIT_TIMESTAMP_COLUMNS` pass (`created_at`) and the
 * `normalizeSqliteDatetimeOutput` pass over `datetimeFields`
 * (`started_at` / `completed_at` / `reverted_at`, all declared `Field.datetime`
 * on `sys_import_job`) — both sit INSIDE `formatOutput`'s `if (this.isSqlite)`
 * arm. ⚠️ A declared `Field.datetime` is NOT protected on Postgres/MySQL.
 *
 * ## Why the obvious pin would have proved nothing
 *
 * SQLite stores and returns canonical ISO text, so `String()` was an IDENTITY
 * there and every SQLite-backed test — including this package's real-engine
 * `import-job-integration.test.ts` — stayed green through the whole life of the
 * defect. A fixture of ISO strings cannot fail. **So these cases drive real
 * `Date`s through the real routes**, which is the shape only a non-SQLite
 * driver produces, and they do it under a forced non-UTC process zone.
 *
 * ## What is pinned — the property, not the spelling
 *
 * Not "the mapper calls `toISOString()`". The invariants are:
 *
 *   1. **A `Date` from the read door is served as canonical ISO-Z**, on all
 *      four fields, through both mappers (progress and summary), with the four
 *      stamps DISTINCT so no field can pass by echoing another's value.
 *   2. **The answer does not depend on `process.env.TZ`** — swept over three
 *      zones, with a non-vacuity control proving those zones really do move the
 *      broken spelling (three green rows under three identical spellings would
 *      prove nothing about timezone independence).
 *   3. **An already-canonical string is a fixed point** (the SQLite shape is
 *      returned byte-identical). This is what shows the pin DISCRIMINATES
 *      rather than being globally sensitive to any change at the seam.
 *   4. **The response satisfies the declared contract**, asserted by a full
 *      `safeParse` against the spec's own `ImportJobProgressSchema` /
 *      `ImportJobSummarySchema` — the judgement here is about a VALUE, so a
 *      green parse is the assertion, not merely the absence of unknown keys.
 *      This limb is also what refuses the tempting "just delete the `String()`
 *      and let `JSON.stringify` do it" route: that emits the right text but
 *      widens the declared `z.string()` to `string | Date`.
 *
 * ## What is deliberately NOT claimed here
 *
 * That `driver-sql` hands this seam a `Date` on Postgres. That is a fact about
 * `driver-sql`, measured beside the fix (`formatOutput`'s `isSqlite` bracketing)
 * and pinned in that package; `@objectstack/rest` must not grow a Postgres
 * dependency to restate it. What these tests own is the mapper's behaviour
 * GIVEN each input shape a driver can produce.
 */

import { describe, it, expect, afterEach } from 'vitest';
// The contract itself, not a local restatement of it: the same schemas
// `ImportJobApiContracts` names as the `output` of these very routes.
import { ImportJobProgressSchema, ImportJobSummarySchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

/** Canonical ISO-8601 UTC with milliseconds — what the contract promises. */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Four DISTINCT instants, each with a distinct NON-ZERO millisecond component.
 * Distinct so no field can pass by echoing another's value; non-zero
 * milliseconds so the millisecond-dropping spelling cannot pass by accident.
 */
const CREATED = '2026-08-30T10:19:25.947Z';
const STARTED = '2026-08-30T10:20:31.001Z';
const COMPLETED = '2026-08-30T10:21:44.512Z';
const REVERTED = '2026-08-30T10:22:59.083Z';

const ALL_FOUR = { createdAt: CREATED, startedAt: STARTED, completedAt: COMPLETED, revertedAt: REVERTED };

/** The card's zone, a zone on the other side of UTC, and UTC itself. */
const ZONES = ['Asia/Shanghai', 'America/New_York', 'UTC'] as const;

/**
 * One `sys_import_job` row as a driver materialises it. `stamp` decides the
 * shape of the four timestamp columns: `Date` (Postgres / MySQL / MongoDB) or
 * canonical ISO text (SQLite and friends).
 */
function makeRow(stamp: (iso: string) => unknown) {
    return {
        id: 'imp_13994',
        object_name: 'task',
        status: 'succeeded',
        dry_run: false,
        write_mode: 'insert',
        total_rows: 3,
        processed_rows: 3,
        created_count: 2,
        updated_count: 0,
        skipped_count: 0,
        error_count: 1,
        created_at: stamp(CREATED),
        started_at: stamp(STARTED),
        completed_at: stamp(COMPLETED),
        reverted_at: stamp(REVERTED),
    };
}

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = {
        write: () => true, end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

/**
 * The REAL routes, over a protocol whose read door returns exactly `row`.
 *
 * A stub read door rather than a real engine ON PURPOSE: the shape under test
 * is the one a SQLite-backed engine cannot produce, and it is precisely the
 * unreachability of that shape from SQLite that hid this defect.
 */
function boot(row: unknown) {
    const protocol = { findData: async () => ({ records: [row] }) };
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const routes = rest.getRoutes();
    const find = (method: string, path: string) => routes.find((r: any) => r.method === method && r.path === path);
    return {
        progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
        results: find('GET', '/api/v1/data/import/jobs/:jobId/results'),
        list: find('GET', '/api/v1/data/import/jobs'),
    };
}

async function call(route: any, req: any = {}) {
    const res = makeRes();
    await route.handler({ params: { jobId: 'imp_13994' }, query: {}, ...req } as any, res);
    return res._json;
}

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
});

describe('[#13994] the import-job DTO serves canonical ISO-8601 for a `Date` from the read door', () => {
    it('renders all four stamps canonically under a forced non-UTC process zone', async () => {
        process.env.TZ = 'Asia/Shanghai';

        // NON-VACUITY CONTROL. The defect's spelling, evaluated right here under
        // the same zone: if `String(Date)` already produced canonical ISO, the
        // assertions below would be green against the broken code too.
        const broken = String(new Date(CREATED));
        expect(broken, 'the broken spelling did not move — this pin would be vacuous').not.toBe(CREATED);
        expect(broken).not.toMatch(CANONICAL_ISO);

        const body = await call(boot(makeRow((iso) => new Date(iso))).progress);

        // All four, each against ITS OWN instant — distinct values, so a mapper
        // that echoed one stamp into all four fields fails here.
        expect(body).toMatchObject(ALL_FOUR);
        for (const [field, value] of Object.entries(ALL_FOUR)) {
            expect(body[field], `${field} is not canonical ISO-Z`).toMatch(CANONICAL_ISO);
            // Strict-ISO round-trip: what a client doing `Date.parse` receives.
            expect(new Date(body[field]).toISOString()).toBe(value);
        }

        // Limb 4: the declared contract, parsed by the spec's own schema. A bare
        // `Date` here (the "just delete the String()" route) fails this.
        const parsed = ImportJobProgressSchema.safeParse(body);
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it('gives the same answer under every process timezone, and the zones really do move the broken spelling', async () => {
        const served = new Set<string>();
        const brokenSpellings = new Set<string>();

        for (const zone of ZONES) {
            process.env.TZ = zone;
            brokenSpellings.add(String(new Date(CREATED)));
            const body = await call(boot(makeRow((iso) => new Date(iso))).progress);
            served.add(JSON.stringify([body.createdAt, body.startedAt, body.completedAt, body.revertedAt]));
        }

        // The control: three zones, three DIFFERENT broken spellings. Without
        // this, three green rows would say nothing about timezone independence.
        expect(
            brokenSpellings.size,
            'the process zone did not move `String(Date)` — the sweep is vacuous',
        ).toBe(ZONES.length);

        // The property: one answer, whatever the server's zone.
        expect(served).toEqual(new Set([JSON.stringify([CREATED, STARTED, COMPLETED, REVERTED])]));
    });

    it('serves the summary (list) DTO canonically too', async () => {
        process.env.TZ = 'Asia/Shanghai';
        const body = await call(boot(makeRow((iso) => new Date(iso))).list);
        const [job] = body.jobs;

        // `importJobToSummary` re-reads `importJobToProgress`'s output, so this
        // is the second mapper's face on the same repair.
        expect(job).toMatchObject({ createdAt: CREATED, completedAt: COMPLETED, revertedAt: REVERTED });
        for (const field of ['createdAt', 'completedAt', 'revertedAt'] as const) {
            expect(job[field], `${field} is not canonical ISO-Z`).toMatch(CANONICAL_ISO);
        }
        const parsed = ImportJobSummarySchema.safeParse(job);
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues)).toBe(true);
    });

    it('serves the results DTO canonically too', async () => {
        process.env.TZ = 'Asia/Shanghai';
        const body = await call(boot(makeRow((iso) => new Date(iso))).results);
        expect(body).toMatchObject(ALL_FOUR);
    });
});

describe('[#13994] an already-canonical string is a fixed point — the pin discriminates', () => {
    it('returns the SQLite shape byte-identical, under a non-UTC zone', async () => {
        process.env.TZ = 'Asia/Shanghai';
        const body = await call(boot(makeRow((iso) => iso)).progress);

        // Idempotence: the dialect that was already correct must not move. A
        // repair that re-derived every value (`new Date(v).toISOString()`) would
        // pass the `Date` cases above and still be a change in behaviour here.
        expect(body).toMatchObject(ALL_FOUR);
        expect(ImportJobProgressSchema.safeParse(body).success).toBe(true);
    });

    it('leaves a missing optional stamp absent, and an absent `created_at` an empty string', async () => {
        process.env.TZ = 'Asia/Shanghai';
        // The presence-guards are semantics this repair does NOT touch: a job
        // that has not started yet omits the three optional stamps entirely.
        const row: any = makeRow((iso) => new Date(iso));
        delete row.started_at; delete row.completed_at; delete row.reverted_at; delete row.created_at;

        const body = await call(boot(row).progress);
        expect('startedAt' in body).toBe(false);
        expect('completedAt' in body).toBe(false);
        expect('revertedAt' in body).toBe(false);
        expect(body.createdAt).toBe('');
    });
});
