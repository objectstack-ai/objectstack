// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8798 — `diffMetaItem` awaited a full `historyMetaItem` read and discarded it.
 *
 * The discarded call was marked `const _used = versions; void _used;`, which is
 * why this got a card rather than a tidy-up: a deliberate-looking marker on a
 * value that is not load-bearing is exactly the input that makes the next reader
 * (human or agent) reason confidently from dead code.
 *
 * ## What the deletion had to prove, and what these pins are
 *
 * The one behaviour the dead call could still have been providing is
 * `historyMetaItem`'s EARLY RETURN — it answers `{ events: [] }` for a type that
 * is neither `isOverlayAllowed` nor `isRuntimeCreateAllowed`. A test that only
 * exercised an ordinary type would prove nothing about the deletion, so the
 * fixture below is pinned to a type that genuinely takes that early return.
 *
 * Measured, not inherited (`DEFAULT_METADATA_TYPE_REGISTRY`, both flags false):
 * `field`, `job`, `api`, `capability`, `agent`. `field` is the fixture; `view`
 * is the ordinary-type control.
 *
 * ⛔ `earlyReturnFixtureIsStillEarlyReturn` below is the anti-vacuity arm and is
 * not decoration. If `field` ever gains `allowOrgOverride` or
 * `allowRuntimeCreate`, every other assertion here silently stops covering the
 * early-return case while staying green. That test going red is the signal to
 * re-pick the fixture from the registry, not to delete the assertion.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './index.js';

/** Takes `historyMetaItem`'s early return — neither flag set in the registry. */
const EARLY_RETURN_TYPE = 'field';
/** Passes the same gate — the control that keeps the pins discriminating. */
const ORDINARY_TYPE = 'view';

/**
 * Scalar equality only, and it REFUSES anything else rather than guessing.
 *
 * Both readers here issue flat filters: `diffMetaItem` queries
 * `sys_metadata_history` by `{ organization_id, type, name }`, and
 * `SysMetadataRepository.history` by the same three. No combinator ever arrives.
 *
 * The `throw` is the point (`check:where-matcher`). Treating a `$or` / `$and`
 * key as an ordinary column name is that gate's shape (b): `r.$or` is
 * `undefined`, the comparison fails, the row is silently excluded, and the suite
 * goes green while asserting on a query nobody wrote.
 */
