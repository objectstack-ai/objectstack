// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AutomationResult.flowLabel` — the flow's authored `label`, on the result.
 *
 * A flow runner names the flow it is running (the runner header, the
 * completion toast) and translates that name against `flows.<flow>.label`,
 * falling back to the authored label. The client holds only the flow's API
 * name, so the authored label has to arrive on the result — copied from the
 * definition the same way `successMessage` / `errorMessage` are.
 *
 * The served shape, member by member (the contract's docblock is the
 * authority; these tests are its pins):
 *
 *  - PRESENT on every result of an evaluation of a registered flow: `paused`
 *    (first attempt, a retry attempt, a resume that pauses again, a subflow
 *    chain that pauses again), terminal success (trigger, retry attempt,
 *    resume, and the two skip exits), `failed` (trigger, retry exhausted),
 *    `stranded`, `refused` (trigger and resume), and a resumed parent whose
 *    delegated child failed.
 *  - ABSENT on every refusal carrying a `code` (the run never dispatched, or
 *    a resume never continued it) and when the flow is not registered.
 *  - SUBFLOW: always the label of the run the caller addressed — the parent —
 *    never the child the screen came from.
 *  - VERBATIM: the authored string, ⛔ never the API name. `FlowSchema`
 *    requires `label`, so a flow without one never registers and there is no
 *    "absent label" arm to serve; the empty string is the case a server-side
 *    name fallback would betray, so it is pinned as served verbatim.
 *
 * ⚠️ Direction, predicted before running: every PRESENT pin fails against an
 * engine without the member (`undefined` where the label is expected); every
 * ABSENT pin is green either way on purpose — they fence the boundary rather
 * than demonstrate the change.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function pluginCtx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** Deliberately unlike the API names, so a name fallback cannot pass a pin. */
const PARENT_LABEL = 'Approve Large Orders';
const CHILD_LABEL = 'Collect Order Details';
const WIZARD_LABEL = 'Order Intake Wizard';

const REQUIRED_KIND = [{ name: 'kind', label: 'Kind', type: 'text', required: true }];

type Step = { id: string; type: string; label?: string; config?: Record<string, unknown> };

/** A straight-line flow: start → ...steps → end, one default edge between each pair. */
function chain(
    name: string,
    label: string,
    steps: Step[],
    opts: { startConfig?: Record<string, unknown>; endConfig?: Record<string, unknown>; flow?: Record<string, unknown> } = {},
) {
    const nodes = [
        { id: 'start', type: 'start', label: 'Start', ...(opts.startConfig ? { config: opts.startConfig } : {}) },
        ...steps.map((s) => ({ label: s.id, ...s })),
        { id: 'end', type: 'end', label: 'End', ...(opts.endConfig ? { config: opts.endConfig } : {}) },
    ];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id, type: 'default' }));
    return { name, label, type: 'autolaunched', status: 'active', version: 1, nodes, edges, ...opts.flow };
}

const ASK: Step = { id: 'ask', type: 'screen', config: { fields: REQUIRED_KIND } };
const ASK_AGAIN: Step = { id: 'ask_again', type: 'screen', config: { fields: [{ name: 'note', label: 'Note', type: 'text' }] } };

