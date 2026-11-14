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
import { runAuthoringRules } from '@objectstack/lint';
import { HttpDispatcher } from '../http-dispatcher.js';
// The [#29594] rehearsal boots the real dispatcher, whose package door reaches
// `import('@objectstack/metadata')` in standalone-stack.ts; pay that load
// during collection, never inside a clocked case (check:test-source-alias).
import '@objectstack/metadata';

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

const baseManifest = (extraObjects: readonly Record<string, unknown>[] = []) => ({
    id: BASE,
    name: 'crm',
    version: '3.4.1',
    type: 'app',
    namespace: 'crm',
    objects: [{
        name: TARGET,
        label: 'Account',
        fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    }, ...extraObjects],
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

async function freshEngine(extraObjects: readonly Record<string, unknown>[] = []): Promise<ObjectQL> {
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
    engine.registerApp(baseManifest(extraObjects));
    await engine.syncSchemas();
    return engine;
}

async function boot(extraObjects: readonly Record<string, unknown>[] = []) {
    const engine = await freshEngine(extraObjects);
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
        // [#33154] `record.`-scoped, as a rule declared on the account must be:
        // the door now judges an extension's rules by the object's own rule
        // pass, which refuses the bare `region__c` this fixture used to carry.
        const rule = { name: 'region_required', type: 'script', condition: 'record.region__c == null', message: 'Region is required', events: ['insert'] };
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

describe('[#33072] the publish door judges an extension field\'s formula as `os build` does', () => {
    /** Studio's add-field body for a computed field on the account. */
    const scoreBody = (expression: string) => ({
        extend: TARGET,
        fields: { score__c: { type: 'formula', label: 'Score', expression } },
    });
    const WHERE = "object 'crm_account' · objectExtensions[0] · field 'score__c' expression";

    it('⭐ LIT — a formula calling an unregistered function is refused with the build\'s rule id and location; the field is not served', async () => {
        const rig = await boot();
        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: scoreBody('sqrt(record.name)'), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);

        expect(err, 'the publish was admitted').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue, JSON.stringify(err.issues)).toBeDefined();
        expect({ where: issue.where, path: issue.path }).toEqual({ where: WHERE, path: WHERE });
        expect((await rig.fieldsOn()).registry).not.toContain('score__c');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'draft' }]);
    }, 60_000);

    it('⭐ LIT — a formula reading a field the account does not serve is refused, judged against the extended object', async () => {
        const rig = await boot();
        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: scoreBody("record.nmae + '!'"), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue?.where, JSON.stringify(err.issues)).toBe(WHERE);
        expect(issue.message).toContain('nmae');
    }, 60_000);

    it('⭐ CONTROL — a valid formula over the account\'s own field publishes and is served', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, scoreBody("record.name + '!'"));

        expect((await rig.fieldsOn()).registry).toContain('score__c');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'active' }]);
    }, 60_000);

    // [#33072 r1] A REPUBLISH replaces the package's stored extension, so the
    // target is judged without it: the written body is the package's whole
    // extension, exactly as `os build` sees its one `objectExtensions` entry.
    // Judging against the target as served BEFORE the write read the stored
    // self as well, which erred both ways — the two pins below.
    const totalBody = (fields: Record<string, unknown> = {}, extend = TARGET) => ({
        extend,
        fields: { ...fields, total__c: { type: 'formula', label: 'Total', expression: 'record.bonus__c + 1' } },
    });
    const BONUS = { bonus__c: { type: 'number', label: 'Bonus' } };

    it('⭐ LIT (republish, lenient direction) — dropping a field the extension\'s own formula still reads is refused', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, totalBody(BONUS));
        expect((await rig.fieldsOn()).registry).toEqual(expect.arrayContaining(['bonus__c', 'total__c']));

        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: totalBody(), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }, 'the stored self still lent bonus__c').toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue?.where, JSON.stringify(err.issues))
            .toBe("object 'crm_account' · objectExtensions[0] · field 'total__c' expression");
        expect(issue.message).toContain('bonus__c');
        // The served extension is the one published before, untouched.
        expect((await rig.fieldsOn()).registry).toContain('bonus__c');
    }, 60_000);

    it('⭐ LIT (republish, strict direction) — re-targeting the extension\'s own lookup is judged over its new target', async () => {
        const region = { name: 'crm_region', label: 'Region', fields: { code: { name: 'code', label: 'Code', type: 'text' } } };
        const rig = await boot([region]);
        await rig.saveAndPublish(PAIR, {
            extend: TARGET,
            fields: { ref__c: { type: 'lookup', label: 'Ref', reference: 'crm_region' } },
        });

        const out = await rig.saveAndPublish(PAIR, {
            extend: TARGET,
            fields: {
                ref__c: { type: 'lookup', label: 'Ref', reference: TARGET },
                via__c: { type: 'formula', label: 'Via', expression: 'record.ref__c.name' },
            },
        }).catch((e: any) => e);

        expect(out, JSON.stringify((out as any)?.issues ?? out?.message)).not.toBeInstanceOf(Error);
        expect((await rig.fieldsOn()).registry).toContain('via__c');
    }, 60_000);

    it('⭐ LIT (republish, target with a stored object row) — the stored fold leaves the written package\'s extension out too', async () => {
        const rig = await boot();
        const LEAD = 'crm_custom_lead';
        await rig.protocol.saveMetaItem({
            type: 'object', name: LEAD, mode: 'draft', packageId: PAIR,
            item: { name: LEAD, label: 'Lead', sharingModel: 'private', fields: { title: { name: 'title', label: 'Title', type: 'text' } } },
        });
        await rig.protocol.publishMetaItem({ type: 'object', name: LEAD, packageId: PAIR });
        await rig.saveAndPublish(PAIR, totalBody(BONUS, LEAD), LEAD);

        await rig.protocol.saveMetaItem({ type: TYPE, name: LEAD, item: totalBody({}, LEAD), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: LEAD, packageId: PAIR }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }, 'the stored row\'s fold still lent bonus__c').toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue?.where, JSON.stringify(err.issues))
            .toBe(`object '${LEAD}' · objectExtensions[0] · field 'total__c' expression`);
    }, 60_000);
});

