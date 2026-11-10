// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#31697, contract review G3; epic answer on #32213] The bare
// `POST /actions/:object/:action` door fails closed on every served topology:
// two packages that both declare one action on one object are refused
// `409 RESOURCE_CONFLICT`, naming both, on a kernel built the
// `createStandaloneStack` way with `environmentId` set (its `MetadataPlugin`
// options verbatim from `actions-disabled-package.test.ts`'s rig) as on one
// with none. The door's holder rule judges nothing only when the merged
// listing cannot be read for want of any metadata store (`listingNotServed`
// in `../action-execution.ts`); it never asks the engine's schema, so a kernel
// whose listing answers is judged whatever registers `sys_metadata` there.
//
// The pair: package `topa` declares `approve` embedded in its object, and
// package `topb`, which depends on it, declares a standalone `approve` bound
// to the same object. One key, two packages (ruling A).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_topology', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

const OBJECT = 'topa_obj';
const script = (tag: string) => ({ language: 'js', source: `return { from: '${tag}' };`, capabilities: [] });

const HOLDER = {
    id: 'com.qa.topa', name: 'topa', namespace: 'topa', version: '1.0.0', type: 'app',
    objects: [{
        name: OBJECT, label: 'Object',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        actions: [{ name: 'approve', label: 'topa approve', type: 'script', body: script('topa') }],
    }],
};
const SECOND = {
    id: 'com.qa.topb', name: 'topb', namespace: 'topb', version: '1.0.0', type: 'app',
    dependencies: { 'com.qa.topa': '^1.0.0' },
    objects: [{ name: 'topb_obj', label: 'Other', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
    actions: [{ name: 'approve', label: 'topb approve', type: 'script', body: script('topb'), objectName: OBJECT }],
};

interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }

async function bootKernel(environmentId: string | undefined, packages: unknown[]): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-actions-bare-door-topology-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    if (environmentId === undefined) {
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
    } else {
        const artifact = join(root, 'objectstack.json');
        writeFileSync(artifact, JSON.stringify({
            manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
            objects: [], views: [], apps: [], flows: [], requires: [],
        }));
        await kernel.use(new MetadataPlugin({
            watch: false, artifactWatch: false, environmentId,
            artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
        } as any));
        await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId, hydrateMetadataFromDb: true }));
    }
    const host: Plugin = {
        name: 'qa.topology-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const each of packages) await ctx.getService<ManifestDoor>('manifest').register(each);
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    // Each package's handler, bound as the runtime binds a package's (`app:<id>`).
    for (const each of packages as Array<{ id: string }>) {
        engine.registerAction(OBJECT, 'approve', async () => ({ from: each.id }), `app:${each.id}`);
    }
    return { kernel, engine, root };
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
const messageOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.message : body?.error ?? body?.message);

async function post(kernel: ObjectKernel, path: string) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    const raw = new Request(`http://localhost/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    try {
        const out: any = await dispatcher.dispatch('POST', path, {}, {}, { request: raw } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status, code: codeOf(answer), message: String(messageOf(answer) ?? ''), data: answer?.data };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code, message: String((e as Error)?.message ?? ''), data: undefined };
    }
}

const SHAPES = [
    { shape: 'environmentId env_local (createStandaloneStack)', environmentId: 'env_local' },
    { shape: 'no environmentId', environmentId: undefined },
] as const;

describe.each(SHAPES)('[#31697 G3] the bare action door on a kernel with $shape', ({ environmentId }) => {
    let two: Booted | undefined;
    let one: Booted | undefined;

    beforeAll(async () => {
        two = await bootKernel(environmentId, [HOLDER, SECOND]);
        one = await bootKernel(environmentId, [HOLDER]);
    }, 120_000);

    afterAll(async () => {
        for (const booted of [two, one]) {
            if (!booted) continue;
            if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
            rmSync(booted.root, { recursive: true, force: true });
        }
    });

    it('two packages declaring one action on one object: the bare call is refused 409 naming both, nothing run', async () => {
        const answer = await post(two!.kernel, `/actions/${OBJECT}/approve`);
        expect([answer.status, answer.code], answer.message).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.message).toContain('com.qa.topa');
        expect(answer.message).toContain('com.qa.topb');
    });

    it('CONTROL — one holder: the bare call runs its action', async () => {
        const answer = await post(one!.kernel, `/actions/${OBJECT}/approve`);
        expect(answer.status, answer.message).toBe(200);
        expect(JSON.stringify(answer.data)).toContain('com.qa.topa');
    });

    it('measured: this composition registers the metadata store (`sys_metadata`) whatever `environmentId` is — `MetadataPlugin` registers it', () => {
        expect(Boolean((two!.engine as any).getSchema?.('sys_metadata'))).toBe(true);
    });
});
