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
 *
 * ## #4717 — the CONDITIONAL field, and why it needs its own cases
 *
 * `advisories` (the #4463 D3 advisory findings, now on the 2xx) is emitted only
 * when the runtime authoring gate actually raised one. That makes it invisible
 * to the five cases above: they all save a clean `view`, so the key is absent
 * and `strippedKeys` is `[]` whether or not the declaration exists. Measured,
 * not reasoned — see the PR's reverse-verification table. So the two facts have
 * to be asserted directly and in both directions:
 *
 *   1. a save that RAISES an advisory carries it through the declared parse
 *      (red if the spec field is dropped or either side renames it), and
 *   2. a save that raises none does not grow the key at all — the property a
 *      well-meaning `advisories: []` refactor breaks while every other
 *      assertion in this file stays green.
 *
 * The advisory-raising case drives the REAL `runRuntimeAuthoringRules` through
 * the real `saveMetaItem`, never a stand-in: a double that produced findings
 * more freely than the shipped rules would pin a contract nothing serves.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SaveMetaItemResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        // `primaryKey` was declared here behind an `as any` and is not a spec
        // Field key at all (it exists only on external-catalog remote columns) —
        // inert metadata nothing ever read. `id` is the primary key by convention.
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] Declared on the real `sys_metadata`
        // (`metadata-core/src/objects/sys-metadata.object.ts`), where it is part
        // of the row's uniqueness key `(type, name, organization_id,
        // package_id)`, and written by `SysMetadataRepository` — but omitted by
        // this minimal stub. Nothing noticed while an undeclared write key just
        // travelled on to the driver; the declared-field door judges the payload
        // against this map, so the omission now shows up as the fixture defect
        // it always was. (`sys_metadata_history` genuinely carries none, so its
        // sibling stub below is left alone.)
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

/**
 * #4717 — the conditional `advisories` field, both directions.
 *
 * These drive the SHIPPED rule registry (`@objectstack/lint`'s
 * `AUTHORING_RULES`, filtered to the runtime surface) through the shipped
 * `saveMetaItem`. Nothing here is stubbed: the finding below is produced by
 * `lintFlowPatterns`, the same rule `os lint` runs, reached through the same
 * `evaluateRuntimeAuthoringGate` a Studio save reaches.
 */
