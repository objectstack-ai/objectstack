// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7523] `DELETE /api/v1/reports/:id` must not tell a caller whether a report
// id EXISTS.
//
// The service layer was already right: `deleteReport()` returns early for an id
// that does not exist and throws `REPORT_NOT_FOUND` for a report the caller does
// not own — "others get a not-found so the delete neither fires nor reveals the
// report's existence". The route threw that away. Its catch went straight to
// `res.status(500)` with `REPORT_DELETE_FAILED` and never reached the file-local
// `handleValidation`, so the two arms surfaced as:
//
//     another owner's report id  →  500 REPORT_DELETE_FAILED
//     an id that does not exist  →  204 No Content
//
// which is an enumeration oracle over other users' saved-report ids: an
// authenticated caller probes ids and reads existence off the status code. The
// sibling `DELETE .../reports/schedules/:scheduleId` in the same file does call
// `handleValidation`, which is why that route was already correct.
//
// The half-fix is the trap this file is built around. Rewiring the catch alone
// makes cross-owner answer 404 while the unknown id still answers 204 — the same
// oracle in a quieter costume, 404-vs-204 instead of 500-vs-204. So the tests
// below never assert the two arms' statuses SEPARATELY. They record the whole
// response — every `status()`/`json()`/`end()` call, in order, with arguments —
// and assert the two transcripts are EQUAL. A test that pins each arm's status
// on its own line cannot fail on a half-fix; an equality assertion cannot pass
// through one.
//
// Reverse verification, direction predicted BEFORE running (see the PR body for
// the mutation table): correcting only ONE arm — cross-owner mapped to 404 while
// the unknown id keeps its 204, i.e. exactly the plausible half-fix — turns the
// equality tests RED and leaves the owner's-own-delete test GREEN.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ANON_API = { api: { requireAuth: false } };

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn(), close: vi.fn(),
    };
}

