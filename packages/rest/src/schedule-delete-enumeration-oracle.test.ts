// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7603] `DELETE /api/v1/reports/schedules/:scheduleId` must not tell a caller
// whether a schedule id EXISTS.
//
// This is #7523's oracle wearing the costume that card warned about. There, the
// two deny arms surfaced as 500-vs-204; here they surfaced as:
//
//     another owner's schedule id  →  404 REPORT_NOT_FOUND
//     a schedule id that does not exist  →  204 No Content
//
// A caller can delete neither, yet still reads which of the two they hit off the
// status code — an enumeration oracle over other owners' schedule ids. The route
// was read as CORRECT precisely because it already routes its catch through
// `handleValidation` (that is why the cross-owner arm is a clean 404 and not a
// 500), and #7523's investigation cited it as the example of the right shape.
// The unknown-id arm was simply never probed on this route: `unscheduleReport`
// returned early and silently, and `rest.test.ts` pinned the resulting 204.
//
// The fix does NOT live in this package. `deleteReport`'s arms can be pre-empted
// in the route because `getReport()` is already blind to the difference (#2980);
// the caller here presents a scheduleId, and `IReportService` exposes no by-id
// schedule read to be blind with — `listSchedules` is keyed by reportId. So the
// blinding is the service's obligation, stated on the contract and implemented
// in `packages/plugins/plugin-reports`, whose own suite pins the real code
// (`report-service.test.ts`, "the unknown-id and cross-owner deny arms are
// indistinguishable"). What THIS file pins is the half of the composition that
// belongs to the route: given a contract-conforming service, the two deny arms
// reach the caller as one and the same response.
//
// The half-fix is the trap the file is built around, so the tests below never
// assert the two arms' statuses SEPARATELY. They record the whole response —
// every `status()`/`json()`/`end()` call, in order, with arguments — and assert
// the two transcripts are EQUAL. A test that pins each arm's status on its own
// line cannot fail on a half-fix; an equality assertion cannot pass through one.
// Equality alone is not enough either (two arms that agree on 500 are equal and
// still broken), so the deny transcript is also pinned in full.
//
// Reverse verification, directions predicted BEFORE running — see the PR body
// for the mutation table.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

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
 * An `IReportService` double carrying the schedule-delete semantics the contract
 * now requires, in the structure `packages/plugins/plugin-reports` implements
 * them:
 *
 *   - a schedule is owned THROUGH its report (#2980) — there is no `owner_id`
 *     test on the schedule itself;
 *   - one access predicate decides all three miss shapes alike (no schedule, no
 *     report behind it, someone else's report), so the deny is a single throw
 *     site with a single message;
 *   - that decision is taken BEFORE the delete fires.
 *
 * Copied rather than imported: `@objectstack/rest` must not take a dependency on
 * a plugin package to test its own route (the same call #7523's file made). The
 * behaviours, not the code, are what this route is contracted against — which is
 * why the plugin's own suite pins the real implementation separately, and why a
 * mutation to the fix has to be applied here too for this file to see it.
 */
function reportsService(
    schedules: Array<{ id: string; reportId: string }>,
    reports: Array<{ id: string; ownerId: string }>,
) {
    const deleted: string[] = [];
    return {
        deleted,
        unscheduleReport: vi.fn(async (scheduleId: string, ctx: any) => {
            if (!scheduleId) throw new Error('VALIDATION_FAILED: scheduleId is required');
            const schedule = schedules.find(s => s.id === scheduleId);
            const report = schedule ? reports.find(r => r.id === schedule.reportId) ?? null : null;
            if (!report || report.ownerId !== ctx?.userId) {
                throw new Error(`REPORT_NOT_FOUND: ${scheduleId}`);
            }
            deleted.push(scheduleId);
        }),
    };
}

/** The route under test, wired for `callerId` as the authenticated principal. */
function unscheduleRoute(svc: any, callerId: string) {
    const rest: any = new RestServer(
        createMockServer() as any, PROTOCOL as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        async () => svc,
    );
    rest.resolveExecCtx = async () => ({ userId: callerId });
    rest.registerRoutes();
    const route = rest.getRoutes().find(
        (r: any) => r.method === 'DELETE' && r.path === '/api/v1/reports/schedules/:scheduleId',
    );
    expect(route).toBeDefined();
    return route;
}

/** Drive the route once as `callerId` against `scheduleId`; return the transcript. */
async function unscheduleAs(svc: any, callerId: string, scheduleId: string) {
    const { res, calls } = recordingRes();
    await unscheduleRoute(svc, callerId).handler({ params: { scheduleId } } as any, res);
    return calls;
}

/**
 * The prober's experiment, stated exactly.
 *
 * A prober sends ONE schedule id and watches what comes back; the question is
 * whether the answer depends on whether that id exists. So both arms are driven
 * with the SAME id, against two worlds that differ only in whether the schedule
 * is there — which makes the two responses comparable byte-for-byte, with no
 * normalising away of an id that differed between the runs. (Normalisation is
 * where an oracle hides: whatever you normalise, you stop testing.)
 */
async function probe(scheduleId: string, reportId: string, ownerId: string, callerId: string) {
    const reports = [{ id: reportId, ownerId }];
    const exists = reportsService([{ id: scheduleId, reportId }], reports);
    const absent = reportsService([], reports);
    return {
        exists, absent,
        whenItExists: await unscheduleAs(exists, callerId, scheduleId),
        whenItDoesNot: await unscheduleAs(absent, callerId, scheduleId),
    };
}

// ---------------------------------------------------------------------------
// The oracle, closed
// ---------------------------------------------------------------------------

describe('[#7603] DELETE /reports/schedules/:scheduleId does not discriminate on schedule existence', () => {
    // A owns a report with two schedules on it; B is a different owner.
    const A_SCHEDULES = [
        { id: 'rsch_owned_by_a', reportId: 'rpt_a' },
        { id: 'rsch_owned_by_a_2', reportId: 'rpt_a' },
    ];

    it("another owner's schedule and a nonexistent id produce IDENTICAL responses", async () => {
        const { whenItExists, whenItDoesNot, exists, absent } =
            await probe('rsch_owned_by_a', 'rpt_a', 'user-a', 'user-b');

        // The whole response, not just its status — and the same id on both
        // sides, so this is literal equality with nothing normalised away. This
        // is the assertion the half-fix (cross-owner → 404 while the unknown id
        // keeps its 204) cannot survive.
        expect(whenItExists).toEqual(whenItDoesNot);

        // ...and the response they agree on is the deny, not an accidental
        // agreement on 204 that would mean the owner gate stopped working — nor
        // an agreement on 500, which equality alone would happily accept.
        expect(whenItExists).toEqual([
            ['status', [404]],
            ['json', [{ code: 'REPORT_NOT_FOUND', error: 'REPORT_NOT_FOUND: rsch_owned_by_a' }]],
        ]);

        // The delete never fired for either arm.
        expect(exists.deleted).toEqual([]);
        expect(absent.deleted).toEqual([]);
    });

    it('reproduces 2× — a second schedule on the same report answers the same way', async () => {
        for (const { id, reportId } of A_SCHEDULES) {
            const { whenItExists, whenItDoesNot, exists } = await probe(id, reportId, 'user-a', 'user-b');
            expect(whenItExists).toEqual(whenItDoesNot);
            expect(whenItExists[0]).toEqual(['status', [404]]);
            expect(exists.deleted).toEqual([]);
        }
    });

    it('a schedule whose report is gone denies identically too — the third miss shape', async () => {
        // `canAccessReport` is false for a schedule that exists but whose parent
        // report does not, and the collapse has to cover that arm as well or it
        // becomes the next tell: it is reachable whenever a report row is removed
        // out from under its schedules.
        const orphan = reportsService([{ id: 'rsch_orphan', reportId: 'rpt_gone' }], []);
        const absent = reportsService([], []);

        const whenOrphaned = await unscheduleAs(orphan, 'user-b', 'rsch_orphan');
        const whenItDoesNot = await unscheduleAs(absent, 'user-b', 'rsch_orphan');

        expect(whenOrphaned).toEqual(whenItDoesNot);
        expect(whenOrphaned[0]).toEqual(['status', [404]]);
        expect(orphan.deleted).toEqual([]);
    });

    it('does not do equal work by refusing everyone — the owner still deletes their own schedule', async () => {
        // The cheap way to make two responses equal is to break the feature.
        const svc = reportsService([...A_SCHEDULES], [{ id: 'rpt_a', ownerId: 'user-a' }]);

        const owner = await unscheduleAs(svc, 'user-a', 'rsch_owned_by_a');

        expect(owner).toEqual([['status', [204]], ['end', []]]);
        expect(svc.deleted).toEqual(['rsch_owned_by_a']);
        expect(svc.unscheduleReport).toHaveBeenCalledWith('rsch_owned_by_a', expect.anything());
    });

    it('keeps a genuine fault a 500 — the deny mapping did not swallow SCHEDULE_DELETE_FAILED', async () => {
        // The overreach in the other direction: routing the catch through
        // `handleValidation` must not turn an unrelated failure into a 404.
        const svc = reportsService([...A_SCHEDULES], [{ id: 'rpt_a', ownerId: 'user-a' }]);
        svc.unscheduleReport = vi.fn(async () => { throw new Error('connection reset by peer'); }) as any;

        const boom = await unscheduleAs(svc, 'user-a', 'rsch_owned_by_a');

        expect(boom[0]).toEqual(['status', [500]]);
        expect((boom[1][1][0] as any).code).toBe('SCHEDULE_DELETE_FAILED');
    });

    it('still maps VALIDATION_FAILED to 400 — the one emitter serves both codes', async () => {
        const svc = reportsService([], []);
        const bad = await unscheduleAs(svc, 'user-a', '');

        expect(bad[0]).toEqual(['status', [400]]);
        expect((bad[1][1][0] as any).code).toBe('VALIDATION_FAILED');
    });

    it('performs the same service calls on both deny arms — no work-shaped tell', async () => {
        const { exists, absent } = await probe('rsch_owned_by_a', 'rpt_a', 'user-a', 'user-b');
        const work = (svc: ReturnType<typeof reportsService>) => ({
            unschedule: svc.unscheduleReport.mock.calls.length,
            deleted: svc.deleted.length,
        });

        // One call, no delete — on BOTH arms. Anything else is a difference in
        // work done between "exists" and "does not", which is the shape a timing
        // side channel would take.
        expect(work(exists)).toEqual(work(absent));
        expect(work(exists)).toEqual({ unschedule: 1, deleted: 0 });
    });
});
