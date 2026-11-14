// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32183, contract review: the REST action rung through the door] Two
// packages declare one action on one object, and one of them is disabled: the
// bare `POST /actions/:object/:action` door runs the enabled holder's action,
// whichever registered first, and never the disabled one's. A disable is
// reversible: re-enabled, the call is refused `409 RESOURCE_CONFLICT` naming
// both again (#32213's holder rule). Driven on a booted kernel through
// `HttpDispatcher.dispatch`, the rig of `actions-bare-door-topologies.test.ts`.
//
// The by-package rung (`resolveRouteActionByPackage`) is reached only when a
// caller names its package, and no door passes one to
// `resolveRouteActionDeclaration` today (`domains/actions.ts`,
// `action-dispatch.ts`): its refusal arm stays pinned by function in
// `../action-package-addressing.test.ts`.

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

const CALLER = { userId: 'u_disabled_holder', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

const OBJECT = 'dhowner_obj';
const OWNER = 'com.qa.dhowner';
const ENABLED = 'com.qa.dhx';
const DISABLED = 'com.qa.dhy';
const script = (tag: string) => ({ language: 'js', source: `return { from: '${tag}' };`, capabilities: [] });

const OWNER_PACKAGE = {
    id: OWNER, name: 'dhowner', namespace: 'dhowner', version: '1.0.0', type: 'app',
    objects: [{ name: OBJECT, label: 'Object', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
};
const declarer = (id: string) => ({
    id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app',
    dependencies: { [OWNER]: '^1.0.0' },
    objects: [{ name: `${id.split('.').pop()}_obj`, label: 'Other', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
    actions: [{ name: 'approve', label: `${id} approve`, type: 'script', body: script(id), objectName: OBJECT }],
});

interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }

async function bootKernel(order: readonly string[]): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-actions-disabled-holder-door-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.disabled-holder-door-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            await ctx.getService<ManifestDoor>('manifest').register(OWNER_PACKAGE);
            for (const id of order) await ctx.getService<ManifestDoor>('manifest').register(declarer(id));
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    // Each package's handler, bound as the runtime binds a package's (`app:<id>`).
    for (const id of order) engine.registerAction(OBJECT, 'approve', async () => ({ from: id }), `app:${id}`);
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

describe.each([
    { order: 'enabled first', packages: [ENABLED, DISABLED] },
    { order: 'disabled first', packages: [DISABLED, ENABLED] },
])('[#32183] the bare action door, two holders registered $order, one disabled', ({ packages }) => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootKernel(packages);
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('CONTROL: both enabled, the bare call is refused 409 naming both, nothing run', async () => {
        const answer = await post(booted!.kernel, `/actions/${OBJECT}/approve`);
        expect([answer.status, answer.code], answer.message).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.message).toContain(ENABLED);
        expect(answer.message).toContain(DISABLED);
    });

    it('one disabled: the bare call runs the enabled holder\'s action; re-enabled, it is refused naming both again', async () => {
        booted!.engine.registry.disablePackage(DISABLED);
        try {
            const answer = await post(booted!.kernel, `/actions/${OBJECT}/approve`);
            expect(answer.status, answer.message).toBe(200);
            expect(JSON.stringify(answer.data)).toContain(ENABLED);
            expect(JSON.stringify(answer.data ?? null)).not.toContain(DISABLED);
        } finally {
            booted!.engine.registry.enablePackage(DISABLED);
        }
        const again = await post(booted!.kernel, `/actions/${OBJECT}/approve`);
        expect([again.status, again.code], again.message).toEqual([409, 'RESOURCE_CONFLICT']);
    });
});
