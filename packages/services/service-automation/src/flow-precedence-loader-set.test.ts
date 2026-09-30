// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20864, ADR-0126 §2 / §7.3] Boot-time flow precedence classifies its
// contenders by THE LOADER'S SET — the reader the engine holds
// (`setPackagedFlowSource` / `packagedFlowOwner`) — and never by the stamps a
// flow body carries.
//
// For a flow, "packaged" means exactly "loaded by the loader from a managed
// package", and every classification the engine makes reads that one
// server-held fact. The §7.3 guards, the arming gate and the activation door
// were moved onto it first (`packaged-flow-source.test.ts`); this file pins the
// last reader, the precedence that decides which same-named body the boot pull
// arms. Every pin hands precedence an EXPLICIT set and reads the answer off the
// classification, the shadowing record and the armed body — and the last block
// boots the real plugin, so the wiring from the metadata protocol's answer to
// the boot pull is pinned too, not only the pure function.

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, FlowContender } from './engine.js';
import { resolveFlowPrecedence, describeFlowContender, renderFlowContender } from './flow-precedence.js';

const FLOW = 'order_sync';

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

/** The stamps a body carries when it claims a package's provenance. */
const CLAIMED = { _packageId: 'crm', _provenance: 'package' };
/** What the boot hydration leaves on a stored row: the tenant marker, here with a binding. */
const TENANT = { _packageId: 'app.ops', _provenance: 'org' };

/** The loader's entry for FLOW, as the registry holds it once the loader stamped it. */
const loaderEntry = () => flowBody(FLOW, 'LOADER', CLAIMED);
/** A stored tenant row of the same name, as the hydration registers it. */
const tenantRow = () => flowBody(FLOW, 'TENANT', TENANT);

/** An explicit loader's set: flow name → the package that loaded it. */
const setOf = (set: Record<string, string>) => (name: string): string | undefined => set[name];
const HOLDS_FLOW = setOf({ [FLOW]: 'crm' });
const HOLDS_NOTHING = setOf({});

const silent = () => ({ warn: vi.fn() });

describe('[#20864] boot-time precedence classifies by the loader\'s set, not by body stamps', () => {
    it('a contender claiming a package ranks as tenant-authored when the set does not hold its name', () => {
        const claimed = loaderEntry();
        expect(describeFlowContender(claimed, HOLDS_NOTHING)).toEqual({ source: 'runtime', packageId: 'crm' });
        // The set is keyed by NAME: holding another flow vouches for nothing here.
        expect(describeFlowContender(claimed, setOf({ other_flow: 'crm' }))).toEqual({
            source: 'runtime',
            packageId: 'crm',
        });
        // The operator reads it as the tenant row it is; the claimed package
        // never reaches the sentence.
        expect(renderFlowContender(describeFlowContender(claimed, HOLDS_NOTHING))).toBe(
            renderFlowContender({ source: 'runtime' }),
        );
    });

    it('the same contender ranks as packaged when the set holds its name', () => {
        expect(describeFlowContender(loaderEntry(), HOLDS_FLOW)).toEqual({ source: 'package', packageId: 'crm' });
    });

    it('a stored tenant row stays tenant-authored inside a name the set holds', () => {
        expect(describeFlowContender(tenantRow(), HOLDS_FLOW)).toEqual({ source: 'runtime', packageId: 'app.ops' });
    });

    it('the same two bodies rank by the set: only a held name puts a packaged contender in the shadowing record', () => {
        const held = resolveFlowPrecedence([loaderEntry(), tenantRow()], silent(), HOLDS_FLOW);
        expect(held).toHaveLength(1);
        expect((held[0].definition as { label: string }).label).toBe('TENANT');
        expect(held[0].shadowing).toEqual({
            name: FLOW,
            armed: { source: 'runtime', packageId: 'app.ops' },
            shadowed: [{ source: 'package', packageId: 'crm' }],
        });

        const unheld = resolveFlowPrecedence([tenantRow(), loaderEntry()], silent(), HOLDS_NOTHING);
        expect(unheld[0].shadowing).toEqual({
            name: FLOW,
            armed: { source: 'runtime', packageId: 'app.ops' },
            shadowed: [{ source: 'runtime', packageId: 'crm' }],
        });
    });

    it('the shadowing record names the armed body in either arrival order, and the pull warning agrees', () => {
        for (const listed of [
            [loaderEntry(), tenantRow()],
            [tenantRow(), loaderEntry()],
        ]) {
            const logger = silent();
            const [winner] = resolveFlowPrecedence(listed, logger, HOLDS_FLOW);
            expect((winner.definition as { label: string }).label).toBe('TENANT');
            expect(winner.shadowing?.armed).toEqual({ source: 'runtime', packageId: 'app.ops' });
            expect(winner.shadowing?.shadowed).toEqual([{ source: 'package', packageId: 'crm' }]);

            expect(logger.warn).toHaveBeenCalledTimes(1);
            const [message, meta] = logger.warn.mock.calls[0] as [string, { armed: FlowContender; shadowed: FlowContender[] }];
            expect(message).toContain(`arming ${renderFlowContender({ source: 'runtime' })}`);
            expect(message).toContain(renderFlowContender({ source: 'package', packageId: 'crm' }));
            expect(meta.armed).toEqual(winner.shadowing?.armed);
            expect(meta.shadowed).toEqual(winner.shadowing?.shadowed);
        }
    });

    it('tenant-ranked contenders keep arrival order: a body\'s own id does not order them', () => {
        // Both tenant-ranked (the set holds nothing). By id alone the tenant
        // row would sort first; arrival order decides instead, so a claimed id
        // cannot buy the armed slot.
        const first = resolveFlowPrecedence([loaderEntry(), tenantRow()], silent(), HOLDS_NOTHING);
        expect((first[0].definition as { label: string }).label).toBe('LOADER');
        const second = resolveFlowPrecedence([tenantRow(), loaderEntry()], silent(), HOLDS_NOTHING);
        expect((second[0].definition as { label: string }).label).toBe('TENANT');
    });

    it('with no reader nothing is packaged: the engine\'s fail-closed answer', () => {
        expect(describeFlowContender(loaderEntry())).toEqual({ source: 'runtime', packageId: 'crm' });

        const [winner] = resolveFlowPrecedence([loaderEntry(), tenantRow()], silent());
        const record = winner.shadowing!;
        expect([record.armed, ...record.shadowed].map((c) => c.source)).toEqual(['runtime', 'runtime']);

        // A reader answering an empty owner names no package either — the
        // normalization `AutomationEngine.packagedFlowOwner` applies.
        expect(describeFlowContender(loaderEntry(), () => '')).toEqual({ source: 'runtime', packageId: 'crm' });
    });

    it('asks the set once per contested name, and never for an uncontested one', () => {
        const reader = vi.fn(HOLDS_FLOW);
        resolveFlowPrecedence([flowBody('lonely_flow', 'L', CLAIMED), loaderEntry(), tenantRow()], silent(), reader);
        expect(reader.mock.calls).toEqual([[FLOW]]);
    });
});

