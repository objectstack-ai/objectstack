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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
async function boot(
    stores: Map<string, Map<string, Record<string, unknown>>>,
    /** [#22877] `'control-plane'` boots a kernel with no environment, whose registry a save writes through to. */
    kernel: 'environment' | 'control-plane' = 'environment',
) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(mailManifest());
    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map(), kernel === 'environment' ? 'env_prod' : undefined,
    );
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

    it('a by-name reset with no member removes the canonical member\'s overlay only', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('en-US', 'ADMIN en') });
        await first.protocol.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh') });

        expect(await first.protocol.deleteMetaItem({ type: 'email_template', name: NAME })).toMatchObject({ success: true, reset: true });
        expect(overlayRows(stores).map((r) => r.bundle_member)).toEqual(['zh-CN']);
        // At once, and after a restart: the canonical member is back on the
        // package wording, the other member keeps its own.
        expect(await servedSubjects(first.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'ADMIN zh' });
        expect(await bareNameSubject(first.protocol)).toBe('PKG en');
        const second = await boot(stores);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'ADMIN zh' });
        expect(await bareNameSubject(second.protocol)).toBe('PKG en');
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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — the by-name member selector (ruling 6116165299, Q2 i)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET, DELETE, publish, history and revert by name accept ONE member of the
// bundle (`member`, the discriminator's value); absent, the canonical member.
// A wrong value is a located 400. One lineage counter per `(org, type, name)`
// is shared by the bundle; history and revert are filtered by member, and a
// revert to another member's version answers `404 VERSION_NOT_FOUND` (the
// seat's answers 6118224899). Same harness as above: real engine, real
// protocol, and a restart is a second boot over the same stores.

const T = 'email_template';

const subjectOf = async (protocol: ObjectStackProtocolImplementation, member?: string) =>
    ((await protocol.getMetaItem({ type: T, name: NAME, ...(member !== undefined ? { member } : {}) })) as any)?.item?.subject;

/** The registry's own entry for one member — what a peer, a send or a bare-name engine read is served. */
const registrySubject = (engine: ObjectQL, member: string) =>
    (engine.registry.getItem<any>(T, NAME, undefined, member))?.subject;

/** Save both locales, then restart, so the second boot's registry holds both hydrated overlays. */
async function bootWithBothSaved(stores: Map<string, Map<string, Record<string, unknown>>>) {
    const first = await boot(stores);
    await first.protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
    await first.protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'ADMIN zh') });
    return boot(stores);
}

/** The located 400 the selector's one reading raises, whichever door asked it. */
async function expectSelectorRefusal(call: Promise<unknown>, sentence: RegExp) {
    const err: any = await call.then(() => undefined, (e: unknown) => e);
    expect(err, 'expected the selector to be refused').toBeDefined();
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(String(err.message)).toMatch(sentence);
}

