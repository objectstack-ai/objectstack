// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14907] `getMetaItemLayered` — the THIRD `/meta` read verb — applies the
 * registry read gate ITSELF, so a caller cannot spend a raw active
 * organization on a type that has no per-org read channel.
 *
 * ── The defect, and why this verb was graded on its own harm ──────────────
 *
 * The series is #9454 → #14683 (plural `getMetaItems`) → #14770 (singular
 * `getMetaItem`) → this one. On the plural verb an ungated organization can
 * only ADD a row; on the singular verb it SUBSTITUTES the served document.
 * Here the affected value is the `overlay` LAYER of a three-layer diagnostic
 * whose entire purpose is to answer "what did this tenant customize" — so a
 * pre-#6190 phantom org-scoped row of an `allowOrgOverride: false` type is
 * reported as `overlay` + `overlayScope: 'org'` and rendered by the Studio
 * "Code default vs Overlay vs Effective" diff tab as evidence of a
 * customization that does not exist. §1 is that case.
 *
 * ⚠️ It is not merely displayed. TWO doors return that layer AS the response
 * when it is non-null — `runtime/src/domains/meta.ts` and `rest-server.ts`'s
 * `/meta/:type/:name/published` — so on those paths the phantom is SERVED.
 * §6 pins the predicate those two branches read.
 *
 * ── ⭐ §3 is the section that does not exist on either twin ───────────────
 *
 * In both twins the fix is "replace the `orgId` binding with the gated call",
 * and it is correct there because the binding already sat AFTER
 * `canonicalizeMetaRequestType`. Here the binding sat BEFORE the fold, so the
 * one-liner does NOT port: dropping the same expression in place would gate on
 * the RAW type. #10340 measured what that costs — `declaresOrgOverride`
 * tolerates the MANIFEST plurals but not the URL-only ones (`translations` /
 * `email_templates` have no manifest key), so a raw segment splits one item
 * across two partitions. The fix is therefore a REORDER, and §3 is what fails
 * if a later author moves the binding back above the fold: it asserts that a
 * URL-only spelling of an OVERRIDABLE type still reaches its org partition.
 *
 * ── §4–§5 are the idempotence proof the #14683 ruling made this conditional
 *    on, discharged over THIS door's caller population ──────────────────────
 *
 * That ruling makes a callee-side gate conditional on proving no already-gating
 * caller is double-scoped or wrongly denied, discharged PER DOOR over that
 * door's own callers. #14770's proof covers none of this verb's population, so
 * it is re-discharged here: §4 covers `f(t, undefined) === undefined` (the four
 * `plugin-security` invocations that name no organization) and §5 covers
 * `f(t, f(t, o)) === f(t, o)` over the COMPLETE accepted-spelling population
 * (the `/layers` door, which gates on the folded type and passes the raw
 * segment), including the direction that idempotence must NOT be achieved by
 * denying everyone.
 *
 * ── Why the observation channel is the WHERE multiset AND the layer ───────
 *
 * `partitions()` reads the `organization_id` partitions the engine was asked
 * for — the whole of what this change moves — so it is body-independent and
 * covers every declared type. The layer assertions pay for that by naming the
 * real `overlay` / `overlayScope` on both sides of the gate, so neither half
 * rests on a query nobody proved returns a row.
 */

