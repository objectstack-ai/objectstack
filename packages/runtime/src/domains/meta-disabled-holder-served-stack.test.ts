// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32183, contract review M1] A name an enabled and a disabled package both
// ship: the dispatcher's bare doors (the plain read, `/layers`, `/published`)
// serve the enabled holder's stack, whichever registered first, and a stored
// row bound to the disabled holder reaches none of them. Driven on a booted
// kernel (the real protocol, metadata service, registry and `sys_metadata`
// store), through `HttpDispatcher.dispatch`.
//
// Contract review M1 (branch head 340f7cbc, measured on a booted kernel): with
// the disabled holder registered first, bare `/layers` served its code layer
// while the plain read served the enabled holder.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_served_stack', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
const ENABLED = 'com.qa.alpha';
const DISABLED = 'com.qa.beta';

interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

const tag = (id: string) => (id === DISABLED ? 'disabled' : 'enabled');
const packageOf = (id: string) => ({
    id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app',
    objects: [],
    dashboards: ['row_one_dash', 'row_both_dash'].map((name) => ({ name, label: `${tag(id)} code`, widgets: [] })),
    agents: [{ name: 'helper', label: `${tag(id)} code`, role: 'assistant', instructions: `${tag(id)} instructions` }],
});

interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }

async function bootKernel(order: readonly string[]): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-served-stack-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.served-stack-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const id of order) await ctx.getService<ManifestDoor>('manifest').register(packageOf(id));
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    // A stored row bound to the disabled holder alone, and one bound to each
    // holder: rows bound to the base itself, as an earlier release stored them
    // (this release's save door writes a shipped item into its `.custom` pair),
    // laid straight into the store.
    const layRow = (name: string, packageId: string, label: string) => engine.insert('sys_metadata', {
        type: 'dashboard', name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
        metadata: JSON.stringify({ name, label, widgets: [] }),
    }, { context: { isSystem: true } } as any);
    await layRow('row_one_dash', DISABLED, 'disabled row');
    for (const id of order) await layRow('row_both_dash', id, `${tag(id)} row`);
    return { kernel, engine, root };
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

async function get(kernel: ObjectKernel, path: string, query: Record<string, string> = {}) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    const raw = new Request(`http://localhost/api/v1${path}`, { method: 'GET' });
    try {
        const out: any = await dispatcher.dispatch('GET', path, {}, query, { request: raw } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, body: out.response?.body };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, body: { error: { code: thrown.code, message: String((e as Error)?.message ?? '') } } };
    }
}

// [type, name, plain read's label, code layer, overlay layer, /published label (undefined: 404)]
const SPECIMENS = [
    ['agent', 'helper', 'enabled code', 'enabled code', undefined, undefined],
    ['dashboard', 'row_one_dash', 'enabled code', 'enabled code', undefined, undefined],
    ['dashboard', 'row_both_dash', 'enabled row', 'enabled code', 'enabled row', 'enabled row'],
] as const;

describe.each([
    { order: 'disabled first', packages: [DISABLED, ENABLED] },
    { order: 'enabled first', packages: [ENABLED, DISABLED] },
])('[#32183 M1] the dispatcher\'s bare doors, two holders registered $order, one disabled', ({ packages }) => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootKernel(packages);
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('CONTROL: enabled, the disabled holder\'s own address serves its code layer and its stored row', async () => {
        const layers = await get(booted!.kernel, '/meta/dashboard/row_one_dash/layers', { package: DISABLED });
        const layered = layers.body?.data ?? layers.body;
        expect([layers.status, layered?.code?.label, layered?.effective?.label], JSON.stringify(layers.body))
            .toEqual([200, 'disabled code', 'disabled row']);
    });

    it('disabled: the plain read, /layers and /published serve the enabled holder\'s stack, never the disabled one\'s', async () => {
        booted!.engine.registry.disablePackage(DISABLED);
        try {
            for (const [type, name, plain, code, overlay, published] of SPECIMENS) {
                const read = await get(booted!.kernel, `/meta/${type}/${name}`);
                expect([read.status, (read.body?.data ?? read.body)?.item?.label, name], JSON.stringify(read.body)).toEqual([200, plain, name]);
                const layers = await get(booted!.kernel, `/meta/${type}/${name}/layers`);
                const layered = layers.body?.data ?? layers.body;
                expect([layers.status, layered?.code?.label, layered?.overlay?.label, layered?.effective?.label, name], JSON.stringify(layers.body))
                    .toEqual([200, code, overlay, overlay ?? code, name]);
                const served = await get(booted!.kernel, `/meta/${type}/${name}/published`);
                if (published === undefined) expect([served.status, codeOf(served.body), name]).toEqual([404, 'RESOURCE_NOT_FOUND', name]);
                else expect([served.status, (served.body?.data ?? served.body)?.label, name], JSON.stringify(served.body)).toEqual([200, published, name]);
                for (const answer of [read, layers, served]) expect(JSON.stringify(answer.body ?? null)).not.toMatch(/disabled (code|row|instructions)/);
            }
        } finally {
            booted!.engine.registry.enablePackage(DISABLED);
        }
    });
});

// ---------------------------------------------------------------------------
// [#32354, ADR-0150 D3] The row layer judges a name's holders over the served
// set too. A holder is a registry holder or a package a stored row of the name
// is bound to; when one of them is disabled, the bare doors read at the one
// served holder's address, answer the missing name when none is served, and
// refuse naming only the served holders when two or more are. An exact address
// naming a disabled package is that package's withheld item whether it holds
// the name in the registry or only as a stored row.
//
// Measured on the #32183 head (6655b742, step 0 of #32354): stored rows only,
// rows bound to an enabled and a disabled package, the answer followed save
// order (the disabled row saved first: 404 on the plain read, /layers and
// /published; the enabled row first: its row served, /layers 409 naming the
// disabled package). `?package=DISABLED` of a name an enabled package ships in
// code and the disabled one holds only as a row served the row's body under the
// enabled package's envelope.
// ---------------------------------------------------------------------------

const ROW_E = 'com.qa.row_alpha';
const ROW_F = 'com.qa.row_gamma';
const ROW_D = 'com.qa.row_beta';
const rowTag = (id: string) => (id === ROW_D ? 'disabled' : id === ROW_F ? 'third' : 'enabled');
const rowPackageOf = (id: string) => ({
    id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app', objects: [],
    dashboards: [
        // Case 3: one package ships the name in code, the other holds it only as a stored row.
        ...(id === ROW_E ? [{ name: 'e_ships_dash', label: 'enabled code', widgets: [] }] : []),
        ...(id === ROW_D ? [{ name: 'd_ships_dash', label: 'disabled code', widgets: [] }] : []),
        // Case 2 CONTROL: both ship it.
        ...(id !== ROW_F ? [{ name: 'both_ship_dash', label: `${rowTag(id)} code`, widgets: [] }] : []),
    ],
});

async function bootRowKernel(order: readonly string[], file: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-row-holder-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.row-holder-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const id of order) await ctx.getService<ManifestDoor>('manifest').register(rowPackageOf(id));
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine, root };
}

const layStoredRow = (engine: ObjectQL, name: string, packageId: string | null, label: string) => engine.insert('sys_metadata', {
    type: 'dashboard', name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
    metadata: JSON.stringify({ name, label, widgets: [] }),
}, { context: { isSystem: true } } as any);

const unwrap = (body: any) => body?.data ?? body;
const noDisabledTrace = (answers: ReadonlyArray<{ body: unknown }>) => {
    for (const answer of answers) {
        const text = JSON.stringify(answer.body ?? null);
        expect(text).not.toMatch(/disabled (code|row)/);
        expect(text).not.toContain(ROW_D);
    }
};

