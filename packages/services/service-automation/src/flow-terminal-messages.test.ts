// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9414 — a TRIGGERED run carries the flow author's terminal messages.
 *
 * `AutomationResult` declares `successMessage` / `errorMessage` as a general
 * terminal-result feature (`packages/spec/src/contracts/automation-service.ts`):
 * "Friendly terminal messages copied from the flow definition … `successMessage`
 * is set on terminal success, `errorMessage` on failure."
 *
 * One producer honoured it. `resumeInternal` set both on its terminal returns;
 * `execute()` set neither, on either exit, and neither did `executeWithoutRetry`
 * or `retryExecution`. So the author's own words reached a caller ONLY when the
 * run happened to pause and be resumed. A flow dispatched straight through
 * `POST /api/v1/automation/:name/trigger` — or the legacy `trigger/:name` that
 * `client.automation.trigger()` calls — carried nothing, though the flow
 * declared the text and the contract says it is set. One declaration, two
 * behaviours chosen by ROUTE rather than by authoring.
 *
 * The consumer was already there and already reading: the trigger route carries
 * `errorMessage` into `error.details.errorMessage` (#9413), which is the one
 * place the console reads it from (objectui `flowResponse.ts`, PR #4899) — and
 * on the trigger path it was ALWAYS absent at the source, so every non-screen
 * flow fell back to the raw node error.
 *
 * **What is pinned here, and what deliberately is not.**
 *
 * The producer half lives in this package; the wire half is pinned one package
 * over, in `packages/runtime/src/domains/automation-trigger-route-status.test.ts`
 * (`carries the flow author's errorMessage in details, not folded into the
 * message`), which drives the route with a scripted `AutomationResult` because
 * `@objectstack/runtime` does not depend on this engine. The two meet on the
 * result shape, so these tests assert the fields that test scripts —
 * `success`/`status`/`error`/`errorMessage` — rather than only the message.
 *
 * ⚠️ Direction, predicted before running (the #9085 lesson: a pin that is green
 * both before and after the fix is measuring the wrong thing). The four tests
 * under "the defect" FAIL against an unfixed `engine.ts` — `undefined` where the
 * author's text is expected. The three under "the boundary" and the one under
 * "the symmetry anchor" are green either way ON PURPOSE: they are not evidence
 * of the repair, they fence it, and each says which side it guards.
 *
 * ⚠️ A test that exercised `resume()` alone would prove nothing at all here:
 * that path already worked, and the asymmetry between the two paths IS the
 * defect. The single resume test below exists only to state the behaviour the
 * execute path is being aligned to, so a later one-sided edit breaks something.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

const SUCCESS_TEXT = 'Opportunity created — the owner has been notified.';
const ERROR_TEXT = 'We could not create the opportunity — check the amount and try again.';

/** The raw node failure. Deliberately unlike ERROR_TEXT: the two must not be confusable. */
const RAW_FAILURE = 'downstream 503';

/**
 * A one-node flow the author gave both terminal messages. `startCondition`
 * seeds the skip fixture; `errorHandling` seeds the retry fixtures.
 */
function messageFlow(
    name: string,
    opts: { errorHandling?: unknown; startCondition?: string; withMessages?: boolean } = {},
) {
    const withMessages = opts.withMessages ?? true;
    return {
        name,
        label: name,
        type: 'autolaunched',
        ...(withMessages ? { successMessage: SUCCESS_TEXT, errorMessage: ERROR_TEXT } : {}),
        ...(opts.errorHandling ? { errorHandling: opts.errorHandling } : {}),
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                ...(opts.startCondition ? { config: { condition: opts.startCondition } } : {}),
            },
            { id: 'work', type: 'script', label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'work' },
            { id: 'e1', source: 'work', target: 'end' },
        ],
    };
}

/**
 * An engine whose single `script` node behaves as `outcome` says. `'fail_then_pass'`
 * fails the first attempt and passes afterwards — the retry-succeeds fixture, which
 * leaves through `executeWithoutRetry`'s success exit rather than `execute()`'s.
 */
