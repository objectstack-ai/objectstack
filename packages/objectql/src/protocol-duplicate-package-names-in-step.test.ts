// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0070 D4 — `duplicatePackage` keeps every copied name in step with what it
 * names: a field's key with its `name`, and a view item's `<object>.<viewKey>`
 * name with its object.
 *
 * ## The defects
 *
 * 1. **A field named after a prefixed object.** The free-text rewrite renamed a
 *    string equal to, or ending in, a prefixed object's name: its regex had a
 *    right identifier boundary and no left one. An object's `fields` keys are
 *    never renamed, so the field keyed `dupsrc_customer` was copied with
 *    `name: 'dupdst_customer'`, and `x_dupsrc_customer` with
 *    `name: 'x_dupdst_customer'`. The data plane addresses the column by the
 *    key; the save door's FLS lint reads the `name`, so a copied permission set
 *    with a rule on such a field was refused at the copy
 *    (`security-fls-unknown-field`).
 * 2. **A bare object's view item.** A non-object row was renamed by the
 *    source-prefix swap alone, so `ticket.board` (object `ticket`) kept its
 *    name while its body named the copy, `dupdst_ticket`: a by-name read naming
 *    no package served the source, and the copy was shadowed. The swap also
 *    moved the item of an object outside the package that carries the source
 *    prefix (`dupsrc_ext.board` → `dupdst_ext.board`) while its `object` stayed.
 * 3. **A view-item id inside a value.** A form action's `target`
 *    (`ticket.entry`) kept the bare object's name, so the copy's button opened
 *    the source's form.
 * 4. **A name that is both a prefixed object and a field key.** The free-text
 *    rewrite renamed a value equal to `dupsrc_customer` as the object even
 *    where it named the field of that key: a copied list view's `columns`
 *    named `dupdst_customer`, a field the copy does not have (refused at the
 *    copy, `list-view-field-unknown`), and a form's `sections[].fields` copied
 *    it silently.
 *
 * ## The rules now
 *
 * A record entry's `name` that echoes its key follows the key; free text
 * renames an object's name only as a whole identifier, and never a name that
 * is also a package object's field key (that one is renamed only at an
 * object-reference property, as a bare name is); a view item's object
 * part takes `renameMap`'s rename, whole, and its view key is left as stored;
 * a value that IS such a name, whole, follows it.
 *
 * ## Why a real kernel
 *
 * `ObjectQLPlugin` binds the real protocol to the real engine and registry, so
 * every pin reads the stored `sys_metadata` rows out of the driver, the data
 * plane writes through the engine, and the by-name read goes through the
 * protocol's own `getMetaItem` — never a payload.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-permission-field-keys.test.ts`; equality-only WHERE. */
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

/** Source package; `installPackage` derives its namespace `dupsrc`. */
const P = 'com.qa.dupsrc';
/** Target package; namespace `dupdst`, derived the same way. */
const Q = 'com.qa.dupdst';
/** A third package, whose objects the source's views and actions also name. */
const R = 'com.qa.dupext';

const PROSE = 'Linked from dupsrc_customer; see x_dupsrc_customer.';
const NOTE_PROSE = 'Attached to dupsrc_note; see x_dupsrc_note.';
const RULE = { readable: true, editable: false };

const grid = (object: string, columns: string[]) => ({ type: 'grid', data: { provider: 'object', object }, columns });
const form = (object: string, fields: string[]) => ({
    type: 'simple', data: { provider: 'object', object }, sections: [{ label: 'Main', fields }],
});

/**
 * A prefixed object with a field named after it, and one whose name merely
 * contains the source prefix in the middle and ends in the object's name.
 */
