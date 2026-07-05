// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Automation run observability: every TERMINAL run (completed / failed) must be
// mirrored to the durable store so "did it run / fail, and why?" survives a
// process restart and the in-memory ring-buffer eviction — and `listRuns` must
// merge that history. Persisting is best-effort: a history-write failure must
// never break the run that produced it.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

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

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('automation run history (durable observability)', () => {
    it('persists a completed run to the durable store', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('ok_flow', trivialFlow('ok_flow') as never);

        const res = await engine.execute('ok_flow', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(true);
        await flush(); // recordTerminal is fire-and-forget

        const hist = await store.listHistory('ok_flow', 10);
        expect(hist).toHaveLength(1);
        expect(hist[0].status).toBe('completed');
        expect(hist[0].flowName).toBe('ok_flow');
    });

    it('persists a failed run WITH its error reason (the designer-facing "why")', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engine.registerFlow('bad_flow', failingFlow('bad_flow') as never);

        const res = await engine.execute('bad_flow', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(false);
        await flush();

        const hist = await store.listHistory('bad_flow', 10);
        expect(hist).toHaveLength(1);
        expect(hist[0].status).toBe('failed');
        expect(hist[0].error ?? '').toMatch(/kaboom/);
    });

    it('listRuns merges durable history so runs survive a process restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerFlow('surv', trivialFlow('surv') as never);
        await engineA.execute('surv', { event: 'test' } as AutomationContext);
        await flush();

        // Simulate a restart: a fresh engine (empty in-memory logs) sharing the
        // same durable store. Before this feature its listRuns would be empty.
        const engineB = new AutomationEngine(silent, store);
        const runs = await engineB.listRuns('surv', { limit: 10 });
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('completed');
        expect(runs[0].id).toBeTruthy();
    });

    it('getRun falls back to durable history after a restart, WITH step detail (#2585)', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engineA.registerFlow('bad_flow', failingFlow('bad_flow') as never);
        await engineA.execute('bad_flow', { event: 'test' } as AutomationContext);
        await flush();

        // Simulate a restart: a fresh engine with empty in-memory logs. Before
        // #2585 its getRun returned null even though the history row existed.
        const engineB = new AutomationEngine(silent, store);
        const [listed] = await engineB.listRuns('bad_flow', { limit: 1 });
        const run = await engineB.getRun(listed.id);
        expect(run).not.toBeNull();
        expect(run!.status).toBe('failed');
        expect(run!.error ?? '').toMatch(/kaboom/);
        // Durable single-run detail: the persisted step log names the node that
        // blew up (stacks are stripped — code/message is the designer-facing why).
        const failedStep = run!.steps.find((s) => s.status === 'failure');
        expect(failedStep?.nodeId).toBe('boom');
        expect(failedStep?.error?.message).toMatch(/kaboom/);
        expect(failedStep?.error?.stack).toBeUndefined();
    });

    it('getRun returns null for an unknown run id even with a store attached', async () => {
        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        expect(await engine.getRun('run_nope')).toBeNull();
    });

    it('caps terminal history per flow (retention stop-gap, #2585)', async () => {
        const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 2 });
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('busy', trivialFlow('busy') as never);
        engine.registerFlow('other', trivialFlow('other') as never);

        for (let i = 0; i < 5; i++) {
            await engine.execute('busy', { event: 'test' } as AutomationContext);
        }
        await engine.execute('other', { event: 'test' } as AutomationContext);
        await flush();

        // Only the newest 2 'busy' runs survive; the cap is per flow, so the
        // single 'other' run is untouched.
        expect(await store.listHistory('busy', 10)).toHaveLength(2);
        expect(await store.listHistory('other', 10)).toHaveLength(1);
    });

    it('a failing history store never breaks the run (best-effort isolation)', async () => {
        const store = new InMemorySuspendedRunStore();
        // Override recordTerminal to reject — the run must still complete.
        (store as unknown as { recordTerminal: () => Promise<void> }).recordTerminal = async () => {
            throw new Error('history db down');
        };
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('resilient', trivialFlow('resilient') as never);

        const res = await engine.execute('resilient', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(true); // the run is unaffected by the persist failure
        await flush();
    });
});
