// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] The `unmanaged` install mode's copy-once import — the plan
 * (`package-unmanaged-install.ts`) and the verb
 * (`ObjectStackProtocolImplementation.importUnmanagedPackage`).
 *
 * The pins are the stage-0 plan's acceptance for this stage, each built here:
 *
 *  - every item is copied with `package_id` = the new base and
 *    `organization_id` NULL, and nothing lands under the source id;
 *  - a walled REQUESTED posture is refused with code + status and ZERO writes
 *    (no base record, no row) — with a lit control on `single`;
 *  - a collision is refused before the base is created;
 *  - a mid-copy failure leaves no base and no row;
 *  - a follow-up save on a copied item succeeds: editability shown by a
 *    write, not by a flag;
 *  - a runtime-uncreatable type or code is refused before any write, and the
 *    `OS_METADATA_WRITABLE` hatch does not open it;
 *  - the package's protection lock is not copied (ADR-0010 §3.3; the ruling on
 *    the D6 lock fork, record 6119681934): a locked item's copy carries no
 *    `_lock` / `_lockReason` / `_lockSource`, the next save edits it, and the
 *    answer's `strippedLocks` names each lock dropped with its reason.
 *
 * Refusals are asserted as the envelope an HTTP boundary answers with
 * (`resolveThrownHttpError`), never as a bare throw.
 *
 * The engine below is a stub: this package cannot import `@objectstack/objectql`
 * (that package depends on this one). It keeps real rows, so the REAL save
 * door, the REAL install primitive and the REAL uninstall run against it; its
 * write verbs route through the producer's own dispatch predicates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ImportUnmanagedPackageResponseSchema } from '@objectstack/spec/api';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '@objectstack/spec/kernel';
import { applyProtection } from '@objectstack/spec/shared';
import { resolveThrownHttpError } from '@objectstack/types';
import {
    UNMANAGED_IMPORT_COLLECTIONS,
    planUnmanagedImport,
    stripUnmanagedImportLock,
    unmanagedTranslationItemName,
} from './package-unmanaged-install.js';
import { ObjectStackProtocolImplementation, overlaySchemaDeclaredKey } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

type Row = Record<string, any>;

/** Equality, `null` and `$in`; any other operator is refused, so a matcher that ignored one cannot prove anything. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported operator ${key}`);
        const have = row[key] ?? null;
        if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
            const ops = Object.keys(want);
            if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`stub engine: unsupported operator ${ops.join(',')}`);
            if (!(want as { $in: unknown[] }).$in.includes(have)) return false;
            continue;
        }
        if (have !== want) return false;
    }
    return true;
}

/** A stub engine that keeps rows, and a registry that keeps packages and namespaces. */
function makeEngine(opts: { artifacts?: Array<{ type: string; name: string; packageId: string }>; owners?: Record<string, string[]> } = {}) {
    const tables = new Map<string, Row[]>();
    const table = (name: string) => {
        if (!tables.has(name)) tables.set(name, []);
        return tables.get(name)!;
    };
    let nextId = 0;
    const writes: Array<{ op: string; table: string }> = [];
    const packages = new Map<string, any>();
    const namespaces = new Map<string, Set<string>>(
        Object.entries(opts.owners ?? {}).map(([ns, ids]) => [ns, new Set(ids)]),
    );
    const artifacts = opts.artifacts ?? [];
    // What the registry was handed — the body every read then serves.
    const registered: Array<{ type: string; item: any }> = [];
    const objects: Array<{ item: any; packageId: string }> = [];
    const ddl: string[] = [];
    const engine: any = {
        async syncObjectSchema(name: any) { ddl.push(`sync ${typeof name === 'string' ? name : name?.name}`); },
        async dropObjectSchema(name: any) { ddl.push(`drop ${typeof name === 'string' ? name : name?.name}`); },
        async find(t: string, q?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = table(t).filter((r) => matches(r, q?.where));
            // The caller's bound, after the filter, by presence — as the engine applies it.
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        async findOne(t: string, q: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, q);
            return table(t).find((r) => matches(r, q.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            writes.push({ op: 'insert', table: t });
            nextId += 1;
            const row = { id: `r_${nextId}`, ...data };
            table(t).push(row);
            return { ...row };
        },
        async update(t: string, data: Row, q?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, q);
            writes.push({ op: 'update', table: t });
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const hit = table(t).filter((r) => matches(r, where));
            for (const r of hit) Object.assign(r, data);
            return { id: hit[0]?.id ?? null };
        },
        async delete(t: string, q?: Record<string, unknown>) {
            assertEngineDeleteDispatch(q);
            writes.push({ op: 'delete', table: t });
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const keep = table(t).filter((r) => !matches(r, where));
            const deleted = table(t).length - keep.length;
            tables.set(t, keep);
            return { deleted };
        },
        registry: {
            registerItem: (type: string, item: any) => { registered.push({ type, item }); },
            // The OBJECT schema every data and metadata read serves, and the
            // package it is registered under.
            registerObject: (item: any, packageId: string) => { objects.push({ item, packageId }); },
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getArtifactItem: (type: string, name: string) => {
                const hit = artifacts.find((a) => a.type === type && a.name === name);
                return hit ? { name, _packageId: hit.packageId } : undefined;
            },
            getPackage: (id: string) => packages.get(id),
            installPackage: (manifest: any) => {
                const pkg = { manifest, status: 'installed', enabled: true };
                packages.set(manifest.id, pkg);
                if (manifest.namespace) {
                    if (!namespaces.has(manifest.namespace)) namespaces.set(manifest.namespace, new Set());
                    namespaces.get(manifest.namespace)!.add(manifest.id);
                }
                return pkg;
            },
            uninstallPackage: (id: string) => {
                const pkg = packages.get(id);
                packages.delete(id);
                if (pkg?.manifest?.namespace) namespaces.get(pkg.manifest.namespace)?.delete(id);
            },
            getNamespaceOwners: (ns: string) => [...(namespaces.get(ns) ?? [])],
        },
    };
    return { engine, table, writes, packages, registered, objects, ddl };
}

function makeProtocol(opts: Parameters<typeof makeEngine>[0] = {}) {
    const harness = makeEngine(opts);
    const protocol = new ObjectStackProtocolImplementation(harness.engine, () => new Map()) as any;
    return { ...harness, protocol };
}

/** A small, schema-valid package body — an object, a view of it, and an app. */
function crmBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'com.example.crm',
        namespace: 'crm',
        version: '4.0.0',
        type: 'app',
        name: 'CRM',
        scope: 'cloud',
        objects: [{
            name: 'crm_lead',
            label: 'Lead',
            sharingModel: 'private',
            fields: { title: { type: 'text', label: 'Title' } },
        }],
        views: [{
            name: 'crm_lead_open',
            label: 'Open leads',
            object: 'crm_lead',
            viewKind: 'list',
            columns: [{ field: 'title', label: 'Title' }],
        }],
        // Not this verb's: seeds are data, and the door states what it did with them.
        data: [{ object: 'crm_lead', records: [{ title: 'First' }] }],
        // An empty bundle list converts into no `translation` item.
        translations: [],
        i18n: { defaultLocale: 'en' },
        ...extra,
    };
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

