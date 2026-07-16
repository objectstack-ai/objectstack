// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cascade-on-delete behavior for parent→child foreign keys, with a REAL
 * {@link ObjectQL} engine + in-memory driver.
 *
 * Regression: deleting a parent whose child has a *required* lookup FK used to
 * default to `set_null`, issuing an UPDATE that cleared the required FK — which
 * the child's validator rejected with a misleading "<field> is required" 400
 * naming a field that isn't even on the object being deleted (CRM e2e gap).
 * A required FK can't be nulled, so the defaulted `set_null` now escalates to
 * `restrict`: the delete is refused with a clear dependent-count message
 * (`DELETE_RESTRICTED`, 409). Explicit `cascade`/`restrict` and optional
 * (nullable) lookups are unaffected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const acct = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
const oppRequired = {
    name: 'opp',
    label: 'Opportunity',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        // required lookup → can't be nulled
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', required: true },
    },
};
const noteOptional = {
    name: 'note',
    label: 'Note',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        body: { name: 'body', type: 'text' as const },
        // optional lookup → default set_null is valid
        account: { name: 'account', type: 'lookup' as const, reference: 'acct' },
    },
};
const taskCascade = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        // required FK but author explicitly opted into cascade
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', required: true, deleteBehavior: 'cascade' },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        findStream() { throw new Error('ns'); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

describe('cascadeDeleteRelations — required FK escalates set_null → restrict', () => {
    let engine: ObjectQL;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [acct, oppRequired, noteOptional, taskCascade]) engine.registry.registerObject(o as any);
    });

    it('refuses to delete a parent with a REQUIRED-FK child (DELETE_RESTRICTED, 409) and leaves both rows', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        await expect(engine.delete('acct', { where: { id: a.id } } as any))
            .rejects.toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'opp', dependentCount: 1 });

        // Nothing was deleted or mutated.
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
        expect((await engine.find('opp', {})).length).toBe(1);
    });

    it('deletes a parent that has no dependents', async () => {
        const a = await engine.insert('acct', { name: 'Empty' });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
    });

    it('nulls the FK for an OPTIONAL (nullable) lookup child and deletes the parent', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        const n = await engine.insert('note', { body: 'hi', account: a.id });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        const note = await engine.findOne('note', { where: { id: n.id } });
        expect(note).toBeTruthy();
        expect((note as any).account).toBeNull();
    });

    it('honors an explicit deleteBehavior:cascade on a required FK (children removed, no escalation)', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        const t = await engine.insert('task', { title: 'Follow up', account: a.id });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        expect(await engine.findOne('task', { where: { id: t.id } })).toBeNull();
    });

    it('[#3023] tags the referential set_null write with __referentialFieldClear so the owner guard can exempt it', async () => {
        // The cascade FK clear is an engine-internal integrity write. It must
        // carry the server-set marker plugin-security's ownership-anchor guard
        // keys off — otherwise nulling an owner_id-style FK would trip the
        // #3004 transfer guard and abort the cascade. A user-driven update must
        // NOT carry the marker (control).
        const seen: Array<{ op: string; marker: unknown; where: unknown }> = [];
        engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            if (opCtx.operation === 'update') {
                seen.push({
                    op: opCtx.operation,
                    marker: opCtx.context?.__referentialFieldClear,
                    where: opCtx.data,
                });
            }
            await next();
        });

        const a = await engine.insert('acct', { name: 'Acme' });
        const n = await engine.insert('note', { body: 'hi', account: a.id });

        // A normal user update — no marker.
        await engine.update('note', { id: n.id, body: 'edited' }, { context: { userId: 'u1' } } as any);
        // The cascade set_null when the parent is deleted — marked.
        await engine.delete('acct', { where: { id: a.id }, context: { userId: 'u1' } } as any);

        const userUpdate = seen.find((s) => (s.where as any)?.body === 'edited');
        const cascadeClear = seen.find((s) => (s.where as any)?.account === null);
        expect(userUpdate?.marker, 'user update carries no referential marker').toBeUndefined();
        expect(cascadeClear?.marker, 'cascade FK clear carries the marker').toBe(true);
        // And the cascade actually nulled the FK.
        expect((await engine.findOne('note', { where: { id: n.id } }) as any).account).toBeNull();
    });
});
