// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9406 — conformance gate: the body `publishPackageDrafts` really returns
 * must parse through `PublishPackageDraftsResponseSchema` with NOTHING
 * stripped.
 *
 * This is the producer side of the batch declaration — the batch sibling of
 * `publish-meta-response-conformance.test.ts` (#7294), which is the stated
 * precedent one door over. The spec-side suite
 * (`packages/spec/src/api/protocol.test.ts`) pins what the schema says; this
 * one pins that the schema still matches what the code emits, driving the REAL
 * protocol against a REAL ObjectQL engine. The two together are what makes
 * "declared = returned" checkable — a future field added to the response, or
 * an existing one dropped, turns this red instead of silently vanishing at
 * parse.
 *
 * Why the REST layer needs its OWN case here, unlike the single door: the
 * dispatcher route (`packages/runtime/src/domains/packages.ts`) does NOT hand
 * this object to the wire verbatim — it back-fills `seedApplied` for custom
 * protocols and attaches the ADR-0045 receipts (`unhiddenApps` /
 * `unhideError` / `rebindError`) before responding. Those mutations are pinned
 * route-side in
 * `packages/runtime/src/domains/packages-publish-drafts-response-conformance.test.ts`;
 * THIS file owns the helper's half of the wire face.
 *
 * `probes` is deliberately opaque in the declaration (#9406 ruling: staged,
 * upgrade only when a consumer needs a field) — so the cases here assert it is
 * carried through unstripped, never its inner shape.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PublishPackageDraftsResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
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
 * The same in-memory driver the two single-door gates use. Kept local rather
 * than shared, for the reason `publish-meta-response-conformance.test.ts`
 * records: each gate is a tripwire that must be able to fail independently.
 */
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

const PKG = 'app.edu';

const viewBody = (name: string, label: string) => ({
    name, type: 'grid', label, columns: ['id'], object: 'case', viewKind: 'list',
});

/**
 * The advisory-bearing flow, verbatim from the single publish door's #9176
 * measurement: its ONLY defect is a `delete_record` node declaring
 * `multi: true` with no `filter`, so `lintFlowPatterns` raises
 * `flow-multi-write-unfiltered` at `severity: 'warning'` — the promotion is
 * NOT refused and the finding rides the element.
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

/** A `seed` body — what makes the batch's aggregate `seedApplied` appear. */
const seedBody = { object: 'sys_metadata', records: [{ name: 'row_a', type: 'view' }] };

/**
 * Stage drafts bound to PKG and publish the whole package — the REST pair
 * `PUT /meta/:type/:name?mode=draft` (with `packageId`) +
 * `POST /packages/:id/publish-drafts`. Env-wide (`organizationId` absent) on
 * purpose: `flow` and `seed` declare `allowOrgOverride: false`, so an
 * org-scoped draft would be refused before the door under test runs.
 */
async function stageDrafts(
    p: ObjectStackProtocolImplementation,
    drafts: Array<{ type: string; name: string; item: unknown }>,
): Promise<void> {
    for (const d of drafts) {
        await (p as any).saveMetaItem({
            type: d.type, name: d.name, item: d.item, mode: 'draft', packageId: PKG,
        });
    }
}

/** Keys the producer emitted that the schema refused to carry through. */
function strippedKeys(raw: Record<string, unknown>): string[] {
    const parsed = PublishPackageDraftsResponseSchema.parse(raw) as Record<string, unknown>;
    return Object.keys(raw).filter((k) => !(k in parsed));
}

describe('publishPackageDrafts response conforms to PublishPackageDraftsResponseSchema (#9406)', () => {
    it('plain batch publish: parses green and strips nothing', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [
            { type: 'view', name: 'cases', item: viewBody('cases', 'Cases') },
            { type: 'view', name: 'leads', item: viewBody('leads', 'Leads') },
        ]);

        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        expect(parsed.outcome).toBe('published');
        expect(parsed.publishedCount).toBe(2);
        expect(parsed.failedCount).toBe(0);
        expect(parsed.failed).toEqual([]);
        // Every element carries the ADR-0008 OCC token, unstripped.
        for (const el of parsed.published) {
            expect(typeof el.version).toBe('string');
            expect(el.version.length).toBeGreaterThan(0);
        }
        expect(parsed.published.map((e) => e.name).sort()).toEqual(['cases', 'leads']);
    });

    it('the six always-emitted keys are required — the producer sets them on every return site', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);
        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        for (const key of ['success', 'outcome', 'publishedCount', 'failedCount', 'published', 'failed'] as const) {
            expect(raw[key], `producer must emit '${key}'`).toBeDefined();
            const body: Record<string, unknown> = { ...raw };
            delete body[key];
            expect(
                PublishPackageDraftsResponseSchema.safeParse(body).success,
                `omitting '${key}' must fail parse`,
            ).toBe(false);
        }
    });

    it('probes rides the response opaque: carried through parse unstripped, shape unconstrained (#9406 staging)', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);
        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        // ADR-0038 L3: something was publishable, so the probe pass really ran.
        // This is the assertion that keeps "opaque" from decaying into
        // "absent": the KEY is part of the declared face even though its inner
        // shape deliberately is not.
        expect(Object.keys(raw)).toContain('probes');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        // Reference equality through parse — z.unknown() passes the value
        // through; a modeled schema that strips would break this first.
        expect(parsed.probes).toBe(raw.probes);
    });

    it('publishing a seed: the aggregate seedApplied is carried through with its counters', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [{ type: 'seed', name: 'demo_rows', item: seedBody }]);
        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(Object.keys(raw)).toContain('seedApplied');
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        expect(parsed.success).toBe(true);
        // The in-batch producer (`applySeedBodies`) always emits both
        // counters — the optionality the schema grants them exists for the
        // ROUTE-level fallback producer only (pinned in the runtime suite).
        expect(parsed.seedApplied?.success).toBe(true);
        expect(parsed.seedApplied?.inserted).toBe(1);
        expect(parsed.seedApplied?.updated).toBe(0);
    });

    it('a materializer across the batch: materializeApplied aggregates with per-item failures[]', async () => {
        const p = await makeProtocol();
        p.registerPublishMaterializer('view', async () => { throw new Error('boom-from-materializer'); });
        await stageDrafts(p, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);

        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        // Best-effort by contract: the materializer failed, the publish
        // succeeded, and the failure is NAMED per item — the batch shape's
        // deliberate difference from the single door's scalar `error`.
        expect(parsed.success).toBe(true);
        expect(parsed.materializeApplied?.success).toBe(false);
        expect(parsed.materializeApplied?.failures).toHaveLength(1);
        expect(parsed.materializeApplied?.failures[0]).toMatchObject({ type: 'view', name: 'cases' });
    });

    it('advisories ride their published[] element and survive the declared parse (#9343)', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [
            { type: 'flow', name: 'nightly_purge', item: advisoryFlow() },
            { type: 'view', name: 'cases', item: viewBody('cases', 'Cases') },
        ]);

        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(raw.success).toBe(true);
        const flowEl = raw.published.find((e: any) => e.name === 'nightly_purge');
        const viewEl = raw.published.find((e: any) => e.name === 'cases');
        // The finding reached its OWN element — and only its own.
        expect(flowEl.advisories).toHaveLength(1);
        expect(flowEl.advisories[0].rule).toBe('flow-multi-write-unfiltered');
        expect(flowEl.advisories[0].severity).toBe('warning');
        expect('advisories' in viewEl).toBe(false);

        // …and the parse strips none of it. This is the assertion that goes
        // red if the element declaration loses `advisories` or either side
        // renames the key: a plain z.object STRIPS what it does not declare.
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        const parsedFlowEl = parsed.published.find((e) => e.name === 'nightly_purge');
        expect(parsedFlowEl?.advisories).toEqual(flowEl.advisories);
        expect(Object.keys(parsedFlowEl!.advisories![0]!).sort())
            .toEqual(['hint', 'message', 'path', 'rule', 'severity', 'where']);
    });

    /**
     * Byte-stability, the producer half (#9406 dispatch condition): an
     * advisory-free batch publish carries no trace of `advisories` on the
     * wire, and the DECLARED parse fabricates nothing — the declaration must
     * not change wire bytes, and a `.default()` anywhere in the schema would
     * change what consumers observe relative to those bytes. Pinned on the
     * raw KEY SETS and the serialized wire, not through the parse alone,
     * because the spec declares the key and so `strippedKeys` stays `[]`
     * whether or not the producer went quiet.
     */
    it('byte-stability: an advisory-free publish carries no advisories key, and parse fabricates nothing', async () => {
        const p = await makeProtocol();
        await stageDrafts(p, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);
        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        // JSON.stringify is the wire, and the wire is the promise.
        expect(JSON.stringify(raw)).not.toContain('advisories');
        for (const el of raw.published) expect('advisories' in el).toBe(false);

        const parsed = PublishPackageDraftsResponseSchema.parse(raw) as Record<string, unknown>;
        expect(Object.keys(parsed).sort()).toEqual(Object.keys(raw).sort());
        for (let i = 0; i < raw.published.length; i += 1) {
            expect(Object.keys((parsed.published as any[])[i]).sort())
                .toEqual(Object.keys(raw.published[i]).sort());
        }
    });

    /**
     * The ADR-0067 D2 refusal face — `success: false` on a fully-shaped body,
     * never a throw: a pre-flight violation fails the WHOLE batch with
     * `publishedCount: 0`, `published: []` and every item accounted for in
     * `failed[]`. Refusal-shape drift is exactly as silent as success-shape
     * drift, so the gate covers both.
     */
    it('a refused batch still conforms: the all-or-nothing failed[] face parses unstripped', async () => {
        const p = await makeProtocol();
        // A package whose registry entry declares a namespace, and an object
        // draft that violates the ADR-0028 prefix rule — the measured
        // pre-flight refusal class.
        (p as any).engine.registry.registerPackage?.({
            id: PKG, manifest: { namespace: 'edu' },
        });
        await stageDrafts(p, [
            { type: 'object', name: 'ticket', item: { name: 'ticket', label: 'Ticket', fields: {} } },
        ]);

        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(raw.success).toBe(false);
        expect(raw.outcome).toBe('refused');
        expect(raw.publishedCount).toBe(0);
        expect(raw.published).toEqual([]);
        expect(raw.failedCount).toBeGreaterThan(0);
        expect(strippedKeys(raw)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(raw);
        expect(parsed.failed[0]).toMatchObject({ type: 'object', name: 'ticket' });
        expect(typeof parsed.failed[0]!.error).toBe('string');
        expect(typeof parsed.failed[0]!.code).toBe('string');
    });
});

