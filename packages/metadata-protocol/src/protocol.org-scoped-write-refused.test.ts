// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6190 — an org-scoped write of a type the registry declares NOT per-org
 * overridable is REFUSED at write time, on both minting paths.
 *
 * ## The defect this closes
 *
 * `allowOrgOverride` and `allowRuntimeCreate` are orthogonal tiers. #6283 /
 * commit 474f131cf closed the OVERLAY tier for `flow`; the runtime-create tier stayed
 * open by design and never consulted the ORG dimension at all —
 * `SysMetadataRepository.put` stamps `organization_id: this.organizationId`
 * whatever the type is. So a Studio-authored item of an
 * `allowOrgOverride: false` type persisted a per-org row that the platform can
 * never read back: `loadMetaFromDb` filters `organization_id: null`, and the
 * env-wide consumers never ask for the org partition. The write path was
 * strictly more permissive than the read path — ADR-0049's false-compliance
 * shape, and the reason #6190 was filed.
 *
 * Two measured specimens, in ascending severity:
 *
 *   • `flow` — binds its triggers for the life of the process that wrote it,
 *     then silently stops firing after the next restart.
 *   • `object` — fails CLOSED. The row is absent from the registry after boot
 *     while its physical table still holds the data, so `assertObjectRegistered`
 *     answers 404 `OBJECT_NOT_FOUND` for every record in it. That gate's own
 *     TSDoc justified failing closed with "`object` is `allowOrgOverride: false`
 *     … so no per-org overlay can legitimately exist outside the process-wide
 *     registry" — true of the overlay tier, false of the runtime-create tier
 *     until this refusal landed. `object` is kept as a named specimen below so
 *     that premise cannot silently go stale again.
 *
 * Maintainer ruling 2026-08-08 (option A of three): reject the write. Option B
 * — silently coercing the row to env-wide — was rejected because it rewrites
 * the tenancy statement the author made; option D — the cold-boot log alone,
 * shipped in PR #6600 — leaves declared ≠ enforced. Ruling 2 = A: rows written
 * BEFORE this gate are residue handled non-destructively (audible via
 * `reportUnhydratableOrgScopedRows`, disposed of operationally); this PR ships
 * NO data migration, which is why the promotion half below matters — residue
 * must not be promotable into a fresh phantom.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Ordinary red with a deliberately green half. Predicted: removing the two
 * `orgScopedWriteRefusal` call sites turns every enforcement case in this file
 * red and leaves the 4 controls + the declaration pin green.
 *
 * Measured: **9 red / 5 green** here (and 21 red across the package, the other
 * 12 being the fixtures elsewhere that had pinned the reversed behaviour). The
 * enforcement cases failed in the shape that names the bug —
 * `AssertionError: promise resolved "{ success: true, …(4) }" instead of
 * rejecting` — i.e. the accepted-then-unreadable write, reproduced on demand.
 *
 * One prediction missed, recorded rather than tidied away: the written
 * prediction said "10 enforcement cases", counting R1 and R2 as two. They are
 * one `it()` — the envelope and the "nothing persisted" assertion belong to a
 * single case, because "refused AFTER writing" would satisfy either one alone
 * and neither is the claim on its own. So the predicted count was 10 and the
 * real one is 9; the direction and the membership were right, the arithmetic
 * was not.
 *
 * The green half is not slack: a "fix" that closed this by making the whole
 * type unwritable would pass the red half and fail G2/G3, and a harness that
 * could not save anything would pass the red half for the wrong reason — which
 * is what G1/G2 exclude.
 *
 * Harness: the real write path over a stub engine — the gate runs inside
 * `saveMetaItem` / `promoteDraftForPublish`, so a harness that mocks either
 * cannot see it.
 */
import { afterEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). Imported from `@objectstack/metadata-core`, never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { SharingConfigSchema } from '@objectstack/spec/ui';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    metadata: string | null;
    checksum: string | null;
    operation_type: string;
    recorded_at: string;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine(artifacts: Array<{ type: string; name: string }> = []) {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;
    const artifactKeys = new Set(artifacts.map((a) => `${a.type}|${a.name}`));

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => {
                    const w = opts.where;
                    if (w.type !== undefined && h.type !== w.type) return false;
                    if (w.name !== undefined && h.name !== w.name) return false;
                    if (w.version !== undefined && h.version !== w.version) return false;
                    if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
                    return true;
                }) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows;
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            // The env-wide `view` list read (the public-form re-open refusal).
            isPackageDisabled: () => false,
            // `isArtifactBacked` prefers this lookup — a hit means the name is
            // shipped by a code package (`_packageId` provenance).
            getArtifactItem: (type: string, name: string) =>
                artifactKeys.has(`${type}|${name}`) ? { name, _packageId: 'showcase' } : undefined,
        },
    };
    return { engine, rows };
}