const customerBody = {
    name: 'dupsrc_customer', label: 'Customer', description: PROSE, sharingModel: 'private',
    fields: {
        full_name: { name: 'full_name', type: 'text', label: 'Full name' },
        dupsrc_customer: { name: 'dupsrc_customer', type: 'text', label: 'Customer code' },
        x_dupsrc_customer: { name: 'x_dupsrc_customer', type: 'text', label: 'Extra' },
    },
};
/** A prefixed object no field key spells: free text naming it follows the copy. */
const noteBody = {
    name: 'dupsrc_note', label: 'Note', description: NOTE_PROSE, sharingModel: 'private',
    fields: {
        x_dupsrc_note: { name: 'x_dupsrc_note', type: 'text', label: 'Extra' },
        customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
    },
};
/** The object whose name lacks the `dupsrc_` prefix, with a lookup to the prefixed one. */
const ticketBody = {
    name: 'ticket', label: 'Ticket', sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
    },
};
/** Objects of another package: not copied, so not renamed. The second carries the source prefix. */
const accountBody = {
    name: 'dupext_account', label: 'Account', sharingModel: 'private',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
};
const extBody = {
    name: 'dupsrc_ext', label: 'External', sharingModel: 'private',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
};

const viewItem = (object: string, key: string, viewKind: 'list' | 'form', config: unknown) => ({
    name: `${object}.${key}`, object, viewKind, label: key, config,
});
const formAction = (name: string, objectName: string, target: string) => ({
    name, label: name, type: 'form', objectName, target,
});
const opsBody = {
    name: 'dupsrc_ops', label: 'Ops',
    objects: { dupsrc_customer: { allowRead: true } },
    fields: { 'dupsrc_customer.dupsrc_customer': RULE, 'dupsrc_customer.x_dupsrc_customer': RULE },
};

