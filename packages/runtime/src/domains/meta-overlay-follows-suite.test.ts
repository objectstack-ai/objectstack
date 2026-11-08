// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31593] A tenant's edit of a packaged view follows the view when a later
 * version of the App moves it to another package of the same App (ADR-0130
 * D4: HotCRM's flat `app.objectstack.hotcrm` → its composed version, where
 * the module `app.objectstack.hotcrm.service` ships the view), and back on a
 * rollback.
 *
 * One SQLite file is the tenant database. Each `boot` is a fresh kernel over
 * it holding one version's packages, the way a version change replaces the
 * kernel: the real `ObjectQL` engine and SQL store, the real registry (its
 * installed manifests are the only record of which App a module belongs to,
 * read through `appOf`), and the real protocol. Nothing stubbed.
 *
 * The edit is stored the way the save door stores it: since ADR-0146 D11 a
 * save naming the read-only base is refused and prescribes the App's pair,
 * `app.objectstack.hotcrm.custom`, declaring `overrides: { package: <the
 * owner at the time>, basedOn }`. A row bound to the base itself is the shape
 * a Regime O save stored before that close (ADR-0126), laid down here as such
 * a release stored it.
 *
 * Each read of the item agrees: by name with no package (the read the
 * console makes), by name naming the owner, the list, and the layered read's
 * `effective`.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { appOf, installedManifestsOf } from '@objectstack/metadata-core';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
// The protocol's doors reach `import('@objectstack/metadata')`; pay that load
// during collection, never inside a clocked case (check:test-source-alias).
import '@objectstack/metadata';

const TEST_PACKAGE_ID = 'objectstack-test';
const APP = 'app.objectstack.hotcrm';
const MODULE = `${APP}.service`;
const PAIR = `${APP}.custom`;
/** An App of its own, installed beside HotCRM: never part of HotCRM's App. */
const PARTNER = 'com.partner.helpdesk';
const OBJ = 'x3677e_case';
const VIEW = `${OBJ}.default`;
const SHIPPED = 'All';
const EDITED = 'Open cases (ours)';

const caseObject = () => ({
    name: OBJ, label: 'Case', sharingModel: 'private',
    fields: { subject: { name: 'subject', label: 'Subject', type: 'text' } },
});
const listView = () => ({
    object: OBJ,
    list: { label: SHIPPED, type: 'grid', data: { provider: 'object', object: OBJ }, columns: [{ field: 'subject' }] },
});

/**
 * The packages each version installs. `flat`: the App ships the object and
 * the view. `composed`: the App ships neither, and its module, which declares
 * the App, ships both. `both`: the App and the module both ship the view (a
 * former owner that still ships it). `partner` adds an unrelated App.
 */
type Version = 'flat' | 'composed' | 'both';
function manifestsOf(version: Version, partner: boolean): Record<string, unknown>[] {
    const module = {
        id: MODULE, name: 'hotcrm-service', version: '6.2.0', type: 'module', namespace: 'x3677e',
        dependencies: { [APP]: '^6.2.0' }, objects: [caseObject()], views: [listView()],
    };
    const manifests: Record<string, unknown>[] = version === 'flat'
        ? [{ id: APP, name: 'hotcrm', version: '6.1.0', type: 'app', namespace: 'x3677e', objects: [caseObject()], views: [listView()] }]
        : version === 'composed'
            ? [{ id: APP, name: 'hotcrm', version: '6.2.0', type: 'app', namespace: 'x3677e' }, module]
            : [{ id: APP, name: 'hotcrm', version: '6.2.0', type: 'app', namespace: 'x3677e', views: [listView()] }, module];
    if (partner) manifests.push({ id: PARTNER, name: 'helpdesk', version: '2.0.0', type: 'app', namespace: 'helpdesk' });
    return manifests;
}