import { describe, expect, it } from 'vitest';
import { declaresOrgOverride, organizationIdForMetaRead } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { META_URL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_acme';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (
    type: string,
    name: string,
    extra: Partial<StoredRow> = {},
): StoredRow => ({
    id: `r_${type}_${name}_${extra.organization_id ?? 'env'}_${extra.state ?? 'active'}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    // `label` is the observation channel for WHICH row became the layer — the
    // two rows of a pair differ only by scope, so a served label names its
    // origin.
    metadata: JSON.stringify({ name, label: `${extra.organization_id ?? 'env'} ${name}` }),
    ...extra,
});

/**
 * The engine double: `findOne` over a row table, plus the registry surface the
 * layered read touches on its way past the overlay.
 *
 * ⛔ No `find` / `insert` / `update` / `delete`, deliberately — the read path
 * under test issues exactly one verb, and a double declaring verbs no case
 * exercises would owe `check:engine-double-contract` a dispatch contract that
 * protects nothing. Same shape the two sibling read-gate pins drive.
 */
function makeHarness(rows: StoredRow[]) {
    const findOnes: Array<Record<string, unknown>> = [];
    const engine: any = {
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return undefined;
            const where = opts?.where ?? {};
            findOnes.push({ ...where });
            // `check:where-matcher` — a hand-written matcher with no combinator
            // branch reads `$and` as a field name and answers the wrong
            // question rather than failing. Refuse the shape this double does
            // not implement, matching the sibling doubles' convention.
            for (const k of Object.keys(where)) {
                if (k.startsWith('$')) {
                    throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
                }
            }
            return rows.find((r) =>
                Object.entries(where).every(([k, v]) => {
                    if (v === undefined) return true;
                    return (r as unknown as Record<string, unknown>)[k] === v;
                }),
            );
        },
        registry: {
            registerItem: () => undefined,
            registerObject: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, findOnes };
}

/** Every `organization_id` partition the engine was asked for, deduplicated. */
const partitions = (finds: Array<Record<string, unknown>>): Array<string | null> =>
    [...new Set(finds.map((f) => (f.organization_id ?? null) as string | null))].sort(
        (a, b) => String(a).localeCompare(String(b)),
    );

/** The same, folded per canonical type. */
function partitionsByType(finds: Array<Record<string, unknown>>): Map<string, Set<string | null>> {
    const out = new Map<string, Set<string | null>>();
    for (const f of finds) {
        const t = canonicalMetaUrlType(String(f.type));
        if (!out.has(t)) out.set(t, new Set());
        out.get(t)!.add((f.organization_id ?? null) as string | null);
    }
    return out;
}

/** The label the `overlay` LAYER carries — `'env …'` or `'org_acme …'`. */
const overlayLabel = (res: any): string | undefined => res?.overlay?.label;

/**
 * The COMPLETE accepted-spelling population: every URL spelling the `/meta`
 * doors fold, unioned with every registry singular. Derived, never listed —
 * a newly declared type arrives in this sweep on its own.
 */
const ALL_SPELLINGS: string[] = [
    ...new Set([
        ...Object.keys(META_URL_TO_SINGULAR),
        ...DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type),
    ]),
].sort();

/** The org-overridable canonical types, derived. */
const OVERRIDABLE: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowOrgOverride)
    .map((e) => e.type);

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the population this rests on, pinned so a registry change is visible
// ═══════════════════════════════════════════════════════════════════════════

describe('§0 the org-overridable set', () => {
    it('is exactly the ADR-0005 tier-A five', () => {
        expect([...OVERRIDABLE].sort()).toEqual(
            ['dashboard', 'email_template', 'report', 'translation', 'view'],
        );
    });

    it("`object` — the type the reachable ungated callers can carry — is NOT overridable", () => {
        expect(OVERRIDABLE).not.toContain('object');
        expect(organizationIdForMetaRead('object', ORG)).toBeUndefined();
    });

    it("`permission` — the type every `plugin-security` call site hard-codes — is NOT overridable", () => {
        // The premise of the third moving caller named in the gate's comment:
        // `permission-set-projection.ts` forwards `evt.organizationId` into
        // this verb on `type: 'permission'`. If that flag ever flips, that
        // caller stops moving and the comment must be re-derived.
        expect(OVERRIDABLE).not.toContain('permission');
        expect(organizationIdForMetaRead('permission', ORG)).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — ⭐ THE CARD'S CASE: a phantom must not become the `overlay` layer
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 a pre-#6190 phantom is not reported as a customization', () => {
    const rows = () => [
        // The live env-wide document.
        storedRow('object', 'showcase_task'),
        // The phantom: an org-scoped row of an `allowOrgOverride: false` type.
        // `loadMetaFromDb` walks past it at boot, so it is dead — it exists
        // only because the runtime used to stamp `organization_id` on every
        // type before #6190.
        storedRow('object', 'showcase_task', { organization_id: ORG }),
    ];

    it('reports the env-wide row to a caller that passes a RAW active organization', async () => {
        const { protocol, findOnes } = makeHarness(rows());
        const res = await protocol.getMetaItemLayered({
            type: 'object',
            name: 'showcase_task',
            organizationId: ORG,
        });
        expect(overlayLabel(res)).toBe('env showcase_task');
        // ⭐ The field the Studio diff tab renders as "this tenant customized
        // it". A phantom must never reach it.
        expect(res.overlayScope).toBe('env');
        // And the phantom's partition was never even read — the gate resolves
        // to `undefined`, so the `if (orgId)` arm is skipped whole.
        expect(partitions(findOnes)).toEqual([null]);
    });

    it('answers identically whether or not the caller names the organization', async () => {
        const withOrg = makeHarness(rows());
        const withoutOrg = makeHarness(rows());
        const a = await withOrg.protocol.getMetaItemLayered({
            type: 'object', name: 'showcase_task', organizationId: ORG,
        });
        const b = await withoutOrg.protocol.getMetaItemLayered({
            type: 'object', name: 'showcase_task',
        });
        expect(overlayLabel(a)).toBe(overlayLabel(b));
        expect(a.overlayScope).toBe(b.overlayScope);
        expect(partitions(withOrg.findOnes)).toEqual(partitions(withoutOrg.findOnes));
    });

    it('holds for every non-overridable declared type, not just `object`', async () => {
        const nonOverridable = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => !e.allowOrgOverride)
            .map((e) => e.type);
        expect(nonOverridable.length).toBeGreaterThan(5);
        for (const type of nonOverridable) {
            const { protocol, findOnes } = makeHarness([
                storedRow(type, 'probe'),
                storedRow(type, 'probe', { organization_id: ORG }),
            ]);
            const res = await protocol.getMetaItemLayered({
                type, name: 'probe', organizationId: ORG,
            });
            expect(overlayLabel(res), `${type} reported the phantom`).toBe('env probe');
            expect(res.overlayScope, `${type} claimed an org customization`).toBe('env');
            expect(partitions(findOnes), `${type} read the org partition`).toEqual([null]);
        }
    });

    it('reports NO overlay at all when the phantom is the only row', async () => {
        // The sharpest shape: nothing env-wide exists, so before this gate the
        // diagnostic answered `overlay: <phantom>, overlayScope: 'org'` — a
        // customization claim with no live document behind it at all.
        const { protocol, findOnes } = makeHarness([
            storedRow('object', 'ghost', { organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItemLayered({
            type: 'object', name: 'ghost', organizationId: ORG,
        });
        expect(res.overlay).toBeNull();
        expect(res.overlayScope).toBeNull();
        expect(partitions(findOnes)).toEqual([null]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the gate must not be achieved by denying everyone
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 an overridable type still reports its org-scoped customization', () => {
    it('prefers the org row and says `overlayScope: org`', async () => {
        const { protocol } = makeHarness([
            storedRow('view', 'task_list'),
            storedRow('view', 'task_list', { organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItemLayered({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(overlayLabel(res)).toBe(`${ORG} task_list`);
        expect(res.overlayScope).toBe('org');
    });

    it('falls back to the env-wide row when the org has no overlay of its own', async () => {
        const { protocol, findOnes } = makeHarness([storedRow('view', 'task_list')]);
        const res = await protocol.getMetaItemLayered({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(overlayLabel(res)).toBe('env task_list');
        expect(res.overlayScope).toBe('env');
        // BOTH partitions read — the org one first, the env-wide one as the
        // fallback. (`partitions` returns a SORTED set, so this asserts
        // membership, not read order.)
        expect(partitions(findOnes)).toEqual([null, ORG]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — ⭐ THE REORDER: the gate reads the FOLDED type, never the raw segment
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 the gate resolves AFTER canonicalizeMetaRequestType', () => {
    /**
     * The URL-only spellings — accepted at `/meta/:type` and folded by this
     * method's first statement, but absent from the manifest map
     * `declaresOrgOverride` tolerates. Derived from the predicate itself, so
     * this cannot go stale against a changed map: a spelling qualifies when it
     * folds to an OVERRIDABLE canonical type and yet answers `false` raw.
     */
    const URL_ONLY_OVERRIDABLE = ALL_SPELLINGS.filter(
        (s) => declaresOrgOverride(canonicalMetaUrlType(s)) && !declaresOrgOverride(s),
    );

    it('the #10340 hazard is real on this population — it is not an empty sweep', () => {
        // ⛔ Positive control. Without this the three assertions below could
        // pass over zero spellings and read as proof of nothing. The card names
        // `translations` and `email_templates`; the derivation must find them.
        expect(URL_ONLY_OVERRIDABLE.length).toBeGreaterThan(0);
        expect(URL_ONLY_OVERRIDABLE).toContain('translations');
        expect(URL_ONLY_OVERRIDABLE).toContain('email_templates');
    });

    it('a URL-only spelling of an overridable type still reaches its org partition', async () => {
        // ⭐ THE PIN THAT FAILS IF THE BINDING MOVES BACK ABOVE THE FOLD.
        // Gated raw, `organizationIdForMetaRead('translations', ORG)` is
        // `undefined` and this read never asks for the org partition — one item
        // split across two partitions, addressed by spelling. Gated folded, it
        // is `ORG` and the org row wins.
        for (const spelling of URL_ONLY_OVERRIDABLE) {
            const canonical = canonicalMetaUrlType(spelling);
            const { protocol, findOnes } = makeHarness([
                storedRow(canonical, 'greeting'),
                storedRow(canonical, 'greeting', { organization_id: ORG }),
            ]);
            const res = await protocol.getMetaItemLayered({
                type: spelling, name: 'greeting', organizationId: ORG,
            });
            expect(overlayLabel(res), spelling).toBe(`${ORG} greeting`);
            expect(res.overlayScope, spelling).toBe('org');
            expect(partitions(findOnes), spelling).toEqual([null, ORG]);
        }
    });

    it('answers the URL spelling and the canonical spelling identically', async () => {
        // The #10340 statement restated as an equality: one item, ONE
        // partition, whichever accepted spelling addresses it.
        for (const spelling of URL_ONLY_OVERRIDABLE) {
            const canonical = canonicalMetaUrlType(spelling);
            const rows = () => [
                storedRow(canonical, 'greeting'),
                storedRow(canonical, 'greeting', { organization_id: ORG }),
            ];
            const viaUrl = makeHarness(rows());
            const viaCanonical = makeHarness(rows());
            const a = await viaUrl.protocol.getMetaItemLayered({
                type: spelling, name: 'greeting', organizationId: ORG,
            });
            const b = await viaCanonical.protocol.getMetaItemLayered({
                type: canonical, name: 'greeting', organizationId: ORG,
            });
            expect(overlayLabel(a), spelling).toBe(overlayLabel(b));
            expect(a.overlayScope, spelling).toBe(b.overlayScope);
            expect(partitions(viaUrl.findOnes), spelling)
                .toEqual(partitions(viaCanonical.findOnes));
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — idempotence, leg 1: `f(t, undefined) === undefined`
// ═══════════════════════════════════════════════════════════════════════════

describe('§4 a caller that names no organization is untouched', () => {
    it('reads only the env-wide partition, for every accepted spelling', async () => {
        // The population that covers the four `plugin-security` invocations
        // naming no organization — `packaged-permission-set-lock-gate.ts`'s
        // authoring gate and three of `permission-set-projection.ts`'s reads:
        // the predicate short-circuits on `undefined` before it ever consults
        // the registry flag.
        for (const spelling of ALL_SPELLINGS) {
            const { protocol, findOnes } = makeHarness([]);
            await protocol.getMetaItemLayered({ type: spelling, name: 'probe' })
                .catch(() => undefined);
            for (const [type, parts] of partitionsByType(findOnes)) {
                expect([...parts], `${spelling} → ${type}`).toEqual([null]);
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — idempotence, leg 2: `f(t, f(t, o)) === f(t, o)` over the whole
//       accepted-spelling population
// ═══════════════════════════════════════════════════════════════════════════

describe('§5 an already-gating caller receives the same scope it did before', () => {
    it('the predicate is idempotent for every accepted spelling', () => {
        for (const spelling of ALL_SPELLINGS) {
            const once = organizationIdForMetaRead(spelling, ORG);
            expect(organizationIdForMetaRead(spelling, once), spelling).toBe(once);
        }
    });

    it('the REST `/layers` door gates on the string this method folds to', () => {
        // The door computes `organizationIdForMetaRead(canonicalMetaUrlType(
        // req.params.type), layeredCtx?.tenantId)` and then passes `type:
        // req.params.type` — the RAW segment. This method's first statement
        // folds that segment through `canonicalizeMetaRequestType`, which IS
        // `canonicalMetaUrlType`. So the gate inside reads the identical STRING
        // the door gated on, and the second application is the algebraic no-op.
        for (const spelling of ALL_SPELLINGS) {
            const doorGate = organizationIdForMetaRead(canonicalMetaUrlType(spelling), ORG);
            const innerGate = organizationIdForMetaRead(canonicalMetaUrlType(spelling), doorGate);
            expect(innerGate, spelling).toBe(doorGate);
        }
    });

    it('a gated door reading an overridable type still reaches the org partition', async () => {
        // The other direction of the no-op: a door that already resolved `ORG`
        // for `view` gets the org partition read, exactly as before.
        const gated = organizationIdForMetaRead('view', ORG);
        expect(gated).toBe(ORG);
        const { protocol, findOnes } = makeHarness([]);
        await protocol.getMetaItemLayered({
            type: 'view', name: 'probe', organizationId: gated,
        });
        expect(partitions(findOnes)).toEqual([null, ORG]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §6 — the two doors that return the `overlay` layer AS the response
// ═══════════════════════════════════════════════════════════════════════════

describe('§6 the branch both serving doors read does not fire on a phantom', () => {
    /**
     * `runtime/src/domains/meta.ts` and `rest-server.ts`'s
     * `/meta/:type/:name/published` both spell the same test:
     *
     *     if (layered?.overlay !== undefined && layered?.overlay !== null)
     *
     * and then return `layered.overlay` as the response body. Both hand this
     * method a RAW active organization on a `type` taken off the URL, so
     * neither is confined to the overridable five. This asserts the predicate
     * they read, on the input that used to make it true wrongly.
     */
    const serveBranchFires = (layered: any): boolean =>
        layered?.overlay !== undefined && layered?.overlay !== null;

    it('does not fire for a non-overridable type whose ONLY row is an org phantom', async () => {
        const { protocol } = makeHarness([
            storedRow('object', 'ghost', { organization_id: ORG }),
        ]);
        const layered = await protocol.getMetaItemLayered({
            type: 'object', name: 'ghost', organizationId: ORG,
        });
        expect(serveBranchFires(layered)).toBe(false);
    });

    it('still fires for an overridable type with a real org-scoped publish', async () => {
        // #8805's case, which the `/published` door exists to serve: a `view`
        // published into the caller's organization must still be served.
        const { protocol } = makeHarness([
            storedRow('view', 'task_list', { organization_id: ORG }),
        ]);
        const layered = await protocol.getMetaItemLayered({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(serveBranchFires(layered)).toBe(true);
        expect(overlayLabel(layered)).toBe(`${ORG} task_list`);
    });
});
