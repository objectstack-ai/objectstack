// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression guard for the 2026-07-06 incident: a `record-after-update` flow
 * whose action writes back to its OWN trigger record re-fires itself. Normally
 * the start `condition` suppresses the second fire, but a broken guard makes it
 * INFINITE — HotCRM's `case_escalation` guards on `record.is_escalated != true`,
 * yet a `boolean` field persists as integer `1` on SQLite/libsql and CEL
 * `1 != true` is `true`, so it never trips. During first-boot seed (which awaits
 * automation to settle) that infinite cascade wedged the whole per-env kernel
 * build, leaving the environment unopenable.
 *
 * The engine now breaks the SAME flow re-entering for the SAME record while an
 * execution is still on the stack (see `activeRecordFlows`). This test drives
 * the exact shape: a node executor that re-invokes `execute()` for the same
 * flow+record, simulating the update→afterUpdate→dispatch→execute cascade.
 *
 * #8689 added the second describe block below: the breaker must be the BACKSTOP,
 * never the mechanism. It used to be checked ahead of the start-condition gate,
 * so on the re-entrant dispatch — the one dispatch where an author's re-fire
 * guard is load-bearing — the condition was never evaluated at all. The cases
 * there pin the ordering, that the breaker is unchanged in strength, and that a
 * dispatch which does NOT own the guard key cannot release it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationEngine } from './engine.js';

function createTestLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} } as any;
}

describe('AutomationEngine — record-flow re-entrancy loop guard', () => {
    let engine: AutomationEngine;
    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('breaks a self-triggering flow that re-fires for the same record', async () => {
        let executeCalls = 0;
        let skippedInner = false;

        // A node that mimics `case_escalation`'s action: it writes back to the
        // trigger record, which (in the real runtime) re-dispatches the same flow
        // for the same record. Here we invoke execute() directly to model that
        // synchronous cascade.
        engine.registerNodeExecutor({
            type: 'self_retrigger',
            async execute(_node, _vars, _ctx?: any) {
                executeCalls += 1;
                if (executeCalls > 50) throw new Error('INFINITE LOOP — guard failed to break re-entry');
                // Re-fire the SAME flow for the SAME record (the loop shape).
                const r = await engine.execute('looping_flow', {
                    record: { id: 'case-1', is_escalated: 1 }, // int 1, like SQLite
                    object: 'crm_case',
                    event: 'record-after-update',
                } as any);
                if ((r.output as any)?.reason === 'reentrancy_loop_guard') skippedInner = true;
                return { success: true };
            },
        });

        engine.registerFlow('looping_flow', {
            name: 'looping_flow',
            label: 'Looping',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'act', type: 'self_retrigger', label: 'Re-fire' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        });

        const result = await engine.execute('looping_flow', {
            record: { id: 'case-1', is_escalated: 1 },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);

        // The OUTER run completes; the INNER re-entry is broken by the guard
        // (not an infinite loop). executeCalls stays at 1 (the guard short-circuits
        // before the inner run reaches the node again).
        expect(result.success).toBe(true);
        expect(skippedInner).toBe(true);
        expect(executeCalls).toBe(1);
    });

    it('does NOT block a different record (legitimate cross-record fan-out)', async () => {
        const seen: string[] = [];
        engine.registerNodeExecutor({
            type: 'touch',
            async execute() { return { success: true }; },
        });
        engine.registerFlow('per_record', {
            name: 'per_record', label: 'Per record', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 't', type: 'touch', label: 'Touch' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 't' },
                { id: 'e2', source: 't', target: 'end' },
            ],
        });
        for (const id of ['a', 'b', 'c']) {
            const r = await engine.execute('per_record', { record: { id }, object: 'o', event: 'record-after-insert' } as any);
            if (r.success && !(r.output as any)?.reason) seen.push(id);
        }
        // All three distinct records run fully — the guard only trips on re-entry
        // for the SAME record while active.
        expect(seen).toEqual(['a', 'b', 'c']);
    });

    it('does NOT block a different flow on the same record (distinct-flow chain)', async () => {
        engine.registerNodeExecutor({ type: 'noop', async execute() { return { success: true }; } });
        for (const name of ['flow_x', 'flow_y']) {
            engine.registerFlow(name, {
                name, label: name, type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'n', type: 'noop', label: 'noop' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'n' },
                    { id: 'e2', source: 'n', target: 'end' },
                ],
            });
        }
        const rx = await engine.execute('flow_x', { record: { id: 'rec-1' }, object: 'o', event: 'record-after-update' } as any);
        const ry = await engine.execute('flow_y', { record: { id: 'rec-1' }, object: 'o', event: 'record-after-update' } as any);
        expect(rx.success).toBe(true);
        expect((rx.output as any)?.reason).toBeUndefined();
        expect(ry.success).toBe(true);
        expect((ry.output as any)?.reason).toBeUndefined();
    });
});