const registryCreatable = (type: string) =>
    DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type)?.allowRuntimeCreate ?? true;
const registryLoadOrder = (type: string) =>
    DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type)?.loadOrder ?? Number.MAX_SAFE_INTEGER;
/** The save door's own answer to "does this type declare `protection`", as the verb asks it. */
const protectionDeclarationOf = (type: string) => overlaySchemaDeclaredKey(type, 'protection');
const plan = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    planUnmanagedImport(body, {
        isRuntimeCreatable: registryCreatable, loadOrderOf: registryLoadOrder, protectionDeclarationOf, ...extra,
    });

const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_METADATA_WRITABLE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    resetEnvWritableMetadataTypes();
});

// The key classification's totality against `ManifestSchema` and the stack
// definition is held in spec, beside both schemas and the table itself
// (`packages/spec/src/kernel/unmanaged-install.test.ts`), so the PR that adds a
// key to either schema is the one that reddens.

describe('planUnmanagedImport — what the body alone answers', () => {
    it('plans a NEW base: `<id>-copy`, the SOURCE namespace kept, no scope, the identity carried', () => {
        const p = plan(crmBody());
        expect(p.sourcePackageId).toBe('com.example.crm');
        expect(p.sourceVersion).toBe('4.0.0');
        expect(p.targetPackageId).toBe('com.example.crm-copy');
        expect(p.namespace).toBe('crm');
        expect(p.baseManifest).toEqual({
            id: 'com.example.crm-copy',
            name: 'CRM',
            namespace: 'crm',
            version: '4.0.0',
            type: 'app',
        });
    });

    it('derives the namespace from the source id when the body declares none', () => {
        const { namespace: _ns, ...body } = crmBody();
        expect(plan(body).namespace).toBe('crm');
    });

    it('writes in registry loadOrder: the object before the view, the view before the app', () => {
        const p = plan(crmBody({ apps: [{ name: 'crm', label: 'CRM' }] }));
        expect(p.items.map((i) => `${i.type}/${i.name}`)).toEqual(['object/crm_lead', 'view/crm_lead_open', 'app/crm']);
    });

    it('names a view container by the object it binds, and lists the names it expands into', () => {
        const p = plan(crmBody({
            views: [{ object: 'crm_lead', list: { label: 'All', columns: [{ field: 'title' }] } }],
        }));
        const container = p.items.find((i) => i.type === 'view')!;
        expect(container.name).toBe('crm_lead');
        expect(container.expands.length).toBeGreaterThan(0);
    });

    it('leaves the door\'s keys and deployment configuration alone — neither copied nor refused', () => {
        const p = plan(crmBody({ requires: ['ui'], datasourceMapping: [] }));
        expect(p.items.map((i) => i.key)).not.toContain('data');
        expect(p.baseManifest).not.toHaveProperty('data');
        expect(p.baseManifest).not.toHaveProperty('i18n');
    });

    const uncreatable = UNMANAGED_IMPORT_COLLECTIONS.filter(([, type]) => !registryCreatable(type));
    it('has runtime-uncreatable collections to refuse — the premise, read off the registry', () => {
        expect(uncreatable.map(([key]) => key)).toEqual(expect.arrayContaining(['jobs', 'agents']));
    });

    for (const [key, type] of uncreatable) {
        it(`refuses \`${key}\` — '${type}' is runtime-uncreatable — with UNMANAGED_INSTALL_UNCOPYABLE / 422`, () => {
            let err: any;
            try { plan(crmBody({ [key]: [{ name: 'crm_probe' }] })); } catch (e) { err = e; }
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(422);
            expect(envelope.code).toBe('UNMANAGED_INSTALL_UNCOPYABLE');
            expect(err.details.findings.map((f: any) => f.key)).toEqual([key]);
        });
    }

    for (const key of ['functions', 'onEnable', 'plugins', 'main', 'objectExtensions', 'navigationContributions', 'packages', 'not_a_package_key']) {
        it(`refuses a body carrying \`${key}\` with UNMANAGED_INSTALL_UNCOPYABLE / 422, naming the key`, () => {
            let err: any;
            try { plan(crmBody({ [key]: key === 'onEnable' ? 'hook' : [{}] })); } catch (e) { err = e; }
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(422);
            expect(envelope.code).toBe('UNMANAGED_INSTALL_UNCOPYABLE');
            expect(err.details.findings.map((f: any) => f.key)).toEqual([key]);
            expect(err.message).toContain(`\`${key}\``);
        });
    }

    it('reads `installModes` and writes it nowhere — the door judges it; the base makes no promise about how it installs', () => {
        const p = plan(crmBody({ installModes: ['managed', 'unmanaged'] }));
        expect(p.baseManifest).not.toHaveProperty('installModes');
        expect(p.items.map((i) => i.key)).not.toContain('installModes');
    });

    it('an empty code container carries no code — `functions: {}` and `plugins: []` refuse nothing', () => {
        const p = plan(crmBody({ functions: {}, plugins: [], objectExtensions: [] }));
        expect(p.items.map((i) => `${i.type}/${i.name}`)).toEqual(['object/crm_lead', 'view/crm_lead_open']);
    });

    it('copies `translations` as one `translation` item per locale, named `<namespace>_<locale>`, bundles merged in order', () => {
        const p = plan(crmBody({
            translations: [
                {
                    en: { objects: { crm_lead: { label: 'Lead', fields: { title: { label: 'Title' } } } } },
                    'zh-CN': { objects: { crm_lead: { label: '线索', fields: { title: { label: '标题' } } } } },
                },
                // A second bundle on one locale: merged leaf by leaf, the later winning.
                { 'zh-CN': { objects: { crm_lead: { fields: { title: { label: '主题' } } } }, messages: { saved: '已保存' } } },
            ],
        }));
        const translations = p.items.filter((i) => i.type === 'translation');
        expect(translations.map((i) => i.name)).toEqual(['crm_en', 'crm_zh_cn']);
        expect(translations.every((i) => i.key === 'translations')).toBe(true);
        expect(translations.find((i) => i.name === 'crm_zh_cn')!.body).toEqual({
            name: 'crm_zh_cn',
            locale: 'zh-CN',
            objects: { crm_lead: { label: '线索', fields: { title: { label: '主题' } } } },
            messages: { saved: '已保存' },
        });
        // After every collection whose items it may name: registry loadOrder.
        expect(p.items.map((i) => i.type).indexOf('translation')).toBeGreaterThan(p.items.map((i) => i.type).indexOf('object'));
    });

    it('names the translation item after the namespace and the locale, in the save door\'s grammar', () => {
        expect(unmanagedTranslationItemName('crm', 'zh-CN')).toBe('crm_zh_cn');
        expect(unmanagedTranslationItemName('crm', 'en')).toBe('crm_en');
        expect(unmanagedTranslationItemName('crm', 'zh-Hant-TW')).toBe('crm_zh_hant_tw');
    });

    it('refuses a `translations` that is not a list of bundles — INVALID_REQUEST / 400, before anything is written', () => {
        for (const translations of [{ en: {} }, ['en'], [{ en: 'Lead' }]]) {
            let err: any;
            try { plan(crmBody({ translations })); } catch (e) { err = e; }
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(400);
            expect(envelope.code).toBe('INVALID_REQUEST');
            expect(err.message).toContain('`translations');
        }
    });

    it('refuses a target equal to the source, and one the id declaration refuses — 400, no code minted', () => {
        for (const targetPackageId of ['com.example.crm', 'not-a-reverse-domain-id']) {
            let err: any;
            try { plan(crmBody(), { targetPackageId }); } catch (e) { err = e; }
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(400);
            expect(envelope.code).toBe('VALIDATION_ERROR');
            expect(err.message).toContain('targetPackageId');
        }
    });

    it('refuses two items claiming one name, and a name the save door\'s grammar refuses — INVALID_REQUEST / 400', () => {
        for (const objects of [
            [{ name: 'crm_lead', label: 'A' }, { name: 'crm_lead', label: 'B' }],
            [{ name: 'CRM Lead', label: 'A' }],
        ]) {
            let err: any;
            try { plan(crmBody({ objects })); } catch (e) { err = e; }
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(400);
            expect(envelope.code).toBe('INVALID_REQUEST');
        }
    });
});

