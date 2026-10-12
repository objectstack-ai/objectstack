// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two locales of one email template, saved through the metadata door, both
 * survive a restart (#22877, ruling A).
 *
 * ## The defect
 *
 * `email_template` declares its identity as `(name, locale)`: rows sharing one
 * `name` form an i18n bundle, one row per locale tag. The registry (#7730) and
 * the `/meta` list merge (#7774) already keyed it that way; the overlay store
 * did not. `sys_metadata` kept one overlay row per `(type, name)`, so an
 * administrator who saved `acme.welcome` in `en-US` and then in `zh-CN` had
 * the second save update the first locale's row in place. Both read back
 * correctly until the next boot, when `en-US` served the package wording
 * again. And a bare-name read served the `zh-CN` overlay, not the canonical
 * `en-US` member the registry's bare-name read resolves to.
 *
 * ## The pins (the triage's, kept by the ruling, plus the ruling's own)
 *
 *  - two locales saved through the metadata door, then a restart → each
 *    serves its own wording;
 *  - CONTROL: a single-locale save is unchanged;
 *  - CONTROL: a package-shipped bundle is unchanged;
 *  - a bare-name read answers the canonical member;
 *  - a row stored before the member column existed (a second locale's body,
 *    no member) is backfilled at boot, so it is answered as its own member.
 *
 * ## The harness
 *
 * `environment-overlay-five-types.test.ts`'s: the real `ObjectQL` engine and
 * `SchemaRegistry`, the real `ObjectStackProtocolImplementation`, and an
 * in-memory driver. `sys_metadata` is registered from `@objectstack/metadata-core`'s
 * own declaration, so the member column a row carries is the one the
 * platform declares. A RESTART is a new engine and a new protocol over the
 * SAME driver stores, booted the way `ObjectQLPlugin.start()` hydrates:
 * the package registered, then `loadMetaFromDb()`.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'com.acme.mail';
const NAME = 'acme.welcome';

const template = (locale: string, subject: string): Record<string, unknown> => ({
    name: NAME,
    label: 'Welcome',
    locale,
    subject,
    bodyHtml: `<p>${subject}</p>`,
});

/** The package: one template, shipped in two locales — an i18n bundle. */
function mailManifest(): Record<string, unknown> {
    return {
        id: PKG,
        name: 'acme_mail',
        emailTemplates: [template('en-US', 'PKG en'), template('zh-CN', 'PKG zh')],
    };
}

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

/**
 * One boot over `stores`: engine, package, protocol, then the hydration
 * `ObjectQLPlugin.start()` runs. Called twice over the same stores = a restart.
 */
async function boot(stores: Map<string, Map<string, Record<string, unknown>>>) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(mailManifest());
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod');
    const load = await protocol.loadMetaFromDb();
    return { engine, protocol, load };
}

const overlayRows = (stores: Map<string, Map<string, Record<string, unknown>>>) =>
    Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'email_template' && r.name === NAME && r.state === 'active');

/**
 * The wording each locale serves, as the send path reads it: the layered list
 * `plugin-email`'s registry loader resolves a send from by `(name, locale)`.
 */
async function servedSubjects(protocol: ObjectStackProtocolImplementation): Promise<Record<string, string>> {
    const res: any = await protocol.getMetaItemsForExecution({ type: 'email_template' });
    const out: Record<string, string> = {};
    for (const item of (res?.items ?? []) as any[]) {
        if (item?.name === NAME) out[String(item.locale)] = String(item.subject);
    }
    return out;
}

const bareNameSubject = async (protocol: ObjectStackProtocolImplementation) =>
    String(((await protocol.getMetaItem({ type: 'email_template', name: NAME })) as any)?.item?.subject);

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

describe('two locales of one email template survive a restart (#22877)', () => {
    it('two locales saved through the metadata door, then a restart → each serves its own wording', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        expect(await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('en-US', 'ADMIN en') }))
            .toMatchObject({ success: true });
        expect(await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh') }))
            .toMatchObject({ success: true });
        // Two rows: the canonical member's NULL, and the second locale's value.
        expect(overlayRows(stores).map((r) => r.bundle_member ?? null).sort()).toEqual([null, 'zh-CN'].sort());
        expect(await servedSubjects(first.protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'ADMIN zh' });

        const second = await boot(stores);
        expect(second.load).toMatchObject({ loaded: 2, errors: 0 });
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'ADMIN zh' });
        expect(await bareNameSubject(second.protocol)).toBe('ADMIN en');

        // A re-save of either locale after the restart updates its own row.
        expect(await second.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh 2') }))
            .toMatchObject({ success: true });
        expect(overlayRows(stores)).toHaveLength(2);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'ADMIN zh 2' });
    });

    it('CONTROL: a single-locale save is unchanged — one row, the other locale keeps the package wording', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('en-US', 'ADMIN en') });
        expect(overlayRows(stores)).toHaveLength(1);
        expect(overlayRows(stores)[0]!.bundle_member ?? null).toBeNull();

        const second = await boot(stores);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        expect(await bareNameSubject(second.protocol)).toBe('ADMIN en');
    });

    it('CONTROL: a package-shipped bundle is unchanged across a restart', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        expect(await servedSubjects(first.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'PKG zh' });

        const second = await boot(stores);
        expect(overlayRows(stores)).toEqual([]);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'PKG zh' });
        expect(await bareNameSubject(second.protocol)).toBe('PKG en');
    });

    it('a bare-name read answers the canonical member, not a second locale\'s overlay', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh') });

        // Before the fix this answered 'ADMIN zh': the one row for the name.
        expect(await bareNameSubject(first.protocol)).toBe('PKG en');
        const second = await boot(stores);
        expect(await bareNameSubject(second.protocol)).toBe('PKG en');
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'ADMIN zh' });
    });

    it('a row stored before the member column existed is backfilled at boot from its body', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        await boot(stores);
        // The four-part key's row: a second locale's body, no member.
        stores.get('sys_metadata')!.set('legacy_zh', {
            id: 'legacy_zh', type: 'email_template', name: NAME, organization_id: null, package_id: null,
            metadata: JSON.stringify(template('zh-CN', 'LEGACY zh')), state: 'active', version: 1,
        });

        const second = await boot(stores);
        expect(stores.get('sys_metadata')!.get('legacy_zh')!.bundle_member).toBe('zh-CN');
        expect(await bareNameSubject(second.protocol)).toBe('PKG en');
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'LEGACY zh' });

        // That locale's next save updates the backfilled row — no second row.
        await second.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh') });
        expect(overlayRows(stores).map((r) => r.id)).toEqual(['legacy_zh']);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'ADMIN zh' });
    });
});
