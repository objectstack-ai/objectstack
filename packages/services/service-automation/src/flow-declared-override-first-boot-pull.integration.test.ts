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
import { SysMetadataActivation } from '@objectstack/platform-objects';
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

/**
 * Whether, and before or after the shipping package, OTHER is registered: as code packages in `init()`, or
 * [M2] installed, at `kernel:ready` as the install-local rehydrate does (`installed-both`: BASE too, in that order).
 */
type Second = 'none' | 'before' | 'after' | 'installed-after' | 'installed-both' | 'installed-both-reversed';

type Row = 'override' | 'legacy' | 'other-override';

const storedRow = (row: Row) =>
    // [#32613] OTHER's declared override, in OTHER's own pair.
    row === 'other-override'
        ? {
            id: 'meta_other_override',
            name: FLOW,
            type: 'flow',
            state: 'active',
            package_id: `${OTHER}.custom`,
            metadata: JSON.stringify(ticketFlow('OTHER-OVERRIDE', { overrides: { package: OTHER, basedOn: '1.0.0' } })),
        }
        : row === 'override'
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
async function boot(
    file: string,
    start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>,
    second: Second = 'none',
    ledger = false,
) {
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
    // [M2] The activation ledger is attached beside the durable run store only.
    await kernel.use(new AutomationServicePlugin(ledger ? {} : { suspendedRunStore: 'memory' }));
    await kernel.use({
        name: 'test.shipping-package',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql', 'com.objectstack.service-automation'],
        async init(ctx: PluginContext) {
            // [M2] The activation ledger, as `PlatformObjectsPlugin` registers it.
            if (ledger) ctx.getService<ObjectQL>('objectql').registry.registerObject(SysMetadataActivation as never, 'qa-31696-ledger', 'qa-31696-ledger');
            const manifests = ctx.getService<{ register(m: unknown): Promise<void> }>('manifest');
            const registerStack = (stack: Record<string, unknown>) => manifests.register({ ...(stack.manifest as object), ...stack });
            if (second === 'before') await registerStack(otherStack());
            if (!second.startsWith('installed-both')) await registerStack(shippingStack());
            if (second === 'after') await registerStack(otherStack());
            if (second.startsWith('installed-')) {
                ctx.hook('kernel:ready', async () => {
                    if (second === 'installed-both') await registerStack(shippingStack());
                    await registerStack(otherStack());
                    if (second === 'installed-both-reversed') await registerStack(shippingStack());
                });
            }
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
 * [#31696, ADR-0150 D4; was #31754] A second package shipping FLOW's bare
 * name (a clash sealed before phase 1) on a real cold boot: each package's
 * flow is armed in its own slot — the shipping package's own body, or its
 * declared `.custom` override — in each of the three shapes the pull ranks
 * differently, and whichever package registers first. The line #31754 drew
 * ("arming neither") moved here: nothing is refused at arming, no collision
 * line is written, and the bare name is refused where it is asked, naming
 * both packages. A package-less stored row customizes neither holder: it is
 * not armed, and the pull says so.
 */
describe('[#31696] a name a second package also ships: each package\'s flow is armed in its own slot', () => {
    const SHAPES: ReadonlyArray<readonly [string, readonly Row[], string]> = [
        ['two packages', [], 'BASE'],
        ['the declared override beside a second package', ['override'], 'OVERRIDE'],
        ['two packages and a package-less stored row', ['legacy'], 'BASE'],
    ];
    const labels = (engine: AutomationEngine) =>
        Object.fromEntries(engine.getFlowSlots(FLOW).map((slot) => [
            slot.packageId,
            (engine.getFlowSlot(slot.packageId, FLOW) as { label?: string } | null)?.label,
        ]));
    for (const [shape, rows, baseLabel] of SHAPES) {
        for (const second of ['before', 'after'] as const) {
            it(`${shape}, the second package registered ${second} the shipping one`, async () => {
                let armedAtPull: unknown = 'unread';
                const { automation, collisions, refusals } = await measuredBoot(rows, async (_ql, engine) => {
                    armedAtPull = labels(engine);
                }, second);

                // Both armed, each its own body, at the pull and after kernel:ready.
                expect(armedAtPull).toEqual({ [BASE]: baseLabel, [OTHER]: 'OTHER' });
                expect(labels(automation)).toEqual({ [BASE]: baseLabel, [OTHER]: 'OTHER' });
                expect(refusals).toEqual([]);
                expect(collisions).toEqual([]);
                expect(automation.getShadowedFlows()).toEqual([]);

                // The bare name: refused where it is asked, naming both; nothing runs.
                const bare = await automation.execute(FLOW);
                expect(bare.success).toBe(false);
                expect(bare.error).toContain('held by 2 packages in this environment');
                expect(bare.error).toContain(`package "${BASE}"`);
                expect(bare.error).toContain(`package "${OTHER}"`);
                await expect(automation.getFlow(FLOW)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });

                // [#31696 PR-2] Each slot is handed to its trigger under its own key; the bare name is bound to none.
                const bound = automation.getActiveTriggerBindings().map((b) => b.flowName);
                expect(bound.filter((key) => key === FLOW || key.endsWith(`/${FLOW}`)).sort()).toEqual([`${BASE}/${FLOW}`, `${OTHER}/${FLOW}`].sort());
            });
        }
    }

    it('a package-less stored row of the name customizes neither holder: not armed, and the pull says so', async () => {
        const { automation } = await measuredBoot(['legacy'], async () => {}, 'after');
        expect(Object.values(labels(automation))).not.toContain('LEGACY');
        // The spy `measuredBoot` installed on the logger, still in place.
        const overlay = vi.mocked(ObjectLogger.prototype.warn).mock.calls.filter(([message]) =>
            String(message).includes(`Flow name '${FLOW}' is held by 2 packages`));
        expect(overlay.length).toBeGreaterThan(0);
        expect(String(overlay[0][0])).toContain('customizes neither and is not armed');
        expect(overlay[0][1]).toMatchObject({ flow: FLOW, holders: [BASE, OTHER].sort() });
    });

    /**
     * [#32613] Each package's declared override, in its own pair, beside a
     * package-less row read after it: the boot pull arms each holder's
     * override in that holder's slot, whichever package registers first (and
     * so owns the bare name). Before, an override was judged against the
     * bare-name owner alone, so the other holder's override read as a plain
     * stored row: the package-less row read after it took the bare slot and
     * dropped it, and the pull armed that holder's shipped body until
     * `kernel:ready` re-armed from the protocol's view.
     */
    const OVERRIDES: ReadonlyArray<readonly [readonly Row[], Second, string, string]> = [
        [['other-override', 'legacy'], 'after', 'BASE', 'OTHER-OVERRIDE'],
        [['override', 'legacy'], 'before', 'OVERRIDE', 'OTHER'],
        [['override', 'other-override'], 'before', 'OVERRIDE', 'OTHER-OVERRIDE'],
        [['other-override', 'override'], 'after', 'OVERRIDE', 'OTHER-OVERRIDE'],
        [['override', 'other-override', 'legacy'], 'before', 'OVERRIDE', 'OTHER-OVERRIDE'],
        [['other-override', 'override', 'legacy'], 'after', 'OVERRIDE', 'OTHER-OVERRIDE'],
    ];
    for (const [rows, second, baseLabel, otherLabel] of OVERRIDES) {
        it(`[#32613] rows ${rows.join(' then ')}, the second package registered ${second}: each holder's own body at the pull`, async () => {
            let armedAtPull: unknown = 'unread';
            const { automation, refusals } = await measuredBoot(rows, async (_ql, engine) => {
                armedAtPull = labels(engine);
            }, second);
            expect(armedAtPull).toEqual({ [BASE]: baseLabel, [OTHER]: otherLabel });
            expect(labels(automation)).toEqual({ [BASE]: baseLabel, [OTHER]: otherLabel });
            expect(refusals).toEqual([]);
        });
    }

    /**
     * [M2] A package-less disable row read by a boot that reassembles the clash (pull, ledger read, then the
     * `kernel:ready` rehydrate): the first package to register is not the row's owner, so it binds to neither.
     */
    async function ledgerBoot(second: Second) {
        const dir = mkdtempSync(join(tmpdir(), 'qa-31696-'));
        dirs.push(dir);
        const file = join(dir, 'store.db');
        const first = await boot(file, async () => {}, 'none', true);
        // Written after the first boot's seal, so its backfill does not bind it: a row of an older release.
        await first.kernel.getService<ObjectQL>('objectql')
            .insert('sys_metadata_activation', { metadata_type: 'flow', name: FLOW, active: false }, { context: SYS } as never);
        await first.kernel.shutdown();
        kernels.splice(kernels.indexOf(first.kernel), 1);
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const measured = await boot(file, async () => {}, second, true);
        await measured.automation.flowActivationBinds();
        const ledger = (await measured.kernel.getService<ObjectQL>('objectql')
            .find('sys_metadata_activation', { where: { metadata_type: 'flow', name: FLOW }, context: SYS } as never)) as Array<Record<string, unknown>>;
        return { ...measured, warn, ledger };
    }
    for (const second of ['installed-after', 'installed-both', 'installed-both-reversed'] as const) {
        it(`M2: a package-less disable row is bound to no package by the boot (${second}): both off, the row names no package`, async () => {
            const { automation, ledger, warn } = await ledgerBoot(second);
            expect(automation.getFlowSlots(FLOW).map((slot) => slot.packageId).sort()).toEqual([BASE, OTHER].sort());
            expect(await automation.executeSlot(BASE, FLOW)).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
            expect(await automation.executeSlot(OTHER, FLOW)).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
            expect(ledger).toHaveLength(1);
            expect(ledger[0].package_id ?? null).toBeNull();
            const said = warn.mock.calls.filter(([message]) =>
                String(message).includes(`The flow "${FLOW}" is switched off by an activation row that names no package`));
            expect(said.length).toBeGreaterThan(0);
        });
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
