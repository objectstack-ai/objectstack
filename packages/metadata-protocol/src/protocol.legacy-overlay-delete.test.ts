// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6960 — a legacy env overlay on an ARTIFACT-BACKED item of a ROLLED-BACK
 * overlayable type is removable through the ordinary delete path.
 *
 * ## The defect
 *
 * #6483 / PR #6608 flipped six types to `allowOrgOverride: false`. That closed
 * the WRITE door and deliberately left the READ path alone: `supportsOverlay`
 * stayed `true`, so an overlay row authored BEFORE the rollback still merges
 * overlay-wins and still shapes the effective body. Removing it was refused at
 * two places, on two different topologies:
 *
 *  1. `deleteMetaItem`'s `environmentId !== undefined` branch — `artifactBacked
 *     && !overlayAllowed` threw `NOT_OVERRIDABLE` / 403 BEFORE any probe for
 *     the row;
 *  2. `SysMetadataRepository`'s delete gate, which is TOPOLOGY-INDEPENDENT —
 *     a control-plane kernel (`environmentId === undefined`) skips (1) entirely
 *     and is refused here instead, reached exactly when a row DOES exist
 *     because the "no overlay found" probe returns a no-op success earlier.
 *
 * Net: the ordinary "Reset to package default" answered 403 with the item
 * still customized, and `OS_METADATA_WRITABLE` was the only documented door.
 *
 * ## The ruling this file pins
 *
 * Maintainer, 2026-08-10 (#6960): **the delete side moves.** Removing an
 * overlay restores the code-declared state — the narrowing direction, which
 * cannot widen anything — so refusing it serves no security purpose while
 * trapping repair behind the operator hatch. **Create and update on such items
 * stay refused exactly as today**, and the delete-only asymmetry is recorded
 * in the gate's doc comment so it is not later "fixed" into symmetry.
 *
 * ## The tier boundary, which is the whole safety argument
 *
 * Two tiers reach the same two refusal points and only ONE moves. The
 * separator is `supportsOverlay`, NOT `allowOrgOverride`:
 *
 *  - `supportsOverlay: true` + `allowOrgOverride: false` → the ROLLED-BACK
 *    OVERLAYABLE tier. Delete is now allowed. Cases below.
 *  - `supportsOverlay: false` → `object` above all, whose overlay registers as
 *    its own contributor LAYER (ADR-0029 D9) rather than merging, and whose
 *    reset refusal is D9.6's declared, maintainer-approved cost. Unmoved, and
 *    pinned by `packages/objectql/src/protocol-object-overlay-layer.test.ts`
 *    on both topologies; re-pinned here from the other side of the boundary.
 *
 * ## Reverse verification — the four categories, declared BEFORE running
 *
 * Base for every direction below: `f16e54e1d` (`origin/main` at authoring —
 * the commit that landed ADR-0029 D9 and its pins), never a moving `main`.
 *
 *  1. PREDICTED RED, MEASURED RED — every case in
 *     `describe('the rolled-back overlayable tier — DELETE moves')`. With the
 *     two gates restored these fail with `NOT_OVERRIDABLE` / 403 (env kernel)
 *     and with the repository's `[NOT_OVERRIDABLE] '<type>' is not
 *     allowOrgOverride in the registry` (control-plane kernel).
 *  2. GREEN IN BOTH DIRECTIONS — GUARDS, NOT EVIDENCE. Explicitly labelled
 *     `[GUARD]` in their names: the `object`-tier refusals, the create/update
 *     refusals, and the `flow` (`supportsOverlay: false`) delete refusal.
 *     They pass before and after the change; what makes them load-bearing is
 *     the VARIANT experiment, not this run — see the PR body, where relaxing
 *     the predicate for every artifact-backed type (dropping the
 *     `supportsOverlay` condition) is measured turning the `object` pins red.
 *  3. MISSED PREDICTIONS — one, kept in the file rather than tidied away:
 *     `a delete with NO overlay row answers the no-op success instead of 403`
 *     was written as a guard and measured RED on the project kernel. The
 *     refusal ran before the probe, so an artifact-backed item with NOTHING
 *     customized was refused too. Its comment carries the correction.
 *     Predicted 56 red, measured 57.
 *  4. UNMEASURED — none. Every assertion here was run in both directions; the
 *     ones that cannot go red on this change say so in their own name, and
 *     what makes THOSE load-bearing is the variant experiment in the PR body.
 *
 * Harness: the real write path over a stub engine (same shape as
 * `protocol.code-only-types.test.ts`) — a gate INSIDE `deleteMetaItem` and one
 * inside `SysMetadataRepository` cannot be tested against a harness that mocks
 * either.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`, which depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