function makeProtocol(artifacts?: Array<{ type: string; name: string }>, environmentId?: string) {
    const { engine, rows } = makeStubEngine(artifacts);
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId) as any;
    return { protocol, rows };
}

/** Seed the residue this PR deliberately does NOT migrate: an org-scoped
 *  draft row written the way `saveMetaItem` used to write it — through the
 *  repository, which is where `organization_id` is stamped. Bypasses only the
 *  new protocol gate, so the row is byte-identical to a legacy one. */
async function seedLegacyOrgDraft(
    protocol: any,
    args: { type: string; name: string; body: unknown; organizationId: string; packageId?: string | null },
): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(args.organizationId);
    await repo.put(
        { type: args.type, name: args.name, org: args.organizationId },
        args.body,
        {
            parentVersion: null,
            actor: null,
            source: 'test.legacy-residue',
            intent: 'runtime-only',
            state: 'draft',
            packageId: args.packageId ?? null,
        },
    );
}

const OBJECT = {
    name: 'org_widget',
    label: 'Org Widget',
    // [#8308] Authored OWD. This file pins the NOT_OVERRIDABLE org-scope
    // refusal, and the authoring gate runs BEFORE it — an OWD-less body would
    // swap the observed refusal for `security-owd-unset` 422 once #8310
    // declares `object` in `runtimeTypes`.
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
};

/** A schema-VALID flow body — a minimal one 422s before the gate is reached. */
const FLOW = {
    name: 'org_sweep',
    label: 'Org sweep',
    type: 'record_change',
    status: 'active',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'task', triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** The control specimen: `allowOrgOverride: true`, so it HAS a per-org channel. */
const VIEW = {
    name: 'org_grid',
    label: 'Org grid',
    object: 'task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'title', label: 'Title' }],
};

const orgRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).map((r) => ({ type: r.type, name: r.name, org: r.organization_id, state: r.state }));

