// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12157 / #12158] ADR-0126 §5 / §7.2 / §7.3 — the packaged-flow activation
// ledger: the durable off-switch, its runtime consult at the `execute()` seam,
// the trigger unbind, and the subflow guard on disable.
//
// WHAT THIS REPLACES, AND WHY THE REPLACEMENT NEEDED TESTS OF ITS OWN
//
// The engine used to keep its off-switch in a process-local `flowEnabled` map.
// #10243 measured the cost: the bit was NOT a row, so no organization wall
// scoped it — `toggleFlow` wrote a name-keyed in-process map and the automation
// service is ONE instance per environment, so on a real `isolated` posture a
// tenant org owner switched a shipped flow off and an unrelated tenant in a
// DIFFERENT organization read it off. ADR-0126 §7.2 RETIRES that mechanism
// rather than refining it.
//
// So the assertions below come in two families, and both are load-bearing:
//   1. the ledger DOES what the map did (refuse at execute(), unbind the
//      trigger) — otherwise the retirement is a regression; and
//   2. the map is GONE as a mechanism, not merely bypassed — the grep-level
//      pin at the bottom of this file, which is what stops a later edit from
//      quietly reintroducing an in-process off-switch beside the durable one.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, FlowActivationRow, NodeExecutor, SuspendedRunStore } from './engine.js';
import { InMemoryFlowActivationStore, ObjectStoreFlowActivationStore } from './flow-activation-store.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/**
 * A minimal runnable flow. `start` config decides which trigger it binds to,
 * which is how one helper covers every entry path below.
 */
function flowBody(name: string, startConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: startConfig },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

/** The same flow, shipped by a code package (ADR-0029 D9.6 provenance). */
function packagedFlow(name: string, startConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return { ...flowBody(name, startConfig, extra), _packageId: 'crm' };
}

/** A recording trigger, so binding state is asserted for real rather than inferred. */
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
    return { trigger, isBound: (n: string) => bound.has(n) };
}

