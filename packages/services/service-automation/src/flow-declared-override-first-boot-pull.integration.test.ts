// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28717, ADR-0146 D9 item 1] A shipped flow name that holds BOTH a legacy
 * package-less stored row and the shipping package's declared `.custom`
 * override arms the override from the FIRST boot pull, not only once
 * `kernel:ready` re-arms from the protocol's view; the legacy row stays stored
 * and unarmed, and the boot pull names it in the shadowing warning.
 *
 * ## What was broken
 *
 * The SchemaRegistry holds one bare slot per flow name, and the boot hydration
 * (`loadMetaFromDb` → `hydrateOverlayIntoRegistry`) registered every stored row
 * of the name into it, the last one read winning. When the legacy row was read
 * after the override, the boot pull (`registry.listItems('flow')`) saw the
 * loader's body and the legacy row only: it armed the loader's body, warned
 * about the legacy row, and never saw the override. A record change fired
 * between the boot pull and `kernel:ready` ran the base flow, with no error.
 *
 * ## Why this harness
 *
 * The real composition the card names: an ObjectKernel, ObjectQLPlugin's
 * metadata protocol over driver-sql on a better-sqlite3 FILE, the shipping
 * package registered through the `manifest` service, and the real automation
 * plugin. A stored row is read back only by a cold boot, so the stack is
 * booted twice on one file: the first boot stores the rows, the second is
 * measured. The record trigger is the stand-in the sibling integration suites
 * use (`@objectstack/trigger-record-change` depends on this package): it binds
 * through ObjectQL's own `registerHook`, and a real insert fires it.
 *
 * The record change is fired from a plugin's `start()` that runs after the
 * automation plugin's — after the boot pull, before `kernel:ready`.
 *
 * Each row order is booted: the store's read order decides which row the bare
 * slot held before the fix, so the "legacy row read last" order is the one
 * that was red.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, ObjectLogger, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defineStack } from '@objectstack/spec';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, FlowTrigger, FlowTriggerBinding } from './engine.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const BASE = 'com.acme.crm';
const PAIR = `${BASE}.custom`;
const FLOW = 'crm_ticket_created';
const TICKET = 'crm_ticket';
const SYS = { isSystem: true } as const;

/** The base flow, record-triggered on TICKET; `marker` names the body by its label and its end node. */
const ticketFlow = (marker: string, extra: Record<string, unknown> = {}) => ({
    name: FLOW,
    label: marker,
    type: 'autolaunched',
    status: 'active',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: TICKET, triggerType: 'record-after-create' },
        },
        { id: `end_${marker.toLowerCase()}`, type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: `end_${marker.toLowerCase()}` }],
    ...extra,
});

const pluginManifest = (id: string) => ({
    id,
    namespace: 'crm',
    version: '1.0.0',
    type: 'plugin',
    name: 'crm',
});

/** The shipping package: one object and the base flow over it. */
const shippingStack = () =>
    defineStack(
        {
            manifest: pluginManifest(BASE),
            objects: [{ name: TICKET, label: 'Ticket', fields: { title: { name: 'title', label: 'Title', type: 'text' } } }],
            flows: [ticketFlow('BASE')],
        } as never,
        { strict: false },
    ) as Record<string, unknown>;

/** [#31754] A second package shipping FLOW's bare name — a clash sealed before ADR-0150 phase 1. */
const OTHER = 'com.acme.other';
const otherStack = () =>
    defineStack(
        { manifest: { ...pluginManifest(OTHER), namespace: 'other', name: 'other' }, flows: [ticketFlow('OTHER')] } as never,
        { strict: false },
    ) as Record<string, unknown>;

/** Whether, and before or after the shipping package, OTHER is registered. */
type Second = 'none' | 'before' | 'after';

type Row = 'override' | 'legacy';

const storedRow = (row: Row) =>
    row === 'override'
        ? {
            id: 'meta_override',
            name: FLOW,
            type: 'flow',
            state: 'active',
            package_id: PAIR,
            metadata: JSON.stringify(ticketFlow('OVERRIDE', { overrides: { package: BASE, basedOn: '1.0.0' } })),
        }
        : {
            id: 'meta_legacy',
            name: FLOW,
            type: 'flow',
            state: 'active',
            package_id: null,
            metadata: JSON.stringify(ticketFlow('LEGACY')),
        };

