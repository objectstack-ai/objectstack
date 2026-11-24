// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33401, review#2 on PR #33995] The doors beside the by-name read, for a
 * package-less row of a name whose every holder is disabled, on a real engine
 * over an in-memory store (the driver of `environment-overlay-email-locale-restart.test.ts`).
 *
 * The fixture: `com.acme.mail` ships `acme.welcome` in `en-US` and `zh-CN`,
 * and the environment stores a package-less row at `fr-FR`, a member the
 * package never shipped. With the package disabled the by-name read naming no
 * package withholds that row (seat ruling 6882483833 on #32814: it is the
 * holder's customization). Pinned here:
 *
 *  - S1: the list naming no package and the execution list leave it out too,
 *    whether the row was hydrated at boot or saved after it.
 *  - S3: a package-less save of that member while the package is disabled is
 *    refused 409 with the `?package=` remedy, naming no package, and stores
 *    no row (#34144 ruling A, #34262: a disabled package holds no name, so a
 *    save naming none has no row to write). Re-enabled, the same save is
 *    kept. A delete of the stored package-less row removes it while the
 *    package is disabled, as before. A save at a member the package ships is
 *    refused, as before.
 *  - S5: while an ENABLED package holds the name through a stored row the
 *    registry has not read, the row is served and listed as on `main`, in
 *    either read order.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'com.acme.mail';
const OTHER = 'com.acme.other';
const NAME = 'acme.welcome';
const template = (locale: string, subject: string): Record<string, unknown> => ({
    name: NAME, label: 'Welcome', locale, subject, bodyHtml: `<p>${subject}</p>`,
});

/** In-memory driver, copied from `environment-overlay-five-types.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Map<string, Map<string, Record<string, unknown>>>) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            // [#24371] The by-name read's both-spellings `type: { $in: [...] }`.
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
                if (!(v as any).$in.includes(rowVal === undefined ? null : rowVal)) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            // Unique across boots: a restart is a new driver over the same stores.
            const id = (data.id as string) ?? `r_${randomUUID()}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return driver;
}

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** One boot: engine, the package (and `OTHER`, which ships no template), protocol, then the boot hydration. */
async function boot(stores: Stores, withOther = false) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp({
        id: PKG, name: 'acme_mail', version: '1.0.0', namespace: 'acmemail',
        emailTemplates: [template('en-US', 'PKG en'), template('zh-CN', 'PKG zh')],
    });
    if (withOther) engine.registerApp({ id: OTHER, name: 'acme_other', version: '1.0.0', namespace: 'acmeother' });
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod');
    await protocol.loadMetaFromDb();
    return { engine, protocol };
}

/** A package-less row as a release before the #28576 close stored it, straight to the overlay store. */
async function seedPackagelessRow(protocol: ObjectStackProtocolImplementation, body: Record<string, unknown>) {
    await (protocol as any).getOverlayRepo().put({ type: 'email_template', name: NAME, org: 'env' }, body, {
        parentVersion: null, actor: null, source: 'older-release', intent: 'override-artifact', packageId: null,
    });
}

/** The subject the read naming no package serves at `member`, or `undefined` when it serves no item. */
const subjectAt = async (protocol: ObjectStackProtocolImplementation, member?: string) =>
    ((await protocol.getMetaItem({ type: 'email_template', name: NAME, ...(member ? { member } : {}) } as any)) as any)?.item?.subject as string | undefined;
/** `locale:subject` of every `acme.welcome` item the list and the execution list carry. */
const listed = async (protocol: ObjectStackProtocolImplementation) => {
    const pick = (res: any) => ((res?.items ?? []) as any[]).filter((i) => i?.name === NAME).map((i) => `${i.locale}:${i.subject}`).sort();
    return {
        list: pick(await protocol.getMetaItems({ type: 'email_template' })),
        execution: pick(await protocol.getMetaItemsForExecution({ type: 'email_template' })),
    };
};
const packagelessRows = (stores: Stores) => Array.from(stores.get('sys_metadata')?.values() ?? [])
    .filter((r) => r.name === NAME && r.state === 'active' && (r.package_id ?? null) === null)
    .map((r) => String(r.bundle_member ?? null));

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('[#33401, review#2 S1] the lists leave out the package-less row the by-name read withholds', () => {
    it.each([['saved after boot', false], ['hydrated at boot', true]] as const)('row %s: with the package disabled, neither list carries it, as neither carries any item of the name; re-enabled, both do', async (_when, hydrated) => {
        const stores: Stores = new Map();
        let { engine, protocol } = await boot(stores);
        await seedPackagelessRow(protocol, template('fr-FR', 'ENV fr'));
        if (hydrated) ({ engine, protocol } = await boot(stores));
        engine.registry.disablePackage(PKG);
        expect(await subjectAt(protocol, 'fr-FR')).toBeUndefined();
        // BASE: `fr-FR:ENV fr` on both lists.
        expect(await listed(protocol)).toEqual({ list: [], execution: [] });
        // CONTROL — re-enabled: the row is listed again, untouched.
        engine.registry.enablePackage(PKG);
        const all = ['en-US:PKG en', 'fr-FR:ENV fr', 'zh-CN:PKG zh'];
        expect(await listed(protocol)).toEqual({ list: all, execution: all });
        expect(await subjectAt(protocol, 'fr-FR')).toBe('ENV fr');
    });
});