const dirs: string[] = [];
const live: ObjectQL[] = [];
async function stopLive() {
    while (live.length) {
        try { await live.pop()?.destroy(); } catch { /* noop */ }
    }
}
afterEach(async () => {
    await stopLive();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tenantDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'os-overlay-suite-'));
    dirs.push(dir);
    return join(dir, 'tenant.sqlite');
}

async function boot(file: string, version: Version, { partner = false } = {}) {
    await stopLive();
    const engine = new ObjectQL();
    live.push(engine);
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }), true);
    await engine.init();
    for (const o of [SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject]) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    for (const m of manifestsOf(version, partner)) engine.registerApp(m as any);
    await engine.syncSchemas();
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map(), 'env_hotcrm');
    // The App's pair, as the environment holds it across versions: the ensure
    // door answers the one pair of the App for any package of it.
    expect(((await protocol.ensureCustomizationPackage({ basePackageId: APP })) as any).packageId).toBe(PAIR);

    const label = async (packageId?: string) => {
        const r: any = await protocol.getMetaItem({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) });
        return (r?.item ?? r)?.label;
    };
    const listed = async () => {
        const r: any = await protocol.getMetaItems({ type: 'view' });
        const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
        return items.filter((i) => i?.name === VIEW).map((i) => [i._packageId ?? null, i.label]);
    };
    const layered = async () => ((await protocol.getMetaItemLayered({ type: 'view', name: VIEW })) as any)?.effective?.label;
    /** Every read of the view. */
    const served = async (owner: string) => ({
        bare: await label(), owner: await label(owner), list: await listed(), layered: await layered(),
    });
    const rows = async () => ((await engine.find('sys_metadata', {
        where: { type: 'view', name: VIEW }, context: { isSystem: true },
    } as any)) as any[]).map((r) => [r.package_id ?? null, r.state]);
    /** A row laid down through the engine, as an earlier release or a pre-gate write stored it. */
    const layRow = async (type: string, name: string, packageId: string, body: Record<string, unknown>) => engine.insert('sys_metadata', {
        type, name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
        metadata: JSON.stringify(body),
    }, { context: { isSystem: true } } as any);
    return { engine, protocol, label, served, rows, layRow, installed: installedManifestsOf(engine.registry as any) };
}
type Session = Awaited<ReturnType<typeof boot>>;

/** The view as `owner` ships it, its label edited: the body a tenant saves. */
async function editedView(s: Session, owner: string): Promise<Record<string, unknown>> {
    const r: any = await s.protocol.getMetaItem({ type: 'view', name: VIEW, packageId: owner });
    const item: Record<string, unknown> = { ...(r?.item ?? r), label: EDITED };
    for (const k of Object.keys(item)) if (k.startsWith('_')) delete item[k];
    return item;
}
/** The tenant's edit as the save door stores it: into the App's pair, declaring the owner. */
async function editInPair(s: Session, owner: string, basedOn: string) {
    await s.protocol.saveMetaItem({
        type: 'view', name: VIEW, packageId: PAIR, item: { ...(await editedView(s, owner)), overrides: { package: owner, basedOn } },
    });
}
const servedAs = (owner: string, label: string) => ({ bare: label, owner: label, list: [[owner, label]], layered: label });

