// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0070 D4 — `duplicatePackage` gives an object whose name lacks the source
 * namespace prefix a name in the TARGET namespace, rewrites the references to
 * it, and refuses it up front when that name is already claimed.
 *
 * ## The defect
 *
 * The method renamed an object only when its name started with the source
 * prefix (`dupsrc_customer` → `dupdst_customer`). A name without it (`ticket`,
 * stored by a direct-publish save before that door read the prefix rule —
 * #24547 — or under a package that had no namespace) kept its name,
 * and an object name IS its registry key and its table: the copy was a second
 * claim on the source's object. It used to store a target row the registry
 * refused, over the source's table; since the ADR-0029 D9.9 refusal landed it
 * fails with an ownership prescription ("bind the customization to …, or have
 * … extend the object instead") that names no way out for a duplicate.
 *
 * ## What the copy is now
 *
 * ADR-0129 D2: every object a package defines is `${namespace}_${shortName}`,
 * and the prefix rule's own prescription for a missing prefix is
 * `${namespace}_${name}`. So `ticket` copies as `dupdst_ticket`, and every
 * reference to it follows — rewritten only where a property names an object,
 * so a FIELD called `ticket` and the word "ticket" in prose are left alone.
 *
 * ## Why a real kernel
 *
 * The claim that matters is between the stores the kernel assembles: the
 * `sys_metadata` rows the engine's driver holds, the `SchemaRegistry` that
 * owns each object name, and the data plane that addresses a table by that
 * name. `ObjectQLPlugin` binds the real protocol to the real engine and
 * registry, so every pin reads rows out of the driver and owners out of the
 * registry, never a payload.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-runtime-owner-overlay-refusal.test.ts`; equality-only WHERE. */
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

const PROSE = 'A support ticket raised by a customer';

const customerBody = {
    name: 'dupsrc_customer', label: 'Customer', sharingModel: 'private',
    fields: { full_name: { name: 'full_name', type: 'text', label: 'Full name' } },
};
/** The object whose name lacks the `dupsrc_` prefix. */
const ticketBody = {
    name: 'ticket', label: 'Ticket', description: PROSE, sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        customer: { name: 'customer', type: 'lookup', reference: 'dupsrc_customer', label: 'Customer' },
    },
};
/** A prefixed object whose lookup FIELD is called `ticket` and points at `ticket`. */
const noteBody = {
    name: 'dupsrc_note', label: 'Note', sharingModel: 'private',
    fields: {
        body: { name: 'body', type: 'text', label: 'Body' },
        ticket: { name: 'ticket', type: 'lookup', reference: 'ticket', label: 'Ticket' },
    },
};
const ticketViewsBody = {
    name: 'ticket_views', object: 'ticket',
    list: { label: 'All tickets', type: 'grid', columns: [{ field: 'title' }] },
};
/** A flow binds its object on a node `config`, which the derived site index does not walk. */
const onTicketBody = {
    name: 'dupsrc_on_ticket', label: 'On ticket', type: 'record_change',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'ticket', triggerType: 'record-after-create' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const opsBody = {
    name: 'dupsrc_ops', label: 'Ops',
    objects: { dupsrc_customer: { allowRead: true }, ticket: { allowRead: true } },
};

describe('ADR-0070 D4 — duplicatePackage of an object whose name lacks the source namespace prefix', () => {
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
    const owner = (name: string) => engine.registry.getObjectOwner(name)?.packageId;

    async function save(type: string, item: { name: string }): Promise<void> {
        const res = await protocol.saveMetaItem({ type, name: item.name, packageId: P, item });
        expect(res.success).toBe(true);
    }

    /**
     * [#24547] Store an object the direct save now refuses: ADR-0129 D2 holds
     * at that door too, so a bare name under a namespaced package is a row
     * stored before it read the rule. Staged while the package's installed
     * manifest declares no namespace, then the derived one is put back, so
     * every read after it sees the package exactly as installed.
     */
    async function saveStoredBeforeRule(type: string, item: { name: string }): Promise<void> {
        const manifest = engine.registry.getPackage(P)!.manifest as { namespace?: string };
        const namespace = manifest.namespace;
        delete manifest.namespace;
        try {
            await save(type, item);
        } finally {
            manifest.namespace = namespace;
        }
    }

    async function seedSource(extra: Array<[string, { name: string }]> = []): Promise<void> {
        await protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'app' } });
        expect(engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
        await save('object', customerBody);
        await saveStoredBeforeRule('object', ticketBody);
        await save('object', noteBody);
        await save('view', ticketViewsBody);
        await save('permission', opsBody);
        await save('flow', onTicketBody);
        for (const [type, item] of extra) await save(type, item);
        // CONTROL: the bare name is stored, owned by the source, under the
        // source's namespace — the row the copy has to rename.
        expect(owner('ticket')).toBe(P);
        expect(engine.registry.getPackage(P)?.manifest?.namespace).toBe('dupsrc');
    }

    it('copies a prefixed and a non-prefixed object, each into the target namespace', async () => {
        await seedSource();

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'object', name: 'dupdst_customer' },
            { type: 'object', name: 'dupdst_ticket' },
            { type: 'object', name: 'dupdst_note' },
        ]));
        // The copy is its own registry entry, owned by the target; the source
        // object keeps its owner.
        expect(owner('dupdst_ticket')).toBe(Q);
        expect(owner('dupdst_customer')).toBe(Q);
        expect(owner('ticket')).toBe(P);
        expect(storedBody('object', 'dupdst_ticket', Q)).toMatchObject({ name: 'dupdst_ticket', label: 'Ticket' });
        // NEGATIVE CONTROL: no target row under the source's name.
        expect(storedRows().filter((r) => r.type === 'object' && r.name === 'ticket').map((r) => r.package_id))
            .toEqual([P]);
    });

    it('references follow the new names; a field called `ticket` and the prose do not', async () => {
        await seedSource();

        await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        const ticketCopy = storedBody('object', 'dupdst_ticket', Q);
        expect(ticketCopy.fields.customer.reference).toBe('dupdst_customer');
        // NEGATIVE CONTROL: the bare word in free text is not a reference.
        expect(ticketCopy.description).toBe(PROSE);

        const noteCopy = storedBody('object', 'dupdst_note', Q);
        expect(noteCopy.fields.ticket.reference).toBe('dupdst_ticket');
        // NEGATIVE CONTROL: the lookup FIELD keeps its name, key and value alike.
        expect(Object.keys(noteCopy.fields)).toEqual(['body', 'ticket']);
        expect(noteCopy.fields.ticket.name).toBe('ticket');

        expect(storedBody('view', 'ticket_views', Q).object).toBe('dupdst_ticket');
        expect(storedBody('flow', 'dupdst_on_ticket', Q).nodes[0].config.objectName).toBe('dupdst_ticket');
        // A permission set is keyed by object name: both grants follow.
        expect(Object.keys(storedBody('permission', 'dupdst_ops', Q).objects).sort())
            .toEqual(['dupdst_customer', 'dupdst_ticket']);

        // The source is untouched.
        expect(storedBody('object', 'dupsrc_note', P).fields.ticket.reference).toBe('ticket');
        expect(Object.keys(storedBody('permission', 'dupsrc_ops', P).objects).sort())
            .toEqual(['dupsrc_customer', 'ticket']);
    });

    it('the copy has its own table: a record written through it never lands in the source\'s', async () => {
        await seedSource();
        await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        await engine.insert('dupdst_ticket', { id: 't_copy', title: 'In the copy' });
        await engine.insert('ticket', { id: 't_source', title: 'In the source' });

        expect([...(stores.get('dupdst_ticket')?.keys() ?? [])]).toEqual(['t_copy']);
        // NEGATIVE CONTROL: the source table holds only its own record.
        expect([...(stores.get('ticket')?.keys() ?? [])]).toEqual(['t_source']);
    });

    it('a name already claimed is refused up front, at the object, naming the rename', async () => {
        // `dupsrc_ticket` copies as `dupdst_ticket` — the name `ticket` would take.
        await seedSource([['object', {
            name: 'dupsrc_ticket', label: 'Prefixed ticket', sharingModel: 'private',
            fields: { title: { name: 'title', type: 'text', label: 'Title' } },
        } as { name: string }]]);
        const historyBefore = Array.from(stores.get('sys_metadata_history')?.values() ?? [])
            .filter((r) => r.name === 'dupdst_ticket').length;

        const res = await protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.success).toBe(false);
        expect(res.failed).toHaveLength(1);
        const [refusal] = res.failed;
        expect(refusal).toMatchObject({ type: 'object', name: 'ticket' });
        // Located: the object, the name it would take, who holds that name,
        // and the source rename that clears it.
        expect(refusal.error).toContain("Object 'ticket'");
        expect(refusal.error).toContain("'dupdst_ticket'");
        expect(refusal.error).toContain("'dupsrc_ticket'");
        expect(refusal.error).toContain("Rename 'ticket' on the source");

        // NEGATIVE CONTROL: the prefixed sibling took the name, with its own
        // body, and nothing of `ticket` was written under it.
        expect(owner('dupdst_ticket')).toBe(Q);
        expect(storedRows().filter((r) => r.type === 'object' && r.name === 'dupdst_ticket')).toHaveLength(1);
        expect(storedBody('object', 'dupdst_ticket', Q)).toMatchObject({ label: 'Prefixed ticket' });
        expect(Array.from(stores.get('sys_metadata_history')?.values() ?? [])
            .filter((r) => r.name === 'dupdst_ticket').length).toBe(historyBefore + 1);
        // Everything else still copies.
        expect(res.copied).toEqual(expect.arrayContaining([
            { type: 'object', name: 'dupdst_customer' },
            { type: 'object', name: 'dupdst_note' },
        ]));
    });
});
