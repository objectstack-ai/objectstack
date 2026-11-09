// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30794] The ADR-0070 D4 duplicate battery, replayed through the unmanaged
 * import with a `targetNamespace`.
 *
 * ## What is pinned
 *
 * The unmanaged import renames a copy into `targetNamespace` through the
 * duplicate's own rename engine (`package-namespace-rename.ts` in
 * `@objectstack/metadata-protocol`) — one engine, two callers. So every rule
 * the `protocol-duplicate-package-*` battery pins for `duplicatePackage` holds
 * for the import too: each fixture of that battery is declared as a package
 * body, imported into `com.qa.dupdst` under namespace `dupdst`, and the stored
 * rows are compared with the rows the duplicate of the same package stores.
 *
 * Where the duplicate reports an item in `failed[]` and copies the rest, the
 * import refuses the whole install before anything is written (`INVALID_REQUEST`
 * / 400, every refused item named, with the remedy "then install again"): an
 * unmanaged install is one copy of one package, never part of one.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * the save door, the registry and the data plane judge both doors' rows, and
 * every pin reads the stored rows out of the driver, never a payload.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-objects-key-collision.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
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

/** Source package; its namespace `dupsrc` is derived from the id. */
const P = 'com.qa.dupsrc';
/** Target package. */
const Q = 'com.qa.dupdst';
/** The namespace both doors copy into: the one `duplicatePackage` derives from `Q`. */
const TARGET_NS = 'dupdst';
/** A third package, whose objects the source's items also name. */
const R = 'com.qa.dupext';

interface Fixture {
    type: string;
    item: { name: string } & Record<string, unknown>;
    /** A bare object name under the namespaced source: a row stored before the save door read ADR-0129 D2 (#24547). */
    storedBeforeRule?: boolean;
}

/** The manifest collection each fixture type is declared under. */
const COLLECTION: Record<string, string> = {
    object: 'objects', view: 'views', action: 'actions', permission: 'permissions', flow: 'flows', hook: 'hooks',
};

interface Harness {
    kernel: ObjectKernel;
    stores: Stores;
    engine: ObjectQL;
    protocol: any;
}

const booted: Harness[] = [];

async function boot(): Promise<Harness> {
    // `logger.level` is the real config key, and gracefulShutdown:false keeps
    // process signal handlers out of vitest's fork workers (#4250).
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const stores: Stores = new Map();
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.bootstrap();
    const harness = { kernel, stores, engine, protocol: kernel.getService('protocol') as any };
    booted.push(harness);
    return harness;
}

afterEach(async () => {
    for (const { kernel } of booted.splice(0)) {
        if (kernel.getState() === 'running') await kernel.shutdown();
    }
});

async function save(h: Harness, packageId: string, type: string, item: { name: string }): Promise<void> {
    const res = await h.protocol.saveMetaItem({ type, name: item.name, packageId, item });
    expect(res.success, JSON.stringify(res)).toBe(true);
}

/** Saves a row while the package's manifest declares no namespace, then puts the derived one back (#24547). */
async function saveStoredBeforeRule(h: Harness, packageId: string, type: string, item: { name: string }): Promise<void> {
    const manifest = h.engine.registry.getPackage(packageId)!.manifest as { namespace?: string };
    const namespace = manifest.namespace;
    delete manifest.namespace;
    try {
        await save(h, packageId, type, item);
    } finally {
        manifest.namespace = namespace;
    }
}

/** Installs the third package and its objects — one prefixed, one carrying the source prefix (stored before the rule). */
async function seedOutside(h: Harness, outside: Fixture[]): Promise<void> {
    if (outside.length === 0) return;
    await h.protocol.installPackage({ manifest: { id: R, name: 'Other', type: 'app' } });
    for (const f of outside) {
        if (f.storedBeforeRule) await saveStoredBeforeRule(h, R, f.type, f.item);
        else await save(h, R, f.type, f.item);
    }
}

/** The source as a stored base — the rows `duplicatePackage` reads — then duplicated into `Q`. */
async function viaDuplicate(fixtures: Fixture[], outside: Fixture[] = []): Promise<{ h: Harness; res: any }> {
    const h = await boot();
    await seedOutside(h, outside);
    await h.protocol.installPackage({
        manifest: { id: P, name: 'Source', type: 'app', ...(outside.length > 0 ? { dependencies: { [R]: '*' } } : {}) },
    });
    expect(h.engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
    for (const f of fixtures) {
        if (f.storedBeforeRule) await saveStoredBeforeRule(h, P, f.type, f.item);
        else await save(h, P, f.type, f.item);
    }
    const res = await h.protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });
    return { h, res };
}

