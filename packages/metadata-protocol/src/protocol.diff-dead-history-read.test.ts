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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
            assertEngineFindOnePredicate(table, o);
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
     * ## [#8833] What these two pins assert now, and why they changed
     *
     * They used to assert that BOTH types fall through to an EMPTY DIFF, with a
     * note saying they did not endorse swallowing the outage because that was
     * #8833's question. #8833 has since been ruled (maintainer, 2026-08-15,
     * comment 5302933802): the swallow was the defect, and a non-benign read
     * failure now propagates a 503 through
     * `rethrowUnlessMetadataStoreUnprovisioned`.
     *
     * So the ASSERTED VALUE moved while this describe block's SUBJECT did not.
     * The subject was never "an outage is empty" — it is "one outage, one
     * answer, not an answer decided by the type", and that is what both arms
     * still pin. `makeStubEngine`'s `throwOnHistory` throws a generic
     * `Error('history table unavailable (simulated outage)')`, which
     * `isMissingTableError` does NOT classify as benign, so it is a genuine
     * outage under the new rule. The benign case (a table that was never
     * provisioned) has its own positive control next door, in
     * `protocol.diff-canonical-type-and-history-outage.test.ts`.
     */
    it('gated-open type propagates the outage as a 503 instead of an empty diff', async () => {
        const { engine, tables } = makeStubEngine({ throwOnHistory: true });
        seedTwoVersions(tables, ORDINARY_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err: any = await protocol
            .diffMetaItem({ type: ORDINARY_TYPE, name: 'grid', fromVersion: 1, toVersion: 2 })
            .then(() => null, (e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
    });

    it('gated-shut type answers identically — the answer still does not depend on the type', async () => {
        const { engine, tables } = makeStubEngine({ throwOnHistory: true });
        seedTwoVersions(tables, EARLY_RETURN_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err: any = await protocol
            .diffMetaItem({ type: EARLY_RETURN_TYPE, name: 'my_field', fromVersion: 1, toVersion: 2 })
            .then(() => null, (e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
    });
});

type Seed = { version: number; op: string; body: Record<string, unknown> | null };
/**
 * History rows in version order, plus the active and draft rows they left
 * behind. Shared by the #20397 and #20451 blocks below, both about the
 * DEFAULT range; the REST file names the real writes each lineage mirrors.
 */
function seedLineage(
    tables: Record<string, Array<Record<string, unknown>>>,
    type: string,
    name: string,
    history: Seed[],
    rows: { active?: Seed; draft?: Seed },
) {
    const base = { organization_id: null, type, name };
    history.forEach((h, i) => {
        tables.sys_metadata_history!.push({
            ...base,
            id: `h_${h.version}`,
            version: h.version,
            event_seq: i + 1,
            operation_type: h.op,
            metadata: h.body == null ? null : JSON.stringify(h.body),
            checksum: h.body == null ? null : hashSpec(h.body),
            recorded_at: new Date(i + 1).toISOString(),
        });
    });
    for (const state of ['active', 'draft'] as const) {
        const row = rows[state];
        if (!row) continue;
        tables.sys_metadata!.push({
            ...base,
            id: `m_${state}`,
            state,
            version: row.version,
            metadata: JSON.stringify(row.body),
            checksum: hashSpec(row.body!),
        });
    }
}

/**
 * [#20397] The DEFAULT range (no `toVersion`) labels its to side with the
 * version whose body it compares.
 *
 * The to-side body is the active `sys_metadata` row; the label used to be the
 * newest `sys_metadata_history` row's version, which is a draft save whenever a
 * draft is pending (every draft save appends a history row). The label is now
 * the active row's own `version` column, the one `SysMetadataRepository.put`
 * stamps with the version of the history row it appends in the same
 * transaction. Pinned here over seeded rows, beside this file's double, which
 * already honours the `where` on both tables; the same readings through the
 * real REST stack are `packages/rest/src/meta-diff-default-range-labels.test.ts`.
 */
describe('#20397 — the default range labels the to side with the active row\'s own version', () => {
    for (const type of [ORDINARY_TYPE, 'app']) {
        it(`${type}: with a draft pending, toVersion is the active row's version and the answer is the explicit range's`, async () => {
            const { engine, tables } = makeStubEngine();
            const one = { name: 'item', label: 'One' };
            const two = { name: 'item', label: 'Two' };
            const pending = { name: 'item', label: 'Pending draft' };
            seedLineage(tables, type, 'item', [
                { version: 1, op: 'create', body: one },
                { version: 2, op: 'update', body: two },
                { version: 3, op: 'create', body: pending },
            ], { active: { version: 2, op: 'update', body: two }, draft: { version: 3, op: 'create', body: pending } });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res: any = await protocol.diffMetaItem({ type, name: 'item' });
            const explicit: any = await protocol.diffMetaItem({ type, name: 'item', fromVersion: 1, toVersion: 2 });

            expect(res).toEqual({
                type,
                name: 'item',
                fromVersion: 1,
                toVersion: 2,
                added: [],
                removed: [],
                changed: [{ path: 'label', from: 'One', to: 'Two' }],
            });
            expect(res).toEqual(explicit);
        });
    }

    it('the card\'s app reading: one active save and two draft saves label the to side 1 (was 3), with no from side before it', async () => {
        const { engine, tables } = makeStubEngine();
        const v1 = { name: 'atlas', label: 'Atlas v1' };
        const d2 = { name: 'atlas', label: 'Atlas v2 draft' };
        const d3 = { name: 'atlas', label: 'Atlas v3 draft' };
        seedLineage(tables, 'app', 'atlas', [
            { version: 1, op: 'create', body: v1 },
            { version: 2, op: 'create', body: d2 },
            { version: 3, op: 'update', body: d3 },
        ], { active: { version: 1, op: 'create', body: v1 }, draft: { version: 3, op: 'update', body: d3 } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: 'app', name: 'atlas' });

        expect(res).toEqual({
            type: 'app',
            name: 'atlas',
            fromVersion: null,
            toVersion: 1,
            added: [{ path: 'name', value: 'atlas' }, { path: 'label', value: 'Atlas v1' }],
            removed: [],
            changed: [],
        });
    });

    it('no active row (draft saves only): the to side is absent, so its label is null and no draft body is either side', async () => {
        const { engine, tables } = makeStubEngine();
        const d1 = { name: 'item', label: 'Only draft one' };
        const d2 = { name: 'item', label: 'Only draft two' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: d1 },
            { version: 2, op: 'update', body: d2 },
        ], { draft: { version: 2, op: 'update', body: d2 } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: null, toVersion: null, added: [], removed: [], changed: [],
        });
    });

    it('no active row (deleted): the default range answers null on both sides; the deletion stays readable by naming its versions', async () => {
        // The same rule as the draft-only case: the to side is absent, so is
        // its label. Before #20397 this one case happened to agree (the newest
        // history row was the tombstone, whose body is also absent); the
        // deletion itself is still one explicit range away.
        const { engine, tables } = makeStubEngine();
        const one = { name: 'item', label: 'One' };
        const two = { name: 'item', label: 'Two' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: one },
            { version: 2, op: 'update', body: two },
            { version: 3, op: 'delete', body: null },
        ], {});
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });
        const deletion: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item', fromVersion: 2, toVersion: 3 });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: null, toVersion: null, added: [], removed: [], changed: [],
        });
        expect(deletion).toEqual({
            type: ORDINARY_TYPE,
            name: 'item',
            fromVersion: 2,
            toVersion: 3,
            added: [],
            removed: [{ path: 'name', value: 'item' }, { path: 'label', value: 'Two' }],
            changed: [],
        });
    });
});

