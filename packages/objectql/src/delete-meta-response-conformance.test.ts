// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13155 — conformance gate: the body `deleteMetaItem` really returns must
 * parse through `DeleteMetaItemResponseSchema` with NOTHING stripped.
 *
 * This is the producer side of the declaration. The spec-side suite
 * (`packages/spec/src/api/protocol.test.ts`) pins what the schema says; this
 * one pins that the schema still matches what the code emits, driving the REAL
 * protocol against a REAL ObjectQL engine. The two together are what makes
 * "declared = returned" checkable — a future field added to the response, or an
 * existing one dropped, turns this red instead of silently vanishing at parse.
 *
 * Why the REST layer needs no separate case: the route hands this exact object
 * to `res.json()` verbatim (`rest-server.ts`, `DELETE /meta/:type/:name`), so
 * the protocol return IS the wire body.
 *
 * The exact shape of the two sibling gates on the same door
 * (`save-meta-response-conformance.test.ts` #5745,
 * `publish-meta-response-conformance.test.ts` #7294) — deliberately, because
 * the third verb is the same class of surface and its declaration was the
 * short one. Before this card the first assertion below was red in the same
 * quiet way theirs were: `safeParse` SUCCEEDED and `seq` /
 * `projectionApplied` were dropped from the parsed result, so the "stripped
 * keys" set was non-empty. That is the direction it must never drift back to.
 *
 * ## The delete door's own surface: FOUR success returns, not one
 *
 * Both siblings have a single success return that always sets `seq`, so they
 * declare it REQUIRED. `deleteMetaItem` has four, and only one of them appends
 * a history event — which is the whole reason `seq` is `.optional()` here and
 * why each branch needs its own case:
 *
 *   1. repository path, row deleted → `seq`, plus `projectionApplied` when a
 *      projector is registered. The only branch that carries either key.
 *   2. repository path, no row ("nothing to delete") → a success/no-op.
 *   3. legacy raw-engine path, row deleted (#5264, deliberately alive) → no
 *      history row, no watch event, so no `seq` even though a row really went
 *      away. The branch that would make a REQUIRED `seq` a false contract.
 *   4. legacy raw-engine path, no row → the same no-op as (2).
 *
 * Cases 2 and 3 are the ones a mirror-the-siblings declaration gets wrong if
 * it is written from the siblings' shape instead of from this producer.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DeleteMetaItemResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] Part of the real row's uniqueness key `(type, name,
        // organization_id, package_id)` and written by `SysMetadataRepository`
        // — the declared-field door judges the payload against this map, so
        // omitting it here would be a fixture defect, not a simplification.
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
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
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — see #7620 for what the short-circuiting shape cost.
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
            // Hold the caller's bound, AFTER the filter and by PRESENCE — a
            // limit-blind double answers more rows than the caller asked for
            // and every assertion about a bounded read passes for the wrong
            // reason (`check:objectql-double-limit`). The two sibling
            // conformance files predate that gate and sit in its shrink-only
            // baseline; a new double conforms.
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

async function makeProtocol() {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    return { p: new ObjectStackProtocolImplementation(engine), stores };
}

// [#7741] the inline arm requires the object binding pair
const viewBody = (label: string) => ({
    name: 'cases', type: 'grid', label, columns: ['id'], object: 'case', viewKind: 'list',
});

const ORG = 'org_x';

/** Keys the producer emitted that the schema refused to carry through. */
function strippedKeys(raw: Record<string, unknown>): string[] {
    const parsed = DeleteMetaItemResponseSchema.parse(raw) as Record<string, unknown>;
    return Object.keys(raw).filter((k) => !(k in parsed));
}

describe('deleteMetaItem response conforms to DeleteMetaItemResponseSchema (#13155)', () => {
    it('repository path, row deleted: parses green, strips nothing, and carries seq', async () => {
        const { p } = await makeProtocol();
        await (p as any).saveMetaItem({
            type: 'view', name: 'cases', organizationId: ORG, item: viewBody('A'),
        });

        const raw: any = await (p as any).deleteMetaItem({
            type: 'view', name: 'cases', organizationId: ORG,
        });

        // The assertion that was red before the declaration: `seq` rode the
        // wire and the schema dropped it on the floor.
        expect(Object.keys(raw)).toContain('seq');
        expect(strippedKeys(raw)).toEqual([]);

        const parsed = DeleteMetaItemResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        expect(parsed.reset).toBe(true);
        // The ordering token the history/audit trail is read by — an integer,
        // and the same value the receipt message's `[seq=…]` suffix quotes.
        expect(typeof parsed.seq).toBe('number');
        expect(Number.isInteger(parsed.seq)).toBe(true);
        expect(parsed.message).toContain(`[seq=${parsed.seq}]`);
    });

    it('with an ADR-0094 projector registered: projectionApplied is carried through', async () => {
        const { p } = await makeProtocol();
        await (p as any).saveMetaItem({
            type: 'view', name: 'cases', organizationId: ORG, item: viewBody('P'),
        });
        // Registered AFTER the save so the save's own projection is not what
        // this case reads — the delete's is.
        (p as any).registerMutationProjector('view', async () => { throw new Error('boom-from-projector'); });

        const raw: any = await (p as any).deleteMetaItem({
            type: 'view', name: 'cases', organizationId: ORG,
        });

        expect(Object.keys(raw)).toContain('projectionApplied');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = DeleteMetaItemResponseSchema.parse(raw);
        // Best-effort by contract: the projector threw, the delete still
        // succeeded, and the failure is reported HERE rather than as a non-200.
        // This is the channel the card names — a caller that needs the derived
        // read model to be live reads it instead of trusting the 200.
        expect(parsed.success).toBe(true);
        expect(parsed.projectionApplied).toEqual({ success: false, error: 'boom-from-projector' });
    });

    it('no projector registered → projectionApplied is absent, which is why it is optional', async () => {
        const { p } = await makeProtocol();
        await (p as any).saveMetaItem({
            type: 'view', name: 'cases', organizationId: ORG, item: viewBody('N'),
        });

        const raw: any = await (p as any).deleteMetaItem({
            type: 'view', name: 'cases', organizationId: ORG,
        });

        expect(raw.projectionApplied).toBeUndefined();
        expect(strippedKeys(raw)).toEqual([]);
        expect(DeleteMetaItemResponseSchema.safeParse(raw).success).toBe(true);
    });

    it('repository path, no overlay row: a no-op success that carries no seq', async () => {
        const { p } = await makeProtocol();

        const raw: any = await (p as any).deleteMetaItem({
            type: 'view', name: 'never_written', organizationId: ORG,
        });

        // This is the branch that makes `seq` optional rather than required.
        // Declaring it required would make the producer's own no-op fail its
        // own contract — the #5563 defect in mirror image.
        expect(raw).not.toHaveProperty('seq');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = DeleteMetaItemResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        // `reset`, not the absence of `seq`, is what says nothing was removed.
        expect(parsed.reset).toBe(false);
        expect(parsed.seq).toBeUndefined();
    });

    it('seq really is the history event sequence: it advances across the item\'s writes', async () => {
        const { p } = await makeProtocol();
        const saved: any = await (p as any).saveMetaItem({
            type: 'view', name: 'cases', organizationId: ORG, item: viewBody('S'),
        });
        const raw: any = await (p as any).deleteMetaItem({
            type: 'view', name: 'cases', organizationId: ORG,
        });

        // The delete's tombstone event comes after the save's write event on
        // the same item, which is the ordering property a history/audit
        // consumer reads the key FOR. A `seq` that did not move would parse
        // just as green, so the contract needs this asserted, not assumed.
        const parsed = DeleteMetaItemResponseSchema.parse(raw);
        expect(parsed.seq).toBeGreaterThan(saved.seq);
    });
});
