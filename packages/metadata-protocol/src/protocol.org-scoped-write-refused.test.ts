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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
// The anonymous form doors' own verdict (`registerFormEndpoints` in
// `@objectstack/rest`), applied here to the protocol's real list reads.
import { anonymousFormIntakeCandidates, anonymousFormIntakeWithdrawnIn } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { expandViewContainer, SharingConfigSchema } from '@objectstack/spec/ui';
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

// The package identity of a served organization overlay. A package-less
// organization overlay is served once per package that ships its name, and
// the list merge stamps each copy with that package. The anonymous doors and
// the organization-scoped save compare no package: a withdrawal of a view name
// closes that name in every package. So an overlay stored before one
// package's env-wide withdrawal stays closed whichever package's copy is
// served, and whichever package withdraws, first or second in registry order.
// The env-wide list the doors judge against holds every package's body of the
// name, the withdrawing package's included.
describe('a package-less organization overlay, two packages shipping its view name', () => {
    const NAME = 'task.intake_form';
    const LINK = '/forms/shared-intake';
    const formView = (allowAnonymous: boolean, label = 'Intake') => ({
        name: NAME,
        label,
        object: 'task',
        viewKind: 'form',
        config: { sharing: { enabled: true, allowAnonymous, publicLink: LINK } },
    });
    const shippedA = { ...formView(true), _packageId: 'pkg_a' };
    const shippedB = { ...formView(true), _packageId: 'pkg_b' };

    /** Package A first in registry order: a lookup naming no package answers A's artifact. */
    function makeTwoPackageProtocol() {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'view' ? [shippedA, shippedB] : []);
        engine.registry.getArtifactItem = (type: string, name: string, pkg?: string) => {
            if (type !== 'view' || name !== NAME) return undefined;
            return pkg === 'pkg_b' ? shippedB : shippedA;
        };
        const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => 'org_a' }]]);
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_prod') as any;
        return { protocol, rows };
    }

    /** The organization read's copies of the view, where the doors find the form. */
    async function servedCopies(protocol: any): Promise<Array<Record<string, any>>> {
        const org: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_a' });
        return (org.items as any[]).filter((v) => v?.name === NAME);
    }

    /**
     * The copies the anonymous doors would serve for the slug: open, and not
     * withdrawn by the env-wide layer they read beneath the organization's.
     */
    async function doorsServe(protocol: any): Promise<Array<Record<string, any>>> {
        const envWide: any = await protocol.getMetaItems({ type: 'view' });
        const layer: unknown[] = envWide.items;
        return (await servedCopies(protocol)).filter((view) => anonymousFormIntakeCandidates(view)
            .some((c) => c.slug === 'shared-intake' && !anonymousFormIntakeWithdrawnIn(layer, view, c)));
    }

    /** The organization overlay, stored package-less while the form is open everywhere. */
    async function storeOpenOverlay(protocol: any, rows: Map<string, Row>) {
        expect((await protocol.saveMetaItem({
            type: 'view', name: NAME, item: formView(true, 'Intake (org)'), organizationId: 'org_a',
        })).success).toBe(true);
        expect(Array.from(rows.values()).filter((r) => r.organization_id === 'org_a').map((r) => r.package_id))
            .toEqual([null]);
    }

    it('the organization read serves the overlay once per package, each copy stamped with that package', async () => {
        const { protocol, rows } = makeTwoPackageProtocol();
        await storeOpenOverlay(protocol, rows);
        const copies = await servedCopies(protocol);
        expect(copies.map((v) => v.label)).toEqual(['Intake (org)', 'Intake (org)']);
        expect(copies.map((v) => v._packageId).sort()).toEqual(['pkg_a', 'pkg_b']);
        // Control: before any withdrawal the doors serve the overlay.
        expect(await doorsServe(protocol)).toHaveLength(2);
    });

    for (const [order, withdrawing] of [['first', 'pkg_a'], ['second', 'pkg_b']] as const) {
        describe(`the package ${order} in registry order withdraws the name env-wide`, () => {
            async function withdrawAfterOverlay() {
                const { protocol, rows } = makeTwoPackageProtocol();
                await storeOpenOverlay(protocol, rows);
                expect((await protocol.saveMetaItem({
                    type: 'view', name: NAME, item: formView(false), packageId: withdrawing,
                })).success).toBe(true);
                return { protocol, rows };
            }

            it('the env-wide list the doors read holds the withdrawal beside the other package\'s body', async () => {
                const { protocol } = await withdrawAfterOverlay();
                const envWide: any = await protocol.getMetaItems({ type: 'view' });
                const named = (envWide.items as any[]).filter((v) => v?.name === NAME)
                    .map((v) => [v._packageId, v.config.sharing.allowAnonymous])
                    .sort();
                expect(named).toEqual([['pkg_a', withdrawing !== 'pkg_a'], ['pkg_b', withdrawing !== 'pkg_b']]);
            });

            it('the doors serve no copy of the overlay stored before the withdrawal', async () => {
                const { protocol } = await withdrawAfterOverlay();
                // Both stamped copies are still the open overlay, and both are closed.
                expect((await servedCopies(protocol)).map((v) => v._packageId).sort()).toEqual(['pkg_a', 'pkg_b']);
                expect(await doorsServe(protocol)).toEqual([]);
            });

            it('a re-save of the overlay is refused, and nothing changes', async () => {
                const { protocol, rows } = await withdrawAfterOverlay();
                const before = Array.from(rows.values()).filter((r) => r.organization_id === 'org_a');
                await expect(protocol.saveMetaItem({
                    type: 'view', name: NAME, item: formView(true, 'Intake (org, again)'), organizationId: 'org_a',
                })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
                expect(Array.from(rows.values()).filter((r) => r.organization_id === 'org_a')).toEqual(before);
            });
        });
    }
});

