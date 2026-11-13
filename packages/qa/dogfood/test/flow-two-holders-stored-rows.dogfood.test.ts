// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32521, epic #31527 red line 2, ADR-0150 D3/D4] A flow name two packages'
// STORED rows hold, read through the real readers a boot puts between the
// store and the automation engine:
//
//   `DatabaseLoader` (one row per `(package, name)` since #32521)
//     → `MetadataManager.loadMany('flow')`
//     → ObjectQL's start-up sync (`ObjectQLPlugin.loadMetadataFromService`)
//       into a real `SchemaRegistry`
//     → ① ObjectQL's package-scoped resolver, asked for the bare name by a
//         caller with no package (what the engine's `flowNameResolver` asks)
//     → the automation plugin's boot pull (`AutomationServicePlugin.start`:
//         `listItems('flow')`, precedence, `registerFlow`), in two compositions:
//         ② no `protocol` service (the `objectql` service a bare `{ registry }`);
//         ③ the `protocol` service `ObjectQLPlugin` registers by default (a
//           `LiteKernel` with the real `ObjectQLPlugin`, a `metadata` service
//           that is the manager, and the real automation plugin).
//
// Before #32521 the loader answered one row per name (the row saved last, BETA
// here), so the registry held BETA's flow alone, the resolver resolved it and
// both compositions armed it. Now:
//   ① refused `ambiguous-in-environment`, naming both packages;
//   ② neither armed: one collision warning that says so ("arming neither")
//      and `registerFlow`'s refusal ("failed to register flow") naming both;
//   ③ both armed, each in its own package's slot (ADR-0150 D4), no automation
//      warning; every bare-name reader of the engine refuses, naming both.
// With a package-less row of the name beside the two (S2), the resolver
// refuses too, and the environment's own flow, which was armed, is armed in
// neither composition (② arms none of the three; ③ arms the two packages').
//
// CONTROL: one package's row, and one package's row beside a package-less row
// (that holder's customization, ADR-0150 D4, never a second holder), answer
// what they answered before in every composition: the resolver resolves and
// the boot pull arms one.

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { MetadataManager, DatabaseLoader } from '@objectstack/metadata';
import { ObjectQLPlugin, SchemaRegistry, resolvePackageScopedName } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';

const ALPHA = 'com.qa.flow32521.alpha';
const BETA = 'com.qa.flow32521.beta';
const NAME = 'qa_helper_32521';

/** A `sys_metadata` driver over one in-memory table: just what `DatabaseLoader` reads and writes. */
function memoryDriver() {
    const rows = new Map<string, Record<string, unknown>>();
    // Equality only; it refuses what it does not implement.
    const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`memoryDriver: unsupported WHERE combinator '${k}'`);
            if (v !== null && typeof v === 'object') throw new Error(`memoryDriver: unsupported WHERE operator on '${k}'`);
            return row[k] === v;
        });
    return {
        name: 'qa-memory', version: '1', supports: {},
        connect: vi.fn(), disconnect: vi.fn(), checkHealth: vi.fn(async () => true), execute: vi.fn(),
        find: vi.fn(async (_t: string, q: any) => [...rows.values()].filter((r) => match(r, q?.where)).map((r) => ({ ...r }))),
        findOne: vi.fn(async (_t: string, q: any) => [...rows.values()].find((r) => match(r, q?.where)) ?? null),
        create: vi.fn(async (_t: string, d: any) => { rows.set(d.id, { ...d }); return d; }),
        update: vi.fn(async (_t: string, id: string, d: any) => { rows.set(id, { ...rows.get(id), ...d }); return rows.get(id); }),
        delete: vi.fn(async (_t: string, id: string) => rows.delete(id)),
        count: vi.fn(async () => rows.size),
        syncSchema: vi.fn(), upsert: vi.fn(), bulkCreate: vi.fn(), bulkUpdate: vi.fn(), bulkDelete: vi.fn(),
    } as any;
}

/** A stored, active flow row of NAME; `label` names whose body it is. */
const flowRow = (pkg: string | null, version: number, label: string) => ({
    id: `flow_${pkg ?? 'env'}_${version}`, type: 'flow', name: NAME, state: 'active', version, checksum: `c${version}`,
    source: 'database', package_id: pkg,
    metadata: JSON.stringify({
        name: NAME, label, type: 'autolaunched', status: 'active',
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    }),
});

type Shape =
    | 'two holders'
    | 'two holders + package-less row saved last'
    | 'two holders + package-less row saved first'
    | 'one holder'
    | 'one holder + package-less row';

