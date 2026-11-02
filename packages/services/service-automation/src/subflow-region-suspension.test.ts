// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28897] A `subflow` / `map` call inside a region body (a `loop` body, a
// `parallel` branch, a `try_catch` slot) whose child flow can suspend.
//
// A region body cannot carry a durable pause (#3267, ruling D on #15646). When
// such a child suspends, the run fails at the region boundary with the named
// refusal (`region-suspension-refusal.ts`, #18881), and nothing after the
// container runs. Two halves are pinned here:
//
//  1. The arming gate meets it first. A caller whose region-nested call names
//     a child that can suspend is registered but not armed, with its own
//     `unboundCause`, `suspending_subflow_in_region`, naming the region node,
//     the call node and where the child suspends. It is asked again whenever a
//     flow its calls reach is registered, as the #28840 save-notice half is.
//  2. A run that meets the refusal anyway (a direct execute, or a caller
//     armed under a reading the gate could not see) no longer leaves the child
//     run it started parked. Measured before this change: the child stayed
//     `paused` in the durable store, and a later resume ran the rest of the
//     child for a caller that had already failed, then failed to resume that
//     caller. The refusal now cancels the child run, and any run that child is
//     parked on, through the engine's own `cancelRun`.
//
// Neither half changes the refusal itself (code, text, un-routability) or
// `FLOW_PAUSE_CAPABLE_NODE_TYPES`.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import {
    registerSubflowNode,
    registerMapNode,
    registerLoopNode,
    registerParallelNode,
    registerTryCatchNode,
    registerWaitNode,
    registerLogicNodes,
} from './builtin/index.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

const declineWarnings = (logger: any, caller: string): string[] =>
    logger.warn.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes(`Flow '${caller}'`) && m.includes('NOT armed'));

function recordingTrigger() {
    const bound = new Set<string>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, _cb: (ctx: AutomationContext) => Promise<void>) {
            bound.add(binding.flowName);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n) };
}

function rig() {
    const logger = createTestLogger();
    const engine = withLoaderSetFromPull(new AutomationEngine(logger));
    engine.setFlowActivationStore(new InMemoryFlowActivationStore());
    const ctx = { logger: createTestLogger(), getService: () => undefined } as any;
    for (const register of [
        registerSubflowNode, registerMapNode, registerLoopNode, registerParallelNode,
        registerTryCatchNode, registerWaitNode, registerLogicNodes,
    ]) {
        (register as (e: AutomationEngine, c: unknown) => void)(engine, ctx);
    }
    const trigger = recordingTrigger();
    engine.registerTrigger(trigger.trigger);
    return { engine, logger, isBound: trigger.isBound };
}

const stateOf = (engine: AutomationEngine, name: string) =>
    engine.getFlowRuntimeStates().find((s) => s.name === name);

type Node = Record<string, unknown>;
type Region = 'loop' | 'parallel' | 'try_catch';
type CallType = 'subflow' | 'map';

const END: Node = { id: 'end', type: 'end', label: 'End' };
const start = (trigger: boolean): Node => ({
    id: 'start', type: 'start', label: 'Start',
    config: trigger ? { objectName: 'lead', triggerType: 'record-after-create' } : {},
});
const call = (flowName: string, type: CallType = 'subflow', id = 'step'): Node => ({
    id, type, label: `Call ${flowName}`,
    config: { flowName, ...(type === 'map' ? { collection: [1] } : {}) },
});
const NOOP: Node = { id: 'noop', type: 'assignment', label: 'Nothing', config: {} };
const WAIT: Node = { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } };

