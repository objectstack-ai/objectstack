// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29898] The metadata save and publish doors refuse a select field bound to
 * a picklist no loaded package declares, and judge it against the REAL
 * `SchemaRegistry` — the read that serves the field's options.
 *
 * Measured on `origin/main` before this file: a runtime package's object with
 * `picklist: 'nope_list'` saved as a draft and published; the field was then
 * served with no options, and the record validator refused every value.
 *
 * The protocol-level pins (every door, the envelope, a draft stored before the
 * rule, the held-binding and healing-pass controls) live in
 * `packages/metadata-protocol/src/protocol.unknown-picklist-binding-refusal.test.ts`
 * over a registry double. What only a real registry answers is pinned here:
 * the refusal reads the registry's own `resolvePicklistOptions`, and a list
 * declared by any of these is NOT refused —
 *  - a dependency of the writing package (the base, declared in the runtime
 *    package's `dependencies`);
 *  - the base of a `.custom` pair, for an extension saved into the pair;
 *  - another package installed here that the writing package does not depend
 *    on.
 *
 * ## The rig
 *
 * The rig of `meta-object-extension-item.test.ts`, kept local: better-sqlite3
 * `:memory:` behind the real `ObjectQL` engine, the real `sys_metadata*`
 * objects and a real `ObjectStackProtocolImplementation` over its
 * `SchemaRegistry`. The base and the list package are code packages registered
 * through `registerApp`; the runtime package and the pair are installed through
 * the protocol's package door.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-picklist-binding-door-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const TEST_PACKAGE_ID = 'objectstack-test';
/** A code package: declares `crm_tier` and owns the account. */
const BASE = 'com.acme.crm';
/** The base's writable `.custom` pair. */
const PAIR = 'com.acme.crm.custom';
/** A code package installed here that declares `shared_region`; nothing depends on it. */
const LISTS = 'com.acme.lists';
/** A writable runtime package that depends on the base only. */
const APP = 'com.acme.deals';
const TARGET = 'crm_account';
const DEAL = 'deals_probe';

const baseManifest = () => ({
    id: BASE,
    name: 'crm',
    version: '3.4.1',
    type: 'app',
    namespace: 'crm',
    picklists: [{ name: 'crm_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] }],
    objects: [{
        name: TARGET,
        label: 'Account',
        fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    }],
});

const listsManifest = () => ({
    id: LISTS,
    name: 'lists',
    version: '1.0.0',
    type: 'module',
    namespace: 'lists',
    picklists: [{ name: 'shared_region', label: 'Region', options: [{ label: 'EMEA', value: 'emea' }] }],
});

/** A runtime package's object with one select field bound to `picklist`. */
const deal = (picklist: string) => ({
    name: DEAL,
    label: 'Deal',
    sharingModel: 'public_read_write',
    fields: {
        name: { type: 'text', label: 'Name' },
        tier: { type: 'select', label: 'Tier', picklist },
    },
});

/** Studio's add-field body in the pair: a select on the base's account bound to `picklist`. */
const tierExtension = (picklist: string) => ({
    extend: TARGET,
    fields: { tier__c: { type: 'select', label: 'Tier', picklist } },
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot() {
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
    engine.registerApp(listsManifest());
    await engine.syncSchemas();

    const p = new ObjectStackProtocolImplementation(engine as any, () => new Map()) as any;
    await p.installPackage({
        manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [BASE]: '^3' } },
    });
    await p.installPackage({
        manifest: { id: APP, name: 'deals', version: '0.1.0', type: 'app', namespace: 'deals', dependencies: { [BASE]: '^3' } },
    });

    /** A draft save naming the package, then the per-item publish naming it. */
    const saveAndPublish = async (type: string, name: string, packageId: string, item: unknown) => {
        await p.saveMetaItem({ type, name, item, mode: 'draft', packageId });
        return p.publishMetaItem({ type, name, packageId });
    };
    /** Every stored row of a type, read back from the store. */
    const rows = async (type: string) => ((await engine.find('sys_metadata', { where: { type }, context: { isSystem: true } })) ?? [])
        .map((r: any) => `${r.name}|${r.package_id ?? '-'}|${r.state}`);
    /** The options a field is served with, through the registry's fold. */
    const servedOptions = (object: string, field: string) =>
        ((engine.registry.getObject(object) as any)?.fields?.[field]?.options ?? []).map((o: any) => o?.value);
    return { engine, protocol: p, saveAndPublish, rows, servedOptions };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

const expectRefusal = (err: any, object: string, field: string, picklist: string) => {
    expect({ code: err?.code, status: err?.status }, String(err?.stack ?? err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(err.issues.map((i: any) => i.path)).toEqual([`fields.${field}.picklist`]);
    expect(String(err.issues[0].message).startsWith(
        `Field '${object}.${field}' is bound to picklist '${picklist}', which no loaded package declares`,
    ), err.issues[0].message).toBe(true);
};

describe('[#29898] the save door, over the real registry — a list no loaded package declares', () => {
    it('a runtime package\'s object draft is refused 422 naming the field and the list; nothing is stored', async () => {
        const rig = await boot();

        const err = await refusalOf(rig.protocol.saveMetaItem({
            type: 'object', name: DEAL, item: deal('nope_list'), mode: 'draft', packageId: APP,
        }));

        expectRefusal(err, DEAL, 'tier', 'nope_list');
        expect(await rig.rows('object')).toEqual([]);
    }, 60_000);

    it('an extension saved into the `.custom` pair is refused the same way', async () => {
        const rig = await boot();

        const err = await refusalOf(rig.protocol.saveMetaItem({
            type: 'object_extension', name: TARGET, item: tierExtension('nope_list'), mode: 'draft', packageId: PAIR,
        }));

        expectRefusal(err, TARGET, 'tier__c', 'nope_list');
        expect(await rig.rows('object_extension')).toEqual([]);
    }, 60_000);
});

describe('[#29898] controls over the real registry — a declared list is never refused', () => {
    it('a list a dependency declares: the runtime package\'s object saves, publishes and is served the list', async () => {
        const rig = await boot();

        const published = await rig.saveAndPublish('object', DEAL, APP, deal('crm_tier'));

        expect(published?.success, JSON.stringify(published)).toBe(true);
        expect(await rig.rows('object')).toEqual([`${DEAL}|${APP}|active`]);
        expect(rig.servedOptions(DEAL, 'tier')).toEqual(['gold']);
    }, 60_000);

    it('a list the base of a `.custom` pair declares: the pair\'s extension saves, publishes and is served the list', async () => {
        const rig = await boot();

        const published = await rig.saveAndPublish('object_extension', TARGET, PAIR, tierExtension('crm_tier'));

        expect(published?.success, JSON.stringify(published)).toBe(true);
        expect(await rig.rows('object_extension')).toEqual([`${TARGET}|${PAIR}|active`]);
        expect(rig.servedOptions(TARGET, 'tier__c')).toEqual(['gold']);
    }, 60_000);

    it('a list another installed package declares, which the writing package does not depend on', async () => {
        const rig = await boot();

        const published = await rig.saveAndPublish('object', DEAL, APP, deal('shared_region'));

        expect(published?.success, JSON.stringify(published)).toBe(true);
        expect(await rig.rows('object')).toEqual([`${DEAL}|${APP}|active`]);
        expect(rig.servedOptions(DEAL, 'tier')).toEqual(['emea']);
    }, 60_000);
});
