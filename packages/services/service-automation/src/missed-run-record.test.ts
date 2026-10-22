// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25235] AutomationEngine.recordMissedRun — the engine half of "record a
// scheduled run whose due time passed while no kernel was ticking as missed".
// The trigger decides which due times fell in the silence; this method judges
// each against the dispatch ledger and writes the run-history entry. The
// two-kernel acceptance cases live with the trigger
// (`trigger-schedule/src/missed-run-record.e2e.test.ts`).

import { describe, it, expect } from 'vitest';
import { AutomationEngine, TERMINAL_RUN_STATUSES, missedRunId } from './engine.js';
import { InMemoryFlowDispatchStore } from './flow-dispatch-store.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { SysAutomationRun } from './sys-automation-run.object.js';

function recordingLogger() {
    const warns: string[] = [];
    const logger: any = { info() {}, debug() {}, error() {}, warn: (m: string) => warns.push(m) };
    logger.child = () => logger;
    return { logger, warns };
}

const FLOW = 'nightly_rollup';
const DUE = '2026-10-22T08:00:00.000Z';
const DETECTED = '2026-10-22T09:30:00.000Z';
const KEY = `schedule:${FLOW}:${DUE}`;
const missed = { flowName: FLOW, dueAt: DUE, detectedAt: DETECTED, dispatchKey: KEY, organization: 'org_2mtx1w9d0k4bqf7v' };

function engineOn(history = new InMemorySuspendedRunStore(), ledger: any = new InMemoryFlowDispatchStore()) {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger, history);
    if (ledger) engine.setFlowDispatchStore(ledger);
    return { engine, history, ledger, warns };
}

describe('[#25235] AutomationEngine.recordMissedRun', () => {
    it('an unclaimed window is recorded: one missed entry, due time as startedAt, detection as completedAt, no steps', async () => {
        const { engine, history } = engineOn();
        expect(await engine.recordMissedRun(missed)).toBe('recorded');

        const runs = await engine.listRuns(FLOW);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({
            id: missedRunId(FLOW, DUE),
            flowName: FLOW,
            status: 'missed',
            startedAt: DUE,
            completedAt: DETECTED,
            steps: [],
        });
        expect(runs[0].trigger.type).toBe('schedule');
        expect(await engine.listRuns(FLOW, { status: 'missed' })).toHaveLength(1);
        expect(await engine.listRuns(FLOW, { status: 'failed' })).toHaveLength(0);

        // The durable row — what a restarted kernel reads — carries the same.
        await Promise.resolve();
        const [row] = await history.listHistory(FLOW, 10);
        expect(row).toMatchObject({ status: 'missed', startedAt: DUE, finishedAt: DETECTED, organizationId: 'org_2mtx1w9d0k4bqf7v' });
    });

    it('a claimed window was dispatched — landed or died in flight — and is not recorded', async () => {
        const { engine } = engineOn();
        await engine.claim(KEY);
        expect(await engine.recordMissedRun(missed)).toBe('dispatched');
        expect(await engine.listRuns(FLOW)).toEqual([]);
    });

    it('records nothing it cannot verify: no persisted ledger, or a ledger read that throws', async () => {
        const none = engineOn(undefined, null);
        expect(await none.engine.recordMissedRun(missed)).toBe('unverifiable');
        expect(await none.engine.listRuns(FLOW)).toEqual([]);

        const broken = engineOn(undefined, {
            claim: async () => true,
            read: async () => { throw new Error('no such table: sys_flow_dispatch'); },
        });
        expect(await broken.engine.recordMissedRun(missed)).toBe('unverifiable');
        expect(await broken.engine.listRuns(FLOW)).toEqual([]);
        expect(broken.warns.some((w) => w.includes('NOT recording it as missed'))).toBe(true);
    });

    it('two replicas detecting the same silence write ONE history row (the id is per flow and due time)', async () => {
        const history = new InMemorySuspendedRunStore();
        const ledger = new InMemoryFlowDispatchStore();
        const a = engineOn(history, ledger);
        const b = engineOn(history, ledger);
        expect(await a.engine.recordMissedRun(missed)).toBe('recorded');
        expect(await b.engine.recordMissedRun(missed)).toBe('recorded');
        await Promise.resolve();
        expect(await history.listHistory(FLOW, 10)).toHaveLength(1);
        expect(missedRunId(FLOW, DUE)).toBe(missedRunId(FLOW, '2026-10-22T08:00:00Z'));
    });

    it('missed is in the one terminal vocabulary, the stored option set and the retention scope', () => {
        expect(TERMINAL_RUN_STATUSES).toContain('missed');
        const status = (SysAutomationRun.fields as any).status;
        expect((status.options ?? []).map((o: any) => (typeof o === 'string' ? o : o.value))).toContain('missed');
        const onlyWhen = SysAutomationRun.lifecycle?.retention?.onlyWhen as { status?: { $in?: string[] } } | undefined;
        expect(onlyWhen?.status?.$in).toContain('missed');
    });
});