const rowsOf: Record<Shape, ReturnType<typeof flowRow>[]> = {
    // BETA's row saved last: the one row per name the loader answered before.
    'two holders': [flowRow(ALPHA, 1, 'alpha'), flowRow(BETA, 2, 'beta')],
    // FROM: the package-less row alone (saved last), or BETA's (saved first).
    'two holders + package-less row saved last': [flowRow(ALPHA, 1, 'alpha'), flowRow(BETA, 2, 'beta'), flowRow(null, 3, 'env')],
    'two holders + package-less row saved first': [flowRow(null, 1, 'env'), flowRow(ALPHA, 2, 'alpha'), flowRow(BETA, 3, 'beta')],
    'one holder': [flowRow(ALPHA, 1, 'alpha')],
    'one holder + package-less row': [flowRow(ALPHA, 1, 'alpha'), flowRow(null, 2, 'env')],
};

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** The stored rows → loader → manager → ObjectQL's start-up sync, into a real registry. */
async function managerOver(shape: Shape, reversed: boolean): Promise<MetadataManager> {
    const driver = memoryDriver();
    const rows = reversed ? [...rowsOf[shape]].reverse() : rowsOf[shape];
    for (const row of rows) await driver.create('sys_metadata', row);
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver }));
    return manager;
}

async function syncedRegistry(shape: Shape, reversed: boolean): Promise<SchemaRegistry> {
    const manager = await managerOver(shape, reversed);
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const plugin = new ObjectQLPlugin({ ql: { registry, bindHooks: vi.fn() } as any });
    await (plugin as unknown as { loadMetadataFromService(m: unknown, ctx: unknown): Promise<void> })
        .loadMetadataFromService(manager, { logger: silentLogger() });
    return registry;
}

/** The automation plugin's real boot pull over `registry`: what it armed for NAME, and what it warned. */
async function bootPull(registry: SchemaRegistry): Promise<{ armedLabel: string | undefined; warnings: string[] }> {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    const warnings: string[] = [];
    const logger = (kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
    const warn = logger.warn.bind(logger);
    logger.warn = (message: unknown, ...rest: unknown[]) => {
        warnings.push(`${String(message)} ${JSON.stringify(rest)}`);
        warn(message, ...rest);
    };
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'qa.flow32521.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', { registry });
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    try {
        const engine = kernel.getService('automation') as AutomationEngine;
        const armed = (await engine.getFlow(NAME)) as { label?: string } | null;
        return { armedLabel: armed?.label, warnings: warnings.filter((w) => w.includes(NAME)) };
    } finally {
        await kernel.shutdown();
    }
}

