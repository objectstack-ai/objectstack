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
