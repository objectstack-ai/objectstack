// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28574, ADR-0146 D10 / D2 / D3] An object extension is an authorable item
 * of a writable package: saved and published through the doors every item
 * uses, registered as the package's `'extend'` contributor of its target,
 * withdrawn when the row or the package goes, and exported as the package's
 * `objectExtensions`.
 *
 * The business case: an administrator adds "Region" to the vendor's Account.
 * The field is stored in `<base>.custom`, served on every read of the object,
 * stores values, travels with the pair's export and re-installs from it, and
 * leaves when the row or the pair does.
 *
 * ## The rig
 *
 * A REAL store and protocol (the rig of `automation-flow-clone-custom-package.test.ts`):
 * better-sqlite3 `:memory:` behind the real `ObjectQL` engine, the real
 * `sys_metadata*` objects, a real `ObjectStackProtocolImplementation` over its
 * `SchemaRegistry`, and the real package export door (`HttpDispatcher`). The
 * base is a code package registered through `registerApp` (the manifest
 * door), so its object has a packaged owner and its table is real. The pair
 * and the outside package are installed through the protocol's package door.
 *
 * Refusals assert the envelope (`code` + `status`) and that no row was left;
 * the closure and suffix refusals also name the key (`issues[].path`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { ObjectExtensionSchema } from '@objectstack/spec/data';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-object-extension-item-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const TEST_PACKAGE_ID = 'objectstack-test';
const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
/** A writable package that does not depend on the base: the account is outside its closure. */
const OTHER = 'com.acme.other';
const TARGET = 'crm_account';
const TYPE = 'object_extension';

const baseManifest = () => ({
    id: BASE,
    name: 'crm',
    version: '3.4.1',
    type: 'app',
    namespace: 'crm',
    objects: [{
        name: TARGET,
        label: 'Account',
        fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    }],
});

/** Studio's add-field body: an extension in the pair, its field suffixed. */
const regionBody = (extra: Record<string, unknown> = {}) => ({
    extend: TARGET,
    fields: { region__c: { type: 'text', label: 'Region' } },
    ...extra,
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function freshEngine(): Promise<ObjectQL> {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerApp(baseManifest());
    await engine.syncSchemas();
    return engine;
}

async function boot() {
    const engine = await freshEngine();
    const protocol = new ObjectStackProtocolImplementation(engine as any, () => new Map());
    const p = protocol as any;
    await p.installPackage({
        manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [BASE]: '^3' } },
    });
    await p.installPackage({ manifest: { id: OTHER, name: 'other', version: '0.1.0', type: 'app', namespace: 'other' } });

    const named: Record<string, unknown> = { protocol, objectql: engine };
    const get = (name: string) => named[name] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
    const dispatcher = new HttpDispatcher(kernel);

    /** A draft save naming the package, then the per-item publish naming it. */
    const saveAndPublish = async (packageId: string, item: unknown, name = TARGET) => {
        await p.saveMetaItem({ type: TYPE, name, item, mode: 'draft', packageId });
        return p.publishMetaItem({ type: TYPE, name, packageId });
    };
    /** Every stored row of the type, read back from the store. */
    const rows = async () => ((await engine.find('sys_metadata', { where: { type: TYPE }, context: { isSystem: true } })) ?? [])
        .map((r: any) => ({ name: r.name, package_id: r.package_id ?? null, state: r.state }));
    /** The fields of the target on the three object reads and the registry. */
    const fieldsOn = async () => {
        const byName = (await p.getMetaItem({ type: 'object', name: TARGET }))?.item;
        const listed = ((await p.getMetaItems({ type: 'object' }))?.items ?? []).find((o: any) => o?.name === TARGET);
        const layered = await p.getMetaItemLayered({ type: 'object', name: TARGET });
        return {
            byName: Object.keys(byName?.fields ?? {}).sort(),
            listed: Object.keys(listed?.fields ?? {}).sort(),
            layered: Object.keys(layered?.effective?.fields ?? {}).sort(),
            registry: Object.keys((engine.registry.getObject(TARGET) as any)?.fields ?? {}).sort(),
        };
    };
    const extenders = () => engine.registry.getObjectContributors(TARGET)
        .filter((c: any) => c.ownership === 'extend').map((c: any) => c.packageId);
    const exportOf = async (id: string): Promise<Record<string, any>> => {
        const reader: any = {
            request: {},
            executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] },
        };
        const r = await dispatcher.handlePackages(`/${encodeURIComponent(id)}/export`, 'GET', undefined, {}, reader);
        expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(200);
        return r.response?.body?.data;
    };
    return { engine, protocol: p, saveAndPublish, rows, fieldsOn, extenders, exportOf };
}

