// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4, #31696 PR-2, seat ruling Q3 = A] A scheduled flow whose name
// a second package comes to hold: the real `ScheduleTrigger` bound to the
// real `AutomationEngine`, its dispatch ledger the engine's own.
//
//  - While one package holds the name its job is `flow-schedule:NAME`. When
//    the second holder arrives the bare job is released before the two
//    qualified jobs (`flow-schedule:PACKAGE/NAME`) are armed, and the reverse
//    when it leaves.
//  - Each slot fires exactly once per window across the re-arm, both ways:
//    no double fire while a released job's cancel has not landed (the job
//    service below lands a cancel only when told to), and no gap in the
//    window after.
//
// The holder answers come from a resolver standing in for the automation
// plugin's (`flowNameResolver`: the one D3 rule), driven by which packages
// hold the name; ./flow-triggers-per-slot.test.ts in service-automation pins
// the same over a real registry.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemoryFlowDispatchStore } from '@objectstack/service-automation';
import type { JobHandler, JobSchedule } from '@objectstack/spec/contracts';
import { ScheduleTrigger, type TriggerLogger } from './schedule-trigger.js';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

withScheduledWorkOn('single');

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';
const FLOW = 'nightly_digest';
const W1 = new Date('2026-09-07T09:41:30Z');
const W2 = new Date('2026-09-08T02:00:00Z');

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const quiet: TriggerLogger = { info() {}, warn() {}, debug() {}, error() {} };

/** start (cron) → mark(tag) → end. */
function scheduled(tag: string) {
    return {
        name: FLOW,
        label: FLOW,
        type: 'schedule',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' }, organization: 'org_2mtx1w9d0k4bqf7v' } },
            { id: 'mark', type: 'mark', label: 'Mark', config: { tag } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mark' },
            { id: 'e2', source: 'mark', target: 'end' },
        ],
    } as never;
}

/** A job service whose cancels land only when {@link landCancels} says so: a released job can still fire. */
function laggingJobService() {
    const jobs = new Map<string, JobHandler>();
    const pending: string[] = [];
    const scheduledNames: string[] = [];
    const cancelled: string[] = [];
    return {
        service: {
            async schedule(name: string, _schedule: JobSchedule, handler: JobHandler) {
                scheduledNames.push(name);
                jobs.set(name, handler);
            },
            cancel(name: string) {
                cancelled.push(name);
                pending.push(name);
                return Promise.resolve();
            },
        },
        jobs,
        scheduledNames,
        cancelled,
        landCancels() {
            for (const name of pending.splice(0)) jobs.delete(name);
        },
        async fireAll() {
            for (const [, handler] of [...jobs]) await handler({ jobId: 'tick' } as never);
        },
    };
}

let holders: string[];
let ran: string[];
let now: Date;
let engine: AutomationEngine;
let job: ReturnType<typeof laggingJobService>;
let store: InMemoryFlowDispatchStore;

function ship(packageId: string, tag: string) {
    holders = [...new Set([...holders, packageId])];
    engine.registerFlow(FLOW, scheduled(tag), { source: 'package', packageId, holder: packageId });
}

beforeEach(async () => {
    holders = [];
    ran = [];
    now = W1;
    engine = new AutomationEngine({ ...quiet, child: () => undefined } as never);
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(node: { config?: { tag?: string } }) {
            ran.push(String(node.config?.tag));
            return { success: true };
        },
    } as never);
    engine.setPackagedFlowSource((name, packageId) => {
        if (name !== FLOW) return undefined;
        if (packageId !== undefined) return holders.includes(packageId) ? packageId : undefined;
        return holders.length === 1 ? holders[0] : undefined;
    });
    engine.setFlowNameResolver((name) => {
        if (name !== FLOW || holders.length === 0) return { status: 'not-found' } as never;
        if (holders.length > 1) {
            return { status: 'refused', candidates: holders.map((packageId) => ({ kind: 'package', packageId })) } as never;
        }
        return { status: 'resolved', item: {}, holder: { kind: 'package', packageId: holders[0] }, via: 'unique-holder' } as never;
    });
    store = new InMemoryFlowDispatchStore();
    engine.setFlowDispatchStore(store);
    job = laggingJobService();
    engine.registerTrigger(new ScheduleTrigger(() => job.service, quiet, () => engine as never, () => now));
});

describe('#31696 PR-2 Q3 = A — a schedule re-armed per slot fires each slot once per window', () => {
    it('CONTROL: one holder arms `flow-schedule:NAME` and fires once per window', async () => {
        ship(P1, 'p1');
        await flush();
        expect(job.scheduledNames).toEqual([`flow-schedule:${FLOW}`]);
        await job.fireAll();
        await job.fireAll();
        expect(ran).toEqual(['p1']);
        await expect(store.read(`schedule:${P1}:${FLOW}:2026-09-07T01:00:00.000Z`)).resolves.toMatchObject({ outcome: 'succeeded' });
    });

    it('red line: the second holder releases the bare job before arming the two qualified ones; no double fire, no gap', async () => {
        ship(P1, 'p1');
        await flush();
        await job.fireAll();
        expect(ran).toEqual(['p1']);

        ship(P2, 'p2');
        await flush();
        expect(job.cancelled).toEqual([`flow-schedule:${FLOW}`]);
        expect(job.scheduledNames).toEqual([`flow-schedule:${FLOW}`, `flow-schedule:${P1}/${FLOW}`, `flow-schedule:${P2}/${FLOW}`]);
        // The rest of W1, the released bare job still firing: P1 ran in W1 already, P2 runs once.
        await job.fireAll();
        await job.fireAll();
        expect(ran.sort()).toEqual(['p1', 'p2']);
        // W2, the bare job's cancel still not landed: each slot once.
        now = W2;
        ran = [];
        await job.fireAll();
        await job.fireAll();
        expect(ran.sort()).toEqual(['p1', 'p2']);
        await expect(store.read(`schedule:${P1}:${FLOW}:2026-09-08T01:00:00.000Z`)).resolves.toMatchObject({ outcome: 'succeeded' });
        await expect(store.read(`schedule:${P2}:${FLOW}:2026-09-08T01:00:00.000Z`)).resolves.toMatchObject({ outcome: 'succeeded' });
        job.landCancels();
        expect([...job.jobs.keys()]).toEqual([`flow-schedule:${P1}/${FLOW}`, `flow-schedule:${P2}/${FLOW}`]);
    });

    it('red line: the reverse — P2 leaves, P1\'s qualified job is released before its bare job is armed; no double fire, no gap', async () => {
        ship(P1, 'p1');
        ship(P2, 'p2');
        await flush();
        job.landCancels();
        await job.fireAll();
        expect(ran.sort()).toEqual(['p1', 'p2']);

        holders = [P1];
        engine.withdrawFlowSlot(P2, FLOW);
        await flush();
        expect(job.cancelled.slice(-2)).toEqual([`flow-schedule:${P2}/${FLOW}`, `flow-schedule:${P1}/${FLOW}`]);
        expect(job.scheduledNames.slice(-1)).toEqual([`flow-schedule:${FLOW}`]);
        // The rest of W1: P1 ran in W1 under its qualified job already.
        ran = [];
        await job.fireAll();
        expect(ran).toEqual([]);
        // W2, the released jobs still firing: P1 once, P2 never.
        now = W2;
        await job.fireAll();
        await job.fireAll();
        expect(ran).toEqual(['p1']);
    });
});
