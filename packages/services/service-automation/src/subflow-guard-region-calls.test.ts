// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28846] The subflow guards see a `subflow` / `map` node inside a region
// body (a `loop` body, a `parallel` branch, a `try_catch` slot).
//
// ADR-0126 §7.3 keeps a packaged caller from being armed onto a disabled
// packaged child, and keeps that child from being switched off or removed
// while an armed packaged caller still calls it. Each guard reads the caller's
// calls through `subflowTargets`, which read only the top-level `nodes`: a
// call inside a region body was invisible, so the caller armed onto a disabled
// child and failed mid-run at that node, the late, inexplicable failure §7.3
// refuses to cause. `subflowTargets` now reads every region depth through
// `collectFlowGraphs`, the spec's one region walk, so every guard sees the
// same calls.
//
// The save-notice half of the arming gate (#28840) is deliberately NOT moved
// by this: a region body cannot carry a durable pause, so a region-nested call
// whose child suspends fails the run at the region boundary before anything
// after the container runs. That walk keeps reading top-level calls only, and
// two pins below hold it there. Such a call is the gate's region half instead
// (#28897, `subflow-region-suspension.test.ts`).

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
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

const nodeCtx = { logger: createTestLogger(), getService: () => undefined } as any;

function engineWithLedger() {
    const logger = createTestLogger();
    const engine = withLoaderSetFromPull(new AutomationEngine(logger));
    engine.setFlowActivationStore(new InMemoryFlowActivationStore());
    registerSubflowNode(engine, nodeCtx);
    registerMapNode(engine, nodeCtx);
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
const call = (flowName: string, type: CallType = 'subflow'): Node => ({
    id: 'step', type, label: `Call ${flowName}`,
    config: { flowName, ...(type === 'map' ? { collection: [1] } : {}) },
});
const NOOP: Node = { id: 'noop', type: 'assignment', label: 'Nothing', config: {} };

/** `inner` as the one node of a region body of `kind`, in a container node `id`. */
function region(kind: Region, inner: Node, id = 'box'): Node {
    const body = { nodes: [inner], edges: [] };
    if (kind === 'loop') {
        return { id, type: 'loop', label: 'Box', config: { collection: [1], iteratorVariable: 'item', body } };
    }
    if (kind === 'parallel') {
        return {
            id, type: 'parallel', label: 'Box',
            config: { branches: [{ name: 'a', ...body }, { name: 'b', nodes: [{ ...NOOP }], edges: [] }] },
        };
    }
    return { id, type: 'try_catch', label: 'Box', config: { try: body, catch: { nodes: [{ ...NOOP }], edges: [] } } };
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

/** Shipped by a code package (ADR-0029 D9.6 provenance). */
const PACKAGED = { _packageId: 'crm' };

/** A packaged child flow `start → end`, active unless `status` says otherwise. */
const child = (name: string, status?: string) =>
    chain(name, [start(false), END], { ...PACKAGED, ...(status !== undefined ? { status } : {}) });

/** A packaged record-triggered caller whose only call to `target` sits inside a region body. */
const regionCaller = (name: string, target: string, kind: Region, type: CallType = 'subflow') =>
    chain(name, [start(true), region(kind, call(target, type)), END], PACKAGED);

const CASES: Array<[Region, CallType]> = [
    ['loop', 'subflow'], ['loop', 'map'],
    ['parallel', 'subflow'], ['parallel', 'map'],
    ['try_catch', 'subflow'], ['try_catch', 'map'],
];

describe('the subflow guards read a call inside a region body (#28846)', () => {
    it.each(CASES)('arming: a caller whose %s body holds a `%s` call to a disabled packaged child is declined, naming the child', (kind, type) => {
        const { engine, logger, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step', 'obsolete'));
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', kind, type));

        expect(isBound('vendor_process')).toBe(false);
        const row = stateOf(engine, 'vendor_process');
        expect(row).toMatchObject({ enabled: true, bound: false, unboundCause: 'disabled_subflow' });
        expect(row?.reason).toContain("'shared_step' (its definition's status is 'obsolete')");
        expect(declineWarnings(logger, 'vendor_process')).toHaveLength(1);
    });

    it('arming: a child republished `obsolete` under an armed caller that calls it from a loop body disarms the caller; republished `active` arms it again', () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step'));
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', 'loop'));
        expect(isBound('vendor_process')).toBe(true);

        engine.registerFlow('shared_step', child('shared_step', 'obsolete'));
        expect(isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')?.unboundCause).toBe('disabled_subflow');

        engine.registerFlow('shared_step', child('shared_step'));
        expect(isBound('vendor_process')).toBe(true);
        expect(stateOf(engine, 'vendor_process')?.unboundCause).toBeUndefined();
    });

    it('arming: a call two regions deep (a `parallel` branch inside a `loop` body) is read too', () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step', 'obsolete'));
        engine.registerFlow(
            'vendor_process',
            chain('vendor_process', [start(true), region('loop', region('parallel', call('shared_step'), 'fan')), END], PACKAGED),
        );
        expect(isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')?.unboundCause).toBe('disabled_subflow');
    });

    it('removal: a child an armed packaged caller calls from a try_catch slot is refused with DELETE_RESTRICTED / 409, naming the caller', () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step'));
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', 'try_catch'));

        let thrown: any;
        try {
            engine.unregisterFlow('shared_step');
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'removing the child was accepted').toBeDefined();
        expect(thrown.code).toBe('DELETE_RESTRICTED');
        expect(thrown.status).toBe(409);
        expect(thrown.subflowCallers).toEqual(['vendor_process']);
        expect(thrown.message).toContain("Flow 'shared_step' cannot be removed");
        expect(engine.getFlow('shared_step'), 'nothing was removed').toBeDefined();
    });

    it('switch-off: a child an enabled packaged caller calls from a parallel branch is refused with DELETE_RESTRICTED / 409, naming the caller', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step'));
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', 'parallel', 'map'));

        const thrown: any = await engine.toggleFlow('shared_step', false).then(() => undefined, (e: unknown) => e);
        expect(thrown, 'switching the child off was accepted').toBeDefined();
        expect(thrown.code).toBe('DELETE_RESTRICTED');
        expect(thrown.status).toBe(409);
        expect(thrown.subflowCallers).toEqual(['vendor_process']);
        expect(thrown.message).toContain("Flow 'shared_step' cannot be disabled");
    });

    it('enable: re-enabling a switched-off caller whose loop body calls a switched-off packaged child is refused with RESOURCE_CONFLICT / 409, naming the child (#28897)', async () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step'));
        await engine.toggleFlow('shared_step', false);
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', 'loop', 'map'));
        await engine.toggleFlow('vendor_process', false);

        const thrown: any = await engine.toggleFlow('vendor_process', true).then(() => undefined, (e: unknown) => e);
        expect(thrown, 're-enabling the caller was accepted').toBeDefined();
        expect(thrown.code).toBe('RESOURCE_CONFLICT');
        expect(thrown.status).toBe(409);
        expect(thrown.message).toContain("Flow 'vendor_process' cannot be enabled");
        expect(thrown.message).toContain("'shared_step'");
        expect(isBound('vendor_process')).toBe(false);
    });

    it('CONTROL: a caller whose loop body calls an ACTIVE packaged child is armed, with no warning', () => {
        const { engine, logger, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step'));
        engine.registerFlow('vendor_process', regionCaller('vendor_process', 'shared_step', 'loop'));
        expect(isBound('vendor_process')).toBe(true);
        expect(stateOf(engine, 'vendor_process')?.unboundCause).toBeUndefined();
        expect(declineWarnings(logger, 'vendor_process')).toEqual([]);
    });

    it('CONTROL: a top-level call to a disabled packaged child is declined as before', () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('shared_step', child('shared_step', 'obsolete'));
        engine.registerFlow('vendor_process', chain('vendor_process', [start(true), call('shared_step'), END], PACKAGED));
        expect(isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')?.unboundCause).toBe('disabled_subflow');
    });
});

describe('the save-notice half of the arming gate keeps reading top-level calls (#28840, #28846)', () => {
    const WAIT: Node = { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } };
    const NOTICE: Node = { id: 'tell', type: 'save_notice', label: 'Tell the saver', config: { message: 'Saved' } };

    it('a save_notice after a region whose body calls a suspending child is not declined on the notice: the region cannot carry the pause, so the run fails at the region, before the notice, and the gate declines it on the region call instead (#28897)', () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('deal_review', chain('deal_review', [start(false), WAIT, END]));
        engine.registerFlow('deal_submit', chain('deal_submit', [start(true), region('loop', call('deal_review')), NOTICE, END]));
        expect(isBound('deal_submit')).toBe(false);
        const row = stateOf(engine, 'deal_submit');
        expect(row?.unboundCause).toBe('suspending_subflow_in_region');
        expect(row?.reason).not.toContain('save_notice');
    });

    it('a child whose only call to a suspending flow sits in a region body does not count as suspending', () => {
        const { engine, isBound } = engineWithLedger();
        engine.registerFlow('deal_ask', chain('deal_ask', [start(false), WAIT, END]));
        engine.registerFlow('deal_review', chain('deal_review', [start(false), region('loop', call('deal_ask')), END]));
        engine.registerFlow('deal_submit', chain('deal_submit', [start(true), call('deal_review'), NOTICE, END]));
        expect(isBound('deal_submit')).toBe(true);
        expect(stateOf(engine, 'deal_submit')?.unboundCause).toBeUndefined();
    });
});