const PROTOCOL = {
    getDiscovery: async () => ({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: async () => [], getMetaItems: async () => [], getMetaItem: async () => ({}),
    findData: async () => [], getData: async () => ({}), createData: async () => ({ id: '1' }),
    updateData: async () => ({}), deleteData: async () => ({ success: true }),
};

/**
 * A response double that RECORDS rather than asserts.
 *
 * The oracle lives in the difference between two responses, so the test's unit
 * of comparison has to be a whole response, not a status code. `calls` is the
 * ordered transcript of everything the handler did to `res` — including the
 * argument objects — which is what the two deny arms have to agree on.
 */
function recordingRes() {
    const calls: Array<[string, unknown[]]> = [];
    const res: any = {
        status: (...a: unknown[]) => { calls.push(['status', a]); return res; },
        json: (...a: unknown[]) => { calls.push(['json', a]); return res; },
        end: (...a: unknown[]) => { calls.push(['end', a]); return res; },
    };
    return { res, calls };
}

/**
 * An `IReportService` double with the REAL ownership semantics of
 * `packages/plugins/plugin-reports`' `ReportService` — the three behaviours
 * this route sits on top of, each pinned by that package's own suite:
 *
 *   - `getReport()` returns null for an unknown id AND for another owner's id
 *     alike (#2980: "unauthorized reads are indistinguishable from a genuine
 *     miss").
 *   - `deleteReport()` returns early — silently, no throw — for an unknown id
 *     ("idempotent — nothing to drop").
 *   - `deleteReport()` throws `REPORT_NOT_FOUND` for a report the caller does
 *     not own (report-service.test.ts: "a non-owner cannot delete another
 *     user's report").
 *
 * Copied rather than imported: `@objectstack/rest` must not take a dependency on
 * a plugin package to test its own route. The behaviours, not the code, are what
 * this route is contracted against.
 */
function reportsService(rows: Array<{ id: string; ownerId: string }>) {
    const deleted: string[] = [];
    const owned = (id: string, ctx: any) => rows.find(r => r.id === id && r.ownerId === ctx?.userId);
    return {
        deleted,
        getReport: vi.fn(async (id: string, ctx: any) => owned(id, ctx) ?? null),
        deleteReport: vi.fn(async (id: string, ctx: any) => {
            const row = rows.find(r => r.id === id);
            if (!row) return;                                      // unknown id — idempotent
            if (row.ownerId !== ctx?.userId) throw new Error(`REPORT_NOT_FOUND: ${id}`);
            deleted.push(id);
        }),
    };
}

/** The route under test, wired for `callerId` as the authenticated principal. */
function deleteRoute(svc: any, callerId: string) {
    const rest: any = new RestServer(
        createMockServer() as any, PROTOCOL as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        async () => svc,
    );
    rest.resolveExecCtx = async () => ({ userId: callerId });
    rest.registerRoutes();
    const route = rest.getRoutes().find(
        (r: any) => r.method === 'DELETE' && r.path === '/api/v1/reports/:id',
    );
    expect(route).toBeDefined();
    return route;
}

/** Drive the route once as `callerId` against `id`; return the transcript. */
async function deleteAs(svc: any, callerId: string, id: string) {
    const { res, calls } = recordingRes();
    await deleteRoute(svc, callerId).handler({ params: { id } } as any, res);
    return calls;
}

/**
 * The prober's experiment, stated exactly.
 *
 * A prober sends ONE id and watches what comes back; the question is whether
 * the answer depends on whether that id exists. So both arms are driven with
 * the SAME id, against two worlds that differ only in whether the report is
 * there — which makes the two responses comparable byte-for-byte, with no
 * normalising away of an id that differed between the runs. (Normalisation is
 * where an oracle hides: whatever you normalise, you stop testing.)
 */
async function probe(id: string, ownerId: string, callerId: string) {
    const exists = reportsService([{ id, ownerId }]);
    const absent = reportsService([]);
    return {
        exists, absent,
        whenItExists: await deleteAs(exists, callerId, id),
        whenItDoesNot: await deleteAs(absent, callerId, id),
    };
}

// ---------------------------------------------------------------------------
// The oracle, closed
// ---------------------------------------------------------------------------

describe('[#7523] DELETE /reports/:id does not discriminate on report existence', () => {
    // The card's own reproduction: A owns two reports, B is a different owner.
    const A_REPORTS = [
        { id: 'rpt_owned_by_a', ownerId: 'user-a' },
        { id: 'rpt_owned_by_a_2', ownerId: 'user-a' },
    ];

    it("another owner's report and a nonexistent id produce IDENTICAL responses", async () => {
        const { whenItExists, whenItDoesNot, exists, absent } =
            await probe('rpt_owned_by_a', 'user-a', 'user-b');

        // The whole response, not just its status — and the same id on both
        // sides, so this is literal equality with nothing normalised away. This
        // is the assertion the half-fix (cross-owner → 404 while the unknown id
        // keeps its 204) cannot survive.
        expect(whenItExists).toEqual(whenItDoesNot);

        // ...and the response they agree on is the deny, not an accidental
        // agreement on 204 that would mean the owner gate stopped working.
        expect(whenItExists).toEqual([
            ['status', [404]],
            ['json', [{ code: 'REPORT_NOT_FOUND', error: 'REPORT_NOT_FOUND: rpt_owned_by_a' }]],
        ]);

        // The delete never fired for either arm.
        expect(exists.deleted).toEqual([]);
        expect(absent.deleted).toEqual([]);
    });

    it('reproduces 2× — a second report owned by A answers the same way', async () => {
        // The card reproduced on two distinct reports; so does the closure.
        for (const { id } of A_REPORTS) {
            const { whenItExists, whenItDoesNot, exists } = await probe(id, 'user-a', 'user-b');
            expect(whenItExists).toEqual(whenItDoesNot);
            expect(whenItExists[0]).toEqual(['status', [404]]);
            expect(exists.deleted).toEqual([]);
        }
    });

    it('is blind to WHICH service call gates — a service that only gates in deleteReport() also gets one response', async () => {
        // Defence in depth for the catch arm. An `IReportService` that leaves
        // `getReport()` unblinded still reaches the route's catch on a
        // cross-owner delete; routing that catch through `handleValidation` is
        // what keeps ITS two arms identical too.
        const unblind = (svc: ReturnType<typeof reportsService>, rows: Array<{ id: string }>) => {
            svc.getReport = vi.fn(async (id: string) => rows.find(r => r.id === id) ?? null) as any;
            return svc;
        };
        const rows = [{ id: 'rpt_owned_by_a', ownerId: 'user-a' }];
        const exists = unblind(reportsService(rows), rows);
        const absent = unblind(reportsService([]), []);

        const whenItExists = await deleteAs(exists, 'user-b', 'rpt_owned_by_a');
        const whenItDoesNot = await deleteAs(absent, 'user-b', 'rpt_owned_by_a');

        expect(whenItExists).toEqual(whenItDoesNot);
        expect(whenItExists[0]).toEqual(['status', [404]]);   // never 500 REPORT_DELETE_FAILED
        expect(exists.deleted).toEqual([]);
    });

    it('does not do equal work by refusing everyone — the owner still deletes their own report', async () => {
        // The cheap way to make two responses equal is to break the feature.
        const svc = reportsService([...A_REPORTS]);

        const owner = await deleteAs(svc, 'user-a', 'rpt_owned_by_a');

        expect(owner).toEqual([['status', [204]], ['end', []]]);
        expect(svc.deleted).toEqual(['rpt_owned_by_a']);
        expect(svc.deleteReport).toHaveBeenCalledWith('rpt_owned_by_a', expect.anything());
    });

    it('keeps a genuine fault a 500 — the deny mapping did not swallow REPORT_DELETE_FAILED', async () => {
        // The other overreach: routing the catch through `handleValidation`
        // must not turn an unrelated failure into a 404.
        const svc = reportsService([{ id: 'rpt_owned_by_a', ownerId: 'user-a' }]);
        svc.deleteReport = vi.fn(async () => { throw new Error('connection reset by peer'); }) as any;

        const boom = await deleteAs(svc, 'user-a', 'rpt_owned_by_a');

        expect(boom[0]).toEqual(['status', [500]]);
        expect((boom[1][1][0] as any).code).toBe('REPORT_DELETE_FAILED');
    });

    it('performs the same service calls on both deny arms — no work-shaped tell', async () => {
        const { exists, absent } = await probe('rpt_owned_by_a', 'user-a', 'user-b');
        const work = (svc: ReturnType<typeof reportsService>) => ({
            get: svc.getReport.mock.calls.length,
            del: svc.deleteReport.mock.calls.length,
        });

        // One visibility read, no delete — on BOTH arms. Anything else is a
        // difference in work done between "exists" and "does not", which is the
        // shape a timing side channel would take.
        expect(work(exists)).toEqual(work(absent));
        expect(work(exists)).toEqual({ get: 1, del: 0 });
    });
});
