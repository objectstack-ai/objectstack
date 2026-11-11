// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32366, ADR-0150 D3/D5] The delete heal's baseline read names the package
 * of the row it removed, and a walk that stops is never silent.
 *
 * `deleteMetaItem` ends its repository delete with `restoreArtifactRegistryView`.
 * Its tier 2 reads the MetadataService baseline for the name. The service
 * stores the types of `PACKAGE_SLOTTED_STORE_TYPES` (`action` among them) per
 * `(package, name)`, and refuses a read naming no package of a name two
 * packages hold (#32244). The heal read bare inside a silent outer `catch`, so
 * the reset of package P's row on such a name restored nothing and logged
 * nothing; before #32244 the same read picked the package written last.
 *
 * The service here is a real `MetadataManager` holding two packages' items
 * under one action name, as the artifact door registers them. The registry is
 * a recording double: tier 1 finds no shadow, so the walk reaches tier 2.
 * Each case asserts which tier healed: tier 1 lifted nothing (`shadowLifts`),
 * tier 2 registered (`registered`), tier 3 retired (`retired`).
 *
 * [S1, ADR-0146] A row bound to a package that holds no item of the name, the
 * App's pair row of a declared override of a holder's `action` (an open type),
 * restores the base it overrides, as the bare read did on `main` for a name
 * one package holds. The pair here is the per-package pair `BASE.custom`,
 * installed; the registry holds no composite artifact of the base, which is
 * the reach where tier 1 does not heal first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
// Paid at collection, not inside a case's clock (check:test-source-alias): the
// module under test reaches it dynamically.
import '@objectstack/lint';
import { MetadataManager } from '@objectstack/metadata';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';
/** Alpha's paired customization package (ADR-0146 D3, the per-package pair). */
const ALPHA_PAIR = 'com.acme.alpha.custom';
/** An installed package that holds no item of the name and pairs no holder. */
const OTHER = 'com.acme.other';
const NAME = 'digest';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    package_id: string | null;
    checksum: string;
    metadata: string;
}

/** The overlay row the delete removes, bound to `packageId` (`null`: package-less). */
const overlayRow = (packageId: string | null): Row => ({
    id: `row_action_${NAME}_${packageId ?? 'none'}`,
    type: 'action',
    name: NAME,
    organization_id: null,
    package_id: packageId,
    state: 'active',
    checksum: 'sha256:stored-head',
    metadata: JSON.stringify({ name: NAME, label: 'Stored', type: 'script', target: 'stored_impl' }),
});

/** A package's object-less action item, as the artifact door registers it (the `_packageId` stamp). */
const shipped = (packageId: string, label: string) => ({
    name: NAME, label, type: 'script', target: `${label}_impl`, _packageId: packageId,
});

function makeHarness(opts: {
    rows: Row[];
    holders: ReadonlyArray<readonly [string, string]>;
    shadowThrows?: Error;
    /** Installed package ids besides the holders (a pair, an unrelated package). */
    installed?: readonly string[];
}) {
    const rows = [...opts.rows];
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    for (const [packageId, label] of opts.holders) manager.registerInMemory('action', NAME, shipped(packageId, label));

    const installed = new Set([...opts.holders.map(([id]) => id), ...(opts.installed ?? [])]);
    const registered: Array<{ type: string; item: any }> = [];
    const retired: string[] = [];
    const shadowLifts: boolean[] = [];
    const matches = (row: Row, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => (row as any)[k] === v);
    const registry: any = {
        getObject: () => undefined,
        getItem: () => undefined,
        getArtifactItem: () => undefined,
        listItems: () => [],
        registerItem: (type: string, item: any) => { registered.push({ type, item }); },
        registerObject: () => {},
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        getPackage: (id: string) => (installed.has(id) ? { manifest: { id } } : undefined),
        // No shadow over a packaged artifact: the walk goes on to tier 2.
        removeRuntimeShadow: () => {
            if (opts.shadowThrows) throw opts.shadowThrows;
            shadowLifts.push(false);
            return false;
        },
        removeOverlayEntry: (type: string, name: string) => { retired.push(`${type}|${name}`); return true; },
    };
    const engine: any = {
        async findOne(table: string, query: { where?: Record<string, unknown> } = {}) {
            assertEngineFindOnePredicate(table, query);
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => matches(r, query.where)) ?? null;
        },
        async find(table: string, query: { where?: Record<string, unknown>; limit?: number } = {}) {
            if (table !== 'sys_metadata') return [];
            const hit = rows.filter((r) => matches(r, query.where));
            return typeof query.limit === 'number' ? hit.slice(0, query.limit) : hit;
        },
        async insert(_table: string, data: Record<string, unknown>) { return { id: 'inserted', ...data }; },
        async update(_table: string, data: Record<string, unknown>, options?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, options);
            return { id: null };
        },
        async delete(_table: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const id = (options as any)?.where?.id;
            const at = rows.findIndex((r) => r.id === id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        async syncObjectSchema() { /* no physical storage in this double */ },
        registry,
    };
    // A control-plane kernel: its registry takes stored rows, so tier 2
    // re-registers the baseline it reads.
    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map<string, unknown>([['metadata', manager]]) as any, undefined,
    ) as any;
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    return { protocol, rows, registered, retired, shadowLifts, warned, logged };
}

