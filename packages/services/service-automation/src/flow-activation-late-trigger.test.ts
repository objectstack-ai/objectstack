// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20677] ADR-0126 §7.2 — a switched-off flow stays UNBOUND whenever its
// trigger type arrives, and a restart does not re-arm it.
//
// ## The boot order this pins
//
// `AutomationServicePlugin.start()` pulls the flows (`registerFlow`) and then
// applies the activation ledger (`hydrateFlowActivations()`), which unbinds
// every flow a row switches off. The trigger plugins register their triggers
// LATER, at `kernel:ready` — and `registerTrigger` arms every registered,
// unbound flow whose trigger type matches. Before the fix it did so without
// asking whether the flow may run at all, so a flow the administrator switched
// off came back `bound: true` after every cold boot, and each matching event
// then logged an ERROR claiming a run-history row that was never written.
//
// ## The shape of the fix these pins hold
//
// ONE gate, in `activateFlowTrigger` itself: it refuses to arm a flow
// `isFlowEnabled` answers `false` for, so `registerFlow`, `registerTrigger`,
// the enable toggle and any arming path added later all inherit it. The pins
// therefore drive the arming paths from outside rather than asserting on
// `registerTrigger`'s body.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, FlowActivationStore } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** A packaged, runnable flow whose `start` config decides its trigger kind. */
function packagedFlow(name: string, startConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: startConfig },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        _packageId: 'crm',
        ...extra,
    };
}

/** A recording trigger: binding state is read off the trigger, never inferred. */
function recordingTrigger(type: string) {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type,
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n), callbackOf: (n: string) => bound.get(n) };
}

/** The runtime-state row `GET /automation/_status` serves for one flow. */
function stateOf(engine: AutomationEngine, name: string) {
    const row = engine.getFlowRuntimeStates().find((s) => s.name === name);
    return row && { enabled: row.enabled, bound: row.bound };
}

const RECORD_CHANGE = { objectName: 'task', triggerType: 'record-after-create' };

// Time-triggered kinds arm only where the deployment runs package-authored
// scheduled work (off by default); without this every schedule / time-relative
// assertion below would fail for a reason unrelated to the ledger.
withScheduledWorkOn();

describe('a trigger type registered AFTER hydrateFlowActivations() does not arm a ledger-disabled flow', () => {
    // Every kind a trigger plugin registers at `kernel:ready`. The disabled
    // flow and its enabled sibling share the kind, so the sibling is the
    // control that the trigger registration really did arm what it should.
    const kinds: Array<[string, Record<string, unknown>]> = [
        ['record_change', RECORD_CHANGE],
        ['schedule', { schedule: '0 9 * * *' }],
        ['time_relative', { timeRelative: { object: 'task', field: 'due_at' }, schedule: '0 * * * *' }],
        // An `api` flow registers only with its per-flow secret (ADR-0041).
        ['api', { triggerType: 'api', secret: 'hook-secret' }],
    ];

    for (const [kind, startConfig] of kinds) {
        it(`${kind}: the switched-off flow stays unbound, its enabled sibling arms`, async () => {
            const store = new InMemoryFlowActivationStore();
            await store.setActive({ name: 'off', packageId: 'crm', active: false });

            const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
            engine.setFlowActivationStore(store);
            engine.registerFlow('off', packagedFlow('off', startConfig));
            engine.registerFlow('on', packagedFlow('on', startConfig));
            expect(await engine.hydrateFlowActivations()).toEqual(['off']);

            // The trigger plugin's `kernel:ready` registration, after hydration.
            const trigger = recordingTrigger(kind);
            engine.registerTrigger(trigger.trigger);

            expect(trigger.isBound('off')).toBe(false);
            expect(stateOf(engine, 'off')).toEqual({ enabled: false, bound: false });
            // The control: the same registration armed the enabled sibling.
            expect(trigger.isBound('on')).toBe(true);
            expect(stateOf(engine, 'on')).toEqual({ enabled: true, bound: true });
        });
    }

    it('a STATUS-disabled flow is not armed by a later trigger registration either — the gate is `isFlowEnabled`, both dimensions', async () => {
        const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        engine.registerFlow('retired', packagedFlow('retired', RECORD_CHANGE, { status: 'obsolete' }));
        engine.registerFlow('live', packagedFlow('live', RECORD_CHANGE, { status: 'active' }));

        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);

        expect(trigger.isBound('retired')).toBe(false);
        expect(stateOf(engine, 'retired')).toEqual({ enabled: false, bound: false });
        expect(trigger.isBound('live')).toBe(true);
    });
});

describe('the enable path still arms', () => {
    it('re-enabling a flow hydrated as disabled arms it on the trigger that registered after hydration', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', packageId: 'crm', active: false });
        const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        engine.setFlowActivationStore(store);
        engine.registerFlow('f', packagedFlow('f', RECORD_CHANGE));
        await engine.hydrateFlowActivations();
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        expect(trigger.isBound('f')).toBe(false);

        await engine.toggleFlow('f', true);

        expect(trigger.isBound('f')).toBe(true);
        expect(stateOf(engine, 'f')).toEqual({ enabled: true, bound: true });
        expect(await store.list()).toEqual([{ name: 'f', packageId: 'crm', active: true }]);
        expect((await engine.execute('f')).success).toBe(true);
    });

    it('re-enabling the LEDGER bit of a flow whose STATUS is obsolete does not arm it — it still cannot run', async () => {
        const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        engine.setFlowActivationStore(new InMemoryFlowActivationStore());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.registerFlow('retired', packagedFlow('retired', RECORD_CHANGE, { status: 'obsolete' }));

        await engine.toggleFlow('retired', true);

        // Armed, it would refuse every event it fired (`FLOW_DISABLED`, the
        // status dimension) — the same armed-but-cannot-run state as a
        // ledger-disabled flow, reached through the toggle instead.
        expect(trigger.isBound('retired')).toBe(false);
        expect(stateOf(engine, 'retired')).toEqual({ enabled: false, bound: false });
        expect((await engine.execute('retired')).code).toBe('FLOW_DISABLED');
    });
});