/** The vendor's reasons, verbatim — punctuation and all, since the answer quotes them. */
const VIEW_LOCK_REASON = 'Board-pack figures — edit the source package, not this view.';
const OBJECT_LOCK_REASON = 'The lead pipeline reads these fields; edit the source package.';
const PROTECTION = { lock: 'no-overlay', reason: OBJECT_LOCK_REASON, docsUrl: 'https://example.com/crm/locks' };

/**
 * The CRM body with three locks authored on it, in both spellings: the object
 * through the author-facing `protection` block (its type declares one), the
 * view through the `_lock` envelope with a reason and a docs link, the app
 * through `_lock` alone.
 */
function lockedCrmBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return crmBody({
        objects: [{
            name: 'crm_lead',
            label: 'Lead',
            sharingModel: 'private',
            fields: { title: { type: 'text', label: 'Title' } },
            protection: PROTECTION,
        }],
        views: [{
            name: 'crm_lead_open',
            label: 'Open leads',
            object: 'crm_lead',
            viewKind: 'list',
            columns: [{ field: 'title', label: 'Title' }],
            _lock: 'full',
            _lockReason: VIEW_LOCK_REASON,
            _lockSource: 'artifact',
            _lockDocsUrl: 'https://example.com/crm/view-lock',
        }],
        apps: [{ name: 'crm', label: 'CRM', _lock: 'no-delete' }],
        ...extra,
    });
}

