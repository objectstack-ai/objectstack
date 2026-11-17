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
import { packagedFlowDefaultReader } from './plugin.js';
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

/** The boot pull's arm for a body package `crm`'s loader registered. */
const PULL = { source: 'package', packageId: 'crm' } as const;

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
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);

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
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);

        await engine.execute('draft_contract');

        const lines = logger.info.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('FLOW_DISABLED'));
        expect(lines).toEqual([
            "FLOW_DISABLED: packaged flow 'draft_contract' refused — its package ships it switched off "
                + '(defaultActive: false) and the activation ledger (sys_metadata_activation) holds no row switching it on.',
        ]);
    });

    it("an administrator's toggle on writes the row, arms it and runs it", async () => {
        const { engine, store, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await engine.hydrateFlowActivations();

        await engine.toggleFlow('draft_contract', true);

        expect(await store.list()).toEqual([{ name: 'draft_contract', packageId: 'crm', active: true }]);
        expect(isBound('draft_contract')).toBe(true);
        expect(stateOf(engine, 'draft_contract')).toMatchObject({ enabled: true, bound: true });
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives a restart, the trigger registered after the pull and the ledger read (the stock boot order)', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await first.engine.toggleFlow('draft_contract', true);

        const engine = new AutomationEngine(createTestLogger());
        engine.setPackagedFlowSource((name) => (SHIPPED_BY_CRM.has(name) ? 'crm' : undefined));
        engine.setFlowActivationStore(first.store);
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await engine.hydrateFlowActivations();
        const recordChange = recordingTrigger('record_change');
        engine.registerTrigger(recordChange.trigger);

        expect(recordChange.isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives an uninstall and a reinstall: a boot without the package leaves the row, and the reinstall reads it', async () => {
        // The ledger store has no delete (`metadata-activation-store.ts`), and
        // nothing on the uninstall path writes it; here the boot WITHOUT the
        // package plays the uninstall, over the same durable store.
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await first.engine.toggleFlow('draft_contract', true);
        const row = await first.store.list();
        expect(row).toEqual([expect.objectContaining({ name: 'draft_contract', active: true })]);

        const uninstalled = new AutomationEngine(createTestLogger());
        uninstalled.setFlowActivationStore(first.store);
        await uninstalled.hydrateFlowActivations();
        expect(await first.store.list()).toEqual(row);

        const reinstalled = boot(first.store);
        reinstalled.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await reinstalled.engine.hydrateFlowActivations();
        expect(reinstalled.isBound('draft_contract')).toBe(true);
        expect((await reinstalled.engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives a restart on a host whose trigger was registered before the pull', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await first.engine.hydrateFlowActivations();
        await first.engine.toggleFlow('draft_contract', true);

        const restarted = boot(first.store);
        restarted.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        expect(await restarted.engine.hydrateFlowActivations()).toEqual([]);

        expect(restarted.isBound('draft_contract')).toBe(true);
        expect((await restarted.engine.execute('draft_contract')).success).toBe(true);
    });

    it('the switched-on state survives an upgrade that changes the body and still declares the default off', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await engine.hydrateFlowActivations();
        await engine.toggleFlow('draft_contract', true);

        // The upgrade re-registers the new version's body (a hot install, or the next boot's pull).
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false, version: 2, description: 'v2' }), PULL);

        expect(isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);
    });

    it('a flow switched back off stays off across a restart, whatever the default', async () => {
        const first = boot();
        first.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        await first.engine.toggleFlow('draft_contract', true);
        await first.engine.toggleFlow('draft_contract', false);
        expect(await first.store.list()).toEqual([{ name: 'draft_contract', packageId: 'crm', active: false }]);

        // The next version ships it on; the administrator's row still decides.
        const restarted = boot(first.store);
        restarted.engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: true, version: 2 }), PULL);
        expect(await restarted.engine.hydrateFlowActivations()).toEqual(['draft_contract']);
        expect(restarted.isBound('draft_contract')).toBe(false);
        expect((await restarted.engine.execute('draft_contract')).code).toBe('FLOW_DISABLED');
    });

    it('with no row, an upgrade that changes the declared default moves the installation, both ways', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        expect(isBound('draft_contract')).toBe(false);

        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { version: 2 }), PULL);
        expect(isBound('draft_contract')).toBe(true);
        expect((await engine.execute('draft_contract')).success).toBe(true);

        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false, version: 3 }), PULL);
        expect(isBound('draft_contract')).toBe(false);
        expect((await engine.execute('draft_contract')).code).toBe('FLOW_DISABLED');
    });

    it('CONTROL: `defaultActive: true` and an absent key ship the flow on, as every packaged flow before the key', async () => {
        const { engine, isBound } = boot();
        engine.registerFlow('on_explicit', packagedFlow('on_explicit', { defaultActive: true }), PULL);
        engine.registerFlow('on_absent', packagedFlow('on_absent'), PULL);
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
        engine.registerFlow('retired', packagedFlow('retired', { defaultActive: false, status: 'obsolete' }), PULL);
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
        ]), PULL);
        engine.registerFlow('parent', packagedFlow('parent', {}, [
            { id: 'start', type: 'start', label: 'Start', config: RECORD_START },
            { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } },
            { id: 'end', type: 'end', label: 'End' },
        ], [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ]), PULL);

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

    it('the key is judged by NAME against the loader\'s set, never by the arm: a package arm for a name no package ships is refused too', () => {
        const { engine } = boot();
        expect(() => engine.registerFlow(
            'unlisted_flow',
            environmentFlow('unlisted_flow', { defaultActive: false }),
            PULL,
        )).toThrow(/^Flow 'unlisted_flow' declares defaultActive/);
        expect(stateOf(engine, 'unlisted_flow')).toBeUndefined();
    });

    it('CONTROL: a name the loader\'s set holds keeps the key, whatever arm registers it', () => {
        const { engine } = boot();
        expect(() => engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }))).not.toThrow();
        expect(stateOf(engine, 'draft_contract')).toMatchObject({ enabled: true });
    });

    it('a dry run refuses an environment draft declaring the key, with what registration throws (#23317: one check list)', async () => {
        const { engine } = boot();
        const draft = environmentFlow('my_flow', { defaultActive: false });
        let registerError: unknown;
        try { engine.registerFlow('my_flow', draft); } catch (e) { registerError = e; }
        expect(registerError).toBeInstanceOf(Error);
        await expect(engine.dryRun(draft, { userId: 'usr_maker' })).rejects.toThrow((registerError as Error).message);
    });

    it('the stored pass lists a stored environment row declaring the key, at the key, and none without it', () => {
        const { engine } = boot();
        const { todos } = engine.canonicalizeStoredFlow('my_flow', environmentFlow('my_flow', { defaultActive: true }));
        expect(todos.map((t) => t.path)).toEqual(['flows[0].defaultActive']);
        expect(todos[0]!.reason).toContain("'my_flow' declares defaultActive");
        expect(engine.canonicalizeStoredFlow('my_flow', environmentFlow('my_flow')).todos).toEqual([]);
        expect(engine.canonicalizeStoredFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false })).todos).toEqual([]);
    });
});

