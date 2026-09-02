// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14683] `getMetaItems` applies the registry read gate ITSELF, so a sweep
 * that reads MORE THAN ONE type per request is scoped per type instead of per
 * request.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `getMetaItems` used to apply no gate at all: whatever `organizationId`
 * arrived was spent on whatever `type` arrived. The scope of a metadata sweep
 * was therefore decided per type BY THE CALLER — which a request carrying ONE
 * organization can only get right when it sweeps ONE type. Three live callers
 * sweep more:
 *
 *   • `getMetaDiagnostics` with no `type` — `targetTypes` is the whole
 *     registry, five `allowOrgOverride: true` types and every other declared
 *     type together, under one request-level organization.
 *   • `findReferencesToMeta` — `request.type` is the TARGET; the organization
 *     is spent on `matcher.fromType`, the SOURCES, so the target's own flag
 *     says nothing about the types actually read.
 *   • the runtime's package export sweep (`runtime/src/domains/packages.ts`,
 *     `assemblePackageManifest`) — every plural key of `PLURAL_TO_SINGULAR`,
 *     one raw active organization.
 *
 * ── ⭐ The harm class is RESURRECTION, not concealment ────────────────────
 *
 * Stated because the sibling card was filed against the opposite premise and a
 * fix aimed at concealment would be aiming at the wrong failure.
 * `SysMetadataRepository.history()` filters `organization_id` by strict
 * equality, so naming the tenant THERE hides an `allowOrgOverride: false`
 * type's rows. On THIS path the two `queryByOrg` reads are UNIONed, so naming
 * it can only ADD rows — and the rows it adds are the pre-#6190 phantoms:
 * org-scoped rows of types with no per-org read channel, which `loadMetaFromDb`
 * walks past and `reportUnhydratableOrgScopedRows` exists to warn about. They
 * come back inside the admin "Used by" panel and the Studio governance
 * directory — a clearance rendered before a destructive action, where a
 * resurrected row is worse than an omission because it reads as evidence.
 *
 * ── ⭐ §3 is the IDEMPOTENCE PROOF the ruling made this change conditional on
 *
 * Direction A was ruled conditional on demonstrating that moving the predicate
 * INSIDE does not CHANGE the scope any already-gating call site receives. §3
 * discharges that mechanically rather than by argument, over the COMPLETE
 * population of accepted URL spellings (`META_URL_TO_SINGULAR`, unioned with
 * every registry singular) rather than over a hand-listed sample — a new type
 * or a changed fold cannot slip past it.
 *
 * ── Why the observation channel is the WHERE multiset ─────────────────────
 *
 * §3–§5 seed NO rows and read the `organization_id` partitions the engine was
 * asked for. That is the whole of what this change moves — which partitions
 * are read — and observing it directly keeps the sweep body-independent, so
 * the pin covers every declared type instead of the handful with a
 * hand-written schema-valid body. §1/§2 pay for that by asserting real merged
 * items on both sides of the gate, so neither half rests on a query nobody
 * proved returns rows.
 */

import { describe, expect, it } from 'vitest';
import { organizationIdForMetaRead } from '@objectstack/metadata-core';
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
    metadata: JSON.stringify({ name, label: `${extra.organization_id ?? 'env'} ${name}` }),
    ...extra,
});

/**
 * The engine double: `find` over a row table, plus the registry surface the
 * overlay path touches.
 *
 * ⛔ No `findOne` / `insert` / `update` / `delete`, deliberately — the read
 * path under test issues exactly one verb, and a double declaring verbs no
 * case exercises would owe `check:engine-double-contract` a dispatch contract
 * that protects nothing. Same shape `meta-overlay-cache.test.ts` drives.
 */
function makeHarness(rows: StoredRow[]) {
    const finds: Array<Record<string, unknown>> = [];
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            finds.push({ ...where });
            // `check:where-matcher` — a hand-written matcher with no combinator
            // branch reads `$and` as a field name and answers the wrong
            // question rather than failing. Refuse the shape this double does
            // not implement, matching the sibling doubles' convention.
            for (const k of Object.keys(where)) {
                if (k.startsWith('$')) {
                    throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
                }
            }
            const matched = rows.filter((r) =>
                Object.entries(where).every(([k, v]) => {
                    if (v === undefined) return true;
                    return (r as unknown as Record<string, unknown>)[k] === v;
                }),
            );
            // `check:objectql-double-limit` (#10978) — hold the caller's bound,
            // applied AFTER the filter and BY PRESENCE.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
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
    return { protocol, finds };
}

/** Every `organization_id` partition the engine was asked for, deduplicated. */
const partitions = (finds: Array<Record<string, unknown>>): Array<string | null> =>
    [...new Set(finds.map((f) => (f.organization_id ?? null) as string | null))].sort(
        (a, b) => String(a).localeCompare(String(b)),
    );