describe('AutomationResult.flowLabel — the authored flow label rides the result', () => {
    let engine: AutomationEngine;
    let flakyCalls: number;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, pluginCtx());
        flakyCalls = 0;
        engine.registerNodeExecutor({
            type: 'work',
            async execute() { return { success: true }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() { return { success: false, error: 'downstream 503' }; },
        } as NodeExecutor);
        // Fails its first call only — the retry-attempt fixture.
        engine.registerNodeExecutor({
            type: 'flaky',
            async execute() {
                flakyCalls++;
                return flakyCalls === 1 ? { success: false, error: 'transient' } : { success: true };
            },
        } as NodeExecutor);
    });

    describe('present — every evaluation of a registered flow', () => {
        it('terminal success on the trigger path', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', PARENT_LABEL, [{ id: 'w', type: 'work' }]) as never);

            const res = await engine.execute('approve_orders');

            expect(res.success).toBe(true);
            expect(res.status).toBeUndefined();
            expect(res.flowLabel).toBe(PARENT_LABEL);
        });

        it('paused at a screen on the trigger path — the runner header\'s source', async () => {
            engine.registerFlow('intake', chain('intake', WIZARD_LABEL, [ASK]) as never);

            const res = await engine.execute('intake');

            expect(res.status).toBe('paused');
            expect(res.screen?.nodeId).toBe('ask');
            expect(res.flowLabel).toBe(WIZARD_LABEL);
        });

        it('a resume that pauses again, then a resume that completes — the completion toast\'s source', async () => {
            engine.registerFlow('intake', chain('intake', WIZARD_LABEL, [ASK, ASK_AGAIN]) as never);
            const started = await engine.execute('intake');

            const next = await engine.resume(started.runId!, { variables: { kind: 'vip' } });
            expect(next.status).toBe('paused');
            expect(next.screen?.nodeId).toBe('ask_again');
            expect(next.flowLabel).toBe(WIZARD_LABEL);

            const done = await engine.resume(started.runId!, { variables: { note: 'rush' } });
            expect(done.success).toBe(true);
            expect(done.status).toBeUndefined();
            expect(done.flowLabel).toBe(WIZARD_LABEL);
        });

        it('failed on the trigger path, beside errorMessage', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', PARENT_LABEL, [{ id: 'b', type: 'boom' }], {
                flow: { errorMessage: 'Could not approve.' },
            }) as never);

            const res = await engine.execute('approve_orders');

            expect(res.status).toBe('failed');
            expect(res.errorMessage).toBe('Could not approve.');
            expect(res.flowLabel).toBe(PARENT_LABEL);
        });

        it('failed after the retry budget is exhausted — the definition this dispatch started under', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', PARENT_LABEL, [{ id: 'b', type: 'boom' }], {
                flow: { errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 } },
            }) as never);

            const res = await engine.execute('approve_orders');

            expect(res.status).toBe('failed');
            expect(res.flowLabel).toBe(PARENT_LABEL);
        });

        it('success and pause on a RETRY attempt — executeWithoutRetry\'s exits', async () => {
            const retry = { flow: { errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 } } };
            engine.registerFlow('flaky_done', chain('flaky_done', PARENT_LABEL, [{ id: 'f', type: 'flaky' }], retry) as never);
            const done = await engine.execute('flaky_done');
            expect(flakyCalls).toBe(2);
            expect(done.success).toBe(true);
            expect(done.flowLabel).toBe(PARENT_LABEL);

            flakyCalls = 0;
            engine.registerFlow('flaky_ask', chain('flaky_ask', WIZARD_LABEL, [{ id: 'f', type: 'flaky' }, ASK], retry) as never);
            const paused = await engine.execute('flaky_ask');
            expect(flakyCalls).toBe(2);
            expect(paused.status).toBe('paused');
            expect(paused.flowLabel).toBe(WIZARD_LABEL);
        });

        it('stranded — a resume consumed the pause and a downstream node threw', async () => {
            engine.registerFlow('intake', chain('intake', WIZARD_LABEL, [ASK, { id: 'b', type: 'boom' }]) as never);
            const started = await engine.execute('intake');

            const res = await engine.resume(started.runId!, { variables: { kind: 'vip' } });

            expect(res.status).toBe('stranded');
            expect(res.flowLabel).toBe(WIZARD_LABEL);
        });

        it('refused — on the trigger path and on the resume path (the one finishRefusedRun chokepoint)', async () => {
            const refuse = { endConfig: { outcome: 'refused', message: 'Not eligible' } };
            engine.registerFlow('gate', chain('gate', PARENT_LABEL, [{ id: 'w', type: 'work' }], refuse) as never);
            const triggered = await engine.execute('gate');
            expect(triggered.status).toBe('refused');
            expect(triggered.successMessage).toBeUndefined();
            expect(triggered.flowLabel).toBe(PARENT_LABEL);

            engine.registerFlow('gate_ask', chain('gate_ask', WIZARD_LABEL, [ASK], refuse) as never);
            const started = await engine.execute('gate_ask');
            const resumed = await engine.resume(started.runId!, { variables: { kind: 'vip' } });
            expect(resumed.status).toBe('refused');
            expect(resumed.flowLabel).toBe(WIZARD_LABEL);
        });

        it('the skip exit — a 200 a runner can receive, though no node ran', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', PARENT_LABEL, [{ id: 'w', type: 'work' }], {
                startConfig: { condition: 'false' },
            }) as never);

            const res = await engine.execute('approve_orders');

            expect(res.output).toEqual({ skipped: true, reason: 'condition_not_met' });
            // A skip still claims no work done: no toast text, no counts.
            expect(res.successMessage).toBeUndefined();
            expect(res.summary).toBeUndefined();
            expect(res.flowLabel).toBe(PARENT_LABEL);
        });

        it('VERBATIM — an empty authored label is served empty, never replaced by the API name', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', '', [{ id: 'w', type: 'work' }]) as never);

            const res = await engine.execute('approve_orders');

            expect(res.success).toBe(true);
            expect(res.flowLabel).toBe('');
        });
    });

    describe('subflow chains — the addressed (parent) run\'s label, never the child\'s', () => {
        beforeEach(() => {
            engine.registerFlow('collect_details', chain('collect_details', CHILD_LABEL, [ASK, ASK_AGAIN], {
                flow: { type: 'screen' },
            }) as never);
            engine.registerFlow('collect_then_fail', chain('collect_then_fail', CHILD_LABEL, [ASK, { id: 'b', type: 'boom' }], {
                flow: { type: 'screen' },
            }) as never);
        });

        const parent = (child: string) => chain('approve_orders', PARENT_LABEL, [
            { id: 'call', type: 'subflow', config: { flowName: child } },
            { id: 'w', type: 'work' },
        ]);

        it('paused on the child\'s screen, re-paused on the next one, then completed — the parent\'s label throughout', async () => {
            engine.registerFlow('approve_orders', parent('collect_details') as never);

            const started = await engine.execute('approve_orders');
            expect(started.status).toBe('paused');
            expect(started.screen?.nodeId).toBe('ask');
            expect(started.flowLabel).toBe(PARENT_LABEL);

            const next = await engine.resume(started.runId!, { variables: { kind: 'vip' } });
            expect(next.status).toBe('paused');
            expect(next.runId).toBe(started.runId);
            expect(next.screen?.nodeId).toBe('ask_again');
            expect(next.flowLabel).toBe(PARENT_LABEL);

            const done = await engine.resume(started.runId!, { variables: { note: 'rush' } });
            expect(done.success).toBe(true);
            expect(done.flowLabel).toBe(PARENT_LABEL);
        });

        it('a delegated child that fails terminally — the parent\'s failure carries the parent\'s label', async () => {
            engine.registerFlow('approve_orders', parent('collect_then_fail') as never);
            const started = await engine.execute('approve_orders');

            const res = await engine.resume(started.runId!, { variables: { kind: 'vip' } });

            expect(res.success).toBe(false);
            expect(res.error).toContain('subflow run');
            expect(res.flowLabel).toBe(PARENT_LABEL);
        });

        it('a delegated child\'s screen refusal passes through with NO label — neither the child\'s nor the parent\'s', async () => {
            engine.registerFlow('approve_orders', parent('collect_details') as never);
            const started = await engine.execute('approve_orders');

            const res = await engine.resume(started.runId!, { variables: {} });

            expect(res.code).toBe('INVALID_SCREEN_INPUT');
            expect(res).not.toHaveProperty('flowLabel');
        });
    });

    describe('absent — a refusal carrying `code`, or no registered flow', () => {
        it('never-dispatched refusals: FLOW_DISABLED and FLOW_NO_START_NODE', async () => {
            engine.registerFlow('approve_orders', chain('approve_orders', PARENT_LABEL, [{ id: 'w', type: 'work' }]) as never);
            await engine.toggleFlow('approve_orders', false);
            const disabled = await engine.execute('approve_orders');
            expect(disabled.code).toBe('FLOW_DISABLED');
            expect(disabled).not.toHaveProperty('flowLabel');

            engine.registerFlow('no_start', {
                name: 'no_start', label: PARENT_LABEL, type: 'autolaunched',
                nodes: [{ id: 'end', type: 'end', label: 'End' }], edges: [],
            } as never);
            const noStart = await engine.execute('no_start');
            expect(noStart.code).toBe('FLOW_NO_START_NODE');
            expect(noStart).not.toHaveProperty('flowLabel');
        });

        it('resume refusals: INVALID_SCREEN_INPUT and RUN_NOT_FOUND', async () => {
            engine.registerFlow('intake', chain('intake', WIZARD_LABEL, [ASK]) as never);
            const started = await engine.execute('intake');

            const invalid = await engine.resume(started.runId!, { variables: {} });
            expect(invalid.code).toBe('INVALID_SCREEN_INPUT');
            expect(invalid).not.toHaveProperty('flowLabel');

            const missing = await engine.resume('run_that_never_was', { variables: {} });
            expect(missing.code).toBe('RUN_NOT_FOUND');
            expect(missing).not.toHaveProperty('flowLabel');
        });

        it('an unregistered flow', async () => {
            const res = await engine.execute('nobody_registered_this');

            expect(res.success).toBe(false);
            expect(res).not.toHaveProperty('flowLabel');
        });
    });
});