/** The keys of either lock spelling a copied body must not carry. */
const LOCK_KEYS = ['_lock', '_lockReason', '_lockSource', '_lockDocsUrl', 'protection'];

/** The lock a MANAGED install binds for these lock keys — the loader's own translation, the oracle. */
function managedBinding(keys: Record<string, unknown>): { lock: unknown; reason: unknown } {
    const scratch = structuredClone(keys);
    applyProtection(scratch, { packageId: 'com.example.crm' });
    return { lock: scratch._lock, reason: scratch._lockReason };
}

describe('stripUnmanagedImportLock — the package\'s lock is not copied, in either spelling (ADR-0010)', () => {
    it('drops the `_lock` envelope — `_lockDocsUrl` included — and names the lock with the package\'s reason verbatim', () => {
        const body = {
            name: 'crm_lead_open', label: 'Open',
            _lock: 'full', _lockReason: VIEW_LOCK_REASON, _lockSource: 'package', _lockDocsUrl: 'https://example.com/why',
        };
        const out = stripUnmanagedImportLock('view', 'crm_lead_open', body);
        expect(out.body).toEqual({ name: 'crm_lead_open', label: 'Open' });
        expect(out.stripped).toEqual({ type: 'view', name: 'crm_lead_open', lock: 'full', reason: VIEW_LOCK_REASON });
        // The package's body is not mutated: the plan hands on a new one.
        expect(body._lock).toBe('full');
    });

    it('names a lock the package gave no reason for without a `reason`', () => {
        const out = stripUnmanagedImportLock('app', 'crm', { name: 'crm', _lock: 'no-delete' });
        expect(out.body).toEqual({ name: 'crm' });
        expect(out.stripped).toEqual({ type: 'app', name: 'crm', lock: 'no-delete' });
    });

    it('drops a `protection` block on a type that declares one — its `docsUrl` with it — and names its lock and reason', () => {
        const body = { name: 'crm_lead', label: 'Lead', protection: PROTECTION };
        const out = stripUnmanagedImportLock('object', 'crm_lead', body, protectionDeclarationOf('object'));
        expect(out.body).toEqual({ name: 'crm_lead', label: 'Lead' });
        expect(out.stripped).toEqual({ type: 'object', name: 'crm_lead', lock: 'no-overlay', reason: OBJECT_LOCK_REASON });
        expect(body.protection).toBe(PROTECTION);
    });

    it('both spellings on one item: ONE entry, the lock a managed install binds — measured on the loader\'s translation', () => {
        // The pair a managed install sees: `applyProtection` writes the
        // block's `lock` and `reason` over the envelope's. Measured here, not
        // assumed — the strip reports exactly what this oracle binds.
        const keys = { _lock: 'full', _lockReason: VIEW_LOCK_REASON, protection: { lock: 'no-delete', reason: OBJECT_LOCK_REASON } };
        expect(managedBinding(keys)).toEqual({ lock: 'no-delete', reason: OBJECT_LOCK_REASON });
        const out = stripUnmanagedImportLock('view', 'crm_lead_open', { name: 'crm_lead_open', ...keys }, protectionDeclarationOf('view'));
        expect(out.body).toEqual({ name: 'crm_lead_open' });
        expect(out.stripped).toEqual({ type: 'view', name: 'crm_lead_open', ...managedBinding(keys) });
    });

    it('`none` declares no lock, in either spelling: the keys go, and nothing is named', () => {
        expect(stripUnmanagedImportLock('app', 'crm', { name: 'crm', _lock: 'none', _lockReason: 'nothing to explain' }))
            .toEqual({ body: { name: 'crm' } });
        expect(stripUnmanagedImportLock(
            'app', 'crm', { name: 'crm', _lock: 'full', protection: { lock: 'none', reason: 'open on purpose' } }, protectionDeclarationOf('app'),
        )).toEqual({ body: { name: 'crm' } });
    });

    it('an item that carries no lock is handed on as the SAME body, and nothing is named', () => {
        const body = { name: 'crm', label: 'CRM' };
        const out = stripUnmanagedImportLock('app', 'crm', body, protectionDeclarationOf('app'));
        expect(out.body).toBe(body);
        expect(out.stripped).toBeUndefined();
    });

    it('a lock either spelling\'s declaration refuses is handed on untouched, for the save door to judge', () => {
        for (const body of [
            { name: 'crm', _lock: 'locked' },
            { name: 'crm', _lock: 'full', _lockReason: 42 },
            { name: 'crm', _lock: 'full', _lockSource: 'vendor' },
            { name: 'crm', _lock: 'full', _lockDocsUrl: 7 },
            { name: 'crm', protection: { lock: 'full' } },
            { name: 'crm', protection: { lock: 'sealed', reason: 'r' } },
        ]) {
            const out = stripUnmanagedImportLock('app', 'crm', body, protectionDeclarationOf('app'));
            expect(out.body).toBe(body);
            expect(out.stripped).toBeUndefined();
        }
    });

    it('a `protection` block on a type that declares none stays where it is — the save door refuses it as before', () => {
        expect(protectionDeclarationOf('page')).toBeUndefined();
        const out = stripUnmanagedImportLock(
            'page', 'crm_page', { name: 'crm_page', _lock: 'full', protection: PROTECTION }, protectionDeclarationOf('page'),
        );
        // The envelope still goes; the block, which the type does not declare, is the door's to refuse.
        expect(out.body).toEqual({ name: 'crm_page', protection: PROTECTION });
        expect(out.stripped).toEqual({ type: 'page', name: 'crm_page', lock: 'full' });
    });
});

