// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34655, ADR-0126 §4 amendment] A packaged flow ships switched OFF with
// `defaultActive: false`: with no activation-ledger row it is not armed and
// does not run; an administrator's toggle writes a row, and the row wins over
// the declared default across a restart and an upgrade. Only a flow a package
// ships has that switch, so the key is refused on a flow authored in the
// environment.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

const RECORD_START = { objectName: 'quote', triggerType: 'record-after-update' };

/** A record-change flow a code package ships (the loader's stamps). */
function packagedFlow(name: string, extra: Record<string, unknown> = {}, nodes?: unknown[], edges?: unknown[]) {
    return {
        name,
        label: name,
        type: 'record_change',
        status: 'active',
        nodes: nodes ?? [
            { id: 'start', type: 'start', label: 'Start', config: RECORD_START },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: edges ?? [{ id: 'e1', source: 'start', target: 'end' }],
        _packageId: 'crm',
        ...extra,
    };
}

/** The same body with no package stamps: a flow authored in this environment. */
function environmentFlow(name: string, extra: Record<string, unknown> = {}) {
    const { _packageId: _dropped, ...body } = packagedFlow(name, extra);
    return body;
}

/** What a caller reads for a packaged flow switched off for the deployment. */
const TURNED_OFF_SENTENCE =
    'This flow is turned off for this deployment. An administrator can turn it on again '
    + "in its package's Automations in Studio, or copy it there under a new name.";

function recordingTrigger(type: string) {
    const bound = new Set<string>();
    const trigger: FlowTrigger = {
        type,
        start(binding: FlowTriggerBinding, _cb: (ctx: AutomationContext) => Promise<void>) {
            bound.add(binding.flowName);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n) };
}

/**
 * The loader's set: the flows package `crm` ships, whatever the bodies carry
 * (production: the automation plugin's `packagedFlowReader`). Asked before a
 * body is filed, so it is a set of its own, never read off the engine's map.
 */
const SHIPPED_BY_CRM = new Set(['draft_contract', 'on_explicit', 'on_absent', 'retired', 'child', 'parent']);

/** One installation: a fresh engine over `store`, the record-change trigger registered. */
function boot(store: InMemoryFlowActivationStore = new InMemoryFlowActivationStore()) {
    const logger = createTestLogger();
    const engine = new AutomationEngine(logger);
    engine.setPackagedFlowSource((name) => (SHIPPED_BY_CRM.has(name) ? 'crm' : undefined));
    engine.setFlowActivationStore(store);
    const recordChange = recordingTrigger('record_change');
    engine.registerTrigger(recordChange.trigger);
    return { engine, store, logger, isBound: recordChange.isBound };
}

function stateOf(engine: AutomationEngine, name: string) {
    return engine.getFlowRuntimeStates().find((s) => s.name === name);
}

describe('#34655 — a packaged flow declared `defaultActive: false` ships switched off', () => {
    it('a fresh install (no ledger row) neither arms nor runs it, and the status read says so', async () => {
        const { engine, store, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));

        expect(await engine.hydrateFlowActivations()).toEqual([]);
        expect(await store.list()).toEqual([]);
        expect(isBound('draft_contract')).toBe(false);
        expect(stateOf(engine, 'draft_contract')).toMatchObject({ enabled: false, bound: false, status: 'active' });

        const refused = await engine.execute('draft_contract');
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('FLOW_DISABLED');
        expect(refused.error).toBe(TURNED_OFF_SENTENCE);
    });

    it('the refusal log names the shipped default, not a ledger row', async () => {
        const { engine, logger } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));

        await engine.execute('draft_contract');

        const lines = logger.info.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('FLOW_DISABLED'));
        expect(lines).toEqual([
            "FLOW_DISABLED: packaged flow 'draft_contract' refused — its package ships it switched off "
                + '(defaultActive: false) and the activation ledger (sys_metadata_activation) holds no row switching it on.',
        ]);
    });

    it("an administrator's toggle on writes the row, arms it and runs it", async () => {
        const { engine, store, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await engine.hydrateFlowActivations();

        await engine.toggleFlow('draft_contract', true);

        expect(await store.list()).toEqual([{ name: 'draft_contract', packageId: 'crm', active: true }]);
        expect(isBound('draft_contract')).toBe(true);
        expect(stateOf(engine, 'draft_contract')).toMatchObject({ enabled: true, bound: true });
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives a restart, the trigger registered after the pull and the ledger read (the stock boot order)', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await first.engine.toggleFlow('draft_contract', true);

        const engine = new AutomationEngine(createTestLogger());
        engine.setPackagedFlowSource((name) => (SHIPPED_BY_CRM.has(name) ? 'crm' : undefined));
        engine.setFlowActivationStore(first.store);
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await engine.hydrateFlowActivations();
        const recordChange = recordingTrigger('record_change');
        engine.registerTrigger(recordChange.trigger);

        expect(recordChange.isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives a restart on a host whose trigger was registered before the pull', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await first.engine.hydrateFlowActivations();
        await first.engine.toggleFlow('draft_contract', true);

        const restarted = boot(first.store);
        restarted.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        expect(await restarted.engine.hydrateFlowActivations()).toEqual([]);

        expect(restarted.isBound('draft_contract')).toBe(true);
        expect((await restarted.engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives an upgrade that changes the body and still declares the default off', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await engine.hydrateFlowActivations();
        await engine.toggleFlow('draft_contract', true);

        // The upgrade re-registers the new version's body (a hot install, or the next boot's pull).
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false, version: 2, description: 'v2' }));

        expect(isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('a flow switched back off stays off across a restart, whatever the default', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        await first.engine.toggleFlow('draft_contract', true);
        await first.engine.toggleFlow('draft_contract', false);
        expect(await first.store.list()).toEqual([{ name: 'draft_contract', packageId: 'crm', active: false }]);

        // The next version ships it on; the administrator's row still decides.
        const restarted = boot(first.store);
        restarted.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: true, version: 2 }));
        expect(await restarted.engine.hydrateFlowActivations()).toEqual(['draft_contract']);
        expect(restarted.isBound('draft_contract')).toBe(false);
        expect((await restarted.engine.execute('draft_contract')).code).toBe('FLOW_DISABLED');
    });

    it('with no row, an upgrade that changes the declared default moves the installation, both ways', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }));
        expect(isBound('draft_contract')).toBe(false);

        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { version: 2 }));
        expect(isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);

        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false, version: 3 }));
        expect(isBound('draft_contract')).toBe(false);
        expect((await engine.execute('draft_contract')).code).toBe('FLOW_DISABLED');
    });

    it('CONTROL: `defaultActive: true` and an absent key ship the flow on, as every packaged flow before the key', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('on_explicit', packagedFlow('on_explicit', { defaultActive: true }));
        engine.registerFlow('on_absent', packagedFlow('on_absent'));
        expect(await engine.hydrateFlowActivations()).toEqual([]);

        for (const name of ['on_explicit', 'on_absent']) {
            expect(isBound(name)).toBe(true);
            expect((await engine.execute(name)).success).toBe(true);
        }
    });

    it("`status` stays the author's: an `obsolete` flow a row switches on still does not arm", async () => {
        // The row is placed directly, the shape an earlier boot leaves; what
        // the toggle door answers for such a flow is not this key's.
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'retired', packageId: 'crm', active: true });
        const { engine, isBound } = boot(store);
        engine.registerFlow('retired', packagedFlow('retired', { defaultActive: false, status: 'obsolete' }));
        await engine.hydrateFlowActivations();

        expect(isBound('retired')).toBe(false);
        expect(stateOf(engine, 'retired')).toMatchObject({ enabled: false });
        expect((await engine.execute('retired')).code).toBe('FLOW_DISABLED');
    });

    it('a packaged caller of a subflow that ships off is held unarmed until the subflow is switched on', async () => {
        const { engine, isBound } = boot();
        registerSubflowNode(engine, { logger: createTestLogger(), getService: () => undefined } as any);
        engine.registerFlow('child', packagedFlow('child', { defaultActive: false, type: 'autolaunched' }, [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ]));
        engine.registerFlow('parent', packagedFlow('parent', {}, [
            { id: 'start', type: 'start', label: 'Start', config: RECORD_START },
            { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } },
            { id: 'end', type: 'end', label: 'End' },
        ], [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ]));

        expect(isBound('parent')).toBe(false);

        await engine.toggleFlow('child', true);
        expect(isBound('parent')).toBe(true);
        expect((await engine.execute('parent')).success).toBe(true);
    });
});

