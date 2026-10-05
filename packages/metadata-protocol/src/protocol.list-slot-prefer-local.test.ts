// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21804, ADR-0048, ADR-0005] A package's slot in the metadata list serves the
 * stored row `getMetaItem` naming that package serves, whatever order the
 * store returns the rows in.
 *
 * The list builds each package's slot in `mergePackageAwareOverlay`. Its
 * docblock promised `getMetaItem(name, packageId=P)`'s resolution, but it took
 * the LATEST of the package's row and the package-less row in row order. So
 * with both rows stored for one `(type, name, scope)`, the list served the
 * package-less body in one order while the by-name read served the package's
 * own row. The organization axis had the same shape: the list could serve an
 * env-wide row of the package over the organization's package-less row, which
 * the by-name read (organization first, ADR-0005) never does.
 *
 * Both now take one order, `servedOverlayRowCandidates` in `protocol.ts`:
 * scope (the organization's rows, then env-wide), then spelling, then the
 * package's own row before the package-less row. `findServedOverlayRow` reads
 * it from the store; the list reads it over the rows it already holds.
 *
 *  1. The generated pin: every subset of five stored rows (env-wide and
 *     org-scoped, package-less and package A's, plus a third package B's
 *     env-wide row), in every order the store can return them, for a request
 *     with and without an organization. Every package slot in the list serves
 *     the row an oracle written from the rule names, and `getMetaItem` naming
 *     that package serves the same row.
 *  2. Named: package A's row and the package-less row, both env-wide, both
 *     orders, with and without A's packaged artifact. The slot is A's row.
 *  3. Named, organization scope: the organization's package-less row beats an
 *     env-wide row of A; the organization's row of A beats the env-wide
 *     package-less row. Both orders.
 *  4. Control: only the package-less row is stored, under A's artifact. The
 *     slot still falls back to it (stamped as A's), as the by-name read does.
 *  5. The draft preview: A's draft and a package-less draft, both orders. The
 *     previewed slot is A's draft, as `getMetaItem` with `previewDrafts`.
 *
 * A list scoped to a package (`packageId` on the list request) is pinned in
 * `protocol.scoped-list-fallback.test.ts` (#21817): its package-less rows
 * reach the merge as stand-ins, so its slot takes the same order.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_a';
/**
 * The type the tables run on: per-organization overridable (ADR-0005), so the
 * organization axis is live, and with no expansion of its own in the list.
 * (`view` upserts the items its stored containers expand by bare name, which
 * folds two packages' same-name slots into one; that is the view expansion,
 * not this merge, so pin 2 also runs on `view` with one package.)
 */
const TYPE = 'dashboard';
const PKG_A = 'com.example.a';
const PKG_B = 'com.example.b';
const NAME = 'v_slot';

type Scope = 'env-wide' | 'org-scoped';
interface RowSpec { scope: Scope; packageId: string | null; label: string }

/** The stored rows the tables draw from. */
const ROWS = {
    envPackageless: { scope: 'env-wide', packageId: null, label: 'env-wide package-less row' },
    envA: { scope: 'env-wide', packageId: PKG_A, label: 'env-wide row of A' },
    envB: { scope: 'env-wide', packageId: PKG_B, label: 'env-wide row of B' },
    orgPackageless: { scope: 'org-scoped', packageId: null, label: 'org-scoped package-less row' },
    orgA: { scope: 'org-scoped', packageId: PKG_A, label: 'org-scoped row of A' },
} as const satisfies Record<string, RowSpec>;
type RowKey = keyof typeof ROWS;
const ROW_KEYS = Object.keys(ROWS) as RowKey[];

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function stored(key: RowKey, state: 'active' | 'draft' = 'active', type: string = TYPE): StoredRow {
    const spec: RowSpec = ROWS[key];
    const label = state === 'draft' ? `${spec.label} (draft)` : spec.label;
    return {
        id: `r_${key}_${state}`,
        type,
        name: NAME,
        organization_id: spec.scope === 'org-scoped' ? ORG : null,
        package_id: spec.packageId,
        state,
        metadata: JSON.stringify({ name: NAME, label, ...(type === 'view' ? { object: 'account' } : {}), _provenance: 'org' }),
    };
}

/** What package A's loader registered for the name, when the row asks for it. */
const ARTIFACT_A = { name: NAME, label: 'packaged by A', _packageId: PKG_A, _provenance: 'package' };

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, and a
 * registry that holds at most package A's artifact, answering a
 * package-scoped lookup with that package's items only.
 */
function harness(rows: StoredRow[], artifact = false, type: string = TYPE) {
    const items: Array<Record<string, unknown>> = artifact ? [ARTIFACT_A] : [];
    const ofPackage = (packageId?: string) => items.filter((i) => !packageId || i._packageId === packageId);
    const registry = {
        getArtifactItem(asked: string, name: string, packageId?: string) {
            const hit = asked === type ? ofPackage(packageId).find((i) => i.name === name) : undefined;
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(asked: string, name: string, packageId?: string) {
            return asked === type ? ofPackage(packageId).find((i) => i.name === name) : undefined;
        },
        listItems(asked: string, packageId?: string) {
            return asked === type ? ofPackage(packageId) : [];
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        async insert() {
            return {};
        },
        registry,
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1');
}

/** Every order the store can return `xs` in. */
function orders<T>(xs: readonly T[]): T[][] {
    if (xs.length <= 1) return [[...xs]];
    return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** Every subset of `xs`, the empty one included. */
function subsets<T>(xs: readonly T[]): T[][] {
    return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);
}

/**
 * The oracle, written from the rule: the scopes the request reaches
 * (ADR-0005: the organization's, then env-wide), and within one scope the
 * package's own row before the package-less row (ADR-0048), never another
 * package's. The first row found is the served row.
 */
function servedLabel(rows: readonly RowKey[], packageId: string, organizationId: string | undefined): string | undefined {
    const scopes: Scope[] = organizationId ? ['org-scoped', 'env-wide'] : ['env-wide'];
    for (const scope of scopes) {
        for (const candidate of [packageId, null]) {
            const hit = rows.find((key) => ROWS[key].scope === scope && ROWS[key].packageId === candidate);
            if (hit) return ROWS[hit].label;
        }
    }
    return undefined;
}

/** The list's slot for `packageId` (the items of the name stamped with it). */
async function listSlots(
    protocol: ObjectStackProtocolImplementation, packageId: string,
    request: { organizationId?: string; previewDrafts?: boolean } = {}, type: string = TYPE,
): Promise<any[]> {
    const listed: any = await protocol.getMetaItems({ type, ...request });
    return (listed.items as any[]).filter((item) => item?.name === NAME && item?._packageId === packageId);
}

/** The body `getMetaItem` naming `packageId` serves. */
async function byName(
    protocol: ObjectStackProtocolImplementation, packageId: string,
    request: { organizationId?: string; previewDrafts?: boolean } = {}, type: string = TYPE,
): Promise<any> {
    const read: any = await protocol.getMetaItem({ type, name: NAME, packageId, ...request });
    return read.item;
}

// ── 1. The generated pin ─────────────────────────────────────────────────────

describe('pin 1 (generated) — every package slot in the list serves the row getMetaItem naming that package serves, in every row order', () => {
    const TABLE = subsets(ROW_KEYS).flatMap((rows) =>
        ([undefined, ORG] as const).map((organizationId) => ({ rows, organizationId })));

    it('completeness: every subset of the five rows, with and without an organization, and both packages are reachable', () => {
        expect(TABLE).toHaveLength(2 ** ROW_KEYS.length * 2);
        expect(new Set(ROW_KEYS.map((key) => ROWS[key].packageId))).toEqual(new Set([null, PKG_A, PKG_B]));
        expect(new Set(ROW_KEYS.map((key) => ROWS[key].scope))).toEqual(new Set(['env-wide', 'org-scoped']));
        // The arrangements this card is about are in the table: the package's
        // row beside the package-less row of one scope, in more than one order.
        const both = TABLE.filter(({ rows }) =>
            (rows.includes('envA') && rows.includes('envPackageless'))
            || (rows.includes('orgA') && rows.includes('orgPackageless')));
        expect(both.length).toBeGreaterThan(0);
        expect(both.every(({ rows }) => orders(rows).length >= 2)).toBe(true);
    });

    for (const { rows, organizationId } of TABLE) {
        const title = `rows: ${rows.length === 0 ? 'none' : rows.map((key) => ROWS[key].label).join(' + ')}`
            + ` · request: ${organizationId ? `organization ${organizationId}` : 'no organization'}`;
        it(title, async () => {
            for (const order of orders(rows)) {
                const at = `${title} · row order ${order.join(', ') || '-'}`;
                const protocol = harness(order.map((key) => stored(key)));
                const scope = organizationId ? { organizationId } : {};
                for (const packageId of [PKG_A, PKG_B]) {
                    const expected = servedLabel(order, packageId, organizationId);
                    const inScope = order.some((key) => ROWS[key].packageId === packageId
                        && (ROWS[key].scope === 'env-wide' || organizationId !== undefined));
                    const slots = await listSlots(protocol, packageId, scope);
                    if (!inScope) {
                        // No row of the package in scope and no artifact: the
                        // list has no slot for it.
                        expect(slots, `${at}: a slot for ${packageId}`).toEqual([]);
                        continue;
                    }
                    expect(slots.map((s) => s.label), `${at}: the list's slot for ${packageId}`).toEqual([expected]);
                    expect((await byName(protocol, packageId, scope))?.label, `${at}: getMetaItem naming ${packageId}`)
                        .toBe(expected);
                }
            }
        });
    }
});

// ── 2–4. Named ───────────────────────────────────────────────────────────────

describe('pin 2 — the package\'s row beside the package-less row (one scope, env-wide): the slot is the package\'s row in both orders', () => {
    for (const type of [TYPE, 'view']) {
        for (const artifact of [false, true]) {
            for (const order of orders<RowKey>(['envPackageless', 'envA'])) {
                it(`/meta/${type} · ${artifact ? 'A\'s artifact registered' : 'no artifact'} · row order ${order.join(', ')}`, async () => {
                    const protocol = harness(order.map((key) => stored(key, 'active', type)), artifact, type);
                    const slots = await listSlots(protocol, PKG_A, {}, type);
                    expect(slots.map((s) => s.label)).toEqual([ROWS.envA.label]);
                    expect((await byName(protocol, PKG_A, {}, type))?.label).toBe(ROWS.envA.label);
                    // The package-less row is not listed beside it: it stands
                    // in only for a package with no row of its own.
                    const listed: any = await protocol.getMetaItems({ type });
                    expect((listed.items as any[]).filter((item) => item?.name === NAME)).toHaveLength(1);
                });
            }
        }
    }
});

describe('pin 3 — organization scope (ADR-0005): the organization\'s rows before the env-wide rows, then the package\'s own row', () => {
    for (const order of orders<RowKey>(['orgPackageless', 'envA', 'envPackageless'])) {
        it(`the organization's package-less row over an env-wide row of A · row order ${order.join(', ')}`, async () => {
            const protocol = harness(order.map((key) => stored(key)));
            const slots = await listSlots(protocol, PKG_A, { organizationId: ORG });
            expect(slots.map((s) => s.label)).toEqual([ROWS.orgPackageless.label]);
            expect((await byName(protocol, PKG_A, { organizationId: ORG }))?.label).toBe(ROWS.orgPackageless.label);
        });
    }
    for (const order of orders<RowKey>(['orgA', 'envPackageless'])) {
        it(`the organization's row of A over the env-wide package-less row · row order ${order.join(', ')}`, async () => {
            const protocol = harness(order.map((key) => stored(key)));
            const slots = await listSlots(protocol, PKG_A, { organizationId: ORG });
            expect(slots.map((s) => s.label)).toEqual([ROWS.orgA.label]);
            expect((await byName(protocol, PKG_A, { organizationId: ORG }))?.label).toBe(ROWS.orgA.label);
        });
    }
});

describe('pin 4 — control: with only the package-less row stored, the package\'s slot still falls back to it', () => {
    it('A\'s artifact and the env-wide package-less row: the slot serves the row, stamped as A\'s', async () => {
        const protocol = harness([stored('envPackageless')], true);
        const slots = await listSlots(protocol, PKG_A);
        expect(slots.map((s) => ({ label: s.label, packageId: s._packageId })))
            .toEqual([{ label: ROWS.envPackageless.label, packageId: PKG_A }]);
        expect((await byName(protocol, PKG_A))?.label).toBe(ROWS.envPackageless.label);
    });

    it('lit control: A\'s artifact alone is served as itself', async () => {
        const protocol = harness([], true);
        const slots = await listSlots(protocol, PKG_A);
        expect(slots.map((s) => s.label)).toEqual([ARTIFACT_A.label]);
        expect((await byName(protocol, PKG_A))?.label).toBe(ARTIFACT_A.label);
    });
});

// ── 5. The draft preview ─────────────────────────────────────────────────────

describe('pin 5 — the draft preview: the package\'s previewed slot is the draft getMetaItem previews, in both orders', () => {
    for (const order of orders<RowKey>(['envPackageless', 'envA'])) {
        it(`A's draft and the package-less draft · row order ${order.join(', ')}`, async () => {
            const protocol = harness(order.map((key) => stored(key, 'draft')), true);
            const slots = await listSlots(protocol, PKG_A, { previewDrafts: true });
            expect(slots.map((s) => ({ label: s.label, draft: s._draft })))
                .toEqual([{ label: `${ROWS.envA.label} (draft)`, draft: true }]);
            const previewed = await byName(protocol, PKG_A, { previewDrafts: true });
            expect({ label: previewed?.label, draft: previewed?._draft })
                .toEqual({ label: `${ROWS.envA.label} (draft)`, draft: true });
        });
    }
});