async function expectServedRow(kernel: ObjectKernel, name: string, label: string, packageId: string) {
    const read = await get(kernel, `/meta/dashboard/${name}`);
    expect([read.status, unwrap(read.body)?.item?.label, unwrap(read.body)?.packageId], JSON.stringify(read.body)).toEqual([200, label, packageId]);
    const layers = await get(kernel, `/meta/dashboard/${name}/layers`);
    expect([layers.status, unwrap(layers.body)?.overlay?.label, unwrap(layers.body)?.effective?.label], JSON.stringify(layers.body))
        .toEqual([200, label, label]);
    const published = await get(kernel, `/meta/dashboard/${name}/published`);
    expect([published.status, unwrap(published.body)?.label], JSON.stringify(published.body)).toEqual([200, label]);
    const exact = await get(kernel, `/meta/dashboard/${name}`, { package: ROW_D });
    expect([exact.status, codeOf(exact.body)], JSON.stringify(exact.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
    noDisabledTrace([read, layers, published, exact]);
}

describe.each([
    { regOrder: 'disabled first', registered: [ROW_D, ROW_E, ROW_F] },
    { regOrder: 'enabled first', registered: [ROW_E, ROW_F, ROW_D] },
])('[#32354] stored rows judged over the served set, packages registered $regOrder', ({ registered }) => {
    const roots: string[] = [];
    afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-row-holder-db-'));
        roots.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (booted: Booted) => {
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        roots.push(booted.root);
    };

    it.each([
        { saveOrder: 'disabled row saved first', saved: [ROW_D, ROW_E] },
        { saveOrder: 'enabled row saved first', saved: [ROW_E, ROW_D] },
    ])('case 1, $saveOrder: no package ships the name; the plain read, /layers and /published serve the enabled row, before and after a reboot', async ({ saved }) => {
        const file = freshFile();
        let booted = await bootRowKernel(registered, file);
        try {
            for (const id of saved) await layStoredRow(booted.engine, 'rows_only_dash', id, `${rowTag(id)} row`);
            // CONTROL: enabled, the disabled package's own address serves its row.
            const own = await get(booted.kernel, '/meta/dashboard/rows_only_dash', { package: ROW_D });
            expect([own.status, unwrap(own.body)?.item?.label]).toEqual([200, 'disabled row']);
            booted.engine.registry.disablePackage(ROW_D);
            await expectServedRow(booted.kernel, 'rows_only_dash', 'enabled row', ROW_E);
            // Re-enabled: the two rows are two holders again, and /layers refuses naming both.
            booted.engine.registry.enablePackage(ROW_D);
            const layers = await get(booted.kernel, '/meta/dashboard/rows_only_dash/layers');
            expect([layers.status, codeOf(layers.body)]).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(JSON.stringify(layers.body)).toContain(ROW_D);
        } finally {
            await down(booted);
        }
        // After a reboot the registry holds one of the two rows (one bare slot per name).
        booted = await bootRowKernel(registered, file);
        try {
            booted.engine.registry.disablePackage(ROW_D);
            await expectServedRow(booted.kernel, 'rows_only_dash', 'enabled row', ROW_E);
        } finally {
            await down(booted);
        }
    }, 120_000);

    it('case 1, the disabled package ships the name in code and the enabled one holds it only as a stored row: the enabled row is served', async () => {
        const booted = await bootRowKernel(registered, freshFile());
        try {
            await layStoredRow(booted.engine, 'd_ships_dash', ROW_E, 'enabled row');
            booted.engine.registry.disablePackage(ROW_D);
            await expectServedRow(booted.kernel, 'd_ships_dash', 'enabled row', ROW_E);
            const exact = await get(booted.kernel, '/meta/dashboard/d_ships_dash', { package: ROW_E });
            expect([exact.status, unwrap(exact.body)?.item?.label], JSON.stringify(exact.body)).toEqual([200, 'enabled row']);
        } finally {
            await down(booted);
        }
    }, 120_000);

    it('ruling Q2: two served row holders beside a disabled one are refused naming only the served holders, the plain read with details.candidates', async () => {
        const booted = await bootRowKernel(registered, freshFile());
        try {
            for (const id of [ROW_D, ROW_E, ROW_F]) await layStoredRow(booted.engine, 'three_rows_dash', id, `${rowTag(id)} row`);
            booted.engine.registry.disablePackage(ROW_D);
            const read = await get(booted.kernel, '/meta/dashboard/three_rows_dash');
            expect([read.status, codeOf(read.body)], JSON.stringify(read.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect([...(read.body?.error?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(read.body))
                .toEqual([ROW_E, ROW_F].sort());
            // [#32622, ADR-0150 D5] The layered door names the same served holders as `details.candidates`.
            const layers = await get(booted.kernel, '/meta/dashboard/three_rows_dash/layers');
            expect([layers.status, codeOf(layers.body)], JSON.stringify(layers.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect([...(layers.body?.error?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(layers.body))
                .toEqual([ROW_E, ROW_F].sort());
            // [contract review S3] Bare /published asks the plain read first and answers its refusal.
            const published = await get(booted.kernel, '/meta/dashboard/three_rows_dash/published');
            expect([published.status, codeOf(published.body)], JSON.stringify(published.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            for (const id of [ROW_E, ROW_F]) expect(JSON.stringify(published.body)).toContain(id);
            noDisabledTrace([read, layers, published]);
        } finally {
            await down(booted);
        }
    }, 120_000);

    it('case 3: ?package=DISABLED, where the enabled package ships the name in code and the disabled one holds it only as a stored row, is the withheld 404', async () => {
        const booted = await bootRowKernel(registered, freshFile());
        try {
            await layStoredRow(booted.engine, 'e_ships_dash', ROW_D, 'disabled row');
            // CONTROL: enabled, that address serves the row.
            const own = await get(booted.kernel, '/meta/dashboard/e_ships_dash', { package: ROW_D });
            expect([own.status, unwrap(own.body)?.item?.label]).toEqual([200, 'disabled row']);
            booted.engine.registry.disablePackage(ROW_D);
            const exact = await get(booted.kernel, '/meta/dashboard/e_ships_dash', { package: ROW_D });
            expect([exact.status, codeOf(exact.body)], JSON.stringify(exact.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
            const bare = await get(booted.kernel, '/meta/dashboard/e_ships_dash');
            expect([bare.status, unwrap(bare.body)?.item?.label]).toEqual([200, 'enabled code']);
            noDisabledTrace([exact, bare]);
        } finally {
            await down(booted);
        }
    }, 120_000);

    it('case 2 CONTROL: the environment\'s package-less row of a name an enabled and a disabled package both ship never makes /layers take the disabled holder\'s code layer', async () => {
        const booted = await bootRowKernel(registered, freshFile());
        try {
            await layStoredRow(booted.engine, 'both_ship_dash', null, 'environment row');
            booted.engine.registry.disablePackage(ROW_D);
            // overlaySlotBinding answers the environment's item only when no package ships the name.
            expect((booted.engine.registry as any).getEnvironmentScopedItem('dashboard', 'both_ship_dash')).toBeUndefined();
            const layers = await get(booted.kernel, '/meta/dashboard/both_ship_dash/layers');
            expect([layers.status, unwrap(layers.body)?.code?.label, unwrap(layers.body)?.effective?.label], JSON.stringify(layers.body))
                .toEqual([200, 'enabled code', 'environment row']);
            noDisabledTrace([layers]);
        } finally {
            await down(booted);
        }
    }, 120_000);
});

// ---------------------------------------------------------------------------
// [#32607, ADR-0150 D3] With NO package disabled, a name two enabled packages
// hold only as stored rows (no package ships it) is refused on every bare door
// naming both, by the row-aware served-holder judgment above, so the answer
// follows no save order; each exact address serves its own row, and one row
// holder is served as before.
//
// Measured on the #32183 head plus #32354's work (step 0 of #32607): the plain
// read and `/published` served one row (the plain read the row saved first,
// `/published` on this dispatcher the same package in every order), while
// `/layers` refused 409 naming both, before and after a reboot. `/layers` keeps
// that refusal, the package-less writes' own (#28337).
// ---------------------------------------------------------------------------

describe.each([
    { regOrder: 'E registered first', registered: [ROW_E, ROW_F] },
    { regOrder: 'F registered first', registered: [ROW_F, ROW_E] },
])('[#32607] two enabled row holders and no shipper, $regOrder', ({ registered }) => {
    const roots: string[] = [];
    afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-two-rows-db-'));
        roots.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (booted: Booted) => {
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        roots.push(booted.root);
    };
    const expectRefusedNamingBoth = async (booted: Booted, name: string) => {
        const read = await get(booted.kernel, `/meta/dashboard/${name}`);
        expect([read.status, codeOf(read.body)], JSON.stringify(read.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect([...(read.body?.error?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(read.body))
            .toEqual([ROW_E, ROW_F].sort());
        // `/published` answers the plain read's refusal; `/layers` keeps the package-less writes' own (#28337). Both name both holders and serve no row.
        for (const door of ['layers', 'published']) {
            const answer = await get(booted.kernel, `/meta/dashboard/${name}/${door}`);
            expect([answer.status, codeOf(answer.body), door], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', door]);
            for (const id of [ROW_E, ROW_F]) expect(JSON.stringify(answer.body)).toContain(id);
            expect(JSON.stringify(answer.body)).not.toMatch(/(enabled|third) row/);
            // [#32607, A1] The dispatcher's layered chain leaves the plain read's refusal to step 1c too: `/layers`
            // leads with the writes' sentence, `/published` does not.
            const message = String(answer.body?.error?.message ?? '');
            expect([door, message.startsWith('Name the package this layered read is for')], message).toEqual([door, door === 'layers']);
        }
        // The execution face takes the same refusal.
        const protocol: any = booted.kernel.getService('protocol');
        await expect(protocol.getMetaItemForExecution({ type: 'dashboard', name }))
            .rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', httpStatus: 409 });
        // Each exact address serves its own row.
        for (const id of [ROW_E, ROW_F]) {
            const exact = await get(booted.kernel, `/meta/dashboard/${name}`, { package: id });
            expect([exact.status, unwrap(exact.body)?.item?.label], JSON.stringify(exact.body)).toEqual([200, `${rowTag(id)} row`]);
        }
    };

    it.each([
        { saveOrder: 'E saved first', saved: [ROW_E, ROW_F] },
        { saveOrder: 'F saved first', saved: [ROW_F, ROW_E] },
    ])('$saveOrder: the plain read, /layers, /published and the execution face refuse naming both, before and after a reboot', async ({ saved }) => {
        const file = freshFile();
        let booted = await bootRowKernel(registered, file);
        try {
            for (const id of saved) await layStoredRow(booted.engine, 'two_rows_dash', id, `${rowTag(id)} row`);
            await expectRefusedNamingBoth(booted, 'two_rows_dash');
        } finally {
            await down(booted);
        }
        booted = await bootRowKernel(registered, file);
        try {
            await expectRefusedNamingBoth(booted, 'two_rows_dash');
        } finally {
            await down(booted);
        }
    }, 120_000);

    it('CONTROL: one row holder is served on every bare door as before, before and after a reboot', async () => {
        const file = freshFile();
        let booted = await bootRowKernel(registered, file);
        const expectServed = async (b: Booted) => {
            const read = await get(b.kernel, '/meta/dashboard/one_row_dash');
            expect([read.status, unwrap(read.body)?.item?.label, unwrap(read.body)?.packageId], JSON.stringify(read.body)).toEqual([200, 'enabled row', ROW_E]);
            const layers = await get(b.kernel, '/meta/dashboard/one_row_dash/layers');
            expect([layers.status, unwrap(layers.body)?.effective?.label], JSON.stringify(layers.body)).toEqual([200, 'enabled row']);
            const published = await get(b.kernel, '/meta/dashboard/one_row_dash/published');
            expect([published.status, unwrap(published.body)?.label], JSON.stringify(published.body)).toEqual([200, 'enabled row']);
            const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'dashboard', name: 'one_row_dash' });
            expect(executed?.item?.label).toBe('enabled row');
        };
        try {
            await layStoredRow(booted.engine, 'one_row_dash', ROW_E, 'enabled row');
            await expectServed(booted);
        } finally {
            await down(booted);
        }
        booted = await bootRowKernel(registered, file);
        try {
            await expectServed(booted);
        } finally {
            await down(booted);
        }
    }, 120_000);

    // [#33210, ADR-0150 D3 red line 2] A package-less row beside the two
    // packages' rows: three rows and no one holder. The bare doors refuse
    // naming both packages in every save order, before and after a reboot,
    // and never serve the package-less row in their place. FROM (`main`
    // 5a755791a9): the plain read, `/published` and the execution face served
    // a row by store order, while `/layers` refused naming both.
    it.each([
        { saveOrder: 'package-less, E, F', saved: [null, ROW_E, ROW_F] },
        { saveOrder: 'F, package-less, E', saved: [ROW_F, null, ROW_E] },
        { saveOrder: 'E, F, package-less', saved: [ROW_E, ROW_F, null] },
    ])('[#33210] saved $saveOrder: a package-less row beside them leaves every bare door refusing naming both, before and after a reboot', async ({ saved }) => {
        const file = freshFile();
        const expectRefused = async (b: Booted) => {
            await expectRefusedNamingBoth(b, 'three_rows_dash');
            for (const door of ['', '/layers', '/published']) {
                const answer = await get(b.kernel, `/meta/dashboard/three_rows_dash${door}`);
                expect(JSON.stringify(answer.body ?? null), door).not.toContain('package-less row');
            }
        };
        let booted = await bootRowKernel(registered, file);
        try {
            for (const id of saved) await layStoredRow(booted.engine, 'three_rows_dash', id, id === null ? 'package-less row' : `${rowTag(id)} row`);
            await expectRefused(booted);
        } finally {
            await down(booted);
        }
        booted = await bootRowKernel(registered, file);
        try {
            await expectRefused(booted);
        } finally {
            await down(booted);
        }
    }, 240_000);

    // [#33210] CONTROL: one package's row beside a package-less row has one
    // holder, and every bare door serves that package's row in both save
    // orders, before and after a reboot, as on `main`.
    it.each([
        { saveOrder: 'package-less row first', saved: [null, ROW_E] },
        { saveOrder: 'E\'s row first', saved: [ROW_E, null] },
    ])('[#33210] CONTROL, $saveOrder: one row holder beside a package-less row is served on every bare door as before, before and after a reboot', async ({ saved }) => {
        const file = freshFile();
        const expectServed = async (b: Booted) => {
            const read = await get(b.kernel, '/meta/dashboard/one_holder_dash');
            expect([read.status, unwrap(read.body)?.item?.label, unwrap(read.body)?.packageId], JSON.stringify(read.body)).toEqual([200, 'enabled row', ROW_E]);
            const layers = await get(b.kernel, '/meta/dashboard/one_holder_dash/layers');
            expect([layers.status, unwrap(layers.body)?.effective?.label], JSON.stringify(layers.body)).toEqual([200, 'enabled row']);
            const published = await get(b.kernel, '/meta/dashboard/one_holder_dash/published');
            expect([published.status, unwrap(published.body)?.label], JSON.stringify(published.body)).toEqual([200, 'enabled row']);
            const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'dashboard', name: 'one_holder_dash' });
            expect(executed?.item?.label).toBe('enabled row');
        };
        let booted = await bootRowKernel(registered, file);
        try {
            for (const id of saved) await layStoredRow(booted.engine, 'one_holder_dash', id, id === null ? 'package-less row' : 'enabled row');
            await expectServed(booted);
        } finally {
            await down(booted);
        }
        booted = await bootRowKernel(registered, file);
        try {
            await expectServed(booted);
        } finally {
            await down(booted);
        }
    }, 240_000);
});

// ---------------------------------------------------------------------------
// [#32607 contract review M1, M2, n1] The no-disabled arm judges a name's
// holders at the rows' grain alone, never united with the registry's one bare
// slot. M1: a package's row and its customization pair's undeclared row are
// one holder, whichever was saved (and so hydrated) last; the pair is never
// named. M2: a dependent's added member over a base that holds the name only
// as a stored row is no second holder (#28802); the base's row of another
// member is no second holder there either, so nothing is refused. [#33210 (c)]
// The read naming no package reads the base's address there, as for a base
// that ships the name (404). Both save orders, before and after a reboot. Measured on this
// branch before the fix (1ab9370442): M1 refused 409 naming the base and its
// pair in one save order; M2 refused 409 naming the base and the dependent.
// On `main` 89d7bef033 neither refuses, and both answer as below.
// ---------------------------------------------------------------------------

// A bundled type's non-canonical member carries its `bundle_member` key column, as the save door writes it.
const layRow = (engine: ObjectQL, type: string, name: string, packageId: string, metadata: Record<string, unknown>) => engine.insert('sys_metadata', {
    type, name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
    ...(type === 'email_template' && metadata.locale !== 'en-US' ? { bundle_member: metadata.locale } : {}),
    metadata: JSON.stringify({ name, ...metadata }),
}, { context: { isSystem: true } } as any);

async function bootManifests(manifests: readonly Record<string, unknown>[], file: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-row-grain-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.row-grain-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const manifest of manifests) await ctx.getService<ManifestDoor>('manifest').register(manifest);
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine, root };
}

describe('[#32607 M1, M2] the no-disabled arm judges holders at the rows\' grain', () => {
    const roots: string[] = [];
    afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-row-grain-db-'));
        roots.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (booted: Booted) => {
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        roots.push(booted.root);
    };
    const appManifest = (id: string, extra: Record<string, unknown> = {}) => ({
        id, name: id.split('.').pop(), namespace: id.split('.').pop()!.replace(/[^a-z]/g, ''), version: '1.0.0', type: 'app', objects: [], ...extra,
    });

    // M1: X (an id that derives a pair: no underscore) and X's pair, each storing an undeclared row; nobody ships the name.
    const X = 'com.qa.rowpairbase';
    const PAIR = `${X}.custom`;
    it('M1: a package\'s row and its pair\'s undeclared row are one holder in both save orders, before and after a reboot: no door refuses or names the pair', async () => {
        const answers: string[] = [];
        for (const saved of [[X, PAIR], [PAIR, X]]) {
            const file = freshFile();
            const manifests = [appManifest(X), appManifest(PAIR, { dependencies: { [X]: '*' } })];
            let booted = await bootManifests(manifests, file);
            const observe = async (b: Booted, leg: string) => {
                const read = await get(b.kernel, '/meta/dashboard/pair_rows_dash');
                const published = await get(b.kernel, '/meta/dashboard/pair_rows_dash/published');
                const where = `${saved.join(' then ')} saved, ${leg}`;
                expect([read.status, published.status, where], JSON.stringify([read.body, published.body])).toEqual([200, 200, where]);
                for (const answer of [read, published]) expect(JSON.stringify(answer.body ?? null)).not.toContain('RESOURCE_CONFLICT');
                const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'dashboard', name: 'pair_rows_dash' });
                answers.push(JSON.stringify([unwrap(read.body)?.item?.label, unwrap(published.body)?.label, executed?.item?.label]));
            };
            try {
                for (const id of saved) await layRow(booted.engine, 'dashboard', 'pair_rows_dash', id, { label: id === X ? 'base row' : 'pair row', widgets: [] });
                await observe(booted, 'before a reboot');
            } finally {
                await down(booted);
            }
            booted = await bootManifests(manifests, file);
            try {
                await observe(booted, 'after a reboot');
            } finally {
                await down(booted);
            }
        }
        // Each save order answers the same before and after a reboot.
        // [#32662 scope note (b)] …and the same row in both save orders: the
        // base's own row, on the plain read, `/published` and the execution
        // face. FROM (`main` d4fbb4dbb6): the plain read served the row saved
        // first, so with the pair's saved first it served the pair's row.
        expect([answers[0] === answers[1], answers[2] === answers[3]], answers.join(' | ')).toEqual([true, true]);
        expect(answers, answers.join(' | ')).toEqual(Array(4).fill(JSON.stringify(['base row', 'base row', 'base row'])));
    }, 240_000);

    // M2 (n1: a bundled type at a member other than the canonical one): base A stores `en-US`, dependent D stores `fr-FR`.
    const A = 'com.qa.mailrowbase';
    const D = 'com.qa.mailrowaddon';
    const template = (locale: string, subject: string) => ({ label: subject, locale, subject, bodyHtml: `<p>${subject}</p>` });
    // [#33210 (c), #28802 R2] …and one answer, whether the base holds the
    // name as a stored row or ships it: the read naming no package at the
    // dependent's added member reads the base's address, which holds no
    // `fr-FR` (404), on the plain read, /layers and the execution face; the
    // dependent's own address serves its row. FROM (`main` 66f6638fa4): with a
    // row-held base all three served the dependent's row (the M2 answer of
    // #32607), while with a shipped base all three answered 404.
    it.each([
        { order: 'row-held base, A saved first', ships: false, saved: [A, D] },
        { order: 'row-held base, D saved first', ships: false, saved: [D, A] },
        { order: 'shipped base (CONTROL)', ships: true, saved: [D] },
    ])('M2, $order: the dependent\'s added `fr-FR` answers 404 on the plain read, /layers and the execution face naming no package, and is served at its own address, before and after a reboot', async ({ ships, saved }) => {
        const file = freshFile();
        const manifests = [
            appManifest(A, ships ? { emailTemplates: [{ name: 'rowmail', ...template('en-US', 'base en') }] } : {}),
            appManifest(D, { dependencies: { [A]: '*' } }),
        ];
        let booted = await bootManifests(manifests, file);
        const observe = async (b: Booted) => {
            const read = await get(b.kernel, '/meta/email_template/rowmail', { member: 'fr-FR' });
            expect([read.status, codeOf(read.body)], JSON.stringify(read.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
            const layers = await get(b.kernel, '/meta/email_template/rowmail/layers', { member: 'fr-FR' });
            expect([layers.status, codeOf(layers.body)], JSON.stringify(layers.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
            for (const answer of [read, layers]) expect(JSON.stringify(answer.body ?? null)).not.toContain('addon fr');
            // `/published` takes no member selector (400 VALIDATION_ERROR): it reads the canonical member only.
            const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'email_template', name: 'rowmail', member: 'fr-FR' });
            expect(executed?.item ?? null, JSON.stringify(executed ?? null)).toBeNull();
            // The dependent's own address serves its row.
            const own = await get(b.kernel, '/meta/email_template/rowmail', { member: 'fr-FR', package: D });
            expect([own.status, unwrap(own.body)?.item?.subject, unwrap(own.body)?.packageId], JSON.stringify(own.body)).toEqual([200, 'addon fr', D]);
            // CONTROL: the base's own `en-US` stays the base's.
            const en = await get(b.kernel, '/meta/email_template/rowmail', { member: 'en-US' });
            expect([en.status, unwrap(en.body)?.item?.subject], JSON.stringify(en.body)).toEqual([200, 'base en']);
        };
        try {
            for (const id of saved) {
                await layRow(booted.engine, 'email_template', 'rowmail', id, id === A ? template('en-US', 'base en') : template('fr-FR', 'addon fr'));
            }
            await observe(booted);
        } finally {
            await down(booted);
        }
        booted = await bootManifests(manifests, file);
        try {
            await observe(booted);
        } finally {
            await down(booted);
        }
    }, 240_000);

    // [#33210 contract review M1] Two dependents, each adding a member of its
    // own (D1 `fr-FR`, D2 `de-DE`) over A's `en-US`: each dependent is judged
    // against its own closure, so A is the base at both members and each
    // answers 404 naming no package, as with a shipped base. FROM (head
    // b959edb979, `bases.length === 1`): the read at `fr-FR` found A and D2
    // with no row there and served D1's row (200), and likewise at `de-DE`.
    const D1 = 'com.qa.mailrowfr';
    const D2 = 'com.qa.mailrowde';
    const ADDED: Record<string, { locale: string; subject: string }> = {
        [D1]: { locale: 'fr-FR', subject: 'addon fr' },
        [D2]: { locale: 'de-DE', subject: 'addon de' },
    };
    it.each([
        { order: 'row-held base, registered and saved A, D1, D2', ships: false, registered: [A, D1, D2] },
        { order: 'row-held base, registered and saved D2, D1, A', ships: false, registered: [D2, D1, A] },
        { order: 'shipped base (CONTROL), registered A, D1, D2', ships: true, registered: [A, D1, D2] },
        { order: 'shipped base (CONTROL), registered D2, D1, A', ships: true, registered: [D2, D1, A] },
    ])('M1 two dependents, $order: each dependent\'s added member answers 404 naming no package and is served at its own address, before and after a reboot', async ({ ships, registered }) => {
        const file = freshFile();
        const manifestOf = (id: string) => (id === A
            ? appManifest(A, ships ? { emailTemplates: [{ name: 'twomail', ...template('en-US', 'base en') }] } : {})
            : appManifest(id, { dependencies: { [A]: '*' } }));
        const manifests = registered.map(manifestOf);
        let booted = await bootManifests(manifests, file);
        const observe = async (b: Booted, leg: string) => {
            for (const id of [D1, D2]) {
                const { locale, subject } = ADDED[id];
                const where = `${locale}, ${leg}`;
                const read = await get(b.kernel, '/meta/email_template/twomail', { member: locale });
                const layers = await get(b.kernel, '/meta/email_template/twomail/layers', { member: locale });
                const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'email_template', name: 'twomail', member: locale });
                expect([where, read.status, codeOf(read.body), layers.status, codeOf(layers.body), executed?.item ?? null], JSON.stringify([read.body, layers.body]))
                    .toEqual([where, 404, 'RESOURCE_NOT_FOUND', 404, 'RESOURCE_NOT_FOUND', null]);
                const own = await get(b.kernel, '/meta/email_template/twomail', { member: locale, package: id });
                expect([where, own.status, unwrap(own.body)?.item?.subject, unwrap(own.body)?.packageId], JSON.stringify(own.body)).toEqual([where, 200, subject, id]);
            }
            // CONTROL: the base's own `en-US` stays the base's.
            const en = await get(b.kernel, '/meta/email_template/twomail', { member: 'en-US' });
            expect([leg, en.status, unwrap(en.body)?.item?.subject], JSON.stringify(en.body)).toEqual([leg, 200, 'base en']);
        };
        try {
            for (const id of registered) {
                if (id === A && ships) continue;
                await layRow(booted.engine, 'email_template', 'twomail', id, id === A ? template('en-US', 'base en') : template(ADDED[id].locale, ADDED[id].subject));
            }
            await observe(booted, 'before a reboot');
        } finally {
            await down(booted);
        }
        booted = await bootManifests(manifests, file);
        try {
            await observe(booted, 'after a reboot');
        } finally {
            await down(booted);
        }
    }, 240_000);

    // [#33210 contract review S1] The canonical-member mirror is left as it
    // was: a dependent's row of the CANONICAL member (`en-US`) over a base that
    // holds the name only as a stored row of another member (`fr-FR`). The
    // read naming no member addresses the canonical member, and the arm moves
    // only a named non-canonical member, so every door serves the dependent's
    // row as on `main`, in both save orders, before and after a reboot. FROM
    // (head b959edb979, arm unguarded): the read naming no member, `/published`,
    // `/layers` and the execution face answered 404 before a reboot, and the
    // plain read and the execution face served A's `fr-FR` after it. No
    // shipped CONTROL is pinned: with A shipping only `fr-FR`, the read naming
    // no member serves A's `fr-FR`, and `/published` and `/layers` move across
    // a reboot (200 then 404), so there is no one shipped answer to align with.
    it.each([
        { order: 'A saved first', saved: [A, D] },
        { order: 'D saved first', saved: [D, A] },
    ])('S1, $order: a dependent\'s canonical member over a row-held base of another member is served on every door naming no package, before and after a reboot', async ({ saved }) => {
        const file = freshFile();
        const manifests = [appManifest(A), appManifest(D, { dependencies: { [A]: '*' } })];
        let booted = await bootManifests(manifests, file);
        const observe = async (b: Booted, leg: string) => {
            const read = await get(b.kernel, '/meta/email_template/canmail');
            const named = await get(b.kernel, '/meta/email_template/canmail', { member: 'en-US' });
            const layers = await get(b.kernel, '/meta/email_template/canmail/layers');
            const published = await get(b.kernel, '/meta/email_template/canmail/published');
            const executed = await (b.kernel.getService('protocol') as any).getMetaItemForExecution({ type: 'email_template', name: 'canmail' });
            expect([leg, read.status, unwrap(read.body)?.item?.subject, named.status, unwrap(named.body)?.item?.subject,
                layers.status, unwrap(layers.body)?.effective?.subject, published.status, unwrap(published.body)?.subject, executed?.item?.subject],
            JSON.stringify([read.body, named.body, layers.body, published.body]))
                .toEqual([leg, 200, 'addon en', 200, 'addon en', 200, 'addon en', 200, 'addon en', 'addon en']);
            // CONTROL: the base's own `fr-FR` stays the base's.
            const fr = await get(b.kernel, '/meta/email_template/canmail', { member: 'fr-FR' });
            expect([leg, fr.status, unwrap(fr.body)?.item?.subject], JSON.stringify(fr.body)).toEqual([leg, 200, 'base fr']);
        };
        try {
            for (const id of saved) await layRow(booted.engine, 'email_template', 'canmail', id, id === A ? template('fr-FR', 'base fr') : template('en-US', 'addon en'));
            await observe(booted, 'before a reboot');
        } finally {
            await down(booted);
        }
        booted = await bootManifests(manifests, file);
        try {
            await observe(booted, 'after a reboot');
        } finally {
            await down(booted);
        }
    }, 240_000);
});

// ---------------------------------------------------------------------------
// [#33127, #32662, ADR-0150 D3/D4] Each exact address serves its own stored
// row, in every save order, before and after a reboot. The registry kept ONE
// bare slot per name for a stored row bound to a package, so the row hydrated
// last took it. Measured on `main` d4fbb4dbb6 through these doors:
// - #33127, both packages ship a `tool` and each stores its own row: after a
//   reboot `?package=` answered its own row only for the holder whose row
//   hydrated last; the other answered its shipped item.
// - #32662, two packages hold a name only as stored rows: `?package=<id>.custom`
//   (each one's customization pair address) answered 404 for both before a
//   reboot; after it, 200 for the row hydrated last and 409 naming one side
//   for the other.
// - #32662 scope note (b), a package's row beside its own pair's undeclared
//   row: the plain read served the pair's row when it was saved first, while
//   `/published` served the package's own row.
// Throughout, the read naming no package of a two-holder name refuses 409
// naming both (#32607): unchanged.
// ---------------------------------------------------------------------------
describe('[#33127, #32662] each exact address serves its own stored row, before and after a reboot', () => {
    const roots: string[] = [];
    afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-own-slot-db-'));
        roots.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (booted: Booted) => {
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        roots.push(booted.root);
    };
    const short = (id: string) => id.split('.').pop()!;
    const P = 'com.qa.ownslotalpha';
    const Q = 'com.qa.ownslotbeta';
    const bodyOf = (type: string, label: string): Record<string, unknown> =>
        type === 'tool' ? { label, description: label, parameters: { type: 'object', properties: {} } } : { label, widgets: [] };
    const manifestOf = (id: string, ships: readonly string[] = []) => ({
        id, name: short(id), namespace: short(id), version: '1.0.0', type: 'app', objects: [],
        ...(ships.includes('tool') ? { tools: [{ name: 'shared_tool', ...bodyOf('tool', `shipped-${short(id)}`) }] } : {}),
    });
    /** `200 <label>`, or `<status> <code> [<candidates>]`. */
    async function answer(kernel: ObjectKernel, type: string, name: string, query: Record<string, string> = {}, door = '') {
        const r = await get(kernel, `/meta/${type}/${name}${door}`, query);
        const body = unwrap(r.body);
        if (r.status === 200) return `200 ${body?.item?.label ?? body?.label}`;
        const candidates = r.body?.error?.details?.candidates?.map((c: any) => short(String(c.packageId ?? c.kind)));
        return `${r.status} ${codeOf(r.body)}${candidates ? ` [${candidates.join(',')}]` : ''}`;
    }
    /** Boot `manifests` over a fresh file, lay `rows`, observe; reboot over the same file, observe again. */
    async function bothLegs(manifests: readonly Record<string, unknown>[], lay: (engine: ObjectQL) => Promise<void>, observe: (kernel: ObjectKernel) => Promise<unknown>) {
        const file = freshFile();
        let booted = await bootManifests(manifests, file);
        let before: unknown;
        try {
            await lay(booted.engine);
            before = await observe(booted.kernel);
        } finally {
            await down(booted);
        }
        booted = await bootManifests(manifests, file);
        try {
            return { before, after: await observe(booted.kernel) };
        } finally {
            await down(booted);
        }
    }

    for (const rowOrder of [[P, Q], [Q, P]] as const) {
        it(`#33127 tool, both packages ship it, ${short(rowOrder[0])}'s row stored first: after a reboot each \`?package=\` serves its own row, and the bare read refuses naming both`, async () => {
            const { after } = await bothLegs([manifestOf(P, ['tool']), manifestOf(Q, ['tool'])],
                async (engine) => { for (const id of rowOrder) await layRow(engine, 'tool', 'shared_tool', id, bodyOf('tool', `row-${short(id)}`)); },
                async (kernel) => [
                    await answer(kernel, 'tool', 'shared_tool', { package: P }),
                    await answer(kernel, 'tool', 'shared_tool', { package: Q }),
                    await answer(kernel, 'tool', 'shared_tool'),
                ]);
            // FROM (main): the holder whose row hydrated first answered `shipped-<it>`.
            expect(after).toEqual(['200 row-ownslotalpha', '200 row-ownslotbeta', `409 RESOURCE_CONFLICT [${short(P)},${short(Q)}]`]);
        }, 120_000);
    }

    it('CONTROL — #33127 tool, one package ships it and stores its row: `?package=` and the bare read serve the row after a reboot, as before', async () => {
        const { after } = await bothLegs([manifestOf(P, ['tool']), manifestOf(Q)],
            async (engine) => { await layRow(engine, 'tool', 'shared_tool', P, bodyOf('tool', 'row-ownslotalpha')); },
            async (kernel) => [await answer(kernel, 'tool', 'shared_tool', { package: P }), await answer(kernel, 'tool', 'shared_tool')]);
        expect(after).toEqual(['200 row-ownslotalpha', '200 row-ownslotalpha']);
    }, 120_000);

    for (const type of ['dashboard', 'tool']) {
        for (const saved of [[P, Q], [Q, P]] as const) {
            it(`#32662 ${type}, two packages hold the name only as stored rows, ${short(saved[0])} saved first: each pair address serves its base's row before and after a reboot; the bare read refuses naming both`, async () => {
                const legs = await bothLegs([manifestOf(P), manifestOf(Q)],
                    async (engine) => { for (const id of saved) await layRow(engine, type, 'pair_addr', id, bodyOf(type, `row-${short(id)}`)); },
                    async (kernel) => [
                        await answer(kernel, type, 'pair_addr', { package: `${P}.custom` }),
                        await answer(kernel, type, 'pair_addr', { package: `${Q}.custom` }),
                        await answer(kernel, type, 'pair_addr', { package: P }),
                        await answer(kernel, type, 'pair_addr', { package: Q }),
                        await answer(kernel, type, 'pair_addr'),
                    ]);
                // FROM (main): before a reboot both pair addresses 404; after
                // it, 200 for the row hydrated last and 409 for the other.
                const own = ['200 row-ownslotalpha', '200 row-ownslotbeta', '200 row-ownslotalpha', '200 row-ownslotbeta', `409 RESOURCE_CONFLICT [${short(P)},${short(Q)}]`];
                expect(legs).toEqual({ before: own, after: own });
            }, 120_000);
        }

        for (const saved of [[P, `${P}.custom`], [`${P}.custom`, P]] as const) {
            it(`#32662 (b) ${type}, a package's row and its pair's undeclared row, ${saved[0] === P ? 'the package' : 'the pair'} saved first: the plain read and /published serve the package's own row, before and after a reboot`, async () => {
                const legs = await bothLegs([manifestOf(P), manifestOf(Q)],
                    async (engine) => { for (const id of saved) await layRow(engine, type, 'own_pair', id, bodyOf(type, id === P ? 'row-own' : 'row-pair')); },
                    async (kernel) => [
                        await answer(kernel, type, 'own_pair'),
                        await answer(kernel, type, 'own_pair', {}, '/published'),
                        await answer(kernel, type, 'own_pair', { package: P }),
                    ]);
                // FROM (main): with the pair saved first, the plain read served `row-pair`.
                expect(legs).toEqual({ before: ['200 row-own', '200 row-own', '200 row-own'], after: ['200 row-own', '200 row-own', '200 row-own'] });
            }, 120_000);
        }
    }
});

// ---------------------------------------------------------------------------
// [#32605, epic ruling 6781691009, ADR-0150 D3/D4/D5] The bare SAVE of a name
// an enabled package E and a disabled package D both hold writes where the
// bare read serves it: E's row. It never writes a package-unbound row, never
// edits D's row (byte-unchanged), and a row of each is E's update, not a 409.
// Once D is enabled again, the bare read and the bare save both answer 409
// naming both. Both transports (the runtime dispatcher and `RestServer`), both
// registration orders; the holders ship the name in code, hold it only as
// stored rows of authored packages, or one of each.
//
// Measured on main 1e65a389 (step 0 of #32605): over no stored row the save
// wrote a package-unbound row; over D's row alone it updated D's row while the
// read kept serving E's code item; over a row of each it refused 409 naming D.
// ---------------------------------------------------------------------------

describe('[#32605] the bare save of a name an enabled and a disabled package hold writes the served holder\'s row', () => {
    const CODE_E = 'com.qa.save_alpha';
    const CODE_D = 'com.qa.save_beta';
    const AUTH_E = 'com.qa.save_authored_alpha';
    const AUTH_D = 'com.qa.save_authored_beta';
    const AUTH_F = 'com.qa.save_authored_gamma';
    const BOTH_SHIP = ['ship_none_dash', 'ship_drow_dash', 'ship_de_dash', 'ship_ed_dash'];
    const E_SHIPS = ['e_only_dash', 'e_authored_drow_dash', 'e_unbound_drow_dash', 'e_two_authored_dash'];
    const savePackageOf = (id: string) => ({
        id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app', objects: [],
        dashboards: [...BOTH_SHIP, ...(id === CODE_E ? E_SHIPS : [])].map((name) => ({ name, label: `${id} code`, widgets: [] })),
    });

    interface SaveBooted extends Booted { put(name: string, label: string): Promise<{ status: number | undefined; body: any }> }

    async function bootSaveKernel(order: readonly string[], transport: 'dispatcher' | 'rest'): Promise<SaveBooted> {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        const root = mkdtempSync(join(tmpdir(), 'os-meta-bare-save-'));
        const engine = new ObjectQL();
        engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        const host: Plugin = {
            name: 'qa.bare-save-host',
            dependencies: ['com.objectstack.engine.objectql'],
            init: async (ctx: PluginContext) => {
                for (const id of order) await ctx.getService<ManifestDoor>('manifest').register(savePackageOf(id));
            },
        };
        await kernel.use(host);
        await kernel.bootstrap();
        await engine.syncSchemas();
        // Authored (writable) packages that ship nothing: holders by stored rows alone.
        for (const id of order[0] === CODE_D ? [AUTH_D, AUTH_E, AUTH_F] : [AUTH_E, AUTH_F, AUTH_D]) {
            engine.registry.installPackage({ id, name: id, version: '1.0.0', type: 'app' } as any, 'authored');
        }
        const body = (name: string, label: string) => ({ name, label, widgets: [] });
        if (transport === 'dispatcher') {
            return {
                kernel, engine, root,
                put: async (name, label) => {
                    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
                    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
                    const request = new Request(`http://localhost/api/v1/meta/dashboard/${name}`, {
                        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(name, label)),
                    });
                    try {
                        const out: any = await dispatcher.dispatch('PUT', `/meta/dashboard/${name}`, body(name, label), {}, { request } as any, '/api/v1');
                        return { status: out.response?.status as number | undefined, body: out.response?.body };
                    } catch (e) {
                        const thrown = resolveThrownHttpError(e);
                        return { status: thrown.status, body: { error: { code: thrown.code, message: String((e as Error)?.message ?? '') } } };
                    }
                },
            };
        }
        const noop = () => {};
        const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
        const rest: any = new RestServer(server as any, kernel.getService('protocol') as any, { api: { requireAuth: false } } as any);
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === '/api/v1/meta/:type/:name');
        if (!route) throw new Error('PUT /api/v1/meta/:type/:name is not registered');
        rest.resolveExecCtx = async () => ({ ...CALLER });
        return {
            kernel, engine, root,
            put: async (name, label) => {
                const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
                res.status = (code: number) => { res.statusCode = code; return res; };
                res.json = (payload: any) => { res.body = payload; return res; };
                res.send = () => res;
                res.end = () => res;
                res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
                res.setHeader = () => {};
                res.write = () => true;
                await route.handler({
                    method: 'PUT', path: `/api/v1/meta/dashboard/${name}`, params: { type: 'dashboard', name },
                    headers: {}, query: {}, body: body(name, label),
                }, res);
                return { status: res.statusCode, body: res.body };
            },
        };
    }

    /** Every stored row of the name, keyed by binding (`null`: package-unbound), with its stored bytes. */
    const storedRows = async (engine: ObjectQL, name: string): Promise<Record<string, { label: string; bytes: string }>> => {
        const rows = (await engine.find('sys_metadata', { where: { type: 'dashboard', name, state: 'active' }, context: { isSystem: true } } satisfies EngineQueryOptions)) as any[];
        return Object.fromEntries(rows.map((row) => [String(row.package_id ?? null), {
            label: JSON.parse(String(row.metadata)).label,
            bytes: JSON.stringify([row.metadata, row.version, row.checksum ?? null]),
        }]));
    };
    const layRow = (engine: ObjectQL, name: string, packageId: string | null, label: string) => engine.insert('sys_metadata', {
        type: 'dashboard', name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
        metadata: JSON.stringify({ name, label, widgets: [] }),
    }, { context: { isSystem: true } } as any);
    const bareLabel = async (booted: SaveBooted, name: string) => {
        const read = await get(booted.kernel, `/meta/dashboard/${name}`);
        return [read.status, unwrap(read.body)?.item?.label];
    };
    const expectRefusedNamingBoth = (answer: { status: number | undefined; body: any }, e: string, d: string) => {
        expect([answer.status, codeOf(answer.body)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        for (const id of [e, d]) expect(JSON.stringify(answer.body)).toContain(id);
    };

    describe.each([
        { regOrder: 'disabled first', transport: 'dispatcher' as const, order: [CODE_D, CODE_E] },
        { regOrder: 'enabled first', transport: 'dispatcher' as const, order: [CODE_E, CODE_D] },
        { regOrder: 'disabled first', transport: 'rest' as const, order: [CODE_D, CODE_E] },
        { regOrder: 'enabled first', transport: 'rest' as const, order: [CODE_E, CODE_D] },
    ])('$transport, packages registered $regOrder', ({ transport, order }) => {
        let booted: SaveBooted | undefined;
        beforeAll(async () => { booted = await bootSaveKernel(order, transport); }, 120_000);
        afterAll(async () => {
            if (!booted) return;
            if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
            rmSync(booted.root, { recursive: true, force: true });
        });
        const withDisabled = async (id: string, body: () => Promise<void>) => {
            booted!.engine.registry.disablePackage(id);
            try { await body(); } finally { booted!.engine.registry.enablePackage(id); }
        };

        it('both ship it, no stored row: the save writes a row bound to E and no package-unbound row', async () => {
            await withDisabled(CODE_D, async () => {
                const saved = await booted!.put('ship_none_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'ship_none_dash');
                expect(Object.keys(rows)).toEqual([CODE_E]);
                expect(rows[CODE_E]?.label).toBe('edited');
                expect(await bareLabel(booted!, 'ship_none_dash')).toEqual([200, 'edited']);
            });
        });

        it('both ship it, D\'s row alone: the save writes E\'s row, D\'s row is byte-unchanged, the next read shows the edit; re-enabled, read and save refuse naming both', async () => {
            await layRow(booted!.engine, 'ship_drow_dash', CODE_D, 'disabled row');
            const before = await storedRows(booted!.engine, 'ship_drow_dash');
            await withDisabled(CODE_D, async () => {
                const saved = await booted!.put('ship_drow_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'ship_drow_dash');
                expect(Object.keys(rows).sort()).toEqual([CODE_E, CODE_D].sort());
                expect(rows[CODE_E]?.label).toBe('edited');
                expect(rows[CODE_D]?.bytes).toBe(before[CODE_D]?.bytes);
                expect(await bareLabel(booted!, 'ship_drow_dash')).toEqual([200, 'edited']);
            });
            const settled = await storedRows(booted!.engine, 'ship_drow_dash');
            expectRefusedNamingBoth(await get(booted!.kernel, '/meta/dashboard/ship_drow_dash'), CODE_E, CODE_D);
            expectRefusedNamingBoth(await booted!.put('ship_drow_dash', 'again'), CODE_E, CODE_D);
            expect(await storedRows(booted!.engine, 'ship_drow_dash')).toEqual(settled);
        });

        it.each([
            { saveOrder: 'D saved first', name: 'ship_de_dash', saved: [CODE_D, CODE_E] },
            { saveOrder: 'E saved first', name: 'ship_ed_dash', saved: [CODE_E, CODE_D] },
        ])('both ship it, a row of each ($saveOrder): the save updates E\'s row (was 409) and D\'s is byte-unchanged', async ({ name, saved }) => {
            for (const id of saved) await layRow(booted!.engine, name, id, `${id === CODE_D ? 'disabled' : 'enabled'} row`);
            const before = await storedRows(booted!.engine, name);
            await withDisabled(CODE_D, async () => {
                const answer = await booted!.put(name, 'edited');
                expect(answer.status, JSON.stringify(answer.body)).toBe(200);
                const rows = await storedRows(booted!.engine, name);
                expect(rows[CODE_E]?.label).toBe('edited');
                expect(rows[CODE_D]?.bytes).toBe(before[CODE_D]?.bytes);
                expect(Object.keys(rows).sort()).toEqual([CODE_E, CODE_D].sort());
            });
            expectRefusedNamingBoth(await booted!.put(name, 'again'), CODE_E, CODE_D);
        });

        it('E ships it and an authored D holds only a row: the save writes E\'s row and D\'s row is byte-unchanged', async () => {
            await layRow(booted!.engine, 'e_authored_drow_dash', AUTH_D, 'disabled row');
            const before = await storedRows(booted!.engine, 'e_authored_drow_dash');
            await withDisabled(AUTH_D, async () => {
                const saved = await booted!.put('e_authored_drow_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'e_authored_drow_dash');
                expect(Object.keys(rows).sort()).toEqual([CODE_E, AUTH_D].sort());
                expect(rows[CODE_E]?.label).toBe('edited');
                expect(rows[AUTH_D]?.bytes).toBe(before[AUTH_D]?.bytes);
                expect(await bareLabel(booted!, 'e_authored_drow_dash')).toEqual([200, 'edited']);
            });
        });

        it.each([
            { saveOrder: 'D saved first', name: 'authored_de_dash', saved: [AUTH_D, AUTH_E] },
            { saveOrder: 'E saved first', name: 'authored_ed_dash', saved: [AUTH_E, AUTH_D] },
        ])('two authored row holders ($saveOrder), D disabled: the save updates E\'s row and D\'s is byte-unchanged; re-enabled, read and save refuse naming both', async ({ name, saved }) => {
            for (const id of saved) await layRow(booted!.engine, name, id, `${id === AUTH_D ? 'disabled' : 'enabled'} row`);
            const before = await storedRows(booted!.engine, name);
            await withDisabled(AUTH_D, async () => {
                const answer = await booted!.put(name, 'edited');
                expect(answer.status, JSON.stringify(answer.body)).toBe(200);
                const rows = await storedRows(booted!.engine, name);
                expect(Object.keys(rows).sort()).toEqual([AUTH_E, AUTH_D].sort());
                expect(rows[AUTH_E]?.label).toBe('edited');
                expect(rows[AUTH_D]?.bytes).toBe(before[AUTH_D]?.bytes);
                expect(await bareLabel(booted!, name)).toEqual([200, 'edited']);
            });
            const settled = await storedRows(booted!.engine, name);
            expectRefusedNamingBoth(await get(booted!.kernel, `/meta/dashboard/${name}`), AUTH_E, AUTH_D);
            expectRefusedNamingBoth(await booted!.put(name, 'again'), AUTH_E, AUTH_D);
            expect(await storedRows(booted!.engine, name)).toEqual(settled);
        });

        it('two authored row holders served beside a disabled one: the save refuses naming only the served two, and writes nothing', async () => {
            for (const id of [AUTH_D, AUTH_E, AUTH_F]) await layRow(booted!.engine, 'authored_three_dash', id, `${id} row`);
            const before = await storedRows(booted!.engine, 'authored_three_dash');
            await withDisabled(AUTH_D, async () => {
                const answer = await booted!.put('authored_three_dash', 'edited');
                expectRefusedNamingBoth(answer, AUTH_E, AUTH_F);
                expect(JSON.stringify(answer.body)).not.toContain(AUTH_D);
                expect(await storedRows(booted!.engine, 'authored_three_dash')).toEqual(before);
            });
        });

        it('E ships it, two authored row holders beside a disabled one: the save refuses naming only the enabled two', async () => {
            for (const id of [AUTH_D, AUTH_E, AUTH_F]) await layRow(booted!.engine, 'e_two_authored_dash', id, `${id} row`);
            const before = await storedRows(booted!.engine, 'e_two_authored_dash');
            await withDisabled(AUTH_D, async () => {
                const answer = await booted!.put('e_two_authored_dash', 'edited');
                expectRefusedNamingBoth(answer, AUTH_E, AUTH_F);
                expect(JSON.stringify(answer.body)).not.toContain(AUTH_D);
                expect(await storedRows(booted!.engine, 'e_two_authored_dash')).toEqual(before);
            });
        });

        it('E ships it, a package-unbound row and an authored D\'s row: the save edits the package-unbound row the read serves, and D\'s is byte-unchanged', async () => {
            await layRow(booted!.engine, 'e_unbound_drow_dash', null, 'environment row');
            await layRow(booted!.engine, 'e_unbound_drow_dash', AUTH_D, 'disabled row');
            const before = await storedRows(booted!.engine, 'e_unbound_drow_dash');
            await withDisabled(AUTH_D, async () => {
                expect(await bareLabel(booted!, 'e_unbound_drow_dash')).toEqual([200, 'environment row']);
                const saved = await booted!.put('e_unbound_drow_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'e_unbound_drow_dash');
                expect(Object.keys(rows).sort()).toEqual([AUTH_D, 'null'].sort());
                expect(rows.null?.label).toBe('edited');
                expect(rows[AUTH_D]?.bytes).toBe(before[AUTH_D]?.bytes);
                expect(await bareLabel(booted!, 'e_unbound_drow_dash')).toEqual([200, 'edited']);
            });
        });

        it('CONTROL: a name one enabled package ships, beside a disabled package that does not hold it, saves as before (the package-unbound overlay)', async () => {
            await withDisabled(CODE_D, async () => {
                const saved = await booted!.put('e_only_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'e_only_dash');
                expect([Object.keys(rows), rows.null?.label]).toEqual([['null'], 'edited']);
            });
        });

        it('CONTROL: a name only the disabled D holds (its row alone) is saved as before, at D\'s address (no served holder takes it)', async () => {
            await layRow(booted!.engine, 'authored_donly_dash', AUTH_D, 'disabled row');
            await withDisabled(AUTH_D, async () => {
                const saved = await booted!.put('authored_donly_dash', 'edited');
                expect(saved.status, JSON.stringify(saved.body)).toBe(200);
                const rows = await storedRows(booted!.engine, 'authored_donly_dash');
                expect([Object.keys(rows), rows[AUTH_D]?.label]).toEqual([[AUTH_D], 'edited']);
            });
        });
    });
});