/** The same source as a package body. */
function packageBody(fixtures: Fixture[], outside: Fixture[] = []): Record<string, unknown> {
    const body: Record<string, any> = {
        id: P, name: 'Source', type: 'app', ...(outside.length > 0 ? { dependencies: { [R]: '*' } } : {}),
    };
    for (const { type, item } of fixtures) (body[COLLECTION[type]!] ??= []).push(item);
    return body;
}

/** The same source imported unmanaged straight into `Q` under `TARGET_NS`. */
async function viaImport(fixtures: Fixture[], outside: Fixture[] = []): Promise<{ h: Harness; res: any; error: any }> {
    const h = await boot();
    await seedOutside(h, outside);
    try {
        const res = await h.protocol.importUnmanagedPackage({
            manifest: packageBody(fixtures, outside), targetPackageId: Q, targetNamespace: TARGET_NS,
        });
        return { h, res, error: undefined };
    } catch (error) {
        return { h, res: undefined, error };
    }
}

const rowsOf = (h: Harness) => Array.from(h.stores.get('sys_metadata')?.values() ?? []);
const bodyOf = (row: Record<string, unknown>) => (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata);
const storedBody = (h: Harness, type: string, name: string, packageId: string): any => {
    const row = rowsOf(h).find((r) => r.type === type && r.name === name && r.package_id === packageId);
    return row ? bodyOf(row) : undefined;
};
/** Every row of one package: `type/name` → its stored body. */
const itemsOf = (h: Harness, packageId: string): Record<string, unknown> => Object.fromEntries(
    rowsOf(h)
        .filter((r) => r.package_id === packageId)
        .map((r) => [`${r.type}/${r.name}`, bodyOf(r)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
);

// ── `protocol-duplicate-package-names-in-step.test.ts` ─────────────────────

const PROSE = 'Linked from dupsrc_customer; see x_dupsrc_customer.';
const NOTE_PROSE = 'Attached to dupsrc_note; see x_dupsrc_note.';
const RULE = { readable: true, editable: false };
const grid = (object: string, columns: string[]) => ({ type: 'grid', data: { provider: 'object', object }, columns });
const form = (object: string, fields: string[]) => ({
    type: 'simple', data: { provider: 'object', object }, sections: [{ label: 'Main', fields }],
});
const viewItem = (object: string, key: string, viewKind: 'list' | 'form', config: unknown) => ({
    name: `${object}.${key}`, object, viewKind, label: key, config,
});
const formAction = (name: string, objectName: string, target: string) => ({
    name, label: name, type: 'form', objectName, target,
});

const namesInStepOutside: Fixture[] = [
    { type: 'object', item: { name: 'dupext_account', label: 'Account', sharingModel: 'private', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } },
    { type: 'object', item: { name: 'dupsrc_ext', label: 'External', sharingModel: 'private', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }, storedBeforeRule: true },
];
const namesInStep: Fixture[] = [
    {
        type: 'object', item: {
            name: 'dupsrc_customer', label: 'Customer', description: PROSE, sharingModel: 'private',
            fields: {
                full_name: { name: 'full_name', type: 'text', label: 'Full name' },
                dupsrc_customer: { name: 'dupsrc_customer', type: 'text', label: 'Customer code' },
                x_dupsrc_customer: { name: 'x_dupsrc_customer', type: 'text', label: 'Extra' },
            },
        },
    },
    {
        type: 'object', storedBeforeRule: true, item: {
            name: 'ticket', label: 'Ticket', sharingModel: 'private',
            fields: {
                title: { name: 'title', type: 'text', label: 'Title' },
                customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
            },
        },
    },
    {
        type: 'object', item: {
            name: 'dupsrc_note', label: 'Note', description: NOTE_PROSE, sharingModel: 'private',
            fields: {
                x_dupsrc_note: { name: 'x_dupsrc_note', type: 'text', label: 'Extra' },
                customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
            },
        },
    },
    { type: 'view', item: viewItem('ticket', 'board', 'list', grid('ticket', ['title'])) },
    { type: 'view', item: viewItem('dupsrc_customer', 'board', 'list', grid('dupsrc_customer', ['full_name', 'dupsrc_customer', 'x_dupsrc_customer'])) },
    { type: 'view', item: viewItem('dupext_account', 'board', 'list', grid('dupext_account', ['name'])) },
    { type: 'view', item: viewItem('dupsrc_ext', 'board', 'list', grid('dupsrc_ext', ['name'])) },
    { type: 'view', item: viewItem('ticket', 'entry', 'form', form('ticket', ['title'])) },
    { type: 'view', item: viewItem('dupsrc_customer', 'entry', 'form', form('dupsrc_customer', ['full_name', 'dupsrc_customer'])) },
    { type: 'action', item: formAction('dupsrc_new_ticket', 'ticket', 'ticket.entry') },
    { type: 'action', item: formAction('dupsrc_new_customer', 'dupsrc_customer', 'dupsrc_customer.entry') },
    { type: 'action', item: formAction('dupsrc_new_account', 'dupext_account', 'dupext_account.entry') },
    {
        type: 'permission', item: {
            name: 'dupsrc_ops', label: 'Ops',
            objects: { dupsrc_customer: { allowRead: true } },
            fields: { 'dupsrc_customer.dupsrc_customer': RULE, 'dupsrc_customer.x_dupsrc_customer': RULE },
        },
    },
];

// ── `protocol-duplicate-package-unprefixed-object.test.ts` ─────────────────

const TICKET_PROSE = 'A support ticket raised by a customer';
const unprefixedCustomer: Fixture = {
    type: 'object', item: {
        name: 'dupsrc_customer', label: 'Customer', sharingModel: 'private',
        fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
    },
};
const unprefixed: Fixture[] = [
    unprefixedCustomer,
    {
        type: 'object', storedBeforeRule: true, item: {
            name: 'ticket', label: 'Ticket', description: TICKET_PROSE, sharingModel: 'private',
            fields: {
                title: { name: 'title', type: 'text', label: 'Title' },
                customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
            },
        },
    },
    {
        type: 'object', item: {
            name: 'dupsrc_note', label: 'Note', sharingModel: 'private',
            fields: {
                body: { name: 'body', type: 'text', label: 'Body' },
                ticket: { name: 'ticket', type: 'lookup', reference: 'ticket', label: 'Ticket' },
            },
        },
    },
    // The battery's container is `ticket_views`; the import names every
    // container by the object it binds, so here both doors hold it as `ticket`.
    { type: 'view', storedBeforeRule: true, item: { name: 'ticket', object: 'ticket', list: { label: 'All tickets', type: 'grid', columns: [{ field: 'title' }] } } },
    {
        type: 'flow', item: {
            name: 'dupsrc_on_ticket', label: 'On ticket', type: 'record_change',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { objectName: 'ticket', triggerType: 'record-after-create' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
    },
    {
        type: 'permission', item: {
            name: 'dupsrc_ops', label: 'Ops',
            objects: { dupsrc_customer: { allowRead: true }, ticket: { allowRead: true } },
        },
    },
];

// ── `protocol-duplicate-package-permission-field-keys.test.ts` ─────────────

const HIDDEN = { readable: false, editable: false };
const LOCKED = { readable: true, editable: false };
const OPEN = { readable: true, editable: true };
const fieldKeysOutside: Fixture[] = [
    { type: 'object', item: { name: 'dupext_account', label: 'Account', sharingModel: 'private', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } },
];
const fieldKeys: Fixture[] = [
    {
        type: 'object', item: {
            name: 'dupsrc_customer', label: 'Customer', sharingModel: 'private',
            fields: {
                full_name: { name: 'full_name', type: 'text', label: 'Full name' },
                ticket: { name: 'ticket', type: 'text', label: 'Ticket reference' },
            },
        },
    },
    {
        type: 'object', storedBeforeRule: true, item: {
            name: 'ticket', label: 'Ticket', sharingModel: 'private',
            fields: {
                title: { name: 'title', type: 'text', label: 'Title' },
                ticket: { name: 'ticket', type: 'text', label: 'Ticket number' },
            },
        },
    },
    {
        type: 'permission', item: {
            name: 'dupsrc_fls', label: 'Field rules',
            objects: {
                dupsrc_customer: { allowRead: true, allowEdit: true },
                ticket: { allowRead: true, allowEdit: true },
                dupext_account: { allowRead: true },
            },
            fields: {
                'dupsrc_customer.full_name': HIDDEN,
                'dupsrc_customer.ticket': LOCKED,
                'ticket.title': HIDDEN,
                'ticket.ticket': OPEN,
                'dupext_account.name': LOCKED,
            },
        },
    },
];

// ── `protocol-duplicate-package-objects-key-collision.test.ts` ─────────────

const NARROW = { allowRead: true };
const WIDE = { allowRead: true, allowEdit: true, allowDelete: true };

/** The import's refusal, read off the thrown error: code, status, and each refused item. */
function refusalOf(error: any): { code: unknown; status: unknown; refused: Array<{ type: string; name: string; reason: string }> } {
    expect(error, 'the import refused nothing').toBeDefined();
    return {
        code: error?.code,
        status: error?.status ?? error?.statusCode,
        refused: error?.details?.refused ?? [],
    };
}

/** Nothing of the copy exists: no base, no row, no history, commit or audit row naming the target. */
function expectNothingWritten(h: Harness): void {
    expect(h.engine.registry.getPackage(Q)).toBeUndefined();
    expect(rowsOf(h).filter((r) => r.package_id === Q)).toEqual([]);
    const mentions = Array.from(h.stores.entries())
        .filter(([, rows]) => Array.from(rows.values()).some((row) => JSON.stringify(row).includes(`"${Q}"`)))
        .map(([table]) => table);
    expect(mentions).toEqual([]);
}

describe('[#30794] the duplicate battery, replayed through the unmanaged import into `targetNamespace`', () => {
    describe('the copy: both doors store the same items', () => {
        it('names in step: every object, view item, form action and field rule the duplicate copies', async () => {
            const dup = await viaDuplicate(namesInStep, namesInStepOutside);
            const imp = await viaImport(namesInStep, namesInStepOutside);

            expect(dup.res.failed).toEqual([]);
            expect(imp.error).toBeUndefined();
            expect(imp.res).toMatchObject({ targetPackageId: Q, namespace: TARGET_NS, sourceNamespace: 'dupsrc' });
            expect(itemsOf(imp.h, Q)).toEqual(itemsOf(dup.h, Q));

            // The battery's own pins, read off the import's rows — so the parity above is not vacuous.
            const customer = storedBody(imp.h, 'object', 'dupdst_customer', Q);
            expect(Object.keys(customer.fields)).toEqual(['full_name', 'dupsrc_customer', 'x_dupsrc_customer']);
            expect(customer.description).toBe(PROSE);
            expect(storedBody(imp.h, 'object', 'dupdst_note', Q).description).toBe('Attached to dupdst_note; see x_dupsrc_note.');
            expect(storedBody(imp.h, 'object', 'dupdst_ticket', Q).fields.customer.reference).toBe('dupdst_customer');
            expect(storedBody(imp.h, 'view', 'dupdst_customer.board', Q).config.columns)
                .toEqual(['full_name', 'dupsrc_customer', 'x_dupsrc_customer']);
            expect(Object.keys(itemsOf(imp.h, Q)).filter((k) => k.startsWith('view/'))).toEqual([
                'view/dupdst_customer.board',
                'view/dupdst_customer.entry',
                'view/dupdst_ticket.board',
                'view/dupdst_ticket.entry',
                'view/dupext_account.board',
                'view/dupsrc_ext.board',
            ]);
            expect(storedBody(imp.h, 'action', 'dupdst_new_ticket', Q)).toMatchObject({
                objectName: 'dupdst_ticket', target: 'dupdst_ticket.entry',
            });
            expect(storedBody(imp.h, 'action', 'dupdst_new_account', Q).target).toBe('dupext_account.entry');
            expect(storedBody(imp.h, 'permission', 'dupdst_ops', Q).fields).toEqual({
                'dupdst_customer.dupsrc_customer': RULE,
                'dupdst_customer.x_dupsrc_customer': RULE,
            });
            // The data plane addresses the copy's column by the key the copy kept.
            await imp.h.engine.insert('dupdst_customer', { id: 'c1', dupsrc_customer: 'C-1' });
            expect(imp.h.stores.get('dupdst_customer')?.get('c1')).toMatchObject({ dupsrc_customer: 'C-1' });
        });

        it('a bare object: its copy takes the target prefix, its container follows it, and references follow; prose and a field called `ticket` do not', async () => {
            const dup = await viaDuplicate(unprefixed);
            const imp = await viaImport(unprefixed);

            expect(dup.res.failed).toEqual([]);
            expect(imp.error).toBeUndefined();
            expect(itemsOf(imp.h, Q)).toEqual(itemsOf(dup.h, Q));

            expect(Object.keys(itemsOf(imp.h, Q))).toEqual([
                'flow/dupdst_on_ticket',
                'object/dupdst_customer',
                'object/dupdst_note',
                'object/dupdst_ticket',
                'permission/dupdst_ops',
                // The container named by its object is named by the object's copy.
                'view/dupdst_ticket',
            ]);
            expect(storedBody(imp.h, 'view', 'dupdst_ticket', Q)).toMatchObject({ name: 'dupdst_ticket', object: 'dupdst_ticket' });
            const ticket = storedBody(imp.h, 'object', 'dupdst_ticket', Q);
            expect(ticket.fields.customer.reference).toBe('dupdst_customer');
            expect(ticket.description).toBe(TICKET_PROSE);
            const note = storedBody(imp.h, 'object', 'dupdst_note', Q);
            expect(note.fields.ticket).toMatchObject({ name: 'ticket', reference: 'dupdst_ticket' });
            expect(storedBody(imp.h, 'flow', 'dupdst_on_ticket', Q).nodes[0].config.objectName).toBe('dupdst_ticket');
            expect(Object.keys(storedBody(imp.h, 'permission', 'dupdst_ops', Q).objects).sort())
                .toEqual(['dupdst_customer', 'dupdst_ticket']);
            // The copy has its own table, owned by the copy.
            expect(imp.h.engine.registry.getObjectOwner('dupdst_ticket')?.packageId).toBe(Q);
            await imp.h.engine.insert('dupdst_ticket', { id: 't_copy', title: 'In the copy' });
            expect([...(imp.h.stores.get('dupdst_ticket')?.keys() ?? [])]).toEqual(['t_copy']);
        });

        it('a permission set\'s `fields` keys: only the object part moves, and an object outside the package keeps its name', async () => {
            const dup = await viaDuplicate(fieldKeys, fieldKeysOutside);
            const imp = await viaImport(fieldKeys, fieldKeysOutside);

            expect(dup.res.failed).toEqual([]);
            expect(imp.error).toBeUndefined();
            expect(itemsOf(imp.h, Q)).toEqual(itemsOf(dup.h, Q));

            expect(storedBody(imp.h, 'permission', 'dupdst_fls', Q).fields).toEqual({
                'dupdst_customer.full_name': HIDDEN,
                'dupdst_customer.ticket': LOCKED,
                'dupdst_ticket.title': HIDDEN,
                'dupdst_ticket.ticket': OPEN,
                'dupext_account.name': LOCKED,
            });
        });
    });

    describe('the refusals: where the duplicate fails an item, the import refuses the install, before any write', () => {
        it('a bare object whose copy name a prefixed sibling\'s copy claims', async () => {
            const claimed: Fixture[] = [...unprefixed, {
                type: 'object', item: {
                    name: 'dupsrc_ticket', label: 'Prefixed ticket', sharingModel: 'private',
                    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
                },
            }];
            const dup = await viaDuplicate(claimed);
            expect(dup.res.failed[0]).toMatchObject({ type: 'object', name: 'ticket' });

            const imp = await viaImport(claimed);

            const refusal = refusalOf(imp.error);
            expect(refusal).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
            expect(refusal.refused.map((r) => `${r.type}/${r.name}`)).toEqual(['object/ticket']);
            const [ticket] = refusal.refused;
            expect(ticket!.reason).toContain("Object 'ticket'");
            expect(ticket!.reason).toContain("'dupdst_ticket'");
            expect(ticket!.reason).toContain("'dupsrc_ticket'");
            expect(ticket!.reason).toContain("Rename 'ticket' on the source");
            expect(ticket!.reason).toMatch(/then install again\.$/);
            expectNothingWritten(imp.h);
        });

        it('a permission set whose renamed `fields` key meets one it holds', async () => {
            const clash: Fixture[] = [unprefixedCustomer, {
                type: 'permission', item: {
                    name: 'dupsrc_clash', label: 'Clash',
                    objects: { dupsrc_customer: { allowRead: true } },
                    fields: { 'dupsrc_customer.full_name': HIDDEN, 'dupdst_customer.full_name': OPEN },
                },
            }];
            const dup = await viaDuplicate(clash);
            expect(dup.res.failed[0]).toMatchObject({ type: 'permission', name: 'dupsrc_clash' });

            const imp = await viaImport(clash);

            const refusal = refusalOf(imp.error);
            expect(refusal).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
            expect(refusal.refused).toEqual([expect.objectContaining({ type: 'permission', name: 'dupsrc_clash' })]);
            expect(refusal.refused[0]!.reason).toContain("Permission set 'dupsrc_clash' is not copied");
            expect(refusal.refused[0]!.reason).toContain("'dupsrc_customer.full_name'");
            expect(refusal.refused[0]!.reason).toContain("'dupdst_customer.full_name'");
            expect(refusal.refused[0]!.reason).toContain('on the source, then install again');
            expectNothingWritten(imp.h);
        });

        for (const [order, objects] of [
            ['the renamed key first', { dupsrc_customer: NARROW, dupdst_customer: WIDE }],
            ['the key it meets first', { dupdst_customer: WIDE, dupsrc_customer: NARROW }],
        ] as const) {
            it(`a permission set whose renamed \`objects\` key meets one it holds (${order})`, async () => {
                // The package body is not a stored row, so the at-rest shape the
                // duplicate's battery stages after the save is simply declared.
                const imp = await viaImport([unprefixedCustomer, {
                    type: 'permission', item: { name: 'dupsrc_objs', label: 'Objects', objects },
                }]);

                const refusal = refusalOf(imp.error);
                expect(refusal).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
                expect(refusal.refused).toEqual([expect.objectContaining({ type: 'permission', name: 'dupsrc_objs' })]);
                const { reason } = refusal.refused[0]!;
                expect(reason).toContain("Permission set 'dupsrc_objs' is not copied");
                expect(reason).toContain("`objects` key 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
                expect(reason).toContain("Remove 'dupsrc_customer' or 'dupdst_customer' on the source, then install again.");
                expectNothingWritten(imp.h);
            });
        }

        it('a translation whose renamed `objects` key meets one it holds', async () => {
            const h = await boot();
            let error: any;
            try {
                await h.protocol.importUnmanagedPackage({
                    manifest: {
                        ...packageBody([unprefixedCustomer]),
                        translations: [{ 'zh-CN': { objects: { dupsrc_customer: { label: 'Customer A' }, dupdst_customer: { label: 'Customer B' } } } }],
                    },
                    targetPackageId: Q, targetNamespace: TARGET_NS,
                });
            } catch (e) {
                error = e;
            }

            const refusal = refusalOf(error);
            expect(refusal).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
            expect(refusal.refused).toEqual([expect.objectContaining({ type: 'translation', name: 'dupsrc_zh_cn' })]);
            expect(refusal.refused[0]!.reason).toContain("Translation 'dupsrc_zh_cn' is not copied");
            expect(refusal.refused[0]!.reason).toContain("`objects` key 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
            expectNothingWritten(h);
        });

        it('a hook whose renamed `object` entry meets one it holds; without the second entry it copies', async () => {
            const hook = (object: string[]): Fixture => ({
                type: 'hook', item: {
                    name: 'dupsrc_stamp', object, events: ['beforeInsert'],
                    body: { language: 'js', source: "ctx.input.full_name = 'stamped';" },
                },
            });
            const imp = await viaImport([unprefixedCustomer, hook(['dupsrc_customer', 'dupdst_customer'])]);

            const refusal = refusalOf(imp.error);
            expect(refusal).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
            expect(refusal.refused).toEqual([expect.objectContaining({ type: 'hook', name: 'dupsrc_stamp' })]);
            expect(refusal.refused[0]!.reason).toContain("Hook 'dupsrc_stamp' is not copied");
            expect(refusal.refused[0]!.reason).toContain("`object` entry 'dupsrc_customer' follows the copied object to 'dupdst_customer'");
            expectNothingWritten(imp.h);

            // NEGATIVE CONTROL: the same hook without the second entry copies, its entry following the object.
            const again = await viaImport([unprefixedCustomer, hook(['dupsrc_customer'])]);
            expect(again.error).toBeUndefined();
            expect(storedBody(again.h, 'hook', 'dupdst_stamp', Q).object).toEqual(['dupdst_customer']);
        });
    });
});
