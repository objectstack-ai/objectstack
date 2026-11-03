// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28802, ADR-0146 D2, #28390 ruling A] Member-grain coexistence on a base's
 * address, for a bundle type (`ITEM_KEY_DISCRIMINATORS`: `email_template`,
 * one item per `(name, locale)`).
 *
 * A base ships a template in `en-US` only. Its address — the read naming it,
 * the read naming no package, the list scoped to it, the env-wide list and
 * the executing list — serves the base's members, its pair's declared
 * overrides, and its pair's own ADDED members (a locale the base does not
 * ship). A dependent package's added member under the base's name is served
 * only under that package's own address.
 *
 * Pinned through the real protocol over the real `ObjectQL` engine and an
 * in-memory driver (the harness of
 * `protocol-custom-override-effective-read.test.ts`), every package
 * installed through the package door with its dependency declared, every row
 * written through the draft save and the per-item publish.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.default.acme-addon';
/** Shipped in `en-US` only. */
const NAME = 'task_done_email';
/** Shipped in `fr-FR` only: a bundle with no canonical member. */
const FR_ONLY = 'task_late_email';
const TYPE = 'email_template';
/** A non-bundle type's item the base ships, for the control: its identity is its name alone. */
const VIEW = 'showcase_task.default';
const BASE_COLUMNS = ['title', 'status'];

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        bundle_member: { name: 'bundle_member', label: 'Bundle Member', type: 'text' as const, maxLength: 100 },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
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
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
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
    return { driver, stores };
}

const template = (name: string, locale: string, subject: string) => ({
    name, locale, label: name, subject, bodyHtml: `<p>${subject}</p>`, bodyText: `${subject} body`, active: true,
});

function baseManifest(): Record<string, unknown> {
    return {
        id: BASE,
        name: 'showcase',
        version: '1.0.0',
        namespace: 'showcase',
        emailTemplates: [template(NAME, 'en-US', 'Base EN'), template(FR_ONLY, 'fr-FR', 'Base late FR')],
        objects: [{
            name: 'showcase_task',
            label: 'Task',
            sharingModel: 'private',
            fields: Object.fromEntries(BASE_COLUMNS.map((f) => [f, { name: f, label: f, type: 'text' }])),
        }],
        views: [{
            object: 'showcase_task',
            list: {
                label: 'All Tasks',
                type: 'grid',
                data: { provider: 'object', object: 'showcase_task' },
                columns: BASE_COLUMNS.map((field) => ({ field })),
            },
        }],
    };
}

async function boot() {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(baseManifest());
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { engine, protocol };
}

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

/** Installs a writable package through the package door (the pair as its ensure door writes it). */
async function install(protocol: ObjectStackProtocolImplementation, id: string): Promise<void> {
    await (protocol as any).installPackage({
        manifest: {
            id, name: id.split('.').join('-'), version: '0.1.0', type: 'app',
            ...(id === PAIR
                ? { namespace: 'showcase_custom', dependencies: { [BASE]: '^1' } }
                : { dependencies: { [BASE]: '*' } }),
        },
    });
}

/** A draft save naming the package, then the per-item publish naming it and the member. */
async function publishInto(
    protocol: ObjectStackProtocolImplementation, packageId: string, name: string, locale: string, subject: string,
    extra: Record<string, unknown> = {},
): Promise<void> {
    const item = { ...template(name, locale, subject), ...extra };
    await protocol.saveMetaItem({ type: TYPE, name, item, mode: 'draft', packageId } as any);
    await protocol.publishMetaItem({ type: TYPE, name, packageId, member: locale } as any);
}

/** The by-name read: `[subject, locale, _packageId]`, or `404` when nothing is served. */
const byName = async (protocol: ObjectStackProtocolImplementation, name: string, member?: string, packageId?: string) => {
    try {
        const res: any = await protocol.getMetaItem({ type: TYPE, name, ...(member ? { member } : {}), ...(packageId ? { packageId } : {}) });
        const item = res?.item;
        if (item === undefined || item === null) return 404;
        return [item.subject, item.locale, item._packageId];
    } catch (error: any) {
        if (error?.status === 404) return 404;
        throw error;
    }
};
const rowsOf = (items: any[], name: string) => items
    .filter((i) => i?.name === name)
    .map((i) => [i.locale, i._packageId, i.subject])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