describe('overlaySchemaDeclaredKey — which types declare `protection`, asked of the save door\'s own schema', () => {
    /** Whether the type's schema answers a bare `protection` block with an unrecognized-key refusal. */
    function refusesProtection(type: string): boolean {
        const result = getMetadataTypeSchema(type)!.safeParse({ protection: PROTECTION });
        const names = (issues: any[]): boolean => issues.some((issue) =>
            (issue.code === 'unrecognized_keys' && issue.path.length === 0 && issue.keys.includes('protection'))
            || (Array.isArray(issue.errors) && issue.errors.some((branch: any[]) => names(branch))));
        return !result.success && names(result.error.issues);
    }
    const types = listMetadataTypeSchemaTypes();

    it('every registered type is answered, and the answer never contradicts the schema\'s own verdict', () => {
        const declaring = types.filter((type) => overlaySchemaDeclaredKey(type, 'protection') !== undefined);
        // A population floor, so a walk that read nothing cannot pass.
        expect(declaring.length).toBeGreaterThanOrEqual(10);
        for (const type of types) {
            if (overlaySchemaDeclaredKey(type, 'protection') !== undefined) {
                expect(refusesProtection(type), `${type} is answered as declaring \`protection\` but refuses it`).toBe(false);
            }
            if (refusesProtection(type)) {
                expect(overlaySchemaDeclaredKey(type, 'protection'), `${type} refuses \`protection\` but is answered as declaring it`).toBeUndefined();
            }
        }
    });

    it('the three types measured refusing the block answer `undefined`; types that declare it answer its schema', () => {
        for (const type of ['action', 'hook', 'page']) {
            expect(refusesProtection(type)).toBe(true);
            expect(overlaySchemaDeclaredKey(type, 'protection')).toBeUndefined();
        }
        for (const type of ['object', 'view', 'app', 'dashboard', 'dataset']) {
            expect(overlaySchemaDeclaredKey(type, 'protection')?.safeParse(PROTECTION).success).toBe(true);
        }
    });
});

