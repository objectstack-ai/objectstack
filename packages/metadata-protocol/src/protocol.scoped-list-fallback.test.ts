// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21817, ADR-0048, ADR-0005] A list scoped to one package
 * (`getMetaItems({ type, packageId })`, `GET /api/v1/meta/:type?package=`)
 * serves, in each slot the package ships, the row `getMetaItem` naming that
 * package serves: the package's own row, else the package-less row, the
 * organization's rows before the env-wide ones.
 *
 * The scoped list read its stored rows with the package only, so a
 * package-less row never reached its merge. With the package's artifact and a
 * package-less customization of it stored, the list served the artifact while
 * `getMetaItem` naming the package served the customization. With an
 * organization, the list served an env-wide row of the package over the
 * organization's package-less row, which `getMetaItem` never does.
 *
 * Now the package-less rows in scope (the package-agnostic read the list
 * already makes for the lock, filtered back to the package-less rows) enter
 * each of the list's merges as stand-ins, and the merge picks a slot's row by
 * the one candidate order `servedOverlayRowCandidates` in `protocol.ts`. A
 * stand-in serves a slot the package seats and never seats one, so the
 * scoped list still lists only the items the package ships.
 *
 *  1. The generated pin: every subset of five stored rows (env-wide and
 *     org-scoped, package-less and package A's, plus package B's env-wide
 *     row), every row order, with and without an organization, with and
 *     without A's artifact. For packages A and B: when the package ships the
 *     name (its artifact, or a row of its own in scope), the scoped list's
 *     one slot serves the row an oracle written from the rule names, and
 *     `getMetaItem` naming the package serves the same; when it ships
 *     nothing, the scoped list has no slot for the name.
 *  2. Named, both row orders: A's artifact beside the package-less row; with
 *     an organization, the organization's package-less row beside an env-wide
 *     row of A.
 *  3. Membership: a package-less row of a name the package does not ship
 *     adds no slot to the scoped list, which lists the same names with and
 *     without it, while the unscoped list still serves that row.
 *  4. The MetadataService layer: a package's runtime item (no registry item,
 *     no row of the package) and a package-less row of its name. The scoped
 *     slot serves the row, as `getMetaItem` naming the package does.
 *  5. The draft preview: a package-less draft stands in for the package's
 *     slot; the package's own draft wins over it in both orders.
 *  6. The view container expansion: a package-less row of a name the
 *     package's stored container expands is served ahead of the expansion,
 *     as `getMetaItem` naming the package serves it.
 *  7. The lock: where the served row moves to the package-less row, the
 *     scoped slot's lock family still equals `getMetaItem`'s envelope.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_a';
/** Per-organization overridable (ADR-0005), so the organization axis is live. */
const TYPE = 'dashboard';
const PKG_A = 'com.example.a';
const PKG_B = 'com.example.b';
const NAME = 'd_slot';

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

function stored(
    key: RowKey,
    options: { state?: 'active' | 'draft'; type?: string; name?: string; body?: Record<string, unknown> } = {},
): StoredRow {
    const { state = 'active', type = TYPE, name = NAME, body = {} } = options;
    const spec: RowSpec = ROWS[key];
    const label = state === 'draft' ? `${spec.label} (draft)` : spec.label;
    return {
        id: `r_${key}_${state}_${name}`,
        type,
        name,
        organization_id: spec.scope === 'org-scoped' ? ORG : null,
        package_id: spec.packageId,
        state,
        metadata: JSON.stringify({ name, label, _provenance: 'org', ...body }),
    };
}

/** What package A's loader registered for the name, when a case asks for it. */
const ARTIFACT_A = { name: NAME, label: 'packaged by A', _packageId: PKG_A, _provenance: 'package' };

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, a registry
 * that holds the given items (package-scoped lookups answer that package's
 * only), and optionally a MetadataService listing runtime items.
 */