describe('[#31593] a tenant\'s edit follows its view across the packages of one App', () => {
    it('flat → composed: the edit saved under the App is served at the module that ships the view now', async () => {
        const db = tenantDb();
        const flat = await boot(db, 'flat');
        await editInPair(flat, APP, '6.1.0');
        expect(await flat.rows()).toEqual([[PAIR, 'active']]);
        // CONTROL: the edit at its own package, as before.
        expect(await flat.served(APP)).toEqual(servedAs(APP, EDITED));

        const composed = await boot(db, 'composed');
        // The install record names the module's App; nothing was rewritten.
        expect(appOf(MODULE, composed.installed)).toBe(APP);
        expect(await composed.rows()).toEqual([[PAIR, 'active']]);
        expect(await composed.served(MODULE)).toEqual(servedAs(MODULE, EDITED));
    }, 60_000);

    it('composed → flat (rollback): the edit saved under the module is served at the App, though the module is gone', async () => {
        const db = tenantDb();
        const composed = await boot(db, 'composed');
        await editInPair(composed, MODULE, '6.2.0');
        expect(await composed.served(MODULE)).toEqual(servedAs(MODULE, EDITED));

        const flat = await boot(db, 'flat');
        // No install record names the module any more: the row's binding to
        // the App's pair is the record.
        expect(flat.installed(MODULE)).toBeUndefined();
        expect(await flat.served(APP)).toEqual(servedAs(APP, EDITED));

        // …and the re-upgrade serves it again.
        const again = await boot(db, 'composed');
        expect(await again.served(MODULE)).toEqual(servedAs(MODULE, EDITED));
    }, 60_000);

    it('flat → composed: an edit bound to the App itself (a Regime O row from before the D11 close) follows too', async () => {
        const db = tenantDb();
        const flat = await boot(db, 'flat');
        await flat.layRow('view', VIEW, APP, await editedView(flat, APP));
        expect(await flat.served(APP)).toEqual(servedAs(APP, EDITED));

        const composed = await boot(db, 'composed');
        expect(await composed.rows()).toEqual([[APP, 'active']]);
        expect(await composed.served(MODULE)).toEqual(servedAs(MODULE, EDITED));
    }, 60_000);

    it('NEGATIVE: an edit bound to or declaring a package outside the App never applies to the module\'s view', async () => {
        const db = tenantDb();
        const flat = await boot(db, 'flat', { partner: true });
        const body = await editedView(flat, APP);
        // Below the gates, as no door of this version writes them: a row
        // bound to the partner App, the partner's pair declaring HotCRM's
        // App, and HotCRM's pair declaring the partner.
        await flat.layRow('view', VIEW, PARTNER, body);
        const composed = await boot(db, 'composed', { partner: true });
        expect(((await composed.protocol.ensureCustomizationPackage({ basePackageId: PARTNER })) as any).packageId).toBe(`${PARTNER}.custom`);
        expect(await composed.label(MODULE)).toBe(SHIPPED);

        await composed.layRow('view', VIEW, `${PARTNER}.custom`, { ...body, overrides: { package: APP, basedOn: '6.1.0' } });
        expect(await composed.label(MODULE)).toBe(SHIPPED);

        await composed.layRow('view', VIEW, PAIR, { ...body, overrides: { package: PARTNER, basedOn: '2.0.0' } });
        expect(await composed.label(MODULE)).toBe(SHIPPED);
    }, 60_000);

    it('CONTROL: a former owner that still ships the view keeps its edit; the module serves its own view', async () => {
        const db = tenantDb();
        const flat = await boot(db, 'flat');
        await editInPair(flat, APP, '6.1.0');
        const both = await boot(db, 'both');
        expect({ app: await both.label(APP), module: await both.label(MODULE) }).toEqual({ app: EDITED, module: SHIPPED });
    }, 60_000);

    it('CONTROL: an object still takes no tenant overlay, and a stored object row never follows', async () => {
        const db = tenantDb();
        const composed = await boot(db, 'composed');
        const refused = await composed.protocol.saveMetaItem({
            type: 'object', name: OBJ, packageId: MODULE, item: { ...caseObject(), label: 'Ticket' },
        }).then(() => undefined, (e: any) => e);
        expect(refused?.code).toBe('ITEM_LOCKED');

        await composed.layRow('object', OBJ, APP, { ...caseObject(), label: 'Ticket' });
        const r: any = await composed.protocol.getMetaItem({ type: 'object', name: OBJ, packageId: MODULE });
        expect((r?.item ?? r)?.label).toBe('Case');
    }, 60_000);
});
