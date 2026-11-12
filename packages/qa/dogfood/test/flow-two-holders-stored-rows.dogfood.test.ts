// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32521, epic #31527 red line 2, ADR-0150 D3] A flow name two packages'
// STORED rows hold, read through the real readers a boot puts between the
// store and the automation engine:
//
//   `DatabaseLoader` (one row per `(package, name)` since #32521)
//     → `MetadataManager.loadMany('flow')`
//     → ObjectQL's start-up sync (`ObjectQLPlugin.loadMetadataFromService`)
//       into a real `SchemaRegistry`
//     → ① ObjectQL's package-scoped resolver, asked for the bare name by a
//         caller with no package (what the engine's `flowNameResolver` asks)
//     → ② the automation plugin's boot pull (`AutomationServicePlugin.start`:
//         `listItems('flow')`, precedence, `registerFlow`), on a real kernel.
//
// Before #32521 the loader answered one row per name (the row saved last, BETA
// here), so the registry held BETA's flow alone:
//   ① FROM resolved to BETA's flow   →  TO refused, naming both packages;
//   ② FROM BETA's flow armed         →  TO neither armed, one collision warning
//      that says so ("arming neither"), and `registerFlow` refuses the body.
// Both are the narrowing red line 2 asks for: a bare name two packages hold
// is reported, never answered with one holder's body.
//
// CONTROL: one package's row, and one package's row beside a package-less row
// (that holder's customization, ADR-0150 D4, never a second holder), answer
// what they answered before: the resolver resolves and the boot pull arms one.

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
    const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => row[k] === v);
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

type Shape = 'two holders' | 'one holder' | 'one holder + package-less row';

const rowsOf: Record<Shape, ReturnType<typeof flowRow>[]> = {
    // BETA's row saved last: the one row per name the loader answered before.
    'two holders': [flowRow(ALPHA, 1, 'alpha'), flowRow(BETA, 2, 'beta')],
    'one holder': [flowRow(ALPHA, 1, 'alpha')],
    'one holder + package-less row': [flowRow(ALPHA, 1, 'alpha'), flowRow(null, 2, 'env')],
};

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** The stored rows → loader → manager → ObjectQL's start-up sync, into a real registry. */
async function syncedRegistry(shape: Shape, reversed: boolean): Promise<SchemaRegistry> {
    const driver = memoryDriver();
    const rows = reversed ? [...rowsOf[shape]].reverse() : rowsOf[shape];
    for (const row of rows) await driver.create('sys_metadata', row);
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver }));
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
            expect(answer.message).toContain(ALPHA);
            expect(answer.message).toContain(BETA);
        });

        it(`② the boot pull arms neither and says so (${order})`, async () => {
            const { armedLabel, warnings } = await bootPull(await syncedRegistry('two holders', reversed));
            // FROM: BETA's flow armed, no warning.
            expect(armedLabel).toBeUndefined();
            expect(warnings.some((w) => w.includes('arming neither'))).toBe(true);
            expect(warnings.some((w) => w.includes('failed to register flow'))).toBe(true);
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
        });
    }
});
