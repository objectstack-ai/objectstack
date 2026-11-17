// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #34638 — the engine half: a {@link SubflowParentStrand} carries the refusal
 * the stranded PARENT met.
 *
 * `bubbleToParent` records the strand under the CHILD's run id when the parent
 * it resumes lands on the `'stranded'` exit; `takeSubflowParentStrand` hands it
 * to whichever caller resumed that child (the approvals decision and recall
 * doors). The parent's own result already carries `innerRefusal` /
 * `userMessage` (ruling B′ on #24914, `readCarriedRefusal` on the resume
 * catch arm); the record kept only `runId`, `repairable` and `error`, so the
 * caller that reads the strand could not tell WHY the parent stopped. The
 * record now carries the pair as the parent's result reported it.
 *
 * CONTROL: a parent that strands on a fault met no refusal, so the record
 * carries neither member — absent, never synthesised from `error`'s text.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';

const noopLogger: any = { info() {}, warn() {}, error() {}, debug() {} };
noopLogger.child = () => noopLogger;

const HOOK_DIAGNOSTIC = "hook 'alloc_plan_capacity_recheck' threw: Error: over_capacity";
const USER_TEXT = '产能已被其他订单占用，该方案无法按当前产能通过。';

/** A declared hook refusal as the runtime answers one. */
const hookRefusal = () => Object.assign(
    new Error(HOOK_DIAGNOSTIC),
    { name: 'SandboxError', innerMessage: USER_TEXT, code: 'VALIDATION_FAILED', status: 400, userMessage: USER_TEXT },
);
/** A fault: no declared HTTP answer, so no refusal is met. */
const fault = () => new Error('ECONNREFUSED: could not reach the store');

const CHILD = {
    name: 'child_flow',
    label: 'Child',
    type: 'autolaunched',
    nodes: [
        { id: 'cstart', type: 'start', label: 'Start' },
        { id: 'park', type: 'pauser', label: 'Park' },
        { id: 'cend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'c1', source: 'cstart', target: 'park' },
        { id: 'c2', source: 'park', target: 'cend' },
    ],
};

const PARENT = {
    name: 'parent_flow',
    label: 'Parent',
    type: 'autolaunched',
    nodes: [
        { id: 'pstart', type: 'start', label: 'Start' },
        { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child_flow' } },
        {
            id: 'adopt_plan', type: 'update_record', label: 'Adopt Plan',
            config: { objectName: 'alloc_plan', filter: { id: 'p1' }, fields: { status: 'settled' } },
        },
        { id: 'pend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'p1', source: 'pstart', target: 'sub' },
        { id: 'p2', source: 'sub', target: 'adopt_plan' },
        { id: 'p3', source: 'adopt_plan', target: 'pend' },
    ],
};

function boot(refusal: () => unknown) {
    const data = {
        async find() { return [{ id: 'p1', status: 'submitted' }]; },
        async update() { throw refusal(); },
    };
    const engine = new AutomationEngine(noopLogger, new InMemorySuspendedRunStore());
    const ctx = { logger: noopLogger, getService: (n: string) => (n === 'data' ? data : undefined) } as never;
    registerSubflowNode(engine, ctx);
    registerCrudNodes(engine, ctx);
    engine.registerNodeExecutor({
        type: 'pauser',
        descriptor: defineActionDescriptor({
            type: 'pauser', version: '1.0.0', name: 'pauser',
            supportsPause: true, resumeAuthority: 'any',
        }),
        async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor);
    engine.registerFlow('child_flow', CHILD as never);
    engine.registerFlow('parent_flow', PARENT as never);
    return engine;
}

async function strandThroughChild(engine: AutomationEngine) {
    const started = await engine.execute('parent_flow', { userId: 'rep' } as AutomationContext);
    expect(started.status).toBe('paused');
    const parentRunId = started.runId!;
    const childRunId = engine.listSuspendedRuns().find(r => r.flowName === 'child_flow')!.runId;
    expect((await engine.resume(childRunId)).success, "the child's own completion is genuine").toBe(true);
    expect((await engine.getRun(parentRunId))?.status).toBe('failed');
    return { parentRunId, strand: engine.takeSubflowParentStrand(childRunId) };
}

describe('#34638 — a subflow parent strand carries the refusal the parent met', () => {
    it('a parent refused by a record hook: the strand carries innerRefusal and the marked userMessage', async () => {
        const { parentRunId, strand } = await strandThroughChild(boot(hookRefusal));
        expect(strand).toMatchObject({
            runId: parentRunId,
            repairable: true,
            innerRefusal: { code: 'VALIDATION_FAILED', message: HOOK_DIAGNOSTIC },
            userMessage: USER_TEXT,
        });
        expect(strand?.error, 'the strand is the hook refusal, not another failure').toContain(HOOK_DIAGNOSTIC);
    });

    it('CONTROL — a parent that strands on a fault: neither member, absent rather than empty', async () => {
        const { parentRunId, strand } = await strandThroughChild(boot(fault));
        expect(strand).toMatchObject({ runId: parentRunId, repairable: true });
        expect(strand?.error, 'the strand is the fault, not another failure').toContain('ECONNREFUSED');
        expect(Object.keys(strand ?? {}).sort()).toEqual(['error', 'repairable', 'runId']);
    });
});