// A publish promotes only the draft its gate judged. The gate reads the draft
// to judge it, and the promotion reads the draft row again to write it; the
// promotion is handed the judged draft's hash, so a draft saved between the
// two reads is refused as a conflict, never promoted unjudged.
describe('a publish promotes only the draft its gate judged', () => {
    const judged = { ...VIEW, label: 'Org grid (judged)' };
    const later = { ...VIEW, label: 'Org grid (saved after the gate read)' };

    /** A draft save that lands after the gate's read and before the promotion's read. */
    function saveBeforePromotion(protocol: any, body: unknown) {
        const repo = protocol.getOverlayRepo(null);
        const promote = repo.promoteDraft.bind(repo);
        repo.promoteDraft = async (...args: unknown[]) => {
            expect((await protocol.saveMetaItem({ type: 'view', name: VIEW.name, item: body, mode: 'draft' })).success)
                .toBe(true);
            return promote(...args);
        };
    }

    const labelsIn = (rows: Map<string, Row>, state: string) => Array.from(rows.values())
        .filter((r) => r.type === 'view' && r.name === VIEW.name && r.state === state)
        .map((r) => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata).label);

    it('a draft saved after the gate read is not promoted, and the conflict answers', async () => {
        const { protocol, rows } = makeProtocol();
        expect((await protocol.saveMetaItem({ type: 'view', name: VIEW.name, item: judged, mode: 'draft' })).success)
            .toBe(true);
        saveBeforePromotion(protocol, later);

        await expect(protocol.publishMetaItem({ type: 'view', name: VIEW.name }))
            .rejects.toMatchObject({ code: 'METADATA_CONFLICT', status: 409 });
        expect(labelsIn(rows, 'active')).toEqual([]);
        expect(labelsIn(rows, 'draft')).toEqual([later.label]);
    });

    it('a draft saved where the gate judged none is not promoted, and the conflict answers', async () => {
        const { protocol, rows } = makeProtocol();
        saveBeforePromotion(protocol, later);

        await expect(protocol.publishMetaItem({ type: 'view', name: VIEW.name }))
            .rejects.toMatchObject({ code: 'METADATA_CONFLICT', status: 409 });
        expect(labelsIn(rows, 'active')).toEqual([]);
        expect(labelsIn(rows, 'draft')).toEqual([later.label]);
    });

    it('control: with no save in between, the judged draft is promoted and its draft row drained', async () => {
        const { protocol, rows } = makeProtocol();
        expect((await protocol.saveMetaItem({ type: 'view', name: VIEW.name, item: judged, mode: 'draft' })).success)
            .toBe(true);

        expect((await protocol.publishMetaItem({ type: 'view', name: VIEW.name })).success).toBe(true);
        expect(labelsIn(rows, 'active')).toEqual([judged.label]);
        expect(labelsIn(rows, 'draft')).toEqual([]);
    });
});

// The lock a publish consults is the one at the address it promotes: the
// package key the publish resolved (the caller's stated binding, else the
// draft row's own), not only the package the request stated. With two
// packages' env-wide rows of one view both locked, the refusal carries the
// lock of the package whose draft is being promoted.
describe('a publish consults the lock of the package key it resolved', () => {
    const locked = (pkg: string) => ({ ...VIEW, _lock: 'full', _lockReason: `${pkg} keeps this view as shipped` });

    async function seedLockedRowsAndDraft(draftPackage: string) {
        const { protocol, rows } = makeProtocol();
        await protocol.ensureOverlayIndex();
        const repo = protocol.getOverlayRepo(null);
        const ref = { type: 'view', name: VIEW.name, org: 'env' };
        const opts = { parentVersion: null, actor: null, source: 'test.seed', intent: 'runtime-only' as const };
        for (const pkg of ['pkg_a', 'pkg_b']) {
            await repo.put(ref, locked(pkg), { ...opts, state: 'active', packageId: pkg });
        }
        await repo.put(ref, { ...VIEW, label: 'Org grid (draft)' }, { ...opts, state: 'draft', packageId: draftPackage });
        const draftsOf = () => Array.from(rows.values()).filter((r) => r.state === 'draft').map((r) => r.package_id);
        return { protocol, draftsOf };
    }

    it('a publish that states no package consults the lock of the draft row\'s own package', async () => {
        const { protocol, draftsOf } = await seedLockedRowsAndDraft('pkg_b');
        await expect(protocol.publishMetaItem({ type: 'view', name: VIEW.name }))
            .rejects.toMatchObject({ code: 'ITEM_LOCKED', status: 403, lock: 'full', lockReason: 'pkg_b keeps this view as shipped' });
        expect(draftsOf()).toEqual(['pkg_b']);
    });

    it('control: a publish that states its package consults that package\'s lock', async () => {
        const { protocol, draftsOf } = await seedLockedRowsAndDraft('pkg_a');
        await expect(protocol.publishMetaItem({ type: 'view', name: VIEW.name, packageId: 'pkg_a' }))
            .rejects.toMatchObject({ code: 'ITEM_LOCKED', status: 403, lock: 'full', lockReason: 'pkg_a keeps this view as shipped' });
        expect(draftsOf()).toEqual(['pkg_a']);
    });
});