describe('the by-name doors address ONE member by the selector (#22877, stage 2)', () => {
    it('GET: each member by name; absent and the canonical value both answer the canonical member', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        expect(await subjectOf(protocol)).toBe('ADMIN en');
        expect(await subjectOf(protocol, 'en-US')).toBe('ADMIN en');
        expect(await subjectOf(protocol, 'zh-CN')).toBe('ADMIN zh');
        // Trimmed, as the stored member was.
        expect(await subjectOf(protocol, ' zh-CN ')).toBe('ADMIN zh');
    });

    it('GET: a member nobody stored answers the code layer\'s member; one no layer holds answers nothing', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await boot(stores);
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
        expect(await subjectOf(protocol, 'zh-CN')).toBe('PKG zh');
        const absent: any = await protocol.getMetaItem({ type: T, name: NAME, member: 'fr-FR' });
        expect(absent?.item).toBeUndefined();
    });

    it('DELETE by member: resetting zh-CN removes its row only, and the en-US overlay stays served — the registry included', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { engine, protocol } = await bootWithBothSaved(stores);
        expect(registrySubject(engine, 'en-US')).toBe('ADMIN en');
        expect(registrySubject(engine, 'zh-CN')).toBe('ADMIN zh');

        expect(await protocol.deleteMetaItem({ type: T, name: NAME, member: 'zh-CN' })).toMatchObject({ success: true, reset: true });
        expect(overlayRows(stores).map((r) => r.bundle_member ?? null)).toEqual([null]);
        // The reset member is back on the package wording; the other member's
        // overlay is still the registry's entry — not swept with the group.
        expect(registrySubject(engine, 'zh-CN')).toBe('PKG zh');
        expect(registrySubject(engine, 'en-US')).toBe('ADMIN en');
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        expect(await subjectOf(protocol, 'zh-CN')).toBe('PKG zh');

        const after = await boot(stores);
        expect(await servedSubjects(after.protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        expect(registrySubject(after.engine, 'en-US')).toBe('ADMIN en');
    });

    it('DELETE with no member (the reverse): the canonical member is reset and the zh-CN overlay stays registered', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { engine, protocol } = await bootWithBothSaved(stores);
        expect(await protocol.deleteMetaItem({ type: T, name: NAME })).toMatchObject({ success: true, reset: true });
        expect(overlayRows(stores).map((r) => r.bundle_member)).toEqual(['zh-CN']);
        expect(registrySubject(engine, 'en-US')).toBe('PKG en');
        expect(registrySubject(engine, 'zh-CN')).toBe('ADMIN zh');
        expect(await subjectOf(protocol)).toBe('PKG en');
    });

    it('publish by member: a zh-CN draft goes live by name; CONTROL the bare publish finds no canonical draft', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await boot(stores);
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'DRAFT zh'), mode: 'draft' });

        const bare: any = await protocol.publishMetaItem({ type: T, name: NAME }).then(() => undefined, (e: unknown) => e);
        expect(bare?.code).toBe('NO_DRAFT');
        expect(await protocol.publishMetaItem({ type: T, name: NAME, member: 'zh-CN' })).toMatchObject({ success: true });
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'DRAFT zh' });
        expect(await subjectOf(protocol, 'zh-CN')).toBe('DRAFT zh');
        expect(await subjectOf(protocol)).toBe('PKG en');
    });

    it('history and revert by member: one shared counter, each member its own events; another member\'s version is VERSION_NOT_FOUND', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await boot(stores);
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'ADMIN zh 1') });
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'ADMIN zh 2') });

        const zh = (await protocol.historyMetaItem({ type: T, name: NAME, member: 'zh-CN' })).events;
        const en = (await protocol.historyMetaItem({ type: T, name: NAME })).events;
        expect(zh).toHaveLength(2);
        expect(en).toHaveLength(1);
        // One lineage counter per name: the versions interleave and never collide.
        const versions = [...en, ...zh].map((e) => e.version);
        expect(new Set(versions).size).toBe(3);

        const [zhFirst] = zh;
        expect(await protocol.rollbackMetaItem({ type: T, name: NAME, toVersion: zhFirst!.version!, member: 'zh-CN' }))
            .toMatchObject({ success: true, restoredFromVersion: zhFirst!.version });
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'ADMIN zh 1' });

        const crossed: any = await protocol.rollbackMetaItem({ type: T, name: NAME, toVersion: en[0]!.version!, member: 'zh-CN' })
            .then(() => undefined, (e: unknown) => e);
        expect(crossed?.code).toBe('VERSION_NOT_FOUND');
        expect(crossed?.status).toBe(404);
        // CONTROL: the canonical member reverts to its own version by the bare name.
        expect(await protocol.rollbackMetaItem({ type: T, name: NAME, toVersion: en[0]!.version! })).toMatchObject({ success: true });
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'ADMIN zh 1' });
    });

    it('a wrong selector is a located 400 on every door, and nothing is read or written', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        const before = JSON.stringify(Array.from(stores.get('sys_metadata')!.values()));
        const noMembers = /^The "member" selector names a bundle member, and a 'view' item has none/;
        const view = { type: 'view', name: 'task_grid', member: 'zh-CN' };
        await expectSelectorRefusal(protocol.getMetaItem(view), noMembers);
        await expectSelectorRefusal(protocol.deleteMetaItem(view), noMembers);
        await expectSelectorRefusal(protocol.publishMetaItem(view), noMembers);
        await expectSelectorRefusal(protocol.historyMetaItem(view), noMembers);
        await expectSelectorRefusal(protocol.rollbackMetaItem({ ...view, toVersion: 1 }), noMembers);

        await expectSelectorRefusal(protocol.deleteMetaItem({ type: T, name: NAME, member: '' }), /^The "member" selector is blank\./);
        await expectSelectorRefusal(
            protocol.getMetaItem({ type: T, name: NAME, member: 'x'.repeat(101) }),
            /^The "member" selector is 101 characters long; a stored 'email_template' member holds at most 100/,
        );
        expect(JSON.stringify(Array.from(stores.get('sys_metadata')!.values()))).toBe(before);
    });
});

