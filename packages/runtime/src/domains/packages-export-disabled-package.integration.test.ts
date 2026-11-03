// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29871] A disabled package exports its items. `PackageExportBundleSchema`
 * declares that every package is exported "enabled or not", and installs
 * enabled; a disable hides the package's items from the served reads and
 * leaves them stored. The export read them through the per-package layer,
 * which hid them too, so `GET /packages/:id/export` (and the bundle, its one
 * producer) answered the package with no items, and a re-install of that
 * entry came back as an empty package.
 *
 * Over the real door (`HttpDispatcher.handlePackages`), the real protocol and
 * the real `ObjectQL` engine on a SQLite file, for both places a disabled
 * package's items live:
 *
 *  - a runtime-authored package (installed through the protocol, an object and
 *    a dashboard published from drafts into `sys_metadata`), disabled through
 *    `PATCH /packages/:id/disable`: its export after the disable is
 *    byte-identical to its export before, and so is its bundle entry;
 *  - a registered package (`registerApp`: an object, a dashboard, a view
 *    container held by the registry), disabled in the registry: the same;
 *  - CONTROL, each: the served reads (`getMetaItems`) list the items while
 *    the package is enabled and hide them once it is disabled, so the
 *    export's answer is its own, not the served list's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { HttpDispatcher } from '../http-dispatcher.js';

const PLATFORM_PKG = 'com.objectstack.platform';
const AUTHORED = 'com.qa.w5off';
const AUTHORED_OBJECT = 'w5off_note';
const AUTHORED_DASHBOARD = 'w5off_pulse';
const REGISTERED = 'com.example.archive';
const REGISTERED_OBJECT = 'archive_case';
const REGISTERED_DASHBOARD = 'archive_pulse';

const CALLER: any = {
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
};

/** The registered package's body, as a `defineStack` carries it. */
function registeredBody(): Record<string, any> {
    return {
        id: REGISTERED,
        name: 'archive',
        version: '1.0.0',
        namespace: 'archive',
        objects: [{
            name: REGISTERED_OBJECT,
            label: 'Case',
            sharingModel: 'private',
            fields: { title: { name: 'title', label: 'Title', type: 'text' } },
        }],
        views: [{
            object: REGISTERED_OBJECT,
            list: { label: 'All Cases', type: 'grid', data: { provider: 'object', object: REGISTERED_OBJECT }, columns: [{ field: 'title' }] },
        }],
        dashboards: [{ name: REGISTERED_DASHBOARD, label: 'Archive Pulse', columns: 12, widgets: [] }],
    };
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanup.reverse()) await c();
    cleanup = [];
});

const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_METADATA_WRITABLE: process.env.OS_METADATA_WRITABLE };
let home: string;
beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-29871-home-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

async function boot() {
    const dir = mkdtempSync(join(tmpdir(), 'os-29871-db-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: join(dir, 'data.sqlite') },
        useNullAsDefault: true,
    });
    const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
    await driver.initObjects(objects);

    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
    cleanup.push(() => engine.destroy());

    const services = new Map<string, unknown>([['objectql', engine]]);
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => services as any);
    services.set('protocol', protocol);
    const get = (name: string) => services.get(name) ?? null;
    const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

    const answer = async (path: string, method: string, body?: unknown) => {
        const res = await dispatcher.handlePackages(path, method, body, {}, CALLER);
        return { status: res.response?.status, body: JSON.parse(JSON.stringify(res.response?.body ?? null)) };
    };
    return {
        engine,
        protocol,
        answer,
        async exported(id: string): Promise<Record<string, any>> {
            const res = await answer(`/${encodeURIComponent(id)}/export`, 'GET');
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            return res.body?.data ?? res.body;
        },
        async bundleEntry(id: string): Promise<Record<string, any> | undefined> {
            const res = await answer('/export', 'GET');
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            return (res.body?.data?.packages ?? []).find((p: any) => p?.id === id);
        },
        /** The names the served list read answers for `type`, across every package. */
        async served(type: string): Promise<string[]> {
            const res: any = await protocol.getMetaItems({ type });
            return (res?.items ?? []).map((it: any) => it?.name);
        },
    };
}

const namesOf = (manifest: Record<string, any>, plural: string): string[] =>
    (manifest[plural] ?? []).map((item: any) => item?.name ?? item?.object);

describe('[#29871] a disabled package exports its items', () => {
    it('a runtime-authored package disabled through the door: its export and bundle entry are unchanged', async () => {
        const door = await boot();
        await door.protocol.installPackage({
            manifest: { id: AUTHORED, name: 'W5 disabled', version: '0.1.0', type: 'app', namespace: 'w5off' },
        });
        const draft = async (type: string, name: string, item: Record<string, unknown>) => {
            const saved = await door.protocol.saveMetaItem({ type, name, item, mode: 'draft', packageId: AUTHORED });
            expect(saved?.success, `the ${type} draft save`).toBe(true);
        };
        await draft('object', AUTHORED_OBJECT, {
            name: AUTHORED_OBJECT, label: 'W5 Note', sharingModel: 'private', fields: { body: { type: 'text', label: 'Body' } },
        });
        await draft('dashboard', AUTHORED_DASHBOARD, { name: AUTHORED_DASHBOARD, label: 'W5 Pulse', columns: 12, widgets: [] });
        const published = await door.answer(`/${AUTHORED}/publish-drafts`, 'POST', {});
        expect(published.status, JSON.stringify(published.body)).toBe(200);

        const before = await door.exported(AUTHORED);
        expect(namesOf(before, 'objects')).toEqual([AUTHORED_OBJECT]);
        expect(namesOf(before, 'dashboards')).toEqual([AUTHORED_DASHBOARD]);
        // CONTROL: enabled, the served reads list both.
        expect(await door.served('object')).toContain(AUTHORED_OBJECT);
        expect(await door.served('dashboard')).toContain(AUTHORED_DASHBOARD);

        const disabled = await door.answer(`/${AUTHORED}/disable`, 'PATCH');
        expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
        // CONTROL: disabled, the served reads hide both, so what follows is the export's own answer.
        expect(await door.served('object')).not.toContain(AUTHORED_OBJECT);
        expect(await door.served('dashboard')).not.toContain(AUTHORED_DASHBOARD);

        expect(JSON.stringify(await door.exported(AUTHORED)), 'the disabled package\'s export').toBe(JSON.stringify(before));
        const entry = await door.bundleEntry(AUTHORED);
        expect(entry, 'the bundle lists the disabled package').toBeDefined();
        expect(JSON.stringify(entry), 'its bundle entry').toBe(JSON.stringify(before));
    });

    it('a registered package disabled in the registry: its export is unchanged', async () => {
        const door = await boot();
        door.engine.registerApp(registeredBody());

        const before = await door.exported(REGISTERED);
        expect(namesOf(before, 'objects')).toEqual([REGISTERED_OBJECT]);
        expect(namesOf(before, 'dashboards')).toEqual([REGISTERED_DASHBOARD]);
        expect(namesOf(before, 'views')).toEqual([REGISTERED_OBJECT]);
        expect(await door.served('dashboard')).toContain(REGISTERED_DASHBOARD);

        expect(door.engine.registry.disablePackage(REGISTERED)?.enabled).toBe(false);
        // CONTROL: the registry's served list hides the disabled package's dashboard.
        expect(await door.served('dashboard')).not.toContain(REGISTERED_DASHBOARD);
        expect(await door.served('object')).not.toContain(REGISTERED_OBJECT);

        expect(JSON.stringify(await door.exported(REGISTERED)), 'the disabled package\'s export').toBe(JSON.stringify(before));
    });
});
