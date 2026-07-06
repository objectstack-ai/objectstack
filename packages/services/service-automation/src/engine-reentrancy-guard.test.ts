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
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