/**
 * [#20451] With no `fromVersion`, the from side is the NEAREST EARLIER history
 * row whose body DIFFERS from the to side's, by the diff's own equality:
 * `diffShallow`'s three buckets all empty means equal, and a body-less row (a
 * delete's tombstone) compares as `{}` — so the walk stops on it.
 *
 * A draft save appends a history row and a publish appends the promoted body
 * again as the next one, so the row immediately before a published version
 * repeats its body. The old rule (the row immediately before) answered "no
 * changes" right after every publish. The lineages below are the ones the REST
 * pins in `packages/rest/src/meta-diff-default-range-labels.test.ts` write
 * through the real routes; here they are seeded, beside this file's
 * read-counting double.
 */
describe('#20451 — the default from side is the nearest earlier row whose body differs from the to side\'s', () => {
    const everythingAdded = (body: Record<string, unknown>) =>
        Object.entries(body).map(([path, value]) => ({ path, value }));

    it('v1 active, a v2 draft save, a v3 publish: 1 → 3, the change the publish carried, in ONE history read', async () => {
        const { engine, tables, historyReads } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const b = { name: 'item', label: 'B' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'create', body: b },
            { version: 3, op: 'publish', body: b },
        ], { active: { version: 3, op: 'publish', body: b } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(historyReads()).toBe(1);
        expect(res).toEqual({
            type: ORDINARY_TYPE,
            name: 'item',
            fromVersion: 1,
            toVersion: 3,
            added: [],
            removed: [],
            changed: [{ path: 'label', from: 'A', to: 'B' }],
        });
        expect(res).toEqual(await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item', fromVersion: 1, toVersion: 3 }));
    });

    it('the same lineage with a v4 draft pending still answers 1 → 3: the draft is neither side', async () => {
        const { engine, tables } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const b = { name: 'item', label: 'B' };
        const c = { name: 'item', label: 'C pending' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'create', body: b },
            { version: 3, op: 'publish', body: b },
            { version: 4, op: 'create', body: c },
        ], { active: { version: 3, op: 'publish', body: b }, draft: { version: 4, op: 'create', body: c } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(res.fromVersion).toBe(1);
        expect(res.toVersion).toBe(3);
        expect(res.changed).toEqual([{ path: 'label', from: 'A', to: 'B' }]);
        expect(JSON.stringify(res)).not.toContain('C pending');
    });

    it('an explicit range names exactly its versions: 2 → 3 over that lineage is still "no changes"', async () => {
        const { engine, tables } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const b = { name: 'item', label: 'B' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'create', body: b },
            { version: 3, op: 'publish', body: b },
        ], { active: { version: 3, op: 'publish', body: b } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item', fromVersion: 2, toVersion: 3 });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: 2, toVersion: 3, added: [], removed: [], changed: [],
        });
    });

    it('an explicit `toVersion` alone keeps its version, and the from side walks back from ITS body', async () => {
        const { engine, tables } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const b = { name: 'item', label: 'B' };
        const c = { name: 'item', label: 'C' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'create', body: b },
            { version: 3, op: 'publish', body: b },
            { version: 4, op: 'update', body: c },
        ], { active: { version: 4, op: 'update', body: c } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item', toVersion: 3 });

        expect(res.fromVersion).toBe(1);
        expect(res.toVersion).toBe(3);
        expect(res.changed).toEqual([{ path: 'label', from: 'A', to: 'B' }]);
    });

    it('create, delete, draft save, publish: 2 → 4, everything added — the body-less delete row differs, so the walk stops on it', async () => {
        const { engine, tables } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const a2 = { name: 'item', label: 'A2', columns: ['name'] };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'delete', body: null },
            { version: 3, op: 'create', body: a2 },
            { version: 4, op: 'publish', body: a2 },
        ], { active: { version: 4, op: 'publish', body: a2 } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(res).toEqual({
            type: ORDINARY_TYPE,
            name: 'item',
            fromVersion: 2,
            toVersion: 4,
            added: everythingAdded(a2),
            removed: [],
            changed: [],
        });
    });

    it('create, delete, active recreate: 2 → 3, everything added — the answer the immediately-previous rule gave', async () => {
        const { engine, tables } = makeStubEngine();
        const a = { name: 'item', label: 'A' };
        const b = { name: 'item', label: 'B' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: a },
            { version: 2, op: 'delete', body: null },
            { version: 3, op: 'create', body: b },
        ], { active: { version: 3, op: 'create', body: b } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });
        // Naming the tombstone as the to side: an absent body is `{}` there
        // too, so the walk passes nothing and lands on v1, as it always did.
        const deletion: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item', toVersion: 2 });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: 2, toVersion: 3, added: everythingAdded(b), removed: [], changed: [],
        });
        expect(deletion).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: 1, toVersion: 2, added: [], removed: everythingAdded(a), changed: [],
        });
    });

    it('a brand-new item draft-saved then published: null → 2, everything added — no earlier row differs', async () => {
        const { engine, tables } = makeStubEngine();
        const n = { name: 'item', label: 'New' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: n },
            { version: 2, op: 'publish', body: n },
        ], { active: { version: 2, op: 'publish', body: n } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: null, toVersion: 2, added: everythingAdded(n), removed: [], changed: [],
        });
    });

    it('a single version: null → 1, everything added', async () => {
        const { engine, tables } = makeStubEngine();
        const only = { name: 'item', label: 'Only' };
        seedLineage(tables, ORDINARY_TYPE, 'item', [
            { version: 1, op: 'create', body: only },
        ], { active: { version: 1, op: 'create', body: only } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: ORDINARY_TYPE, name: 'item' });

        expect(res).toEqual({
            type: ORDINARY_TYPE, name: 'item', fromVersion: null, toVersion: 1, added: everythingAdded(only), removed: [], changed: [],
        });
    });

    it('the walk compares RAW bodies: a credential-only rotation stops it, and the served values stay redacted', async () => {
        // The #8671 ruling (diff raw, redact what is emitted) applies to the
        // walk's comparison too. Compared redacted, the two bodies below are
        // equal and the walk would pass the rotation by.
        const { engine, tables } = makeStubEngine();
        const config = (password: string) => ({ host: 'db.internal', username: 'reporting', password });
        const old = { name: 'warehouse', label: 'Warehouse', driver: 'postgres', config: config('hunter2-old') };
        const rotated = { name: 'warehouse', label: 'Warehouse', driver: 'postgres', config: config('hunter3-new') };
        seedLineage(tables, 'datasource', 'warehouse', [
            { version: 1, op: 'create', body: old },
            { version: 2, op: 'create', body: rotated },
            { version: 3, op: 'publish', body: rotated },
        ], { active: { version: 3, op: 'publish', body: rotated } });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: 'datasource', name: 'warehouse' });

        expect(res.fromVersion).toBe(1);
        expect(res.toVersion).toBe(3);
        expect(res.changed.map((e: { path: string }) => e.path)).toEqual(['config']);
        expect(JSON.stringify(res)).not.toContain('hunter2-old');
        expect(JSON.stringify(res)).not.toContain('hunter3-new');
    });
});
