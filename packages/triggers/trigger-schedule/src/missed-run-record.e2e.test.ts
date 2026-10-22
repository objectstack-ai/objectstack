// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25235] END-TO-END, the card's two acceptance cases: the REAL ScheduleTrigger
// and the REAL AutomationEngine across two "kernels" that share what a kernel
// shares with the next one — the database. Here that is three things: the
// `sys_job` rows (a job table double with DbJobAdapter's arming semantics:
// `schedule()` arms, `cancel()` disarms, a fire refreshes last-alive, and
// eviction touches nothing), the dispatch ledger and the run history.
//
//  - A kernel stopped across one due time, then started, shows ONE `missed`
//    entry for that due time in the flow's run history, and runs nothing for it.
//  - A kernel that ticked through shows no `missed` entry.
//
// The job table double stands in for `DbJobAdapter.readArming`, which is pinned
// against the real adapter in `service-job/src/db-job-adapter.test.ts`.

import { describe, it, expect } from 'vitest';
import { AutomationEngine, InMemoryFlowDispatchStore, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { ScheduleTrigger, type JobArmingReading, type JobServiceSurface } from './schedule-trigger.js';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const FLOW = 'nightly_rollup';
const JOB = `flow-schedule:${FLOW}`;
const DAILY_8AM: JobSchedule = { type: 'cron', expression: '0 8 * * *' };

/** The `sys_job` table: it outlives every kernel. */
type JobTable = Map<string, { active: boolean; schedule: JobSchedule; lastAliveAt: string }>;

/** One kernel's job service over the shared table, fired by hand. */
function kernelJobService(table: JobTable, clock: { now: Date }) {
    const jobs = new Map<string, JobHandler>();
    const service: JobServiceSurface = {
        async schedule(name, schedule, handler) {
            jobs.set(name, handler);
            table.set(name, { active: true, schedule, lastAliveAt: clock.now.toISOString() });
        },
        async cancel(name) {
            jobs.delete(name);
            const row = table.get(name);
            if (row) row.active = false;
        },
        async readArming(name): Promise<JobArmingReading | null> {
            const row = table.get(name);
            return row ? { ...row } : null;
        },
    };
    return {
        service,
        /** The cron tick at `at`: the handler runs, then the row records the fire. */
        async tick(name: string, at: string) {
            clock.now = new Date(at);
            await jobs.get(name)!({ jobId: name });
            table.get(name)!.lastAliveAt = clock.now.toISOString();
        },
        /** Eviction: the timers die with the kernel, the table is untouched. */
        evict() {
            jobs.clear();
        },
    };
}

/** The shared database, and a way to boot a kernel on it. */
function deployment() {
    const table: JobTable = new Map();
    const runHistory = new InMemorySuspendedRunStore();
    const ledger = new InMemoryFlowDispatchStore();
    const clock = { now: new Date('2026-10-21T07:00:00Z') };
    const ran: AutomationContext[] = [];
    const warns: string[] = [];
    const logger: any = { info() {}, debug() {}, error() {}, warn: (m: string) => warns.push(m) };
    logger.child = () => logger;

    const boot = async () => {
        const engine = new AutomationEngine(logger, runHistory);
        engine.setFlowDispatchStore(ledger);
        engine.registerNodeExecutor({
            type: 'create_record',
            async execute(_node: unknown, _vars: unknown, context: AutomationContext) {
                ran.push(context);
                return { success: true, output: {} };
            },
        } as never);
        engine.registerFlow(FLOW, {
            name: FLOW,
            label: FLOW,
            type: 'schedule',
            runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { schedule: DAILY_8AM, organization: 'org_2mtx1w9d0k4bqf7v' } },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mk' },
                { id: 'e2', source: 'mk', target: 'end' },
            ],
        } as never);
        const jobs = kernelJobService(table, clock);
        engine.registerTrigger(new ScheduleTrigger(() => jobs.service, logger, () => engine, () => clock.now));
        await flush();
        expect(table.get(JOB)?.active, 'the flow did not bind').toBe(true);
        return { engine, jobs };
    };

    return { boot, clock, ran, warns, table };
}