function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k.startsWith('$')) {
            throw new Error(
                `stub engine: WHERE combinator '${k}' is not implemented by this double — `
                + 'it matches scalar equality only. Implement it here rather than letting it '
                + 'be read as a field name.',
            );
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/**
 * Table-aware and READ-COUNTING. The count is the subject of this card: the
 * defect was a second, unused read of `sys_metadata_history` per request, and
 * a value-only assertion cannot see it — both bodies were always correct.
 */
function makeStubEngine(opts: { throwOnHistory?: boolean } = {}) {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_metadata: [],
        sys_metadata_history: [],
    };
    const findCalls: string[] = [];
    const engine: any = {
        async find(table: string, o: { where: Record<string, unknown> }) {
            findCalls.push(table);
            if (opts.throwOnHistory && table === 'sys_metadata_history') {
                throw new Error('history table unavailable (simulated outage)');
            }
            return (tables[table] ?? []).filter((r) => matches(r, o.where));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            return (tables[table] ?? []).find((r) => matches(r, o.where)) ?? null;
        },
        async insert() { return { id: 'stub' }; },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    /** Reads of the history table only — the quantity the card is about. */
    const historyReads = () => findCalls.filter((t) => t === 'sys_metadata_history').length;
    return { engine, tables, findCalls, historyReads };
}

/** Two versions differing in exactly one top-level key, so the diff is unambiguous. */
function seedTwoVersions(
    tables: Record<string, Array<Record<string, unknown>>>,
    type: string,
    name: string,
) {
    const base = { organization_id: null, type, name };
    [{ name, label: 'A' }, { name, label: 'B' }].forEach((body, i) => {
        tables.sys_metadata_history!.push({
            ...base,
            id: `h_${i + 1}`,
            version: i + 1,
            event_seq: i + 1,
            operation_type: i === 0 ? 'create' : 'update',
            metadata: JSON.stringify(body),
            checksum: hashSpec(body),
            recorded_at: new Date(i + 1).toISOString(),
        });
    });
}

/** The diff both types must answer, byte for byte. */
const EXPECTED_DIFF_BODY = {
    added: [],
    removed: [],
    changed: [{ path: 'label', from: 'A', to: 'B' }],
};

describe('#8798 — the early-return gate never reached diffMetaItem`s output', () => {
    it('earlyReturnFixtureIsStillEarlyReturn: `field` short-circuits BEFORE any engine read', async () => {
        // Anti-vacuity. Rows ARE seeded, so an empty answer here can only come
        // from the gate — and zero engine reads proves it returns before I/O
        // rather than reading and finding nothing.
        const { engine, tables, findCalls } = makeStubEngine();
        seedTwoVersions(tables, EARLY_RETURN_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.historyMetaItem({ type: EARLY_RETURN_TYPE, name: 'my_field' });

        expect(res.events).toEqual([]);
        expect(findCalls).toEqual([]);
    });

    it('serves a FULL diff for that same gated-shut type — the gate never gated this path', async () => {
        // The case the dead call notionally covered. `diffMetaItem` reads the
        // history rows through the engine directly and never consults
        // `isOverlayAllowed`, so the type whose history endpoint refuses to
        // answer still gets a complete, correct diff. Identical to what the
        // pre-#8798 code returned.
        const { engine, tables, historyReads } = makeStubEngine();
        seedTwoVersions(tables, EARLY_RETURN_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: EARLY_RETURN_TYPE,
            name: 'my_field',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res).toEqual({
            type: EARLY_RETURN_TYPE,
            name: 'my_field',
            fromVersion: 1,
            toVersion: 2,
            ...EXPECTED_DIFF_BODY,
        });
        expect(historyReads()).toBe(1);
    });

    it('an ordinary type answers the SAME body — so the fixture choice is not doing the work', async () => {
        const { engine, tables } = makeStubEngine();
        seedTwoVersions(tables, ORDINARY_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: ORDINARY_TYPE,
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res).toEqual({
            type: ORDINARY_TYPE,
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
            ...EXPECTED_DIFF_BODY,
        });
    });
});

describe('#8798 — one request, one read of sys_metadata_history', () => {
    it('reads the history table exactly ONCE for a gated-open type', async () => {
        // THE REGRESSION PIN. Red before the deletion (2 reads), green after —
        // and the only assertion in this file that was. A reinstated
        // `historyMetaItem` call makes this 2 again while every value
        // assertion above stays green, which is precisely how the dead read
        // survived unnoticed in the first place.
        const { engine, tables, historyReads } = makeStubEngine();
        seedTwoVersions(tables, ORDINARY_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.diffMetaItem({
            type: ORDINARY_TYPE,
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(historyReads()).toBe(1);
    });
});

describe('#8798 — a history-table outage now answers the same way for every type', () => {
    /**
     * Pre-#8798 this pair DISAGREED, and only by accident: the discarded
     * `historyMetaItem` call was unguarded, so an outage threw for a gated-open
     * type, while a gated-shut type never reached the engine through that call
     * and fell into the `try`/`catch` below it. One outage, two answers, decided
     * by whether the type happened to pass an authorization gate that has
     * nothing to do with reading history.
     *
     * These pins do not endorse swallowing the outage — that `catch` predates
     * this card and is filed as #8833. They pin that the answer no longer
     * depends on the type.
     */
    it('gated-open type falls through to an empty diff instead of throwing', async () => {
        const { engine, tables } = makeStubEngine({ throwOnHistory: true });
        seedTwoVersions(tables, ORDINARY_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: ORDINARY_TYPE,
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res.added).toEqual([]);
        expect(res.removed).toEqual([]);
        expect(res.changed).toEqual([]);
    });

    it('gated-shut type answers identically — unchanged by #8798', async () => {
        const { engine, tables } = makeStubEngine({ throwOnHistory: true });
        seedTwoVersions(tables, EARLY_RETURN_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: EARLY_RETURN_TYPE,
            name: 'my_field',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res.added).toEqual([]);
        expect(res.removed).toEqual([]);
        expect(res.changed).toEqual([]);
    });
});
