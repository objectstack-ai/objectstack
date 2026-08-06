// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5745 — conformance gate: the body `saveMetaItem` really returns must parse
 * through `SaveMetaItemResponseSchema` with NOTHING stripped.
 *
 * This is the producer side of the declaration. The spec-side suite
 * (`packages/spec/src/api/protocol.test.ts`) pins what the schema says; this
 * one pins that the schema still matches what the code emits, driving the REAL
 * protocol against a REAL ObjectQL engine. The two together are what makes
 * "declared = returned" checkable — a future field added to the response, or an
 * existing one dropped, turns this red instead of silently vanishing at parse.
 *
 * Why the REST layer needs no separate case: the route hands this exact object
 * to `res.json()` verbatim (`rest-server.ts`, `PUT /meta/:type/:name`), so the
 * protocol return IS the wire body.
 *
 * Before the #5745 declaration this file's first assertion was red in a
 * specific, quiet way: `safeParse` SUCCEEDED and `version` / `seq` / `state`
 * were dropped from the parsed result, so the "stripped keys" set was
 * non-empty. That is the direction it must never drift back to.
 */
import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SaveMetaItemResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
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
        if (Array.isArray(where.$and)) return where.$and.every((w: any) => matchesWhere(row, w));
        if (Array.isArray(where.$or)) return where.$or.some((w: any) => matchesWhere(row, w));
        for (const [k, v] of Object.entries(where)) {
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
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
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
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject as any);
    return new ObjectStackProtocolImplementation(engine);
}

const LOG = (...a: any[]) => appendFileSync(OUT, a.join(' ') + '\n');

const viewBody = (label: string) => ({ name: 'cases', type: 'grid', label, columns: ['id'] });

/** Keys the producer emitted that the schema refused to carry through. */
function strippedKeys(raw: Record<string, unknown>): string[] {
    const parsed = SaveMetaItemResponseSchema.parse(raw) as Record<string, unknown>;
    return Object.keys(raw).filter((k) => !(k in parsed));
}

describe('saveMetaItem response conforms to SaveMetaItemResponseSchema (#5745)', () => {
    it('publish-mode save: parses green and strips nothing', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'),
        });

        expect(strippedKeys(raw)).toEqual([]);
        const parsed = SaveMetaItemResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        expect(parsed.state).toBe('active');
        expect(parsed.seq).toBe(1);
        // The ADR-0008 OCC token survives parse — this is the value a caller
        // echoes back as `If-Match` on the next write to this item.
        expect(parsed.version).toBe(raw.version);
        expect(typeof parsed.version).toBe('string');
    });

    it('draft-mode save: state is "draft" and still strips nothing', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('D'), mode: 'draft',
        });

        expect(strippedKeys(raw)).toEqual([]);
        expect(SaveMetaItemResponseSchema.parse(raw).state).toBe('draft');
    });

    it('with an ADR-0094 projector registered: projectionApplied is carried through', async () => {
        const p = await makeProtocol();
        p.registerMutationProjector('view', async () => { throw new Error('boom-from-projector'); });

        const raw: any = await p.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('P'),
        });

        expect(Object.keys(raw)).toContain('projectionApplied');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = SaveMetaItemResponseSchema.parse(raw);
        // Best-effort by contract: the projector threw, the write still succeeded,
        // and the failure is reported here rather than as a non-200.
        expect(parsed.success).toBe(true);
        expect(parsed.projectionApplied).toEqual({ success: false, error: 'boom-from-projector' });
    });

    it('no projector registered → projectionApplied is absent, which is why it alone is optional', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('N'),
        });

        expect(raw.projectionApplied).toBeUndefined();
        expect(SaveMetaItemResponseSchema.safeParse(raw).success).toBe(true);
    });

    it('version / seq / state are required because no reachable success return omits them', async () => {
        // `saveMetaItem` now has exactly ONE success return — the repository
        // write path — and it always sets all three. The shape that carried
        // none of them was the legacy raw-engine return, deleted in #5264 /
        // PR #5782 after being proved unreachable; the gate that made it
        // unreachable is the one exercised here, and it is still what keeps a
        // second, receipt-less write path from appearing. A type declaring
        // neither `allowOrgOverride` nor `allowRuntimeCreate` (`agent`, `job`)
        // is refused outright rather than persisted without a receipt.
        //
        // This is the tripwire for the `required` decision: if that gate is
        // ever relaxed so such a type is written some other way, whatever
        // receipt that path returns has to be re-measured before these three
        // fields can stay required.
        const p = await makeProtocol();
        await expect(
            p.saveMetaItem({ type: 'agent', name: 'helper', organizationId: 'org_x', item: { name: 'helper' } }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
    });
});