function engineWith(outcome: 'pass' | 'fail' | 'fail_then_pass') {
    const engine = new AutomationEngine(createTestLogger());
    const runs = { count: 0 };
    engine.registerNodeExecutor({
        type: 'script',
        async execute() {
            runs.count++;
            const fails = outcome === 'fail' || (outcome === 'fail_then_pass' && runs.count === 1);
            return fails ? { success: false, error: RAW_FAILURE } : { success: true, output: { ok: true } };
        },
    } as never);
    return { engine, runs };
}

/** `maxRetries: 1` is the smallest count the schema allows under `'retry'` (#4247). */
const RETRY_ONCE = { strategy: 'retry', maxRetries: 1, backoffMs: 0 };

describe('#9414 — the defect: execute() drops the author\'s terminal messages', () => {
    it('terminal SUCCESS on the trigger path carries successMessage', async () => {
        const { engine } = engineWith('pass');
        engine.registerFlow('notify_owner', messageFlow('notify_owner') as never);

        const result = await engine.execute('notify_owner');

        expect(result.success).toBe(true);
        // The defect: `undefined` here, on every run that did not pause.
        expect(result.successMessage).toBe(SUCCESS_TEXT);
        // Still a terminal result in every other respect — the message is
        // added to the exit, it does not replace what the exit already said.
        expect(result.summary).toBeDefined();
        expect(typeof result.durationMs).toBe('number');
    });

    it('terminal FAILURE on the trigger path carries errorMessage BESIDE the raw error', async () => {
        const { engine } = engineWith('fail');
        engine.registerFlow('notify_owner', messageFlow('notify_owner') as never);

        const result = await engine.execute('notify_owner');

        expect(result.success).toBe(false);
        // The defect: `undefined`, so `error.details.errorMessage` was never
        // populated on this route and the console showed RAW_FAILURE instead.
        expect(result.errorMessage).toBe(ERROR_TEXT);
        // Beside, not instead of: the raw text stays in `error` for logs and
        // diagnostics, and the transport folds THAT into the envelope message.
        expect(result.error).toContain(RAW_FAILURE);
        expect(result.error).not.toContain(ERROR_TEXT);
        // The classification the route reads to answer 400 `FLOW_FAILED`
        // (#9378) is untouched — this is the same exit, with one more field.
        expect(result.status).toBe('failed');
    });

    it('the retry-EXHAUSTED exit carries errorMessage — a different exit from execute()\'s own', async () => {
        // `strategy: 'retry'` hands off to `retryExecution`, so `execute()`'s
        // failure return is never reached. Fixing only that one would leave the
        // author's message missing for the runs most likely to need it.
        const { engine, runs } = engineWith('fail');
        engine.registerFlow('notify_owner', messageFlow('notify_owner', { errorHandling: RETRY_ONCE }) as never);

        const result = await engine.execute('notify_owner');

        expect(runs.count).toBe(2); // initial attempt + 1 retry: the loop really ran
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe(ERROR_TEXT);
    });

    it('a run that succeeds on a LATER attempt carries successMessage', async () => {
        // This result comes out of `executeWithoutRetry` — `retryExecution`
        // returns it verbatim — so `successMessage` must be produced there too,
        // or the message becomes a function of which attempt happened to work.
        const { engine, runs } = engineWith('fail_then_pass');
        engine.registerFlow('notify_owner', messageFlow('notify_owner', { errorHandling: RETRY_ONCE }) as never);

        const result = await engine.execute('notify_owner');

        expect(runs.count).toBe(2);
        expect(result.success).toBe(true);
        expect(result.successMessage).toBe(SUCCESS_TEXT);
    });
});