/** An engine with the in-memory ledger attached and the four triggers registered. */
function engineWithLedger() {
    const engine = new AutomationEngine(createTestLogger());
    const store = new InMemoryFlowActivationStore();
    engine.setFlowActivationStore(store);
    const triggers = {
        record_change: recordingTrigger('record_change'),
        schedule: recordingTrigger('schedule'),
        time_relative: recordingTrigger('time_relative'),
        api: recordingTrigger('api'),
    };
    for (const t of Object.values(triggers)) engine.registerTrigger(t.trigger);
    return { engine, store, triggers };
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — absence of a row means ACTIVE
// ─────────────────────────────────────────────────────────────────────────────

// [#17396] Time-triggered flows arm only where the deployment runs
// package-authored scheduled work, and the switch is OFF by default in every
// posture. Without this, every trigger-wiring assertion below fails for a
// reason that has nothing to do with wiring.
withScheduledWorkOn();

describe('ADR-0126 §4 — absence of a row = active (an empty ledger changes nothing)', () => {
    it('a stock boot with an EMPTY ledger arms and runs every flow', async () => {
        const { engine, triggers } = engineWithLedger();
        engine.registerFlow('welcome', packagedFlow('welcome', { objectName: 'lead', triggerType: 'record-after-create' }));

        const disarmed = await engine.hydrateFlowActivations();

        expect(disarmed).toEqual([]);
        expect(triggers.record_change.isBound('welcome')).toBe(true);
        expect((await engine.execute('welcome')).success).toBe(true);
    });

    it('an engine with NO store attached behaves exactly as a stock boot', async () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerFlow('welcome', packagedFlow('welcome'));

        // Nothing to hydrate, and nothing refused.
        expect(await engine.hydrateFlowActivations()).toEqual([]);
        expect((await engine.execute('welcome')).success).toBe(true);
    });

    it('re-enabling UPDATES the row rather than deleting it — the ledger records the choice', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('welcome', packagedFlow('welcome'));

        await engine.toggleFlow('welcome', false);
        await engine.toggleFlow('welcome', true);

        // Still one row, now `active: true` — not an absent row. ADR-0126 §6
        // wall 3: the ledger records the customer's CHOICES.
        expect(await store.list()).toEqual([{ name: 'welcome', packageId: 'crm', active: true }]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 — the execute() consult, on every entry path
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.2 — a ledger-disabled flow refuses at the execute() seam', () => {
    // The four trigger types whose flows reach `execute()` through their own
    // entry path. `execute()` is the ONE seam all of them cross (#11665 §2.3),
    // which is why the ADR puts the consult here — but "they all cross it" is
    // exactly the claim worth pinning, so each is driven separately.
    const entryPaths: Array<[string, Record<string, unknown>, keyof ReturnType<typeof engineWithLedger>['triggers']]> = [
        ['record-change', { objectName: 'lead', triggerType: 'record-after-create' }, 'record_change'],
        ['schedule', { schedule: '0 9 * * *' }, 'schedule'],
        ['time-relative', { timeRelative: { object: 'task', field: 'due_at' }, schedule: '0 * * * *' }, 'time_relative'],
        // An `api` flow registers only with its per-flow secret (ADR-0041).
        ['api', { triggerType: 'api', secret: 'hook-secret' }, 'api'],
    ];

    for (const [label, startConfig, triggerKey] of entryPaths) {
        it(`refuses a disabled ${label} flow with FLOW_DISABLED, and re-enabling restores firing`, async () => {
            const { engine, triggers } = engineWithLedger();
            engine.registerFlow('f', packagedFlow('f', startConfig));
            expect((await engine.execute('f')).success).toBe(true);

            await engine.toggleFlow('f', false);
            const refused = await engine.execute('f');

            expect(refused.success).toBe(false);
            // ADR-0126 §7.2 reuses the code deliberately — ⛔ no new ADR-0112
            // ledger entry — so the CODE must be the existing one...
            expect(refused.code).toBe('FLOW_DISABLED');
            // ...and the distinction has to ride the MESSAGE.
            expect(refused.error).toContain('sys_metadata_activation');
            expect(refused.error).toContain('ADR-0126');
            // The trigger is unbound too, so it does not even fire (§7.2).
            expect(triggers[triggerKey].isBound('f')).toBe(false);

            await engine.toggleFlow('f', true);
            expect((await engine.execute('f')).success).toBe(true);
            expect(triggers[triggerKey].isBound('f')).toBe(true);
        });
    }

    it('refuses on the SUBFLOW entry path, and the caller fails with the child refusal composed in', async () => {
        const { engine } = engineWithLedger();
        registerSubflowNode(engine, { logger: createTestLogger(), getService: () => undefined } as any);

        engine.registerFlow('child', packagedFlow('child'));
        engine.registerFlow('parent', {
            ...packagedFlow('parent'),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });
        expect((await engine.execute('parent')).success).toBe(true);

        // `child` has a packaged caller, so §7.3 refuses disabling it through
        // `toggleFlow`. That guard is the SUBJECT of the next describe block;
        // here the point is the runtime consult, so the ledger row is placed
        // directly — the shape a second process (or a previous boot) leaves.
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'child', packageId: 'crm', active: false });
        engine.setFlowActivationStore(store);
        await engine.hydrateFlowActivations();

        const direct = await engine.execute('child');
        expect(direct.success).toBe(false);
        expect(direct.code).toBe('FLOW_DISABLED');

        // The parent's own run fails at its subflow node, carrying the child's
        // refusal — the "inexplicable late failure" ADR-0126 §7.3 exists to
        // keep an administrator from causing by accident.
        const viaParent = await engine.execute('parent');
        expect(viaParent.success).toBe(false);
        expect(String(viaParent.error)).toContain('child');
    });

    it('a STATUS-disabled flow keeps its original message — the two disable reasons stay distinguishable', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('obsolete_flow', { ...packagedFlow('obsolete_flow'), status: 'obsolete' });

        const refused = await engine.execute('obsolete_flow');

        expect(refused.code).toBe('FLOW_DISABLED');
        expect(refused.error).toBe("Flow 'obsolete_flow' is disabled");
        // The point of the distinction: an operator reading this must not be
        // sent to the activation ledger for an authoring-state problem.
        expect(refused.error).not.toContain('sys_metadata_activation');
    });

    it('a ledger-disabled flow stays disabled across re-registration (publish / hot reload / boot pull)', async () => {
        const { engine, triggers } = engineWithLedger();
        const def = packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' });
        engine.registerFlow('f', def);
        await engine.toggleFlow('f', false);

        // The boot pull, a Studio publish and a dev hot reload all land here.
        engine.registerFlow('f', def);

        expect(triggers.record_change.isBound('f')).toBe(false);
        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 — trigger unbind / rebind, and boot hydration
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.2 — the install-level row unbinds the trigger', () => {
    it('disable UNBINDS and enable REBINDS, asserted on the trigger itself', async () => {
        const { engine, triggers } = engineWithLedger();
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-update' }));
        expect(triggers.record_change.isBound('f')).toBe(true);

        await engine.toggleFlow('f', false);
        expect(triggers.record_change.isBound('f')).toBe(false);

        await engine.toggleFlow('f', true);
        expect(triggers.record_change.isBound('f')).toBe(true);
    });

    it('hydration at boot unbinds a flow a PREVIOUS process disabled — the durability the map lacked', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', packageId: 'crm', active: false });

        // A brand-new engine: the #10243 map's "cold boot reads enabled: true
        // again" was recorded as mitigating-but-not-exculpating. It must no
        // longer be true.
        const engine = new AutomationEngine(createTestLogger());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.setFlowActivationStore(store);
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));

        const disarmed = await engine.hydrateFlowActivations();

        expect(disarmed).toEqual(['f']);
        expect(trigger.isBound('f')).toBe(false);
        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
    });

    it('getFlowRuntimeStates reports a ledger-disabled flow as disabled and unbound', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));
        await engine.toggleFlow('f', false);

        const [state] = engine.getFlowRuntimeStates();

        expect(state.name).toBe('f');
        expect(state.enabled).toBe(false);
        expect(state.bound).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.3 — the subflow cascade guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 — disabling a flow is refused while packaged flows call it as a subflow', () => {
    /** A packaged caller invoking `target` through the given node type. */
    function callerFlow(name: string, target: string, nodeType: 'subflow' | 'map') {
        return {
            ...packagedFlow(name),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                // A `map` carries the `collection` its executor contract requires (#20316).
                { id: 'call', type: nodeType, label: 'Call', config: { flowName: target, ...(nodeType === 'map' ? { collection: [] } : {}) } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        };
    }

    it('refuses, NAMES the caller, and carries the ADR-0112 envelope (code AND status)', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('vendor_process', callerFlow('vendor_process', 'shared_step', 'subflow'));

        await expect(engine.toggleFlow('shared_step', false)).rejects.toThrow(/vendor_process/);

        const thrown = await engine.toggleFlow('shared_step', false).catch((e) => e);
        // ADR-0112 envelope: code AND status. `DELETE_RESTRICTED` is the
        // standard catalog's "cannot, due to dependencies" member (409) — ⛔ no
        // new ledger entry was minted for this refusal.
        expect(thrown.code).toBe('DELETE_RESTRICTED');
        expect(thrown.status).toBe(409);
        expect(thrown.subflowCallers).toEqual(['vendor_process']);
        // Q2(c)'s rationale rides the message: WHY refusing beats letting the
        // caller fail late, and what the administrator can do instead.
        expect(thrown.message).toContain('subflow');
        expect(thrown.message).toContain('ADR-0126 §7.3');
        expect(thrown.message).toMatch(/Disable the calling flow/);

        // Refused means nothing moved: no row, still armed, still runnable.
        expect(await store.list()).toEqual([]);
        expect((await engine.execute('shared_step')).success).toBe(true);
    });

    it('names EVERY packaged caller, not just the first', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('caller_a', callerFlow('caller_a', 'shared_step', 'subflow'));
        engine.registerFlow('caller_b', callerFlow('caller_b', 'shared_step', 'subflow'));

        const thrown = await engine.toggleFlow('shared_step', false).catch((e) => e);

        expect(thrown.subflowCallers).toEqual(['caller_a', 'caller_b']);
        expect(thrown.message).toContain("'caller_a'");
        expect(thrown.message).toContain("'caller_b'");
    });

    it('guards a `map` caller too — its per-item target is a subflow by the node\'s own definition', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('per_item', packagedFlow('per_item'));
        engine.registerFlow('sweeper', callerFlow('sweeper', 'per_item', 'map'));

        const thrown = await engine.toggleFlow('per_item', false).catch((e) => e);

        // Scanning only `subflow` would let a `map` caller break exactly the
        // way §7.3 exists to prevent — it reaches its target through the same
        // `engine.execute`.
        expect(thrown?.code).toBe('DELETE_RESTRICTED');
        expect(thrown.subflowCallers).toEqual(['sweeper']);
    });

    it('with NO callers, disable lands', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('lonely', packagedFlow('lonely'));

        await expect(engine.toggleFlow('lonely', false)).resolves.toBeUndefined();

        expect(await store.list()).toEqual([{ name: 'lonely', packageId: 'crm', active: false }]);
        expect((await engine.execute('lonely')).code).toBe('FLOW_DISABLED');
    });

    it('a NON-packaged caller does not guard — a tenant\'s own flow cannot hold a packaged one hostage', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        // Same graph, no `_packageId`: authored by the customer.
        engine.registerFlow('my_own_process', {
            ...callerFlow('my_own_process', 'shared_step', 'subflow'),
            _packageId: undefined,
        });

        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
    });

    it('enabling a CALLEE is never guarded by its callers — arming a subflow cannot break the flows that call it', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('vendor_process', callerFlow('vendor_process', 'shared_step', 'subflow'));

        // Enabled with its caller still present: the caller side of the
        // enable direction is the next describe block's subject.
        await expect(engine.toggleFlow('shared_step', true)).resolves.toBeUndefined();
    });

    it('a flow calling ITSELF does not guard its own disable', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('recursive', callerFlow('recursive', 'recursive', 'subflow'));

        await expect(engine.toggleFlow('recursive', false)).resolves.toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.3, the disable direction — a switched-off caller guards only while it
// holds a parked run
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 (disable direction) — a switched-off packaged caller guards its subflow only while it holds a parked run', () => {
    // Switching a caller off stops its NEW runs only: a run it parked before
    // the switch-off resumes through `resume()`, which does not consult
    // activation, and walks on into its subflow node. So the guard reads
    // reachability — a parked run — and never the caller's switch alone.
    const nodeCtx = { logger: createTestLogger(), getService: () => undefined } as any;

    /** A pause point any raw `resume()` may continue, as an approval or a wait would park a run. */
    const PAUSER = {
        type: 'pauser',
        descriptor: defineActionDescriptor({
            type: 'pauser', version: '1.0.0', name: 'pauser',
            supportsPause: true, resumeAuthority: 'any',
        }),
        async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor;

    /** An engine that can run and PARK, over the given durable run store (none: the hot cache alone). */
    function parkingEngine(runStore?: SuspendedRunStore) {
        const engine = new AutomationEngine(createTestLogger(), runStore);
        const ledger = new InMemoryFlowActivationStore();
        engine.setFlowActivationStore(ledger);
        registerSubflowNode(engine, nodeCtx);
        registerMapNode(engine, nodeCtx);
        engine.registerNodeExecutor(PAUSER);
        return { engine, ledger };
    }

    /**
     * A packaged flow: `start → [hold (a pause)] → [call (subflow|map) target] → end`.
     * `map` iterates two items, so a pausing per-item flow parks the caller AT its map node.
     */
    function flow(name: string, opts: { hold?: boolean; call?: { target: string; nodeType: 'subflow' | 'map' } } = {}) {
        const nodes: Array<Record<string, unknown>> = [{ id: 'start', type: 'start', label: 'Start', config: {} }];
        if (opts.hold) nodes.push({ id: 'hold', type: 'pauser', label: 'Hold' });
        if (opts.call) {
            nodes.push({
                id: 'call',
                type: opts.call.nodeType,
                label: 'Call',
                config: { flowName: opts.call.target, ...(opts.call.nodeType === 'map' ? { collection: [1, 2] } : {}) },
            });
        }
        nodes.push({ id: 'end', type: 'end', label: 'End' });
        return {
            ...packagedFlow(name),
            nodes,
            edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id as string, target: n.id as string })),
        };
    }

    /** Disable `name` and hand back the refusal: the ADR-0112 envelope and `subflowCallers`, unchanged. */
    async function refusedDisable(engine: AutomationEngine, name: string, callers: string[]): Promise<any> {
        const thrown = await engine.toggleFlow(name, false).then(() => undefined, (e: unknown) => e);
        expect(thrown, `disabling '${name}' was accepted`).toBeDefined();
        expect((thrown as any).code).toBe('DELETE_RESTRICTED');
        expect((thrown as any).status).toBe(409);
        expect((thrown as any).subflowCallers).toEqual(callers);
        expect((thrown as any).message).toContain(`Flow '${name}' cannot be disabled`);
        return thrown;
    }

    /** The refusal names the parked run and the operator cancel door (ADR-0044) of the caller holding it. */
    function expectNamesParkedRun(thrown: any, caller: string, runId: string) {
        expect(thrown.message).toContain(`'${runId}'`);
        expect(thrown.message).toContain(`POST /automation/${caller}/runs/:runId/cancel`);
        expect(thrown.message).toContain('ADR-0044');
    }

    /** Refused means nothing moved: no ledger row for the callee. */
    async function expectNoRow(ledger: InMemoryFlowActivationStore, name: string) {
        expect((await ledger.list()).find((r) => r.name === name)).toBeUndefined();
    }

    it('the subflow pair: once the caller is switched off, the callee\'s disable completes at once — a caller with no parked run cannot reach it', async () => {
        const { engine, ledger } = parkingEngine();
        engine.registerFlow('shared_step', flow('shared_step'));
        engine.registerFlow('vendor_process', flow('vendor_process', { call: { target: 'shared_step', nodeType: 'subflow' } }));
        // A run that has ENDED is not parked, so it never counts.
        expect((await engine.execute('vendor_process')).success).toBe(true);

        // Armed, the caller guards, and the step it names is to switch it off.
        const thrown = await refusedDisable(engine, 'shared_step', ['vendor_process']);
        expect(thrown.message).toContain("Disable the calling flow 'vendor_process' first");

        // The prescribed sequence, followed: caller, then callee.
        await expect(engine.toggleFlow('vendor_process', false)).resolves.toBeUndefined();
        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
        expect(await ledger.list()).toContainEqual({ name: 'shared_step', packageId: 'crm', active: false });
        expect((await engine.execute('shared_step')).code).toBe('FLOW_DISABLED');
    });

    it('the map pair: while a per-item sign-off is parked, the refusal names the caller\'s run and the cancel door; after the cancel, the disable completes', async () => {
        const { engine, ledger } = parkingEngine();
        // The shipped map pair's shape: the per-item flow pauses (a sign-off).
        engine.registerFlow('one_task_signoff', flow('one_task_signoff', { hold: true }));
        engine.registerFlow('release_signoff', flow('release_signoff', { call: { target: 'one_task_signoff', nodeType: 'map' } }));

        const started = await engine.execute('release_signoff');
        expect(started.status).toBe('paused');
        const runId = started.runId!;
        // The caller waiting on its item is an ordinary parked run, AT its map node.
        expect(engine.listSuspendedRuns()).toContainEqual(expect.objectContaining({ runId, flowName: 'release_signoff', nodeId: 'call' }));

        await expect(engine.toggleFlow('release_signoff', false)).resolves.toBeUndefined();

        const thrown = await refusedDisable(engine, 'one_task_signoff', ['release_signoff']);
        expectNamesParkedRun(thrown, 'release_signoff', runId);
        await expectNoRow(ledger, 'one_task_signoff');

        // The door the refusal names, taken: the run ends, and the disable completes.
        expect(await engine.cancelRun(runId, 'switching the per-item flow off')).toBe(true);
        await expect(engine.toggleFlow('one_task_signoff', false)).resolves.toBeUndefined();
        expect(await ledger.list()).toContainEqual({ name: 'one_task_signoff', packageId: 'crm', active: false });
    });

    it('CONTROL — a switched-off caller with an enabled callee resumes its parked run to success, so the run guards; once it finishes, the disable completes', async () => {
        const { engine } = parkingEngine();
        engine.registerFlow('shared_step', flow('shared_step'));
        engine.registerFlow('vendor_process', flow('vendor_process', { hold: true, call: { target: 'shared_step', nodeType: 'subflow' } }));
        const runId = (await engine.execute('vendor_process')).runId!;
        await engine.toggleFlow('vendor_process', false);

        const thrown = await refusedDisable(engine, 'shared_step', ['vendor_process']);
        expectNamesParkedRun(thrown, 'vendor_process', runId);

        // The run the refusal protected: switched off, and it still resumes
        // THROUGH its subflow node, into the callee the refusal kept armed.
        const resumed = await engine.resume(runId);
        expect(resumed.success).toBe(true);
        expect((await engine.getRun(runId))?.status).toBe('completed');

        // "Or let it finish" — finished, the caller holds no parked run.
        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
    });

    it('a caller disabled by its definition\'s STATUS guards the same way — its parked run still resumes, since resume never consults enablement', async () => {
        const { engine, ledger } = parkingEngine();
        const vendorProcess = flow('vendor_process', { hold: true, call: { target: 'shared_step', nodeType: 'subflow' } });
        engine.registerFlow('shared_step', flow('shared_step'));
        engine.registerFlow('vendor_process', vendorProcess);
        const runId = (await engine.execute('vendor_process')).runId!;
        // Republished `obsolete`: disabled by its status, with no ledger row at all.
        engine.registerFlow('vendor_process', { ...vendorProcess, status: 'obsolete' });
        expect((await engine.execute('vendor_process')).code).toBe('FLOW_DISABLED');
        await expectNoRow(ledger, 'vendor_process');

        const thrown = await refusedDisable(engine, 'shared_step', ['vendor_process']);
        expectNamesParkedRun(thrown, 'vendor_process', runId);
        expect(thrown.message).not.toContain("Disable the calling flow 'vendor_process'");

        expect((await engine.resume(runId)).success).toBe(true);
        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
    });

    it('a run a PREVIOUS process parked — in the durable store, not in this process\'s cache — still guards', async () => {
        const runStore = new InMemorySuspendedRunStore();
        const register = (engine: AutomationEngine) => {
            engine.registerFlow('shared_step', flow('shared_step'));
            engine.registerFlow('vendor_process', flow('vendor_process', { hold: true, call: { target: 'shared_step', nodeType: 'subflow' } }));
        };
        const before = parkingEngine(runStore);
        register(before.engine);
        const runId = (await before.engine.execute('vendor_process')).runId!;

        // The restarted process: the same durable store, an empty hot cache.
        const { engine, ledger } = parkingEngine(runStore);
        register(engine);
        expect(engine.listSuspendedRuns()).toEqual([]);
        await engine.toggleFlow('vendor_process', false);

        const thrown = await refusedDisable(engine, 'shared_step', ['vendor_process']);
        expectNamesParkedRun(thrown, 'vendor_process', runId);
        await expectNoRow(ledger, 'shared_step');

        expect(await engine.cancelRun(runId)).toBe(true);
        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
    });

    it('a durable store that cannot be LISTED refuses the disable with its own failure — "unknown" is never read as "no parked run"', async () => {
        const outage = new Error('suspended-run store unreachable');
        const runStore = new InMemorySuspendedRunStore();
        runStore.list = async () => { throw outage; };
        const { engine, ledger } = parkingEngine(runStore);
        engine.registerFlow('shared_step', flow('shared_step'));
        engine.registerFlow('vendor_process', flow('vendor_process', { call: { target: 'shared_step', nodeType: 'subflow' } }));
        await engine.toggleFlow('vendor_process', false);

        const thrown = await engine.toggleFlow('shared_step', false).then(() => undefined, (e: unknown) => e);

        expect(thrown).toBe(outage);
        await expectNoRow(ledger, 'shared_step');
        expect((await engine.execute('shared_step')).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.3, the enable direction — a caller is not re-armed onto a disabled child
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 (enable direction) — re-enabling a packaged caller is refused while a packaged subflow it calls is disabled', () => {
    const ON_CREATE = { objectName: 'lead', triggerType: 'record-after-create' };
    const nodeCtx = { logger: createTestLogger(), getService: () => undefined } as any;

    /** An engine that can RUN a caller, so "the sequence completes" is a run, not a flag. */
    function runnableEngine() {
        const env = engineWithLedger();
        registerSubflowNode(env.engine, nodeCtx);
        registerMapNode(env.engine, nodeCtx);
        return env;
    }

    /** A packaged, record-triggered caller invoking each of `targets` through `nodeType`. */
    function caller(name: string, targets: string[], nodeType: 'subflow' | 'map' = 'subflow') {
        const calls = targets.map((target, i) => ({
            id: `call_${i}`,
            type: nodeType,
            label: `Call ${target}`,
            config: { flowName: target, ...(nodeType === 'map' ? { collection: [1] } : {}) },
        }));
        const chain = ['start', ...calls.map((c) => c.id), 'end'];
        return {
            ...packagedFlow(name, ON_CREATE),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: ON_CREATE },
                ...calls,
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: chain.slice(1).map((target, i) => ({ id: `e${i}`, source: chain[i], target })),
        };
    }

    /**
     * Enable `name` and hand back the refusal, asserting the envelope every
     * refusal pin shares: ADR-0112 code AND status, and the flow it refused.
     */
    async function refusedEnable(engine: AutomationEngine, name: string): Promise<any> {
        const thrown = await engine.toggleFlow(name, true).then(() => undefined, (e: unknown) => e);
        expect(thrown, `enabling '${name}' was accepted`).toBeDefined();
        expect((thrown as any).code).toBe('RESOURCE_CONFLICT');
        expect((thrown as any).status).toBe(409);
        expect((thrown as any).message).toContain(`Flow '${name}' cannot be enabled`);
        return thrown;
    }

    /**
     * The state the refusal exists for: a caller switched off while the
     * subflow it calls is switched off too. The callee is switched off BEFORE
     * the caller exists (a package upgrade that adds the caller), which is how
     * the pair gets there without the disable-direction guard.
     */
    async function bothSwitchedOff(engine: AutomationEngine, nodeType: 'subflow' | 'map') {
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        await engine.toggleFlow('shared_step', false);
        engine.registerFlow('vendor_process', caller('vendor_process', ['shared_step'], nodeType));
        await engine.toggleFlow('vendor_process', false);
    }

    for (const nodeType of ['subflow', 'map'] as const) {
        it(`the ${nodeType} pair: re-enabling the caller first is refused naming the subflow, and the sequence completes callee-first`, async () => {
            const { engine, store, triggers } = runnableEngine();
            await bothSwitchedOff(engine, nodeType);

            const thrown = await refusedEnable(engine, 'vendor_process');
            expect(thrown.message).toContain("'shared_step' (switched off in the activation ledger)");
            // The mirrored remedy, completable for a ledger-disabled child.
            expect(thrown.message).toContain("Enable 'shared_step' first, then enable this flow");

            // Refused means nothing moved: the row still reads off, the
            // trigger stays unbound, and a run is still refused at execute().
            expect(await store.list()).toContainEqual({ name: 'vendor_process', packageId: 'crm', active: false });
            expect(triggers.record_change.isBound('vendor_process')).toBe(false);
            expect((await engine.execute('vendor_process')).code).toBe('FLOW_DISABLED');

            // The remedy, followed: the subflow first, then the caller.
            await expect(engine.toggleFlow('shared_step', true)).resolves.toBeUndefined();
            await expect(engine.toggleFlow('vendor_process', true)).resolves.toBeUndefined();

            expect(triggers.record_change.isBound('vendor_process')).toBe(true);
            // A real run through the caller's `${nodeType}` node into the re-armed child.
            expect((await engine.execute('vendor_process')).success).toBe(true);
        });
    }

    it('names EVERY disabled subflow the caller calls', async () => {
        const { engine } = runnableEngine();
        engine.registerFlow('step_a', packagedFlow('step_a'));
        engine.registerFlow('step_b', packagedFlow('step_b'));
        await engine.toggleFlow('step_a', false);
        await engine.toggleFlow('step_b', false);
        engine.registerFlow('vendor_process', caller('vendor_process', ['step_a', 'step_b']));
        await engine.toggleFlow('vendor_process', false);

        const thrown = await refusedEnable(engine, 'vendor_process');

        expect(thrown.message).toContain('2 packaged subflows it calls are disabled');
        expect(thrown.message).toContain("Enable 'step_a' and 'step_b' first");
    });

    it('a STATUS-disabled subflow gets a remedy through its definition — this switch never moves a status', async () => {
        const { engine, triggers } = runnableEngine();
        engine.registerFlow('shared_step', { ...packagedFlow('shared_step'), status: 'obsolete' });
        engine.registerFlow('vendor_process', caller('vendor_process', ['shared_step']));
        await engine.toggleFlow('vendor_process', false);

        const thrown = await refusedEnable(engine, 'vendor_process');

        expect(thrown.message).toContain("'shared_step' (its definition's status is 'obsolete')");
        expect(thrown.message).toContain("Publish 'shared_step' with status 'active'");
        // ⛔ Never the toggle for this child: `toggleFlow('shared_step', true)`
        // lands and leaves it exactly as disabled as it was, so prescribing it
        // would be a remedy the administrator can follow and still be refused.
        expect(thrown.message).not.toContain("Enable 'shared_step'");
        expect((await engine.toggleFlow('shared_step', true).then(() => engine.execute('shared_step'))).code).toBe('FLOW_DISABLED');
        await expect(engine.toggleFlow('vendor_process', true)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });

        // The remedy, followed: the definition republished active.
        engine.registerFlow('shared_step', { ...packagedFlow('shared_step'), status: 'active' });
        await expect(engine.toggleFlow('vendor_process', true)).resolves.toBeUndefined();
        expect(triggers.record_change.isBound('vendor_process')).toBe(true);
        expect((await engine.execute('vendor_process')).success).toBe(true);
    });

    it('a subflow disabled BOTH ways is named with both reasons and both steps, and the steps complete', async () => {
        const { engine } = runnableEngine();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        await engine.toggleFlow('shared_step', false);
        engine.registerFlow('shared_step', { ...packagedFlow('shared_step'), status: 'invalid' });
        engine.registerFlow('vendor_process', caller('vendor_process', ['shared_step']));
        await engine.toggleFlow('vendor_process', false);

        const thrown = await refusedEnable(engine, 'vendor_process');

        expect(thrown.message).toContain(
            "'shared_step' (switched off in the activation ledger, and its definition's status is 'invalid')",
        );
        expect(thrown.message).toMatch(/Publish 'shared_step' with status 'active' .* and enable 'shared_step' first/);

        engine.registerFlow('shared_step', { ...packagedFlow('shared_step'), status: 'active' });
        await engine.toggleFlow('shared_step', true);
        await expect(engine.toggleFlow('vendor_process', true)).resolves.toBeUndefined();
        expect((await engine.execute('vendor_process')).success).toBe(true);
    });

    it('a CYCLE of switched-off flows does not guard itself — every order would be refused, so none is prescribed', async () => {
        const { engine } = runnableEngine();
        // Switched off while independent; a package upgrade then makes them
        // call each other.
        engine.registerFlow('ping', packagedFlow('ping'));
        engine.registerFlow('pong', packagedFlow('pong'));
        await engine.toggleFlow('ping', false);
        await engine.toggleFlow('pong', false);
        engine.registerFlow('ping', caller('ping', ['pong']));
        engine.registerFlow('pong', caller('pong', ['ping']));

        // Refusing 'ping' for 'pong' while refusing 'pong' for 'ping' would
        // be a remedy no sequence can complete.
        await expect(engine.toggleFlow('ping', true)).resolves.toBeUndefined();
        await expect(engine.toggleFlow('pong', true)).resolves.toBeUndefined();
    });

    it('a subflow disabled BOTH ways inside a ledger-disabled CYCLE is still named, with its publish remedy — the cycle exempts ledger bits only', async () => {
        const { engine } = runnableEngine();
        engine.registerFlow('ping', packagedFlow('ping'));
        engine.registerFlow('pong', packagedFlow('pong'));
        await engine.toggleFlow('ping', false);
        await engine.toggleFlow('pong', false);
        engine.registerFlow('ping', caller('ping', ['pong']));
        // `pong` closes the ledger cycle AND its definition disables it: no
        // enable order re-arms a status, so the cycle cannot excuse it.
        engine.registerFlow('pong', { ...caller('pong', ['ping']), status: 'invalid' });

        const thrown = await refusedEnable(engine, 'ping');

        expect(thrown.message).toContain(
            "'pong' (switched off in the activation ledger, and its definition's status is 'invalid')",
        );
        expect(thrown.message).toContain("Publish 'pong' with status 'active'");

        // The remedy, followed: the definition republished active, the switch
        // on (the ledger-only cycle exempts it now), then the caller.
        engine.registerFlow('pong', caller('pong', ['ping']));
        await expect(engine.toggleFlow('pong', true)).resolves.toBeUndefined();
        await expect(engine.toggleFlow('ping', true)).resolves.toBeUndefined();
    });

    it('a flow calling ITSELF does not guard its own re-enable', async () => {
        const { engine } = runnableEngine();
        engine.registerFlow('recursive', packagedFlow('recursive'));
        await engine.toggleFlow('recursive', false);
        engine.registerFlow('recursive', caller('recursive', ['recursive']));

        await expect(engine.toggleFlow('recursive', true)).resolves.toBeUndefined();
    });

    it('a chain back through an ENABLED flow is no cycle — the disabled subflow is still named, and enabling it first completes', async () => {
        const { engine } = runnableEngine();
        engine.registerFlow('head', packagedFlow('head'));
        engine.registerFlow('middle', packagedFlow('middle'));
        await engine.toggleFlow('head', false);
        await engine.toggleFlow('middle', false);
        engine.registerFlow('head', caller('head', ['middle']));
        engine.registerFlow('middle', caller('middle', ['tail']));
        // `tail` stays enabled, so `middle` can be re-enabled first.
        engine.registerFlow('tail', caller('tail', ['head']));

        const thrown = await refusedEnable(engine, 'head');
        expect(thrown.message).toContain("Enable 'middle' first");

        await expect(engine.toggleFlow('middle', true)).resolves.toBeUndefined();
        await expect(engine.toggleFlow('head', true)).resolves.toBeUndefined();
    });

    it('a NON-packaged caller is not guarded — a tenant\'s own flow is theirs to arm, through its status', async () => {
        const { engine, triggers } = runnableEngine();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        await engine.toggleFlow('shared_step', false);
        const own = (status: string) => ({ ...caller('my_own_process', ['shared_step']), _packageId: undefined, status });
        engine.registerFlow('my_own_process', own('obsolete'));

        // [#20726] This switch is not a customer flow's: it is refused for its
        // provenance, before §7.3 is asked — so no subflow is named.
        const thrown = await engine.toggleFlow('my_own_process', true).then(() => undefined, (e: unknown) => e);
        expect(thrown).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect((thrown as Error).message).not.toContain('shared_step');

        // Its own switch arms it, onto the switched-off packaged subflow:
        // §7.3 guards packaged callers only.
        engine.registerFlow('my_own_process', own('active'));
        expect(triggers.record_change.isBound('my_own_process')).toBe(true);
    });

    it('a NON-packaged subflow does not guard a packaged caller', async () => {
        const { engine } = runnableEngine();
        // [#20726] Switched off through its own switch, its status — the
        // toggle door refuses a flow no package ships.
        engine.registerFlow('my_step', { ...packagedFlow('my_step'), _packageId: undefined, status: 'obsolete' });
        engine.registerFlow('vendor_process', caller('vendor_process', ['my_step']));
        await engine.toggleFlow('vendor_process', false);

        await expect(engine.toggleFlow('vendor_process', true)).resolves.toBeUndefined();
    });

    it('enabling a caller that is ALREADY enabled is not refused — nothing is re-armed', async () => {
        const { engine, store } = runnableEngine();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        await engine.toggleFlow('shared_step', false);
        engine.registerFlow('vendor_process', caller('vendor_process', ['shared_step']));

        await expect(engine.toggleFlow('vendor_process', true)).resolves.toBeUndefined();
        expect(await store.list()).toContainEqual({ name: 'vendor_process', packageId: 'crm', active: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 / §4 — what actually reaches the ledger table
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §4/§5 — the row this line writes', () => {
    /**
     * The exact ObjectQL slice the store declares — find/insert/update, and
     * deliberately NO `delete`: re-enabling updates the `active` bit, it never
     * removes the row.
     */
    function fakeEngine(rows: any[] = []) {
        const inserted: any[] = [];
        const updated: any[] = [];
        return {
            inserted,
            updated,
            rows,
            find: vi.fn(async (_object: string, options: any) => {
                const where = options?.where ?? {};
                return rows.filter((r) =>
                    Object.entries(where).every(([k, v]) => {
                        // This double implements EQUALITY ONLY, and REFUSES
                        // anything else rather than quietly mismatching it. A
                        // matcher that read a combinator (`$in`, `$ne`, …) as a
                        // FIELD NAME would return `[]` and make a broken store
                        // look green — the silent-wrong class
                        // `pnpm check:where-matcher` exists to catch. Refusing
                        // is the conformance shape most discovered matchers
                        // already take, and the branch belongs HERE, in the
                        // predicate itself, not in the enclosing `find`.
                        if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
                            throw new Error(
                                `fakeEngine: unsupported WHERE combinator '${k}' — this double implements equality only`,
                            );
                        }
                        return r[k] === v;
                    }),
                );
            }),
            insert: vi.fn(async (_object: string, data: any) => {
                inserted.push(data);
                rows.push({ id: `row_${rows.length}`, ...data });
                return data;
            }),
            update: vi.fn(async (_object: string, data: any, options?: any) => {
                // Routed through ObjectQL's OWN dispatch predicate, so this
                // fake cannot be looser than the engine it stands in for
                // (#4434 shipped a dead REST route with its suite green off
                // exactly that gap). `pnpm check:engine-double-contract` is
                // the gate; the predicate lives in metadata-core, which this
                // package already depends on.
                assertEngineUpdateDispatch(data, options);
                updated.push(data);
                return data;
            }),
        };
    }

    it('writes metadata_type `flow` and no tenant column — the table has none', async () => {
        const fake = fakeEngine();
        const store = new ObjectStoreFlowActivationStore(fake as any);

        await store.setActive({ name: 'welcome', packageId: 'crm', active: false });

        expect(fake.inserted).toHaveLength(1);
        expect(fake.inserted[0]).toEqual({
            metadata_type: 'flow',
            name: 'welcome',
            package_id: 'crm',
            active: false,
        });
        // A row here is DEPLOYMENT-level state, owned by no organization, and
        // the table carries no tenant column at all. Asserted as an absent key
        // because the payload is the one place a tenant write could reappear
        // without touching the object declaration.
        expect(fake.inserted[0]).not.toHaveProperty('organization_id');
    });

    it('UPDATES the existing install-level row rather than inserting a second one', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'welcome', package_id: 'crm', active: false },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        await store.setActive({ name: 'welcome', packageId: 'crm', active: true });

        expect(fake.inserted).toHaveLength(0);
        expect(fake.updated).toEqual([{ id: 'r1', active: true, package_id: 'crm' }]);
    });

    it('reads EVERY flow row — the ledger is deployment-wide, with no tenant axis', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'first', active: false },
            { id: 'r2', metadata_type: 'flow', name: 'second', active: false },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        const rows = await store.list();

        // ⚠️ This replaces a pin that asserted rows carrying an organization
        // were SKIPPED. That skip guarded a reserved, never-written tenant
        // column, dropped before the table ever shipped — so no row can carry
        // an organization for a read to mistake for a deployment-wide answer.
        expect(rows.map((r: FlowActivationRow) => r.name)).toEqual(['first', 'second']);
    });

    it('reads a driver 0/1 boolean as disabled, not as active', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'f', active: 0 },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        // SQLite/libsql round-trip booleans as integers; a bare truthiness test
        // is fine here but an `=== false` test would silently re-arm the flow.
        expect((await store.list())[0].active).toBe(false);
    });

    it('a failing durable write ABORTS the flip — the engine never reports state the ledger lacks', async () => {
        const engine = new AutomationEngine(createTestLogger());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.setFlowActivationStore({
            list: async () => [],
            setActive: async () => { throw new Error('datasource unavailable'); },
        });
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));

        await expect(engine.toggleFlow('f', false)).rejects.toThrow('datasource unavailable');

        // Nothing moved in process: still armed, still bound, still runnable.
        expect(trigger.isBound('f')).toBe(true);
        expect((await engine.execute('f')).success).toBe(true);
    });

    it('with no store attached the flip still applies, and WARNS that it is not durable', async () => {
        const logger = createTestLogger();
        const engine = new AutomationEngine(logger);
        engine.registerFlow('f', packagedFlow('f'));

        await engine.toggleFlow('f', false);

        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
        // Degrading to in-process is a legitimate mode; degrading to it while
        // REPORTING durability is not.
        const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(warned).toContain('IN PROCESS ONLY');
        expect(warned).toContain('sys_metadata_activation');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #10243 — the retired mechanism is GONE, not shaded
// ─────────────────────────────────────────────────────────────────────────────

describe('#10243 — the process-local `flowEnabled` map is retired', () => {
    const engineSource = readFileSync(
        fileURLToPath(new URL('./engine.ts', import.meta.url)),
        'utf8',
    );

    it('the identifier no longer exists as engine STATE', () => {
        // A grep-level pin, because the thing being asserted is the absence of
        // a mechanism and no runtime surface can show an absence. Prose
        // mentions survive (the docblocks explaining the retirement name it on
        // purpose); a field declaration or any read/write does not.
        expect(engineSource).not.toMatch(/private\s+flowEnabled/);
        expect(engineSource).not.toMatch(/this\.flowEnabled/);
    });

    it('the only writers of the activation projection are hydration and toggleFlow', () => {
        // What made the retired map a leak was that it was the TRUTH and
        // anything could set it. This pins that the replacement projection has
        // exactly two writers, both of which go through the durable ledger —
        // so it cannot drift into being an independent off-switch.
        const writes = [...engineSource.matchAll(/this\.flowLedgerDisabled\.(add|delete)\(/g)];
        expect(writes.length).toBeGreaterThan(0);

        const writingMethods = engineSource
            .split(/\n    (?=[a-zA-Z]|\/\*\*)/)
            .filter((chunk) => /this\.flowLedgerDisabled\.(add|delete)\(/.test(chunk));
        for (const chunk of writingMethods) {
            expect(
                /hydrateFlowActivations|toggleFlow/.test(chunk),
                `an unexpected method writes flowLedgerDisabled:\n${chunk.slice(0, 400)}`,
            ).toBe(true);
        }
    });

    it('the engine exposes no way to set activation state without the ledger', () => {
        const engine = new AutomationEngine(createTestLogger());
        // The retired mechanism's public shape, in every spelling a caller
        // might reach for. `toggleFlow` is the sanctioned door and it writes
        // the ledger; nothing else may exist beside it.
        expect((engine as any).setFlowEnabled).toBeUndefined();
        expect((engine as any).flowEnabled).toBeUndefined();
        expect(typeof engine.toggleFlow).toBe('function');
        expect(typeof engine.setFlowActivationStore).toBe('function');
    });
});