/** A list's members of `name`, as `[locale, _packageId, subject]` by locale. */
const listed = async (protocol: ObjectStackProtocolImplementation, name: string, packageId?: string) =>
    rowsOf(((await protocol.getMetaItems({ type: TYPE, ...(packageId ? { packageId } : {}) })) as any).items, name);
const executing = async (protocol: ObjectStackProtocolImplementation, name: string) =>
    rowsOf(((await protocol.getMetaItemsForExecution({ type: TYPE })) as any).items, name);

/** The control's view items of a list, as `[_packageId, columns]`. */
const listedViews = async (protocol: ObjectStackProtocolImplementation, packageId?: string) =>
    (((await protocol.getMetaItems({ type: 'view', ...(packageId ? { packageId } : {}) })) as any).items as any[])
        .filter((i) => i?.name === VIEW)
        .map((i) => [i._packageId, (i?.config?.columns ?? i?.columns ?? []).map((c: any) => c?.field ?? c)]);

const BASE_EN = ['en-US', BASE, 'Base EN'];
const PAIR_FR = ['fr-FR', PAIR, 'Pair FR'];

describe('[#28802] a bundle member on the base\'s address, at member grain', () => {
    it('the pair\'s own added member is served by the by-name reads and listed by the base\'s lists and the executing list', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await publishInto(protocol, PAIR, NAME, 'fr-FR', 'Pair FR');

        expect(await byName(protocol, NAME, 'fr-FR', BASE)).toEqual(['Pair FR', 'fr-FR', PAIR]);
        expect(await byName(protocol, NAME, 'fr-FR')).toEqual(['Pair FR', 'fr-FR', PAIR]);
        expect(await listed(protocol, NAME)).toEqual([BASE_EN, PAIR_FR]);
        expect(await listed(protocol, NAME, BASE)).toEqual([BASE_EN, PAIR_FR]);
        expect(await executing(protocol, NAME)).toEqual([BASE_EN, PAIR_FR]);
        // Unchanged: the pair's own address, and the base's member on the base's address.
        expect(await listed(protocol, NAME, PAIR)).toEqual([PAIR_FR]);
        expect(await byName(protocol, NAME, 'fr-FR', PAIR)).toEqual(['Pair FR', 'fr-FR', PAIR]);
        expect(await byName(protocol, NAME, 'en-US', BASE)).toEqual(['Base EN', 'en-US', BASE]);
    });

    it('a dependent\'s added member is served under the dependent only; the base\'s address answers 404 for it', async () => {
        const { protocol } = await boot();
        await install(protocol, DEPENDENT);
        await publishInto(protocol, DEPENDENT, NAME, 'fr-FR', 'Dependent FR');

        expect(await byName(protocol, NAME, 'fr-FR', DEPENDENT)).toEqual(['Dependent FR', 'fr-FR', DEPENDENT]);
        expect(await listed(protocol, NAME, DEPENDENT)).toEqual([['fr-FR', DEPENDENT, 'Dependent FR']]);
        expect(await byName(protocol, NAME, 'fr-FR', BASE)).toBe(404);
        expect(await byName(protocol, NAME, 'fr-FR')).toBe(404);
        expect(await listed(protocol, NAME)).toEqual([BASE_EN]);
        expect(await listed(protocol, NAME, BASE)).toEqual([BASE_EN]);
        expect(await executing(protocol, NAME)).toEqual([BASE_EN]);
    });

    it('with a dependent\'s member at the same locale, the base\'s address still serves the pair\'s', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await install(protocol, DEPENDENT);
        await publishInto(protocol, PAIR, NAME, 'fr-FR', 'Pair FR');
        await publishInto(protocol, DEPENDENT, NAME, 'fr-FR', 'Dependent FR');

        expect(await byName(protocol, NAME, 'fr-FR', BASE)).toEqual(['Pair FR', 'fr-FR', PAIR]);
        expect(await byName(protocol, NAME, 'fr-FR')).toEqual(['Pair FR', 'fr-FR', PAIR]);
        expect(await byName(protocol, NAME, 'fr-FR', DEPENDENT)).toEqual(['Dependent FR', 'fr-FR', DEPENDENT]);
        expect(await listed(protocol, NAME)).toEqual([BASE_EN, PAIR_FR]);
        expect(await executing(protocol, NAME)).toEqual([BASE_EN, PAIR_FR]);
    });

    it('a read naming no member of a bundle with no canonical member serves the base\'s member, not a dependent\'s canonical one', async () => {
        const { protocol } = await boot();
        await install(protocol, DEPENDENT);
        await publishInto(protocol, DEPENDENT, FR_ONLY, 'en-US', 'Dependent late EN');

        expect(await byName(protocol, FR_ONLY, undefined, BASE)).toEqual(['Base late FR', 'fr-FR', BASE]);
        expect(await byName(protocol, FR_ONLY)).toEqual(['Base late FR', 'fr-FR', BASE]);
        expect(await byName(protocol, FR_ONLY, 'en-US', BASE)).toBe(404);
        expect(await byName(protocol, FR_ONLY, 'en-US', DEPENDENT)).toEqual(['Dependent late EN', 'en-US', DEPENDENT]);
    });

    it('control: a non-bundle type keeps name grain: a pair\'s and a dependent\'s same-named view stay out of the base\'s lists', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await install(protocol, DEPENDENT);
        // Rows the override write gate refuses today (an undeclared pair row, a
        // dependent's row under the name the base ships), laid down as stored before it.
        for (const [packageId, columns] of [[PAIR, ['title']], [DEPENDENT, ['status']]] as const) {
            const item = {
                name: VIEW, object: 'showcase_task', viewKind: 'list', label: 'All Tasks',
                config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: columns.map((field) => ({ field })) },
            };
            const gated = protocol as any;
            gated.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
            try {
                await protocol.saveMetaItem({ type: 'view', name: VIEW, item, mode: 'draft', packageId } as any);
                await protocol.publishMetaItem({ type: 'view', name: VIEW, packageId } as any);
            } finally {
                delete gated.overrideWriteVerdict;
            }
        }
        // The rows reach the list read: the per-package layer carries all three bodies.
        const perPackage = (((await (protocol as any).getMetaItemsPerPackage({ type: 'view' })) as any).items as any[])
            .filter((i) => i?.name === VIEW)
            .map((i) => (i?.config?.columns ?? []).map((c: any) => c?.field ?? c).join(','))
            .sort();
        expect(perPackage).toEqual(['status', 'title', 'title,status']);
        expect(await listedViews(protocol)).toEqual([[BASE, BASE_COLUMNS]]);
        expect(await listedViews(protocol, BASE)).toEqual([[BASE, BASE_COLUMNS]]);
        // Beside it, the bundle's members on the same reads are untouched by the view rows.
        expect(await listed(protocol, NAME)).toEqual([BASE_EN]);
    });

    it('control: the pair\'s declared override of the base\'s member is served as the base\'s; the pair\'s own member beside it too', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await publishInto(protocol, PAIR, NAME, 'en-US', 'Override EN', { overrides: { package: BASE, basedOn: '1.0.0' } });
        await publishInto(protocol, PAIR, NAME, 'fr-FR', 'Pair FR');

        expect(await byName(protocol, NAME, 'en-US', BASE)).toEqual(['Override EN', 'en-US', BASE]);
        expect(await byName(protocol, NAME, 'en-US')).toEqual(['Override EN', 'en-US', BASE]);
        expect(await listed(protocol, NAME)).toEqual([['en-US', BASE, 'Override EN'], PAIR_FR]);
        expect(await listed(protocol, NAME, BASE)).toEqual([['en-US', BASE, 'Override EN'], PAIR_FR]);
        expect(await executing(protocol, NAME)).toEqual([['en-US', BASE, 'Override EN'], PAIR_FR]);
    });
});