/** The `[Protocol] … registry heal …` lines the walk logged (at `error`, or — never — at `warn`). */
const healLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
    warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes('registry heal'));

afterEach(() => { vi.restoreAllMocks(); });

describe('[#32366] the delete heal reads the baseline for the removed row\'s package (ADR-0150 D3)', () => {
    it('DELETE of package alpha\'s row on a name two packages hold restores alpha\'s baseline, never beta\'s, and logs nothing', async () => {
        const h = makeHarness({ rows: [overlayRow(ALPHA)], holders: [[ALPHA, 'alpha'], [BETA, 'beta']] });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA });

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        // BASE: `[]` — the bare read was refused inside the silent catch.
        expect(h.registered.map(({ type, item }) => [type, item.label, item._packageId])).toEqual([['action', 'alpha', ALPHA]]);
        expect(h.retired).toEqual([]);
        expect(healLines(h.logged)).toEqual([]);
    });

    it('…and package beta\'s row restores beta\'s', async () => {
        const h = makeHarness({ rows: [overlayRow(BETA)], holders: [[ALPHA, 'alpha'], [BETA, 'beta']] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: BETA });

        expect(h.registered.map(({ item }) => item._packageId)).toEqual([BETA]);
        expect(healLines(h.logged)).toEqual([]);
    });

    it('a package-less row on that name: the bare read is refused, and the heal says so once, naming both holders', async () => {
        const h = makeHarness({ rows: [overlayRow(null)], holders: [[ALPHA, 'alpha'], [BETA, 'beta']] });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME });

        // The delete has committed; the heal does not fail it.
        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        // Neither package's baseline is picked, and the entry is not retired
        // on a read that refused.
        expect(h.registered).toEqual([]);
        expect(h.retired).toEqual([]);
        // BASE: no line at all.
        const lines = healLines(h.logged);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`action '${NAME}'`);
        expect(lines[0]).toContain(ALPHA);
        expect(lines[0]).toContain(BETA);
        // At `error`, never `warn` (the stored rows and the registry disagree).
        expect(healLines(h.warned)).toEqual([]);
    });

    it('CONTROL — a name one package holds heals as it did: the package-less row\'s bare read resolves the one holder', async () => {
        const h = makeHarness({ rows: [overlayRow(null)], holders: [[ALPHA, 'alpha']] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME });

        expect(h.registered.map(({ item }) => [item.label, item._packageId])).toEqual([['alpha', ALPHA]]);
        expect(healLines(h.logged)).toEqual([]);
    });

    it('CONTROL — the one holder\'s own row restores the same baseline', async () => {
        const h = makeHarness({ rows: [overlayRow(ALPHA)], holders: [[ALPHA, 'alpha']] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA });

        expect(h.registered.map(({ item }) => [item.label, item._packageId])).toEqual([['alpha', ALPHA]]);
        expect(healLines(h.logged)).toEqual([]);
    });
});