/**
 * #10462 — `outcome`, the first-class discriminant for WHICH exit answered.
 *
 * The defect this pins shut, measured on cloud#1488: a publish with nothing
 * to promote and a genuine refusal both answer `success: false` with
 * `publishedCount: 0`, and the no-op leaves no trace — so an AI consumer
 * graded the no-op as "refused and rolled back" and burned two repair rounds
 * re-authoring artifacts that were already correct. cloud#1492's patch
 * discriminates on `failed.length > 0`, an invariant the producer never
 * stated and nothing pinned. `outcome` states it, typed, and these cases pin
 * it in both directions.
 *
 * The card's own requested pin — "every non-success return carries at least
 * one `failed[]` entry" — is FALSE today and the no-op is its counterexample
 * (`success: false`, `failed: []`). The three invariants below are the honest
 * restatement (PM ruling on the card).
 */
describe('outcome discriminates the three publish exits (#10462)', () => {
    /** Stage the measured pre-flight refusal class (ADR-0028 prefix rule). */
    async function makeRefusal() {
        const p = await makeProtocol();
        (p as any).engine.registry.registerPackage?.({
            id: PKG, manifest: { namespace: 'edu' },
        });
        await stageDrafts(p, [
            { type: 'object', name: 'ticket', item: { name: 'ticket', label: 'Ticket', fields: {} } },
        ]);
        return p;
    }

    /**
     * DEFECT CONTROL — the two shapes cloud#1488 could not tell apart,
     * side by side (a case that exercised only the no-op would prove nothing
     * about discrimination). Red on origin/main by construction: there the
     * two responses differ on no key but `failed[]`'s contents.
     */
    it('a no-op publish and a genuine refusal are distinguishable through outcome', async () => {
        // The no-op: a package with NO pending drafts.
        const pNoop = await makeProtocol();
        const noop: any = await pNoop.publishPackageDrafts({ packageId: 'app.empty' });

        // The refusal: the same fixture class the refused-batch case stages.
        const refused: any = await (await makeRefusal()).publishPackageDrafts({ packageId: PKG });

        // Identical on every axis the consumer previously had…
        expect(noop.success).toBe(false);
        expect(refused.success).toBe(false);
        expect(noop.publishedCount).toBe(0);
        expect(refused.publishedCount).toBe(0);
        expect(noop.published).toEqual([]);
        expect(refused.published).toEqual([]);
        // …and now distinguishable through the declared discriminant.
        expect(noop.outcome).toBe('nothing_to_publish');
        expect(refused.outcome).toBe('refused');
        // Both shapes stay inside the declared face.
        expect(strippedKeys(noop)).toEqual([]);
        expect(strippedKeys(refused)).toEqual([]);
    });

    /**
     * The three producer invariants — BOTH directions of each biconditional
     * (asserted as boolean equality, which is the biconditional), on every
     * response class this suite can stage against the real engine. (i) is the
     * guarantee cloud#1492's `failed.length > 0` discrimination needs, stated
     * by the producer at last. (iii) doubles as the pin that existing
     * `success` semantics did not move.
     */
    const expectOutcomeInvariants = (res: any) => {
        // (i) refused ⟺ failed[] non-empty.
        expect(res.outcome === 'refused').toBe(res.failed.length > 0);
        // (ii) nothing_to_publish ⟺ nothing landed AND nothing refused.
        expect(res.outcome === 'nothing_to_publish')
            .toBe(res.published.length === 0 && res.failed.length === 0);
        // (iii) success === (outcome === 'published').
        expect(res.success).toBe(res.outcome === 'published');
    };

    it('the invariants hold on a published batch, a refused batch, and a no-op', async () => {
        const pOk = await makeProtocol();
        await stageDrafts(pOk, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);
        const ok: any = await pOk.publishPackageDrafts({ packageId: PKG });
        expect(ok.outcome).toBe('published');
        expectOutcomeInvariants(ok);

        const refused: any = await (await makeRefusal()).publishPackageDrafts({ packageId: PKG });
        expect(refused.outcome).toBe('refused');
        expectOutcomeInvariants(refused);

        const pNoop = await makeProtocol();
        const noop: any = await pNoop.publishPackageDrafts({ packageId: 'app.empty' });
        expect(noop.outcome).toBe('nothing_to_publish');
        expectOutcomeInvariants(noop);
    });

    /**
     * PRESERVED-BEHAVIOUR CONTROL — `outcome` is additive: every pre-existing
     * field answers exactly as before on all three exits, `success` included.
     * Green on origin/main by construction (minus the `outcome` key), so its
     * power to fail is proven by mutation, not by running main: rewiring
     * `success` from `outcome` (the "a no-op is not a failure" refactor this
     * card explicitly does NOT make — that call is the maintainer's) goes red
     * on the no-op leg below. The mutation run is reported in the PR.
     */
    it('every pre-existing field answers exactly as before on all three exits', async () => {
        const pOk = await makeProtocol();
        await stageDrafts(pOk, [{ type: 'view', name: 'cases', item: viewBody('cases', 'Cases') }]);
        const { outcome: _okOutcome, ...ok } = (await pOk.publishPackageDrafts({ packageId: PKG })) as any;
        expect(ok).toMatchObject({ success: true, publishedCount: 1, failedCount: 0, failed: [] });
        expect(ok.published.map((e: any) => e.name)).toEqual(['cases']);
        expect(typeof ok.commitId).toBe('string');

        const { outcome: _refusedOutcome, ...refused } =
            (await (await makeRefusal()).publishPackageDrafts({ packageId: PKG })) as any;
        expect(refused).toMatchObject({ success: false, publishedCount: 0, published: [] });
        expect(refused.failedCount).toBeGreaterThan(0);
        expect(refused.failed[0]).toMatchObject({ type: 'object', name: 'ticket' });
        expect(typeof refused.failed[0].error).toBe('string');
        expect(typeof refused.failed[0].code).toBe('string');

        const pNoop = await makeProtocol();
        const { outcome: _noopOutcome, ...noop } =
            (await pNoop.publishPackageDrafts({ packageId: 'app.empty' })) as any;
        // The EXACT pre-#10462 no-op shape, strictly — the issue's own quote.
        expect(noop).toEqual({
            success: false, publishedCount: 0, failedCount: 0, published: [], failed: [],
        });
    });
});