describe('#6190 — org-scoped writes of non-org-overridable types are refused', () => {
    afterEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });

    // ── path 1: saveMetaItem ──────────────────────────────────────────────

    it('R1/R2 — object: the org-scoped save is refused with the envelope, and NOTHING is persisted', async () => {
        // The specimen whose post-restart consequence fails CLOSED: the row's
        // organization_id makes cold boot skip it, the object is absent from
        // the registry, and every record in its still-populated table 404s.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        // "Refused", not "refused after writing" — the phantom row IS the
        // defect, so its absence is part of the claim.
        expect(orgRows(rows)).toEqual([]);
    });

    it('R3 — the refusal does not depend on deployment topology (no environmentId either)', async () => {
        // ADR-0005's "single kernels keep their existing behaviour" carve-out is
        // keyed on `environmentId`. A refusal that only bit in one topology
        // would leave the flagship showcase — a host config boots with NO
        // environmentId (#5086) — still writing phantoms.
        const { protocol, rows } = makeProtocol();

        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows)).toEqual([]);
    });

    it('R4 — flow: the original #6190 specimen, brand-new and org-scoped, is refused', async () => {
        // No artifact is shadowed here, so this is the `allowRuntimeCreate`
        // tier — the tier commit 474f131cf deliberately left open and the tier the
        // tenant scenario in the issue actually uses (authoring a NEW flow in
        // Studio, not overlaying a packaged one).
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'org_sweep', item: FLOW, organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows)).toEqual([]);
    });

    it('R5 — the draft door is gated identically (#4463 D1)', async () => {
        // Gating the direct-active save and letting drafts through would make
        // the refusal bypassable by anyone who saves `?mode=draft` and then
        // POSTs `/publish` — which is exactly what Studio's designer does on
        // every edit.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a', mode: 'draft',
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows)).toEqual([]);
    });

    it('R6 — the plural REST spelling is refused too', async () => {
        // `PUT /api/v1/meta/objects/:name` reaches the same gate; a refusal
        // keyed on one spelling is a refusal with a documented bypass.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({ type: 'objects', name: 'org_widget', item: OBJECT, organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows)).toEqual([]);
    });

    it('R7 — OS_METADATA_WRITABLE unlocks org scoping too: the operator hatch stays ONE door', async () => {
        // Not a leak, and the case is here because the alternative was
        // seriously considered and rejected. The predicate is
        // `isOverlayAllowed`, the SAME one the sibling `NOT_OVERRIDABLE`
        // refusal uses — the ruling named this refusal that sibling, and this
        // file already promises "unlocking a type there unlocks it here too".
        // A second, differently-keyed notion of "overridable" inside one method
        // is the drift, not the safety.
        //
        // What keeps that honest is that the DIAGNOSTIC is deliberately wider
        // than the refusal: `reportUnhydratableOrgScopedRows` ignores the hatch
        // (PR #6600) and reports the row at every boot, because no hatch can
        // teach `loadMetaFromDb` to read it back. So an operator who opens the
        // door still gets told what it cost them. Warning is free and should be
        // maximal; refusing removes a capability, and the declaration — with
        // its documented override — is what decides that.
        process.env.OS_METADATA_WRITABLE = 'object';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const { protocol, rows } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a',
        });

        expect(result.success).toBe(true);
        expect(orgRows(rows)).toEqual([
            { type: 'object', name: 'org_widget', org: 'org_a', state: 'active' },
        ]);
    });

    it('R7b — …and with the hatch CLOSED the same write is refused', async () => {
        // The pair that makes R7 evidence rather than a hole: the hatch is what
        // opens it, and nothing else does. Without this, R7 would be
        // indistinguishable from a gate that never fired for `object` at all.
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows)).toEqual([]);
    });

    it('R8 — the refusal names the scope, the flag and the remedy (#5240: one condition, one wording)', async () => {
        // An AI author cannot self-correct from a vague 403. The wording is
        // contract here: it must name the ORG (so the author knows which
        // dimension was refused, not just "forbidden"), the flag that produced
        // the verdict, and the two legitimate alternatives.
        const { protocol } = makeProtocol([], 'env_prod');

        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'org_widget', item: OBJECT, organizationId: 'org_a' })
            .catch((e: any) => e);

        expect(err.message).toContain(
            "Metadata item 'object/org_widget' cannot be written org-scoped (organization 'org_a').",
        );
        expect(err.message).toContain('allowOrgOverride=false');
        expect(err.message).toContain('Save it env-wide instead');
        expect(err.organizationId).toBe('org_a');
    });

    // ── path 2: draft → active promotion ──────────────────────────────────

    it('R9 — a LEGACY org-scoped draft cannot be promoted into a fresh active phantom', async () => {
        // This PR ships no data migration (ruling 2 = A), so residue exists by
        // design. It must not be promotable: promoting it would mint a NEW
        // active org-scoped row — the very thing path 1 now refuses.
        const { protocol, rows } = makeProtocol([], 'env_prod');
        await seedLegacyOrgDraft(protocol, {
            type: 'object', name: 'org_widget', body: OBJECT, organizationId: 'org_a',
        });
        expect(orgRows(rows)).toEqual([
            { type: 'object', name: 'org_widget', org: 'org_a', state: 'draft' },
        ]);

        await expect(
            protocol.publishMetaItem({ type: 'object', name: 'org_widget', organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        // The draft is still there (refusing is not disposal — ruling 2 = A),
        // and no ACTIVE row was minted.
        expect(orgRows(rows).filter((r) => r.state === 'active')).toEqual([]);
    });

    it('R10 — publishPackageDrafts refuses the batch rather than promoting the residue', async () => {
        // Studio's "publish whole app". The batch is atomic by ADR-0067 D2, so
        // one refused item fails the whole publish loudly instead of half-landing.
        const { protocol, rows } = makeProtocol([], 'env_prod');
        await seedLegacyOrgDraft(protocol, {
            type: 'object', name: 'org_widget', body: OBJECT, organizationId: 'org_a', packageId: 'app.demo',
        });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo', organizationId: 'org_a' });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'org_widget', code: 'NOT_OVERRIDABLE' });
        expect(orgRows(rows).filter((r) => r.state === 'active')).toEqual([]);
    });

    // ── the controls: what must NOT change ────────────────────────────────

    it('G1 — view IS allowOrgOverride:true, so its org-scoped write still succeeds', async () => {
        // Without this control the refusals above would also pass on a harness
        // that could not save anything at all. `view` is the type ADR-0005
        // whitelists, and its per-org rows ARE read back (on demand, by
        // `getMetaItem`/`getMetaItems`) — which is the whole distinction.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'view', name: 'org_grid', item: VIEW, organizationId: 'org_a',
        });

        expect(result.success).toBe(true);
        expect(orgRows(rows)).toEqual([
            { type: 'view', name: 'org_grid', org: 'org_a', state: 'active' },
        ]);
    });

    it('G2 — an ENV-WIDE write of the same object still succeeds', async () => {
        // The refusal is about the org dimension only. A tenant-authored object
        // remains authorable; it just lands where boot can read it back.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({ type: 'object', name: 'org_widget', item: OBJECT });

        expect(result.success).toBe(true);
        expect(orgRows(rows)).toEqual([
            { type: 'object', name: 'org_widget', org: null, state: 'active' },
        ]);
    });

    it('G3 — an ENV-WIDE brand-new flow still saves (the allowRuntimeCreate tier is intact)', async () => {
        // #6283 left this tier open and this change does not close it. What
        // changed is the SCOPE such a write may claim, not whether tenants may
        // author automations.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({ type: 'flow', name: 'org_sweep', item: FLOW });

        expect(result.success).toBe(true);
        expect(orgRows(rows)).toEqual([
            { type: 'flow', name: 'org_sweep', org: null, state: 'active' },
        ]);
    });

    it('G4 — an env-wide draft still publishes under a session carrying an active org (#3115)', async () => {
        // The highest-traffic path in Studio, and the one most at risk from a
        // gate keyed on the wrong org: `publishPackageDrafts` promotes each
        // draft in the draft's OWN scope, so a session's active org must not
        // make an env-wide draft look org-scoped.
        const { protocol, rows } = makeProtocol([], 'env_prod');
        await protocol.saveMetaItem({
            type: 'object', name: 'org_widget', item: OBJECT, packageId: 'app.demo', mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo', organizationId: 'org_a' });

        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(orgRows(rows).filter((r) => r.state === 'active')).toEqual([
            { type: 'object', name: 'org_widget', org: null, state: 'active' },
        ]);
    });

    // ── the declaration behind the enforcement ────────────────────────────

    it('G5 — the refused set is DERIVED from the registry, not a parallel list', async () => {
        // Prime Directive #8. If anyone re-adds a type to a hand-written list
        // instead, the enforcement cases above go red rather than this one —
        // which is why they, not this, are the acceptance criterion. Recorded
        // as a measurement so the blast radius of the ruling is auditable:
        // 17 of 27 registry entries change behaviour here. (It was 19 when the
        // ruling was made; #5488 has since withdrawn `api`'s runtime-create
        // door entirely and #7893 withdrew `field`'s, so both now sit in the
        // CODE-ONLY tier — refused env-wide and org-scoped alike, before this
        // gate is consulted.)
        const affected = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => !e.allowOrgOverride && e.allowRuntimeCreate)
            .map((e) => e.type);
        const orgOverridable = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => e.allowOrgOverride)
            .map((e) => e.type);

        expect(orgOverridable).toEqual(['view', 'dashboard', 'report', 'translation', 'email_template']);
        // The types the maintainer ruling names explicitly, all present.
        for (const t of ['object', 'hook', 'seed', 'mapping', 'flow']) {
            expect(affected, `${t} must be refused org-scoped`).toContain(t);
        }
        // `api` and `field` were also named by the ruling; each left this set
        // for the STRONGER tier, not for a per-org channel — pin the direction,
        // because "no longer in the org-scoped refusal set" reads identically
        // to "now permitted org-scoped" unless the destination is asserted.
        // (`field`: #7893, maintainer-ruled 2026-08-12 — the standalone create
        // door minted a row no read path composed into its parent object.)
        for (const t of ['api', 'field']) {
            expect(affected, `${t} must have left this set for the code-only tier`).not.toContain(t);
            expect(
                DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === t),
            ).toMatchObject({ allowOrgOverride: false, allowRuntimeCreate: false });
        }
        expect(affected).toHaveLength(17);
    });
});