describe('#34655 — `defaultActive` is refused on a flow authored in the environment', () => {
    for (const value of [false, true]) {
        // The engine throws a plain Error, as every registration refusal does;
        // the write doors answer it VALIDATION_FAILED / 400 (`registerAndSaveFlow`).
        it(`refuses \`defaultActive: ${value}\` on a flow no package ships, naming its status as its switch, filing nothing`, async () => {
            const { engine } = boot();
            let thrown: unknown;
            try {
                engine.registerFlow('my_flow', environmentFlow('my_flow', { defaultActive: value }));
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(Error);
            expect((thrown as Error).message).toBe(
                "Flow 'my_flow' declares defaultActive, which is the default of the switch an administrator turns a "
                    + "PACKAGED flow on and off with, and 'my_flow' was authored in this deployment, not shipped by a "
                    + 'package. A flow authored here is switched by its own status: remove defaultActive, and publish '
                    + "it with status 'obsolete' to keep it off or 'active' to arm it.",
            );
            expect(await engine.getFlow('my_flow')).toBeNull();
            expect(stateOf(engine, 'my_flow')).toBeUndefined();
        });
    }

    it('CONTROL: the same environment flow without the key registers and runs', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('my_flow', environmentFlow('my_flow'));
        expect(isBound('my_flow')).toBe(true);
        expect((await engine.execute('my_flow')).success).toBe(true);
    });

    it('CONTROL: a body registered under a package arm keeps the key, as the boot pull registers it', () => {
        // No loader set attached: the arm is the only witness that a package ships it.
        const engine = new AutomationEngine(createTestLogger());
        expect(() => engine.registerFlow(
            'unlisted_flow',
            environmentFlow('unlisted_flow', { defaultActive: false }),
            { source: 'package', packageId: 'crm' },
        )).not.toThrow();
        expect(engine.getFlowRuntimeStates().find((s) => s.name === 'unlisted_flow')).toMatchObject({ enabled: false });
    });
});
