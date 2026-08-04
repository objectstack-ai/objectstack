// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';

/**
 * #4247 — how many times does a flow that asked to retry actually retry?
 *
 * There used to be two answers. `FlowSchema` declared
 * `errorHandling.maxRetries` with `.default(0)`; `retryExecution` read
 * `errorHandling.maxRetries ?? 3`. `??` only fires on `undefined`, so the
 * winner was decided by ROUTE, not by authoring: a flow parsed by the schema
 * carried an explicit `0` and never retried, while a hand-built object handed
 * straight to the engine kept `undefined` and retried three times. Same
 * authored intent ("I didn't write a count"), two behaviors.
 *
 * The resolution is contract-first (AGENTS.md Prime Directive #12): the spec
 * holds the only defaults, the engine reads the parsed block with no `??` of
 * its own, and the one combination that was inert either way —
 * `strategy: 'retry'` with zero attempts — is refused at authoring rather than
 * silently behaving like `strategy: 'fail'`.
 *
 * These tests pin the count itself, because that is the part a reader cannot
 * confirm from the schema alone: `maxRetries` is RETRIES, so the flow runs
 * `maxRetries + 1` times in total.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** An always-failing single-node flow that counts how many times it ran. */
function failingFlowEngine(errorHandling: unknown) {
    const engine = new AutomationEngine(createTestLogger());
    const runs = { count: 0 };

    engine.registerNodeExecutor({
        type: 'script',
        async execute() {
            runs.count++;
            return { success: false, error: 'downstream 503' };
        },
    });

    const register = () => engine.registerFlow('retrying', {
        name: 'retrying',
        label: 'Retrying',
        type: 'autolaunched',
        errorHandling,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'work', type: 'script' as any, label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'work' },
            { id: 'e1', source: 'work', target: 'end' },
        ],
    } as any);

    return { engine, runs, register };
}

describe('#4247 — the retry count comes from the flow, not from the engine', () => {
    it('runs maxRetries + 1 times: the initial attempt plus the declared retries', async () => {
        const { engine, runs, register } = failingFlowEngine({
            strategy: 'retry',
            maxRetries: 2,
            backoffMs: 0,
        });
        register();

        const result = await engine.execute('retrying');

        expect(result.success).toBe(false);
        // 1 initial attempt + 2 retries. Neither 1 (the old parsed-flow
        // behavior for an unstated count) nor 4 (the old `?? 3` fallback).
        expect(runs.count).toBe(3);
    });

    it('honours a one-attempt retry — the smallest count the schema now allows', async () => {
        const { engine, runs, register } = failingFlowEngine({
            strategy: 'retry',
            maxRetries: 1,
            backoffMs: 0,
        });
        register();

        await engine.execute('retrying');

        expect(runs.count).toBe(2);
    });

    it("refuses `strategy: 'retry'` with no maxRetries instead of guessing a count", () => {
        const { register } = failingFlowEngine({ strategy: 'retry', backoffMs: 0 });

        // The pre-#4247 outcomes were "registers, never retries" (schema route)
        // and "registers, retries 3×" (direct route). Now it is neither: the
        // flow does not register at all, and the error says what to write.
        expect(register).toThrow(/maxRetries/);
        expect(register).toThrow(/strategy: 'fail'/);
    });

    it("refuses `strategy: 'retry'` with an explicit maxRetries: 0 — that is `'fail'`", () => {
        const { register } = failingFlowEngine({ strategy: 'retry', maxRetries: 0, backoffMs: 0 });

        expect(register).toThrow(/maxRetries/);
    });

    it("leaves the retry knobs alone under 'fail' — a fully spelled-out block stays legal", async () => {
        const { engine, runs, register } = failingFlowEngine({
            strategy: 'fail',
            maxRetries: 0,
            backoffMs: 0,
            backoffMultiplier: 1,
            maxRetryDelayMs: 0,
            jitter: false,
        });
        register();

        const result = await engine.execute('retrying');

        expect(result.success).toBe(false);
        expect(runs.count).toBe(1);
    });

    it('hands retryExecution a fully-populated block — the engine needs no fallback of its own', async () => {
        const { engine, register } = failingFlowEngine({
            strategy: 'retry',
            maxRetries: 1,
            backoffMs: 0,
        });
        register();

        // `this.flows` only ever holds `FlowSchema.parse` output, so every knob
        // `retryExecution` destructures is present without a `??`. This is the
        // invariant that made deleting the engine-side defaults safe — if a
        // future schema change made one of these optional again, the engine
        // would stop compiling rather than quietly re-invent a default.
        const stored = await engine.getFlow('retrying');
        expect(stored?.errorHandling).toMatchObject({
            strategy: 'retry',
            maxRetries: 1,
            backoffMs: 0,
            backoffMultiplier: 1,
            maxRetryDelayMs: 30000,
            jitter: false,
        });
    });
});