function harness(
    rows: StoredRow[],
    options: { items?: Array<Record<string, unknown>>; runtime?: Array<Record<string, unknown>>; type?: string } = {},
) {
    const { items = [], runtime, type = TYPE } = options;
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
    const services = new Map<string, unknown>();
    if (runtime) {
        services.set('metadata', {
            async list(asked: string) {
                return asked === type ? runtime.map((i) => ({ ...i })) : [];
            },
            async get(asked: string, name: string, packageId?: string) {
                return asked === type
                    ? runtime.find((i) => i.name === name && (!packageId || i._packageId === packageId))
                    : undefined;
            },
        });
    }
    return new ObjectStackProtocolImplementation(engine, () => services as any, 'env_1');
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
 * package's. With no row, the package's artifact.
 */
function servedLabel(rows: readonly RowKey[], packageId: string, organizationId: string | undefined, artifact: boolean): string | undefined {
    const scopes: Scope[] = organizationId ? ['org-scoped', 'env-wide'] : ['env-wide'];
    for (const scope of scopes) {
        for (const candidate of [packageId, null]) {
            const hit = rows.find((key) => ROWS[key].scope === scope && ROWS[key].packageId === candidate);
            if (hit) return ROWS[hit].label;
        }
    }
    return artifact && packageId === PKG_A ? ARTIFACT_A.label : undefined;
}

/** Whether the package ships the name: its artifact, or a row of its own in scope. */
function ships(rows: readonly RowKey[], packageId: string, organizationId: string | undefined, artifact: boolean): boolean {
    if (artifact && packageId === PKG_A) return true;
    return rows.some((key) => ROWS[key].packageId === packageId
        && (ROWS[key].scope === 'env-wide' || organizationId !== undefined));
}

/** The items of the scoped list, by name. */
async function scopedList(
    protocol: ObjectStackProtocolImplementation, packageId: string,
    request: { organizationId?: string; previewDrafts?: boolean } = {}, type: string = TYPE,
): Promise<any[]> {
    const listed: any = await protocol.getMetaItems({ type, packageId, ...request });
    return listed.items as any[];
}

/** The scoped list's slot for the name. */
async function scopedSlots(
    protocol: ObjectStackProtocolImplementation, packageId: string,
    request: { organizationId?: string; previewDrafts?: boolean } = {}, type: string = TYPE, name: string = NAME,
): Promise<any[]> {
    return (await scopedList(protocol, packageId, request, type)).filter((item) => item?.name === name);
}

/** What `getMetaItem` naming `packageId` answers. */
async function byName(
    protocol: ObjectStackProtocolImplementation, packageId: string,
    request: { organizationId?: string; previewDrafts?: boolean } = {}, type: string = TYPE, name: string = NAME,
): Promise<any> {
    return protocol.getMetaItem({ type, name, packageId, ...request });
}

// ── 1. The generated pin ─────────────────────────────────────────────────────

describe('pin 1 (generated) — the scoped list\'s slot serves the row getMetaItem naming the package serves, in every row order', () => {
    const TABLE = subsets(ROW_KEYS).flatMap((rows) =>
        ([undefined, ORG] as const).flatMap((organizationId) =>
            [false, true].map((artifact) => ({ rows, organizationId, artifact }))));

    it('completeness: every subset of the five rows, with and without an organization and A\'s artifact; the fallback arrangements are in it', () => {
        expect(TABLE).toHaveLength(2 ** ROW_KEYS.length * 2 * 2);
        expect(new Set(ROW_KEYS.map((key) => ROWS[key].packageId))).toEqual(new Set([null, PKG_A, PKG_B]));
        // The arrangements this card is about: a package that ships the name
        // and a package-less row the oracle serves for it, in more than one order.
        const fallback = TABLE.filter(({ rows, organizationId, artifact }) =>
            [PKG_A, PKG_B].some((packageId) => ships(rows, packageId, organizationId, artifact)
                && !ROW_KEYS.some((key) => ROWS[key].label === servedLabel(rows, packageId, organizationId, artifact)
                    && ROWS[key].packageId === packageId)
                && servedLabel(rows, packageId, organizationId, artifact) !== ARTIFACT_A.label));
        expect(fallback.length).toBeGreaterThan(0);
        expect(fallback.some(({ rows }) => orders(rows).length >= 2)).toBe(true);
        expect(fallback.some(({ organizationId }) => organizationId === undefined)).toBe(true);
        expect(fallback.some(({ organizationId }) => organizationId === ORG)).toBe(true);
    });

    for (const { rows, organizationId, artifact } of TABLE) {
        const title = `rows: ${rows.length === 0 ? 'none' : rows.map((key) => ROWS[key].label).join(' + ')}`
            + ` · ${artifact ? 'A\'s artifact' : 'no artifact'}`
            + ` · request: ${organizationId ? `organization ${organizationId}` : 'no organization'}`;
        it(title, async () => {
            for (const order of orders(rows)) {
                const at = `${title} · row order ${order.join(', ') || '-'}`;
                const protocol = harness(order.map((key) => stored(key)), { items: artifact ? [ARTIFACT_A] : [] });
                const scope = organizationId ? { organizationId } : {};
                for (const packageId of [PKG_A, PKG_B]) {
                    const slots = await scopedSlots(protocol, packageId, scope);
                    if (!ships(order, packageId, organizationId, artifact)) {
                        // The package ships nothing of the name: a package-less
                        // row adds no slot to its list.
                        expect(slots, `${at}: a slot in the list scoped to ${packageId}`).toEqual([]);
                        continue;
                    }
                    const expected = servedLabel(order, packageId, organizationId, artifact);
                    expect(slots.map((s) => ({ label: s.label, packageId: s._packageId })), `${at}: the list scoped to ${packageId}`)
                        .toEqual([{ label: expected, packageId }]);
                    expect((await byName(protocol, packageId, scope)).item?.label, `${at}: getMetaItem naming ${packageId}`)
                        .toBe(expected);
                }
            }
        });
    }
});

// ── 2. Named, both row orders ────────────────────────────────────────────────

describe('pin 2 — named arrangements, both row orders: the scoped slot is getMetaItem\'s row', () => {
    for (const type of [TYPE, 'view']) {
        for (const order of orders<RowKey>(['envPackageless', 'envB'])) {
            it(`/meta/${type}?package=A · A's artifact + the env-wide package-less row · row order ${order.join(', ')}`, async () => {
                const artifact = { ...ARTIFACT_A, ...(type === 'view' ? { object: 'account' } : {}) };
                const protocol = harness(order.map((key) => stored(key, { type })), { items: [artifact], type });
                const slots = await scopedSlots(protocol, PKG_A, {}, type);
                expect(slots.map((s) => ({ label: s.label, packageId: s._packageId })))
                    .toEqual([{ label: ROWS.envPackageless.label, packageId: PKG_A }]);
                expect((await byName(protocol, PKG_A, {}, type)).item?.label).toBe(ROWS.envPackageless.label);
            });
        }
    }
    for (const order of orders<RowKey>(['orgPackageless', 'envA'])) {
        it(`organization ${ORG} · the organization's package-less row over an env-wide row of A · row order ${order.join(', ')}`, async () => {
            const protocol = harness(order.map((key) => stored(key)));
            const slots = await scopedSlots(protocol, PKG_A, { organizationId: ORG });
            expect(slots.map((s) => s.label)).toEqual([ROWS.orgPackageless.label]);
            expect((await byName(protocol, PKG_A, { organizationId: ORG })).item?.label).toBe(ROWS.orgPackageless.label);
        });
    }
    for (const order of orders<RowKey>(['orgA', 'envPackageless'])) {
        it(`organization ${ORG} · the organization's row of A over the env-wide package-less row · row order ${order.join(', ')}`, async () => {
            const protocol = harness(order.map((key) => stored(key)));
            const slots = await scopedSlots(protocol, PKG_A, { organizationId: ORG });
            expect(slots.map((s) => s.label)).toEqual([ROWS.orgA.label]);
            expect((await byName(protocol, PKG_A, { organizationId: ORG })).item?.label).toBe(ROWS.orgA.label);
        });
    }
});

// ── 3. Membership ────────────────────────────────────────────────────────────

describe('pin 3 — membership: a package-less row of a name the package does not ship adds no slot', () => {
    const OTHER = 'd_other';
    for (const organizationId of [undefined, ORG]) {
        for (const scopeKey of ['envPackageless', 'orgPackageless'] as const) {
            if (scopeKey === 'orgPackageless' && organizationId === undefined) continue;
            it(`${organizationId ? `organization ${organizationId}` : 'no organization'} · a ${ROWS[scopeKey].label} of a name A does not ship`, async () => {
                const shipped = [stored('envA', { name: 'd_rowed' })];
                const items = [ARTIFACT_A];
                const scope = organizationId ? { organizationId } : {};
                const without = harness(shipped, { items });
                const withRow = harness([...shipped, stored(scopeKey, { name: OTHER })], { items });
                const names = (list: any[]) => list.map((i) => `${i.name}@${i._packageId}`).sort();
                const listedWithout = names(await scopedList(without, PKG_A, scope));
                expect(listedWithout).toEqual([`d_rowed@${PKG_A}`, `${NAME}@${PKG_A}`]);
                expect(names(await scopedList(withRow, PKG_A, scope))).toEqual(listedWithout);
                // The row is still served where it belongs: the unscoped list.
                const unscoped: any = await withRow.getMetaItems({ type: TYPE, ...scope });
                expect((unscoped.items as any[]).filter((i) => i.name === OTHER).map((i) => i.label))
                    .toEqual([ROWS[scopeKey].label]);
            });
        }
    }
});

// ── 4. The MetadataService layer ─────────────────────────────────────────────

describe('pin 4 — the MetadataService layer: a package-less row stands in for the package\'s runtime item', () => {
    const RUNTIME_A = { name: NAME, label: 'runtime item of A', _packageId: PKG_A };
    for (const scopeKey of ['envPackageless', 'orgPackageless'] as const) {
        it(`a ${ROWS[scopeKey].label} of the name: the scoped slot serves it, as getMetaItem naming A does`, async () => {
            const protocol = harness([stored(scopeKey)], { runtime: [RUNTIME_A] });
            const scope = { organizationId: ORG };
            const slots = await scopedSlots(protocol, PKG_A, scope);
            expect(slots.map((s) => ({ label: s.label, packageId: s._packageId })))
                .toEqual([{ label: ROWS[scopeKey].label, packageId: PKG_A }]);
            expect((await byName(protocol, PKG_A, scope)).item?.label).toBe(ROWS[scopeKey].label);
        });
    }
    it('control: no runtime item of A, the package-less row adds no slot; lit control: the runtime item alone is served', async () => {
        const rowOnly = harness([stored('envPackageless')], { runtime: [] });
        expect(await scopedSlots(rowOnly, PKG_A)).toEqual([]);
        const runtimeOnly = harness([], { runtime: [RUNTIME_A] });
        expect((await scopedSlots(runtimeOnly, PKG_A)).map((s) => s.label)).toEqual([RUNTIME_A.label]);
        expect((await byName(runtimeOnly, PKG_A)).item?.label).toBe(RUNTIME_A.label);
    });
});

// ── 5. The draft preview ─────────────────────────────────────────────────────

describe('pin 5 — the draft preview: the scoped previewed slot is the draft getMetaItem previews', () => {
    it('A\'s artifact and a package-less draft: the previewed slot is the draft', async () => {
        const protocol = harness([stored('envPackageless', { state: 'draft' })], { items: [ARTIFACT_A] });
        const slots = await scopedSlots(protocol, PKG_A, { previewDrafts: true });
        expect(slots.map((s) => ({ label: s.label, draft: s._draft, packageId: s._packageId })))
            .toEqual([{ label: `${ROWS.envPackageless.label} (draft)`, draft: true, packageId: PKG_A }]);
        const previewed = (await byName(protocol, PKG_A, { previewDrafts: true })).item;
        expect({ label: previewed?.label, draft: previewed?._draft })
            .toEqual({ label: `${ROWS.envPackageless.label} (draft)`, draft: true });
    });
    for (const order of orders<RowKey>(['envPackageless', 'envA'])) {
        it(`A's draft and a package-less draft · row order ${order.join(', ')}: A's draft`, async () => {
            const protocol = harness(order.map((key) => stored(key, { state: 'draft' })), { items: [ARTIFACT_A] });
            const slots = await scopedSlots(protocol, PKG_A, { previewDrafts: true });
            expect(slots.map((s) => s.label)).toEqual([`${ROWS.envA.label} (draft)`]);
            expect((await byName(protocol, PKG_A, { previewDrafts: true })).item?.label).toBe(`${ROWS.envA.label} (draft)`);
        });
    }
    it('membership: a package-less draft of a name A does not ship previews no slot', async () => {
        const protocol = harness([stored('envPackageless', { state: 'draft', name: 'd_other' })], { items: [ARTIFACT_A] });
        const listed = await scopedList(protocol, PKG_A, { previewDrafts: true });
        expect(listed.map((i) => i.name)).toEqual([NAME]);
    });
});

// ── 6. The view container expansion ──────────────────────────────────────────

describe('pin 6 — a stored view container of A: a package-less row of a name it expands is served ahead of the expansion', () => {
    const OBJECT = 'crm_lead';
    const container = {
        name: OBJECT,
        list: { label: 'All Leads', type: 'grid', data: { provider: 'object', object: OBJECT }, columns: [{ field: 'name' }] },
        listViews: {
            pipeline: { label: 'Lead Pipeline', type: 'grid', data: { provider: 'object', object: OBJECT }, columns: [{ field: 'name' }] },
        },
    };
    const containerRow = { ...stored('envA', { type: 'view', name: OBJECT }), metadata: JSON.stringify(container) };
    const pipeline = `${OBJECT}.pipeline`;
    const customized = stored('envPackageless', {
        type: 'view', name: pipeline,
        body: { object: OBJECT, viewKind: 'list', config: { type: 'grid', columns: [{ field: 'name' }] } },
    });

    it('the scoped list serves the package-less row for the name, stamped A, and still lists every name the container expands', async () => {
        const protocol = harness([containerRow, customized], { type: 'view' });
        const listed = await scopedList(protocol, PKG_A, {}, 'view');
        expect(listed.map((i) => i.name).sort()).toEqual([`${OBJECT}.default`, pipeline]);
        const slot = listed.find((i) => i.name === pipeline);
        expect({ label: slot?.label, packageId: slot?._packageId }).toEqual({ label: ROWS.envPackageless.label, packageId: PKG_A });
        expect((await byName(protocol, PKG_A, {}, 'view', pipeline)).item?.label).toBe(ROWS.envPackageless.label);
    });

    it('lit control: without the package-less row the expansion is served', async () => {
        const protocol = harness([containerRow], { type: 'view' });
        const listed = await scopedList(protocol, PKG_A, {}, 'view');
        expect(listed.map((i) => i.name).sort()).toEqual([`${OBJECT}.default`, pipeline]);
        expect(listed.find((i) => i.name === pipeline)?.label).toBe('Lead Pipeline');
    });
});

// ── 7. The lock ──────────────────────────────────────────────────────────────

describe('pin 7 — the lock: the scoped slot\'s lock family equals getMetaItem\'s envelope where the served row moved', () => {
    for (const lock of ['no-overlay', 'no-delete', 'full'] as const) {
        for (const declaredOn of ['orgPackageless', 'envA'] as const) {
            it(`organization ${ORG} · the organization's package-less row served over env A · ${ROWS[declaredOn].label} declares ${lock}`, async () => {
                const rows = (['orgPackageless', 'envA'] as const).map((key) =>
                    stored(key, { body: key === declaredOn ? { _lock: lock, _lockReason: `declared on ${key}` } : {} }));
                const protocol = harness(rows, { items: [ARTIFACT_A] });
                const scope = { organizationId: ORG };
                const [slot] = await scopedSlots(protocol, PKG_A, scope);
                const read = await byName(protocol, PKG_A, scope);
                expect(slot?.label).toBe(ROWS.orgPackageless.label);
                expect(read.item?.label).toBe(ROWS.orgPackageless.label);
                expect({ lock: slot?._lock ?? 'none', reason: slot?._lockReason })
                    .toEqual({ lock: read.lock, reason: read.item?._lockReason });
            });
        }
    }
});