describe('saveMetaItem carries the runtime authoring gate\'s advisories (#4717 — #4463 D3)', () => {
    /**
     * The reachable success-with-advisories case, verbatim from the #4717
     * measurement: a nightly sweep whose ONLY defect is a `delete_record` node
     * declaring `multi: true` with no `filter`. `lintFlowPatterns` raises
     * `flow-multi-write-unfiltered` at `severity: 'warning'`, so the gate's
     * `errors` set is empty, the write is NOT refused, and before this change
     * the finding was `console.warn`ed once per process and never seen by the
     * author who made it.
     *
     * `runAs: 'system'` is load-bearing, not decoration: without it
     * `flow-runas-unscoped` fires at `severity: 'error'` and the save becomes a
     * 422 — a refusal wearing an advisory's clothes, which would make this case
     * pass for the wrong reason.
     */
    const advisoryFlow = () => ({
        name: 'nightly_purge',
        label: 'Nightly Purge',
        type: 'autolaunched',
        status: 'active',
        runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'purge',
                type: 'delete_record',
                label: 'Purge',
                config: { objectName: 'audit_logs', multi: true },
            },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'purge' }],
    });

    /** The same flow with the bulk write bounded — no finding of any severity. */
    const cleanFlow = () => {
        const flow = advisoryFlow();
        (flow.nodes[1] as any).config.filter = [{ field: 'created_at', operator: 'lt', value: '2020-01-01' }];
        return flow;
    };

    it('a save whose only defect is advisory succeeds AND reports the finding', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            // Env-wide, not org-scoped: the registry declares
            // `allowOrgOverride: false` for `flow`, so an org-scoped write is
            // refused 403 NOT_OVERRIDABLE long before the authoring gate runs.
            type: 'flow', name: 'nightly_purge', item: advisoryFlow(),
        });

        // The write succeeded — this rides a 2xx, which is the whole point of
        // the advisory half. (`saveMetaItem` throws on the gated half, so
        // reaching this line at all is the "still a 200" assertion; the REST
        // route maps a clean return to 200 and a throw to its `status`.)
        expect(raw.success).toBe(true);
        expect(raw.state).toBe('active');

        // The finding reached the caller, with the id and severity the rule
        // emits. Asserting the RULE ID rather than just a non-empty array: an
        // array of the wrong findings is a different defect from an empty one.
        expect(raw.advisories).toHaveLength(1);
        expect(raw.advisories[0].rule).toBe('flow-multi-write-unfiltered');
        expect(raw.advisories[0].severity).toBe('warning');
        expect(raw.advisories[0].where).toContain('nightly_purge');

        // …and it survives the DECLARED parse. This is the assertion that goes
        // red if `SaveMetaItemResponseSchema.advisories` is removed, or if
        // either side renames the key: a plain `z.object` STRIPS what it does
        // not declare, so the field would vanish silently rather than fail.
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = SaveMetaItemResponseSchema.parse(raw);
        expect(parsed.advisories).toEqual(raw.advisories);

        // Every element key the declaration promises is really carried — a
        // narrower element schema would strip inside the array without
        // changing its length.
        expect(Object.keys(parsed.advisories![0]!).sort())
            .toEqual(['hint', 'message', 'path', 'rule', 'severity', 'where']);
    });

    /**
     * The constraint most likely to be broken by a well-meaning refactor:
     * "zero advisories must not change the response bytes" (the #4717 ruling,
     * point 2). Emitting `advisories: []` would satisfy every OTHER assertion
     * in this file — the spec declares the key, so nothing is stripped and
     * `strippedKeys` stays `[]` — which is exactly why this has to be pinned
     * on the raw object's KEY SET and not through the parse.
     */
    it('zero advisories changes nothing: the key is absent, not empty', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'flow', name: 'bounded_purge', item: cleanFlow(),
        });

        expect(raw.success).toBe(true);
        expect('advisories' in raw).toBe(false);
        expect(raw.advisories).toBeUndefined();
        // Byte-for-byte: the serialized response of a clean flow save carries
        // no trace of the field. `JSON.stringify` is the wire, and the wire is
        // the promise being made to existing callers.
        expect(JSON.stringify(raw)).not.toContain('advisories');
        expect(SaveMetaItemResponseSchema.safeParse(raw).success).toBe(true);
    });

    /**
     * D1 — a draft save is never gated, so it can never report an advisory
     * either. Same body as the first case; the difference is `mode: 'draft'`.
     */
    it('a draft save runs no rules, so it reports no advisories', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'flow', name: 'nightly_purge',
            item: advisoryFlow(), mode: 'draft',
        });

        expect(raw.state).toBe('draft');
        expect('advisories' in raw).toBe(false);
        expect(strippedKeys(raw)).toEqual([]);
    });

    /**
     * The gated half is unchanged, and it is asserted on its ENVELOPE — `code`
     * AND `status` — not on the bare fact of a throw. A `toThrow()` here would
     * be permanently green: this body already threw before #4717, so only the
     * envelope can tell the refusal apart from any other failure, and the
     * refusal is what must NOT have moved when the success path grew a channel.
     */
    it('the gating half still refuses with the 422 envelope, unchanged', async () => {
        const p = await makeProtocol();
        const brokenApproval = {
            name: 'leave_approval',
            label: 'Leave Approval',
            type: 'autolaunched',
            status: 'active',
            runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'approve',
                    type: 'approval',
                    label: 'Approve',
                    config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
                },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'approve' }],
        };

        await expect(
            p.saveMetaItem({
                type: 'flow', name: 'leave_approval', item: brokenApproval,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    });

    /**
     * ⚠️ GUARD, NOT EVIDENCE — green in BOTH directions, and labelled so on
     * purpose (the #4717 dispatch asked for this variant to be MEASURED rather
     * than reasoned about).
     *
     * The three pre-existing conformance cases save clean `view` bodies, for
     * which the gate raises nothing, so the conditional key is absent and
     * `strippedKeys` is `[]` whether or not the spec declares `advisories`.
     * This case states that fact as an assertion so the next reader does not
     * mistake those cases' green for coverage of the new field: the existing
     * gate CANNOT go red to report a missing or misspelled declaration, which
     * is precisely why the two directional cases above exist.
     */
    it('GUARD (green either way): a clean view save is untouched by the new field', async () => {
        const p = await makeProtocol();
        const raw: any = await p.saveMetaItem({
            type: 'view', name: 'cases', organizationId: 'org_x', item: viewBody('A'),
        });

        expect('advisories' in raw).toBe(false);
        expect(strippedKeys(raw)).toEqual([]);
        expect(Object.keys(raw).sort()).toEqual(['message', 'seq', 'state', 'success', 'version']);
    });
});