/**
 * THE TIER THAT MOVES, derived from the registry and never listed by hand
 * (Prime Directive #8): the loader merges an overlay at read time
 * (`supportsOverlay: true`) while the per-org write door is shut
 * (`allowOrgOverride: false`). A registry entry flipping either flag enrols or
 * releases a type here with nothing to keep in sync.
 */
const ROLLED_BACK_OVERLAYABLE_TYPES: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.supportsOverlay && !e.allowOrgOverride)
    .map((e) => e.type)
    .sort();

/**
 * THE TIER THAT DOES NOT MOVE: no overlay merge at read time, and no per-org
 * write door either. `object` is the specimen ADR-0029 D9 pins; `flow`,
 * `action` and `hook` are the same shape and are probed as boundary cases.
 */
const OVERLAY_INCAPABLE_TYPES: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.supportsOverlay && !e.allowOrgOverride)
    .map((e) => e.type)
    .sort();

/**
 * …minus the CODE-ONLY ones (`allowRuntimeCreate: false` — `job`, `agent`,
 * `api`, `capability`). Those never reach either gate on a control-plane
 * kernel: `useRepoPath` is false for them, so `deleteMetaItem` serves them
 * from the LEGACY raw-engine path, which #5264 left ungated ON PURPOSE
 * ("removing a code-only row that predates the refusal is the repair action
 * the guarantee depends on"). Measured here, not assumed: including them in
 * the boundary sweep below turned it red on the control-plane leg with a
 * SUCCESSFUL delete, which is pre-existing, documented, and outside this
 * card. `protocol.code-only-types.test.ts` owns that tier.
 */
const OVERLAY_INCAPABLE_RUNTIME_CREATABLE_TYPES: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.supportsOverlay && !e.allowOrgOverride && e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort();

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
}

const OVERLAY_BODY = { label: 'Customized by the tenant, before the rollback' };
const OVERLAY_CHECKSUM = 'sha256_legacy_overlay';