describe('[#32366] a heal that stops is never silent', () => {
    it('any other throw in the walk is logged once with its message, and the delete still succeeds', async () => {
        const h = makeHarness({
            rows: [overlayRow(ALPHA)],
            holders: [[ALPHA, 'alpha']],
            shadowThrows: new Error('registry exploded'),
        });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA });

        expect(result.success).toBe(true);
        expect(h.registered).toEqual([]);
        const lines = healLines(h.logged);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`action '${NAME}'`);
        expect(lines[0]).toContain('registry exploded');
        expect(healLines(h.warned)).toEqual([]);
    });

    it('[N2] a package the store reads as none is printed as no package, never as a package named \'\' or \'sys_metadata\'', async () => {
        for (const packageId of ['', 'sys_metadata', undefined]) {
            const h = makeHarness({ rows: [], holders: [[ALPHA, 'alpha'], [BETA, 'beta']] });

            await h.protocol.restoreArtifactRegistryView('action', NAME, null, packageId);

            const lines = healLines(h.logged);
            expect(lines, String(packageId)).toHaveLength(1);
            expect(lines[0]).toContain('no package');
            expect(lines[0]).not.toContain('package \'\'');
            expect(lines[0]).not.toContain('package \'sys_metadata\'');
            expect(lines[0]).not.toContain('package \'undefined\'');
            expect(h.registered).toEqual([]);
            vi.restoreAllMocks();
        }
    });
});

describe('[#32366 S1, ADR-0146] a row bound to a package that holds no item of the name', () => {
    const tiers = (h: ReturnType<typeof makeHarness>) => ({
        tier1: h.shadowLifts,
        tier2: h.registered.map(({ item }) => item._packageId),
        tier3: h.retired,
    });

    it('the pair row of a declared override, on a name one package holds: the base\'s baseline is re-registered, by tier 2', async () => {
        const h = makeHarness({ rows: [overlayRow(ALPHA_PAIR)], holders: [[ALPHA, 'alpha']], installed: [ALPHA_PAIR] });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA_PAIR });

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        // Tier 1 ran and lifted nothing; tier 2 healed; tier 3 never ran.
        // At 9bcce232: tier 2 asked the pair, got a settled miss, and tier 3 retired the entry.
        expect(tiers(h)).toEqual({ tier1: [false], tier2: [ALPHA], tier3: [] });
        expect(healLines(h.logged)).toEqual([]);
    });

    it('CONTROL — a row bound to a non-holder that pairs nobody, on a name one package holds: the one holder\'s baseline, as on main', async () => {
        const h = makeHarness({ rows: [overlayRow(OTHER)], holders: [[ALPHA, 'alpha']], installed: [OTHER] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: OTHER });

        expect(tiers(h)).toEqual({ tier1: [false], tier2: [ALPHA], tier3: [] });
        expect(healLines(h.logged)).toEqual([]);
    });

    it('the pair row on a name two packages hold: the BASE it overrides, named by the pair relation, never the other holder', async () => {
        const h = makeHarness({ rows: [overlayRow(ALPHA_PAIR)], holders: [[ALPHA, 'alpha'], [BETA, 'beta']], installed: [ALPHA_PAIR] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA_PAIR });

        expect(tiers(h)).toEqual({ tier1: [false], tier2: [ALPHA], tier3: [] });
        expect(healLines(h.logged)).toEqual([]);
    });

    it('a row of a package that pairs no holder, on a name two packages hold: the refusal stands and is logged, nothing picked or retired', async () => {
        const h = makeHarness({ rows: [overlayRow(OTHER)], holders: [[ALPHA, 'alpha'], [BETA, 'beta']], installed: [OTHER] });

        const result = await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: OTHER });

        expect(result.success).toBe(true);
        expect(tiers(h)).toEqual({ tier1: [false], tier2: [], tier3: [] });
        const lines = healLines(h.logged);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(ALPHA);
        expect(lines[0]).toContain(BETA);
    });

    it('CONTROL — no package holds the name: the row was the item, and tier 3 retires its entry', async () => {
        const h = makeHarness({ rows: [overlayRow(ALPHA_PAIR)], holders: [], installed: [ALPHA, ALPHA_PAIR] });

        await h.protocol.deleteMetaItem({ type: 'action', name: NAME, packageId: ALPHA_PAIR });

        expect(tiers(h)).toEqual({ tier1: [false], tier2: [], tier3: [`action|${NAME}`] });
        expect(healLines(h.logged)).toEqual([]);
    });
});