/** The same, folded per canonical type — for the multi-type sweeps. */
function partitionsByType(finds: Array<Record<string, unknown>>): Map<string, Set<string | null>> {
    const out = new Map<string, Set<string | null>>();
    for (const f of finds) {
        const t = canonicalMetaUrlType(String(f.type));
        if (!out.has(t)) out.set(t, new Set());
        out.get(t)!.add((f.organization_id ?? null) as string | null);
    }
    return out;
}

const names = (res: any): string[] =>
    (Array.isArray(res) ? res : res.items).map((i: any) => i.name).sort();

const labels = (res: any): Record<string, string> =>
    Object.fromEntries(
        (Array.isArray(res) ? res : res.items).map((i: any) => [i.name, i.label]),
    );

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

const OVERRIDABLE = DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowOrgOverride).map((e) => e.type);

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the population this rests on, pinned so a registry change is visible
// ═══════════════════════════════════════════════════════════════════════════

describe('§0 the org-overridable set', () => {
    it('is exactly the ADR-0005 tier-A five', () => {
        expect([...OVERRIDABLE].sort()).toEqual(
            ['dashboard', 'email_template', 'report', 'translation', 'view'],
        );
    });

    it('covers every accepted spelling — the sweep below is not a sample', () => {
        expect(ALL_SPELLINGS.length).toBeGreaterThan(DEFAULT_METADATA_TYPE_REGISTRY.length);
        for (const s of ALL_SPELLINGS) expect(typeof canonicalMetaUrlType(s)).toBe('string');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the gate, in BOTH directions, on real merged items
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 a raw active organization is gated per type', () => {
    it('a NON-overridable type does not resurrect its org-scoped phantom rows', async () => {
        const h = makeHarness([
            storedRow('object', 'task'),
            storedRow('object', 'task', { organization_id: ORG }),
            storedRow('object', 'phantom_only', { organization_id: ORG }),
        ]);

        const res = await h.protocol.getMetaItems({ type: 'object', organizationId: ORG });

        // The org partition is never asked for at all — not asked and
        // discarded, which would still pay for the read and still put the row
        // one refactor away from the answer.
        expect(partitions(h.finds)).toEqual([null]);
        expect(names(res)).toEqual(['task']);
        expect(labels(res).task).toBe('env task');
    });

    it('an OVERRIDABLE type still unions both partitions, org winning on collision', async () => {
        const h = makeHarness([
            storedRow('view', 'tasks_list'),
            storedRow('view', 'tasks_list', { organization_id: ORG }),
            storedRow('view', 'org_only', { organization_id: ORG }),
        ]);

        const res = await h.protocol.getMetaItems({ type: 'view', organizationId: ORG });

        expect(partitions(h.finds)).toEqual([null, ORG]);
        expect(names(res)).toEqual(['org_only', 'tasks_list']);
        expect(labels(res).tasks_list).toBe(`${ORG} tasks_list`);
    });

    it('an org-less caller reads exactly what it read before, either way', async () => {
        const h = makeHarness([
            storedRow('view', 'tasks_list'),
            storedRow('view', 'org_only', { organization_id: ORG }),
        ]);

        const res = await h.protocol.getMetaItems({ type: 'view' });

        expect(partitions(h.finds)).toEqual([null]);
        expect(names(res)).toEqual(['tasks_list']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the `previewDrafts` arm spends the SAME resolution
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 the draft-preview arm carries the same gate', () => {
    it('does not preview an org-scoped DRAFT of a non-overridable type', async () => {
        const h = makeHarness([
            storedRow('object', 'task'),
            storedRow('object', 'task', { organization_id: ORG, state: 'draft' }),
            storedRow('object', 'draft_phantom', { organization_id: ORG, state: 'draft' }),
        ]);

        const res = await h.protocol.getMetaItems({
            type: 'object',
            organizationId: ORG,
            previewDrafts: true,
        });

        expect(partitions(h.finds)).toEqual([null]);
        expect(names(res)).toEqual(['task']);
    });

    it('still previews an org-scoped DRAFT of an overridable type', async () => {
        const h = makeHarness([
            storedRow('view', 'tasks_list'),
            storedRow('view', 'org_draft', { organization_id: ORG, state: 'draft' }),
        ]);

        const res = await h.protocol.getMetaItems({
            type: 'view',
            organizationId: ORG,
            previewDrafts: true,
        });

        expect(partitions(h.finds)).toEqual([null, ORG]);
        expect(names(res)).toContain('org_draft');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — ⭐ THE IDEMPOTENCE PROOF, over the complete spelling population
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 an already-gating call site receives unchanged read scope', () => {
    /**
     * The algebra, stated first because §3's behavioural half only measures
     * that the implementation obeys it: `organizationIdForMetaRead` answers
     * either its argument or `undefined`, so a second application over the
     * SAME type is a no-op. The load-bearing half is "the same type" — which
     * §3b measures.
     */
    it.each(ALL_SPELLINGS)('f(t, f(t, org)) === f(t, org) for spelling %s', (spelling) => {
        const t = canonicalMetaUrlType(spelling);
        const once = organizationIdForMetaRead(t, ORG);
        expect(organizationIdForMetaRead(t, once)).toBe(once);
    });

    /**
     * §3b — the type this method gates on is the type the door gated on.
     *
     * The REST `GET /meta/:type` list door computes
     * `organizationIdForMetaRead(canonicalMetaUrlType(req.params.type), …)`
     * and then passes the RAW segment as `type`. Reproduced here for every
     * accepted spelling: the partitions read must equal the partitions the
     * pre-change implementation read for that same argument — which it spent
     * verbatim, so `expected` below IS the old behaviour, written out.
     */
    it.each(ALL_SPELLINGS)('gated caller: read scope unchanged for spelling %s', async (spelling) => {
        const gated = organizationIdForMetaRead(canonicalMetaUrlType(spelling), ORG);
        const h = makeHarness([]);

        await h.protocol.getMetaItems({
            type: spelling,
            ...(gated ? { organizationId: gated } : {}),
        });

        // Pre-change semantics, verbatim: `queryByOrg(null)` always, plus
        // `queryByOrg(orgId)` iff the caller named one.
        const expected: Array<string | null> = gated ? [null, gated] : [null];
        expect(partitions(h.finds)).toEqual(expected.sort((a, b) => String(a).localeCompare(String(b))));
    });

    /**
     * §3c — the complement: an UNGATED caller IS narrowed, which is the
     * repair. Without this the suite would pass on an implementation that
     * changed nothing at all.
     */
    it.each(ALL_SPELLINGS)('ungated caller: raw org is gated for spelling %s', async (spelling) => {
        const canonical = canonicalMetaUrlType(spelling);
        const overridable = OVERRIDABLE.includes(canonical);
        const h = makeHarness([]);

        await h.protocol.getMetaItems({ type: spelling, organizationId: ORG });

        expect(partitions(h.finds)).toEqual(overridable ? [null, ORG] : [null]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — `getMetaDiagnostics`, the whole-registry sweep (door 1 on the card)
// ═══════════════════════════════════════════════════════════════════════════

describe('§4 GET /meta/diagnostics with no ?type= is scoped per swept type', () => {
    it('names the organization only for the types whose registry entry allows it', async () => {
        const h = makeHarness([]);

        await h.protocol.getMetaDiagnostics({ organizationId: ORG });

        const byType = partitionsByType(h.finds);
        expect(byType.size).toBeGreaterThan(1); // it really did sweep more than one type

        for (const [type, parts] of byType) {
            expect(parts.has(null)).toBe(true);
            expect(parts.has(ORG)).toBe(OVERRIDABLE.includes(type));
        }
        // …and the sweep genuinely reached at least one of each kind, so the
        // loop above is not vacuously true on a single-kind sweep.
        expect([...byType.keys()].some((t) => OVERRIDABLE.includes(t))).toBe(true);
        expect([...byType.keys()].some((t) => !OVERRIDABLE.includes(t))).toBe(true);
    });

    it('the ?type= arm is unchanged — one type, one organization, still correct', async () => {
        for (const type of ['view', 'object']) {
            const h = makeHarness([]);
            // What the REST door passes once it gates: the predicate's answer.
            const gated = organizationIdForMetaRead(type, ORG);
            await h.protocol.getMetaDiagnostics({ type, ...(gated ? { organizationId: gated } : {}) });
            expect(partitions(h.finds)).toEqual(gated ? [null, ORG] : [null]);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — `findReferencesToMeta`, where the org is spent on the SOURCES
// ═══════════════════════════════════════════════════════════════════════════

describe('§5 GET /meta/:type/:name/references is scoped per SOURCE type', () => {
    it('gates each matcher.fromType on its own flag, not on the target’s', async () => {
        const h = makeHarness([]);

        // Target `object` is NON-overridable; its sources include `view`,
        // which IS. Gating on the target would have answered env-wide for the
        // org-scoped views this panel exists to find.
        await h.protocol.findReferencesToMeta({ type: 'object', name: 'task', organizationId: ORG });

        const byType = partitionsByType(h.finds);
        expect(byType.size).toBeGreaterThan(1);
        for (const [type, parts] of byType) {
            expect(parts.has(null)).toBe(true);
            expect(parts.has(ORG)).toBe(OVERRIDABLE.includes(type));
        }
        // The load-bearing source: an org-overridable type really is among the
        // sources of `object`, so the `true` branch above is exercised.
        expect([...byType.keys()].some((t) => OVERRIDABLE.includes(t))).toBe(true);
    });

    it('an org-scoped view referencing the target is FOUND — the false clearance closes', async () => {
        const h = makeHarness([
            storedRow('view', 'org_tasks', {
                organization_id: ORG,
                metadata: JSON.stringify({ name: 'org_tasks', label: 'Org tasks', object: 'task' }),
            }),
        ]);

        const res = await h.protocol.findReferencesToMeta({
            type: 'object',
            name: 'task',
            organizationId: ORG,
        });

        expect(res.references.map((r: any) => `${r.type}/${r.name}`)).toContain('view/org_tasks');
    });
});
