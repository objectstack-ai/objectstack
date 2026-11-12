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
            // The layered door answers a package-scoped refusal by its sentence alone, as for two registry holders (#32622).(#32622).
            const layers = await get(booted.kernel, '/meta/dashboard/three_rows_dash/layers');
            expect([layers.status, codeOf(layers.body)], JSON.stringify(layers.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            for (const id of [ROW_E, ROW_F]) expect(JSON.stringify(layers.body)).toContain(id);
            noDisabledTrace([read, layers]);
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
// read and `/published` served the row saved first (`/published` on this
// dispatcher served the first package by id in every order), while `/layers`
// refused 409 naming both, before and after a reboot.
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
        // The layered door and /published answer the refusal by its sentence (#32622): both holders named, no row served.
        for (const door of ['layers', 'published']) {
            const answer = await get(booted.kernel, `/meta/dashboard/${name}/${door}`);
            expect([answer.status, codeOf(answer.body), door], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', door]);
            for (const id of [ROW_E, ROW_F]) expect(JSON.stringify(answer.body)).toContain(id);
            expect(JSON.stringify(answer.body)).not.toMatch(/(enabled|third) row/);
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
});