describe('[#33152] a package-wide publish judges each draft with the batch\'s own extension drafts folded onto their targets', () => {
    // The card's measured shape: the pair drafts an extension of the region
    // that adds `tier__c`, and a draft whose formula reads `tier__c` across a
    // lookup to the region. `os build` accepts the package; the batch door
    // read the region as served live (without `tier__c`), refused `unknown
    // field`, and rolled every draft back. Publishing the region's extension
    // first through the per-item door worked.
    const region = { name: 'crm_region', label: 'Region', fields: { code: { name: 'code', label: 'Code', type: 'text' } } };
    /** A base object with a lookup to the region, which the pair extends. */
    const SITE = 'crm_site';
    const site = {
        name: SITE,
        label: 'Site',
        fields: {
            name: { name: 'name', label: 'Name', type: 'text' },
            region: { name: 'region', label: 'Region', type: 'lookup', reference: 'crm_region' },
        },
    };
    const tierBody = (field = 'tier__c') => ({ extend: 'crm_region', fields: { [field]: { type: 'text', label: 'Tier' } } });
    /** The site's extension: a formula hopping across the base lookup into `tier__c`. */
    const siteBody = {
        extend: SITE,
        fields: { tier_label__c: { type: 'formula', label: 'Tier label', expression: "record.region.tier__c + '!'" } },
    };
    const draft = (p: any, type: string, name: string, item: unknown) =>
        p.saveMetaItem({ type, name, item, mode: 'draft', packageId: PAIR });
    const states = async (engine: ObjectQL) => ((await engine.find('sys_metadata', { where: { package_id: PAIR }, context: { isSystem: true } })) ?? [])
        .filter((r: any) => r.type !== 'package')
        .map((r: any) => `${r.type}/${r.name}:${r.state}`).sort();
    const fieldsOf = (engine: ObjectQL, name: string) => Object.keys((engine.registry.getObject(name) as any)?.fields ?? {});

    it('⭐ LIT — an extension draft whose formula hops into a field a sibling extension draft adds publishes in one batch', async () => {
        const rig = await boot([region, site]);
        await draft(rig.protocol, TYPE, 'crm_region', tierBody());
        await draft(rig.protocol, TYPE, SITE, siteBody);

        const res = await rig.protocol.publishPackageDrafts({ packageId: PAIR });

        expect(res.failed, JSON.stringify(res.failed)).toEqual([]);
        expect(res).toMatchObject({ success: true, outcome: 'published', publishedCount: 2 });
        expect(await states(rig.engine)).toEqual([`${TYPE}/crm_region:active`, `${TYPE}/${SITE}:active`]);
        expect(fieldsOf(rig.engine, 'crm_region')).toContain('tier__c');
        expect(fieldsOf(rig.engine, SITE)).toContain('tier_label__c');
    }, 60_000);

    it('⭐ LIT — an object draft whose formula hops into a field a sibling extension draft adds publishes in one batch', async () => {
        const rig = await boot([region]);
        const DEAL = 'crm_custom_deal';
        await draft(rig.protocol, TYPE, 'crm_region', tierBody());
        await draft(rig.protocol, 'object', DEAL, {
            name: DEAL, label: 'Deal', sharingModel: 'private',
            fields: {
                title: { name: 'title', label: 'Title', type: 'text' },
                region: { name: 'region', label: 'Region', type: 'lookup', reference: 'crm_region' },
                tier_label: { name: 'tier_label', label: 'Tier label', type: 'formula', expression: "record.region.tier__c + '!'" },
            },
        });

        const res = await rig.protocol.publishPackageDrafts({ packageId: PAIR });

        expect(res.failed, JSON.stringify(res.failed)).toEqual([]);
        expect(res).toMatchObject({ success: true, outcome: 'published', publishedCount: 2 });
        expect(await states(rig.engine)).toEqual([`object/${DEAL}:active`, `${TYPE}/crm_region:active`]);
    }, 60_000);

    it('⭐ CONTROL — a hop into a field no sibling adds is still refused, and the whole batch stays drafts', async () => {
        const rig = await boot([region, site]);
        // The sibling adds `tir__c`, not `tier__c`: the fold makes the batch's
        // own fields resolvable and nothing else.
        await draft(rig.protocol, TYPE, 'crm_region', tierBody('tir__c'));
        await draft(rig.protocol, TYPE, SITE, siteBody);

        const res = await rig.protocol.publishPackageDrafts({ packageId: PAIR });

        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0 });
        const causal = res.failed.find((f: any) => f.name === SITE);
        expect(causal?.code, JSON.stringify(res.failed)).toBe('INVALID_METADATA');
        expect(JSON.stringify(causal), 'the refusal does not name the missing field').toContain('tier__c');
        expect(await states(rig.engine)).toEqual([`${TYPE}/crm_region:draft`, `${TYPE}/${SITE}:draft`]);
        expect(fieldsOf(rig.engine, 'crm_region')).not.toContain('tir__c');
    }, 60_000);
});