describe('[#33401, review#2 S3] a package-less save and delete while every holder is disabled', () => {
    it('a save at a member the package never ships is refused naming no package and stores no row; re-enabled it is kept; a delete removes it; a save at a shipped member is refused, as before', async () => {
        const stores: Stores = new Map();
        const { engine, protocol } = await boot(stores);
        engine.registry.disablePackage(PKG);
        // FROM (#33995): accepted (`success: true, state: 'active'`), stored
        // package-less at `fr-FR`, hidden until the package is enabled again.
        // TO (#34144 ruling A, #34262): refused 409 with the `?package=`
        // remedy, naming no package, and no row is stored.
        const refused: any = await protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('fr-FR', 'SAVED fr') } as any)
            .then(() => undefined, (error: unknown) => error);
        expect([refused?.status, refused?.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(String(refused?.message)).toContain('?package=');
        expect(String(refused?.message)).not.toContain(PKG);
        expect(packagelessRows(stores)).toEqual([]);
        expect(await subjectAt(protocol, 'fr-FR')).toBeUndefined();
        expect(await listed(protocol)).toEqual({ list: [], execution: [] });
        // CONTROL — unchanged: a shipped member's save naming no package is refused.
        await expect(protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('en-US', 'SAVED en') } as any))
            .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        // CONTROL — re-enabled: the same save is accepted and kept.
        engine.registry.enablePackage(PKG);
        expect(await protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('fr-FR', 'SAVED fr') } as any))
            .toMatchObject({ success: true, state: 'active' });
        expect(packagelessRows(stores)).toEqual(['fr-FR']);
        expect(await subjectAt(protocol, 'fr-FR')).toBe('SAVED fr');
        // Unchanged: with the package disabled again, a delete naming no package removes the row.
        engine.registry.disablePackage(PKG);
        expect(await protocol.deleteMetaItem({ type: 'email_template', name: NAME, member: 'fr-FR' } as any))
            .toMatchObject({ success: true });
        expect(packagelessRows(stores)).toEqual([]);
        engine.registry.enablePackage(PKG);
        expect(await subjectAt(protocol, 'fr-FR')).toBeUndefined();
    });
});

describe('[#33401, review#2 S5] an enabled package holding the name through an unhydrated stored row keeps main\'s answers', () => {
    it.each([['the by-name read first', false], ['the list first', true]] as const)('%s: the package-less row is served and listed; `_env` still refuses, marked', async (_order, listFirst) => {
        const stores: Stores = new Map();
        const { engine, protocol } = await boot(stores, true);
        await seedPackagelessRow(protocol, template('fr-FR', 'ENV fr'));
        // `OTHER` holds the name only through this row, which the registry has not read.
        stores.get('sys_metadata')!.set('row_other', {
            id: 'row_other', type: 'email_template', name: NAME, state: 'active', package_id: OTHER, bundle_member: null,
            metadata: JSON.stringify(template('en-US', 'OTHER en')), organization_id: null, environment_id: null,
        });
        engine.registry.disablePackage(PKG);
        const lists = { list: ['fr-FR:ENV fr'], execution: ['fr-FR:ENV fr'] };
        if (listFirst) expect(await listed(protocol)).toEqual(lists);
        expect(await subjectAt(protocol, 'fr-FR')).toBe('ENV fr');
        expect(await subjectAt(protocol)).toBe('OTHER en');
        if (!listFirst) expect(await listed(protocol)).toEqual(lists);
        expect(await subjectAt(protocol, 'fr-FR')).toBe('ENV fr');
        // The door's judging read serves an item, so the refusal it marks stands at `_env` (409).
        let refusal: any;
        try { protocol.admitEnvironmentQualifier({ type: 'email_template', name: NAME, member: 'fr-FR' }); } catch (error) { refusal = error; }
        expect([refusal?.status, refusal?.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(refusal?.[Symbol.for('objectstack.metadata-protocol.disabledHoldersOnlyRefusal')]).toBe(true);
    });
});
