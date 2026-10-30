// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27842] The real engine, the real protocol: `GET /api/v1/meta/object/:name`
 * serves beside the object the packaged actions the ENGINE'S OWN activation
 * projection switches off — the projection both dispatch doors consult before
 * they refuse a call 409 `ACTION_DISABLED` — read through the kernel's service
 * table (`objectql`), as a host composes it.
 *
 * The protocol-side pins (absent / `[]` / the list / the cached door and its
 * 304) run over an engine double in `@objectstack/metadata-protocol`'s
 * `protocol.object-disabled-actions.test.ts`. What only this package can show
 * is that the double is honest: `ObjectQL.getDisabledActions` is the member the
 * protocol reaches, and it moves with `setActionActive`, the activation door's
 * own write, with no reload in between.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { InMemoryActionActivationStore } from './action-activation.js';
// [#21516] The rest of the stored-metadata family the repository writes through: the
// engine refuses a name the registry does not resolve, so the harness registers it as a boot does.
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] The real `sys_metadata` carries this — it is part of the
        // row's uniqueness key `(type, name, organization_id, package_id)` and
        // `SysMetadataRepository` writes it — but this minimal stub had omitted
        // it. Nothing noticed while an undeclared write key simply travelled to
        // the driver; the declared-field door judges the payload against this
        // map, so the omission now shows up as the fixture defect it always was.
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * Minimal stub driver covering only what `SysMetadataRepository`
 * exercises. Equality-only WHERE evaluation; one record store per object.
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;

    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them. The short-circuiting shape this stub used to carry
    // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
    // the same object, so a query like
    // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
    // was silently answered on the `$or` alone — a different query than the one
    // written, with the suite still green. See #7620.
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
            const expected = (v && typeof v === 'object' && '$eq' in (v as any))
                ? (v as any).$eq
                : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };

    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
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
        async delete(object: string, id: string) {
            return storeFor(object).delete(id);
        },
        async count(object: string, ast: any) {
            return (await this.find(object, ast)).length;
        },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

/** A package shipping one object with two record actions — the showcase shape (#27504). */
const SHOWCASE = {
    id: 'com.test.showcase', name: 'showcase',
    objects: [{
        name: 'da_task', label: 'Task',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        actions: [
            { name: 'da_mark_done', label: 'Mark Done', type: 'url', target: 'https://example.com/done', locations: ['record_header'] },
            { name: 'da_snooze', label: 'Snooze', type: 'url', target: 'https://example.com/snooze', locations: ['record_header'] },
        ],
    }],
};

async function hostWith(options: { ledger: boolean }) {
    const engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject);
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any);
    engine.registerApp(structuredClone(SHOWCASE));
    if (options.ledger) {
        engine.setActionActivationStore(new InMemoryActionActivationStore());
        await engine.hydrateActionActivations();
    }
    // The kernel's service table as `ObjectQLPlugin` fills it: the engine under `objectql`.
    const services = new Map<string, unknown>([['objectql', engine], ['data', engine]]);
    return { engine, protocol: new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>) };
}

const actionNames = (body: any): string[] => (Array.isArray(body?.actions) ? body.actions.map((a: any) => a?.name) : []);

describe('the object read serves the engine\'s own switched-off actions beside the item (#27842)', () => {
    it('a flip through the activation door is on the next read: named beside the item, `item.actions` unchanged', async () => {
        const { engine, protocol } = await hostWith({ ledger: true });
        const before: any = await protocol.getMetaItem({ type: 'object', name: 'da_task' } as any);
        expect(before.disabledActions).toEqual([]);

        await engine.setActionActive({ name: 'da_mark_done', packageId: 'com.test.showcase', active: false });
        const after: any = await protocol.getMetaItem({ type: 'object', name: 'da_task' } as any);

        expect(after.disabledActions).toEqual(['da_mark_done']);
        // The dispatch doors' answer for the same name — one fact, two readers.
        expect(engine.isActionEnabled('da_mark_done')).toBe(false);
        expect(actionNames(after.item)).toEqual(['da_mark_done', 'da_snooze']);
        expect(JSON.stringify(after.item.actions)).toBe(JSON.stringify(before.item.actions));

        await engine.setActionActive({ name: 'da_mark_done', packageId: 'com.test.showcase', active: true });
        expect(((await protocol.getMetaItem({ type: 'object', name: 'da_task' } as any)) as any).disabledActions).toEqual([]);
    });

    it('the list and the cached default door read the same projection', async () => {
        const { engine, protocol } = await hostWith({ ledger: true });
        await engine.setActionActive({ name: 'da_snooze', packageId: 'com.test.showcase', active: false });

        const list: any = await protocol.getMetaItems({ type: 'object' });
        expect(list.disabledActions.da_task).toEqual(['da_snooze']);

        const cached: any = await protocol.getMetaItemCached({ type: 'object', name: 'da_task' });
        expect(cached.disabledActions).toEqual(['da_snooze']);
        expect(actionNames(cached.data)).toEqual(['da_mark_done', 'da_snooze']);
    });

    it('control: an engine with no ledger attached serves no key at all — never `[]`', async () => {
        const { protocol } = await hostWith({ ledger: false });

        const read: any = await protocol.getMetaItem({ type: 'object', name: 'da_task' } as any);
        expect(read).not.toHaveProperty('disabledActions');
        expect(actionNames(read.item)).toEqual(['da_mark_done', 'da_snooze']);
        expect(await protocol.getMetaItems({ type: 'object' })).not.toHaveProperty('disabledActions');
    });
});