describe('planUnmanagedImport — the locks it strips', () => {
    it('plans every item without its lock in either spelling, and lists each lock in write order', () => {
        const p = plan(lockedCrmBody());
        expect(p.items.map((i) => `${i.type}/${i.name}`)).toEqual(['object/crm_lead', 'view/crm_lead_open', 'app/crm']);
        for (const item of p.items) {
            expect(Object.keys(item.body).filter((key) => LOCK_KEYS.includes(key))).toEqual([]);
        }
        expect(p.strippedLocks).toEqual([
            { type: 'object', name: 'crm_lead', lock: 'no-overlay', reason: OBJECT_LOCK_REASON },
            { type: 'view', name: 'crm_lead_open', lock: 'full', reason: VIEW_LOCK_REASON },
            { type: 'app', name: 'crm', lock: 'no-delete' },
        ]);
    });

    it('a package that locks nothing lists nothing', () => {
        expect(plan(crmBody()).strippedLocks).toEqual([]);
    });

    it('a package-level `metadataDefaults` lock never reaches the import: no package body declares the key, so it is refused', () => {
        // ADR-0010 §3.2 designs a package-wide default lock the loader would
        // resolve into each item's `_lock`. No schema declares
        // `metadataDefaults` today, so a body carrying it is refused whole. If
        // the key is ever declared (and classified for this import), this pin
        // reddens: a lock resolved from it must then be stripped too.
        let err: any;
        try { plan(crmBody({ metadataDefaults: { lock: 'full', lockReason: 'Vendor default' } })); } catch (e) { err = e; }
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('UNMANAGED_INSTALL_UNCOPYABLE');
        expect(err.details.findings.map((f: any) => f.key)).toEqual(['metadataDefaults']);
    });
});