const has = (list: string[]) => list.includes('region__c');

describe('[#28574] a writable pair saves and publishes an extension of the base\'s object', () => {
    it('the field is on the by-name, list and layered object reads, with the pair as its source', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());

        const seen = await rig.fieldsOn();
        expect(has(seen.byName), JSON.stringify(seen)).toBe(true);
        expect(has(seen.listed), JSON.stringify(seen)).toBe(true);
        expect(has(seen.layered), JSON.stringify(seen)).toBe(true);
        expect(has(seen.registry), JSON.stringify(seen)).toBe(true);
        expect(rig.extenders()).toEqual([PAIR]);
        // The base field stays where it is.
        expect(seen.byName).toContain('name');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'active' }]);
    }, 60_000);

    it('a draft is not live: the field appears only on publish', async () => {
        const rig = await boot();
        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: regionBody(), mode: 'draft', packageId: PAIR });
        expect(has((await rig.fieldsOn()).registry)).toBe(false);
        await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR });
        expect(has((await rig.fieldsOn()).registry)).toBe(true);
    }, 60_000);

    it('a record stores a value in the field (the target\'s table gains the column on publish)', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());

        const created: any = await rig.engine.insert(TARGET, { name: 'Acme', region__c: 'EMEA', organization_id: 'org_1' }, { context: { isSystem: true } });
        const back: any = await rig.engine.findOne(TARGET, { where: { id: created.id }, context: { isSystem: true } });
        expect(back?.region__c).toBe('EMEA');
    }, 60_000);

    it('the whole parsed body is registered: an extension\'s `validations` reach the object', async () => {
        const rig = await boot();
        const rule = { name: 'region_required', type: 'script', condition: 'region__c == null', message: 'Region is required', events: ['insert'] };
        await rig.saveAndPublish(PAIR, regionBody({ validations: [rule] }));

        const names = ((rig.engine.registry.getObject(TARGET) as any)?.validations ?? []).map((v: any) => v?.name);
        expect(names).toContain('region_required');
    }, 60_000);

    it('a boot re-reads the stored row and registers it the same way', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());
        // The registry forgets the contribution, as a fresh process would.
        (rig.engine.registry as any).withdrawObjectExtension?.(TARGET, PAIR);
        rig.engine.registry.unregisterObjectsByPackage(PAIR, true);
        expect(has((await rig.fieldsOn()).registry)).toBe(false);

        const result = await rig.protocol.loadMetaFromDb();
        expect(result.errors).toBe(0);
        expect(has((await rig.fieldsOn()).registry)).toBe(true);
        expect(rig.extenders()).toEqual([PAIR]);
    }, 60_000);
});

describe('[#28574] the pair\'s export carries the extension, and it re-installs', () => {
    it('`GET /packages/<pair>/export` carries the row as an `objectExtensions` entry that parses', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());

        const manifest = await rig.exportOf(PAIR);
        expect(manifest.objectExtensions, JSON.stringify(manifest)).toHaveLength(1);
        const [entry] = manifest.objectExtensions;
        expect(entry.extend).toBe(TARGET);
        expect(Object.keys(entry.fields)).toEqual(['region__c']);
        const reparsed = ObjectExtensionSchema.safeParse(entry);
        expect(reparsed.success, JSON.stringify(reparsed.error?.issues)).toBe(true);
    }, 60_000);

    it('the base\'s export is unchanged: it carries no extension', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());

        const manifest = await rig.exportOf(BASE);
        expect(manifest.objectExtensions).toBeUndefined();
    }, 60_000);

    it('re-installing the export into a fresh kernel registers the same field', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());
        const manifest = await rig.exportOf(PAIR);

        const fresh = await freshEngine();
        expect(Object.keys((fresh.registry.getObject(TARGET) as any)?.fields ?? {})).not.toContain('region__c');
        fresh.registerApp({ ...manifest, namespace: 'crm_custom', dependencies: { [BASE]: '^3' } });
        expect(Object.keys((fresh.registry.getObject(TARGET) as any)?.fields ?? {})).toContain('region__c');
        expect(fresh.registry.getObjectContributors(TARGET).filter((c: any) => c.ownership === 'extend').map((c: any) => c.packageId))
            .toEqual([PAIR]);
    }, 60_000);
});