describe('[#33154] the publish door judges an extension\'s validation rule as `os build` does', () => {
    /** Studio's body for an extension adding one validation rule (and fields) to the account. */
    const ruleBody = (condition: string, fields: Record<string, unknown> = {}) => ({
        extend: TARGET,
        fields,
        validations: [{ name: 'no_blocked__c', type: 'script', condition, message: 'Blocked.' }],
    });
    const WHERE = "object 'crm_account' · objectExtensions[0] · validation 'no_blocked__c'";
    const servedRules = (rig: Awaited<ReturnType<typeof boot>>) =>
        ((rig.engine.registry.getObject(TARGET) as any)?.validations ?? []).map((r: any) => r?.name);

    it('⭐ LIT — a rule reading a field the account does not serve is refused with the build\'s rule id and location; the rule is not served', async () => {
        const rig = await boot();
        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: ruleBody("record.nmae == 'blocked'"), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);

        expect(err, 'the publish was admitted').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue, JSON.stringify(err.issues)).toBeDefined();
        expect({ where: issue.where, path: issue.path })
            .toEqual({ where: WHERE, path: 'objectExtensions[0].validations[0].condition' });
        expect(issue.message).toContain('nmae');
        expect(servedRules(rig)).not.toContain('no_blocked__c');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'draft' }]);
    }, 60_000);

    it('⭐ CONTROL — a valid rule over the account\'s own field publishes and is served on the account', async () => {
        const rig = await boot();
        await rig.saveAndPublish(PAIR, ruleBody("record.name != null && record.name == 'blocked'"));

        expect(servedRules(rig)).toContain('no_blocked__c');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'active' }]);
    }, 60_000);

    it('⭐ PARITY — an unguarded ordering over the injected `created_at` publishes at the door, as `os build` accepts the same entry; one over a declared nullable field is refused at both', async () => {
        /** `os build`'s findings at the extension, over the account as authored. */
        const atBuild = (item: unknown) => {
            const stack = { objects: baseManifest().objects, objectExtensions: [item] };
            return runAuthoringRules('build', { normalized: stack, parsed: stack } as any)
                .filter((f) => f.where.includes('objectExtensions'))
                .map((f) => ({ rule: f.rule, where: f.where, path: f.path }));
        };
        const since = ruleBody("record.created_at > timestamp('2020-01-01T00:00:00Z')");
        expect(atBuild(since)).toEqual([]);

        const rig = await boot();
        // Served, the account declares the columns the registry injects.
        expect((await rig.fieldsOn()).registry).toContain('created_at');
        await rig.saveAndPublish(PAIR, since);
        expect(servedRules(rig)).toContain('no_blocked__c');
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: PAIR, state: 'active' }]);

        // The null-guard gate still judges a field the account declares nullable.
        const unguarded = ruleBody('record.bonus__c > 100', { bonus__c: { type: 'number', label: 'Bonus' } });
        const refusedAtBuild = atBuild(unguarded);
        expect(refusedAtBuild).toHaveLength(1);
        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: unguarded, mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect((err.issues ?? []).map((i: any) => ({ rule: i.rule, where: i.where, path: i.path }))).toEqual(refusedAtBuild);
    }, 60_000);

    it('⭐ LIT (republish) — dropping a field the extension\'s own rule still reads is refused: the stored self lends it nothing', async () => {
        const rig = await boot();
        const BONUS = { bonus__c: { type: 'number', label: 'Bonus' } };
        const condition = 'record.bonus__c != null && record.bonus__c > 100';
        await rig.saveAndPublish(PAIR, ruleBody(condition, BONUS));
        expect(servedRules(rig)).toContain('no_blocked__c');

        await rig.protocol.saveMetaItem({ type: TYPE, name: TARGET, item: ruleBody(condition), mode: 'draft', packageId: PAIR });
        const err: any = await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: PAIR }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }, 'the stored self still lent bonus__c').toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i: any) => i.rule === 'expression-invalid');
        expect(issue?.where, JSON.stringify(err.issues)).toBe(WHERE);
        expect(issue.message).toContain('bonus__c');
        // The served extension is the one published before, untouched.
        expect((await rig.fieldsOn()).registry).toContain('bonus__c');
    }, 60_000);
});

