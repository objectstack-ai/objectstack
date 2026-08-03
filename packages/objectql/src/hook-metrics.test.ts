// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { InMemoryHookMetricsRecorder } from './hook-metrics.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
    return {
        object: 'account',
        event: 'beforeInsert',
        input: { data: { name: 'acme' } },
        ql: undefined,
        ...overrides,
    } as HookContext;
}

describe('hook metrics', () => {
    it('records success outcome with non-negative duration', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        const hook: Hook = {
            name: 'h_ok',
            object: 'account',
            events: ['beforeInsert'],
            priority: 100,
            handler: async () => { /* noop */ },
        };
        bindHooksToEngine(engine, [hook], { packageId: 'p', metrics });

        await engine.triggerHooks('beforeInsert', makeCtx());

        const snap = metrics.snapshot();
        expect(snap.executions).toHaveLength(1);
        expect(snap.executions[0]).toMatchObject({ hook: 'h_ok', outcome: 'success', count: 1 });
        expect(snap.executions[0].totalMs).toBeGreaterThanOrEqual(0);
    });

    it('records error outcome and rethrows', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        const hook: Hook = {
            name: 'h_err',
            object: 'account',
            events: ['beforeInsert'],
            priority: 100,
            handler: async () => { throw new Error('boom'); },
        };
        bindHooksToEngine(engine, [hook], { packageId: 'p', metrics });

        await expect(engine.triggerHooks('beforeInsert', makeCtx())).rejects.toThrow(/boom/);

        const snap = metrics.snapshot();
        expect(snap.executions[0]).toMatchObject({ hook: 'h_err', outcome: 'error', count: 1 });
    });

    it('records timeout outcome when handler exceeds timeout', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        const hook: Hook = {
            name: 'h_timeout',
            object: 'account',
            events: ['beforeInsert'],
            priority: 100,
            timeout: 10,
            handler: async () => new Promise((r) => setTimeout(r, 100)),
        };
        bindHooksToEngine(engine, [hook], { packageId: 'p', metrics });

        await expect(engine.triggerHooks('beforeInsert', makeCtx())).rejects.toThrow(/timed out/);

        const snap = metrics.snapshot();
        expect(snap.executions[0]).toMatchObject({ hook: 'h_timeout', outcome: 'timeout', count: 1 });
    });

    it('records skip when condition is falsy', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        const hook: Hook = {
            name: 'h_cond',
            object: 'account',
            events: ['beforeInsert'],
            priority: 100,
            // [#4775] Was a bare `name == "skipme"`. Hook conditions are
            // `record`-scoped, so the bare identifier resolved to nothing and
            // the expression FAULTED on every call — the "skip" this test
            // asserted came from the old swallow (fault → warn → false), not
            // from a condition that answered NO. `record.name` is the same
            // intent, actually evaluated: 'acme' != 'skipme' ⇒ FALSE ⇒ skip.
            condition: 'record.name == "skipme"',
            handler: async () => { /* noop */ },
        };
        bindHooksToEngine(engine, [hook], { packageId: 'p', metrics });

        await engine.triggerHooks('beforeInsert', makeCtx());

        const snap = metrics.snapshot();
        expect(snap.executions).toHaveLength(0);
        expect(snap.skips[0]).toMatchObject({ hook: 'h_cond', reason: 'condition', count: 1 });
    });

    it('records retry attempts', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        let attempts = 0;
        const hook: Hook = {
            name: 'h_retry',
            object: 'account',
            events: ['beforeInsert'],
            priority: 100,
            retryPolicy: { maxRetries: 2, backoffMs: 0 },
            handler: async () => {
                attempts += 1;
                if (attempts < 3) throw new Error('flaky');
            },
        };
        bindHooksToEngine(engine, [hook], { packageId: 'p', metrics });

        await engine.triggerHooks('beforeInsert', makeCtx());

        const snap = metrics.snapshot();
        expect(attempts).toBe(3);
        expect(snap.retries).toEqual([{ hook: 'h_retry', count: 2 }]);
        expect(snap.executions[0]).toMatchObject({ hook: 'h_retry', outcome: 'success', count: 1 });
    });

    it('engine.setHookMetricsRecorder propagates to bindHooks', async () => {
        const engine = new ObjectQL();
        const metrics = new InMemoryHookMetricsRecorder();
        engine.setHookMetricsRecorder(metrics);
        engine.bindHooks([
            {
                name: 'h_default',
                object: 'account',
                events: ['beforeInsert'],
                priority: 100,
                handler: async () => { /* noop */ },
            } as Hook,
        ], { packageId: 'p' });

        await engine.triggerHooks('beforeInsert', makeCtx());

        expect(metrics.snapshot().executions[0]).toMatchObject({ hook: 'h_default', outcome: 'success' });
    });
});
