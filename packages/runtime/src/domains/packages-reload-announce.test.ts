// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33302] The install door (`POST /packages`) and the enable door
 * (`PATCH /packages/:id/enable`) announce `metadata:reloaded` once they have
 * put a package into service, in the spelling the marketplace install-local
 * door announces a hot install with: `{ changed: ['app/ID'] }`. [#33527] The
 * disable door and `DELETE /packages/:id` announce the withdrawal in the same
 * spelling (the last describe below).
 *
 * ## The defect, measured on `origin/main` before the change
 *
 * Neither door called `trigger('metadata:reloaded', …)`. Every subscriber of
 * that event therefore missed both doors: `plugin-security`'s `renamedFrom`
 * holder carry (which runs on that announcement since the hot-install carry
 * landed), the automation engine's flow re-sync, the authored hooks, actions
 * and translations. A package these doors brought into service kept the
 * holders of its renamed positions on the old names until the next boot.
 *
 * ## Measured on a REAL composition, through the real route
 *
 * A real `ObjectKernel` with the SQL driver (better-sqlite3 `:memory:`),
 * `ObjectQLPlugin` and the real `SecurityPlugin`, and an `HttpDispatcher` over
 * that kernel: the announcement reaches the kernel the way a request's does
 * (`announceKernelEvent` → the kernel context's `trigger`), and the carry that
 * moves the holder is `plugin-security`'s own. Nothing below stands in for a
 * subscriber except the recorder, which only listens.
 *
 * Where a package's positions come from on each door:
 *
 *  - the enable door: a code package registered at boot with its positions,
 *    then switched off. A code package is read-only to the disable door
 *    (ADR-0070), so the switch-off is the registry's own `disablePackage`;
 *  - the install door: `ManifestSchema` declares no `positions` key, so an
 *    install body can never carry one (refused `400`). An authored package's
 *    positions are registered by a publish. The case below registers one
 *    under the package as the publish does (`registerItem` with the package
 *    id), switches the package off through the disable door, and brings it
 *    back with an overwrite install carrying `enableOnInstall: true` — the
 *    one way the install door puts a renamed position into service.
 *
 * `OS_HOME` is redirected to a temp dir for the whole file: the doors write a
 * REAL package-state file under it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { HttpDispatcher } from '../http-dispatcher.js';
// Paid at collection, not inside a clocked case: the dispatcher's package domain
// reaches it through a dynamic import (check:test-source-alias).
import '@objectstack/metadata';

const SYSTEM_CTX = { isSystem: true } as const;

/** A code package registered at boot: it renames `sales_rep`, and ships the CONTROL `crm_auditor`. */
const CRM = 'com.acme.reloadcrm';
const crmPackage = {
    id: CRM,
    name: 'Reload CRM',
    version: '2.0.0',
    type: 'app',
    namespace: 'reloadcrm',
    positions: [
        { name: 'crm_sales_rep', label: 'Sales rep', renamedFrom: ['sales_rep'] },
        { name: 'crm_auditor', label: 'Auditor' },
    ],
};

/** An authored package the install door creates; a publish registers its renaming position. */
const AUTHORED = 'com.acme.reloadauthored';
const authoredManifest = { id: AUTHORED, name: 'Reload authored', version: '1.0.0', type: 'app', namespace: 'reloadauthored' };

/** A fresh authored package: nothing else is done to it. */
const FRESH = 'com.acme.reloadfresh';
const freshManifest = { id: FRESH, name: 'Reload fresh', version: '1.0.0', type: 'app', namespace: 'reloadfresh' };

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const holder = (id: string, user: string, position: string, organization: string) => ({
    id, user_id: user, position, organization_id: organization,
});

/**
 * Every announcement the kernel heard, with whether the registry held what it
 * names at that moment and, for what it held, whether that package was disabled.
 */
interface Heard {
    readonly changed: unknown;
    readonly held: Record<string, boolean>;
    readonly off: Record<string, boolean>;
}

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
let kernel: ObjectKernel;
let ql: ObjectQL;
let dispatcher: HttpDispatcher;
const heard: Heard[] = [];

beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'os-33302-'));
    process.env.OS_HOME = home;

    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use({
        name: 'test.reload.driver',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any));
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new SecurityPlugin({ fallbackPermissionSet: null }));
    await kernel.use({
        name: 'test.reload.composition',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        async init(ctx: PluginContext) {
            const manifest = ctx.getService<{ register(m: unknown): unknown }>('manifest');
            // The identity objects the security plugin's store reads.
            await manifest.register({ id: 'test.reload.identity', name: 'Identity', version: '1.0.0', type: 'plugin', objects: [SysUser, SysMember, SysOrganization] });
            await manifest.register(crmPackage);
            // The recorder: it only listens, and reads the registry as the announcement arrives.
            ctx.hook('metadata:reloaded', async (payload?: unknown) => {
                const changed = (payload as { changed?: unknown } | undefined)?.changed;
                const registry = ctx.getService<ObjectQL>('objectql').registry;
                const held: Record<string, boolean> = {};
                const off: Record<string, boolean> = {};
                if (Array.isArray(changed)) {
                    for (const entry of changed) {
                        if (typeof entry !== 'string' || !entry.startsWith('app/')) continue;
                        held[entry] = registry.getPackage(entry.slice(4)) != null;
                        if (held[entry]) off[entry] = registry.isPackageDisabled(entry.slice(4));
                    }
                }
                heard.push({ changed, held, off });
            });
        },
    } as Plugin);
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    dispatcher = new HttpDispatcher(kernel as any);
}, 60_000);

