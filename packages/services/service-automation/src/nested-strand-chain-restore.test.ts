// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15222 — the operator exit reaches a NESTED run: a stranded descendant's
 * cascade-failed ancestors are journalled too, and the chain is re-armed as
 * one unit, leaf-first.
 *
 * ## The condition these pins are an exit from
 *
 * `resumeInternal`'s catch arm journals the consumed suspension of THE RUN
 * THAT THREW. For a nested run the ancestors were then handled on both paths
 * with no journal at all:
 *
 *  - up-bubble (`skipBubble === false`): `failAncestors` walks `$parentRunId`
 *    and calls `failSuspendedRun` on each suspended ancestor;
 *  - delegation (the parent resumed first, the child resumed with
 *    `skipBubble === true`): the parent frame sees `!childRes.success` with no
 *    retryable code and calls `failSuspendedRun` on itself.
 *
 * `failSuspendedRun` is `forgetSuspendedRun(run, 'failed')` plus a `failed`
 * log record — it journalled NOTHING. So the child was restorable while every
 * ancestor was recorded `failed` with its pause consumed and no snapshot
 * (`restoreConsumedSuspension(PARENT)` answered `NO_CONSUMED_SUSPENSION`), and
 * restoring the child completed it into a parent that never continues:
 * `bubbleToParent` finds no parent suspension and logs. **The operator ended
 * up worse off than before using the exit.**
 *
 * ## The direction
 *
 * #13937's shape-4 ruling (maintainer 2026-09-01, director decision batch
 * #21) applied to a nested run: the consumption ORDER does not move, and the
 * explicit operator verb is what re-arms. So the repair is "journal each
 * consumed ancestor too, and re-arm leaf-first". The resume-ordering
 * alternative (do not fail ancestors while a descendant is repairable) is
 * ruled out by that same ruling's point 3 and is not implemented here.
 *
 * ## ⛔ The fence these pins hold in the negative direction
 *
 * A cascade-failed ancestor is **never stamped `stranded`**. `'stranded'` is
 * the resume result of the one exit that consumed its own pause and then threw
 * downstream; an ancestor did neither. Stamping it would make an operator
 * retry a recovery that reads as "not fixed yet" rather than "that is not the
 * shape of this". The ancestor's repairability is carried by the journal and
 * by the restore verb's answer, never by that word.
 *
 * ## What is EARNED rather than assumed
 *
 * An ancestor's pause is journalled exactly when the descendant whose failure
 * consumed it is itself repairable. The last test is the firing control on
 * that: a cascade from a descendant that is NOT repairable journals nothing,
 * so the verb still answers `NO_CONSUMED_SUSPENSION` and no repair is promised
 * that could not be delivered.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';

type Line = { level: string; args: unknown[] };
function recordingLogger() {
    const lines: Line[] = [];
    const mk = (level: string) => (...args: unknown[]) => { lines.push({ level, args }); };
    const self: any = {
        lines,
        info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug'),
        child() { return self; },
    };
    return self as { lines: Line[] } & Record<string, any>;
}

