// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Run trigger attribution (#7533) — WHY a run ran, in memory and after a
// restart. Two gaps, measured by QA run #7516 (`trigger-type-matrix`, PARTIAL):
//
//   1. `trigger.recordId` was never populated on `record_change` runs. The
//      field was declared in `ExecutionLogSchema` from the start and written by
//      nothing, so for the platform's most common trigger kind the run log
//      could not answer "which record caused this run?" — nor its reverse,
//      "which runs did this record provoke?".
//   2. The durable `sys_automation_run` history row carried NO trigger block at
//      all. The in-memory run recorded its runtime kind (verified for all six
//      kinds); the persistence mapping dropped it. A restart therefore made a
//      scheduled run, a webhook intake and a record change indistinguishable —
//      the durable copy of the history was strictly LESS informative than the
//      volatile one.
//
// The two compound, which is why they are pinned together: the runs that most
// need attribution lose their record id immediately, and every run loses its
// kind as soon as the process cycles.
//
// Scope note: the persisted-CELL assertions (that these land in
// `sys_automation_run` columns a query can filter on, not just in a rehydrated
// object) live in `suspended-run-store.test.ts`, against the fake ObjectQL
// engine that owns the row-shape contract. This file owns the engine half.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** `recordTerminal` is fire-and-forget — let the microtask land. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function trivialFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [{ id: 'start', type: 'start', label: 's' }, { id: 'end', type: 'end', label: 'e' }],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

function failingFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            { id: 'boom', type: 'boom', label: 'b' },
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'boom' }, { id: 'e2', source: 'boom', target: 'end' }],
    };
}

/**
 * The context a `record_change` trigger hands the engine — the shape
 * `RecordChangeTrigger.buildContext` produces: the triggering row under
 * `record` (id included, because the after-row carries it), the object, and the
 * start node's `triggerType` as `event`.
 */
function recordChangeContext(recordId: string): AutomationContext {
    return {
        event: 'record-after-update',
        object: 'crm_deal',
        record: { id: recordId, amount: 4200, stage: 'won' },
        userId: 'u_writer',
    } as AutomationContext;
}

describe('#7533 gap 1 — trigger.recordId on record_change runs', () => {
    it('records the EXACT triggering record id on a completed run', async () => {
        const engine = new AutomationEngine(silent);
        engine.registerFlow('deal_won', trivialFlow('deal_won') as never);

        await engine.execute('deal_won', recordChangeContext('deal_42'));

        const [run] = await engine.listRuns('deal_won', { limit: 1 });
        // Content pin, not a presence pin: "some id" would have passed against
        // a mapping that stamped the RUN id, or the previous record's.
        expect(run.trigger.recordId).toBe('deal_42');
        expect(run.trigger.object).toBe('crm_deal');
        expect(run.trigger.type).toBe('record-after-update');
        expect(run.trigger.userId).toBe('u_writer');
    });

    it('records it on a FAILED run too — the run you most need to correlate', async () => {
        const engine = new AutomationEngine(silent);
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engine.registerFlow('bad_deal', failingFlow('bad_deal') as never);

        const res = await engine.execute('bad_deal', recordChangeContext('deal_99'));
        expect(res.success).toBe(false);

        const [run] = await engine.listRuns('bad_deal', { limit: 1 });
        expect(run.status).toBe('failed');
        expect(run.trigger.recordId).toBe('deal_99');
    });

    it('distinguishes two runs of one flow by the record that caused each', async () => {
        // The reverse-correlation the card names: given a suspicious record,
        // find the runs it provoked. A single-run assertion cannot fail on a
        // mapping that stamps a constant.
        const engine = new AutomationEngine(silent);
        engine.registerFlow('multi', trivialFlow('multi') as never);

        await engine.execute('multi', recordChangeContext('deal_A'));
        await engine.execute('multi', recordChangeContext('deal_B'));

        const runs = await engine.listRuns('multi', { limit: 10 });
        expect(runs.map((r) => r.trigger.recordId).sort()).toEqual(['deal_A', 'deal_B']);
    });

    it('leaves recordId ABSENT for a record-less kind, and never blank-strings it', async () => {
        // `schedule` is the regression pin the card asks for: the six kinds all
        // recorded their runtime type before this change and must keep doing so.
        const engine = new AutomationEngine(silent);
        engine.registerFlow('nightly', trivialFlow('nightly') as never);

        await engine.execute('nightly', { event: 'schedule' } as AutomationContext);

        const [run] = await engine.listRuns('nightly', { limit: 1 });
        expect(run.trigger.type).toBe('schedule');
        // `undefined`, not `''` — an empty string would read as an attribution
        // this run does not have, and would match an `= ''` filter.
        expect(run.trigger.recordId).toBeUndefined();
        expect(run.trigger.object).toBeUndefined();
    });

    it('drops an empty-string record id rather than persisting it as an id', async () => {
        const engine = new AutomationEngine(silent);
        engine.registerFlow('blank', trivialFlow('blank') as never);

        await engine.execute('blank', {
            event: 'record-after-create', object: 'crm_deal', record: { id: '' },
        } as AutomationContext);

        const [run] = await engine.listRuns('blank', { limit: 1 });
        expect(run.trigger.type).toBe('record-after-create');
        expect(run.trigger.recordId).toBeUndefined();
    });
});