describe('[#28574] withdrawal: deleting the row, or uninstalling the pair, removes the field from every read', () => {
    it('deleting the row', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());
        const before = await rig.fieldsOn();
        expect([before.byName, before.listed, before.layered, before.registry].every(has), JSON.stringify(before)).toBe(true);

        await rig.protocol.deleteMetaItem({ type: TYPE, name: TARGET, packageId: PAIR });

        const seen = await rig.fieldsOn();
        expect(has(seen.byName) || has(seen.listed) || has(seen.layered) || has(seen.registry), JSON.stringify(seen)).toBe(false);
        expect(seen.registry).toContain('name');
        expect(rig.extenders()).toEqual([]);
        expect(await rig.rows()).toEqual([]);
    }, 60_000);

    it('uninstalling the pair', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, regionBody());
        const before = await rig.fieldsOn();
        expect([before.byName, before.listed, before.layered, before.registry].every(has), JSON.stringify(before)).toBe(true);

        await rig.protocol.deletePackage({ packageId: PAIR });

        const seen = await rig.fieldsOn();
        expect(has(seen.byName) || has(seen.listed) || has(seen.layered) || has(seen.registry), JSON.stringify(seen)).toBe(false);
        expect(rig.extenders()).toEqual([]);
    }, 60_000);
});

describe('[#28574] refused at the door, leaving no row', () => {
    const refusals: Array<[string, string, Record<string, unknown>, string, number, string | undefined]> = [
        ['a target outside the package\'s closure', OTHER, { extend: TARGET, fields: { region: { type: 'text', label: 'Region' } } }, 'VALIDATION_ERROR', 400, 'extend'],
        ['an unknown target', PAIR, { extend: 'crm_nowhere', fields: { region__c: { type: 'text', label: 'Region' } } }, 'VALIDATION_ERROR', 400, 'extend'],
        ['a `.custom` field without `__c` (N-23b)', PAIR, { extend: TARGET, fields: { region: { type: 'text', label: 'Region' } } }, 'VALIDATION_ERROR', 400, 'fields.region'],
        ['`defaultRowScope` on the body', PAIR, regionBody({ defaultRowScope: 'owner' }), 'VALIDATION_ERROR', 400, 'defaultRowScope'],
        ['`membershipKeys` on the body', PAIR, regionBody({ membershipKeys: [] }), 'VALIDATION_ERROR', 400, 'membershipKeys'],
    ];

    it.each(refusals)('%s', async (_label, packageId, body, code, status, path) => {
        const rig = await boot();
        const name = typeof body.extend === 'string' ? body.extend : TARGET;
        let caught: any;
        try {
            await rig.protocol.saveMetaItem({ type: TYPE, name, item: body, mode: 'draft', packageId });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'the save was admitted').toBeDefined();
        expect({ code: caught.code, status: caught.status }).toEqual({ code, status });
        if (path !== undefined) expect((caught.issues ?? []).map((i: any) => i.path)).toContain(path);
        expect(await rig.rows()).toEqual([]);
        expect(rig.extenders()).toEqual([]);
    }, 60_000);

    it('a read-only package: the base itself', async () => {
        const rig = await boot();
        let caught: any;
        try {
            await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: regionBody(), mode: 'draft', packageId: BASE });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'the save was admitted').toBeDefined();
        expect(caught.status).toBeGreaterThanOrEqual(400);
        expect(caught.status).toBeLessThan(500);
        expect(await rig.rows()).toEqual([]);
    }, 60_000);

    it('a package-less write: an extension is an item of a package, so a save naming none is refused', async () => {
        const rig = await boot();
        let caught: any;
        try {
            await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: regionBody(), mode: 'draft' });
        } catch (e) {
            caught = e;
        }
        expect({ code: caught?.code, status: caught?.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect(String(caught?.message)).toContain('names none');
        expect(await rig.rows()).toEqual([]);
        expect(rig.extenders()).toEqual([]);
    }, 60_000);

    it('a row filed under a name other than its target', async () => {
        const rig = await boot();
        let caught: any;
        try {
            await rig.protocol.saveMetaItem({ type: TYPE, name: 'crm_contact', item: regionBody(), mode: 'draft', packageId: PAIR });
        } catch (e) {
            caught = e;
        }
        expect({ code: caught?.code, status: caught?.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect(await rig.rows()).toEqual([]);
    }, 60_000);

    it('the `excluded` override disposition does not close the type: the pair\'s save is admitted', async () => {
        const rig = await boot();
        await expect(rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: regionBody(), mode: 'draft', packageId: PAIR }))
            .resolves.toBeDefined();
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'draft' }]);
    }, 60_000);
});