const seedRow = (type: string, name: string): Row => ({
    id: `row_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ name, ...OVERLAY_BODY }),
    checksum: OVERLAY_CHECKSUM,
});

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * One kernel. `artifacts` is what a code package ships (what makes
 * `isArtifactBacked` true); `seed` is the legacy overlay row a previous
 * process persisted — the row this whole card is about.
 */
function makeSession(opts: {
    environmentId?: string;
    artifacts?: Array<{ type: string; name: string }>;
    seed?: Row[];
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const historyRows: Array<Record<string, unknown>> = [];
    const artifactKeys = new Set((opts.artifacts ?? []).map((a) => `${a.type}|${a.name}`));

    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            for (const row of rows.values()) if (matchesWhere(row as any, o.where)) return row;
            return null;
        },
        async find(table: string) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values());
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                historyRows.push({ ...data });
                return { id: String(data.id ?? `h_${historyRows.length}`) };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { id: `r_${rows.size + 1}`, ...(data as any) } as Row;
            rows.set(row.id, row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            void table;
            return { id: null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract, so this
            // double cannot accept a call `ObjectQL.delete` refuses.
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const id = (o as any)?.where?.id;
            const existed = rows.delete(id);
            return { deleted: existed ? 1 : 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            // `isArtifactBacked` prefers this lookup — a hit means the name is
            // shipped by a code package (`_packageId` provenance).
            getArtifactItem: (type: string, name: string) =>
                artifactKeys.has(`${type}|${name}`) ? { name, _packageId: 'showcase' } : undefined,
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        opts.environmentId,
    ) as any;
    return { protocol, rows, historyRows };
}

/**
 * The two kernel shapes. The card's whole second half is that the repository
 * gate is topology-INDEPENDENT, so a fix pinned on only one of these is half a
 * fix — every case below runs on both.
 */
const KERNELS: Array<{ label: string; environmentId?: string }> = [
    { label: 'control-plane kernel (no environmentId)' },
    { label: 'project kernel (environmentId set)', environmentId: 'env_test' },
];

const resetEnvHatch = () => {
    delete process.env.OS_METADATA_WRITABLE;
    // Two memoised readers of the same env var — the protocol's gate and the
    // repository's `assertAllowed`. Both must be reset or the second answers
    // from a stale parse.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
};

describe('#6960 — the registry is the tier boundary, and it is DATA', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    /**
     * Auto-enrolment, the reason both sets are derived. If a registry entry
     * flips `supportsOverlay` or `allowOrgOverride`, this assertion turns red
     * on the spec edit ALONE — before a line of this file is touched — which
     * is what stops the two tiers from silently merging.
     */
    it('names the rolled-back overlayable tier exactly as the registry declares it', () => {
        expect([...ROLLED_BACK_OVERLAYABLE_TYPES]).toEqual([
            'app', 'book', 'dataset', 'page', 'permission', 'position', 'skill', 'tool',
        ]);
        // The six #6483 / PR #6608 named, all present.
        for (const t of ['permission', 'position', 'page', 'app', 'dataset', 'book']) {
            expect(ROLLED_BACK_OVERLAYABLE_TYPES).toContain(t);
        }
    });

    it('[GUARD] keeps `object` out of that tier — green in BOTH directions', () => {
        // Green before and after this change: `object` declares
        // `supportsOverlay: false` and always did. It is here as the
        // structural statement of the boundary D9 pins, not as evidence for
        // this change — see the file header, category 2.
        expect(ROLLED_BACK_OVERLAYABLE_TYPES).not.toContain('object');
        expect(OVERLAY_INCAPABLE_TYPES).toContain('object');
        expect(OVERLAY_INCAPABLE_TYPES).toContain('flow');
    });
});

describe('#6960 — the rolled-back overlayable tier: DELETE moves', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    for (const { label, environmentId } of KERNELS) {
        describe(label, () => {
            for (const type of ROLLED_BACK_OVERLAYABLE_TYPES) {
                const name = `legacy_${type}_overlay`;

                it(`removes a legacy env overlay on an artifact-backed ${type} without the operator hatch`, async () => {
                    const { protocol, rows } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });

                    const res = await protocol.deleteMetaItem({ type, name });

                    expect(res.success).toBe(true);
                    expect(res.reset).toBe(true);
                    // The row is really gone — a receipt that says "reset"
                    // over a surviving row is the defect wearing a success.
                    expect(Array.from(rows.values()).filter((r) => r.name === name)).toEqual([]);
                });

                it(`removes it through the PLURAL spelling too (${type})`, async () => {
                    // REST-conventional URLs reach the same gate; the plural
                    // is folded before every predicate consult (#4432).
                    const { protocol, rows } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });
                    const plural = `${type}s`;

                    const res = await protocol.deleteMetaItem({ type: plural, name });

                    expect(res.success).toBe(true);
                    expect(Array.from(rows.values()).filter((r) => r.name === name)).toEqual([]);
                });

                it(`writes the delete tombstone for ${type}, so the removal is auditable`, async () => {
                    // A relaxation that skipped the repository path would still
                    // answer `success: true` while leaving no history row. The
                    // tombstone is how "it went through the ordinary delete
                    // path" is measured rather than asserted.
                    const { protocol, historyRows } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });

                    await protocol.deleteMetaItem({ type, name });

                    const tombstones = historyRows.filter(
                        (h) => h.type === type && h.name === name && h.operation_type === 'delete',
                    );
                    expect(tombstones).toHaveLength(1);
                    expect(tombstones[0]!.metadata).toBeNull();
                    expect(tombstones[0]!.previous_checksum).toBe(OVERLAY_CHECKSUM);
                });
            }

            it('a delete with NO overlay row answers the no-op success instead of 403', async () => {
                // ⚠️ NOT a guard, and the label it first carried was wrong.
                // PREDICTED green-in-both / MEASURED red on the project kernel:
                // the refusal ran BEFORE the probe for the row (the issue's own
                // words), so an artifact-backed `page` with NOTHING customized
                // answered 403 rather than "already at artifact default". On
                // the control-plane kernel it was already green — the probe
                // returns first and `repo.delete` is never reached. Reported as
                // a missed prediction rather than relabelled into a pass.
                const { protocol } = makeSession({
                    ...(environmentId ? { environmentId } : {}),
                    artifacts: [{ type: 'page', name: 'untouched_page' }],
                });

                const res = await protocol.deleteMetaItem({ type: 'page', name: 'untouched_page' });

                expect(res.success).toBe(true);
                expect(res.reset).toBe(false);
                expect(res.message).toContain('already at artifact default');
            });
        });
    }
});

describe('#6960 — the boundary holds: the `object` tier does NOT move', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    /**
     * ⚠️ WHY THE TWO TOPOLOGIES ASSERT DIFFERENT FIELDS, measured not assumed.
     *
     * On a PROJECT kernel the refusal is thrown by `deleteMetaItem`'s own
     * two-tier block and reaches the caller intact — `code` AND `status`.
     *
     * On a CONTROL-PLANE kernel that block is skipped and the refusal comes
     * from `SysMetadataRepository`, whose error `deleteMetaItem` re-wraps in
     * its `catch`: `new Error('Failed to delete customization overlay: …')`.
     *
     * ⚠️ **UPDATED BY #7426 — this used to be a topology-dependent
     * assertion.** The re-wrap carried `status` forward (`err?.status ?? 500` →
     * 403) but NOT `code`, so the control-plane leg could only reach the code
     * as a substring of the prose and this helper branched on the topology to
     * say so. #7426 carries the code forward too — gated on the declared
     * ADR-0112 vocabulary — so the same refusal now answers the same envelope
     * on both kernels, and the branch is gone: **every leg asserts `code` AND
     * `status`**, which is the minimum a refusal case owes.
     *
     * The message check survives as an ADDITIONAL assertion rather than a
     * substitute one: the prose is what an operator reads, and #7426 adds a
     * field to the envelope without restating the sentence.
     *
     * ⚠️ …and it is deliberately CASE-INSENSITIVE, which is a measurement, not
     * a convenience. Promoting the old control-plane-only substring check to
     * every leg turned the project-kernel legs red: the two producers spell the
     * marker inside their *prose* differently — `deleteMetaItem`'s own block
     * writes `[not_overridable]`, `SysMetadataRepository` writes
     * `[NOT_OVERRIDABLE]`. Only the `code` FIELD is uniform, which is exactly
     * ADR-0112's point (the catalog governs `error.code`; message prose is a
     * different surface) and exactly why the field is the assertion that
     * belongs here. Recorded rather than papered over — the prose divergence is
     * pre-existing and outside #7426's scope.
     */
    const expectRefused = (err: any, environmentId: string | undefined, ctx: string) => {
        void environmentId;
        expect(err, `${ctx}: the delete was accepted`).toBeInstanceOf(Error);
        expect(err.status, ctx).toBe(403);
        expect(err.code, ctx).toBe('NOT_OVERRIDABLE');
        expect(String(err.message).toUpperCase(), ctx).toContain('NOT_OVERRIDABLE');
    };

    for (const { label, environmentId } of KERNELS) {
        describe(label, () => {
            /**
             * [GUARD — green in BOTH directions] ADR-0029 D9.6's declared cost,
             * re-pinned from the far side of the boundary. It cannot go red on
             * THIS change (the carve-out never reaches `supportsOverlay: false`),
             * and that is exactly the point: it goes red on the OVER-BROAD
             * variant of this change, which is the damage case. Measured in the
             * PR body.
             *
             * Never a bare `toThrow()`: the unfixed path already throws, so a
             * throw-only assertion would be permanently green here and could not
             * tell "refused with the wrong envelope" from "refused correctly"
             * (#7321's measured hole).
             */
            it('[GUARD] deleteMetaItem still refuses an artifact-backed `object`', async () => {
                const { protocol, rows } = makeSession({
                    ...(environmentId ? { environmentId } : {}),
                    artifacts: [{ type: 'object', name: 'myapp_invoice' }],
                    seed: [seedRow('object', 'myapp_invoice')],
                });

                const err = await protocol
                    .deleteMetaItem({ type: 'object', name: 'myapp_invoice' })
                    .then(() => null, (e: any) => e);

                expectRefused(err, environmentId, 'object');
                // A refusal that already deleted the row is a log line.
                expect(rows.size).toBe(1);
            });

            it('[GUARD] …and every other `supportsOverlay: false` type with a runtime write channel', async () => {
                // `flow` / `action` / `hook` / `field` / `seed` / `mapping` /
                // `external_catalog` / `object` — the same shape as `object` on
                // the flag that decides the tier. Data-driven, so a newly
                // flagged type is covered the day it is flagged.
                expect(OVERLAY_INCAPABLE_RUNTIME_CREATABLE_TYPES.length).toBeGreaterThan(0);
                for (const type of OVERLAY_INCAPABLE_RUNTIME_CREATABLE_TYPES) {
                    const name = `boundary_${type}`;
                    const { protocol, rows } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });

                    const err = await protocol
                        .deleteMetaItem({ type, name })
                        .then(() => null, (e: any) => e);

                    expectRefused(err, environmentId, type);
                    expect(rows.size, type).toBe(1);
                }
            });

            it('the operator hatch still opens the `object` tier — the ONE door is unchanged', async () => {
                process.env.OS_METADATA_WRITABLE = 'object';
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();

                const { protocol, rows } = makeSession({
                    ...(environmentId ? { environmentId } : {}),
                    artifacts: [{ type: 'object', name: 'myapp_invoice' }],
                    seed: [seedRow('object', 'myapp_invoice')],
                });

                const res = await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

                expect(res.success).toBe(true);
                expect(rows.size).toBe(0);
            });
        });
    }
});

describe('#6960 — DELETE-ONLY: create and update on the same item stay refused', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    /**
     * PROJECT KERNEL ONLY, and the reason is measured. On a control-plane
     * kernel `saveMetaItem` has no artifact-backed gate of its own — the
     * refusal comes from `SysMetadataRepository.put`, and the SPEC SCHEMA runs
     * first, so a minimal probe body is refused with `INVALID_METADATA` before
     * authorization is ever consulted (observed for `book` / `dataset` /
     * `permission` / `skill` / `tool`; `page` and `app` happened to validate).
     * A validation refusal is not the refusal this guard is about. The
     * control-plane half of the same statement is carried, per type and with
     * the full `code`+`status` envelope, by the repository suite below — where
     * `put` is called directly and no schema stands in front of it.
     */
    for (const { label, environmentId } of KERNELS.filter((k) => k.environmentId !== undefined)) {
        describe(label, () => {
            for (const type of ROLLED_BACK_OVERLAYABLE_TYPES) {
                const name = `legacy_${type}_overlay`;

                /**
                 * [GUARD — green in BOTH directions] The asymmetry IS the
                 * ruling. These assertions cannot go red on this change
                 * (`saveMetaItem`'s gate is untouched); they exist so a later
                 * "restore symmetry" edit — the failure mode the ruling names
                 * explicitly — turns red here instead of shipping.
                 *
                 * The project-kernel leg is the artifact-backed refusal inside
                 * `saveMetaItem`; the control-plane leg is refused by
                 * `SysMetadataRepository.assertAllowed`, which `put` still
                 * calls directly. Both assert `code` AND `status`.
                 */
                it(`[GUARD] overwriting the artifact-backed ${type} overlay is still refused`, async () => {
                    const { protocol } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });

                    const err = await protocol
                        .saveMetaItem({ type, name, item: { name, label: 'Re-customized' } })
                        .then(() => null, (e: any) => e);

                    expect(err, `${type} overlay write was accepted`).toBeInstanceOf(Error);
                    expect(err.code).toBe('NOT_OVERRIDABLE');
                    expect(err.status).toBe(403);
                });

                it(`[GUARD] an ORG-scoped write of ${type} is still refused (#6190)`, async () => {
                    const { protocol } = makeSession({
                        ...(environmentId ? { environmentId } : {}),
                        artifacts: [{ type, name }],
                        seed: [seedRow(type, name)],
                    });

                    const err = await protocol
                        .saveMetaItem({
                            type,
                            name,
                            item: { name, label: 'Per-org' },
                            organizationId: 'org_alpha',
                        })
                        .then(() => null, (e: any) => e);

                    expect(err, `${type} org-scoped write was accepted`).toBeInstanceOf(Error);
                    expect(err.code).toBe('NOT_OVERRIDABLE');
                    expect(err.status).toBe(403);
                });
            }
        });
    }
});