afterAll(async () => {
    await Promise.race([kernel?.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

const registry = () => (ql as any).registry;

async function seed(rows: Array<Record<string, unknown>>): Promise<void> {
    for (const row of rows) await ql.insert('sys_user_position', row, { context: SYSTEM_CTX });
}

async function positionsOf(ids: readonly string[]): Promise<Record<string, unknown>> {
    const rows = (await ql.find('sys_user_position', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return Object.fromEntries(rows.filter((r) => ids.includes(String(r.id))).map((r) => [String(r.id), r.position]));
}

/** What the recorder heard from the call `act` makes, and nothing heard before it. */
async function heardDuring<T>(act: () => Promise<T>): Promise<{ result: T; heard: Heard[] }> {
    const from = heard.length;
    const result = await act();
    return { result, heard: heard.slice(from) };
}

describe('[#33302] the enable door announces a package it puts back into service', () => {
    it('a disabled package renaming a position, enabled through `PATCH /packages/:id/enable`: its holder holds the new name at once; the CONTROL is untouched', async () => {
        // Seeded after the boot run, so only a run after this enable can move them.
        await seed([holder('e1', 'u1', 'sales_rep', 'org_a'), holder('e2', 'u2', 'crm_auditor', 'org_a')]);
        registry().disablePackage(CRM);
        expect(registry().isPackageDisabled(CRM)).toBe(true);

        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${CRM}/enable`, 'PATCH', {}, {}, PKG_ADMIN()));

        expect(result.response?.status).toBe(200);
        expect(registry().isPackageDisabled(CRM)).toBe(false);
        // ⭐ What it is for: plugin-security's carry heard the announcement and
        // moved the holder, with no restart.
        expect(await positionsOf(['e1', 'e2'])).toEqual({ e1: 'crm_sales_rep', e2: 'crm_auditor' });
        // ⭐ The announcement, in the install-local door's spelling, with the
        // package already registered (and enabled) when the subscribers hear it.
        expect(during).toEqual([{ changed: [`app/${CRM}`], held: { [`app/${CRM}`]: true }, off: { [`app/${CRM}`]: false } }]);
    }, 60_000);

    it('an enable of a package that is already enabled changes nothing served, and announces nothing', async () => {
        expect(registry().isPackageDisabled(CRM)).toBe(false);
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${CRM}/enable`, 'PATCH', {}, {}, PKG_ADMIN()));
        expect(result.response?.status).toBe(200);
        expect(during).toEqual([]);
    }, 60_000);
});

describe('[#33302] the install door announces the package it installs', () => {
    it('a fresh install announces `app/ID` once, after the package is registered', async () => {
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages('', 'POST', { manifest: freshManifest }, {}, PKG_ADMIN()));

        expect(result.response?.status).toBe(201);
        expect(during).toEqual([{ changed: [`app/${FRESH}`], held: { [`app/${FRESH}`]: true }, off: { [`app/${FRESH}`]: false } }]);
    }, 60_000);

    it('an overwrite install with `enableOnInstall: true` of a disabled package renaming a position: its holder holds the new name at once', async () => {
        const created = await dispatcher.handlePackages('', 'POST', { manifest: authoredManifest }, {}, PKG_ADMIN());
        expect(created.response?.status).toBe(201);
        // What a publish of the package's position registers (the package id stamped on the item).
        registry().registerItem('position', { name: 'authored_sales_rep', label: 'Sales rep', renamedFrom: ['field_rep'] }, 'name', AUTHORED);
        const disabled = await dispatcher.handlePackages(`/${AUTHORED}/disable`, 'PATCH', {}, {}, PKG_ADMIN());
        expect(disabled.response?.status).toBe(200);
        await seed([holder('i1', 'u3', 'field_rep', 'org_a')]);

        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages('', 'POST', { manifest: authoredManifest, overwrite: true, enableOnInstall: true }, {}, PKG_ADMIN()));

        expect(result.response?.status).toBe(201);
        expect(result.response?.body?.data?.enabled).toBe(true);
        expect(await positionsOf(['i1'])).toEqual({ i1: 'authored_sales_rep' });
        expect(during).toEqual([{ changed: [`app/${AUTHORED}`], held: { [`app/${AUTHORED}`]: true }, off: { [`app/${AUTHORED}`]: false } }]);
    }, 60_000);
});

describe('[#33302] a failed announce never fails the door', () => {
    it('a subscriber that throws: the install still answers 201, and the failure is said once at warn', async () => {
        const id = 'com.acme.reloadthrows';
        const trigger = vi.spyOn((kernel as any).context, 'trigger').mockRejectedValueOnce(new Error('subscriber exploded'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const result = await dispatcher.handlePackages('', 'POST', { manifest: { id, name: 'Throws', version: '1.0.0', type: 'app', namespace: 'reloadthrows' } }, {}, PKG_ADMIN());
            expect(result.response?.status).toBe(201);
            expect(registry().getPackage(id)).toBeDefined();
            expect(trigger).toHaveBeenCalledWith('metadata:reloaded', { changed: [`app/${id}`] });
            const said = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('metadata:reloaded'));
            expect(said).toHaveLength(1);
            expect(said[0]).toContain(`'${id}'`);
        } finally {
            trigger.mockRestore();
            warn.mockRestore();
        }
    }, 60_000);
});

/**
 * [#33527] The two doors that take a package OUT of service announce the
 * withdrawal in the same spelling, so a subscriber that bound the package's
 * items re-reads a registry that serves them no more. Measured before, on a
 * kernel carrying the real automation engine and record-change trigger: a
 * disabled package's record-triggered flow stayed bound and ran on every
 * matching write until a restart, and an uninstalled one ran on the first
 * write after the door answered (its withdrawal rode only on the asynchronous
 * mutation sync of its deleted rows).
 */
describe('[#33527] the disable and uninstall doors announce the package they withdraw', () => {
    const install = async (id: string) => {
        const created = await dispatcher.handlePackages('', 'POST', { manifest: { id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } }, {}, PKG_ADMIN());
        expect(created.response?.status).toBe(201);
    };

    it('a disable of an enabled package announces `app/ID` once, after the registry switched it off', async () => {
        const id = 'com.acme.withdrawdisable';
        await install(id);
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${id}/disable`, 'PATCH', {}, {}, PKG_ADMIN()));

        expect(result.response?.status).toBe(200);
        // The subscribers hear it with the package still installed, and disabled.
        expect(during).toEqual([{ changed: [`app/${id}`], held: { [`app/${id}`]: true }, off: { [`app/${id}`]: true } }]);
    }, 60_000);

    it('a disable of a package already disabled changes nothing served, and announces nothing', async () => {
        const id = 'com.acme.withdrawdisable';
        expect(registry().isPackageDisabled(id)).toBe(true);
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${id}/disable`, 'PATCH', {}, {}, PKG_ADMIN()));
        expect(result.response?.status).toBe(200);
        expect(during).toEqual([]);
    }, 60_000);

    it('an uninstall announces `app/ID` once, after the registry withdrew the package', async () => {
        const id = 'com.acme.withdrawdelete';
        await install(id);
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages(`/${id}`, 'DELETE', undefined, {}, PKG_ADMIN()));

        expect(result.response?.status).toBe(200);
        expect(during).toEqual([{ changed: [`app/${id}`], held: { [`app/${id}`]: false }, off: {} }]);
    }, 60_000);

    it('an uninstall of a package the registry does not hold withdraws nothing, and announces nothing', async () => {
        const { result, heard: during } = await heardDuring(() =>
            dispatcher.handlePackages('/com.acme.withdrawnever', 'DELETE', undefined, {}, PKG_ADMIN()));
        expect(result.response?.status).toBe(404);
        expect(during).toEqual([]);
    }, 60_000);

    it('a subscriber that throws: the disable and the uninstall still answer 200, and each failure is said once at warn', async () => {
        for (const [id, door] of [['com.acme.withdrawthrowsoff', 'disable'], ['com.acme.withdrawthrowsdel', 'delete']] as const) {
            await install(id);
            const trigger = vi.spyOn((kernel as any).context, 'trigger').mockRejectedValueOnce(new Error('subscriber exploded'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                const result = door === 'disable'
                    ? await dispatcher.handlePackages(`/${id}/disable`, 'PATCH', {}, {}, PKG_ADMIN())
                    : await dispatcher.handlePackages(`/${id}`, 'DELETE', undefined, {}, PKG_ADMIN());
                expect(result.response?.status, door).toBe(200);
                expect(trigger, door).toHaveBeenCalledWith('metadata:reloaded', { changed: [`app/${id}`] });
                const said = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('metadata:reloaded'));
                expect(said, door).toHaveLength(1);
                expect(said[0], door).toContain(`'${id}'`);
            } finally {
                trigger.mockRestore();
                warn.mockRestore();
            }
        }
        expect(registry().isPackageDisabled('com.acme.withdrawthrowsoff')).toBe(true);
        expect(registry().getPackage('com.acme.withdrawthrowsdel')).toBeUndefined();
    }, 60_000);
});