describe('the package-batch doors and the cluster fan-out carry the member (#22877, stage 2)', () => {
    /** A zh-CN draft bound to the package, beside an en-US active overlay that has none. */
    async function bootWithZhDraft(stores: Map<string, Map<string, Record<string, unknown>>>) {
        const booted = await boot(stores);
        await booted.protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
        await booted.protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'DRAFT zh'), mode: 'draft', packageId: PKG });
        return booted;
    }
    const draftRows = (stores: Map<string, Map<string, Record<string, unknown>>>) =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r) => r.type === T && r.name === NAME && r.state === 'draft');

    it('publishPackageDrafts: the zh-CN draft alone is promoted as zh-CN, and en-US is untouched', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithZhDraft(stores);
        expect(draftRows(stores).map((r) => r.bundle_member)).toEqual(['zh-CN']);

        const out: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(out, JSON.stringify(out)).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(draftRows(stores)).toEqual([]);
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'DRAFT zh' });
    });

    it('revertCommit: the revert of that publish removes the zh-CN row it created and leaves en-US', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithZhDraft(stores);
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published.commitId, JSON.stringify(published)).toBeTruthy();

        const reverted: any = await protocol.revertCommit({ commitId: published.commitId });
        expect(reverted, JSON.stringify(reverted)).toMatchObject({ success: true, revertedCount: 1 });
        expect(overlayRows(stores).map((r) => r.bundle_member ?? null)).toEqual([null]);
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        // The timeline serves the declared item, with no `member` key.
        const commits: any[] = await (protocol as any).listCommits({ packageId: PKG });
        for (const c of commits) for (const it of c.items) expect(Object.keys(it).sort()).toEqual(['existedBefore', 'name', 'prevVersion', 'type']);
    });

    it('discardPackageDrafts: the zh-CN draft is discarded as zh-CN', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithZhDraft(stores);
        const out: any = await protocol.discardPackageDrafts({ packageId: PKG });
        expect(out, JSON.stringify(out)).toMatchObject({ success: true, discardedCount: 1, failedCount: 0 });
        expect(draftRows(stores)).toEqual([]);
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        // The public draft list keeps its declared header (no `member`).
        const listed: any = await protocol.listDrafts({ packageId: PKG });
        expect(listed.drafts).toEqual([]);
    });

    it('the cluster fan-out: a peer converges on the member a write changed, and a member reset heals only that member', async () => {
        // Control-plane replicas: their registry takes the write-through a
        // converging peer re-runs (an environment kernel keeps a non-object
        // overlay out of it until the next boot, #6602).
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const subscribers: Array<(msg: { payload: unknown }) => void> = [];
        const bus: any = {
            subscribe: (_channel: string, handler: (msg: { payload: unknown }) => void) => {
                subscribers.push(handler);
                return () => {};
            },
            publish: async (_channel: string, payload: unknown) => {
                for (const handler of subscribers) handler({ payload });
            },
        };
        const writer = await boot(stores, 'control-plane');
        const peer = await boot(stores, 'control-plane');
        writer.protocol.attachMetadataMutationPubSub(bus, 'writer');
        peer.protocol.attachMetadataMutationPubSub(bus, 'peer');

        await writer.protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
        await writer.protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'ADMIN zh') });
        await vi.waitFor(() => expect(registrySubject(peer.engine, 'zh-CN')).toBe('ADMIN zh'));
        expect(registrySubject(peer.engine, 'en-US')).toBe('ADMIN en');

        await writer.protocol.deleteMetaItem({ type: T, name: NAME, member: 'zh-CN' });
        await vi.waitFor(() => expect(registrySubject(peer.engine, 'zh-CN')).toBe('PKG zh'));
        expect(registrySubject(peer.engine, 'en-US')).toBe('ADMIN en');
    });
});