/** A kernel's `warn` lines, each with its meta, captured as text. */
function captureWarnings(kernel: LiteKernel): string[] {
    const warnings: string[] = [];
    const logger = (kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
    const warn = logger.warn.bind(logger);
    logger.warn = (message: unknown, ...rest: unknown[]) => {
        warnings.push(`${String(message)} ${JSON.stringify(rest)}`);
        warn(message, ...rest);
    };
    return warnings;
}

/** What a rejected or thrown call answered, as text (`undefined` when it did not refuse). */
async function refusalOf(call: () => unknown): Promise<string | undefined> {
    try {
        const answer = await call();
        const failed = answer as { success?: boolean; error?: unknown } | undefined;
        return failed && failed.success === false ? String(failed.error) : undefined;
    } catch (e) {
        return `${(e as { code?: string }).code ?? ''} ${String((e as Error).message)}`;
    }
}

/**
 * ③ The real host: `LiteKernel`, a `metadata` service that is the manager over
 * the stored rows, the real `ObjectQLPlugin` in its default mode (its own
 * `start()` runs the sync, and it registers the `protocol` service), and the
 * real automation plugin. What the engine armed for NAME, and its bare readers.
 */
async function realHost(shape: Shape, reversed: boolean) {
    const manager = await managerOver(shape, reversed);
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    const warnings = captureWarnings(kernel);
    kernel.use({
        name: 'qa.flow32521.metadata',
        type: 'standard' as const,
        version: '1.0.0',
        async init(ctx: any) { ctx.registerService('metadata', manager); },
        async start() {},
    } as never);
    kernel.use(new ObjectQLPlugin());
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' } as never));
    await kernel.bootstrap();
    try {
        let hasProtocol = false;
        try { hasProtocol = !!kernel.getService('protocol'); } catch { hasProtocol = false; }
        const registry = (kernel.getService('objectql') as { registry: SchemaRegistry }).registry;
        const engine = kernel.getService('automation') as AutomationEngine & {
            getFlowSlot(packageId: string | null, name: string): { label?: string } | undefined;
        };
        const slot = (packageId: string | null) => engine.getFlowSlot(packageId, NAME)?.label ?? null;
        // The boot's own warnings, before the bare readers below run (a toggle that succeeds warns too).
        const automationWarnings = warnings.filter((w) => w.startsWith('[Automation]') && w.includes(NAME));
        return {
            hasProtocol,
            resolver: resolvePackageScopedName(registry as never, { type: 'flow', name: NAME, callerPackageId: null }) as {
                status: string; reason?: string; message?: string;
            },
            slots: { alpha: slot(ALPHA), beta: slot(BETA), none: slot(null) },
            listed: (await engine.listFlows()).filter((name) => name === NAME).length,
            // The engine's bare-name readers: each refuses a name two slots hold.
            bare: {
                getFlow: await refusalOf(() => engine.getFlow(NAME)),
                execute: await refusalOf(() => engine.execute(NAME, {})),
                toggleFlow: await refusalOf(() => engine.toggleFlow(NAME, false)),
            },
            automationWarnings,
        };
    } finally {
        await kernel.shutdown();
    }
}

describe('[#32521] a flow name two packages\' stored rows hold, through ObjectQL\'s sync', () => {
    for (const reversed of [false, true]) {
        const order = reversed ? 'rows read in reverse' : 'rows read as saved';

        it(`① the bare name is refused by ObjectQL's resolver, naming both packages (${order})`, async () => {
            const registry = await syncedRegistry('two holders', reversed);
            // Both packages' flows reached the registry, each under its own package.
            expect((registry.listItems('flow') as Array<{ _packageId?: string }>).map((i) => i._packageId).sort())
                .toEqual([ALPHA, BETA]);
            const answer = resolvePackageScopedName(registry as never, { type: 'flow', name: NAME, callerPackageId: null }) as {
                status: string; message?: string;
            };
            // FROM: resolved to BETA's flow (the one row the loader answered).
            expect(answer.status).toBe('refused');
            expect((answer as { reason?: string }).reason).toBe('ambiguous-in-environment');
            expect(answer.message).toContain(ALPHA);
            expect(answer.message).toContain(BETA);
        });

        it(`② no protocol service: the boot pull arms neither and says so (${order})`, async () => {
            const { armedLabel, warnings } = await bootPull(await syncedRegistry('two holders', reversed));
            // FROM: BETA's flow armed, no warning.
            expect(armedLabel).toBeUndefined();
            expect(warnings.some((w) => w.includes('arming neither'))).toBe(true);
            const failed = warnings.filter((w) => w.startsWith('[Automation] failed to register flow'));
            expect(failed).toHaveLength(1);
            expect(failed[0]).toContain(ALPHA);
            expect(failed[0]).toContain(BETA);
        });

        it(`③ the protocol service ObjectQLPlugin registers by default: both flows armed, each in its own slot, and every bare reader refuses naming both (${order})`, async () => {
            const host = await realHost('two holders', reversed);
            expect(host.hasProtocol).toBe(true);
            expect(host.resolver.status).toBe('refused');
            // FROM: BETA's flow alone, armed under the bare name; a bare call ran it.
            expect(host.slots).toEqual({ alpha: 'alpha', beta: 'beta', none: null });
            expect(host.listed).toBe(2);
            for (const refusal of Object.values(host.bare)) {
                expect(refusal).toContain(ALPHA);
                expect(refusal).toContain(BETA);
            }
            expect(host.automationWarnings).toEqual([]);
        });
    }

    for (const shape of ['two holders + package-less row saved last', 'two holders + package-less row saved first'] as const) {
        it(`S2 ${shape}: the resolver refuses naming both packages, and the environment's own flow is armed in neither composition`, async () => {
            const registry = await syncedRegistry(shape, false);
            // The registry holds all three (row 11e).
            expect((registry.listItems('flow') as Array<{ label?: string }>).map((i) => i.label).sort()).toEqual(['alpha', 'beta', 'env']);
            const answer = resolvePackageScopedName(registry as never, { type: 'flow', name: NAME, callerPackageId: null }) as {
                status: string; reason?: string; message?: string;
            };
            // FROM: resolved to the row saved last (the package-less flow, or BETA's).
            expect([answer.status, answer.reason]).toEqual(['refused', 'ambiguous-in-environment']);
            expect(answer.message).toContain(ALPHA);
            expect(answer.message).toContain(BETA);
            // ② FROM: that flow armed.
            const pulled = await bootPull(registry);
            expect(pulled.armedLabel).toBeUndefined();
            expect(pulled.warnings.filter((w) => w.includes('arming none of them'))).toHaveLength(1);
            // ③ FROM: that flow armed under the bare name.
            const host = await realHost(shape, false);
            expect(host.slots).toEqual({ alpha: 'alpha', beta: 'beta', none: null });
            expect(host.bare.getFlow).toContain(ALPHA);
            expect(host.bare.getFlow).toContain(BETA);
            // One warning: the package-less row customizes neither package's flow.
            expect(host.automationWarnings).toHaveLength(1);
            expect(host.automationWarnings[0]).toContain('names no package');
        });
    }

    for (const shape of ['one holder', 'one holder + package-less row'] as const) {
        it(`CONTROL ${shape}: the resolver resolves and the boot pull arms one, as before`, async () => {
            const registry = await syncedRegistry(shape, false);
            const answer = resolvePackageScopedName(registry as never, { type: 'flow', name: NAME, callerPackageId: null }) as {
                status: string;
            };
            expect(answer.status).not.toBe('refused');
            const { armedLabel, warnings } = await bootPull(registry);
            expect(armedLabel).toBe(shape === 'one holder' ? 'alpha' : 'env');
            expect(warnings.some((w) => w.includes('arming neither'))).toBe(false);
            const host = await realHost(shape, false);
            expect(host.resolver.status).not.toBe('refused');
            expect(host.bare.getFlow).toBeUndefined();
            expect(host.bare.execute).toBeUndefined();
            expect(host.automationWarnings).toEqual([]);
            expect(shape === 'one holder' ? host.slots.alpha : host.slots.none).toBe(shape === 'one holder' ? 'alpha' : 'env');
        });
    }
});
