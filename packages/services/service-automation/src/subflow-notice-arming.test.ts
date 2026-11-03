// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28840] The arming gate declines a record-triggered flow whose
// `save_notice` runs after a `subflow` / `map` node whose child flow can
// suspend.
//
// The flow parse refuses a `save_notice` that an always-suspending node
// reaches (#28806), but it cannot see a `subflow` / `map` child: the child is
// another flow, and may register after the caller. A suspended child suspends
// its caller, the write answers, and the notice after it then refuses by name
// on the resume, stranding the decision.
//
// So `activateFlowTrigger`, the one gate every arming path crosses, declines
// such a caller, beside the disabled-subflow half of the same gate (ADR-0126
// §7.3): the caller registers, is NOT armed, warns once, and `/_status`
// reports why with its own `unboundCause`. `rejudgeSubflowCallers` asks the
// gate again whenever a flow the caller reaches through its calls is
// registered, so the decline does not depend on load order, and a child
// republished without its suspension arms the caller again.
//
// Each pin drives the engine from outside and reads the state off the trigger,
// the `/_status` row and the log, never off the gate's body.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** The engine's arming-gate warnings for `caller`. */
const declineWarnings = (logger: any, caller: string): string[] =>
    logger.warn.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes(`Flow '${caller}'`) && m.includes('NOT armed'));

/** A recording trigger: binding state is read off the trigger, never inferred. */
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

const nodeCtx = { logger: createTestLogger(), getService: () => undefined } as any;

function engineWithTrigger() {
    const logger = createTestLogger();
    const engine = withLoaderSetFromPull(new AutomationEngine(logger));
    registerSubflowNode(engine, nodeCtx);
    registerMapNode(engine, nodeCtx);
    const trigger = recordingTrigger();
    engine.registerTrigger(trigger.trigger);
    return { engine, logger, isBound: trigger.isBound };
}

/** The row `GET /automation/_status` serves for one flow. */
function stateOf(engine: AutomationEngine, name: string) {
    return engine.getFlowRuntimeStates().find((s) => s.name === name);
}

type Node = Record<string, unknown>;

const notice = (id: string): Node => ({ id, type: 'save_notice', label: 'Tell the saver', config: { message: 'Sent for review' } });
const WAIT: Node = { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } };
const END: Node = { id: 'end', type: 'end', label: 'End' };

/** A flow whose edges run through `nodes` in order, plus `backEdges` (each a `type: 'back'` rework edge). */
function chain(name: string, nodes: Node[], backEdges: Array<[string, string]> = []) {
    const pairs = nodes.slice(1).map((n, i) => ({ source: nodes[i].id as string, target: n.id as string }));
    const back = backEdges.map(([source, target]) => ({ source, target, type: 'back' }));
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes,
        edges: [...pairs, ...back].map((edge, i) => ({ id: `e${i}`, ...edge })),
    };
}

const start = (trigger: boolean): Node => ({
    id: 'start', type: 'start', label: 'Start',
    config: trigger ? { objectName: 'deal', triggerType: 'record-after-create' } : {},
});

const call = (id: string, flowName: string, type: 'subflow' | 'map' = 'subflow'): Node => ({
    id, type, label: `Call ${flowName}`,
    config: { flowName, ...(type === 'map' ? { collection: [1] } : {}) },
});

/** A record-triggered caller: `start → review(child) → tell(save_notice) → end`. */
const caller = (child: string, type: 'subflow' | 'map' = 'subflow') =>
    chain('deal_submit', [start(true), call('review', child, type), notice('tell'), END]);

/** A child flow: `start → [hold (wait)] → [call grandchild] → end`. */
const child = (name: string, opts: { suspends?: boolean; calls?: string } = {}) =>
    chain(name, [
        start(false),
        ...(opts.suspends ? [WAIT] : []),
        ...(opts.calls ? [call('deeper', opts.calls)] : []),
        END,
    ]);