describe('importUnmanagedPackage — the verb', () => {
    it('copies every item into a NEW base: package_id = the base, no organization column, nothing under the source id', async () => {
        const { protocol, table, packages } = makeProtocol();
        const result = await protocol.importUnmanagedPackage({ manifest: crmBody() });

        expect(ImportUnmanagedPackageResponseSchema.parse(result)).toEqual(result);
        expect(result).toEqual({
            sourcePackageId: 'com.example.crm',
            sourceVersion: '4.0.0',
            targetPackageId: 'com.example.crm-copy',
            namespace: 'crm',
            copiedCount: 2,
            copied: [{ type: 'object', name: 'crm_lead' }, { type: 'view', name: 'crm_lead_open' }],
            // The package locks nothing, so the copy dropped nothing.
            strippedLocks: [],
        });
        const rows = table('sys_metadata').map((r) => `${r.type}/${r.name}@${r.package_id}|org=${'organization_id' in r}|${r.state}`);
        expect(rows.sort()).toEqual([
            'object/crm_lead@com.example.crm-copy|org=false|active',
            'view/crm_lead_open@com.example.crm-copy|org=false|active',
        ]);
        // The base: scope-less (writable), the source namespace, a new id.
        expect(packages.get('com.example.crm-copy')?.manifest).toMatchObject({ id: 'com.example.crm-copy', namespace: 'crm' });
        expect(packages.get('com.example.crm-copy')?.manifest).not.toHaveProperty('scope');
        expect(packages.has('com.example.crm')).toBe(false);
    });

    it('copies the translation bundles into the base as `translation` rows — environment translations, reloaded at every boot', async () => {
        const { protocol, table } = makeProtocol();
        const result = await protocol.importUnmanagedPackage({
            manifest: crmBody({
                translations: [{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }],
            }),
        });
        expect(result.copied).toContainEqual({ type: 'translation', name: 'crm_zh_cn' });
        const row = table('sys_metadata').find((r) => r.type === 'translation' && r.name === 'crm_zh_cn' && r.state === 'active');
        expect(row).toBeDefined();
        expect({ package_id: row!.package_id, organization: 'organization_id' in row! })
            .toEqual({ package_id: 'com.example.crm-copy', organization: false });
        expect(JSON.parse(row!.metadata)).toMatchObject({ locale: 'zh-CN', objects: { crm_lead: { label: '线索' } } });
    });

    it('creates the copied object\'s table through the save door', async () => {
        const { protocol, ddl } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: crmBody() });
        expect(ddl).toContain('sync crm_lead');
    });

    it('hands the registry every copied item stamped `_provenance: \'org\'` — environment metadata, not package content', async () => {
        const { protocol, registered, objects } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: crmBody() });
        // A view is served from its registry item…
        const view = registered.filter((r) => r.type === 'view' && r.item?.name === 'crm_lead_open');
        expect(view.length).toBeGreaterThan(0);
        for (const r of view) expect(r.item._provenance).toBe('org');
        // …an object from its registered schema, under the BASE, never the source.
        const object = objects.filter((o) => o.item?.name === 'crm_lead');
        expect(object.length).toBeGreaterThan(0);
        for (const o of object) {
            expect(o.item._provenance).toBe('org');
            expect(o.packageId).toBe('com.example.crm-copy');
        }
    });

    it('lets the next save edit a copied item — editable shown by a write, not by a flag', async () => {
        const { protocol, table } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: crmBody() });

        // Editable, shown by a write.
        const edited = await protocol.saveMetaItem({
            type: 'view',
            name: 'crm_lead_open',
            packageId: 'com.example.crm-copy',
            item: {
                name: 'crm_lead_open',
                label: 'Open leads (edited)',
                object: 'crm_lead',
                viewKind: 'list',
                columns: [{ field: 'title', label: 'Title' }],
            },
        });
        expect(edited.success).toBe(true);
        const row = table('sys_metadata').find((r) => r.type === 'view' && r.name === 'crm_lead_open' && r.state === 'active');
        expect(JSON.parse(row!.metadata).label).toBe('Open leads (edited)');

        // …and the object, the type a MANAGED package seals against every edit.
        const object = await protocol.saveMetaItem({
            type: 'object',
            name: 'crm_lead',
            packageId: 'com.example.crm-copy',
            item: {
                name: 'crm_lead',
                label: 'Lead',
                sharingModel: 'private',
                fields: { title: { type: 'text', label: 'Title' }, source: { type: 'text', label: 'Source' } },
            },
        });
        expect(object.success).toBe(true);
        const objectRow = table('sys_metadata').find((r) => r.type === 'object' && r.name === 'crm_lead' && r.state === 'active');
        expect(Object.keys(JSON.parse(objectRow!.metadata).fields)).toEqual(['title', 'source']);
    });

    it('names each lock it dropped, in write order, with the package\'s reason verbatim — under the answer\'s declaration', async () => {
        const { protocol } = makeProtocol();
        const result = await protocol.importUnmanagedPackage({ manifest: lockedCrmBody() });
        expect(ImportUnmanagedPackageResponseSchema.parse(result)).toEqual(result);
        expect(result.strippedLocks).toEqual([
            { type: 'object', name: 'crm_lead', lock: 'no-overlay', reason: OBJECT_LOCK_REASON },
            { type: 'view', name: 'crm_lead_open', lock: 'full', reason: VIEW_LOCK_REASON },
            { type: 'app', name: 'crm', lock: 'no-delete' },
        ]);
    });

    it('writes no copied row with a lock key, in either spelling — `_lockDocsUrl` and the `protection` block included', async () => {
        const { protocol, table } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: lockedCrmBody() });
        const rows = table('sys_metadata').filter((r) => r.package_id === 'com.example.crm-copy');
        expect(rows.map((r) => `${r.type}/${r.name}`).sort()).toEqual(['app/crm', 'object/crm_lead', 'view/crm_lead_open']);
        const lockKeys = rows.flatMap((r) => Object.keys(JSON.parse(r.metadata))
            .filter((key) => LOCK_KEYS.includes(key))
            .map((key) => `${r.type}/${r.name}.${key}`));
        expect(lockKeys).toEqual([]);
    });

    it('the next save edits the copy of the item the package locked `full` — the save door admits it', async () => {
        const { protocol, table } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: lockedCrmBody() });
        const edited = await protocol.saveMetaItem({
            type: 'view',
            name: 'crm_lead_open',
            packageId: 'com.example.crm-copy',
            item: {
                name: 'crm_lead_open',
                label: 'Open leads (edited)',
                object: 'crm_lead',
                viewKind: 'list',
                columns: [{ field: 'title', label: 'Title' }],
            },
        });
        expect(edited.success).toBe(true);
        const row = table('sys_metadata').find((r) => r.type === 'view' && r.name === 'crm_lead_open' && r.state === 'active');
        expect(JSON.parse(row!.metadata).label).toBe('Open leads (edited)');
    });

    it('the copy of the item the package locked `no-delete` deletes', async () => {
        const { protocol } = makeProtocol();
        await protocol.importUnmanagedPackage({ manifest: lockedCrmBody() });
        const removed = await protocol.deleteMetaItem({ type: 'app', name: 'crm' });
        expect(removed.success).toBe(true);
    });

    it('a `protection` block on a type that declares none is still refused by the save door — INVALID_METADATA / 422, rolled back', async () => {
        const { protocol, packages, table } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            manifest: crmBody({ pages: [{ name: 'crm_page', label: 'Page', type: 'app', regions: [], protection: PROTECTION }] }),
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('INVALID_METADATA');
        expect(err.message).toContain("page 'crm_page' could not be written");
        expect(err.message).toContain('`protection`');
        expect(packages.size).toBe(0);
        expect(table('sys_metadata').filter((r) => r.package_id === 'com.example.crm-copy')).toEqual([]);
    });

    it('a lock family the spec refuses is not stripped: the save door refuses that item as before — INVALID_METADATA / 422, rolled back', async () => {
        const { protocol, packages, table } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            manifest: crmBody({ apps: [{ name: 'crm', label: 'CRM', _lock: 'locked' }] }),
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('INVALID_METADATA');
        expect(err.message).toContain("app 'crm' could not be written");
        expect(err.message).toContain('_lock');
        expect(packages.size).toBe(0);
        expect(table('sys_metadata').filter((r) => r.package_id === 'com.example.crm-copy')).toEqual([]);
    });

    for (const posture of ['isolated', 'group', 'nonsense']) {
        it(`refuses on a requested '${posture}' posture with UNMANAGED_INSTALL_WALLED_POSTURE / 409 and ZERO writes`, async () => {
            process.env.OS_TENANCY_POSTURE = posture;
            const { protocol, writes, packages } = makeProtocol();
            const err = await refusalOf(() => protocol.importUnmanagedPackage({ manifest: crmBody() }));
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(409);
            expect(envelope.code).toBe('UNMANAGED_INSTALL_WALLED_POSTURE');
            expect(err.details.posture).toBe(posture === 'nonsense' ? 'unrecognised' : posture);
            expect(writes).toEqual([]);
            expect(packages.size).toBe(0);
        });
    }

    it('the lit control: the same body under a requested `single` posture imports', async () => {
        process.env.OS_TENANCY_POSTURE = 'single';
        const { protocol } = makeProtocol();
        const result = await protocol.importUnmanagedPackage({ manifest: crmBody() });
        expect(result.copiedCount).toBe(2);
    });

    it('refuses a runtime-uncreatable type before any write — and the OS_METADATA_WRITABLE hatch does not open it', async () => {
        process.env.OS_METADATA_WRITABLE = 'job';
        resetEnvWritableMetadataTypes();
        const { protocol, writes, packages } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            manifest: crmBody({ jobs: [{ name: 'crm_sweep', label: 'Sweep', schedule: { type: 'cron', expression: '0 0 * * *' } }] }),
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('UNMANAGED_INSTALL_UNCOPYABLE');
        expect(writes).toEqual([]);
        expect(packages.size).toBe(0);
    });

    it('refuses a collision with an environment row before the base is created', async () => {
        const { protocol, table, packages } = makeProtocol();
        table('sys_metadata').push({
            id: 'existing', type: 'object', name: 'crm_lead', organization_id: null,
            package_id: 'com.example.studio', state: 'active', metadata: '{}',
        });
        const err = await refusalOf(() => protocol.importUnmanagedPackage({ manifest: crmBody() }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(409);
        expect(envelope.code).toBe('RESOURCE_CONFLICT');
        expect(err.details.collisions).toEqual([
            { type: 'object', name: 'crm_lead', heldBy: "an environment item of package 'com.example.studio'" },
        ]);
        expect(packages.size).toBe(0);
        expect(table('sys_metadata')).toHaveLength(1);
    });

    it('refuses a name a managed package ships before the base is created', async () => {
        const { protocol, packages } = makeProtocol({
            artifacts: [{ type: 'view', name: 'crm_lead_open', packageId: 'com.example.other' }],
        });
        const err = await refusalOf(() => protocol.importUnmanagedPackage({ manifest: crmBody() }));
        expect(resolveThrownHttpError(err).code).toBe('RESOURCE_CONFLICT');
        expect(err.details.collisions).toEqual([
            { type: 'view', name: 'crm_lead_open', heldBy: 'shipped by a managed package' },
        ]);
        expect(packages.size).toBe(0);
    });

    it('refuses an owned namespace — a managed install of the same package included — before the base is created', async () => {
        const { protocol, packages, writes } = makeProtocol({ owners: { crm: ['com.example.crm'] } });
        const err = await refusalOf(() => protocol.importUnmanagedPackage({ manifest: crmBody() }));
        expect(resolveThrownHttpError(err).code).toBe('RESOURCE_CONFLICT');
        expect(err.details).toEqual({ namespace: 'crm', owners: ['com.example.crm'] });
        expect(packages.size).toBe(0);
        expect(writes).toEqual([]);
    });

    it('refuses a target id that names an installed package — never into an existing base', async () => {
        const { protocol, engine, writes } = makeProtocol();
        engine.registry.installPackage({ id: 'com.example.mine', name: 'Mine' }, 'code');
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            manifest: crmBody(), targetPackageId: 'com.example.mine',
        }));
        expect(resolveThrownHttpError(err).code).toBe('RESOURCE_CONFLICT');
        expect(writes).toEqual([]);
    });

    it('refuses a package built for another protocol major before the base exists (ADR-0087 D1)', async () => {
        const { protocol, writes, packages } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            manifest: crmBody({ engines: { protocol: '^1' } }),
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(writes).toEqual([]);
        expect(packages.size).toBe(0);
    });

    it('refuses a request key its published declaration does not declare — 400, nothing written', async () => {
        const { protocol, writes } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({ manifest: crmBody(), installMode: 'unmanaged' }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(400);
        expect(envelope.code).toBe('VALIDATION_ERROR');
        expect(writes).toEqual([]);
    });

    it('a write that fails mid-copy deletes the base: no package record, no row, the item\'s own refusal thrown', async () => {
        const { protocol, table, packages, ddl } = makeProtocol();
        const err = await refusalOf(() => protocol.importUnmanagedPackage({
            // The second item is a view the save door refuses: it names no columns.
            manifest: crmBody({ views: [{ name: 'crm_lead_bad', label: 'Bad', object: 'crm_lead', viewKind: 'list' }] }),
        }));
        // The save door's own refusal, code and status kept: a spec-invalid body.
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('INVALID_METADATA');
        expect(err.message).toContain("view 'crm_lead_bad' could not be written");
        expect(err.message).toContain("the new base 'com.example.crm-copy' was removed");
        expect(err.details).toEqual({
            failedItem: { type: 'view', name: 'crm_lead_bad' },
            copiedBeforeFailure: 1,
            rolledBack: true,
        });
        expect(packages.size).toBe(0);
        expect(table('sys_metadata').filter((r) => r.package_id === 'com.example.crm-copy')).toEqual([]);
        // The object the copy created had its table made, then dropped by the rollback.
        expect(ddl).toEqual(expect.arrayContaining(['sync crm_lead', 'drop crm_lead']));
    });
});