describe('#7533 gap 2 — trigger attribution survives a process restart', () => {
    it('a record_change run keeps its kind AND its record id across a cold restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerFlow('durable', trivialFlow('durable') as never);
        await engineA.execute('durable', recordChangeContext('deal_cold'));
        await flush();

        // A fresh engine over the same durable store: empty in-memory logs, so
        // every field below can only come from the persisted history row.
        const engineB = new AutomationEngine(silent, store);
        const [run] = await engineB.listRuns('durable', { limit: 10 });

        expect(run.trigger.type).toBe('record-after-update');
        expect(run.trigger.recordId).toBe('deal_cold');
        expect(run.trigger.object).toBe('crm_deal');
        expect(run.trigger.userId).toBe('u_writer');
    });

    it('getRun after a restart answers "what fired this?" — the audit read', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerFlow('audit', trivialFlow('audit') as never);
        await engineA.execute('audit', recordChangeContext('deal_audit'));
        await flush();

        const engineB = new AutomationEngine(silent, store);
        const [listed] = await engineB.listRuns('audit', { limit: 1 });
        const run = await engineB.getRun(listed.id);

        expect(run).not.toBeNull();
        expect(run!.trigger.type).toBe('record-after-update');
        expect(run!.trigger.recordId).toBe('deal_audit');
    });

    it('keeps the SIX kinds distinguishable after a restart (they were not)', async () => {
        // The card's exact restart symptom: "a scheduled run, a webhook intake
        // and a record change become indistinguishable rows". One flow per kind
        // so the assertion is about the trigger column, not about flow identity.
        const kinds = [
            'record-after-create', 'record-after-update', 'record-after-delete',
            'schedule', 'time_relative', 'api',
        ];
        // Flow names must match /^[a-z_][a-z0-9_]*$/, so the kind is slugged
        // for the flow name only — the asserted value is the raw kind.
        const flowOf = (kind: string) => `k_${kind.replace(/-/g, '_')}`;
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        for (const kind of kinds) {
            engineA.registerFlow(flowOf(kind), trivialFlow(flowOf(kind)) as never);
            await engineA.execute(flowOf(kind), { event: kind } as AutomationContext);
        }
        await flush();

        const engineB = new AutomationEngine(silent, store);
        const seen: string[] = [];
        for (const kind of kinds) {
            const [run] = await engineB.listRuns(flowOf(kind), { limit: 1 });
            seen.push(run.trigger.type);
        }
        expect(seen).toEqual(kinds);
        // Before #7533 this was the failure: six rows, six empty strings.
        expect(new Set(seen).size).toBe(6);
    });

    it('a failed run keeps its attribution across the restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engineA.registerFlow('bad_durable', failingFlow('bad_durable') as never);
        await engineA.execute('bad_durable', recordChangeContext('deal_dead'));
        await flush();

        const engineB = new AutomationEngine(silent, store);
        const [run] = await engineB.listRuns('bad_durable', { limit: 1 });
        expect(run.status).toBe('failed');
        expect(run.trigger.type).toBe('record-after-update');
        expect(run.trigger.recordId).toBe('deal_dead');
    });

    it('a pre-#7533 history row (no trigger columns) still rehydrates, as "not recorded"', async () => {
        // Backfill is not on the table: rows already written carry nothing, and
        // the read path must degrade rather than throw. `''` is what this method
        // returned for EVERY row before the change, so legacy rows are exactly
        // as informative as they were — no more, and no less.
        const store = new InMemorySuspendedRunStore();
        await store.recordTerminal({
            runId: 'legacy_1',
            flowName: 'legacy',
            status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z',
        });

        const engine = new AutomationEngine(silent, store);
        const [run] = await engine.listRuns('legacy', { limit: 1 });
        expect(run.trigger.type).toBe('');
        expect(run.trigger.recordId).toBeUndefined();
        expect(run.trigger.object).toBeUndefined();
    });
});
