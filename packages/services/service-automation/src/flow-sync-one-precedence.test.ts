// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20913, #20761 ruling rule 1, ADR-0126 §2] ONE precedence decision for every
// step that arms flows: the boot pull over the registry, the `kernel:ready`
// sync and the `metadata:reloaded` re-sync over the protocol's flow view.
//
// ## What was broken
//
// The boot pull resolved same-named contenders through `resolveFlowPrecedence`
// with the engine's loader's-set reader. The two protocol syncs did not: they
// registered every body the view listed, one after another, so a name listed
// twice armed whichever came LAST — and the `kernel:ready` sync runs after the
// boot pull, so it could re-arm over the body the boot pull had just chosen
// while the boot pull's receipt still described its own choice.
//
// Each case below lists a contested name in the view on purpose. The protocol
// no longer merges a stored row into a shipped name's slot
// (`protocol.flow-stored-row-shipped-name.test.ts`), so for the real view the
// held-name case is the protocol's to prevent; what this file pins is that
// the syncs, whatever a view lists, arm what the boot pull arms, by the same
// decision. The composition over two real boots is
// `flow-shipped-name-stored-row-boot.dogfood.test.ts` (packages/qa/dogfood).

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { bindStoredRow } from '@objectstack/metadata-protocol';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/** `resumeAuthority: 'any'` is required of a pausing fixture since #5561. */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold', supportsPause: true, resumeAuthority: 'any',
});

const FLOW = 'order_sync';
const OTHER = 'lonely_flow';

function flowBody(name: string, label: string, extra: Record<string, unknown> = {}) {
    return {
        name,
        label,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

/** The loader's entry for FLOW, as the registry holds it once the loader stamped it. */
const loaderEntry = () => flowBody(FLOW, 'LOADER', { _packageId: 'crm', _provenance: 'package' });
/** A stored row of the same name, tenant-marked the way the hydration registers it. */
const storedRow = () => flowBody(FLOW, 'STORED', { _provenance: 'org' });
const alphaEntry = () => flowBody(FLOW, 'ALPHA', { _packageId: 'alpha', _provenance: 'package' });
const betaEntry = () => flowBody(FLOW, 'BETA', { _packageId: 'beta', _provenance: 'package' });

interface Composition {
    /** What the boot pull reads — `registry.listItems('flow')`. */
    registry: unknown[];
    /** What the two syncs read — the protocol's execution view. */
    view: unknown[];
    /** The loader's set, by flow name. */
    loaderSet: Record<string, string>;
}

function compositionPlugin(c: Composition, captured: { ctx?: PluginContext }): Plugin {
    return {
        name: 'fake-composition',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            captured.ctx = ctx;
            const register = (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService;
            register('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? c.registry : []),
                    getObject: () => undefined,
                },
            });
            register('protocol', {
                packagedArtifactOwner: (request: { type: string; name: string }) =>
                    request.type === 'flow' ? c.loaderSet[request.name] : undefined,
                async getMetaItemsForExecution(q: { type: string }) {
                    return { items: q.type === 'flow' ? c.view : [] };
                },
            });
        },
    };
}

async function boot(c: Composition) {
    const captured: { ctx?: PluginContext } = {};
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(compositionPlugin(c, captured));
    kernel.use(new AutomationServicePlugin());
    await kernel.bootstrap();
    const engine = kernel.getService<AutomationEngine>('automation');
    const armed = async (name: string) => ((await engine.getFlow(name)) as { label?: string } | null)?.label;
    const reload = () => captured.ctx!.trigger('metadata:reloaded', {});
    return { kernel, engine, armed, reload };
}

