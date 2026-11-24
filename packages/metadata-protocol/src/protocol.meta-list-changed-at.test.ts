// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36894] The metadata LIST response answers `changedAt` beside its items
 * (`GetMetaItemsResponseSchema.changedAt`): for each listed item served from a
 * stored row, that row's `updated_at`, keyed by the item's `name`.
 *
 *  1. Which items: a stored row's item has an entry, a code-shipped item none
 *     (never a stand-in time), and the field is absent when no listed item is
 *     served from a row.
 *  2. Which layer: of several stored rows in scope for one item, the one whose
 *     content the list serves, in every row order, on the list naming no
 *     package (the Studio's cross-package list) and on the list scoped to the
 *     package; the package-less row's time only where it is the content.
 *  3. The draft preview: an item whose pending draft is served has the draft
 *     row's time; without the preview, the active row's.
 *  4. Several listed items of one name: the latest of their times.
 *  5. The faces: only the served effective list answers it, and no item any
 *     face returns carries the time.
 *
 * The engine double is `protocol.list-slot-prefer-local.test.ts`'s, with rows
 * that carry `updated_at`.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { GetMetaItemsResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { NO_PACKAGE_SCOPED_READS } from './no-package-scoped-reads.testkit.js';

const DEFAULT_TYPE = 'dashboard';
const TYPE = DEFAULT_TYPE;
const PKG_A = 'com.example.a';
const PKG_B = 'com.example.b';
const NAME = 'sales_board';

const T_OLD = '2026-11-20T08:00:00.000Z';
const T_MID = '2026-11-22T09:30:00.000Z';
const T_NEW = '2026-11-24T10:15:00.000Z';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
    updated_at?: unknown;
    created_at?: unknown;
}

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function row(
    packageId: string | null,
    stamps: { updated_at?: unknown; created_at?: unknown },
    opts: { state?: 'active' | 'draft'; name?: string; label?: string; type?: string } = {},
): StoredRow {
    const name = opts.name ?? NAME;
    const state = opts.state ?? 'active';
    return {
        id: `r_${name}_${packageId ?? 'none'}_${state}`,
        type: opts.type ?? TYPE,
        name,
        package_id: packageId,
        state,
        metadata: JSON.stringify({ name, label: opts.label ?? `${name} @ ${packageId ?? 'no package'} (${state})` }),
        ...stamps,
    };
}

/** What a package's loader registered: a code-shipped item, no stored row. */
const artifact = (packageId: string, name = NAME) => ({ name, label: `${name} shipped by ${packageId}`, _packageId: packageId, _provenance: 'package' });

function harness(
    rows: StoredRow[],
    artifacts: Array<Record<string, unknown>> = [],
    opts: { type?: string; applyNavContributions?: (app: any) => any } = {},
) {
    const TYPE = opts.type ?? DEFAULT_TYPE;
    const ofPackage = (packageId?: string) => artifacts.filter((i) => !packageId || i._packageId === packageId);
    const registry = {
        ...NO_PACKAGE_SCOPED_READS,
        getArtifactItem(asked: string, name: string, packageId?: string) {
            const hit = asked === TYPE ? ofPackage(packageId).find((i) => i.name === name) : undefined;
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(asked: string, name: string, packageId?: string) {
            return asked === TYPE ? ofPackage(packageId).find((i) => i.name === name) : undefined;
        },
        listItems(asked: string, packageId?: string) {
            return asked === TYPE ? structuredClone(ofPackage(packageId)) : [];
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: opts.applyNavContributions ?? ((app: unknown) => app),
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || whereValueMatches((r as unknown as Record<string, unknown>)[k], v)),
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

const list = async (protocol: ObjectStackProtocolImplementation, request: { packageId?: string; previewDrafts?: boolean } = {}) =>
    await protocol.getMetaItems({ type: TYPE, ...request }) as any;

// ── 1. Which items ───────────────────────────────────────────────────────────

describe('1 — a stored row\'s item has its row\'s time; a code-shipped item has none', () => {
    it('a row of a name no package ships (a self-built package\'s item): its `updated_at`, keyed by name', async () => {
        const listed = await list(harness([row(PKG_A, { updated_at: T_MID, created_at: T_OLD })]));
        expect(listed.changedAt).toEqual({ [NAME]: T_MID });
        // It parses as the published contract states it.
        expect(GetMetaItemsResponseSchema.parse(listed).changedAt).toEqual({ [NAME]: T_MID });
    });

    it('a code-shipped item beside a stored one: only the stored one is keyed', async () => {
        const listed = await list(harness([row(PKG_A, { updated_at: T_MID }, { name: 'custom_board' })], [artifact(PKG_A)]));
        expect((listed.items as any[]).map((it) => it.name).sort()).toEqual(['custom_board', NAME]);
        expect(listed.changedAt).toEqual({ custom_board: T_MID });
    });

    it('only code-shipped items: the field is absent, never a stand-in time', async () => {
        const listed = await list(harness([], [artifact(PKG_A), artifact(PKG_B, 'ops_board')]));
        expect(listed.items).toHaveLength(2);
        expect('changedAt' in listed).toBe(false);
    });

    it('a row that recorded no time (or no readable one) has no entry; `created_at` answers when `updated_at` is absent', async () => {
        const listed = await list(harness([
            row(PKG_A, {}, { name: 'unstamped' }),
            row(PKG_A, { updated_at: 'not a time' }, { name: 'garbled' }),
            row(PKG_A, { created_at: T_OLD }, { name: 'created_only' }),
        ]));
        expect(listed.items).toHaveLength(3);
        expect(listed.changedAt).toEqual({ created_only: T_OLD });
    });

    it('a driver\'s `Date` and an offset spelling are both answered as the instant in UTC with `Z`', async () => {
        const listed = await list(harness([
            row(PKG_A, { updated_at: new Date(T_NEW) }, { name: 'from_date' }),
            row(PKG_A, { updated_at: '2026-11-24T18:15:00+08:00' }, { name: 'from_offset' }),
        ]));
        expect(listed.changedAt).toEqual({ from_date: T_NEW, from_offset: T_NEW });
    });
});

// ── 2. Which layer ───────────────────────────────────────────────────────────

describe('2 — of several stored rows in scope, the time of the row whose content is listed', () => {
    for (const order of orders(['own', 'packageless'] as const)) {
        const rows = () => order.map((k) => k === 'own'
            ? row(PKG_A, { updated_at: T_OLD })
            // The package-less row is the NEWER one: the entry is not "the latest row of the name".
            : row(null, { updated_at: T_NEW }));

        it(`A's own row and the package-less row, under A's artifact · row order ${order.join(', ')}: A's row on the list naming no package`, async () => {
            const listed = await list(harness(rows(), [artifact(PKG_A)]));
            const served = (listed.items as any[]).filter((it) => it.name === NAME);
            expect(served.map((it) => it.label)).toEqual([`${NAME} @ ${PKG_A} (active)`]);
            expect(listed.changedAt).toEqual({ [NAME]: T_OLD });
        });

        it(`the same rows · row order ${order.join(', ')}: A's row on the list scoped to A`, async () => {
            const listed = await list(harness(rows(), [artifact(PKG_A)]), { packageId: PKG_A });
            expect((listed.items as any[]).map((it) => it.label)).toEqual([`${NAME} @ ${PKG_A} (active)`]);
            expect(listed.changedAt).toEqual({ [NAME]: T_OLD });
        });
    }

    it('only the package-less row under A\'s artifact: the row is A\'s content, so its time, on both lists', async () => {
        const rows = [row(null, { updated_at: T_NEW })];
        for (const request of [{}, { packageId: PKG_A }]) {
            const listed = await list(harness(rows, [artifact(PKG_A)]), request);
            expect((listed.items as any[]).map((it) => it.label)).toEqual([`${NAME} @ no package (active)`]);
            expect(listed.changedAt).toEqual({ [NAME]: T_NEW });
        }
    });

    it('control: A\'s artifact alone is listed with no entry, on both lists', async () => {
        for (const request of [{}, { packageId: PKG_A }]) {
            const listed = await list(harness([], [artifact(PKG_A)]), request);
            expect((listed.items as any[]).map((it) => it.label)).toEqual([`${NAME} shipped by ${PKG_A}`]);
            expect('changedAt' in listed).toBe(false);
        }
    });
});

// ── 3. The draft preview ─────────────────────────────────────────────────────

describe('3 — `?preview=draft`: the time of the content served, the draft where the draft is served', () => {
    const rows = () => [
        row(PKG_A, { updated_at: T_OLD }),
        row(PKG_A, { updated_at: T_NEW }, { state: 'draft' }),
        row(PKG_A, { updated_at: T_MID }, { name: 'untouched_board' }),
    ];

    it('the previewed draft has the draft row\'s time; an item with no draft keeps its active row\'s', async () => {
        const listed = await list(harness(rows(), [artifact(PKG_A)]), { previewDrafts: true });
        const served = (listed.items as any[]).find((it) => it.name === NAME);
        expect({ label: served.label, draft: served._draft }).toEqual({ label: `${NAME} @ ${PKG_A} (draft)`, draft: true });
        expect(listed.changedAt).toEqual({ [NAME]: T_NEW, untouched_board: T_MID });
    });

    it('control: without the preview the active row is served, with its time', async () => {
        const listed = await list(harness(rows(), [artifact(PKG_A)]));
        expect((listed.items as any[]).find((it) => it.name === NAME)?.label).toBe(`${NAME} @ ${PKG_A} (active)`);
        expect(listed.changedAt).toEqual({ [NAME]: T_OLD, untouched_board: T_MID });
    });

    it('a draft of an item with no active row (a brand-new item) is listed on the preview with the draft\'s time', async () => {
        const listed = await list(harness([row(PKG_A, { updated_at: T_NEW }, { state: 'draft', name: 'new_board' })]), { previewDrafts: true });
        expect((listed.items as any[]).map((it) => [it.name, it._draft])).toEqual([['new_board', true]]);
        expect(listed.changedAt).toEqual({ new_board: T_NEW });
    });
});

// ── 4. Several listed items of one name ──────────────────────────────────────

describe('4 — several listed items share a name: the latest of their times', () => {
    for (const order of orders(['a', 'b'] as const)) {
        it(`two packages' rows of one name, both listed · row order ${order.join(', ')}`, async () => {
            const rows = order.map((k) => k === 'a' ? row(PKG_A, { updated_at: T_NEW }) : row(PKG_B, { updated_at: T_OLD }));
            const listed = await list(harness(rows));
            expect((listed.items as any[]).filter((it) => it.name === NAME)).toHaveLength(2);
            expect(listed.changedAt).toEqual({ [NAME]: T_NEW });
        });
    }
});

// ── 5. The faces ─────────────────────────────────────────────────────────────

describe('5 — only the served effective list answers it, and no returned item carries the time', () => {
    const rows = () => [row(PKG_A, { updated_at: T_MID }), row(null, { updated_at: T_NEW }, { name: 'loose_board' })];
    const symbolsOf = (items: unknown[]) => items.flatMap((it) => Object.getOwnPropertySymbols(it as object));

    it('the served effective list: the field, and plain items', async () => {
        const listed = await list(harness(rows(), [artifact(PKG_A)]));
        expect(listed.changedAt).toEqual({ [NAME]: T_MID, loose_board: T_NEW });
        expect(symbolsOf(listed.items)).toEqual([]);
        // Nothing beyond what the items always carried reaches the wire.
        expect(JSON.parse(JSON.stringify(listed.items))).toEqual(listed.items);
    });

    it('the execution face and the per-package layer: no field, and plain items', async () => {
        const protocol = harness(rows(), [artifact(PKG_A)]);
        const execution: any = await protocol.getMetaItemsForExecution({ type: TYPE });
        const perPackage: any = await protocol.getMetaItemsPerPackage({ type: TYPE, packageId: PKG_A });
        for (const answer of [execution, perPackage]) {
            expect(answer.items.length).toBeGreaterThan(0);
            expect('changedAt' in answer).toBe(false);
            expect(symbolsOf(answer.items)).toEqual([]);
        }
    });
});

// ── 6. The app nav fold ──────────────────────────────────────────────────────

describe('6 — an `app` keeps its entry through the nav contribution fold, which clones the app', () => {
    /** The registry's fold as it stands: a contributed app is answered as a `structuredClone` carrying the contribution. */
    const fold = (app: any) => (app?.name === NAME
        ? structuredClone({ ...app, navigation: [...(app.navigation ?? []), { id: 'contributed', type: 'url', url: '/x' }] })
        : app);
    const rows = () => [
        row(PKG_A, { updated_at: T_MID }, { type: 'app' }),
        row(PKG_A, { updated_at: T_OLD }, { type: 'app', name: 'plain_app' }),
    ];

    it('a stored app the fold contributes to, beside one it does not: both keyed, the contribution served, plain items', async () => {
        const listed: any = await harness(rows(), [], { type: 'app', applyNavContributions: fold }).getMetaItems({ type: 'app' });
        const contributed = (listed.items as any[]).find((it) => it.name === NAME);
        expect(contributed.navigation.map((n: any) => n.id)).toEqual(['contributed']);
        expect(listed.changedAt).toEqual({ [NAME]: T_MID, plain_app: T_OLD });
        expect((listed.items as any[]).flatMap((it) => Object.getOwnPropertySymbols(it))).toEqual([]);
    });

    it('control: a code-shipped app the fold contributes to stays unkeyed', async () => {
        const listed: any = await harness([], [artifact(PKG_A)], { type: 'app', applyNavContributions: fold }).getMetaItems({ type: 'app' });
        expect((listed.items as any[]).find((it) => it.name === NAME)?.navigation.map((n: any) => n.id)).toEqual(['contributed']);
        expect('changedAt' in listed).toBe(false);
    });
});
