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
// [#29166] The chain that cancel walks is read through the DEGRADING loader
// (`loadSuspendedRun`), so a store it cannot read hands back an empty chain.
// Measured before that card: zero `cancelRun` calls, a `warn` from the
// degrading read, and the child left parked with nothing at `error`. An empty
// chain now still cancels the child run once, through `cancelRun`, whose
// strict read owns the `error` record when the store stays unreadable.
//
// Neither half changes the refusal itself (code, text, un-routability) or
// `FLOW_PAUSE_CAPABLE_NODE_TYPES`.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRun } from './engine.js';
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

/**
 * [#29166] A store whose `load` fails for the child flow's runs: always
 * (`'always'`), or only the first time each run id is read (`'once'`, a store
 * that answers again by the time the cancel reads it).
 */
class ChildLoadFailingStore extends InMemorySuspendedRunStore {
    private readonly failedOnce = new Set<string>();
    constructor(private readonly childFlow: string, private readonly mode: 'always' | 'once') {
        super();
    }
    override async load(runId: string): Promise<SuspendedRun | null> {
        const row = await super.load(runId);
        if (row?.flowName === this.childFlow && (this.mode === 'always' || !this.failedOnce.has(runId))) {
            this.failedOnce.add(runId);
            throw new Error('store connection reset');
        }
        return row;
    }
}

describe('the region refusal still cancels the child run when its suspension chain cannot be read (#29166)', () => {
    function storeRig(mode: 'always' | 'once') {
        const r = rig();
        const store = new ChildLoadFailingStore('deal_review', mode);
        r.engine.setSuspendedRunStore(store);
        r.engine.registerFlow('deal_review', pausingChild('deal_review'));
        r.engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'loop', 'subflow', false));
        const cancel = vi.spyOn(r.engine, 'cancelRun');
        return { ...r, store, cancel };
    }

    it('an unreadable store: the refusal is thrown as before, the child run gets exactly one cancelRun, and the skipped cancellation is recorded at `error`', async () => {
        const { engine, logger, store, cancel } = storeRig('always');

        const result: any = await engine.execute('deal_submit', {} as any);
        // The refusal itself is unchanged.
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain(
            `durable pause inside a structured region: node 'step' (sub-flow 'deal_review') suspended`,
        );

        const parked = await store.list();
        expect(parked.map((r) => r.flowName), 'the store could not be read, so the child is still parked').toEqual(['deal_review']);
        const childRunId = parked[0].runId;

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(cancel.mock.calls[0][0]).toBe(childRunId);
        expect(String(cancel.mock.calls[0][1])).toContain('durable pause inside a structured region');

        const errors = logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(
            errors.filter((m: string) => m.includes(`cancelRun('${childRunId}') could not read the durable suspended-run store`)),
            "cancelRun's strict read owns the error record",
        ).toHaveLength(1);
    });

    it('a store that answers again by the cancel: the child run the empty chain hid is cancelled, not left parked', async () => {
        const { engine, store, cancel } = storeRig('once');

        const result: any = await engine.execute('deal_submit', {} as any);
        expect(result.success).toBe(false);

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(await store.list(), 'no run is left parked').toEqual([]);
        const runs = await engine.listRuns('deal_review');
        expect(runs.map((r: any) => r.status)).toEqual(['cancelled']);
    });
});

describe('the region refusal cancels what it can read of a deeper suspension chain and names the link it cannot (#29333)', () => {
    /** caller --loop--> deal_review --subflow--> deal_mid --subflow--> deal_ask (parks at `wait`). */
    function threeRunRig(store: InMemorySuspendedRunStore) {
        const r = rig();
        r.engine.setSuspendedRunStore(store);
        r.engine.registerFlow('deal_ask', pausingChild('deal_ask'));
        r.engine.registerFlow('deal_mid', chain('deal_mid', [start(false), call('deal_ask', 'subflow', 'ask'), END]));
        r.engine.registerFlow('deal_review', chain('deal_review', [start(false), call('deal_mid', 'subflow', 'mid'), END]));
        r.engine.registerFlow('deal_submit', regionCaller('deal_submit', 'deal_review', 'loop', 'subflow', false));
        const cancel = vi.spyOn(r.engine, 'cancelRun');
        return { ...r, cancel };
    }

    const chainErrors = (logger: any): string[] =>
        logger.error.mock.calls
            .map((c: unknown[]) => String(c[0]))
            .filter((m: string) => m.includes('could not be read while cancelling that chain'));

    it('the middle link cannot be read: the child is cancelled, one `error` record names the middle run, and the refusal is still thrown', async () => {
        const store = new ChildLoadFailingStore('deal_mid', 'always');
        const { engine, logger, cancel } = threeRunRig(store);

        const result: any = await engine.execute('deal_submit', {} as any);
        // The refusal itself is unchanged.
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain(
            `durable pause inside a structured region: node 'step' (sub-flow 'deal_review') suspended`,
        );

        expect((await engine.listRuns('deal_review')).map((r: any) => r.status), 'the readable link is cancelled').toEqual(['cancelled']);
        const parked = await store.list();
        // deal_mid cannot be read, and deal_ask is only reachable through deal_mid's row.
        expect(parked.map((r) => r.flowName).sort()).toEqual(['deal_ask', 'deal_mid']);
        const midRunId = parked.find((r) => r.flowName === 'deal_mid')!.runId;

        const errors = chainErrors(logger);
        expect(errors, 'one record names the unreadable link').toHaveLength(1);
        expect(errors[0]).toContain(`the suspended run '${midRunId}'`);

        // Deepest first: the unreadable link, then the child.
        const childRunId = (await engine.listRuns('deal_review'))[0].id;
        expect(cancel.mock.calls.map((c) => c[0])).toEqual([midRunId, childRunId]);
    });

    it('CONTROL: an all-readable three-run chain is cancelled whole, deepest first, with nothing at `error`', async () => {
        const { engine, logger, cancel } = threeRunRig(new InMemorySuspendedRunStore());

        const result: any = await engine.execute('deal_submit', {} as any);
        expect(result.success).toBe(false);
        expect(await engine.listSuspendedRunsDurable(), 'no run is left parked').toEqual([]);
        const ids: string[] = [];
        for (const name of ['deal_ask', 'deal_mid', 'deal_review']) {
            const runs = await engine.listRuns(name);
            expect(runs.map((r: any) => r.status), name).toEqual(['cancelled']);
            ids.push(runs[0].id);
        }
        expect(cancel.mock.calls.map((c) => c[0])).toEqual(ids);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