describe('the arming gate declines a save_notice after a subflow whose child can suspend (#28840)', () => {
    it('registers the caller but does not arm it: one warn, and a /_status reason naming the subflow node and the suspending node', () => {
        const { engine, logger, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        engine.registerFlow('deal_submit', caller('deal_review'));

        expect(engine.getFlow('deal_submit')).toBeDefined();
        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row).toMatchObject({ enabled: true, bound: false, unboundCause: 'notice_after_suspending_subflow' });
        expect(row?.reason).toContain("`save_notice` node 'tell' is reached after `subflow` node 'review'");
        expect(row?.reason).toContain("child flow 'deal_review' can suspend the run at `wait` node 'hold'");
        expect(row?.reason).toContain("Move the `save_notice` ahead of 'review', or tell the person after it with a `notify` node");

        const said = declineWarnings(logger, 'deal_submit');
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("Flow 'deal_submit' is registered but NOT armed on trigger 'record_change'");
        expect(said[0]).toContain("`subflow` node 'review'");
        expect(said[0]).toContain("`wait` node 'hold'");

        // Said once per decline: re-registering the same caller records it again without repeating it.
        engine.registerFlow('deal_submit', caller('deal_review'));
        expect(isBound('deal_submit')).toBe(false);
        expect(declineWarnings(logger, 'deal_submit')).toHaveLength(1);
    });

    it('declines the same shape through a `map` node', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        engine.registerFlow('deal_submit', caller('deal_review', 'map'));

        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row?.unboundCause).toBe('notice_after_suspending_subflow');
        expect(row?.reason).toContain("is reached after `map` node 'review'");
    });

    it('declines when the child suspends only through a flow it calls in turn, naming that flow', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_ask', child('deal_ask', { suspends: true }));
        engine.registerFlow('deal_review', child('deal_review', { calls: 'deal_ask' }));
        engine.registerFlow('deal_submit', caller('deal_review'));

        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row?.unboundCause).toBe('notice_after_suspending_subflow');
        expect(row?.reason).toContain("child flow 'deal_review' can suspend the run at `wait` node 'hold' of 'deal_ask'");
    });

    it('declines a save_notice inside a region body whose container stands after the subflow node', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        const loop: Node = {
            id: 'each', type: 'loop', label: 'Each',
            config: { collection: [1, 2], iteratorVariable: 'item', body: { nodes: [notice('tell')], edges: [] } },
        };
        engine.registerFlow('deal_submit', chain('deal_submit', [start(true), call('review', 'deal_review'), loop, END]));

        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.reason).toContain("`save_notice` node 'tell' is reached after `subflow` node 'review'");
    });

    it('declines when an edge after the subflow node loops back to before the save_notice', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        engine.registerFlow(
            'deal_submit',
            chain('deal_submit', [start(true), notice('tell'), call('review', 'deal_review'), END], [['review', 'tell']]),
        );

        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('notice_after_suspending_subflow');
    });

    it('does not depend on load order: a caller armed before its child registers is disarmed when the child arrives suspending', () => {
        const { engine, logger, isBound } = engineWithTrigger();
        engine.registerFlow('deal_submit', caller('deal_review'));
        // The child is not registered yet: nothing is known to suspend.
        expect(isBound('deal_submit')).toBe(true);

        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('notice_after_suspending_subflow');
        expect(declineWarnings(logger, 'deal_submit')).toHaveLength(1);
    });

    it('re-judges a caller two calls away when the flow that suspends is registered', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { calls: 'deal_ask' }));
        engine.registerFlow('deal_submit', caller('deal_review'));
        expect(isBound('deal_submit')).toBe(true);

        engine.registerFlow('deal_ask', child('deal_ask', { suspends: true }));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('notice_after_suspending_subflow');
    });

    it('arms the caller again when the child is republished without its suspension, and declines it again when the suspension comes back', () => {
        const { engine, logger, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        engine.registerFlow('deal_submit', caller('deal_review'));
        expect(isBound('deal_submit')).toBe(false);

        engine.registerFlow('deal_review', child('deal_review'));
        expect(isBound('deal_submit')).toBe(true);
        const armed = stateOf(engine, 'deal_submit');
        expect(armed).toMatchObject({ enabled: true, bound: true });
        expect(armed?.reason).toBeUndefined();
        expect(armed?.unboundCause).toBeUndefined();

        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        expect(isBound('deal_submit')).toBe(false);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBe('notice_after_suspending_subflow');
        expect(declineWarnings(logger, 'deal_submit')).toHaveLength(2);
    });

    it('arms the caller again when the flow two calls away stops suspending', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_ask', child('deal_ask', { suspends: true }));
        engine.registerFlow('deal_review', child('deal_review', { calls: 'deal_ask' }));
        engine.registerFlow('deal_submit', caller('deal_review'));
        expect(isBound('deal_submit')).toBe(false);

        engine.registerFlow('deal_ask', child('deal_ask'));
        expect(isBound('deal_submit')).toBe(true);
    });

    it('terminates on a cycle of calls and arms when nothing on it suspends', () => {
        const { engine, isBound } = engineWithTrigger();
        engine.registerFlow('deal_a', child('deal_a', { calls: 'deal_b' }));
        engine.registerFlow('deal_b', child('deal_b', { calls: 'deal_a' }));
        engine.registerFlow('deal_submit', caller('deal_a'));
        expect(isBound('deal_submit')).toBe(true);
    });

    it('CONTROL: a subflow whose child cannot suspend, followed by a save_notice, still arms, with no warn', () => {
        const { engine, logger, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review'));
        engine.registerFlow('deal_submit', caller('deal_review'));

        expect(isBound('deal_submit')).toBe(true);
        const row = stateOf(engine, 'deal_submit');
        expect(row).toMatchObject({ enabled: true, bound: true });
        expect(row?.unboundCause).toBeUndefined();
        expect(declineWarnings(logger, 'deal_submit')).toEqual([]);
    });

    it('CONTROL: a save_notice ahead of a subflow whose child suspends still arms', () => {
        const { engine, logger, isBound } = engineWithTrigger();
        engine.registerFlow('deal_review', child('deal_review', { suspends: true }));
        engine.registerFlow('deal_submit', chain('deal_submit', [start(true), notice('tell'), call('review', 'deal_review'), END]));

        expect(isBound('deal_submit')).toBe(true);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBeUndefined();
        expect(declineWarnings(logger, 'deal_submit')).toEqual([]);
    });
});