describe('ADR-0070 D4 — duplicatePackage keeps a copied name in step with what it names', () => {
    let kernel: ObjectKernel;
    let stores: Stores;
    let engine: ObjectQL;
    let protocol: any;

    beforeEach(async () => {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        stores = new Map();
        engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        protocol = kernel.getService('protocol');
    });
    afterEach(async () => {
        if (kernel.getState() === 'running') await kernel.shutdown();
    });

    /** The stored `sys_metadata` rows, as the driver holds them. */
    const storedRows = () => Array.from(stores.get('sys_metadata')?.values() ?? []);
    const storedBody = (type: string, name: string, packageId: string): any => {
        const row = storedRows().find((r) => r.type === type && r.name === name && r.package_id === packageId);
        if (!row) return undefined;
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    };
    const storedNames = (type: string, packageId: string): string[] =>
        storedRows().filter((r) => r.type === type && r.package_id === packageId).map((r) => r.name as string).sort();

    async function save(packageId: string, type: string, item: { name: string }): Promise<void> {
        const res = await protocol.saveMetaItem({ type, name: item.name, packageId, item });
        expect(res.success).toBe(true);
    }

    /** Seeds the third package and the source, then duplicates the source. */
    async function duplicate(): Promise<any> {
        await protocol.installPackage({ manifest: { id: R, name: 'Other', type: 'app' } });
        await save(R, 'object', accountBody);
        await save(R, 'object', extBody);
        // [#24563] The source DECLARES the third package it references: the save
        // door judges a package's list view against the package's closure and
        // refuses a binding outside it (`list-view-object-outside-closure`), so
        // `dupext_account.board` and `dupsrc_ext.board` are views of objects
        // outside the package that the package may reach. The copy inherits the
        // declaration with the rest of the manifest.
        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'app', dependencies: { [R]: '*' } } });
        expect(engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
        await save(P, 'object', customerBody);
        await save(P, 'object', ticketBody);
        await save(P, 'object', noteBody);
        await save(P, 'view', viewItem('ticket', 'board', 'list', grid('ticket', ['title'])));
        await save(P, 'view', viewItem('dupsrc_customer', 'board', 'list', grid('dupsrc_customer', ['full_name', 'dupsrc_customer', 'x_dupsrc_customer'])));
        await save(P, 'view', viewItem('dupext_account', 'board', 'list', grid('dupext_account', ['name'])));
        await save(P, 'view', viewItem('dupsrc_ext', 'board', 'list', grid('dupsrc_ext', ['name'])));
        await save(P, 'view', viewItem('ticket', 'entry', 'form', form('ticket', ['title'])));
        await save(P, 'view', viewItem('dupsrc_customer', 'entry', 'form', form('dupsrc_customer', ['full_name', 'dupsrc_customer'])));
        await save(P, 'action', formAction('dupsrc_new_ticket', 'ticket', 'ticket.entry'));
        await save(P, 'action', formAction('dupsrc_new_customer', 'dupsrc_customer', 'dupsrc_customer.entry'));
        await save(P, 'action', formAction('dupsrc_new_account', 'dupext_account', 'dupext_account.entry'));
        await save(P, 'permission', opsBody);

        return protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });
    }

    it('a field named after a prefixed object keeps its key and its name, and the copy is usable by both', async () => {
        const res = await duplicate();

        // The copied permission set is no longer refused by the FLS lint.
        expect(res.failed).toEqual([]);
        const fields = storedBody('object', 'dupdst_customer', Q).fields;
        expect(Object.keys(fields)).toEqual(['full_name', 'dupsrc_customer', 'x_dupsrc_customer']);
        expect(fields.dupsrc_customer.name).toBe('dupsrc_customer');
        // NEGATIVE CONTROL: a field whose name merely contains the source prefix
        // in the middle keeps both its key and its name.
        expect(fields.x_dupsrc_customer.name).toBe('x_dupsrc_customer');
        // CONTROL: a reference to the object itself still follows the copy.
        expect(storedBody('object', 'dupdst_ticket', Q).fields.customer.reference).toBe('dupdst_customer');

        // The data plane addresses the column by the key the copy kept.
        await engine.insert('dupdst_customer', { id: 'c1', dupsrc_customer: 'C-1', x_dupsrc_customer: 'x' });
        expect(stores.get('dupdst_customer')?.get('c1')).toMatchObject({ dupsrc_customer: 'C-1', x_dupsrc_customer: 'x' });
        // The copied set's field rules land on those same names.
        expect(storedBody('permission', 'dupdst_ops', Q).fields).toEqual({
            'dupdst_customer.dupsrc_customer': RULE,
            'dupdst_customer.x_dupsrc_customer': RULE,
        });
    });

    it('free text renames an object\'s name only as a whole identifier, never inside a longer one', async () => {
        await duplicate();

        expect(storedBody('object', 'dupdst_note', Q).description)
            .toBe('Attached to dupdst_note; see x_dupsrc_note.');
        expect(Object.keys(storedBody('object', 'dupdst_note', Q).fields)).toEqual(['x_dupsrc_note', 'customer']);
        expect(storedBody('object', 'dupdst_note', Q).fields.x_dupsrc_note.name).toBe('x_dupsrc_note');
        // A copied view's column naming the field stays in step with the field.
        expect(storedBody('view', 'dupdst_customer.board', Q).config.columns)
            .toEqual(['full_name', 'dupsrc_customer', 'x_dupsrc_customer']);
        // The source is untouched.
        expect(storedBody('object', 'dupsrc_customer', P)).toMatchObject({ description: PROSE, fields: customerBody.fields });
    });

    it('a name that is both a prefixed object and a field key is renamed only at object-reference properties', async () => {
        const res = await duplicate();

        // The copied list view is no longer refused for a column the copy lacks.
        expect(res.failed).toEqual([]);
        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'view', name: 'dupdst_customer.board' },
            { type: 'view', name: 'dupdst_customer.entry' },
        ]));
        // A value naming the FIELD keeps naming it: list-view columns and form fields.
        const board = storedBody('view', 'dupdst_customer.board', Q);
        expect(board.config.columns).toEqual(['full_name', 'dupsrc_customer', 'x_dupsrc_customer']);
        const entry = storedBody('view', 'dupdst_customer.entry', Q);
        expect(entry.config.sections[0].fields).toEqual(['full_name', 'dupsrc_customer']);
        expect(Object.keys(storedBody('object', 'dupdst_customer', Q).fields)).toContain('dupsrc_customer');
        // A value naming the OBJECT at a reference property follows the copy.
        expect(board).toMatchObject({ object: 'dupdst_customer', config: { data: { object: 'dupdst_customer' } } });
        expect(entry).toMatchObject({ object: 'dupdst_customer', config: { data: { object: 'dupdst_customer' } } });
        expect(storedBody('object', 'dupdst_ticket', Q).fields.customer.reference).toBe('dupdst_customer');
        expect(storedBody('object', 'dupdst_note', Q).fields.customer.reference).toBe('dupdst_customer');
        expect(storedBody('action', 'dupdst_new_customer', Q).objectName).toBe('dupdst_customer');
        expect(Object.keys(storedBody('permission', 'dupdst_ops', Q).objects)).toEqual(['dupdst_customer']);
        // Free text naming it is left as stored (the ruled semantics: such a name
        // may name the field); free text naming an ordinary prefixed object still
        // follows the copy (the negative control, `dupsrc_note`, in the case above).
        expect(storedBody('object', 'dupdst_customer', Q).description).toBe(PROSE);
        // The copied record can be written through the copied form's fields.
        await engine.insert('dupdst_customer', { id: 'c2', full_name: 'Ada', dupsrc_customer: 'C-2' });
        expect(stores.get('dupdst_customer')?.get('c2')).toMatchObject({ full_name: 'Ada', dupsrc_customer: 'C-2' });
    });

    it('the copy of a bare object\'s view item takes the renamed object\'s prefix, and is the one a by-name read serves', async () => {
        const res = await duplicate();

        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'view', name: 'dupdst_ticket.board' },
            { type: 'view', name: 'dupdst_customer.board' },
        ]));
        expect(storedBody('view', 'dupdst_ticket.board', Q)).toMatchObject({ name: 'dupdst_ticket.board', object: 'dupdst_ticket' });
        // CONTROL: a prefixed object's item, renamed the same way.
        expect(storedBody('view', 'dupdst_customer.board', Q)).toMatchObject({ object: 'dupdst_customer' });
        // NEGATIVE CONTROL: no copy is left under the source's name.
        expect(storedBody('view', 'ticket.board', Q)).toBeUndefined();

        const copy = await protocol.getMetaItem({ type: 'view', name: 'dupdst_ticket.board' });
        expect(copy).toMatchObject({ packageId: Q, item: { object: 'dupdst_ticket' } });
        const source = await protocol.getMetaItem({ type: 'view', name: 'ticket.board' });
        expect(source).toMatchObject({ packageId: P, item: { object: 'ticket' } });
    });

    it('a view item of an object outside the package keeps its name, prefixed or not', async () => {
        await duplicate();

        // NEGATIVE CONTROL: neither object is renamed, so neither item is.
        expect(storedBody('view', 'dupext_account.board', Q)).toMatchObject({ object: 'dupext_account' });
        expect(storedBody('view', 'dupsrc_ext.board', Q)).toMatchObject({ object: 'dupsrc_ext' });
        expect(storedNames('view', Q)).toEqual([
            'dupdst_customer.board',
            'dupdst_customer.entry',
            'dupdst_ticket.board',
            'dupdst_ticket.entry',
            'dupext_account.board',
            'dupsrc_ext.board',
        ]);
        // The source keeps every item under its own name.
        expect(storedNames('view', P)).toEqual([
            'dupext_account.board',
            'dupsrc_customer.board',
            'dupsrc_customer.entry',
            'dupsrc_ext.board',
            'ticket.board',
            'ticket.entry',
        ]);
    });

    it('a form action\'s view-item target follows the copied view item', async () => {
        await duplicate();

        expect(storedBody('action', 'dupdst_new_ticket', Q)).toMatchObject({
            objectName: 'dupdst_ticket', target: 'dupdst_ticket.entry',
        });
        // CONTROL: a prefixed object's target, renamed the same way.
        expect(storedBody('action', 'dupdst_new_customer', Q).target).toBe('dupdst_customer.entry');
        // NEGATIVE CONTROL: a target on an object outside the package keeps its name.
        expect(storedBody('action', 'dupdst_new_account', Q).target).toBe('dupext_account.entry');
        // The source is untouched.
        expect(storedBody('action', 'dupsrc_new_ticket', P).target).toBe('ticket.entry');
    });
});