/** `inner` as the one node of a region body of `kind`, in a container node `id`. */
function region(kind: Region, inner: Node, id = 'box'): Node {
    const body = { nodes: [inner], edges: [] };
    if (kind === 'loop') {
        return { id, type: 'loop', label: 'Box', config: { collection: [1], iteratorVariable: 'item', body } };
    }
    if (kind === 'parallel') {
        return {
            id, type: 'parallel', label: 'Box',
            config: { branches: [{ name: 'a', ...body }, { name: 'b', nodes: [{ ...NOOP, id: `${id}_noop` }], edges: [] }] },
        };
    }
    return {
        id, type: 'try_catch', label: 'Box',
        config: { try: body, catch: { nodes: [{ ...NOOP, id: `${id}_noop` }], edges: [] } },
    };
}

function chain(name: string, nodes: Node[], extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes,
        edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id as string, target: n.id as string })),
        ...extra,
    };
}

/** A child flow that suspends at its `wait` node `hold`. */
const pausingChild = (name: string) => chain(name, [start(false), WAIT, END]);
/** A child flow that runs straight through. */
const plainChild = (name: string, extra: Record<string, unknown> = {}) => chain(name, [start(false), END], extra);

/** A record-triggered caller whose only call to `target` sits inside a region body. */
const regionCaller = (name: string, target: string, kind: Region, type: CallType = 'subflow', trigger = true) =>
    chain(name, [start(trigger), region(kind, call(target, type)), END]);

const CASES: Array<[Region, CallType]> = [
    ['loop', 'subflow'], ['loop', 'map'],
    ['parallel', 'subflow'], ['parallel', 'map'],
    ['try_catch', 'subflow'], ['try_catch', 'map'],
];

describe('the arming gate declines a region-nested call to a child that can suspend (#28897)', () => {
    it.each(CASES)('a caller whose %s body holds a `%s` call to a suspending child is registered but not armed, naming the region, the call and the pause', (kind, type) => {
        const { engine, logger, isBound } = rig();
        engine.registerFlow('deal_review', pausingChild('deal_review'));
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', kind, type));

        expect(engine.getFlow('deal_submit'), 'the caller is still registered').toBeDefined();
        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row).toMatchObject({ enabled: true, bound: false, unboundCause: 'suspending_subflow_in_region' });
        expect(row?.reason).toContain(`\`${type}\` node 'step' sits inside \`${kind}\` node 'box'`);
        expect(row?.reason).toContain("child flow 'deal_review' can suspend the run at `wait` node 'hold'");
        expect(declineWarnings(logger, 'deal_submit')).toHaveLength(1);
    });

    it('names the innermost container when the call is two regions deep', () => {
        const { engine, isBound } = rig();
        engine.registerFlow('deal_review', pausingChild('deal_review'));
        engine.registerFlow(
            'deal_submit',
            chain('deal_submit', [start(true), region('loop', region('parallel', call('deal_review'), 'fan')), END]),
        );
        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row?.unboundCause).toBe('suspending_subflow_in_region');
        expect(row?.reason).toContain("`subflow` node 'step' sits inside `parallel` node 'fan'");
    });

    it('reads where the child suspends through its own top-level calls', () => {
        const { engine, isBound } = rig();
        engine.registerFlow('deal_ask', pausingChild('deal_ask'));
        engine.registerFlow('deal_review', chain('deal_review', [start(false), call('deal_ask'), END]));
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'loop'));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.reason).toContain("at `wait` node 'hold' of 'deal_ask'");
    });

    it('is asked again on every child registration: a caller armed before its child turns suspending is disarmed, and armed again when the child stops', () => {
        const { engine, isBound } = rig();
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'loop', 'map'));
        expect(isBound('deal_submit'), 'no child yet: nothing can suspend').toBe(true);

        engine.registerFlow('deal_review', pausingChild('deal_review'));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('suspending_subflow_in_region');

        engine.registerFlow('deal_review', plainChild('deal_review'));
        expect(isBound('deal_submit')).toBe(true);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBeUndefined();
    });

    it('is asked again when a flow two calls away changes', () => {
        const { engine, isBound } = rig();
        engine.registerFlow('deal_ask', plainChild('deal_ask'));
        engine.registerFlow('deal_review', chain('deal_review', [start(false), call('deal_ask'), END]));
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'try_catch'));
        expect(isBound('deal_submit')).toBe(true);

        engine.registerFlow('deal_ask', pausingChild('deal_ask'));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('suspending_subflow_in_region');
    });

    it('CONTROL: a top-level call to a suspending child arms, since the top-level graph carries the pause', () => {
        const { engine, logger, isBound } = rig();
        engine.registerFlow('deal_review', pausingChild('deal_review'));
        engine.registerFlow('deal_submit', chain('deal_submit', [start(true), call('deal_review'), END]));
        expect(isBound('deal_submit')).toBe(true);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBeUndefined();
        expect(declineWarnings(logger, 'deal_submit')).toEqual([]);
    });

    it('CONTROL (the HotCRM campaign_enrollment shape): two loop bodies calling packaged children that do not suspend still arm, and the run completes', async () => {
        const { engine, logger, isBound } = rig();
        const PACKAGED = { _packageId: 'crm' };
        engine.registerFlow('lead_member_enroll', plainChild('lead_member_enroll', PACKAGED));
        engine.registerFlow('contact_member_enroll', plainChild('contact_member_enroll', PACKAGED));
        engine.registerFlow('enrollment', chain('enrollment', [
            start(true),
            region('loop', call('lead_member_enroll', 'subflow', 'enroll_lead'), 'loop_leads'),
            region('loop', call('contact_member_enroll', 'subflow', 'enroll_contact'), 'loop_contacts'),
            END,
        ], PACKAGED));

        expect(isBound('enrollment')).toBe(true);
        expect(stateOf(engine, 'enrollment')?.unboundCause).toBeUndefined();
        expect(declineWarnings(logger, 'enrollment')).toEqual([]);
        const result = await engine.execute('enrollment', {} as any);
        expect(result.success).toBe(true);
    });
});

