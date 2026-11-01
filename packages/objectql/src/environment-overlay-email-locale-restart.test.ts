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
 * [#28576, ADR-0146 D11] A write naming no package onto the package's
 * template is closed, so the administrator writes here go into the base's
 * pair (`inPair`, below), where the member semantics are the same row for
 * row; a package-less row is laid down as a release before the close stored
 * it (`seedPackagelessRow`), served until the ceremony moves it, and its
 * package-less write is refused.
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
import { isCodeArtifactBody } from './registry.js';

const PKG = 'com.acme.mail';
const NAME = 'acme.welcome';
const DIGEST = 'acme.digest';

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
        // A versioned package, as a real install is: its items carry the
        // package's protection envelope (`_packageId`, `_provenance`), which a
        // hydrated overlay of them is grafted with.
        version: '1.0.0',
        // [#28576] A pair is formed from the base's namespace (ADR-0146 D3).
        namespace: 'acmemail',
        emailTemplates: [
            template('en-US', 'PKG en'), template('zh-CN', 'PKG zh'),
            // [#22877 stage 2] A second template the package ships in `en-US`
            // only, as the showcase ships its templates: a `zh-CN` overlay of
            // it customizes a member no artifact ships.
            { ...template('en-US', 'PKG digest en'), name: DIGEST },
        ],
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

/**
 * One boot over `stores`: engine, package, protocol, then the hydration
 * `ObjectQLPlugin.start()` runs. Called twice over the same stores = a restart.
 */
async function boot(
    stores: Map<string, Map<string, Record<string, unknown>>>,
    /** [#22877] `'control-plane'` boots a kernel with no environment, whose registry a save writes through to. */
    kernel: 'environment' | 'control-plane' = 'environment',
    /** [#23074] Runs once the package is registered, before the boot hydration. */
    beforeHydration?: (engine: ObjectQL) => void,
) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(mailManifest());
    beforeHydration?.(engine);
    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map(), kernel === 'environment' ? 'env_prod' : undefined,
    );
    const load = await protocol.loadMetaFromDb();
    await protocol.ensureCustomizationPackage({ basePackageId: PKG } as any);
    return { engine, protocol: inPair(protocol), raw: protocol, load };
}

/**
 * [#28576, ADR-0146 D11] A write naming no package onto the package's
 * template is closed, so every administrator write in this file is the one
 * that stays open: into the base's pair, `com.acme.mail.custom`, declaring
 * what it overrides. This wrapper names the pair on each save, publish and
 * delete that names no package, and adds the declaration to a saved body —
 * the member semantics pinned below are the pair's, row for row, as they were
 * the package-less row's. A write that names a package (the drafts into
 * `PKG` below) is passed through untouched.
 */
