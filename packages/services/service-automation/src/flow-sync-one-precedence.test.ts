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

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

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