describe('the region refusal cancels the child run it leaves behind (#28897)', () => {
    it.each(CASES)('%s / `%s`: the run fails at the region as before, and the suspended child run is cancelled, not left parked', async (kind, type) => {
        const { engine } = rig();
        engine.registerFlow('deal_review', pausingChild('deal_review'));
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', kind, type, false));

        const result: any = await engine.execute('deal_submit', {} as any);
        // The refusal itself is unchanged.
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain(
            `durable pause inside a structured region: node 'step' (sub-flow 'deal_review') suspended`,
        );

        expect(await engine.listSuspendedRunsDurable(), 'no run is left parked').toEqual([]);
        expect(engine.listSuspendedRuns()).toEqual([]);
        const runs = await engine.listRuns('deal_review');
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('cancelled');
        expect(String(runs[0].error)).toContain('durable pause inside a structured region');
    });

    it('a child parked on a grandchild is cancelled with it', async () => {
        const { engine } = rig();
        engine.registerFlow('deal_ask', pausingChild('deal_ask'));
        engine.registerFlow('deal_review', chain('deal_review', [start(false), call('deal_ask', 'subflow', 'ask'), END]));
        engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'loop', 'subflow', false));

        const result: any = await engine.execute('deal_submit', {} as any);
        expect(result.success).toBe(false);
        expect(await engine.listSuspendedRunsDurable()).toEqual([]);
        for (const name of ['deal_review', 'deal_ask']) {
            const runs = await engine.listRuns(name);
            expect(runs.map((r: any) => r.status), name).toEqual(['cancelled']);
        }
    });

    it('CONTROL: a top-level call to a suspending child still parks both runs', async () => {
        const { engine } = rig();
        engine.registerFlow('deal_review', pausingChild('deal_review'));
        engine.registerFlow('deal_submit', chain('deal_submit', [start(false), call('deal_review'), END]));

        const result: any = await engine.execute('deal_submit', {} as any);
        expect(result.status).toBe('paused');
        const parked = (await engine.listSuspendedRunsDurable()).map((r) => r.flowName).sort();
        expect(parked).toEqual(['deal_review', 'deal_submit']);
    });
});
