// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7294 — conformance gate: the body `publishMetaItem` really returns must
 * parse through `PublishMetaItemResponseSchema` with NOTHING stripped.
 *
 * This is the producer side of the declaration. The spec-side suite
 * (`packages/spec/src/api/protocol.test.ts`) pins what the schema says; this
 * one pins that the schema still matches what the code emits, driving the REAL
 * protocol against a REAL ObjectQL engine. The two together are what makes
 * "declared = returned" checkable — a future field added to the response, or an
 * existing one dropped, turns this red instead of silently vanishing at parse.
 *
 * Why the REST layer needs no separate case: the route hands this exact object
 * to `res.json()` verbatim (`rest-server.ts`, `POST /meta/:type/:name/publish`),
 * so the protocol return IS the wire body.
 *
 * The exact shape of the sibling gate one door over
 * (`save-meta-response-conformance.test.ts`, #5745) — deliberately, because the
 * publish door is the same class of surface and had none of its three
 * artifacts: before #7294 the string `PublishMetaItem` appeared nowhere under
 * `packages/spec/src/`, so there was no schema for a gate to check against and
 * `version` — the ADR-0008 OCC token — rode the wire with no contract behind
 * it. That is the direction this must never drift back to.
 *
 * The publish door's extra surface over the save door is the three conditional
 * receipts (`seedApplied` / `materializeApplied` / `projectionApplied`), so the
 * cases below cover both the plain shape and each conditional path — a receipt
 * that appears in a shape the schema does not carry is the failure this
 * catches.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PublishMetaItemResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * The same in-memory driver the save-door gate uses. Kept local rather than
 * shared: `save-meta-response-conformance.test.ts` and
 * `plugin.authoring-channel.test.ts` each carry their own copy, so a
 * self-contained harness is the established shape here, and a gate that
 * imports its own substrate from another gate's file couples two tripwires
 * that must be able to fail independently.
 */
function makeMemoryDriver() {
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
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    return new ObjectStackProtocolImplementation(engine);
}

const viewBody = (label: string) => ({ name: 'cases', type: 'grid', label, columns: ['id'], object: 'case', viewKind: 'list' }); // [#7741] the inline arm requires the object binding pair

/**
 * A `seed` body, which is what makes `seedApplied` appear on the response. It
 * carries no `name` key: `SeedSchema` is strict (#4001) and the item's name
 * lives on the metadata ref, not inside the body. Targets `sys_metadata`
 * because that is the one object this harness registers.
 */
const seedBody = { object: 'sys_metadata', records: [{ name: 'row_a', type: 'view' }] };

const ORG = 'org_x';

/**
 * Stage a draft and promote it — the two-step the REST pair
 * `PUT /:type/:name?mode=draft` + `POST /:type/:name/publish` spells. There is
 * no one-shot publish: `publishMetaItem` promotes an EXISTING draft and 404s
 * (`[no_draft]`) without one, so the save is part of the fixture, not a
 * second thing under test.
 */
async function stageAndPublish(
    p: ObjectStackProtocolImplementation,
    opts: { type?: string; name?: string; item?: unknown; org?: string | null } = {},
): Promise<any> {
    const type = opts.type ?? 'view';
    const name = opts.name ?? 'cases';
    const item = opts.item ?? viewBody('A');
    // `org: null` writes env-wide. Not a stylistic choice: ADR-0005 /#6190 refuse
    // an org-scoped write for a type whose registry entry says
    // `allowOrgOverride: false`, and `seed` is one — the row would not survive a
    // restart, so the platform declines to mint it. The seed cases below are
    // therefore env-wide, which is the only channel that type has.
    const scope = opts.org === undefined ? ORG : opts.org;
    const orgArg = scope === null ? {} : { organizationId: scope };
    await (p as any).saveMetaItem({ type, name, ...orgArg, item, mode: 'draft' });
    return (p as any).publishMetaItem({ type, name, ...orgArg });
}

/** Keys the producer emitted that the schema refused to carry through. */
function strippedKeys(raw: Record<string, unknown>): string[] {
    const parsed = PublishMetaItemResponseSchema.parse(raw) as Record<string, unknown>;
    return Object.keys(raw).filter((k) => !(k in parsed));
}

describe('publishMetaItem response conforms to PublishMetaItemResponseSchema (#7294)', () => {
    it('plain publish: parses green and strips nothing', async () => {
        const p = await makeProtocol();
        const raw: any = await stageAndPublish(p);

        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishMetaItemResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        expect(typeof parsed.seq).toBe('number');
        expect(Number.isInteger(parsed.seq)).toBe(true);
        // The ADR-0008 OCC token survives parse — this is the value a caller
        // echoes back as `If-Match` on the next write to this item. It is the
        // field whose undeclared state on this door was the #7294 finding.
        expect(parsed.version).toBe(raw.version);
        expect(typeof parsed.version).toBe('string');
        expect(parsed.message).toBe(raw.message);
    });

    it('success / version / seq are required — the producer always emits them', async () => {
        const p = await makeProtocol();
        const raw: any = await stageAndPublish(p);

        for (const key of ['success', 'version', 'seq'] as const) {
            expect(raw[key], `producer must emit '${key}'`).toBeDefined();
            const body: Record<string, unknown> = { ...raw };
            delete body[key];
            expect(
                PublishMetaItemResponseSchema.safeParse(body).success,
                `omitting '${key}' must fail parse`,
            ).toBe(false);
        }
    });

    it('no side effects registered → all three receipts are absent, which is why each is optional', async () => {
        const p = await makeProtocol();
        const raw: any = await stageAndPublish(p);

        expect(raw.seedApplied).toBeUndefined();
        expect(raw.materializeApplied).toBeUndefined();
        expect(raw.projectionApplied).toBeUndefined();
        expect(PublishMetaItemResponseSchema.safeParse(raw).success).toBe(true);
    });

    it('with an ADR-0094 projector registered: projectionApplied is carried through', async () => {
        const p = await makeProtocol();
        p.registerMutationProjector('view', async () => { throw new Error('boom-from-projector'); });

        const raw: any = await stageAndPublish(p);

        expect(Object.keys(raw)).toContain('projectionApplied');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishMetaItemResponseSchema.parse(raw);
        // Best-effort by contract: the projector threw, the promotion still
        // succeeded, and the failure is reported here rather than as a non-200.
        expect(parsed.success).toBe(true);
        expect(parsed.projectionApplied).toEqual({ success: false, error: 'boom-from-projector' });
    });

    it('with an ADR-0086 P2 materializer registered: materializeApplied is carried through', async () => {
        const p = await makeProtocol();
        p.registerPublishMaterializer('view', async () => ({ success: true, inserted: 2, updated: 1 }));

        const raw: any = await stageAndPublish(p);

        expect(Object.keys(raw)).toContain('materializeApplied');
        expect(strippedKeys(raw)).toEqual([]);
        expect(PublishMetaItemResponseSchema.parse(raw).materializeApplied)
            .toEqual({ success: true, inserted: 2, updated: 1 });
    });

    it('a throwing materializer: the failure shape (success:false + error) is carried through too', async () => {
        const p = await makeProtocol();
        p.registerPublishMaterializer('view', async () => { throw new Error('boom-from-materializer'); });

        const raw: any = await stageAndPublish(p);

        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishMetaItemResponseSchema.parse(raw);
        // Surfaced, never thrown — the publish itself still reports success.
        expect(parsed.success).toBe(true);
        // [#8333] The SHAPE is what this file is about, and the shape is
        // unchanged: `success: false` plus counters plus an `error` string,
        // conforming to the response schema. What changed is the string. A
        // materializer is arbitrary plugin code going straight at the engine,
        // so an undeclared throw from it is indistinguishable from raw driver
        // text (`SQLITE_ERROR: no such table: sys_metadata` was the measured
        // case) — and `materializeApplied` rides on a 200 response, where no
        // HTTP boundary's message withhold can reach it. A bare `Error`
        // declares no 4xx `status`, so it is withheld here and logged instead.
        // A materializer that DOES declare a refusal keeps its sentence; that
        // is pinned in metadata-protocol's `protocol.batch-verb-driver-text.test.ts`.
        expect(parsed.materializeApplied)
            .toEqual({ success: false, inserted: 0, updated: 0, error: 'materialize failed' });
    });

    it('publishing a `seed`: seedApplied is carried through with its counters', async () => {
        const p = await makeProtocol();
        const raw: any = await stageAndPublish(p, {
            type: 'seed',
            name: 'demo_rows',
            org: null,
            item: seedBody,
        });

        expect(Object.keys(raw)).toContain('seedApplied');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishMetaItemResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        // The load really ran — this is the SUCCESS branch with a row actually
        // inserted, not the surfaced-failure fallback. Asserting the counters
        // rather than their types is what makes the case a measurement: a
        // receipt whose numbers stopped arriving would still be "a number" if
        // the schema ever loosened them.
        expect(parsed.seedApplied).toEqual({ success: true, inserted: 1, updated: 0 });
    });

    it('all three receipts at once: the fully-loaded body still strips nothing', async () => {
        const p = await makeProtocol();
        p.registerPublishMaterializer('seed', async () => ({ success: true, inserted: 1, updated: 0 }));
        p.registerMutationProjector('seed', async () => { /* clean projection */ });

        const raw: any = await stageAndPublish(p, {
            type: 'seed',
            name: 'demo_rows',
            org: null,
            item: seedBody,
        });

        for (const key of ['seedApplied', 'materializeApplied', 'projectionApplied']) {
            expect(Object.keys(raw), `producer must emit '${key}' on this path`).toContain(key);
        }
        expect(strippedKeys(raw)).toEqual([]);
        expect(PublishMetaItemResponseSchema.parse(raw).projectionApplied).toEqual({ success: true });
    });

    it('a non-draftable type is refused outright rather than promoted without a receipt', async () => {
        // The tripwire for the `required` decision on success / version / seq:
        // `publishMetaItem` has exactly ONE success return — the promotion path
        // — and it always sets all three. The gate exercised here is what keeps
        // a second, receipt-less promotion path from appearing. If it is ever
        // relaxed so a type reaches `active` some other way, whatever receipt
        // THAT path returns has to be re-measured before these three fields can
        // stay required.
        const p = await makeProtocol();
        await expect(
            (p as any).publishMetaItem({ type: 'agent', name: 'helper', organizationId: ORG }),
        ).rejects.toMatchObject({ status: 403 });
    });
});