/** The layered read: `{ code, overlay, effective }` subjects (or view columns), or `404` when no layer answers. */
const layersOf = async (protocol: ObjectStackProtocolImplementation, type: string, name: string, member?: string, packageId?: string) => {
    try {
        const res: any = await (protocol as any).getMetaItemLayered({
            type, name, ...(member ? { member } : {}), ...(packageId ? { packageId } : {}),
        });
        const pick = (item: any) => (item === null || item === undefined
            ? null
            : type === 'view'
                ? (item?.config?.columns ?? item?.columns ?? []).map((c: any) => c?.field ?? c)
                : [item.subject, item.locale]);
        // The protocol answers no layer at all as three nulls; the `/layers` door turns that into 404.
        if (res.code == null && res.overlay == null && res.effective == null) return 404;
        return { code: pick(res.code), overlay: pick(res.overlay), effective: pick(res.effective) };
    } catch (error: any) {
        if (error?.status === 404) return 404;
        throw error;
    }
};

describe('[#28830] the layered read on the base\'s address, at member grain', () => {
    it('the pair\'s own added member answers with the pair\'s layer, naming the base and naming no package', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await publishInto(protocol, PAIR, NAME, 'fr-FR', 'Pair FR');

        const PAIR_LAYERS = { code: null, overlay: ['Pair FR', 'fr-FR'], effective: ['Pair FR', 'fr-FR'] };
        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR', BASE)).toEqual(PAIR_LAYERS);
        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR')).toEqual(PAIR_LAYERS);
        // Unchanged: the pair's own address, and the base's member.
        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR', PAIR)).toEqual(PAIR_LAYERS);
        expect(await layersOf(protocol, TYPE, NAME, 'en-US', BASE))
            .toEqual({ code: ['Base EN', 'en-US'], overlay: null, effective: ['Base EN', 'en-US'] });
    });

    it('a dependent\'s added member stays 404 on the base\'s layered read and answers under the dependent', async () => {
        const { protocol } = await boot();
        await install(protocol, DEPENDENT);
        await publishInto(protocol, DEPENDENT, NAME, 'fr-FR', 'Dependent FR');

        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR', BASE)).toBe(404);
        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR')).toBe(404);
        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR', DEPENDENT))
            .toEqual({ code: null, overlay: ['Dependent FR', 'fr-FR'], effective: ['Dependent FR', 'fr-FR'] });
    });

    it('with a dependent\'s member at the same locale, the base\'s layered read answers the pair\'s', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await install(protocol, DEPENDENT);
        await publishInto(protocol, PAIR, NAME, 'fr-FR', 'Pair FR');
        await publishInto(protocol, DEPENDENT, NAME, 'fr-FR', 'Dependent FR');

        expect(await layersOf(protocol, TYPE, NAME, 'fr-FR', BASE))
            .toEqual({ code: null, overlay: ['Pair FR', 'fr-FR'], effective: ['Pair FR', 'fr-FR'] });
    });

    it('control: a declared override of the base\'s member, and a non-bundle type, answer as before', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await publishInto(protocol, PAIR, NAME, 'en-US', 'Override EN', { overrides: { package: BASE, basedOn: '1.0.0' } });

        expect(await layersOf(protocol, TYPE, NAME, 'en-US', BASE))
            .toEqual({ code: ['Base EN', 'en-US'], overlay: ['Override EN', 'en-US'], effective: ['Override EN', 'en-US'] });
        expect(await layersOf(protocol, 'view', VIEW, undefined, BASE))
            .toEqual({ code: BASE_COLUMNS, overlay: null, effective: BASE_COLUMNS });
    });
});