/** Leaf: parks, then runs a node that can be made to throw. */
const CHILD = {
    name: 'child_flow',
    label: 'Child',
    type: 'autolaunched',
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

const PARENT = {
    name: 'parent_flow',
    label: 'Parent',
    type: 'autolaunched',
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

/** Grandparent, for the three-level ordering pin. */
const GRAND = {
    name: 'grand_flow',
    label: 'Grand',
    type: 'autolaunched',
    nodes: [
        { id: 'gstart', type: 'start', label: 'Start' },
        { id: 'gsub', type: 'subflow', label: 'Sub', config: { flowName: 'parent_flow' } },
        { id: 'gafter', type: 'pmark', label: 'After' },
        { id: 'gend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'g1', source: 'gstart', target: 'gsub' },
        { id: 'g2', source: 'gsub', target: 'gafter' },
        { id: 'g3', source: 'gafter', target: 'gend' },
    ],
};

const DOWNSTREAM_FAILURE = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

describe('#15222 — a stranded leaf leaves a RESTORABLE ancestor chain', () => {
    let logger: ReturnType<typeof recordingLogger>;
    let store: InMemorySuspendedRunStore;
    let engine: AutomationEngine;
    let childThrows: string | undefined;

    function wire(target: AutomationEngine) {
        registerSubflowNode(target, { logger, getService() { throw new Error('none'); } } as never);
        target.registerNodeExecutor({
            type: 'pauser',
            descriptor: defineActionDescriptor({
                type: 'pauser', version: '1.0.0', name: 'pauser',
                supportsPause: true, resumeAuthority: 'any',
            }),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
        target.registerNodeExecutor({
            type: 'cmark',
            async execute() {
                if (childThrows) throw new Error(childThrows);
                return { success: true };
            },
        } as NodeExecutor);
        target.registerNodeExecutor({ type: 'pmark', async execute() { return { success: true }; } } as NodeExecutor);
        target.registerFlow('child_flow', CHILD as never);
        target.registerFlow('parent_flow', PARENT as never);
        target.registerFlow('grand_flow', GRAND as never);
    }

    beforeEach(() => {
        childThrows = undefined;
        logger = recordingLogger();
        store = new InMemorySuspendedRunStore();
        engine = new AutomationEngine(logger as never, store);
        wire(engine);
    });

    /** Park a two-level tree: the parent at its `subflow` node, the child at `park`. */
    async function park(): Promise<{ parentRunId: string; childRunId: string }> {
        const started = await engine.execute('parent_flow', {} as AutomationContext);
        expect(started.status, 'the parent parks awaiting its child').toBe('paused');
        const parentRunId = started.runId!;
        const parked = engine.listSuspendedRuns();
        const child = parked.find(r => r.flowName === 'child_flow');
        expect(parked.find(r => r.runId === parentRunId)?.correlation).toBe(`subflow:${child?.runId}`);
        return { parentRunId, childRunId: child!.runId };
    }

    it('UP-BUBBLE — the cascade-failed parent is journalled, so the verb reaches it', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;

        const stranded = await engine.resume(childRunId);

        // The condition, established rather than assumed.
        expect(stranded.status, 'the leaf IS the run that stranded').toBe('stranded');
        expect(await engine.hasSuspendedRun(parentRunId), 'the cascade consumed the parent pause').toBe(false);
        expect((await engine.getRun(parentRunId))?.status, 'and recorded it terminal').toBe('failed');

        // THE DEFECT, in one line: this answered `NO_CONSUMED_SUSPENSION`.
        const inspected = await engine.inspectConsumedSuspension(parentRunId);
        expect(inspected.repairable, 'the ancestor now has a snapshot to put back').toBe(true);

        // ⛔ THE FENCE: repairable, and still not `stranded`. The word belongs
        // to the one exit that consumed its OWN pause and then threw.
        expect(stranded.status).toBe('stranded');
        expect((await engine.getRun(parentRunId))?.status).not.toBe('stranded');
    });

    it('UP-BUBBLE — one restore from the leaf re-arms the chain, and the continuation reaches the parent', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;
        expect((await engine.resume(childRunId)).status).toBe('stranded');

        const restored = await engine.restoreConsumedSuspension(childRunId, { requestedBy: 'ops' });

        expect(restored.restored, 'the named run').toBe(true);
        expect(restored.chain?.map(m => m.runId), 'leaf-first, the whole chain in one call')
            .toEqual([childRunId, parentRunId]);
        expect(restored.chain?.every(m => m.restored), 'every member re-armed').toBe(true);
        expect(await engine.hasSuspendedRun(childRunId)).toBe(true);
        expect(await engine.hasSuspendedRun(parentRunId)).toBe(true);

        // Re-issue the continuation on the leaf — the whole point of the exit.
        childThrows = undefined;
        expect((await engine.resume(childRunId)).success).toBe(true);

        // …and the parent CONTINUED. Before this card it stayed `failed` for
        // ever while `bubbleToParent` logged that it could not find a pause.
        expect((await engine.getRun(parentRunId))?.status, 'the tree completed').toBe('completed');
    });

    it('DELEGATION — the parent frame carries NO status, and the chain is still restorable from either end', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;

        // Resuming the PARENT forwards the signal down; the child strands with
        // `skipBubble`, so the parent frame fails itself.
        const frame = await engine.resume(parentRunId);

        expect(frame.success).toBe(false);
        // ⛔ THE FENCE, as a pin: nothing can re-arm an ancestor by resuming
        // it, so the word that promises exactly that is never stamped here.
        expect(frame.status, 'the parent frame is neither stranded nor repairable-by-status').toBeUndefined();
        expect((await engine.getRun(parentRunId))?.status).toBe('failed');

        // Named from the TOP of the chain: the verb walks down to the leaf and
        // re-arms leaf-first, so an operator who names the run they can see
        // gets the same repair.
        const fromTop = await engine.restoreConsumedSuspension(parentRunId, { requestedBy: 'ops' });
        expect(fromTop.restored).toBe(true);
        expect(fromTop.chain?.map(m => m.runId)).toEqual([childRunId, parentRunId]);
        expect(await engine.hasSuspendedRun(childRunId)).toBe(true);
        expect(await engine.hasSuspendedRun(parentRunId)).toBe(true);

        childThrows = undefined;
        expect((await engine.resume(parentRunId)).success, 'the delegation runs again, clean').toBe(true);
        expect((await engine.getRun(parentRunId))?.status).toBe('completed');
    });

    it('IDEMPOTENCE, per run in the chain — a second restore mints no second pause', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;
        await engine.resume(childRunId);
        expect((await engine.restoreConsumedSuspension(childRunId)).restored).toBe(true);

        const again = await engine.restoreConsumedSuspension(childRunId);

        expect(again.restored, 'nothing was put back by THIS call').toBe(false);
        expect(again.refusal).toBe('RUN_SUSPENDED');
        // Both members are already parked, so the chain collapses to the named
        // run — there is nothing left to walk.
        expect(again.chain).toBeUndefined();
        expect((await store.list()).filter(r => r.runId === parentRunId).length, 'one pause per run').toBe(1);
        expect((await store.list()).filter(r => r.runId === childRunId).length).toBe(1);
    });

    it('THREE LEVELS — every consumed ancestor is journalled and re-armed leaf-first', async () => {
        const started = await engine.execute('grand_flow', {} as AutomationContext);
        const grandRunId = started.runId!;
        const parked = engine.listSuspendedRuns();
        const parentRunId = parked.find(r => r.flowName === 'parent_flow')!.runId;
        const childRunId = parked.find(r => r.flowName === 'child_flow')!.runId;
        childThrows = DOWNSTREAM_FAILURE;

        expect((await engine.resume(childRunId)).status).toBe('stranded');
        for (const id of [parentRunId, grandRunId]) {
            expect((await engine.getRun(id))?.status, `${id} cascade-failed`).toBe('failed');
        }

        const restored = await engine.restoreConsumedSuspension(childRunId);

        expect(restored.chain?.map(m => m.runId), 'leaf, then up — a fixed order')
            .toEqual([childRunId, parentRunId, grandRunId]);
        childThrows = undefined;
        expect((await engine.resume(childRunId)).success).toBe(true);
        expect((await engine.getRun(grandRunId))?.status, 'the whole tree completed').toBe('completed');
    });

    it('DURABLE — a fresh process restores the chain from the terminal rows alone', async () => {
        const { parentRunId, childRunId } = await park();
        childThrows = DOWNSTREAM_FAILURE;
        await engine.resume(childRunId);

        // A replica that never held the hot journal: same store, new engine.
        const fresh = new AutomationEngine(logger as never, store);
        wire(fresh);

        const restored = await fresh.restoreConsumedSuspension(childRunId, { requestedBy: 'ops' });

        expect(restored.restored, 'the ancestor snapshot reached the durable row').toBe(true);
        expect(restored.chain?.map(m => m.runId)).toEqual([childRunId, parentRunId]);
        childThrows = undefined;
        expect((await fresh.resume(childRunId)).success).toBe(true);
        expect((await fresh.getRun(parentRunId))?.status).toBe('completed');
    });

    it('CONTROL — a cascade from a descendant that is NOT repairable journals nothing', async () => {
        // The firing control on "journalled exactly when the descendant is
        // repairable". The child's flow is gone, so its resume answers
        // `RUN_NOT_FOUND` — the engine's terminal "this pause is gone for
        // good" class, which no retry fixes and which journals no snapshot.
        // The parent is still cascade-failed, and the verb must NOT promise a
        // repair that could never re-arm the leaf.
        const { parentRunId, childRunId } = await park();
        engine.unregisterFlow('child_flow');

        const frame = await engine.resume(parentRunId);

        expect(frame.success).toBe(false);
        expect((await engine.getRun(parentRunId))?.status).toBe('failed');
        expect((await engine.inspectConsumedSuspension(childRunId)).repairable, 'the leaf never stranded').toBe(false);
        const refused = await engine.restoreConsumedSuspension(parentRunId);
        expect(refused.restored).toBe(false);
        expect(refused.refusal).toBe('NO_CONSUMED_SUSPENSION');
        expect(refused.chain, 'no chain was walked').toBeUndefined();
    });
});
