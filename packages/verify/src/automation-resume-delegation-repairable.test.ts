// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17541 — the subflow DELEGATION exit tells the truth about repair ON THE
 * WIRE, driven through the real engine and the real route.
 *
 * ## The reading this file exists for
 *
 * `POST /automation/parent_flow/runs/:parentRunId/resume` on a parked
 * delegation whose child then throws answered, before this card:
 *
 * ```json
 * 400 { "success": false, "error": { "code": "FLOW_FAILED",
 *       "message": "subflow run 'run_…' (child_flow) failed: …",
 *       "details": { "runId": "run_…", "repairable": false } } }
 * ```
 *
 * …while the very same parent run was, at that same instant,
 * `inspectConsumedSuspension → { repairable: true, witness: 'journal' }` and
 * `restoreConsumedSuspension → { restored: true, chain: [child, parent] }`.
 * The wire told an operator not to retry a repair that works.
 *
 * ## Why the delegation exit carries no status, and why that is right
 *
 * A caller resumes the PARENT; `resumeInternal` forwards the signal down; the
 * child strands with `skipBubble`; the parent frame sees a failed child with
 * no retryable code and fails itself. It stamps NOTHING, deliberately —
 * nothing re-arms an ancestor by resuming it, so stamping `'stranded'` there
 * would send an operator to retry a recovery that cannot succeed (the fence
 * #15222 was dispatched with, and it is untouched by this card). Since #15222
 * the ancestor's consumed pause is journalled anyway, and ONE restore re-arms
 * the whole chain leaf-first. So the run is repairable while carrying no word
 * that says so — which is why the door must ASK the engine
 * (`IAutomationService.inspectConsumedSuspension`, #15358) rather than read a
 * stamp that is not there.
 *
 * ## The controls
 *
 * Two, and each fires:
 *
 *  - the **non-delegation** stranded exit — resume the CHILD directly — still
 *    answers `status: 'stranded'` with `repairable: true`, byte for byte what
 *    it answered before this card. The change is confined to the arm that
 *    reports no status.
 *  - a delegation whose leaf is **not** repairable answers `repairable:
 *    false` on that same status-less arm. Without it this file would pass
 *    over a door that simply flipped the arm to `true` and asked nothing.
 *
 * Engine-level halves, not re-pinned here:
 * `service-automation`'s `nested-strand-chain-restore.test.ts` (the chain) and
 * `consumed-suspension-inspection.test.ts` (the read-only verdict). The
 * door's own shaping, arm by arm with a fake service:
 * `packages/runtime`'s `automation-resume-delegation-repairable.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import {
    AutomationEngine,
    InMemorySuspendedRunStore,
    installBuiltinNodes,
} from '@objectstack/service-automation';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { ResumeFailureDetailsSchema } from '@objectstack/spec/api';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

const DOWNSTREAM_FAILURE = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/** Leaf: parks at `pauser`, then runs a node that can be made to throw. */
const CHILD = {
    name: 'child_flow', label: 'Child', type: 'autolaunched',
    nodes: [
        { id: 'cstart', type: 'start', label: 'Start' },
        { id: 'park', type: 'pauser', label: 'Park' },
        { id: 'cwrite', type: 'cmark', label: 'Write' },
        { id: 'cend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'c1', source: 'cstart', target: 'park' },
        { id: 'c2', source: 'park', target: 'cwrite' },
        { id: 'c3', source: 'cwrite', target: 'cend' },
    ],
};

/** Parent: parks at its `subflow` node while the child is suspended. */
const PARENT = {
    name: 'parent_flow', label: 'Parent', type: 'autolaunched',
    nodes: [
        { id: 'pstart', type: 'start', label: 'Start' },
        { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child_flow' } },
        { id: 'after', type: 'pmark', label: 'After' },
        { id: 'pend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'p1', source: 'pstart', target: 'sub' },
        { id: 'p2', source: 'sub', target: 'after' },
        { id: 'p3', source: 'after', target: 'pend' },
    ],
};

describe('#17541 — the delegation exit answers repairable from the engine, on the wire', () => {
    let engine: AutomationEngine;
    let dispatcher: HttpDispatcher;
    let childThrows: string | undefined;

    beforeEach(() => {
        childThrows = undefined;
        const logger = createTestLogger();
        engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
        installBuiltinNodes(engine, { logger, getService() { throw new Error('none'); } } as never);
        engine.registerNodeExecutor({
            type: 'pauser',
            descriptor: defineActionDescriptor({
                type: 'pauser', version: '1.0.0', name: 'pauser',
                supportsPause: true, resumeAuthority: 'any',
            }),
            async execute() { return { success: true, suspend: true }; },
        } as never);
        engine.registerNodeExecutor({
            type: 'cmark',
            async execute() {
                if (childThrows) throw new Error(childThrows);
                return { success: true };
            },
        } as never);
        engine.registerNodeExecutor({ type: 'pmark', async execute() { return { success: true }; } } as never);
        engine.registerFlow('child_flow', CHILD as never);
        engine.registerFlow('parent_flow', PARENT as never);

        const services: Record<string, unknown> = { automation: engine };
        const resolve = (name: string): unknown => services[name];
        const kernel = {
            getService: resolve,
            getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
            context: { getService: resolve },
        };
        dispatcher = new HttpDispatcher(kernel as never);
    });

    /** Park the two-level tree through the trigger door; hand back both ids. */
    async function park(): Promise<{ parentRunId: string; childRunId: string }> {
        const started = await dispatcher.handleAutomation('/parent_flow/trigger', 'POST', {}, CTX);
        expect(started.response?.status).toBe(200);
        expect(started.response?.body?.data?.status, 'the parent parks awaiting its child').toBe('paused');
        const parentRunId = started.response?.body?.data?.runId as string;
        const childRunId = engine.listSuspendedRuns().find(r => r.flowName === 'child_flow')!.runId;
        expect(typeof parentRunId).toBe('string');
        expect(typeof childRunId).toBe('string');
        return { parentRunId, childRunId };
    }

    it('DELEGATION — the 400 answers repairable: true with NO status, and the operator verb accepts exactly that run', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;

        const res = await dispatcher.handleAutomation(`/parent_flow/runs/${parentRunId}/resume`, 'POST', {}, CTX);

        expect(res.response?.status).toBe(400);
        const error = res.response?.body?.error;
        expect(error?.code).toBe('FLOW_FAILED');
        // The verdict, on the wire. ⛔ Still no `status` — the producer stamped
        // none and the door does not invent one; `repairable` is the answer.
        expect(error?.details).toEqual({ runId: parentRunId, repairable: true });
        expect(error?.details?.status).toBeUndefined();
        expect(ResumeFailureDetailsSchema.safeParse(error?.details).success).toBe(true);
        // The message names the failure, never the verdict — no regex client.
        expect(error?.message).toContain(DOWNSTREAM_FAILURE);
        expect(error?.message).not.toMatch(/repairable/i);

        // ONE FACT, STATED TWICE: `repairable: true` on the wire ⇔ the operator
        // verb accepts THIS run. A wire that promised a repair the verb refuses
        // would be worse than the under-report it replaces.
        expect(await engine.hasSuspendedRun(parentRunId), 'the delegation consumed the parent pause').toBe(false);
        const restored = await engine.restoreConsumedSuspension(parentRunId, { requestedBy: 'ops' });
        expect(restored.restored).toBe(true);
        expect(restored.chain?.map(m => m.runId), 'leaf-first, the whole chain').toEqual([childRunId, parentRunId]);

        // …and the repair the wire pointed at really completes the tree.
        childThrows = undefined;
        const again = await dispatcher.handleAutomation(`/parent_flow/runs/${parentRunId}/resume`, 'POST', {}, CTX);
        expect(again.response?.status).toBe(200);
        expect((await engine.getRun(parentRunId))?.status).toBe('completed');
    });

    it('CONTROL — the non-delegation stranded exit is unchanged: status stranded, repairable true', async () => {
        // The up-bubble path: the caller resumes the CHILD, whose own pause was
        // consumed, so the engine stamps `'stranded'` and the stamp answers.
        const { childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;

        const res = await dispatcher.handleAutomation(`/child_flow/runs/${childRunId}/resume`, 'POST', {}, CTX);

        expect(res.response?.status).toBe(400);
        expect(res.response?.body?.error?.code).toBe('FLOW_FAILED');
        expect(res.response?.body?.error?.details).toMatchObject({
            runId: childRunId, status: 'stranded', repairable: true,
        });
    });

    it('FIRING CONTROL — a delegation whose leaf is NOT repairable answers repairable: false on the same status-less arm', async () => {
        // The child's flow is gone, so its resume is the engine's terminal
        // "this pause is gone for good" class: nothing is journalled for the
        // ancestor, and the restore verb has nothing to put back. The door
        // must relay THAT — it is the same arm, and it answers `false`.
        const { parentRunId } = await park();
        engine.unregisterFlow('child_flow');

        const res = await dispatcher.handleAutomation(`/parent_flow/runs/${parentRunId}/resume`, 'POST', {}, CTX);

        expect(res.response?.status).toBe(400);
        expect(res.response?.body?.error?.details).toEqual({ runId: parentRunId, repairable: false });
        expect(res.response?.body?.error?.details?.status).toBeUndefined();
        const refused = await engine.restoreConsumedSuspension(parentRunId);
        expect(refused.restored, 'and the wire agreed with the verb').toBe(false);
        expect(refused.refusal).toBe('NO_CONSUMED_SUSPENSION');
    });
});