describe('[#20913] the kernel:ready sync arms what the boot pull armed, by the same decision', () => {
    it('a held name listed with a stored row in the view: the loader\'s body stays armed', async () => {
        const c: Composition = {
            registry: [loaderEntry(), storedRow()],
            view: [loaderEntry(), storedRow()],
            loaderSet: { [FLOW]: 'crm' },
        };
        const { kernel, engine, armed } = await boot(c);
        try {
            expect(await armed(FLOW)).toBe('LOADER');
            // The receipt the boot pull wrote describes what is armed after the sync.
            expect(engine.getShadowedFlows()).toEqual([
                { name: FLOW, armed: { source: 'package', packageId: 'crm' }, shadowed: [{ source: 'runtime' }] },
            ]);
            // Every registration of the name was the loader's body — no step armed the stored one.
            expect(engine.getFlowVersionHistory(FLOW).map((h) => (h.definition as { label?: string }).label)).not.toContain('STORED');
        } finally {
            await kernel.shutdown();
        }
    });

    it('two packages shipping one name: the sync arms the boot pull\'s choice, not the last one listed', async () => {
        const c: Composition = {
            registry: [alphaEntry(), betaEntry()],
            view: [alphaEntry(), betaEntry()],
            loaderSet: { [FLOW]: 'alpha' },
        };
        const { kernel, armed } = await boot(c);
        try {
            expect(await armed(FLOW)).toBe('ALPHA');
        } finally {
            await kernel.shutdown();
        }
    });

    it('control: a name listed once is registered unchanged', async () => {
        const c: Composition = {
            registry: [],
            view: [flowBody(OTHER, 'ONLY')],
            loaderSet: {},
        };
        const { kernel, engine, armed } = await boot(c);
        try {
            expect(await armed(OTHER)).toBe('ONLY');
            expect(engine.getShadowedFlows()).toEqual([]);
        } finally {
            await kernel.shutdown();
        }
    });

    it('an unheld name listed twice: the sync resolves by arrival order, as the boot pull does', async () => {
        const c: Composition = {
            registry: [flowBody(FLOW, 'FIRST', { _provenance: 'org' })],
            view: [flowBody(FLOW, 'FIRST', { _provenance: 'org' }), flowBody(FLOW, 'SECOND', { _provenance: 'org' })],
            loaderSet: {},
        };
        const { kernel, armed } = await boot(c);
        try {
            expect(await armed(FLOW)).toBe('FIRST');
        } finally {
            await kernel.shutdown();
        }
    });
});

describe('[#20913] the metadata:reloaded re-sync resolves through the same decision', () => {
    it('a held name listed with a stored row: the reload keeps the loader\'s body armed', async () => {
        const c: Composition = { registry: [loaderEntry()], view: [loaderEntry()], loaderSet: { [FLOW]: 'crm' } };
        const { kernel, armed, reload } = await boot(c);
        try {
            expect(await armed(FLOW)).toBe('LOADER');
            c.view = [loaderEntry(), storedRow()];
            await reload();
            expect(await armed(FLOW)).toBe('LOADER');
        } finally {
            await kernel.shutdown();
        }
    });

    it('two packages: the reload arms the lexicographic first, in either listing order', async () => {
        const c: Composition = { registry: [alphaEntry()], view: [alphaEntry()], loaderSet: { [FLOW]: 'alpha' } };
        const { kernel, armed, reload } = await boot(c);
        try {
            for (const view of [[alphaEntry(), betaEntry()], [betaEntry(), alphaEntry()]]) {
                c.view = view;
                await reload();
                expect(await armed(FLOW)).toBe('ALPHA');
            }
        } finally {
            await kernel.shutdown();
        }
    });

    it('a name that leaves the view is still withdrawn: the tear-down reads the resolved names', async () => {
        const c: Composition = {
            registry: [],
            view: [flowBody(OTHER, 'ONLY'), loaderEntry()],
            loaderSet: { [FLOW]: 'crm' },
        };
        const { kernel, engine, reload } = await boot(c);
        try {
            expect(await engine.listFlows()).toEqual(expect.arrayContaining([OTHER, FLOW]));
            c.view = [loaderEntry(), storedRow()];
            await reload();
            expect(await engine.listFlows()).not.toContain(OTHER);
            expect(await engine.listFlows()).toContain(FLOW);
        } finally {
            await kernel.shutdown();
        }
    });
});

