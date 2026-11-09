// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3] `AutomationEngine.armedFlowPackage` — the package whose own
 * body the engine runs for a flow name — measured on a real kernel.
 *
 * A reference written in a flow's body (an approval step's `queue` approver,
 * a connector id) is read from the package of the body that RUNS, not the
 * package that ships the name: ADR-0150 D3 makes a reference in an
 * environment-authored overlay the environment's, resolved as a caller with no
 * package. So the reader has to tell the loader's own body from the shipping
 * package's declared `.custom` override (ADR-0146 D9 item 1), which is armed
 * over it under the same name — where `packagedFlowOwner` answers the
 * shipping package for both.
 *
 * The harness is #28717's (`flow-declared-override-first-boot-pull`): an
 * ObjectKernel, ObjectQL's metadata protocol over driver-sql on a
 * better-sqlite3 file, the shipping package registered through the
 * `manifest` service and the real automation plugin, booted twice on one file
 * so the stored rows are read back cold. Measured at the boot pull (from a
 * plugin `start()` after the automation plugin's) and after `kernel:ready`'s
 * re-bind from the protocol's view, the two steps that arm a body.
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
    const packageOf = (flowName: string) => `qa-31790-trigger:${flowName}`;
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
    let captured: PluginContext | undefined;
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
            captured = ctx;
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
    return { kernel, fired, automation: kernel.getService<AutomationEngine>('automation'), ctx: captured! };
}

/** The first boot stores `rows`, in this order; the second, cold, is measured. */
async function measuredBoot(rows: readonly Row[], start: (ql: ObjectQL, automation: AutomationEngine) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'qa-31790-'));
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


/** What the reader answers at the boot pull, and after `kernel:ready`. */
async function readings(rows: readonly Row[]) {
    let atPull: { armed: string | undefined; label: string | undefined } | undefined;
    const { automation } = await measuredBoot(rows, async (_ql, engine) => {
        atPull = {
            armed: engine.armedFlowPackage(FLOW),
            label: ((await engine.getFlow(FLOW)) as { label?: string } | null)?.label,
        };
    });
    return {
        atPull,
        afterReady: {
            armed: automation.armedFlowPackage(FLOW),
            label: ((await automation.getFlow(FLOW)) as { label?: string } | null)?.label,
        },
        owner: automation.packagedFlowOwner(FLOW),
    };
}

describe('[ADR-0150 D3] armedFlowPackage names the package of the body the engine runs', () => {
    it('the loader\'s own body, nothing stored: the shipping package, at the boot pull and after kernel:ready', async () => {
        const r = await readings([]);
        expect(r.owner).toBe(BASE);
        expect(r.atPull).toEqual({ armed: BASE, label: 'BASE' });
        expect(r.afterReady).toEqual({ armed: BASE, label: 'BASE' });
    });

    it('the declared .custom override armed over it: no package, while packagedFlowOwner still names the shipping package', async () => {
        const r = await readings(['override']);
        expect(r.owner, 'control: the loader\'s set holds the name').toBe(BASE);
        expect(r.atPull).toEqual({ armed: undefined, label: 'OVERRIDE' });
        expect(r.afterReady).toEqual({ armed: undefined, label: 'OVERRIDE' });
    });

    it('the override beside a legacy package-less row: no package', async () => {
        const r = await readings(['legacy', 'override']);
        expect(r.atPull).toEqual({ armed: undefined, label: 'OVERRIDE' });
        expect(r.afterReady).toEqual({ armed: undefined, label: 'OVERRIDE' });
    });

    it('a legacy package-less row alone is shadowed (ADR-0126 §2), so the loader\'s body runs and it is the shipping package\'s', async () => {
        const r = await readings(['legacy']);
        expect(r.atPull).toEqual({ armed: BASE, label: 'BASE' });
        expect(r.afterReady).toEqual({ armed: BASE, label: 'BASE' });
    });

    it('an override stored at runtime and re-armed by the metadata:reloaded re-sync: no package; deleted, the shipping package again', async () => {
        const { automation, ctx } = await measuredBoot([], async () => {});
        expect(automation.armedFlowPackage(FLOW)).toBe(BASE);
        const ql = ctx.getService<ObjectQL>('objectql');
        await ql.insert('sys_metadata', storedRow('override'), { context: SYS } as never);
        await ctx.trigger('metadata:reloaded');
        expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('OVERRIDE');
        expect(automation.armedFlowPackage(FLOW)).toBeUndefined();
        await ql.delete('sys_metadata', { where: { id: 'meta_override' }, context: SYS } as never);
        await ctx.trigger('metadata:reloaded');
        expect(((await automation.getFlow(FLOW)) as { label?: string } | null)?.label).toBe('BASE');
        expect(automation.armedFlowPackage(FLOW)).toBe(BASE);
    });

    it('a body registered with no precedence verdict (an authoring door, a direct caller) is no package\'s, even under a shipped name', async () => {
        const { automation } = await measuredBoot([], async () => {});
        expect(automation.armedFlowPackage(FLOW)).toBe(BASE);
        automation.registerFlow(FLOW, ticketFlow('DIRECT'));
        expect(automation.packagedFlowOwner(FLOW)).toBe(BASE);
        expect(automation.armedFlowPackage(FLOW)).toBeUndefined();
        expect(automation.armedFlowPackage('no_such_flow')).toBeUndefined();
    });
});
