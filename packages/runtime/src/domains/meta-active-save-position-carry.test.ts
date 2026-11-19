// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `renamedFrom` position saved straight to active through the metadata save
 * door (`PUT /api/v1/meta/position/:name`, the default mode) carries its
 * holders before the door answers, as a draft save followed by the per-item
 * publish does — and no door announces `metadata:reloaded` more than once.
 *
 * RED-FIRST PIN. On `origin/main` the first case is red: the active save
 * announces nothing, so `plugin-security`'s holder carry
 * (`position-renamed-holder-carry.ts`) never runs and the holder keeps the old
 * name until the next boot. The two controls are green there: the per-item
 * publish and publish-drafts each announce once and carry at once. The
 * at-most-once bound is what keeps a fix from paying for the active save with
 * a second kernel-wide re-sync on the publish doors.
 *
 * A real composition: `ObjectKernel`, the SQL driver (better-sqlite3
 * `:memory:`), `ObjectQLPlugin`, the real `SecurityPlugin`, and the
 * `HttpDispatcher` meta door. The recorder only listens.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { HttpDispatcher } from '../http-dispatcher.js';
import '@objectstack/metadata';

const SYSTEM_CTX = { isSystem: true } as const;
const PKG = 'com.acme.activesave';
const NS = 'activesave';

const ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_meta_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
let kernel: ObjectKernel;
let ql: ObjectQL;
let dispatcher: HttpDispatcher;
const heard: unknown[] = [];

beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'os-active-save-'));
    process.env.OS_HOME = home;
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use({
        name: 'test.activesave.driver', type: 'standard', version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any));
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new SecurityPlugin({ fallbackPermissionSet: null }));
    await kernel.use({
        name: 'test.activesave.composition', type: 'standard', version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        async init(ctx: PluginContext) {
            const manifest = ctx.getService<{ register(m: unknown): unknown }>('manifest');
            await manifest.register({ id: 'test.activesave.identity', name: 'Identity', version: '1.0.0', type: 'plugin', objects: [SysUser, SysMember, SysOrganization] });
            ctx.hook('metadata:reloaded', async (payload?: unknown) => {
                heard.push((payload as { changed?: unknown } | undefined)?.changed);
            });
        },
    } as Plugin);
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    dispatcher = new HttpDispatcher(kernel as any);
    const created = await dispatcher.handlePackages('', 'POST', { manifest: { id: PKG, name: 'Active save', version: '0.1.0', type: 'app', namespace: NS } }, {}, ADMIN());
    expect(created.response?.status, JSON.stringify(created.response?.body)).toBe(201);
}, 60_000);

afterAll(async () => {
    await Promise.race([kernel?.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

async function positionOf(id: string): Promise<unknown> {
    const rows = (await ql.find('sys_user_position', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return rows.find((r) => String(r.id) === id)?.position;
}

async function heardDuring<T>(act: () => Promise<T>): Promise<{ result: T; heard: unknown[] }> {
    const from = heard.length;
    const result = await act();
    await new Promise((r) => setTimeout(r, 50));
    return { result, heard: heard.slice(from) };
}

const save = (name: string, body: Record<string, unknown>, query: Record<string, unknown> = {}) =>
    dispatcher.handleMetadata(`/position/${name}`, ADMIN(), 'PUT', { name, ...body }, { package: PKG, ...query }) as Promise<any>;

async function renamedHolder(id: string, from: string): Promise<void> {
    expect((await save(from, { label: from })).response?.status).toBe(200);
    await ql.insert('sys_user_position', { id, user_id: `u_${id}`, position: from, organization_id: 'org_a' }, { context: SYSTEM_CTX });
    const removed: any = await (kernel.getService('protocol') as any).deleteMetaItem({ type: 'position', name: from, packageId: PKG });
    expect(removed?.success, JSON.stringify(removed)).toBe(true);
}

describe('a renamed position saved active through the metadata save door carries its holders at once', () => {
    it('the active save: the holder of the old name holds the new one when the door answers', async () => {
        const from = `${NS}_a`; const to = `${NS}_b`;
        await renamedHolder('h1', from);
        const { result, heard: during } = await heardDuring(() => save(to, { label: 'B', renamedFrom: [from] }));
        expect(result.response?.status, JSON.stringify(result.response?.body)).toBe(200);
        expect(await positionOf('h1')).toBe(to);
        expect(during.length, JSON.stringify(during)).toBeLessThanOrEqual(1);
    }, 60_000);

    it('CONTROL the draft save and the per-item publish: carried at once, announced once', async () => {
        const from = `${NS}_c`; const to = `${NS}_d`;
        await renamedHolder('h2', from);
        const drafted = await save(to, { label: 'D', renamedFrom: [from] }, { mode: 'draft' });
        expect(drafted.response?.status, JSON.stringify(drafted.response?.body)).toBe(200);
        const { result, heard: during } = await heardDuring(() =>
            (kernel.getService('protocol') as any).publishMetaItem({ type: 'position', name: to, packageId: PKG }) as Promise<any>);
        expect(result?.success, JSON.stringify(result)).toBe(true);
        expect(await positionOf('h2')).toBe(to);
        expect(during).toEqual([[`position/${to}`]]);
    }, 60_000);

    it('CONTROL publish-drafts of two positions: carried at once, announced once for the batch', async () => {
        const from = `${NS}_e`; const to = `${NS}_f`; const other = `${NS}_g`;
        await renamedHolder('h3', from);
        expect((await save(to, { label: 'F', renamedFrom: [from] }, { mode: 'draft' })).response?.status).toBe(200);
        expect((await save(other, { label: 'G' }, { mode: 'draft' })).response?.status).toBe(200);
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', {}, {}, ADMIN()) as Promise<any>);
        expect(result.response?.status, JSON.stringify(result.response?.body)).toBe(200);
        expect(await positionOf('h3')).toBe(to);
        expect(during).toEqual([[`position/${to}`, `position/${other}`]]);
    }, 60_000);
});