// ── [#28412] The declared .custom override, at every arming step ───────────
//
// ADR-0146 D9 item 1: the shipping package's declared override IS the
// packaged flow. What the protocol serves for it (its view half is
// `protocol.flow-stored-row-shipped-name.test.ts` and, over the real engine,
// `protocol-flow-custom-override.test.ts` in packages/objectql) is armed by
// every step: the boot pull over the registry, where the hydration recorded
// the row's `package_id` (`bindStoredRow`), the `kernel:ready` sync, the
// `metadata:reloaded` re-sync and the metadata-mutation sync over the view.
// Removing it re-arms the loader's body in one registration — never a
// withdraw-then-add, so no record change lands on an unbound name. As the
// cases above, a view listing both contenders is used on purpose: whatever a
// view lists, every step arms the declared override by the one decision.

describe('[#28412] the declared .custom override is armed by every step, and its removal re-arms the base', () => {
    const OWNER = 'com.example.crm';
    const PAIR = `${OWNER}.custom`;
    const DECLARED = { overrides: { package: OWNER, basedOn: '1.0.0' } };
    const OBJECT = 'ticket';
    const START = { objectName: OBJECT, triggerType: 'record-after-update' };

    /** start (record trigger) → mark(tag) → end: which body ran is the tag it records. */
    function triggered(label: string, extra: Record<string, unknown> = {}) {
        return {
            name: FLOW,
            label,
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: START },
                { id: 'mark', type: 'mark', label: 'Mark', config: { tag: label } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mark' },
                { id: 'e2', source: 'mark', target: 'end' },
            ],
            ...extra,
        };
    }
    const base = () => triggered('LOADER', { _packageId: OWNER, _provenance: 'package' });
    /** The registry's hydrated copy of a stored row, its `package_id` column recorded. */
    const hydrated = (binding: string | null, body: Record<string, unknown> = DECLARED) =>
        bindStoredRow(triggered('OVERRIDE', { ...body, _provenance: 'org' }), binding);
    /** What the protocol's view serves for the declared override: in the base's slot, under its provenance. */
    const served = () => triggered('OVERRIDE', { ...DECLARED, _packageId: OWNER, _provenance: 'package' });

    interface Step {
        registry: unknown[];
        view: unknown[];
    }

    /**
     * One composition: the boot pull's registry, the protocol's view, the
     * loader's set, a mutation signal, a recording `record_change` trigger
     * and a `mark` node executor.
     */
    async function compose(c: Step) {
        const listeners: Array<(evt: unknown) => void> = [];
        const captured: { ctx?: PluginContext } = {};
        const bindings: FlowTriggerBinding[] = [];
        const callbacks = new Map<FlowTriggerBinding, (ctx: AutomationContext) => Promise<void>>();
        const ran: string[] = [];
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use({
            name: 'fake-composition',
            version: '1.0.0',
            async init(ctx: PluginContext) {
                captured.ctx = ctx;
                const register = (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService;
                register('objectql', {
                    registry: { listItems: (type: string) => (type === 'flow' ? c.registry : []), getObject: () => undefined },
                });
                register('protocol', {
                    packagedArtifactOwner: (request: { type: string; name: string }) =>
                        request.type === 'flow' && request.name === FLOW ? OWNER : undefined,
                    async getMetaItemsForExecution(q: { type: string }) {
                        return { items: q.type === 'flow' ? c.view : [] };
                    },
                    onMetadataMutation(listener: (evt: unknown) => void) {
                        listeners.push(listener);
                        return () => undefined;
                    },
                });
            },
        } as Plugin);
        kernel.use(new AutomationServicePlugin());
        kernel.use({
            name: 'test.wiring',
            version: '1.0.0',
            async init(ctx: PluginContext) {
                const automation = ctx.getService<AutomationEngine>('automation');
                automation.registerTrigger({
                    type: 'record_change',
                    start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
                        bindings.push(binding);
                        callbacks.set(binding, cb);
                    },
                    stop(flowName: string) {
                        for (let i = bindings.length - 1; i >= 0; i--) {
                            if (bindings[i].flowName === flowName) callbacks.delete(bindings.splice(i, 1)[0]);
                        }
                    },
                });
                automation.registerNodeExecutor({
                    type: 'hold',
                    descriptor: HOLD_DESCRIPTOR,
                    async execute() { return { success: true, suspend: true, correlation: 'held' }; },
                } as never);
                automation.registerNodeExecutor({
                    type: 'mark',
                    async execute(node: { config?: { tag?: string } }) {
                        ran.push(String(node.config?.tag));
                        return { success: true };
                    },
                } as never);
            },
        } as Plugin);
        await kernel.bootstrap();
        const engine = kernel.getService<AutomationEngine>('automation');
        const withdrawn = vi.spyOn(engine, 'withdrawFlow');
        const armed = async () => ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label;
        /** One record change of OBJECT: every bound callback fires; returns the bodies that ran. */
        const recordChange = async () => {
            ran.length = 0;
            for (const b of [...bindings].filter((x) => x.object === OBJECT)) {
                await callbacks.get(b)!({ object: OBJECT, event: 'record-after-update', record: { id: 't1' } } as never);
            }
            return [...ran];
        };
        const settle = async () => {
            for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
        };
        const reload = async () => {
            await captured.ctx!.trigger('metadata:reloaded', {});
            await settle();
        };
        const mutate = async () => {
            for (const l of listeners) l({ type: 'flow', name: FLOW, state: 'active' });
            await settle();
        };
        /** The tags the `mark` node recorded since the last call. */
        const ranSince = async () => ran.splice(0, ran.length);
        return { kernel, engine, armed, recordChange, reload, mutate, withdrawn, ranSince, bindings: () => bindings.filter((b) => b.flowName === FLOW) };
    }

    it('the boot pull arms the override over the loader\'s body, with no shadowing receipt', async () => {
        const r = await compose({ registry: [base(), hydrated(PAIR)], view: [] });
        try {
            expect(await r.armed()).toBe('OVERRIDE');
            expect(r.engine.getShadowedFlows()).toEqual([]);
            expect(await r.recordChange()).toEqual(['OVERRIDE']);
        } finally {
            await r.kernel.shutdown();
        }
    });

    it('the kernel:ready sync arms the override, whatever order the view lists the two in', async () => {
        for (const view of [[base(), hydrated(PAIR)], [hydrated(PAIR), base()], [served()]]) {
            const r = await compose({ registry: [], view });
            try {
                expect(await r.armed()).toBe('OVERRIDE');
                expect(await r.recordChange()).toEqual(['OVERRIDE']);
            } finally {
                await r.kernel.shutdown();
            }
        }
    });

    for (const step of ['reload', 'mutate'] as const) {
        const label = step === 'reload' ? 'the metadata:reloaded re-sync' : 'the metadata-mutation sync';
        it(`${label}: publishing the override arms it, deleting it re-arms the base in place — one body per change`, async () => {
            const c: Step = { registry: [base()], view: [base()] };
            const r = await compose(c);
            try {
                expect(await r.armed()).toBe('LOADER');
                expect(await r.recordChange()).toEqual(['LOADER']);

                // Publish: the view now lists the declared override beside the loader's body.
                c.view = [base(), hydrated(PAIR)];
                await r[step]();
                expect(await r.armed()).toBe('OVERRIDE');
                expect(r.bindings()).toHaveLength(1);
                expect(await r.recordChange()).toEqual(['OVERRIDE']);

                // …and as the protocol serves it: one item, in the base's slot.
                c.view = [served()];
                await r[step]();
                expect(await r.armed()).toBe('OVERRIDE');
                expect(await r.recordChange()).toEqual(['OVERRIDE']);

                // Delete: the view serves the loader's body again.
                c.view = [base()];
                await r[step]();
                expect(await r.armed()).toBe('LOADER');
                expect(r.bindings()).toHaveLength(1);
                expect(await r.recordChange()).toEqual(['LOADER']);
                // Re-armed by one registration, never withdrawn first.
                expect(r.withdrawn).not.toHaveBeenCalled();
            } finally {
                await r.kernel.shutdown();
            }
        });
    }

    for (const [label, row] of [
        ['a dependent package\'s declaration', () => hydrated('com.example.partner')],
        ['a package-less row stamping the pair', () => hydrated(null, { ...DECLARED, _packageId: PAIR })],
        ['the pair\'s undeclared row', () => hydrated(PAIR, {})],
    ] as const) {
        it(`${label} is armed by no step`, async () => {
            const c: Step = { registry: [base(), row()], view: [base(), row()] };
            const r = await compose(c);
            try {
                expect(await r.armed()).toBe('LOADER');
                await r.reload();
                expect(await r.armed()).toBe('LOADER');
                await r.mutate();
                expect(await r.armed()).toBe('LOADER');
                expect(await r.recordChange()).toEqual(['LOADER']);
            } finally {
                await r.kernel.shutdown();
            }
        });
    }

    it('the ledger is the base\'s: switched off, the override is silent; switched on, it is armed again', async () => {
        const r = await compose({ registry: [base(), hydrated(PAIR)], view: [served()] });
        try {
            const store = new InMemoryFlowActivationStore();
            r.engine.setFlowActivationStore(store);
            expect(r.engine.packagedFlowOwner(FLOW)).toBe(OWNER);

            await r.engine.toggleFlow(FLOW, false);
            expect(await store.list()).toEqual([{ name: FLOW, packageId: OWNER, active: false }]);
            expect(r.bindings()).toHaveLength(0);
            expect(await r.recordChange()).toEqual([]);
            expect((await r.engine.execute(FLOW)).code).toBe('FLOW_DISABLED');
            // A re-sync re-registers the override; the ledger keeps it silent.
            await r.reload();
            expect(await r.armed()).toBe('OVERRIDE');
            expect(r.bindings()).toHaveLength(0);

            await r.engine.toggleFlow(FLOW, true);
            expect(r.bindings()).toHaveLength(1);
            expect(await r.recordChange()).toEqual(['OVERRIDE']);
        } finally {
            await r.kernel.shutdown();
        }
    });
    it('with N-12: a run suspended on the base finishes on the base; new runs start on the override', async () => {
        /** start → hold (pauses) → mark(tag) → end. */
        const pausing = (label: string, extra: Record<string, unknown> = {}) => ({
            name: FLOW, label, type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 's' },
                { id: 'approve', type: 'hold', label: 'h' },
                { id: 'mark', type: 'mark', label: 'm', config: { tag: label } },
                { id: 'end', type: 'end', label: 'e' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'approve' },
                { id: 'e2', source: 'approve', target: 'mark' },
                { id: 'e3', source: 'mark', target: 'end' },
            ],
            ...extra,
        });
        const c: Step = { registry: [], view: [pausing('LOADER', { _packageId: OWNER, _provenance: 'package' })] };
        const r = await compose(c);
        try {
            const parked = await r.engine.execute(FLOW, {} as never);
            expect(parked.status, JSON.stringify(parked)).toBe('paused');

            c.view = [pausing('OVERRIDE', { ...DECLARED, _packageId: OWNER, _provenance: 'package' })];
            await r.mutate();
            expect(await r.armed()).toBe('OVERRIDE');

            const fresh = await r.engine.execute(FLOW, {} as never);
            expect(fresh.status).toBe('paused');
            const ranLog: string[] = [];
            const resumedOld = await r.engine.resume(parked.runId!);
            expect(resumedOld.success, JSON.stringify(resumedOld)).toBe(true);
            ranLog.push(...(await r.ranSince()));
            const resumedNew = await r.engine.resume(fresh.runId!);
            expect(resumedNew.success, JSON.stringify(resumedNew)).toBe(true);
            ranLog.push(...(await r.ranSince()));
            expect(ranLog).toEqual(['LOADER', 'OVERRIDE']);
        } finally {
            await r.kernel.shutdown();
        }
    });
});