// ── The boot pull, through the real plugin ─────────────────────────────────

/** The one seam the boot pull reads — `registry.listItems('flow')`. */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
    return {
        name: 'fake-objectql',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
        },
    };
}

/**
 * The metadata protocol, reduced to the loader's-set read the plugin's
 * `packagedFlowReader` asks, plus an empty execution view so the kernel:ready
 * sync registers nothing over the pull under test.
 */
function fakeProtocolPlugin(packagedArtifactOwner: (request: { type: string; name: string }) => string | undefined): Plugin {
    return {
        name: 'fake-protocol',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('protocol', {
                packagedArtifactOwner,
                async getMetaItemsForExecution() {
                    return { items: [] };
                },
            });
        },
    };
}

async function boot(flows: unknown[], protocol?: Plugin) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(fakeObjectqlPlugin(flows));
    if (protocol) kernel.use(protocol);
    kernel.use(new AutomationServicePlugin());
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService<AutomationEngine>('automation') };
}

describe('[#20864] the boot pull hands precedence the engine\'s loader\'s-set reader', () => {
    it('a held name: the shadowing receipt names the tenant row armed and the loader entry packaged', async () => {
        const owner = vi.fn((request: { type: string; name: string }) =>
            request.type === 'flow' && request.name === FLOW ? 'crm' : undefined,
        );
        const { kernel, engine } = await boot([loaderEntry(), tenantRow()], fakeProtocolPlugin(owner));
        try {
            expect(engine.getShadowedFlows()).toEqual([
                {
                    name: FLOW,
                    armed: { source: 'runtime', packageId: 'app.ops' },
                    shadowed: [{ source: 'package', packageId: 'crm' }],
                },
            ]);
            expect(((await engine.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('TENANT');
            // One source: the pull asked the protocol for this flow, and the
            // engine's own reader gives the same answer.
            expect(owner).toHaveBeenCalledWith({ type: 'flow', name: FLOW });
            expect(engine.packagedFlowOwner(FLOW)).toBe('crm');
        } finally {
            await kernel.shutdown();
        }
    });

    it('an unheld name: no contender is packaged, whatever the bodies claim', async () => {
        const { kernel, engine } = await boot([tenantRow(), loaderEntry()], fakeProtocolPlugin(() => undefined));
        try {
            const [record] = engine.getShadowedFlows();
            expect(record.name).toBe(FLOW);
            expect([record.armed, ...record.shadowed].map((c) => c.source)).toEqual(['runtime', 'runtime']);
        } finally {
            await kernel.shutdown();
        }
    });

    it('no protocol service: fail closed, no contender is packaged', async () => {
        const { kernel, engine } = await boot([loaderEntry(), tenantRow()]);
        try {
            const [record] = engine.getShadowedFlows();
            expect([record.armed, ...record.shadowed].map((c) => c.source)).toEqual(['runtime', 'runtime']);
        } finally {
            await kernel.shutdown();
        }
    });
});
