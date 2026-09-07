// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15221 — the stranded verdict reaches the WIRE, driven through the real
 * engine: `POST /automation/:name/runs/:runId/resume` on a run that consumed
 * its pause and then failed downstream answers `400 FLOW_FAILED` whose
 * `error.details` carry `status: 'stranded'`, `repairable: true` and the
 * `runId` — the #16472 family ruling (maintainer 2026-09-07, option A).
 *
 * Why a real engine and not the dispatcher's fake: the dispatcher-level pins
 * (`packages/runtime`'s `automation-resume-stranded-details.test.ts`) prove
 * the door SHAPES what it is given; this proves the engine GIVES it — that
 * the producer's `'stranded'` stamp (`resumeInternal`'s catch arm,
 * `stranded-run-status.test.ts`) and the door's forwarding meet on one wire,
 * which is the exact seam the card measured as broken: a contract member
 * (`data.status: 'stranded'`, parity-pinned to `AutomationResult`) that no
 * door could put on the wire.
 *
 * Two facts are held equal, the way the engine's own pin holds them: the wire
 * says `repairable: true` ⇔ `restoreConsumedSuspension` accepts the run. A
 * wire that promised a repair the verb refuses would be worse than the
 * silence it replaces.
 *
 * CONTROL: the same flow with a downstream node that does NOT throw resumes
 * to a 200 — the structure is a property of the failure arm, not of the
 * route.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { ResumeFailureDetailsSchema } from '@objectstack/spec/api';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/**
 * `resumeAuthority: 'any'` so the generic resume route is the intended door
 * (an `approval` pause is `'service'`-owned and answers 403 long before the
 * terminal arm — the populations do not overlap).
 */
const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold',
    supportsPause: true, resumeAuthority: 'any',
});
const tailDescriptor = defineActionDescriptor({ type: 'tail', version: '1.0.0', name: 'tail' });

/** start → hold (pauses) → tail (throws, or not) → end. */
const STRAND_FLOW = {
    name: 'strand_flow', label: 'Strand', type: 'autolaunched',
    errorMessage: 'Please contact support',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'tail', type: 'tail', label: 'Tail' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'tail' },
        { id: 'e3', source: 'tail', target: 'end' },
    ],
};

function boot(opts: { tailThrows: boolean }) {
    const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req_1' };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'tail',
        descriptor: tailDescriptor,
        async execute() {
            if (opts.tailThrows) throw new Error('tail blew up');
            return { success: true, output: { done: true } };
        },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);

    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
        context: { getService: resolve },
    };
    return { engine, dispatcher: new HttpDispatcher(kernel as never) };
}

/** Trigger through the door, and hand back the paused run's id off the 200. */
async function park(dispatcher: HttpDispatcher): Promise<string> {
    const started = await dispatcher.handleAutomation('/strand_flow/trigger', 'POST', {}, CTX);
    expect(started.response?.status).toBe(200);
    expect(started.response?.body?.data?.status).toBe('paused');
    const runId = started.response?.body?.data?.runId as string;
    expect(typeof runId).toBe('string');
    return runId;
}

describe('#15221 — the wire carries the engine\'s stranded verdict through the resume door', () => {
    it('a resume that consumed the pause and failed downstream answers 400 FLOW_FAILED with status stranded, repairable true and the runId', async () => {
        const { engine, dispatcher } = boot({ tailThrows: true });
        const runId = await park(dispatcher);

        const result = await dispatcher.handleAutomation(`/strand_flow/runs/${runId}/resume`, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        const error = result.response?.body?.error;
        expect(error?.code).toBe('FLOW_FAILED');
        // The verdict, on the wire, by name.
        expect(error?.details).toMatchObject({ runId, status: 'stranded', repairable: true });
        // Beside the artefacts that were already there — neither displaced.
        expect(error?.details?.errorMessage).toBe('Please contact support');
        expect(error?.details?.summary?.nodes?.some((n: { status?: string }) => n.status === 'failure')).toBe(true);
        // Typed: the spec's declaration parses the whole `details` object.
        expect(ResumeFailureDetailsSchema.safeParse(error?.details).success).toBe(true);
        // Not prose: the message names the failure, not the verdict.
        expect(error?.message).toContain('tail blew up');
        expect(error?.message).not.toMatch(/strand/i);

        // One fact stated twice: `repairable: true` on the wire ⇔ the operator
        // verb accepts exactly this run — and `resume` no longer can (the
        // pause is gone), which is what makes the door's verdict worth having.
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        const again = await dispatcher.handleAutomation(`/strand_flow/runs/${runId}/resume`, 'POST', {}, CTX);
        expect(again.response?.status).toBe(404);
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored).toBe(true);
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
    });

    it('CONTROL — the same flow whose downstream node succeeds resumes to 200 with no error envelope', async () => {
        const { dispatcher } = boot({ tailThrows: false });
        const runId = await park(dispatcher);

        const result = await dispatcher.handleAutomation(`/strand_flow/runs/${runId}/resume`, 'POST', {}, CTX);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.success).toBe(true);
        expect(result.response?.body?.error).toBeUndefined();
    });
});