// [#17396] These cases are about a deployment that RUNS package-authored
// scheduled work; the switch is off by default in every posture.
withScheduledWorkOn('single');

describe('[#25235] a scheduled run whose due time passed while no kernel was ticking', () => {
    it('a kernel stopped across one due time, then started, records ONE missed entry for it and runs nothing', async () => {
        const d = deployment();

        const a = await d.boot();
        await a.jobs.tick(JOB, '2026-10-21T08:00:00.000Z');
        expect(d.ran).toHaveLength(1);
        a.jobs.evict(); // stopped — eviction cancels nothing

        d.clock.now = new Date('2026-10-22T09:30:00.000Z'); // 2026-10-22T08:00 passed in the silence
        const b = await d.boot();

        const runs = await b.engine.listRuns(FLOW);
        const missed = runs.filter((r) => r.status === 'missed');
        expect(missed).toHaveLength(1);
        expect(missed[0]).toMatchObject({
            flowName: FLOW,
            status: 'missed',
            startedAt: '2026-10-22T08:00:00.000Z',
            completedAt: '2026-10-22T09:30:00.000Z',
            steps: [],
        });
        expect(missed[0].trigger.type).toBe('schedule');
        expect(d.ran, 'nothing is run for a missed due time — no replay').toHaveLength(1);
        expect(await b.engine.listRuns(FLOW, { status: 'missed' })).toHaveLength(1);
        expect(d.warns.some((w) => w.includes(`flow '${FLOW}' MISSED 1 scheduled run(s)`))).toBe(true);

        // The next due time is delivered normally, and the missed entry stays one.
        await b.jobs.tick(JOB, '2026-10-23T08:00:00.000Z');
        expect(d.ran).toHaveLength(2);
        expect((await b.engine.listRuns(FLOW)).filter((r) => r.status === 'missed')).toHaveLength(1);
    });

    it('a kernel that ticked through records no missed entry', async () => {
        const d = deployment();

        const a = await d.boot();
        await a.jobs.tick(JOB, '2026-10-21T08:00:00.000Z');
        await a.jobs.tick(JOB, '2026-10-22T08:00:00.000Z');
        a.jobs.evict();

        d.clock.now = new Date('2026-10-22T09:30:00.000Z'); // no due time since the last fire
        const b = await d.boot();

        const runs = await b.engine.listRuns(FLOW);
        expect(runs.filter((r) => r.status === 'missed')).toEqual([]);
        expect(runs.filter((r) => r.status === 'completed')).toHaveLength(2);
        expect(d.warns.filter((w) => w.includes('MISSED'))).toEqual([]);
    });

    it('a flow deliberately unbound before the silence records no missed entry (it was not armed)', async () => {
        const d = deployment();

        const a = await d.boot();
        await a.jobs.tick(JOB, '2026-10-21T08:00:00.000Z');
        a.engine.unregisterTrigger('schedule'); // the unbind cancels the job
        expect(d.table.get(JOB)?.active).toBe(false);
        a.jobs.evict();

        d.clock.now = new Date('2026-10-23T09:30:00.000Z');
        const b = await d.boot();

        expect((await b.engine.listRuns(FLOW)).filter((r) => r.status === 'missed')).toEqual([]);
    });

    it('a due time whose fire was claimed before the kernel died is not recorded as missed', async () => {
        const d = deployment();

        const a = await d.boot();
        await a.jobs.tick(JOB, '2026-10-21T08:00:00.000Z');
        // The 2026-10-22T08:00 fire claims its window, and the kernel dies before
        // it settles or the job row records it: in flight, which the replay door
        // owns — not missed.
        await a.engine.claim(`schedule:${FLOW}:2026-10-22T08:00:00.000Z`);
        a.jobs.evict();

        d.clock.now = new Date('2026-10-22T09:30:00.000Z');
        const b = await d.boot();

        expect((await b.engine.listRuns(FLOW)).filter((r) => r.status === 'missed')).toEqual([]);
        expect(d.ran).toHaveLength(1);
    });
});