describe('[ADR-0146 D10] a module\'s extension that re-declares the base\'s field beyond its display properties', () => {
    /** A writable module package that depends on the base: the account is inside its closure. */
    const MODULE = 'com.acme.module';
    const bootWithModule = async () => {
        const rig = await boot();
        await rig.protocol.installPackage({
            manifest: { id: MODULE, name: 'module', version: '0.1.0', type: 'module', namespace: 'module', dependencies: { [BASE]: '^3' } },
        });
        return rig;
    };

    it('a type change is refused at the save door, VALIDATION_ERROR / 400 at `fields.name`, leaving no row', async () => {
        const rig = await bootWithModule();
        let caught: any;
        try {
            await rig.protocol.saveMetaItem({
                type: TYPE, name: TARGET, mode: 'draft', packageId: MODULE,
                item: { extend: TARGET, fields: { name: { type: 'textarea', label: 'Name' } } },
            });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'the save was admitted').toBeDefined();
        expect({ code: caught.code, status: caught.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect((caught.issues ?? []).map((i: any) => i.path)).toEqual(['fields.name']);
        expect(String(caught.message)).toContain('`fieldPatches`');
        expect(await rig.rows()).toEqual([]);
        expect(rig.extenders()).toEqual([]);
    }, 60_000);

    it('a draft stored before the rule is refused at publish, and stays a draft', async () => {
        const rig = await bootWithModule();
        await rig.engine.insert('sys_metadata', {
            type: TYPE, name: TARGET, package_id: MODULE, state: 'draft',
            metadata: JSON.stringify({ extend: TARGET, fields: { name: { type: 'textarea', label: 'Name' } } }),
        }, { context: { isSystem: true } });
        let caught: any;
        try {
            await rig.protocol.publishMetaItem({ type: TYPE, name: TARGET, packageId: MODULE });
        } catch (e) {
            caught = e;
        }
        expect(caught, 'the publish was admitted').toBeDefined();
        expect({ code: caught.code, status: caught.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: MODULE, state: 'draft' }]);
        expect(rig.extenders()).toEqual([]);
    }, 60_000);

    it('lit control: a display-only re-declaration saves and publishes', async () => {
        const rig = await bootWithModule();
        await rig.saveAndPublish(MODULE, { extend: TARGET, fields: { name: { name: 'name', type: 'text', label: 'Company name' } } });
        expect(await rig.rows()).toEqual([{ name: TARGET, package_id: MODULE, state: 'active' }]);
        expect(rig.extenders()).toEqual([MODULE]);
    }, 60_000);
});

/**
 * [ruling record 6691022506, ADR-0146 D3 as amended] The HotCRM rehearsal, on
 * an in-repo fixture of HotCRM's shape (the HotCRM repository is not part of
 * this tree): the App `app.objectstack.hotcrm` and three modules that declare
 * it, all `namespace: 'crm'`, all held as code. The ensure door is asked for
 * each — one `app.objectstack.hotcrm.custom` — and a MODULE's object is then
 * extended in that pair and read back on every object read.
 */
describe('[#29594] the App unit: HotCRM and three modules share one pair, and a module object is customized in it', () => {
    const APP = 'app.objectstack.hotcrm';
    const APP_PAIR = `${APP}.custom`;
    const MODULES = ['service', 'revenue', 'marketing'] as const;
    const CASE = 'crm_service_case';
    const ADMIN_CTX: any = {
        request: {},
        environmentId: 'hotcrm-app-unit',
        executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    };

    async function hotcrm() {
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
        engine.registerApp({
            id: APP, name: 'hotcrm', version: '6.1.0', type: 'app', namespace: 'crm',
            objects: [{ name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } }],
        });
        for (const m of MODULES) {
            engine.registerApp({
                id: `${APP}.${m}`, name: `hotcrm-${m}`, version: '6.1.0', type: 'module', namespace: 'crm',
                dependencies: { [APP]: '^6.1.0' },
                objects: [{ name: `crm_${m}_case`, label: `${m} case`, fields: { subject: { name: 'subject', label: 'Subject', type: 'text' } } }],
            });
        }
        await engine.syncSchemas();
        const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());
        const named: Record<string, unknown> = { protocol, objectql: engine };
        const get = (name: string) => named[name] ?? null;
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
        const dispatcher = new HttpDispatcher(kernel);
        const ensure = (id: string) =>
            dispatcher.handlePackages(`/${encodeURIComponent(id)}/ensure-customization`, 'POST', undefined, {}, ADMIN_CTX) as Promise<any>;
        return { engine, protocol, ensure };
    }

    it('ensure on the App and each module answers one app.objectstack.hotcrm.custom; a module object extended there reads back', async () => {
        const { engine, protocol, ensure } = await hotcrm();
        const answers: Array<[string, number, string]> = [];
        for (const id of [APP, ...MODULES.map((m) => `${APP}.${m}`)]) {
            const r = await ensure(id);
            answers.push([id, r.response.status, r.response.body?.data?.packageId]);
        }
        expect(answers).toEqual([
            [APP, 201, APP_PAIR],
            [`${APP}.service`, 200, APP_PAIR],
            [`${APP}.revenue`, 200, APP_PAIR],
            [`${APP}.marketing`, 200, APP_PAIR],
        ]);
        const pairs = engine.registry.getAllPackages().map((p: any) => p.manifest?.id).filter((id: string) => id.endsWith('.custom'));
        expect(pairs).toEqual([APP_PAIR]);

        // Customize a MODULE's object in the App's pair: Studio's add-field body.
        await protocol.saveMetaItem({
            type: TYPE, name: CASE, mode: 'draft', packageId: APP_PAIR,
            item: { extend: CASE, fields: { sla_tier__c: { type: 'text', label: 'SLA tier' } } },
        });
        await protocol.publishMetaItem({ type: TYPE, name: CASE, packageId: APP_PAIR });

        const byName = (await protocol.getMetaItem({ type: 'object', name: CASE }))?.item;
        const layered = await protocol.getMetaItemLayered({ type: 'object', name: CASE });
        expect(Object.keys(byName?.fields ?? {})).toEqual(expect.arrayContaining(['subject', 'sla_tier__c']));
        expect(Object.keys(layered?.effective?.fields ?? {})).toContain('sla_tier__c');
        expect(Object.keys((engine.registry.getObject(CASE) as any)?.fields ?? {})).toContain('sla_tier__c');
        expect(engine.registry.getObjectContributors(CASE).filter((c: any) => c.ownership === 'extend').map((c: any) => c.packageId))
            .toEqual([APP_PAIR]);
        // A record stores a value in the field.
        const created: any = await engine.insert(CASE, { subject: 'Outage', sla_tier__c: 'gold', organization_id: 'org_1' }, { context: { isSystem: true } });
        const back: any = await engine.findOne(CASE, { where: { id: created.id }, context: { isSystem: true } });
        expect(back?.sla_tier__c).toBe('gold');
    }, 60_000);
});