// The organization-scoped save check anchors the overlay on the env-wide
// definition of its row, one per package that holds the name: each package's
// own env-wide row, else the package-less env-wide row (which stands in for
// every package), else that package's artifact. So a package that withdraws
// the form is judged whatever its place in registry order, and another
// package's stored row anchors that package only.
describe('the save check anchors each package\'s row on that package\'s env-wide definition', () => {
    const LINK = '/forms/walled-intake';
    const open = { enabled: true, allowAnonymous: true, publicLink: LINK };
    const container = (sharing: Record<string, unknown>, key = 'intake_form') => ({
        name: 'task', object: 'task', formViews: { [key]: { sharing } },
    });
    // Registry order: package A (open) first, so a lookup that names no
    // package answers A's artifact. Package B, which withdraws, is second.
    const shippedA = { ...container(open), _packageId: 'pkg_a' };
    const shippedB = { ...container({ ...open, allowAnonymous: false }), _packageId: 'pkg_b' };
    // The overlay moves the form to another key, so only the row anchor matches it.
    const renamedOpen = container(open, 'intake_v2');

    function makeTwoPackageProtocol() {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'view' ? [shippedA, shippedB] : []);
        engine.registry.getArtifactItem = (type: string, name: string, pkg?: string) => {
            if (type !== 'view' || name !== 'task') return undefined;
            return pkg === 'pkg_b' ? shippedB : shippedA;
        };
        const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => 'org_a' }]]);
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_prod') as any;
        return { protocol, rows };
    }

    for (const [label, packageId] of [['a package-less', undefined], ['a package A-bound', 'pkg_a']] as const) {
        it(`the withdrawing package is not first in registry order: ${label} org save that renames the form is refused`, async () => {
            const { protocol, rows } = makeTwoPackageProtocol();
            await expect(protocol.saveMetaItem({
                type: 'view', name: 'task', item: renamedOpen, organizationId: 'org_a',
                ...(packageId ? { packageId } : {}),
            })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
            expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
        });
    }

    it('another package\'s env-wide row anchors that package only: the org save is still judged against the withdrawing package', async () => {
        const { protocol, rows } = makeTwoPackageProtocol();
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task', item: { ...container(open), label: 'Task (A, env-wide)' }, packageId: 'pkg_a',
        })).success).toBe(true);
        await expect(protocol.saveMetaItem({
            type: 'view', name: 'task', item: renamedOpen, organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, organizationId: 'org_a' });
        expect(orgRows(rows).filter((r) => r.org === 'org_a')).toEqual([]);
    });

    it('control: the same org save that keeps the form withdrawn saves', async () => {
        const { protocol } = makeTwoPackageProtocol();
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task', item: container({ ...open, allowAnonymous: false }, 'intake_v2'), organizationId: 'org_a',
        })).success).toBe(true);
    });

    it('control: a package-less env-wide row stands in for every package, so the org save it leaves open saves', async () => {
        const { protocol } = makeTwoPackageProtocol();
        expect((await protocol.saveMetaItem({ type: 'view', name: 'task', item: container(open) })).success).toBe(true);
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task', item: renamedOpen, organizationId: 'org_a',
        })).success).toBe(true);
    });
});

// The draft-key read runs ahead of the lock check, so an unreadable store is
// answered there as the lock read answers it: a 503, never a driver error.
describe('a publish that states no package, over a store that cannot be read', () => {
    it('answers 503 SERVICE_UNAVAILABLE, and promotes nothing', async () => {
        const { protocol, rows } = makeProtocol();
        await protocol.ensureOverlayIndex();
        await protocol.getOverlayRepo(null).put(
            { type: 'view', name: VIEW.name, org: 'env' },
            VIEW,
            { parentVersion: null, actor: null, source: 'test.seed', intent: 'runtime-only', state: 'draft', packageId: null },
        );
        const unreadable = () => { throw new Error('connection reset by peer'); };
        protocol.engine.findOne = unreadable;
        protocol.engine.find = unreadable;
        await expect(protocol.publishMetaItem({ type: 'view', name: VIEW.name }))
            .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(Array.from(rows.values()).filter((r) => r.state === 'active')).toEqual([]);
    });
});