/**
 * #8689 — the breaker is the BACKSTOP; the start condition is the mechanism.
 *
 * Reported on 17.0.0 GA: a flow guarded on `status != "escalated"` whose action
 * writes `status = "escalated"` was still re-dispatched for the same record, and
 * only the breaker stopped it. Measured cause (the card named two candidates and
 * this is the one that is true): `execute()` checked the breaker BEFORE the
 * start-condition gate, so the re-entrant dispatch returned without the
 * condition ever being evaluated — not an evaluation that aborted, no evaluation
 * at all.
 *
 * These cases are deliberately the engine-level counterpart to
 * `trigger-record-change`'s `reentrant-start-condition.test.ts`: that one drives
 * a real kernel end-to-end through the BUILT engine, this one pins the ordering
 * against the source in this checkout, and adds the two properties an end-to-end
 * run cannot easily show — that the breaker still trips when the condition is
 * genuinely true on re-entry, and that tripping it does not release the outer
 * run's guard key.
 */
describe('AutomationEngine — the start condition is the loop mechanism, the breaker is the backstop (#8689)', () => {
    let engine: AutomationEngine;
    let warnings: string[];

    beforeEach(() => {
        warnings = [];
        const logger = createTestLogger();
        logger.warn = (message: string) => { warnings.push(String(message)); };
        engine = new AutomationEngine(logger);
    });

    const breakerWarnings = () => warnings.filter((w) => w.includes('re-entered for the same record'));

    /**
     * Registers `escalation_flow`: a `record-after-update` flow whose start
     * condition excludes already-escalated records, and whose action re-fires the
     * SAME flow for the SAME record with the record in its POST-write state —
     * exactly what the trigger does when the flow's own write lands.
     */
    function armSelfWritingFlow(condition: string, refireRecord: Record<string, unknown>) {
        const inner: Array<{ success: boolean; reason?: string }> = [];
        let actionRuns = 0;
        engine.registerNodeExecutor({
            type: 'escalate',
            async execute() {
                actionRuns += 1;
                if (actionRuns > 20) throw new Error('RUNAWAY — the loop never terminated');
                const r = await engine.execute('escalation_flow', {
                    record: refireRecord,
                    object: 'crm_case',
                    event: 'record-after-update',
                } as any);
                inner.push({ success: r.success, reason: (r.output as any)?.reason });
                return { success: true };
            },
        } as any);
        engine.registerFlow('escalation_flow', {
            name: 'escalation_flow',
            label: 'Escalation',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { condition } },
                { id: 'act', type: 'escalate', label: 'Escalate' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);
        return { inner, actionRuns: () => actionRuns };
    }

    it("evaluates the start condition on the re-entrant dispatch, so the AUTHOR's guard ends the loop", async () => {
        // Post-write state: `status` is now 'escalated', so the condition below
        // is false — the author's guard, not the breaker, must be what stops it.
        const { inner } = armSelfWritingFlow('record.status != "escalated"', {
            id: 'case-1',
            status: 'escalated',
        });

        const result = await engine.execute('escalation_flow', {
            record: { id: 'case-1', status: 'new' },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);

        expect(result.success).toBe(true);
        // The re-fire is refused by the CONDITION — the whole point. Before the
        // fix this read `reentrancy_loop_guard`: the same "loop stopped" outcome
        // reached by the wrong mechanism, which is why asserting termination
        // alone cannot pin this defect.
        expect(inner).toEqual([{ success: true, reason: 'condition_not_met' }]);
        expect(breakerWarnings(), 'the backstop was never consulted').toEqual([]);
    });

    it('STILL breaks the loop when the condition is genuinely true on re-entry (breaker unchanged)', async () => {
        // The 2026-07-06 shape: the guard does not exclude the flow's own write
        // (here `1 != true` is always true), so evaluation returns TRUE on the
        // re-fire and the backstop is the only thing left. It must still hold.
        const { inner, actionRuns } = armSelfWritingFlow('record.is_escalated != true', {
            id: 'case-1',
            is_escalated: 1,
        });

        const result = await engine.execute('escalation_flow', {
            record: { id: 'case-1', is_escalated: 1 },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);

        expect(result.success).toBe(true);
        expect(inner).toEqual([{ success: true, reason: 'reentrancy_loop_guard' }]);
        // Same depth as before the reorder: the action runs once, the re-entry is
        // cut at the guard.
        expect(actionRuns()).toBe(1);
        expect(breakerWarnings()).toHaveLength(1);
        // The message may now state the condition's verdict as FACT, because
        // reaching the breaker proves the condition was evaluated and was true.
        expect(breakerWarnings()[0]).toContain('WAS evaluated on this re-fire and returned true');
    });

    it("a dispatch that trips the breaker does NOT release the outer run's guard key", async () => {
        // The failure mode this pins is silent and severe: the guard key is
        // released in `execute()`'s `finally`, and a re-entrant dispatch now
        // returns from INSIDE that try. Releasing a key it never owned would
        // disarm the breaker for the run still on the stack, so the NEXT
        // re-entry in the same cascade would run the flow again — the runaway
        // the breaker exists to stop, reintroduced by the fix for #8689.
        //
        // Two re-entries are attempted from within one outer run; both must be
        // refused, and the action must run exactly once.
        const inner: Array<string | undefined> = [];
        let actionRuns = 0;
        engine.registerNodeExecutor({
            type: 'double_refire',
            async execute() {
                actionRuns += 1;
                if (actionRuns > 20) throw new Error('RUNAWAY — the outer key was released');
                for (let i = 0; i < 2; i++) {
                    const r = await engine.execute('hot_flow', {
                        record: { id: 'case-1', status: 'hot' },
                        object: 'crm_case',
                        event: 'record-after-update',
                    } as any);
                    inner.push((r.output as any)?.reason);
                }
                return { success: true };
            },
        } as any);
        engine.registerFlow('hot_flow', {
            name: 'hot_flow',
            label: 'Hot',
            type: 'autolaunched',
            // Condition stays TRUE on re-entry, so every re-fire reaches the
            // breaker — which is what makes key ownership observable.
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { condition: 'record.status == "hot"' } },
                { id: 'act', type: 'double_refire', label: 'Refire twice' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);

        const result = await engine.execute('hot_flow', {
            record: { id: 'case-1', status: 'hot' },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);

        expect(result.success).toBe(true);
        expect(inner).toEqual(['reentrancy_loop_guard', 'reentrancy_loop_guard']);
        expect(actionRuns, 'the action ran once; the outer run kept its key throughout').toBe(1);
        expect(breakerWarnings()).toHaveLength(2);
    });

    it('a condition-not-met dispatch releases nothing and blocks nothing afterwards', async () => {
        // The other non-owning exit: a run skipped by its condition never added
        // the key, so it must neither delete another run's key nor leave its own
        // behind (a leaked key would wedge every LATER write to that record —
        // the flow would look permanently dead).
        engine.registerNodeExecutor({ type: 'noop', async execute() { return { success: true }; } } as any);
        engine.registerFlow('gated_flow', {
            name: 'gated_flow',
            label: 'Gated',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { condition: 'record.status == "ready"' } },
                { id: 'act', type: 'noop', label: 'Act' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);

        const skipped = await engine.execute('gated_flow', {
            record: { id: 'case-9', status: 'draft' },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);
        expect((skipped.output as any)?.reason).toBe('condition_not_met');

        // The SAME record now qualifies: it must run, proving no key leaked.
        const ran = await engine.execute('gated_flow', {
            record: { id: 'case-9', status: 'ready' },
            object: 'crm_case',
            event: 'record-after-update',
        } as any);
        expect(ran.success).toBe(true);
        expect((ran.output as any)?.reason).toBeUndefined();
        expect(breakerWarnings()).toEqual([]);
    });

    it('a run that throws still releases its key (the flow is not wedged for that record)', async () => {
        // `reentryHeld` gates the release, so the throwing path must still clear
        // it — otherwise one failed run poisons the record forever.
        let attempts = 0;
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() {
                attempts += 1;
                if (attempts === 1) throw new Error('node exploded');
                return { success: true };
            },
        } as any);
        engine.registerFlow('boom_flow', {
            name: 'boom_flow',
            label: 'Boom',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { condition: 'record.status == "go"' } },
                { id: 'act', type: 'boom', label: 'Boom' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);

        const ctx = { record: { id: 'case-7', status: 'go' }, object: 'crm_case', event: 'record-after-update' };
        const failed = await engine.execute('boom_flow', ctx as any);
        expect(failed.success).toBe(false);

        const second = await engine.execute('boom_flow', ctx as any);
        expect(second.success, 'the key was released, so the record is not wedged').toBe(true);
        expect((second.output as any)?.reason).toBeUndefined();
        expect(breakerWarnings()).toEqual([]);
    });

    it('a flow with NO start condition is unaffected by the reorder', async () => {
        // The pre-existing behaviour the block above must not disturb: with no
        // gate to evaluate, the breaker is reached exactly as before.
        const seen: Array<string | undefined> = [];
        let runs = 0;
        engine.registerNodeExecutor({
            type: 'refire_plain',
            async execute() {
                runs += 1;
                if (runs > 20) throw new Error('RUNAWAY');
                const r = await engine.execute('plain_flow', {
                    record: { id: 'case-2' }, object: 'crm_case', event: 'record-after-update',
                } as any);
                seen.push((r.output as any)?.reason);
                return { success: true };
            },
        } as any);
        engine.registerFlow('plain_flow', {
            name: 'plain_flow', label: 'Plain', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'act', type: 'refire_plain', label: 'Refire' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);

        const r = await engine.execute('plain_flow', {
            record: { id: 'case-2' }, object: 'crm_case', event: 'record-after-update',
        } as any);
        expect(r.success).toBe(true);
        expect(seen).toEqual(['reentrancy_loop_guard']);
        expect(runs).toBe(1);
        expect(breakerWarnings()).toHaveLength(1);
    });

    it('the start condition is evaluated exactly ONCE per dispatch (the gate did not double)', async () => {
        // Guards the reorder against the other easy mistake: leaving the old
        // pre-guard evaluation in place and adding a second one.
        const spy = vi.spyOn(engine, 'evaluateCondition');
        engine.registerNodeExecutor({ type: 'noop2', async execute() { return { success: true }; } } as any);
        engine.registerFlow('once_flow', {
            name: 'once_flow', label: 'Once', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { condition: 'record.status == "ready"' } },
                { id: 'act', type: 'noop2', label: 'Act' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'act' },
                { id: 'e2', source: 'act', target: 'end' },
            ],
        } as any);

        await engine.execute('once_flow', {
            record: { id: 'case-3', status: 'ready' }, object: 'crm_case', event: 'record-after-update',
        } as any);

        const startCondCalls = spy.mock.calls.filter(([expr]) => {
            const source = typeof expr === 'string' ? expr : (expr as { source?: string })?.source;
            return source === 'record.status == "ready"';
        });
        expect(startCondCalls).toHaveLength(1);
        spy.mockRestore();
    });
});