/** What each record change saw armed, and which body's end node its run reached. */
interface Fired {
    armedLabel: string | undefined;
}

function objectqlRecordTrigger(ql: () => ObjectQL, automation: () => AutomationEngine, fired: Fired[]): FlowTrigger {
    const packageOf = (flowName: string) => `qa-28717-trigger:${flowName}`;
    return {
        type: 'record_change',
        start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>) {
            ql().unregisterHooksByPackage(packageOf(binding.flowName));
            ql().registerHook(
                'afterInsert',
                async (hook: { result?: unknown }) => {
                    const armed = (await automation().getFlow(binding.flowName)) as { label?: string } | null;
                    fired.push({ armedLabel: armed?.label });
                    await callback({ record: hook.result, object: binding.object, event: 'afterInsert' } as never);
                },
                { object: binding.object, packageId: packageOf(binding.flowName) },
            );
        },
        stop(flowName: string) {
            ql().unregisterHooksByPackage(packageOf(flowName));
        },
    };
}

const kernels: ObjectKernel[] = [];
const dirs: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Boot the composition on `file`. `start` runs in a plugin that starts after
 * the automation plugin: after the boot pull, before `kernel:ready`.
 */
async function boot(file: string, start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>, second: Second = 'none') {
    const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    const fired: Fired[] = [];
    await kernel.use({
        name: 'test.driver.sqlite',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', driver);
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use({
        name: 'test.shipping-package',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql', 'com.objectstack.service-automation'],
        async init(ctx: PluginContext) {
            const manifests = ctx.getService<{ register(m: unknown): Promise<void> }>('manifest');
            const registerStack = (stack: Record<string, unknown>) => manifests.register({ ...(stack.manifest as object), ...stack });
            if (second === 'before') await registerStack(otherStack());
            await registerStack(shippingStack());
            if (second === 'after') await registerStack(otherStack());
            const ql = () => ctx.getService<ObjectQL>('objectql');
            const automation = () => ctx.getService<AutomationEngine>('automation');
            automation().registerTrigger(objectqlRecordTrigger(ql, automation, fired));
        },
        async start(ctx: PluginContext) {
            const ql = ctx.getService<ObjectQL>('objectql');
            await installDefaultOrganization(ql as never);
            await start(ql, ctx.getService<AutomationEngine>('automation'));
        },
    } as Plugin);
    await kernel.bootstrap();
    return { kernel, fired, automation: kernel.getService<AutomationEngine>('automation') };
}

/** The first boot stores `rows`, in this order; the second, cold, is measured. */
async function measuredBoot(
    rows: readonly Row[],
    start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>,
    second: Second = 'none',
) {
    const dir = mkdtempSync(join(tmpdir(), 'qa-28717-'));
    dirs.push(dir);
    const file = join(dir, 'store.db');
    const first = await boot(file, async (ql) => {
        for (const row of rows) await ql.insert('sys_metadata', storedRow(row), { context: SYS } as never);
    });
    await first.kernel.shutdown();
    kernels.splice(kernels.indexOf(first.kernel), 1);
    const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
    const measured = await boot(file, start, second);
    const collisionCalls = warn.mock.calls
        .filter(([message]) => String(message).includes('Flow name collision') && String(message).includes(`'${FLOW}'`));
    const collisions = collisionCalls.map(([message]) => String(message));
    // [#31754] The engine's own answer for FLOW: each refusal it logged while arming.
    const refusals = warn.mock.calls
        .filter(([message, meta]) =>
            String(message).endsWith('failed to register flow') && (meta as { flow?: unknown } | undefined)?.flow === FLOW)
        .map(([, meta]) => String((meta as { error?: unknown }).error));
    return { ...measured, collisions, collisionMeta: collisionCalls.map(([, meta]) => meta), refusals };
}

const insertTicket = (ql: ObjectQL, title: string) => ql.insert(TICKET, { title }, { context: SYS } as never);

describe('[#28717] a declared .custom flow override is armed from the first boot pull', () => {
    for (const rows of [['override', 'legacy'], ['legacy', 'override']] as const) {
        describe(`rows stored ${rows.join(' then ')}`, () => {
            it('a record change fired before kernel:ready runs the override\'s body', async () => {
                let armedAtPull: string | undefined;
                const { fired, automation } = await measuredBoot(rows, async (ql, engine) => {
                    armedAtPull = ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label;
                    await insertTicket(ql, 'before kernel:ready');
                });
                expect(automation.packagedFlowOwner(FLOW), 'control: the loader\'s set holds the name').toBe(BASE);
                expect(armedAtPull).toBe('OVERRIDE');
                expect(fired.map((f) => f.armedLabel)).toEqual(['OVERRIDE']);
                // After kernel:ready too, and no step armed the legacy body.
                expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('OVERRIDE');
                expect(automation.getFlowVersionHistory(FLOW).map((h) => (h.definition as { label?: string }).label))
                    .not.toContain('LEGACY');
            });

            it('the boot pull names the shadowed legacy row and the override that wins', async () => {
                const { automation, collisions } = await measuredBoot(rows, async () => {});
                expect(automation.getShadowedFlows()).toEqual([
                    {
                        name: FLOW,
                        armed: { source: 'override', packageId: PAIR },
                        shadowed: expect.arrayContaining([{ source: 'package', packageId: BASE }, { source: 'runtime' }]),
                    },
                ]);
                expect(automation.getShadowedFlows()[0].shadowed).toHaveLength(2);
                expect(collisions).toHaveLength(1);
                expect(collisions[0]).toContain(`arming the declared override in '${PAIR}' (sys_metadata)`);
                expect(collisions[0]).toContain('a runtime-authored row (sys_metadata)');
            });
        });
    }

    it('control: with only the legacy row, the base is armed and the row is shadowed and warned, as before', async () => {
        let armedAtPull: string | undefined;
        const { fired, automation, collisions } = await measuredBoot(['legacy'], async (ql, engine) => {
            armedAtPull = ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label;
            await insertTicket(ql, 'legacy only');
        });
        expect(armedAtPull).toBe('BASE');
        expect(fired.map((f) => f.armedLabel)).toEqual(['BASE']);
        expect(automation.getShadowedFlows()).toEqual([
            { name: FLOW, armed: { source: 'package', packageId: BASE }, shadowed: [{ source: 'runtime' }] },
        ]);
        expect(collisions).toHaveLength(1);
        expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('BASE');
    });

    it('control: with only the override, it is armed from the boot pull with no receipt and no warning (#28412)', async () => {
        let armedAtPull: string | undefined;
        const { fired, automation, collisions } = await measuredBoot(['override'], async (ql, engine) => {
            armedAtPull = ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label;
            await insertTicket(ql, 'override only');
        });
        expect(armedAtPull).toBe('OVERRIDE');
        expect(fired.map((f) => f.armedLabel)).toEqual(['OVERRIDE']);
        expect(automation.getShadowedFlows()).toEqual([]);
        expect(collisions).toEqual([]);
    });
});

/**
 * [ADR-0150 D3, epic #31527 child E5] Which package a reference written in the
 * armed body resolves from (`AutomationEngine.armedFlowPackage`, the caller
 * package of a `subflow` / `map` name and of a `connector_action`'s
 * `connectorId`). The loader's package only while the loader's OWN body is
 * armed; the shipping package's declared `.custom` override is an
 * environment-authored overlay, whose references resolve with no package
 * (ADR-0150 D3: "It never resolves from the package the overlay customizes").
 *
 * Read on the real composition at both arming steps: the boot pull arms from
 * the registry's list (the override as a stored row, with its binding), and
 * `kernel:ready` re-arms from the protocol's view (the override served in the
 * base's slot, stamped with the base's `_packageId`), so a stamp-reading
 * answer would read the base at one step or the other.
 */
describe('[ADR-0150 D3, #31677] the armed body\'s package is the loader\'s only while the loader\'s own body is armed', () => {
    const CASES: ReadonlyArray<readonly [string, readonly Row[], string | undefined]> = [
        ['the loader\'s body alone', [], BASE],
        ['a package-less stored row beside it (shadowed, the loader\'s body armed)', ['legacy'], BASE],
        ['the declared .custom override', ['override'], undefined],
        ['the declared override and a package-less row', ['override', 'legacy'], undefined],
    ];
    for (const [shape, rows, expected] of CASES) {
        it(`${shape}: ${expected ?? 'no package'} at the boot pull and after kernel:ready`, async () => {
            let atPull: { label?: string; pkg?: string } = {};
            const { automation } = await measuredBoot(rows, async (_ql, engine) => {
                atPull = {
                    label: ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label,
                    pkg: engine.armedFlowPackage(FLOW),
                };
            });
            const armedLabel = expected === undefined ? 'OVERRIDE' : 'BASE';
            expect(automation.packagedFlowOwner(FLOW), 'control: the loader\'s set holds the name').toBe(BASE);
            expect(atPull).toEqual({ label: armedLabel, pkg: expected });
            expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe(armedLabel);
            expect(automation.armedFlowPackage(FLOW)).toBe(expected);
        });
    }
});

/**
 * [#31754, ADR-0150 D3] The collision line agrees with the engine on a real
 * cold boot. A second package shipping FLOW's bare name (a clash sealed before
 * phase 1) makes the engine's resolver refuse the name for a caller with no
 * package, so `registerFlow` arms nothing — in each of the three shapes the
 * pull ranks differently (the two packages alone; the declared override beside
 * them; a package-less stored row beside them). Every collision line for the
 * name then reads "arming neither"/"arming none of them", its meta names no
 * armed contender, and the engine's refusal names both packages. The line asks
 * the resolver the engine asks (`refusalOf`), never a guess from the shapes.
 */
describe('[#31754] a name a second package also ships: the collision line says no definition is armed, as the engine does', () => {
    const SHAPES: ReadonlyArray<readonly [string, readonly Row[]]> = [
        ['two packages', []],
        ['the declared override beside a second package', ['override']],
        ['two packages and a package-less stored row', ['legacy']],
    ];
    for (const [shape, rows] of SHAPES) {
        for (const second of ['before', 'after'] as const) {
            it(`${shape}, the second package registered ${second} the shipping one`, async () => {
                let armedAtPull: unknown = 'unread';
                const { automation, collisions, collisionMeta, refusals } = await measuredBoot(rows, async (_ql, engine) => {
                    armedAtPull = await engine.getFlow(FLOW);
                }, second);

                // The engine: refused at every arming step, naming both packages; nothing armed.
                expect(refusals.length, 'the engine refused the name').toBeGreaterThan(0);
                for (const refusal of refusals) {
                    expect(refusal).toContain('held by 2 packages in this environment');
                    expect(refusal).toContain(`package "${BASE}"`);
                    expect(refusal).toContain(`package "${OTHER}"`);
                }
                expect(armedAtPull).toBeNull();
                expect(await automation.getFlow(FLOW)).toBeNull();
                expect(automation.getShadowedFlows()).toEqual([]);

                // The line: every collision warning for the name agrees.
                expect(collisions.length, 'the pull warned about the collision').toBeGreaterThan(0);
                for (const line of collisions) {
                    expect(line).toMatch(/; arming (neither|none of them): the engine refuses this bare name for a caller with no package \(ADR-0150 D3\), so no definition dispatches; /);
                    expect(line).toContain(`the 'failed to register flow' warning for '${FLOW}' names every holder. Rename one of them.`);
                    expect(line).not.toMatch(/arming (package|the declared override|a runtime-authored)/);
                    expect(line).not.toContain('Only the armed definition dispatches');
                }
                for (const meta of collisionMeta) {
                    expect(meta).toMatchObject({ flow: FLOW, refused: true });
                    expect(meta).not.toHaveProperty('armed');
                }
            });
        }
    }

    it('CONTROL: a name the resolver serves (one package and a package-less row) keeps its line byte for byte', async () => {
        const { automation, collisions, collisionMeta, refusals } = await measuredBoot(['legacy'], async () => {});
        expect(refusals).toEqual([]);
        expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('BASE');
        expect(collisions).toEqual([
            `[Automation] Flow name collision: '${FLOW}' is claimed by 2 definitions (package '${BASE}', a runtime-authored ` +
                `row (sys_metadata)); arming package '${BASE}' because a managed package's flow is sealed (ADR-0126 §2), and ` +
                'shadowing 1 other definition(s). Only the armed definition dispatches. To change what runs, declare it as ' +
                `an override in '${PAIR}' (overrides: { package: '${BASE}', basedOn }), or save it under a new name.`,
        ]);
        expect(collisionMeta).toEqual([{ flow: FLOW, armed: { source: 'package', packageId: BASE }, shadowed: [{ source: 'runtime' }] }]);
    });
});