// Each package's copy of a view container expands into that package's own
// slot. Two packages ship the container `task`, and the source registrars
// register its form `task.intake_form` once per package. An env-wide copy of
// the container stored for one package writes that package's item of each
// name it expands, and a package-less copy stands in for every package with
// no copy of its own (ADR-0048). So the env-wide view list the anonymous doors
// judge against holds every package's body of the form, and any package's
// withdrawal of it, shipped or saved, closes it. The by-name read naming a
// package serves the item that package's slot in the list serves.
describe('each package\'s copy of a view container expands into its own package\'s slot', () => {
    const NAME = 'task.intake_form';
    const SLUG = 'shared-intake';
    const sharing = (allowAnonymous: boolean) => ({ enabled: true, allowAnonymous, publicLink: `/forms/${SLUG}` });
    // Each body of the form is told apart by its title.
    const container = (allowAnonymous: boolean, title = 'Intake') => ({
        name: 'task', object: 'task', formViews: { intake_form: { title, sharing: sharing(allowAnonymous) } },
    });
    const formView = (allowAnonymous: boolean, title: string) => ({
        name: NAME, label: title, object: 'task', viewKind: 'form', config: { title, sharing: sharing(allowAnonymous) },
    });

    /**
     * The registry where these pins turn on it, held as the real
     * `SchemaRegistry` holds it: each package's entries under
     * `<package>:<name>` (the container and the views the source registrars
     * expand from it), a row an unscoped kernel hydrates under the bare name,
     * `getItem` bare slot first, and `getArtifactItem`'s package-scoped
     * code-artifact lookup. `owner` is the code package that owns the object.
     */
    function packagesRegistry(shipped: Array<[string, Record<string, unknown>]>, owner?: string) {
        const entries = new Map<string, Record<string, any>>();
        const register = (item: Record<string, any>, packageId?: string) => {
            if (packageId) {
                if (item._packageId === undefined) item._packageId = packageId;
                if (item._provenance === undefined) item._provenance = 'package';
            }
            entries.set(packageId ? `${packageId}:${String(item.name)}` : String(item.name), item);
        };
        for (const [packageId, body] of shipped) {
            register({ ...body, name: 'task' }, packageId);
            for (const vi of expandViewContainer('task', body)) register({ ...(vi as any) }, packageId);
        }
        const composite = (name: string) => [...entries].filter(([key]) => key.endsWith(`:${name}`)).map(([, it]) => it);
        return {
            registerItem: (type: string, item: Record<string, any>, _keyField?: string, packageId?: string) => {
                if (type === 'view') register(item, packageId);
            },
            listItems: (type: string, packageId?: string) => (type === 'view'
                ? [...entries.values()].filter((it) => !packageId || it._packageId === packageId)
                : []),
            getItem: (type: string, name: string, packageId?: string) => (type !== 'view'
                ? undefined
                : entries.get(name) ?? (packageId ? entries.get(`${packageId}:${name}`) : undefined) ?? composite(name)[0]),
            getArtifactItem: (type: string, name: string, packageId?: string) => {
                if (type !== 'view') return undefined;
                const shippedAs = composite(name).filter((it) => isCodeArtifactBody(it));
                return (packageId ? shippedAs.find((it) => it._packageId === packageId) : undefined) ?? shippedAs[0];
            },
            getPackagedObjectOwner: (name: string) => (owner && name === 'task' ? { packageId: owner, ownership: 'own' } : undefined),
            getObject: () => undefined,
            registerObject: () => {},
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            isObjectPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        };
    }

    const KERNELS = [
        ['an environment-scoped kernel', 'env_prod'],
        ['an unscoped kernel (write-through hydrates the registry)', undefined],
    ] as const;

    function harness(shipped: Array<[string, Record<string, unknown>]>, environmentId: string | undefined, owner?: string) {
        const { engine, rows } = makeStubEngine();
        engine.registry = packagesRegistry(shipped, owner);
        const services = new Map<string, unknown>([['tenancy', { defaultOrgId: async () => 'org_a' }]]);
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, environmentId) as any;
        return { protocol, rows };
    }

    /** An organization overlay of the form, open, as a rollback restores it: the save check never judged it. */
    async function restoreOpenOverlay(protocol: any) {
        await protocol.ensureOverlayIndex();
        await protocol.getOverlayRepo('org_a').put(
            { type: 'view', name: NAME, org: 'org_a' },
            formView(true, 'Intake (org)'),
            { parentVersion: null, actor: null, source: 'test.restored', intent: 'runtime-only', state: 'active', packageId: null },
        );
    }

    /** An env-wide copy of the container, stored for `packageId` (package-less when undefined). */
    async function saveCopy(protocol: any, packageId: string | undefined, allowAnonymous: boolean, title: string) {
        expect((await protocol.saveMetaItem({
            type: 'view', name: 'task', item: container(allowAnonymous, title), ...(packageId ? { packageId } : {}),
        })).success).toBe(true);
    }

    /** Each body of the form in the env-wide view list: [package, allowAnonymous, title]. */
    async function envWideBodies(protocol: any): Promise<Array<[unknown, unknown, unknown]>> {
        const envWide: any = await protocol.getMetaItems({ type: 'view' });
        return (envWide.items as any[]).filter((v) => v?.name === NAME)
            .map((v): [unknown, unknown, unknown] => [v._packageId ?? null, v.config?.sharing?.allowAnonymous, v.config?.title])
            .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    }

    /**
     * What the anonymous doors serve for the slug, by their own composition
     * (`registerFormEndpoints`): the organization's read, each open candidate
     * judged over the env-wide view list beneath it.
     */
    async function doorsServe(protocol: any): Promise<unknown[]> {
        const org: any = await protocol.getMetaItems({ type: 'view', organizationId: 'org_a' });
        const envWide: any = await protocol.getMetaItems({ type: 'view' });
        return (org.items as any[]).filter((view) => anonymousFormIntakeCandidates(view)
            .some((c) => c.slug === SLUG && !anonymousFormIntakeWithdrawnIn(envWide.items, view, c)));
    }

    describe('(a) one package\'s env-wide copy is saved with the form open, and another package ships it withdrawn', () => {
        for (const [kernel, environmentId] of KERNELS) {
            for (const owner of [undefined, 'pkg_a'] as const) {
                const where = `${kernel}, ${owner ? 'the copy\'s package owns the object' : 'no code package owns the object'}`;
                it(`${where}: the env-wide list holds the shipped withdrawal beside the copy, and the doors serve no copy of the overlay`, async () => {
                    const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(false)]], environmentId, owner);
                    await restoreOpenOverlay(protocol);
                    await saveCopy(protocol, 'pkg_a', true, 'Intake (pkg_a copy)');

                    expect(await envWideBodies(protocol)).toEqual([
                        ['pkg_a', true, 'Intake (pkg_a copy)'],
                        ['pkg_b', false, 'Intake'],
                    ]);
                    expect(await doorsServe(protocol)).toEqual([]);
                });
            }
        }

        it('control: with no package withdrawing the form, the doors serve the overlay', async () => {
            const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], 'env_prod');
            await restoreOpenOverlay(protocol);
            await saveCopy(protocol, 'pkg_a', true, 'Intake (pkg_a copy)');
            expect((await doorsServe(protocol)).length).toBeGreaterThan(0);
        });
    });

    describe('(b) the same, with the withdrawal saved in the other package\'s own env-wide copy', () => {
        for (const [kernel, environmentId] of KERNELS) {
            for (const order of [['pkg_a', 'pkg_b'], ['pkg_b', 'pkg_a']] as const) {
                it(`${kernel}, ${order[0]}'s copy saved first: each copy serves its own package's slot, and the doors serve no copy of the overlay`, async () => {
                    const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                    await restoreOpenOverlay(protocol);
                    for (const pkg of order) await saveCopy(protocol, pkg, pkg === 'pkg_a', `Intake (${pkg} copy)`);

                    expect(await envWideBodies(protocol)).toEqual([
                        ['pkg_a', true, 'Intake (pkg_a copy)'],
                        ['pkg_b', false, 'Intake (pkg_b copy)'],
                    ]);
                    expect(await doorsServe(protocol)).toEqual([]);
                });
            }
        }
    });

    describe('(c) a package-less env-wide copy stands in for every package with no copy of its own', () => {
        for (const [kernel, environmentId] of KERNELS) {
            it(`${kernel}: the package-less copy serves each package's slot, so the administrator's switch opens the form for every package`, async () => {
                const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(false)]], environmentId);
                await restoreOpenOverlay(protocol);
                await saveCopy(protocol, undefined, true, 'Intake (env-wide copy)');

                expect(await envWideBodies(protocol)).toEqual([
                    ['pkg_a', true, 'Intake (env-wide copy)'],
                    ['pkg_b', true, 'Intake (env-wide copy)'],
                ]);
                expect((await doorsServe(protocol)).length).toBeGreaterThan(0);
            });

            for (const order of [[undefined, 'pkg_b'], ['pkg_b', undefined]] as const) {
                it(`${kernel}, ${order[0] ?? 'the package-less'} copy saved first: a package's own copy serves that package's slot ahead of the package-less copy`, async () => {
                    const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                    await restoreOpenOverlay(protocol);
                    for (const pkg of order) {
                        await saveCopy(protocol, pkg, pkg === undefined, pkg ? `Intake (${pkg} copy)` : 'Intake (env-wide copy)');
                    }

                    expect(await envWideBodies(protocol)).toEqual([
                        ['pkg_a', true, 'Intake (env-wide copy)'],
                        ['pkg_b', false, 'Intake (pkg_b copy)'],
                    ]);
                    expect(await doorsServe(protocol)).toEqual([]);
                });
            }
        }
    });

    describe('(d) the list\'s slot for a package and the by-name read naming that package serve the same item', () => {
        const projection = (v: any) => (v ? { name: v.name, viewKind: v.viewKind, config: v.config, _packageId: v._packageId } : v);

        /** For each package: one item in the env-wide list, and the by-name read and the list scoped to the package serve it. */
        async function expectAgreement(protocol: any, titles: Record<string, string>) {
            const envWide: any = await protocol.getMetaItems({ type: 'view' });
            for (const [pkg, title] of Object.entries(titles)) {
                const slot = (envWide.items as any[]).filter((v) => v?.name === NAME && v._packageId === pkg);
                expect(slot.map((v) => v.config?.title), `${pkg}: its one item in the env-wide list`).toEqual([title]);
                const byName = (await protocol.getMetaItem({ type: 'view', name: NAME, packageId: pkg })).item;
                expect(projection(byName), `${pkg}: the by-name read naming the package`).toEqual(projection(slot[0]));
                const scoped: any = await protocol.getMetaItems({ type: 'view', packageId: pkg });
                expect((scoped.items as any[]).filter((v) => v?.name === NAME).map(projection), `${pkg}: the list scoped to the package`)
                    .toEqual([projection(slot[0])]);
            }
        }

        for (const [kernel, environmentId] of KERNELS) {
            it(`${kernel}: a name two packages' own copies expand`, async () => {
                const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                await saveCopy(protocol, 'pkg_a', true, 'Intake (pkg_a copy)');
                await saveCopy(protocol, 'pkg_b', false, 'Intake (pkg_b copy)');
                await expectAgreement(protocol, { pkg_a: 'Intake (pkg_a copy)', pkg_b: 'Intake (pkg_b copy)' });
            });

            it(`${kernel}: a name a package-less copy expands, standing in for each package`, async () => {
                const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                await saveCopy(protocol, undefined, true, 'Intake (env-wide copy)');
                await expectAgreement(protocol, { pkg_a: 'Intake (env-wide copy)', pkg_b: 'Intake (env-wide copy)' });
            });
        }
    });

    // A stored row under exactly the form's name is that name's own row
    // (ADR-0005), and it is the row of its own package's slot (ADR-0048): it
    // keeps another package's copy out of that package's slot only when it is
    // package-less, as the by-name read naming that package decides.
    describe('(e) a stored row of the form\'s own name serves its own package\'s slot, and hides no other package\'s copy', () => {
        for (const [kernel, environmentId] of KERNELS) {
            it(`${kernel}: one package's row of the name and another package's withdrawing copy are both in the env-wide list, and the doors serve no copy of the overlay`, async () => {
                const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                await restoreOpenOverlay(protocol);
                expect((await protocol.saveMetaItem({
                    type: 'view', name: NAME, item: formView(true, 'Intake (pkg_a row)'), packageId: 'pkg_a',
                })).success).toBe(true);
                await saveCopy(protocol, 'pkg_b', false, 'Intake (pkg_b copy)');

                expect(await envWideBodies(protocol)).toEqual([
                    ['pkg_a', true, 'Intake (pkg_a row)'],
                    ['pkg_b', false, 'Intake (pkg_b copy)'],
                ]);
                expect(await doorsServe(protocol)).toEqual([]);
                const byName = (await protocol.getMetaItem({ type: 'view', name: NAME, packageId: 'pkg_b' })).item;
                expect([byName?.config?.title, byName?.config?.sharing?.allowAnonymous]).toEqual(['Intake (pkg_b copy)', false]);
            });

            it(`${kernel}, control: a package-less row of the name serves every package's slot, ahead of any copy`, async () => {
                const { protocol } = harness([['pkg_a', container(true)], ['pkg_b', container(true)]], environmentId);
                expect((await protocol.saveMetaItem({
                    type: 'view', name: NAME, item: formView(true, 'Intake (env-wide row)'),
                })).success).toBe(true);
                await saveCopy(protocol, 'pkg_b', false, 'Intake (pkg_b copy)');

                expect(await envWideBodies(protocol)).toEqual([
                    ['pkg_a', true, 'Intake (env-wide row)'],
                    ['pkg_b', true, 'Intake (env-wide row)'],
                ]);
                const byName = (await protocol.getMetaItem({ type: 'view', name: NAME, packageId: 'pkg_b' })).item;
                expect(byName?.config?.title).toBe('Intake (env-wide row)');
            });
        }
    });

    // The family's closing enumeration. The loaders register a container a
    // package ships as `<object>.<key>` for that package, whichever package
    // owns the object, so a stored copy of that container overlays those
    // names, in that package's own slot. Any other container on another
    // package's object keeps the own-name arm. Every placement a package's
    // stored copy can take is derived below as a cross product: who owns the
    // object (the copying package, another package, none), whether the
    // copying package ships the container, and which member the copy changes
    // (the bare list, a keyed member, the default form). For each one, on
    // both kernels:
    //  - the copy's member is served under the name its placement gives it,
    //    in the copying package's slot of the env-wide list and on the
    //    by-name read naming that package;
    //  - no name it writes is another package's, and every name the other
    //    package ships keeps that package's body on both read doors;
    //  - for a form, the withdrawal saved in the copy closes the anonymous
    //    doors (their own composition, as above), and the same copy saved
    //    open leaves them serving. A list carries no anonymous intake
    //    (`anonymousFormIntakeCandidates` reads forms only), so the bare
    //    list's reach is pinned on the two read doors alone.
    describe('(f) every placement a package\'s stored copy of a view container can take', () => {
        const COPYING = 'pkg_b';
        const OTHER = 'pkg_a';
        // The other package's own form is its own to serve: it gets a slug of
        // its own, so the doors' answer at SLUG is the copy's alone.
        const OTHER_SLUG = 'owner-intake';
        const COPY_TITLE = `Intake (${COPYING} copy)`;
        const SHIPPED_TITLE = (pkg: string) => `Intake (shipped by ${pkg})`;
        const OWNERS = [
            ['the copying package owns the object', COPYING],
            ['another package owns the object', OTHER],
            ['no code package owns the object', undefined],
        ] as const;
        const SHIPPING = [
            ['the copying package ships the container', true],
            ['the copying package ships no container of that name', false],
        ] as const;
        const form = (allowAnonymous: boolean, title: string, slug: string) => ({
            title, sharing: { enabled: true, allowAnonymous, publicLink: `/forms/${slug}` },
        });
        interface Member {
            readonly member: string;
            readonly isForm: boolean;
            /** The name the own-name arm gives it: the container's own name, `task`, under the object. */
            readonly ownNameAs: string;
            readonly body: (title: string, allowAnonymous: boolean, slug: string) => Record<string, unknown>;
        }
        const MEMBERS: readonly Member[] = [
            {
                member: 'the bare list', isForm: false, ownNameAs: 'task.task',
                body: (title) => ({ list: { type: 'grid', label: title, columns: ['name'] } }),
            },
            {
                member: 'a keyed member', isForm: true, ownNameAs: 'task.task.intake_form',
                body: (title, allowAnonymous, slug) => ({ formViews: { intake_form: form(allowAnonymous, title, slug) } }),
            },
            {
                member: 'the default form', isForm: true, ownNameAs: 'task.task.form',
                body: (title, allowAnonymous, slug) => ({ form: form(allowAnonymous, title, slug) }),
            },
        ];
        const PLACEMENTS = OWNERS.flatMap(([ownership, owner]) => SHIPPING.flatMap(([shipping, ships]) =>
            MEMBERS.map((m) => ({ ownership, owner, shipping, ships, m }))));
        type Placement = (typeof PLACEMENTS)[number];

        /** The names a source loader registers for a container body: the spec's expander under the object's name. */
        const loaderNames = (body: Record<string, unknown>) => expandViewContainer('task', body).map((vi) => String(vi.name));
        const shippedBy = (p: Placement, pkg: string) => ({
            object: 'task', ...p.m.body(SHIPPED_TITLE(pkg), true, pkg === COPYING ? SLUG : OTHER_SLUG),
        });
        /** What each package ships in the placement: the object's other owner its own member, the copying package the container it copies. */
        const shippedIn = (p: Placement): Array<[string, Record<string, unknown>]> => [
            ...(p.owner === OTHER ? [[OTHER, shippedBy(p, OTHER)] as [string, Record<string, unknown>]] : []),
            ...(p.ships ? [[COPYING, shippedBy(p, COPYING)] as [string, Record<string, unknown>]] : []),
        ];
        /**
         * The name the copy's member is served under: the name the loaders
         * gave the copying package where it ships the container, the own-name
         * arm on another package's object otherwise, and `<object>.<key>`
         * on an object of its own or of none.
         */
        const servedName = (p: Placement) => (p.owner === OTHER && !p.ships
            ? p.m.ownNameAs
            : loaderNames(p.m.body(COPY_TITLE, true, SLUG))[0]);
        const label = (p: Placement) => `${p.ownership}, ${p.shipping}, ${p.m.member}`;

        async function saveCopyOf(protocol: any, p: Placement, allowAnonymous: boolean) {
            expect((await protocol.saveMetaItem({
                type: 'view', name: 'task', packageId: COPYING,
                item: { name: 'task', object: 'task', ...p.m.body(COPY_TITLE, allowAnonymous, SLUG) },
            })).success).toBe(true);
        }
        /** An organization overlay of the form under `name`, open, as a rollback restores it. */
        async function restoreOpenOverlayAt(protocol: any, name: string) {
            await protocol.ensureOverlayIndex();
            await protocol.getOverlayRepo('org_a').put(
                { type: 'view', name, org: 'org_a' },
                { name, label: 'Intake (org)', object: 'task', viewKind: 'form', config: form(true, 'Intake (org)', SLUG) },
                { parentVersion: null, actor: null, source: 'test.restored', intent: 'runtime-only', state: 'active', packageId: null },
            );
        }
        const titleOf = (v: any): unknown => v?.config?.title ?? v?.config?.label;
        /** The titles a package's slot of `name` serves in the env-wide list. */
        async function slotTitles(protocol: any, name: string, pkg: string): Promise<unknown[]> {
            const envWide: any = await protocol.getMetaItems({ type: 'view' });
            return (envWide.items as any[]).filter((v) => v?.name === name && v._packageId === pkg).map(titleOf);
        }
        /** Every item through which the env-wide list serves the copy's body for the copying package. */
        async function itemsOfTheCopy(protocol: any): Promise<any[]> {
            const envWide: any = await protocol.getMetaItems({ type: 'view' });
            return (envWide.items as any[]).filter((v) => v?._packageId === COPYING && titleOf(v) === COPY_TITLE);
        }
        async function byNameTitle(protocol: any, name: string, pkg: string): Promise<unknown> {
            return titleOf((await protocol.getMetaItem({ type: 'view', name, packageId: pkg })).item);
        }

        it('the population is the cross product of the three dimensions, each placement once', () => {
            expect(PLACEMENTS).toHaveLength(OWNERS.length * SHIPPING.length * MEMBERS.length);
            expect(new Set(PLACEMENTS.map(label)).size).toBe(PLACEMENTS.length);
            // The three members, as the loaders place them: the bare list, a keyed member, the default form.
            expect(MEMBERS.map((m) => expandViewContainer('task', m.body('x', true, SLUG))
                .map((vi) => [vi.name, vi.viewKind, vi.isDefault === true])))
                .toEqual([[['task.default', 'list', true]], [['task.intake_form', 'form', false]], [['task.form', 'form', true]]]);
        });

        for (const [kernel, environmentId] of KERNELS) {
            for (const p of PLACEMENTS) {
                it(`${kernel}; ${label(p)}: served as ${servedName(p)} in the copying package's slot on both read doors, writing no other package's name`, async () => {
                    const { protocol } = harness(shippedIn(p), environmentId, p.owner);
                    await saveCopyOf(protocol, p, false);
                    const name = servedName(p);

                    const copyItems = await itemsOfTheCopy(protocol);
                    expect(copyItems.map((v) => v.name), 'the names the copy is served under').toEqual([name]);
                    // The seat's answer on the own-name arm stands for every container on
                    // another package's object, a copy included: it declares no default.
                    const declaresDefault = expandViewContainer('task', p.m.body(COPY_TITLE, false, SLUG))[0]?.isDefault === true;
                    expect(copyItems.map((v) => v.isDefault === true), 'the default it declares')
                        .toEqual([p.owner !== OTHER && declaresDefault]);
                    expect(await slotTitles(protocol, name, COPYING), 'the copying package\'s slot').toEqual([COPY_TITLE]);
                    expect(await byNameTitle(protocol, name, COPYING), 'the by-name read naming the copying package').toBe(COPY_TITLE);

                    const otherNames = p.owner === OTHER ? loaderNames(shippedBy(p, OTHER)) : [];
                    const ownNames = p.ships ? loaderNames(shippedBy(p, COPYING)) : [];
                    expect(otherNames.includes(name) && !ownNames.includes(name), 'a name only another package ships').toBe(false);
                    for (const shipped of otherNames) {
                        expect(await slotTitles(protocol, shipped, OTHER), `${OTHER}'s slot of ${shipped}`).toEqual([SHIPPED_TITLE(OTHER)]);
                        expect(await byNameTitle(protocol, shipped, OTHER), `the by-name read of ${shipped} naming ${OTHER}`)
                            .toBe(SHIPPED_TITLE(OTHER));
                    }
                });

                if (p.m.isForm) {
                    it(`${kernel}; ${label(p)}: the withdrawal saved in the copy closes the anonymous doors, and saved open the doors serve`, async () => {
                        for (const allowAnonymous of [false, true]) {
                            const { protocol } = harness(shippedIn(p), environmentId, p.owner);
                            await restoreOpenOverlayAt(protocol, servedName(p));
                            await saveCopyOf(protocol, p, allowAnonymous);
                            const served = await doorsServe(protocol);
                            if (allowAnonymous) expect(served.length, 'saved open: the doors serve the overlay').toBeGreaterThan(0);
                            else expect(served, 'withdrawn in the copy: the doors serve no copy of the overlay').toEqual([]);
                        }
                    });
                }
            }
        }

        // Two packages ship the container on an object no code package owns,
        // and only one of them stores a copy. On an unscoped kernel the copy's
        // expansion used to be registered under the bare name, which the
        // registry answers ahead of either package's own entry, so the by-name
        // read naming the OTHER package served the copy while the list served
        // that package's own item. Each package's by-name read answers its own
        // item, on both kernels, whichever package stores the copy.
        describe('(g) two packages ship the container and one stores a copy: the by-name read naming each package answers its own item', () => {
            const PACKAGES = [OTHER, COPYING] as const;
            for (const [kernel, environmentId] of KERNELS) {
                for (const m of MEMBERS) {
                    for (const copying of PACKAGES) {
                        it(`${kernel}; ${m.member}; ${copying} stores the copy`, async () => {
                            const copyTitle = `Intake (${copying} copy)`;
                            const shipped = PACKAGES.map((pkg): [string, Record<string, unknown>] =>
                                [pkg, { object: 'task', ...m.body(SHIPPED_TITLE(pkg), true, SLUG) }]);
                            const { protocol } = harness(shipped, environmentId);
                            expect((await protocol.saveMetaItem({
                                type: 'view', name: 'task', packageId: copying,
                                item: { name: 'task', object: 'task', ...m.body(copyTitle, false, SLUG) },
                            })).success).toBe(true);
                            const [name] = loaderNames(m.body('x', true, SLUG));
                            for (const pkg of PACKAGES) {
                                const own = pkg === copying ? copyTitle : SHIPPED_TITLE(pkg);
                                expect(await byNameTitle(protocol, name, pkg), `the by-name read of ${name} naming ${pkg}`).toBe(own);
                                expect(await slotTitles(protocol, name, pkg), `${pkg}'s slot of ${name}`).toEqual([own]);
                            }
                        });
                    }
                }
            }
        });

        // The condition on the hydration line above: the by-name read that
        // names NO package is the generic reader of a hydrated bare entry. For
        // a name two packages ship, after one of them stores a copy, it answers
        // on both kernels, never an absence; both kernels answer the same body;
        // and that body is one the env-wide list serves under the name. Which
        // package's body it is stays ADR-0048's ambiguous case (two packages
        // ship one name): it is the copy's, the last expansion of the name, as
        // the read naming no package selects (servedViewExpansion).
        describe('(h) a name two packages ship: the by-name read naming no package answers on both kernels, with the same body', () => {
            const ORDERS = [[OTHER, COPYING], [COPYING, OTHER]] as const;
            for (const m of MEMBERS) {
                for (const owner of [OTHER, undefined] as const) {
                    for (const order of ORDERS) {
                        const ownership = owner ? 'another package owns the object' : 'no code package owns the object';
                        it(`${m.member}; ${ownership}; ${order[0]} registered first`, async () => {
                            const [name] = loaderNames(m.body('x', true, SLUG));
                            const answers: unknown[] = [];
                            for (const [kernel, environmentId] of KERNELS) {
                                const shipped = order.map((pkg): [string, Record<string, unknown>] =>
                                    [pkg, { object: 'task', ...m.body(SHIPPED_TITLE(pkg), true, pkg === COPYING ? SLUG : OTHER_SLUG) }]);
                                const { protocol } = harness(shipped, environmentId, owner);
                                const placement = PLACEMENTS.find((q) => q.m === m && q.owner === owner && q.ships);
                                if (!placement) throw new Error(`no placement for ${ownership}, ${m.member}`);
                                await saveCopyOf(protocol, placement, false);
                                const item = (await protocol.getMetaItem({ type: 'view', name })).item;
                                expect(item, `${kernel}: the read naming no package answers ${name}`).toBeTruthy();
                                const envWide: any = await protocol.getMetaItems({ type: 'view' });
                                const listed = (envWide.items as any[]).filter((v) => v?.name === name).map(titleOf);
                                expect(listed, `${kernel}: a body the env-wide list serves under ${name}`).toContain(titleOf(item));
                                answers.push(titleOf(item));
                            }
                            expect(answers[1], 'the unscoped kernel answers what the environment-scoped kernel answers').toBe(answers[0]);
                        });
                    }
                }
            }
        });
    });
});