/**
 * An org-scoped change to which public forms accept anonymous intake is
 * refused when the anonymous form doors would never read that organization:
 * they resolve the form in `tenancy.defaultOrgId()`'s organization, which a
 * walled posture (degraded or not) answers `null`. Same stub engine as above;
 * the `tenancy` service is the only addition.
 */
describe('org-scoped anonymous form intake changes the anonymous doors cannot see', () => {
    const sharing = (allowAnonymous: boolean) => ({ enabled: true, allowAnonymous, publicLink: '/forms/walled-intake' });
    const FORM_VIEW = (allowAnonymous: boolean, label = 'Intake') => ({
        name: 'task.intake_form',
        label,
        object: 'task',
        viewKind: 'form',
        config: { sharing: sharing(allowAnonymous) },
    });

    /** `defaultOrgId` answers what the anonymous doors resolve. */
    function makeTenancyProtocol(defaultOrgId: string | null) {
        const { engine, rows } = makeStubEngine();
        const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => defaultOrgId }]]);
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_prod') as any;
        return { protocol, rows };
    }

    async function publishEnvWide(protocol: any) {
        const res = await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(true) });
        expect(res.success).toBe(true);
    }

    it('walled (no organization for an anonymous request): the org-scoped withdrawal is refused and nothing is saved', async () => {
        const { protocol, rows } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);

        const refusal = protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(false), organizationId: 'org_a',
        });
        await expect(refusal).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
        await expect(refusal).rejects.toThrow(/Save it env-wide instead/);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('walled: an org-scoped withdrawal through `sharing.enabled` alone is refused the same way', async () => {
        const { protocol, rows } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);
        const body = FORM_VIEW(true);
        body.config.sharing.enabled = false;

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: body, organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('walled: an org-scoped draft of the withdrawal is refused too', async () => {
        const { protocol, rows } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(false), organizationId: 'org_a', mode: 'draft',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('walled: an org-scoped publish of a form the env-wide definition keeps private is refused', async () => {
        const { protocol } = makeTenancyProtocol(null);
        const res = await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) });
        expect(res.success).toBe(true);

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    });

    it('walled: a legacy org-scoped draft of the withdrawal cannot be promoted', async () => {
        const { protocol, rows } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);
        await seedLegacyOrgDraft(protocol, {
            type: 'view', name: 'task.intake_form', body: FORM_VIEW(false), organizationId: 'org_a',
        });

        await expect(
            protocol.publishMetaItem({ type: 'view', name: 'task.intake_form', organizationId: 'org_a' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows).filter((r) => r.org === 'org_a' && r.state === 'active')).toEqual([]);
    });

    // ADR-0048 keys a draft by its package too: two packages can each hold a
    // draft of the same view in one organization. The promotion judges the
    // draft it promotes, under the same key, never the other package's.
    describe('walled: two packages hold a draft of the same view in one organization', () => {
        async function seedTwoPackageDrafts() {
            const { protocol, rows } = makeTenancyProtocol(null);
            await publishEnvWide(protocol);
            // Package A's draft leaves the anonymous intake alone; package B's
            // withdraws it, which an organization the doors never read refuses.
            await seedLegacyOrgDraft(protocol, {
                type: 'view', name: 'task.intake_form', body: FORM_VIEW(true, 'Intake (A)'),
                organizationId: 'org_a', packageId: 'pkg_a',
            });
            await seedLegacyOrgDraft(protocol, {
                type: 'view', name: 'task.intake_form', body: FORM_VIEW(false),
                organizationId: 'org_a', packageId: 'pkg_b',
            });
            const draftsOf = () => Array.from(rows.values())
                .filter((r) => r.organization_id === 'org_a' && r.state === 'draft')
                .map((r) => r.package_id)
                .sort();
            const activeOf = () => Array.from(rows.values())
                .filter((r) => r.organization_id === 'org_a' && r.state === 'active')
                .map((r) => r.package_id);
            expect(draftsOf()).toEqual(['pkg_a', 'pkg_b']);
            return { protocol, draftsOf, activeOf };
        }

        it('promoting package B judges B\'s draft: refused, and nothing becomes active', async () => {
            const { protocol, draftsOf, activeOf } = await seedTwoPackageDrafts();
            await expect(protocol.publishMetaItem({
                type: 'view', name: 'task.intake_form', organizationId: 'org_a', packageId: 'pkg_b',
            })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
            expect(activeOf()).toEqual([]);
            expect(draftsOf()).toEqual(['pkg_a', 'pkg_b']);
        });

        it('control: promoting package A judges A\'s draft and promotes it, leaving B\'s draft pending', async () => {
            const { protocol, draftsOf, activeOf } = await seedTwoPackageDrafts();
            const res = await protocol.publishMetaItem({
                type: 'view', name: 'task.intake_form', organizationId: 'org_a', packageId: 'pkg_a',
            });
            expect(res.success).toBe(true);
            expect(activeOf()).toEqual(['pkg_a']);
            expect(draftsOf()).toEqual(['pkg_b']);
        });
    });

    it('control (walled): an org-scoped edit that leaves the anonymous intake alone still saves', async () => {
        const { protocol, rows } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);

        const res = await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true, 'Intake (tenant)'), organizationId: 'org_a',
        });
        expect(res.success).toBe(true);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([
            { type: 'view', name: 'task.intake_form', org: 'org_a', state: 'active' },
        ]);
    });

    it('control (walled): the env-wide withdrawal is accepted', async () => {
        const { protocol } = makeTenancyProtocol(null);
        await publishEnvWide(protocol);

        const res = await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) });
        expect(res.success).toBe(true);
        expect(res.message).toContain('env-wide');
    });

    it('control (single): the doors resolve this organization, so the org-scoped withdrawal is accepted', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        await publishEnvWide(protocol);

        const res = await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(false), organizationId: 'org_a',
        });
        expect(res.success).toBe(true);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([
            { type: 'view', name: 'task.intake_form', org: 'org_a', state: 'active' },
        ]);
    });

    // A withdrawal is a kill switch: in the organization the doors DO read, an
    // org-scoped write may narrow intake but never re-open a form the env-wide
    // definition withdrew (the doors would keep answering it as not found).
    it('single: an org-scoped re-open of a form the env-wide definition withdrew is refused and nothing is saved', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        const res = await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) });
        expect(res.success).toBe(true);

        const refusal = protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        });
        await expect(refusal).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
        await expect(refusal).rejects.toThrow(/cannot keep public form '\/forms\/walled-intake' open/);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('single: the re-open through `sharing.enabled` is refused when the env-wide definition switched it off', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        const off = FORM_VIEW(true);
        off.config.sharing.enabled = false;
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: off })).success).toBe(true);

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a', mode: 'draft',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('control (single): an org-scoped edit that keeps the env-wide withdrawal still saves', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) });

        const res = await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(false, 'Intake (tenant)'), organizationId: 'org_a',
        });
        expect(res.success).toBe(true);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([
            { type: 'view', name: 'task.intake_form', org: 'org_a', state: 'active' },
        ]);
    });

    it('single: re-saving an org overlay that was open before the env-wide withdrawal is refused', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        await publishEnvWide(protocol);
        // Open in the organization while open env-wide: accepted.
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        })).success).toBe(true);
        // Then withdrawn env-wide (the link kept, anonymous access cleared).
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) })).success)
            .toBe(true);
        const before = orgRows(rows).filter((r) => r.org === 'org_a');
        // A re-save of the still-open overlay (only its label changes) would
        // leave open a form the env-wide layer withdrew: refused.
        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true, 'Intake (renamed)'), organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual(before);
    });

    it('single: a container-shaped org save is judged as the list read expands it', async () => {
        const { protocol, rows } = makeTenancyProtocol('org_a');
        const container = (allowAnonymous: boolean) => ({
            name: 'task', object: 'task', formViews: { intake_form: { sharing: sharing(allowAnonymous) } },
        });
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task', item: container(false) })).success).toBe(true);
        const refusal = protocol.saveMetaItem({ type: 'view', name: 'task', item: container(true), organizationId: 'org_a' });
        await expect(refusal).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        await expect(refusal).rejects.toThrow(/cannot keep public form '\/forms\/walled-intake' open/);
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
        // Control: the same container kept withdrawn in the organization saves.
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task', item: container(false), organizationId: 'org_a',
        })).success).toBe(true);
    });

    describe('single: identity is the stored row, so moving the form inside its row does not escape', () => {
        const LINK = '/forms/walled-intake';
        const open = { enabled: true, allowAnonymous: true, publicLink: LINK };
        const withdrawnRow = {
            name: 'task', object: 'task',
            formViews: { intake_form: { sharing: { ...open, allowAnonymous: false } } },
        };
        const overlays: Array<[string, Record<string, unknown>]> = [
            ['a formViews key rename', { name: 'task', object: 'task', formViews: { intake_v2: { sharing: open } } }],
            ['a move to the nested form with a form.name rename',
                { name: 'task', object: 'task', form: { name: 'renamed_intake', sharing: open } }],
            ['a listViews collision that makes the expansion rename it',
                { name: 'task', object: 'task', listViews: { intake_form: { type: 'grid' } }, formViews: { intake_form: { sharing: open } } }],
            ['the same key re-pointed at a new slug',
                { name: 'task', object: 'task', formViews: { intake_form: { sharing: { ...open, publicLink: '/forms/walled-intake-2' } } } }],
            ['the same key re-pointed at a case-only variant',
                { name: 'task', object: 'task', formViews: { intake_form: { sharing: { ...open, publicLink: '/forms/Walled-Intake' } } } }],
        ];
        for (const [label, overlay] of overlays) {
            it(`${label}: refused and nothing is saved`, async () => {
                const { protocol, rows } = makeTenancyProtocol('org_a');
                expect((await protocol.saveMetaItem({ type: 'view', name: 'task', item: withdrawnRow })).success).toBe(true);
                await expect(protocol.saveMetaItem({ type: 'view', name: 'task', item: overlay, organizationId: 'org_a' }))
                    .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
                expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
            });
        }

        it('control: a sibling form in another slot with another slug still saves', async () => {
            const { protocol } = makeTenancyProtocol('org_a');
            expect((await protocol.saveMetaItem({ type: 'view', name: 'task', item: withdrawnRow })).success).toBe(true);
            const sibling = {
                name: 'task', object: 'task',
                formViews: {
                    intake_form: { sharing: { ...open, allowAnonymous: false } },
                    feedback: { sharing: { ...open, publicLink: '/forms/feedback' } },
                },
            };
            expect((await protocol.saveMetaItem({ type: 'view', name: 'task', item: sibling, organizationId: 'org_a' })).success)
                .toBe(true);
        });
    });

    it('single: the same view item re-pointed at a new slug is refused', async () => {
        const { protocol } = makeTenancyProtocol('org_a');
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(false) })).success).toBe(true);
        const moved = FORM_VIEW(true);
        moved.config.sharing.publicLink = '/forms/walled-intake-2';
        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: moved, organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    });

    it('control (single): only an explicit false withdraws — allowAnonymous absent env-wide is not a withdrawal', async () => {
        const { protocol } = makeTenancyProtocol('org_a');
        const absent = FORM_VIEW(true);
        delete (absent.config.sharing as any).allowAnonymous;
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: absent })).success).toBe(true);
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        })).success).toBe(true);
    });

    it('control (single): a sharing with no public link env-wide is not a withdrawal', async () => {
        const { protocol } = makeTenancyProtocol('org_a');
        const linkless = FORM_VIEW(true);
        linkless.config.sharing = { enabled: false, allowAnonymous: false } as any;
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: linkless })).success).toBe(true);
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        })).success).toBe(true);
    });

    it('control (single): an org-scoped republish over an env-wide published form still saves', async () => {
        const { protocol } = makeTenancyProtocol('org_a');
        await publishEnvWide(protocol);
        const off = await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(false), organizationId: 'org_a',
        });
        expect(off.success).toBe(true);
        const on = await protocol.saveMetaItem({
            type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
        });
        expect(on.success).toBe(true);
    });

    // Known limit (fails closed): a withdrawal of a view name closes that name
    // in every package, so the row anchor judges an overlay against the
    // env-wide row of its name whichever package that row came from. Two
    // packages ship the container `task`; the env-wide row read for the name
    // is package B's, which withdraws the form.
    describe('single: two packages ship the same view name', () => {
        const LINK = '/forms/walled-intake';
        const open = { enabled: true, allowAnonymous: true, publicLink: LINK };
        const shippedA = {
            name: 'task', object: 'task', formViews: { intake_form: { sharing: open } }, _packageId: 'pkg_a',
        };
        const shippedB = {
            name: 'task', object: 'task',
            formViews: { intake_form: { sharing: { ...open, allowAnonymous: false } } }, _packageId: 'pkg_b',
        };

        function makeTwoPackageProtocol() {
            const { engine, rows } = makeStubEngine();
            engine.registry.listItems = (type: string) => (type === 'view' ? [shippedA, shippedB] : []);
            engine.registry.getArtifactItem = (type: string, name: string, pkg?: string) => {
                if (type !== 'view' || name !== 'task') return undefined;
                if (pkg === 'pkg_a') return shippedA;
                return shippedB;
            };
            const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => 'org_a' }]]);
            const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_prod') as any;
            return { protocol, rows };
        }

        it('a row-anchored rename by a package-bound org save is refused, and nothing is saved', async () => {
            const { protocol, rows } = makeTwoPackageProtocol();
            const renamed = { name: 'task', object: 'task', formViews: { intake_v2: { sharing: open } } };
            await expect(protocol.saveMetaItem({
                type: 'view', name: 'task', item: renamed, organizationId: 'org_a', packageId: 'pkg_a',
            })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
            expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
        });

        it('control: the same package-bound org save that keeps the form withdrawn saves', async () => {
            const { protocol } = makeTwoPackageProtocol();
            const kept = {
                name: 'task', object: 'task',
                formViews: { intake_v2: { sharing: { ...open, allowAnonymous: false } } },
            };
            expect((await protocol.saveMetaItem({
                type: 'view', name: 'task', item: kept, organizationId: 'org_a', packageId: 'pkg_a',
            })).success).toBe(true);
        });
    });

    // A package's shipped form is part of the env-wide definition, not a layer
    // of its own beneath it. A schema-parsed `false` on the artifact (the schema
    // defaults `enabled` to false) is an explicit withdrawal, so it fails closed;
    // and the env-wide definition is the administrator's switch, so an env-wide
    // save may open a form the package ships closed.
    describe('single: a package-shipped form', () => {
        const LINK = '/forms/walled-intake';
        // As the loader serves it: parsed, `enabled` never switched on.
        const shipped = {
            name: 'task.intake_form', label: 'Intake', object: 'task', viewKind: 'form',
            config: { sharing: SharingConfigSchema.parse({ allowAnonymous: true, publicLink: LINK }) },
            _packageId: 'showcase',
        };

        function makePackageProtocol() {
            const { engine, rows } = makeStubEngine();
            engine.registry.listItems = (type: string) => (type === 'view' ? [shipped] : []);
            engine.registry.getArtifactItem = (type: string, name: string) =>
                (type === 'view' && name === shipped.name ? shipped : undefined);
            const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => 'org_a' }]]);
            const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_prod') as any;
            return { protocol, rows };
        }

        it('the parsed artifact carries an explicit `false` that keeps the link', () => {
            expect(shipped.config.sharing).toMatchObject({ enabled: false, allowAnonymous: true, publicLink: LINK });
        });

        it('a schema-parsed `false` is a withdrawal: an org-scoped save that opens it is refused', async () => {
            const { protocol, rows } = makePackageProtocol();
            await expect(protocol.saveMetaItem({
                type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
            })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
            expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
        });

        it('the env-wide definition is the switch: an env-wide save opens it, and the env-wide list serves that body', async () => {
            const { protocol } = makePackageProtocol();
            expect((await protocol.saveMetaItem({ type: 'view', name: 'task.intake_form', item: FORM_VIEW(true) })).success)
                .toBe(true);
            // The env-wide layer the anonymous doors read beneath an organization.
            const envWide: any = await protocol.getMetaItems({ type: 'view' });
            const named = (envWide.items as any[]).filter((v) => v?.name === 'task.intake_form');
            expect(named).toHaveLength(1);
            expect(named[0].config.sharing).toMatchObject({ enabled: true, allowAnonymous: true, publicLink: LINK });
            // So an organization overlay that keeps it open is no longer refused.
            expect((await protocol.saveMetaItem({
                type: 'view', name: 'task.intake_form', item: FORM_VIEW(true), organizationId: 'org_a',
            })).success).toBe(true);
        });
    });
});