describe('a cold restart over the same store keeps a switched-off flow enabled:false, bound:false', () => {
    /**
     * One process lifetime, in `AutomationServicePlugin`'s boot order:
     * `start()` pulls the flows and hydrates the ledger; at `kernel:ready` the
     * protocol sync re-registers every flow and the trigger plugin registers
     * its trigger; `kernel:bootstrapped` seals the node-type vocabulary. Only
     * the STORE outlives the engine, as the `sys_metadata_activation` rows
     * outlive the process.
     */
    async function boot(store: FlowActivationStore) {
        const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        engine.setFlowActivationStore(store);
        const defs = [packagedFlow('urgent_alert', RECORD_CHANGE), packagedFlow('welcome', RECORD_CHANGE)];
        for (const def of defs) engine.registerFlow(def.name, def); // the boot pull
        await engine.hydrateFlowActivations();
        for (const def of defs) engine.registerFlow(def.name, def); // kernel:ready protocol sync
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger); // kernel:ready trigger plugin
        engine.sealNodeTypeVocabulary(); // kernel:bootstrapped
        return { engine, trigger };
    }

    it('survives two consecutive cold boots; the enabled sibling arms on each', async () => {
        const store = new InMemoryFlowActivationStore();

        const first = await boot(store);
        expect(stateOf(first.engine, 'urgent_alert')).toEqual({ enabled: true, bound: true });
        await first.engine.toggleFlow('urgent_alert', false);
        expect(stateOf(first.engine, 'urgent_alert')).toEqual({ enabled: false, bound: false });

        for (const restart of [1, 2]) {
            const { engine, trigger } = await boot(store);
            expect(stateOf(engine, 'urgent_alert'), `restart ${restart}`).toEqual({ enabled: false, bound: false });
            expect(trigger.isBound('urgent_alert'), `restart ${restart}`).toBe(false);
            expect(stateOf(engine, 'welcome'), `restart ${restart}`).toEqual({ enabled: true, bound: true });
            // The binding audit reads the same bookkeeping: a disabled flow is
            // not reported as a binding failure either.
            expect(engine.getTriggerBindingAudit(), `restart ${restart}`).toEqual([]);
        }
    });
});

describe('the trigger-fired failure line claims a run-history row only when one is written', () => {
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    function loggedLines(logger: any, level: 'info' | 'error') {
        return logger[level].mock.calls.map((c: any[]) => String(c[0]));
    }

    it('a FLOW_DISABLED refusal reaching the callback (an event in flight when the flow was switched off) is not logged as a failure', async () => {
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        engine.setFlowActivationStore(new InMemoryFlowActivationStore());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.registerFlow('f', packagedFlow('f', RECORD_CHANGE));
        // The callback the trigger already holds — an event dispatched before
        // the switch-off is delivered to it after.
        const inFlight = trigger.callbackOf('f');
        expect(inFlight).toBeTypeOf('function');
        await engine.toggleFlow('f', false);

        await inFlight!({ event: 'record-after-create', object: 'task', record: { id: 't1' } } as AutomationContext);
        await flush();

        expect(loggedLines(logger, 'error').filter((m: string) => m.includes('Trigger-fired run'))).toEqual([]);
        const told = loggedLines(logger, 'info').filter((m: string) => m.includes("flow 'f'") && m.includes('disabled'));
        expect(told).toHaveLength(1);
        expect(told[0]).not.toContain('recorded in the flow\'s run history');
        // Nothing ran, so nothing may claim a row: there is none.
        expect(await engine.listRuns('f')).toEqual([]);
    });

    it('a run that dispatched and failed still logs at ERROR and still says its failure is in the run history — which holds it', async () => {
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.registerNodeExecutor({ type: 'exploder', async execute() { throw new Error('boom'); } } as never);
        engine.registerFlow('failing', {
            ...packagedFlow('failing', RECORD_CHANGE),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: RECORD_CHANGE },
                { id: 'boom', type: 'exploder', label: 'Boom' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'boom' },
                { id: 'e2', source: 'boom', target: 'end' },
            ],
        });

        await trigger.callbackOf('failing')!({ event: 'record-after-create', object: 'task', record: { id: 't1' } } as AutomationContext);
        await flush();

        const errors = loggedLines(logger, 'error').filter((m: string) => m.includes('Trigger-fired run'));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("recorded in the flow's run history");
        const runs = await engine.listRuns('failing');
        expect(runs.map((r) => r.status)).toEqual(['failed']);
    });

    it('a failure refused before it dispatched makes no run-history claim — no row was written', async () => {
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.registerFlow('gone', packagedFlow('gone', RECORD_CHANGE));
        const inFlight = trigger.callbackOf('gone');
        // Unregistered while an event is in flight: `execute()` answers the
        // never-dispatched "not found" exit, which records nothing.
        engine.unregisterFlow('gone');

        await inFlight!({ event: 'record-after-create', object: 'task', record: { id: 't1' } } as AutomationContext);
        await flush();

        const errors = loggedLines(logger, 'error').filter((m: string) => m.includes('Trigger-fired run'));
        expect(errors).toHaveLength(1);
        expect(errors[0]).not.toContain("recorded in the flow's run history");
        expect(await engine.listRuns('gone')).toEqual([]);
    });
});
