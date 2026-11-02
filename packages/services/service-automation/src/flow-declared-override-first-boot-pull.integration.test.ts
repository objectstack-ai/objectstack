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
async function boot(file: string, start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>) {
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
            const stack = shippingStack();
            await ctx.getService<{ register(m: unknown): Promise<void> }>('manifest')
                .register({ ...(stack.manifest as object), ...stack });
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
async function measuredBoot(rows: readonly Row[], start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'qa-28717-'));
    dirs.push(dir);
    const file = join(dir, 'store.db');
    const first = await boot(file, async (ql) => {
        for (const row of rows) await ql.insert('sys_metadata', storedRow(row), { context: SYS } as never);
    });
    await first.kernel.shutdown();
    kernels.splice(kernels.indexOf(first.kernel), 1);
    const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
    const measured = await boot(file, start);
    const collisions = warn.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('Flow name collision') && message.includes(`'${FLOW}'`));
    return { ...measured, collisions };
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