describe('#9414 — the boundary: which exits must NOT carry a message', () => {
    // ⚠️ Green before and after the repair, deliberately. These fence the fix
    // rather than demonstrate it: each one is an exit a later "for consistency"
    // tidy-up would be tempted to stamp, and stamping it would be wrong.

    it('a SKIPPED run carries neither — nothing ran, so there is nothing to toast', async () => {
        const { engine, runs } = engineWith('pass');
        engine.registerFlow(
            'notify_owner',
            messageFlow('notify_owner', { startCondition: 'amount > 1000' }) as never,
        );

        const result = await engine.execute('notify_owner', {
            event: 'test',
            record: { id: 'opp_1', amount: 5 },
        } as unknown as AutomationContext);

        expect(runs.count).toBe(0);
        expect((result.output as Record<string, unknown>)?.reason).toBe('condition_not_met');
        // `success: true` here means "the trigger was handled", not "the flow
        // finished". Showing "Opportunity created!" would be a toast about work
        // nobody did — the same reason this exit carries no `summary`.
        expect(result.successMessage).toBeUndefined();
        expect(result.summary).toBeUndefined();
    });

    it('a NEVER-DISPATCHED exit carries neither — a disabled flow has no terminal state', async () => {
        const { engine } = engineWith('pass');
        engine.registerFlow('notify_owner', messageFlow('notify_owner') as never);
        engine.toggleFlow('notify_owner', false);

        const result = await engine.execute('notify_owner');

        expect(result.success).toBe(false);
        expect(result.code).toBe('FLOW_DISABLED');
        // `status` absent is what proves the transport reads a verdict rather
        // than guessing (#9378/#9415); `errorMessage` must not become a second
        // channel that says "this run failed" for a run that never started.
        expect(result.status).toBeUndefined();
        expect(result.errorMessage).toBeUndefined();
    });

    it('a flow that declares no messages gets no invented text', async () => {
        const { engine } = engineWith('fail');
        engine.registerFlow('quiet_flow', messageFlow('quiet_flow', { withMessages: false }) as never);

        const result = await engine.execute('quiet_flow');

        expect(result.success).toBe(false);
        // Copied from the definition or absent — the engine never synthesizes a
        // friendly message, so a caller can tell "the author wrote one" from
        // "the author did not" and fall back on its own terms.
        expect(result.errorMessage).toBeUndefined();
        expect(result.error).toContain(RAW_FAILURE);
    });
});

describe('#9414 — the symmetry anchor: resume() already did this', () => {
    // ⚠️ Green before and after, on purpose. `resumeInternal` was the ONE
    // producer honouring the declaration, and the repair above is defined as
    // "symmetric with it". Pinning it keeps a later one-sided edit — narrowing
    // this path instead of widening that one — from passing silently.

    it('a resumed run still carries successMessage on its terminal exit', async () => {
        const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
        engine.registerNodeExecutor({
            type: 'approval_pause',
            descriptor: defineActionDescriptor({
                type: 'approval_pause',
                version: '1.0.0',
                name: 'approval_pause',
                supportsPause: true,
                resumeAuthority: 'any',
            }),
            async execute() {
                return { success: true, suspend: true, correlation: 'approval:req' };
            },
        } as never);
        engine.registerFlow('approve_it', {
            name: 'approve_it',
            label: 'approve_it',
            type: 'autolaunched',
            successMessage: SUCCESS_TEXT,
            errorMessage: ERROR_TEXT,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'gate', type: 'approval_pause', label: 'Gate' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'gate' },
                { id: 'e1', source: 'gate', target: 'end' },
            ],
        } as never);

        const paused = await engine.execute('approve_it');
        expect(paused.status).toBe('paused');
        // The pause is NOT terminal, so it carries no message of its own —
        // the run has not finished doing anything to report.
        expect(paused.successMessage).toBeUndefined();

        const done = await engine.resume(paused.runId as string, { output: { verdict: 'approved' } } as never);

        expect(done.success).toBe(true);
        expect(done.successMessage).toBe(SUCCESS_TEXT);
    });
});
