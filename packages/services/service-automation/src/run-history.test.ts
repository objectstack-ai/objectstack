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