/**
 * THE SECOND REFUSAL POINT, ON ITS OWN TERMS.
 *
 * `SysMetadataRepository`'s gate is what makes this card's fix two-sided: it is
 * TOPOLOGY-INDEPENDENT, so a control-plane kernel — which skips
 * `deleteMetaItem`'s two-tier block entirely — is refused here and nowhere
 * else. Exercised directly, without the protocol in front of it, for three
 * reasons the suites above cannot cover:
 *
 *  1. no `catch` re-wrap, so the refusal's FULL envelope (`code` AND `status`)
 *     is observable — including on the boundary cases;
 *  2. no spec schema in front of `put`, so the create/update guard can be
 *     data-driven over every type instead of over the ones whose minimal probe
 *     body happens to validate;
 *  3. it isolates the exact divergence this card introduces —
 *     `assertDeleteAllowed` (delete) vs `assertAllowed` (put) — on one object.
 */
describe('#6960 — SysMetadataRepository: the delete verb diverges, the put verb does not', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    function makeRepo(seed: Row[] = []) {
        const rows = new Map<string, Row>();
        for (const r of seed) rows.set(r.id, r);
        const historyRows: Array<Record<string, unknown>> = [];
        const engine: any = {
            async findOne(table: string, o: { where: Record<string, unknown> }) {
                if (table === 'sys_metadata_history') {
                    return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
                }
                if (table !== 'sys_metadata') return null;
                for (const row of rows.values()) if (matchesWhere(row as any, o.where)) return row;
                return null;
            },
            async find(table: string) {
                if (table === 'sys_metadata_history') return historyRows;
                return Array.from(rows.values());
            },
            async insert(table: string, data: Record<string, unknown>) {
                if (table === 'sys_metadata_history') {
                    historyRows.push({ ...data });
                    return { id: String(data.id ?? `h_${historyRows.length}`) };
                }
                const row = { id: `r_${rows.size + 1}`, ...(data as any) } as Row;
                rows.set(row.id, row);
                return { id: row.id };
            },
            async update(_t: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, o);
                return { id: null };
            },
            async delete(_t: string, o?: Record<string, unknown>) {
                // [#4550] The producer's own delete-verb dispatch contract.
                assertEngineDeleteDispatch(o);
                const existed = rows.delete((o as any)?.where?.id);
                return { deleted: existed ? 1 : 0 };
            },
        };
        return { repo: new SysMetadataRepository({ engine, organizationId: null }), rows, historyRows };
    }

    describe('rolled-back overlayable tier', () => {
        for (const type of ROLLED_BACK_OVERLAYABLE_TYPES) {
            const name = `legacy_${type}_overlay`;

            it(`allows an override-artifact DELETE of ${type}`, async () => {
                const { repo, rows } = makeRepo([seedRow(type, name)]);

                await repo.delete(
                    { org: 'env', type, name } as any,
                    { parentVersion: OVERLAY_CHECKSUM, actor: null, intent: 'override-artifact' },
                );

                expect(rows.size).toBe(0);
            });

            it(`[GUARD] still refuses an override-artifact PUT of ${type} — code AND status`, async () => {
                const { repo, rows } = makeRepo([seedRow(type, name)]);

                const err = await repo
                    .put(
                        { org: 'env', type, name } as any,
                        { name, label: 'Re-customized' },
                        { parentVersion: OVERLAY_CHECKSUM, actor: null, intent: 'override-artifact' },
                    )
                    .then(() => null, (e: any) => e);

                expect(err, `${type} put was accepted`).toBeInstanceOf(Error);
                expect(err.code, type).toBe('NOT_OVERRIDABLE');
                expect(err.status, type).toBe(403);
                // The refusal costs the legacy row nothing.
                expect(rows.size, type).toBe(1);
            });
        }
    });

    describe('the tier that does not move', () => {
        for (const type of OVERLAY_INCAPABLE_RUNTIME_CREATABLE_TYPES) {
            const name = `boundary_${type}`;

            /**
             * [GUARD — green in BOTH directions, and the damage case's tripwire]
             * This is where the over-broad variant of this fix goes red: drop
             * the `supportsOverlay` condition from `assertDeleteAllowed` and
             * every one of these — `object` among them — starts succeeding.
             * `code` AND `status`, never a bare `toThrow()`.
             */
            it(`[GUARD] refuses an override-artifact DELETE of ${type} — code AND status`, async () => {
                const { repo, rows } = makeRepo([seedRow(type, name)]);

                const err = await repo
                    .delete(
                        { org: 'env', type, name } as any,
                        { parentVersion: OVERLAY_CHECKSUM, actor: null, intent: 'override-artifact' },
                    )
                    .then(() => null, (e: any) => e);

                expect(err, `${type} delete was accepted`).toBeInstanceOf(Error);
                expect(err.code, type).toBe('NOT_OVERRIDABLE');
                expect(err.status, type).toBe(403);
                expect(rows.size, type).toBe(1);
            });
        }

        it('[GUARD] a runtime-only DELETE is still judged by allowRuntimeCreate, not by this carve-out', async () => {
            // The carve-out is scoped to `override-artifact`. `runtime-only`
            // means "nothing ships this name", which the create tier governs —
            // so a code-only type (`allowRuntimeCreate: false`) is still
            // refused with `NOT_CREATABLE`, unchanged by this card.
            const { repo } = makeRepo([seedRow('job', 'legacy_job')]);

            const err = await repo
                .delete(
                    { org: 'env', type: 'job', name: 'legacy_job' } as any,
                    { parentVersion: OVERLAY_CHECKSUM, actor: null, intent: 'runtime-only' },
                )
                .then(() => null, (e: any) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('NOT_CREATABLE');
            expect(err.status).toBe(403);
        });
    });
});