const PAIR = 'com.acme.mail.custom';
const DECLARATION = { package: PKG, basedOn: '1.0.0' };
function inPair(protocol: ObjectStackProtocolImplementation): ObjectStackProtocolImplementation {
    const named = (request: any) => request?.packageId !== undefined;
    return new Proxy(protocol, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (key === 'saveMetaItem') {
                return (request: any) => (named(request) ? value.call(target, request) : value.call(target, {
                    ...request, packageId: PAIR, item: { ...request.item, overrides: DECLARATION },
                }));
            }
            if (key === 'deleteMetaItem' || key === 'publishMetaItem') {
                return (request: any) => value.call(target, named(request) ? request : { ...request, packageId: PAIR });
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * [#28576] A package-less row of the package's template as a release before
 * the close stored it, written straight to the overlay store (the write door
 * refuses that write now): such a row is still served by every read until
 * `os migrate packageless-overlays` moves it (ADR-0146 D11).
 */
async function seedPackagelessRow(raw: ObjectStackProtocolImplementation, name: string, body: Record<string, unknown>) {
    const repo = (raw as any).getOverlayRepo();
    await repo.put({ type: 'email_template', name, org: 'env' }, body, {
        parentVersion: null, actor: null, source: 'older-release', intent: 'override-artifact', packageId: null,
    });
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

        // [#28576, ADR-0146 D11] That locale's next save naming no package is
        // refused, naming the ceremony that moves the row; the backfilled row
        // stays the one served — no second row.
        const refused: any = await second.raw.saveMetaItem({ type: 'email_template', name: NAME, item: template('zh-CN', 'ADMIN zh') })
            .then(() => undefined, (e: unknown) => e);
        expect(refused).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(String(refused?.message)).toContain('os migrate packageless-overlays');
        expect(overlayRows(stores).map((r) => r.id)).toEqual(['legacy_zh']);
        expect(await servedSubjects(second.protocol)).toEqual({ 'en-US': 'PKG en', 'zh-CN': 'LEGACY zh' });
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

    it('DELETE by member of a member NO artifact ships: its overlay leaves the registry, and the canonical overlay stays', async () => {
        // The package ships `acme.digest` in `en-US` only (the showcase's
        // shape). Leaving the hydrated `zh-CN` overlay registered kept serving
        // the reset wording until the next boot. [#23074] It is registered
        // as the tenant row it is (no artifact envelope), so the heal's
        // overlay-entry retirement takes it; the readers are pinned in the
        // last block of this file.
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores);
        await first.protocol.saveMetaItem({ type: T, name: DIGEST, item: { ...template('en-US', 'ADMIN digest en'), name: DIGEST } });
        await first.protocol.saveMetaItem({ type: T, name: DIGEST, item: { ...template('zh-CN', 'ADMIN digest zh'), name: DIGEST } });
        const { engine, protocol } = await boot(stores);
        const digestEntry = (member: string) => engine.registry.getItem<any>(T, DIGEST, undefined, member)?.subject;
        expect(digestEntry('zh-CN')).toBe('ADMIN digest zh');

        expect(await protocol.deleteMetaItem({ type: T, name: DIGEST, member: 'zh-CN' })).toMatchObject({ success: true, reset: true });
        expect(digestEntry('zh-CN')).toBeUndefined();
        expect(digestEntry('en-US')).toBe('ADMIN digest en');
        const listed: any = await protocol.getMetaItemsForExecution({ type: T });
        const digest = (listed?.items ?? []).filter((it: any) => it?.name === DIGEST).map((it: any) => `${it.locale}:${it.subject}`);
        expect(digest).toEqual(['en-US:ADMIN digest en']);
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
    });

    it('CONTROL: a revert by the bare name reverts the canonical member to its own version, and leaves zh-CN', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await boot(stores);
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en 1') });
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'ADMIN zh') });
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en 2') });
        const [enFirst] = (await protocol.historyMetaItem({ type: T, name: NAME })).events;
        expect(await protocol.rollbackMetaItem({ type: T, name: NAME, toVersion: enFirst!.version! })).toMatchObject({ success: true });
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en 1', 'zh-CN': 'ADMIN zh' });
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

// [#26699] The layered read (`getMetaItemLayered`, the Setup editor's read
// through `GET /meta/:type/:name/layers`) takes the same selector: the option-A
// ruling on #26649 extended ruling 6116165299's door list to it.
const layersOf = async (protocol: ObjectStackProtocolImplementation, member?: string) => {
    const layered: any = await protocol.getMetaItemLayered({ type: T, name: NAME, ...(member !== undefined ? { member } : {}) });
    return {
        code: layered?.code?.subject ?? null,
        overlay: layered?.overlay?.subject ?? null,
        effective: layered?.effective?.subject ?? null,
        overlayScope: layered?.overlayScope ?? null,
    };
};

describe('[#26699] the layered read addresses ONE member by the selector', () => {
    it('a non-canonical member answers its own code and overlay layers', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        expect(await layersOf(protocol, 'zh-CN')).toEqual({
            code: 'PKG zh', overlay: 'ADMIN zh', effective: 'ADMIN zh', overlayScope: 'env',
        });
        // A member nobody stored: its own code layer, and no overlay — never the canonical row.
        const fresh = await boot(new Map());
        await fresh.protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'ADMIN en') });
        expect(await layersOf(fresh.protocol, 'zh-CN')).toEqual({
            code: 'PKG zh', overlay: null, effective: 'PKG zh', overlayScope: null,
        });
    });

    it('CONTROL: the canonical read is unchanged — absent, and the canonical value, answer the canonical member', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        const canonical = { code: 'PKG en', overlay: 'ADMIN en', effective: 'ADMIN en', overlayScope: 'env' };
        expect(await layersOf(protocol)).toEqual(canonical);
        expect(await layersOf(protocol, 'en-US')).toEqual(canonical);
        // The whole answer, not only the subjects: naming the canonical value is the same request.
        expect(await protocol.getMetaItemLayered({ type: T, name: NAME, member: 'en-US' }))
            .toEqual(await protocol.getMetaItemLayered({ type: T, name: NAME }));
    });

    it('the MetadataService copy is a code layer only of the member it is — the canonical read never reports another member\'s', async () => {
        // The service keys a type's items by name alone, so for a bundle it
        // holds whichever member registered last: here, zh-CN.
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { engine } = await bootWithBothSaved(stores);
        const metadata = { get: async () => template('zh-CN', 'SVC zh') };
        const withService = new ObjectStackProtocolImplementation(engine, () => new Map([['metadata', metadata]]), 'env_prod');
        expect((await layersOf(withService)).code).toBe('PKG en');
        expect((await layersOf(withService, 'en-US')).code).toBe('PKG en');
        expect((await layersOf(withService, 'zh-CN')).code).toBe('SVC zh');
    });

    it('a member no layer holds answers no layer at all — the door\'s absent item, never the canonical member', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        expect(await layersOf(protocol, 'fr-FR')).toEqual({ code: null, overlay: null, effective: null, overlayScope: null });
    });

    it('a wrong selector is the located 400 of the one reading, and nothing is read', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithBothSaved(stores);
        await expectSelectorRefusal(
            protocol.getMetaItemLayered({ type: 'view', name: 'task_grid', member: 'zh-CN' }),
            /^The "member" selector names a bundle member, and a 'view' item has none/,
        );
        await expectSelectorRefusal(protocol.getMetaItemLayered({ type: T, name: NAME, member: ' ' }), /^The "member" selector is blank\./);
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
        // [#23073] The timeline serves each item's member: the publish and its revert, zh-CN both.
        const commits = await protocol.listCommits({ packageId: PKG });
        expect(commits.map((c) => c.items.map((it) => [it.type, it.name, it.member]))).toEqual([
            [[T, NAME, 'zh-CN']], [[T, NAME, 'zh-CN']],
        ]);
    });

    it('discardPackageDrafts: the zh-CN draft is discarded as zh-CN', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await bootWithZhDraft(stores);
        const out: any = await protocol.discardPackageDrafts({ packageId: PKG });
        expect(out, JSON.stringify(out)).toMatchObject({ success: true, discardedCount: 1, failedCount: 0 });
        expect(draftRows(stores)).toEqual([]);
        expect(await servedSubjects(protocol)).toEqual({ 'en-US': 'ADMIN en', 'zh-CN': 'PKG zh' });
        const listed = await protocol.listDrafts({ packageId: PKG });
        expect(listed.drafts).toEqual([]);
    });

    it('[#23073] the draft list and the commit timeline tell two languages of one template apart, and each listed member addresses its own item by name', async () => {
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { protocol } = await boot(stores);
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('en-US', 'DRAFT en'), mode: 'draft', packageId: PKG });
        await protocol.saveMetaItem({ type: T, name: NAME, item: template('zh-CN', 'DRAFT zh'), mode: 'draft', packageId: PKG });
        const wording: Record<string, string> = { 'en-US': 'DRAFT en', 'zh-CN': 'DRAFT zh' };

        // Two drafts of one `type` and `name`, told apart by `member` alone.
        const listed = await protocol.listDrafts({ packageId: PKG });
        expect(listed.drafts.map((d) => [d.type, d.name, d.member]).sort()).toEqual([[T, NAME, 'en-US'], [T, NAME, 'zh-CN']]);
        // The listed member round-trips through the by-name door: each reads its own draft.
        for (const d of listed.drafts) {
            const read: any = await protocol.getMetaItem({ type: d.type, name: d.name, state: 'draft', member: d.member });
            expect(read?.item?.subject).toBe(wording[d.member!]);
        }

        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published, JSON.stringify(published)).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
        const [commit] = await protocol.listCommits({ packageId: PKG });
        expect(commit!.items.map((it) => [it.type, it.name, it.member]).sort()).toEqual([[T, NAME, 'en-US'], [T, NAME, 'zh-CN']]);
        for (const it of commit!.items) {
            const read: any = await protocol.getMetaItem({ type: it.type, name: it.name, member: it.member });
            expect(read?.item?.subject).toBe(wording[it.member!]);
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// [#23074] The artifact envelope is stamped only on the member the package ships
// ─────────────────────────────────────────────────────────────────────────────
//
// The package ships `acme.digest` in `en-US` only and `acme.welcome` in both
// locales. An environment overlay of `acme.digest` in `zh-CN` customizes a
// member no artifact ships, so it is the environment's own item. Before, the
// boot hydration grafted the bundle's `en-US` artifact envelope onto it
// (`_packageId`, `_packageVersion`, `_provenance: 'package'`): the registry's
// artifact lookup then answered the overlay itself as the package's `zh-CN`
// artifact, both read doors served it under the package's provenance, and the
// overlay-entry retirement refused it as code. CONTROL in every case: the
// shipped member's overlay (`acme.welcome` in `zh-CN`) keeps its artifact's
// envelope, lookup, read and heal. Last, a type with no members keeps its
// envelope, even where the overlay's `locale` differs from the artifact's.

const PROTECTION_KEYS = ['_packageId', '_packageVersion', '_provenance'] as const;
const protectionOf = (body: unknown) =>
    Object.fromEntries(PROTECTION_KEYS.map((key) => [key, (body as Record<string, unknown> | undefined)?.[key]]));
/** The envelope the package's artifacts carry, which an overlay of a shipped member wears. */
const PACKAGED = { _packageId: PKG, _packageVersion: '1.0.0', _provenance: 'package' };
/** What the hydration says of every stored row before any envelope is grafted (ADR-0010 `'org'`). */
const TENANT = { _packageId: undefined, _packageVersion: undefined, _provenance: 'org' };

/** Overlays of `name` in `en-US` and `zh-CN`, then a restart: the second boot's registry holds both hydrated. */
async function bootWithOverlays(
    stores: Map<string, Map<string, Record<string, unknown>>>,
    name: string,
    beforeHydration?: (engine: ObjectQL) => void,
) {
    const first = await boot(stores);
    // [#28576] Package-less rows a release before the close stored: the
    // hydration of an unmigrated row is what this section pins.
    for (const locale of ['en-US', 'zh-CN']) {
        await seedPackagelessRow(first.raw, name, { ...template(locale, `ADMIN ${name} ${locale}`), name });
    }
    return boot(stores, 'environment', beforeHydration);
}

describe('[#23074] the artifact envelope is stamped only on the member the package ships', () => {
    it('the boot hydration: an unshipped member\'s overlay registers as the tenant row it is', async () => {
        const { engine } = await bootWithOverlays(new Map(), DIGEST);
        const zh = engine.registry.getItem<any>(T, DIGEST, undefined, 'zh-CN');
        expect(zh?.subject).toBe(`ADMIN ${DIGEST} zh-CN`);
        expect(protectionOf(zh)).toEqual(TENANT);
        expect(isCodeArtifactBody(zh)).toBe(false);
        // The package ships no `zh-CN` member, and the overlay is not one.
        expect(engine.registry.getArtifactItem(T, DIGEST, undefined, 'zh-CN')).toBeUndefined();
    });

    it('CONTROL the boot hydration: an overlay of a shipped member wears its artifact\'s envelope', async () => {
        // The bundle's canonical member, beside the unshipped one.
        const { engine } = await bootWithOverlays(new Map(), DIGEST);
        const en = engine.registry.getItem<any>(T, DIGEST, undefined, 'en-US');
        expect(en?.subject).toBe(`ADMIN ${DIGEST} en-US`);
        expect(protectionOf(en)).toEqual(PACKAGED);
        expect(isCodeArtifactBody(en)).toBe(true);
        // A non-canonical member the package ships.
        const shipped = (await bootWithOverlays(new Map(), NAME)).engine;
        const zh = shipped.registry.getItem<any>(T, NAME, undefined, 'zh-CN');
        expect(zh?.subject).toBe(`ADMIN ${NAME} zh-CN`);
        expect(protectionOf(zh)).toEqual(PACKAGED);
        expect(isCodeArtifactBody(zh)).toBe(true);
        expect(shipped.registry.getArtifactItem<any>(T, NAME, undefined, 'zh-CN')?.subject).toBe('PKG zh');
    });

    it('the by-name read (?member=): an unshipped member is served as the environment\'s item', async () => {
        const { protocol } = await bootWithOverlays(new Map(), DIGEST);
        const zh: any = await protocol.getMetaItem({ type: T, name: DIGEST, member: 'zh-CN' });
        expect(zh.item.subject).toBe(`ADMIN ${DIGEST} zh-CN`);
        expect(protectionOf(zh.item)).toEqual({ _packageId: undefined, _packageVersion: undefined, _provenance: undefined });
        expect(isCodeArtifactBody(zh.item)).toBe(false);
        expect([zh.provenance, zh.packageId, zh.packageVersion]).toEqual([undefined, undefined, undefined]);
        expect(zh).toMatchObject({ lock: 'none', editable: true, deletable: true });
    });

    it('CONTROL the by-name read (?member=): a shipped member is served under its package', async () => {
        const { protocol } = await bootWithOverlays(new Map(), NAME);
        const zh: any = await protocol.getMetaItem({ type: T, name: NAME, member: 'zh-CN' });
        expect(zh.item.subject).toBe(`ADMIN ${NAME} zh-CN`);
        expect(protectionOf(zh.item)).toEqual(PACKAGED);
        expect(zh).toMatchObject({
            provenance: 'package', packageId: PKG, packageVersion: '1.0.0', lock: 'none', editable: true, deletable: true,
        });
    });

    /** Each listed member of `name` by locale, from the served list or the execution list. */
    const listedMembers = async (protocol: ObjectStackProtocolImplementation, audience: 'served' | 'execution', name: string) => {
        const res: any = audience === 'served'
            ? await protocol.getMetaItems({ type: T })
            : await protocol.getMetaItemsForExecution({ type: T });
        return new Map<string, any>(((res?.items ?? []) as any[]).filter((it) => it?.name === name).map((it) => [String(it.locale), it]));
    };

    it('the list, served and for execution: an unshipped member is listed as the environment\'s item', async () => {
        const { protocol } = await bootWithOverlays(new Map(), DIGEST);
        for (const audience of ['served', 'execution'] as const) {
            const zh = (await listedMembers(protocol, audience, DIGEST)).get('zh-CN');
            expect(zh?.subject, audience).toBe(`ADMIN ${DIGEST} zh-CN`);
            expect(protectionOf(zh), audience).toEqual({ _packageId: undefined, _packageVersion: undefined, _provenance: undefined });
        }
    });

    it('CONTROL the list, served and for execution: shipped members are listed under their package', async () => {
        const unshipped = (await bootWithOverlays(new Map(), DIGEST)).protocol;
        const shipped = (await bootWithOverlays(new Map(), NAME)).protocol;
        for (const audience of ['served', 'execution'] as const) {
            expect(protectionOf((await listedMembers(unshipped, audience, DIGEST)).get('en-US')), audience).toEqual(PACKAGED);
            const zh = (await listedMembers(shipped, audience, NAME)).get('zh-CN');
            expect(zh?.subject, audience).toBe(`ADMIN ${NAME} zh-CN`);
            expect(protectionOf(zh), audience).toEqual(PACKAGED);
        }
    });

    /**
     * A by-name reset of the `zh-CN` member of `name`, through the delete door,
     * read back at once and after a restart: `after` is the `zh-CN` subject the
     * registry and the by-name read then serve. Before the door, each of the
     * registry's two heal verbs that the delete's heal
     * (`restoreArtifactRegistryView`) calls is asked about the hydrated entry,
     * on a boot of its own.
     */
    async function resetZh(name: string, verbs: { shadow: boolean; overlayEntry: boolean }) {
        const shadowBoot = (await bootWithOverlays(new Map(), name)).engine;
        expect(shadowBoot.registry.removeRuntimeShadow(T, name, 'zh-CN'), 'removeRuntimeShadow').toBe(verbs.shadow);
        const overlayEntryBoot = (await bootWithOverlays(new Map(), name)).engine;
        expect(overlayEntryBoot.registry.removeOverlayEntry(T, name, 'zh-CN'), 'removeOverlayEntry').toBe(verbs.overlayEntry);

        // [#28576, ADR-0146 D11] The reset of that unmigrated row naming no
        // package is refused, naming the ceremony that moves it, and the row
        // keeps serving its member — before and after a restart. The registry
        // verbs above are what the ceremony's move leaves to the next boot.
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const { engine, protocol, raw } = await bootWithOverlays(stores, name);
        const refused: any = await raw.deleteMetaItem({ type: T, name, member: 'zh-CN' }).then(() => undefined, (e: unknown) => e);
        expect(refused).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(String(refused?.message)).toContain('os migrate packageless-overlays');
        const kept = `ADMIN ${name} zh-CN`;
        expect(engine.registry.getItem<any>(T, name, undefined, 'zh-CN')?.subject).toBe(kept);
        expect(engine.registry.getItem<any>(T, name, undefined, 'en-US')?.subject).toBe(`ADMIN ${name} en-US`);
        expect(((await protocol.getMetaItem({ type: T, name, member: 'zh-CN' })) as any)?.item?.subject).toBe(kept);
        const restarted = await boot(stores);
        expect(((await restarted.protocol.getMetaItem({ type: T, name, member: 'zh-CN' })) as any)?.item?.subject).toBe(kept);
    }

    it('the reset (?member=): an unshipped member is retired by the overlay-entry tier; its package-less reset door is closed', async () => {
        // No `zh-CN` artifact takes its place, so the shadow heal declines and
        // the overlay-entry retirement takes the tenant row.
        await resetZh(DIGEST, { shadow: false, overlayEntry: true });
    });

    it('CONTROL the reset (?member=): a shipped member is un-shadowed onto its artifact; its package-less reset door is closed', async () => {
        // The shadow heal lifts the entry onto the `zh-CN` artifact, and the
        // retirement refuses it as packaged code.
        await resetZh(NAME, { shadow: true, overlayEntry: false });
    });

    it('a registry that answers another member\'s artifact: the graft keeps it off the body', async () => {
        // `lookupArtifactItem`'s note: a registry without the member parameter
        // ignores it, so it answers the bundle's artifact canonical-first.
        const { engine, protocol } = await bootWithOverlays(new Map(), DIGEST, (booted) => {
            const registry = booted.registry as any;
            const artifactOf = registry.getArtifactItem.bind(registry);
            vi.spyOn(registry, 'getArtifactItem').mockImplementation((...args: any[]) => artifactOf(args[0], args[1], args[2]));
        });
        expect(engine.registry.getArtifactItem<any>(T, DIGEST, undefined, 'zh-CN')?.locale).toBe('en-US');
        // CONTROL — the canonical member is that artifact's own member, and wears it.
        expect(protectionOf(engine.registry.getItem(T, DIGEST, undefined, 'en-US'))).toEqual(PACKAGED);
        expect(protectionOf(engine.registry.getItem(T, DIGEST, undefined, 'zh-CN'))).toEqual(TENANT);
        const zh: any = await protocol.getMetaItem({ type: T, name: DIGEST, member: 'zh-CN' });
        expect(zh.item._packageId).toBeUndefined();
        expect(zh.packageId).toBeUndefined();
    });

    it('CONTROL: a type with no members keeps its artifact\'s envelope, even where the overlay\'s locale is not the artifact\'s', async () => {
        // `translation` carries a `locale`, and is identified by its name
        // alone: only a type `ITEM_KEY_DISCRIMINATORS` declares has members.
        const TR = 'acme_mail_messages';
        const translation = (locale: string, save: string) => ({ name: TR, label: 'Mail messages', locale, messages: { save } });
        const shipTranslation = (booted: ObjectQL) => {
            booted.registry.registerItem('translation', translation('zh-CN', '保存'), 'name', PKG);
        };
        const stores = new Map<string, Map<string, Record<string, unknown>>>();
        const first = await boot(stores, 'environment', shipTranslation);
        expect(await first.protocol.saveMetaItem({ type: 'translation', name: TR, item: translation('ja-JP', '保存する') }))
            .toMatchObject({ success: true });
        const { engine, protocol } = await boot(stores, 'environment', shipTranslation);
        const entry = engine.registry.getItem<any>('translation', TR);
        expect(entry?.locale).toBe('ja-JP');
        expect(entry?._packageId).toBe(PKG);
        expect(isCodeArtifactBody(entry)).toBe(true);
        const read: any = await protocol.getMetaItem({ type: 'translation', name: TR });
        expect(read.item.locale).toBe('ja-JP');
        expect(read.item._packageId).toBe(PKG);
        expect(read.packageId).toBe(PKG);
    });
});