describe('#34655 (seat ruling on S2) — a declared `.custom` override does not move the package\'s default', () => {
    /** The pair's declared override, as the boot pull arms it in the base's place. */
    const OVERRIDE = { source: 'override', packageId: 'crm.custom' } as const;

    /** One installation whose loader holds `crm`'s own bodies with these defaults. */
    function bootWithLoaderDefaults(defaults: Record<string, boolean | undefined>) {
        const booted = boot();
        booted.engine.setPackagedFlowDefaultSource((name, packageId) => (packageId === 'crm' ? defaults[name] : undefined));
        return booted;
    }

    it('the package ships it off and nobody switched it: an override that omits the key still does not arm', async () => {
        const { engine, isBound } = bootWithLoaderDefaults({ draft_contract: false });
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { description: 'customized' }), OVERRIDE);

        expect(isBound('draft_contract')).toBe(false);
        expect(stateOf(engine, 'draft_contract')).toMatchObject({ enabled: false });
        expect((await engine.execute('draft_contract')).code).toBe('FLOW_DISABLED');

        await engine.toggleFlow('draft_contract', true);
        expect(isBound('draft_contract')).toBe(true);
    });

    it('the package ships it on: an override that writes `false` does not switch it off, and the administrator still can', async () => {
        const { engine, isBound } = bootWithLoaderDefaults({ on_absent: undefined });
        engine.registerFlow('on_absent', packagedFlow('on_absent', { defaultActive: false }), OVERRIDE);

        expect(isBound('on_absent')).toBe(true);
        expect(stateOf(engine, 'on_absent')).toMatchObject({ enabled: true });

        await engine.toggleFlow('on_absent', false);
        expect(isBound('on_absent')).toBe(false);
    });

    it('CONTROL: with the loader\'s body armed, its own declaration is the default', () => {
        const { engine, isBound } = bootWithLoaderDefaults({});
        engine.registerFlow('draft_contract', packagedFlow('draft_contract', { defaultActive: false }), PULL);
        expect(isBound('draft_contract')).toBe(false);
    });
});

describe('#34655 — packagedFlowDefaultReader reads the package\'s own body off the loader\'s set', () => {
    const ctxWith = (protocol: unknown) => ({
        getService: (name: string) => {
            if (name !== 'protocol' || protocol === undefined) throw new Error(`service '${name}' not found`);
            return protocol as never;
        },
    });

    it("answers the declaration of THAT package's body, not another shipper's", () => {
        const shippedArtifactsOf = vi.fn(() => [
            { name: 'draft_contract', _packageId: 'other', defaultActive: true },
            { name: 'draft_contract', _packageId: 'crm', defaultActive: false },
        ]);
        const read = packagedFlowDefaultReader(ctxWith({ shippedArtifactsOf }));
        expect(read('draft_contract', 'crm')).toBe(false);
        expect(read('draft_contract', 'other')).toBe(true);
        expect(shippedArtifactsOf).toHaveBeenCalledWith('flow', 'draft_contract');
    });

    it('CONTROL: no declaration, no such body, a non-boolean, no protocol or no reader answer none', () => {
        const read = packagedFlowDefaultReader(ctxWith({
            shippedArtifactsOf: (_type: string, name: string) =>
                [{ name: 'f', _packageId: 'crm' }, { name: 'g', _packageId: 'crm', defaultActive: 'no' }].filter((a) => a.name === name),
        }));
        expect(read('f', 'crm')).toBeUndefined();
        expect(read('f', 'other')).toBeUndefined();
        expect(read('g', 'crm')).toBeUndefined();
        expect(packagedFlowDefaultReader(ctxWith(undefined))('f', 'crm')).toBeUndefined();
        expect(packagedFlowDefaultReader(ctxWith({}))('f', 'crm')).toBeUndefined();
    });
});
