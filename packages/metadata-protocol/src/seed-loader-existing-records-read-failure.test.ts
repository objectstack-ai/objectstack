// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8896] `loadExistingRecords` must not answer a FAILED read with an empty
 * `Map`.
 *
 * The map is not a cache — it IS the write decision, in all three of its
 * callers, and "empty" is the answer that means *write these rows*:
 *
 *   1. the upsert/update/ignore pre-load — an unmatched natural key is written
 *      as a NEW row, so a failed read turns every update into an insert;
 *   2. `writeBatchPartial`'s `attempt > 1` recheck — `bulkWrite` is
 *      at-least-once, so a batch may have COMMITTED before its response was
 *      lost (framework#3149). This recheck is the only thing standing between
 *      the retry and a duplicate of every row the first attempt already wrote;
 *   3. `writeOne`'s per-row form of the same recheck, on the degradation path.
 *
 * It sat behind a bare `catch { /* Object may not have records yet *\/ }`, so a
 * connection drop, a timeout, a permission denial or a query error all arrived
 * at those three as "there are no existing rows" — ADR-0110 D3's exact shape,
 * where "the read found nothing" and "the read could not run" have opposite
 * consequences. (The swallowed comment also named a case that cannot reach it:
 * an object that merely has no rows yet answers `find` with `[]`, it does not
 * throw.)
 *
 * The repair is discrimination, not deletion of the `catch`: only an
 * unprovisioned TABLE is truthful emptiness, and everything else propagates.
 *
 * Every expectation below is written against LITERALS — the exact injected
 * error object, its literal message and code, literal row counts, literal
 * summary counters — never a value re-derived from the code under test. And
 * each failure assertion is paired with a positive control in this same file
 * (the read SUCCEEDING and matching, the read SUCCEEDING and not matching, and
 * — for the benign branch — proof that the injected throw actually fired), so a
 * harness that had stopped exercising the seam could not pass vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. From `@objectstack/metadata-core`, not `@objectstack/objectql` —
// objectql depends on THIS package, so that import would close a dependency
// cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SeedLoaderService } from './seed-loader';

interface StoreRow extends Record<string, unknown> {
    id: string;
}

function createLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * A faithful in-memory engine plus a read-failure injector.
 *
 * `failFind` makes every `find` throw exactly that value — the object identity
 * is what the assertions check, so nothing has to guess how the loader might
 * re-wrap a driver error. `findCalls` records that the read really ran, which
 * is what turns "the seed proceeded" into "the seed proceeded AND the injected
 * throw fired".
 */
function createEngine() {
    const store: Record<string, StoreRow[]> = {};
    const findCalls: string[] = [];
    let failFind: unknown = null;
    let idCounter = 0;

    const engine = {
        find: vi.fn(async (objectName: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
            findCalls.push(objectName);
            if (failFind !== null) throw failFind;
            let records = store[objectName] ?? [];
            if (query?.where) {
                const where = query.where;
                records = records.filter((r) => Object.entries(where).every(([k, v]) => {
                    // REFUSE rather than guess: a combinator read as a field
                    // name is a silently-wrong matcher, and this fixture only
                    // ever receives flat equality (`organization_id`). Same
                    // convention as `seed-loader-retry.test.ts`.
                    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                    return r[k] === v;
                }));
            }
            if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
            return records;
        }),
        findOne: vi.fn(async (objectName: string, query?: Record<string, unknown>) => {
            const rows = await (engine.find as unknown as (o: string, q: unknown) => Promise<StoreRow[]>)(
                objectName, { ...query, limit: 1 },
            );
            return rows[0] ?? null;
        }),
        insert: vi.fn(async (objectName: string, data: Record<string, unknown> | Record<string, unknown>[]) => {
            store[objectName] ??= [];
            if (Array.isArray(data)) {
                const records = data.map((d) => ({ ...d, id: `gen-${++idCounter}` }) as StoreRow);
                store[objectName].push(...records);
                return records;
            }
            const record = { ...data, id: `gen-${++idCounter}` } as StoreRow;
            store[objectName].push(record);
            return record;
        }),
        update: vi.fn(async (objectName: string, data: Record<string, unknown>) => {
            // The seed loader dispatches an update by the id carried IN `data`
            // (no `where`), so the producer's own decision is asked in exactly
            // that form — same call as `seed-loader-retry.test.ts`.
            assertEngineUpdateDispatch(data, undefined);
            const records = store[objectName] ?? [];
            const idx = records.findIndex((r) => r.id === data.id);
            if (idx >= 0) {
                records[idx] = { ...records[idx], ...data } as StoreRow;
                return records[idx];
            }
            return data;
        }),
        delete: vi.fn(async (_objectName: string, options?: { where?: Record<string, unknown> }) => {
            assertEngineDeleteDispatch(options);
            return { deleted: 1 };
        }),
        count: vi.fn(async (objectName: string) => (store[objectName] ?? []).length),
        aggregate: vi.fn(async () => []),
    } as unknown as IDataEngine;

    return {
        engine,
        store,
        findCalls,
        failReadsWith: (error: unknown) => { failFind = error; },
        stopFailingReads: () => { failFind = null; },
    };
}

const WIDGET = {
    name: 'my_app_widget',
    fields: {
        name: { type: 'text' },
        sku: { type: 'text' },
    },
};

function createMetadata(): IMetadataService {
    return {
        getObject: vi.fn(async () => WIDGET),
        listObjects: vi.fn(async () => [WIDGET]),
        register: vi.fn(async () => {}),
        get: vi.fn(async () => WIDGET),
        list: vi.fn(async () => []),
        unregister: vi.fn(async () => {}),
        exists: vi.fn(async () => false),
        listNames: vi.fn(async () => []),
    } as unknown as IMetadataService;
}

const CONFIG = {
    dryRun: false,
    haltOnError: false,
    multiPass: true,
    defaultMode: 'insert',
    batchSize: 1000,
    transaction: false,
} as never;

const seedOf = (mode: string, records: Array<Record<string, unknown>>) => [{
    object: 'my_app_widget',
    externalId: 'sku',
    mode,
    env: ['prod', 'dev', 'test'],
    records,
}] as never;

/** The real driver phrasings, verbatim. */
const connectionDropped = () =>
    Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
const tableNotProvisioned = () =>
    Object.assign(new Error('SQLITE_ERROR: no such table: my_app_widget'), { code: 'SQLITE_ERROR' });

/** Capture a rejection without letting a resolve pass silently. */
async function rejection(run: () => Promise<unknown>): Promise<{ code?: string; message?: string } & Record<string, unknown>> {
    let caught: unknown;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a rejection, but the load resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught as { code?: string; message?: string } & Record<string, unknown>;
}

const rowsWithSku = (store: Record<string, StoreRow[]>, sku: string) =>
    (store.my_app_widget ?? []).filter((r) => r.sku === sku);

describe('[#8896] seed loader — an existing-records read that FAILED is not "no existing rows"', () => {
    // ── POSITIVE CONTROLS. Without these, every assertion below could pass on
    //    a harness that no longer consults `loadExistingRecords` at all.

    it('control: a read that RUNS and matches updates the row in place — no insert', async () => {
        const { engine, store } = createEngine();
        store.my_app_widget = [{ id: 'gen-0', name: 'Existing', sku: 'W-A' }];

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('upsert', [{ name: 'Updated', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalUpdated).toBe(1);
        expect(result.summary.totalInserted).toBe(0);
        expect(result.summary.totalErrored).toBe(0);
        expect(rowsWithSku(store, 'W-A')).toHaveLength(1);
        expect(store.my_app_widget[0].name).toBe('Updated');
    });

    it('control: a read that RUNS and matches nothing inserts the row', async () => {
        const { engine, store } = createEngine();

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('upsert', [{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(result.summary.totalUpdated).toBe(0);
        expect(rowsWithSku(store, 'W-A')).toHaveLength(1);
    });

    // ── THE FIX — a read that could not run must surface, not invent "none".

    it('an upsert pre-load that fails surfaces that error and writes nothing', async () => {
        const { engine, store } = createEngine();
        // A row that the upsert MUST match. Pre-fix the failed read hid it and
        // the seed inserted a second row carrying the same natural key.
        store.my_app_widget = [{ id: 'gen-0', name: 'Existing', sku: 'W-A' }];

        const injected = connectionDropped();
        const loader = new SeedLoaderService(engine, createMetadata(), createLogger());
        (engine.find as unknown as { mockImplementation: (f: () => Promise<never>) => void })
            .mockImplementation(async () => { throw injected; });

        const caught = await rejection(() => loader.load({
            seeds: seedOf('upsert', [{ name: 'Updated', sku: 'W-A' }]),
            config: CONFIG,
        }));

        // The caller receives the READ's own failure, envelope intact — this
        // fix mints no new code and no new result field.
        expect(caught).toBe(injected);
        expect(caught.message).toBe('connection terminated unexpectedly');
        expect(caught.code).toBe('ECONNRESET');
        // …and emphatically NOT the pre-fix outcome: a second row under the
        // same natural key, reported as a clean insert.
        expect(rowsWithSku(store, 'W-A')).toHaveLength(1);
        expect(store.my_app_widget[0].name).toBe('Existing');
    });

    it('the at-least-once RETRY recheck no longer duplicates every committed row (framework#3149)', async () => {
        const { engine, store, findCalls, failReadsWith } = createEngine();

        // turso's commit-then-lost-response shape: the array insert lands both
        // rows and THEN throws, so `bulkWrite` retries. The retry's recheck —
        // `loadExistingRecords` — is the only thing that keeps it from writing
        // both rows a second time, and here that recheck cannot be performed.
        const realInsert = (engine.insert as unknown as { getMockImplementation: () => (...a: unknown[]) => Promise<unknown> })
            .getMockImplementation();
        let arrayInsertCalls = 0;
        (engine.insert as unknown as { mockImplementation: (f: (o: string, d: unknown, x: unknown) => Promise<unknown>) => void })
            .mockImplementation(async (objectName: string, data: unknown, opts: unknown) => {
                if (objectName === 'my_app_widget' && Array.isArray(data)) {
                    arrayInsertCalls += 1;
                    if (arrayInsertCalls === 1) {
                        await realInsert(objectName, data, opts); // the commit lands
                        failReadsWith(connectionDropped());       // …the recheck cannot run
                        throw new Error('fetch failed');          // …and the response is lost
                    }
                }
                return realInsert(objectName, data, opts);
            });

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('insert', [{ name: 'A', sku: 'W-A' }, { name: 'B', sku: 'W-B' }]),
            config: CONFIG,
        });

        // Proof the recheck really was attempted and really threw — without
        // this the row counts below would also be satisfied by a harness that
        // never rechecks.
        expect(findCalls.length).toBeGreaterThan(0);
        // The rows the FIRST attempt committed, exactly once each. Pre-fix the
        // empty map made the retry re-insert both, and the load reported four
        // rows as two clean inserts.
        expect(rowsWithSku(store, 'W-A')).toHaveLength(1);
        expect(rowsWithSku(store, 'W-B')).toHaveLength(1);
        expect(store.my_app_widget).toHaveLength(2);
        // The seed's EXISTING error accounting carries the failure — the fix
        // adds no new result field.
        expect(result.summary.totalErrored).toBe(2);
        expect(result.summary.totalInserted).toBe(0);
    });

    // ── THE ONE BENIGN CASE — an unprovisioned table can hold no rows, so an
    //    empty map is the truth and every caller's "write it" verdict is right.

    it('an UNPROVISIONED table is truthful emptiness: the seed writes its rows', async () => {
        const { engine, store, findCalls, failReadsWith } = createEngine();
        failReadsWith(tableNotProvisioned());

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('upsert', [{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(result.summary.totalErrored).toBe(0);
        // Proof the benign branch was actually EXERCISED — the read ran and
        // threw. Without this, the passing insert above would be consistent
        // with a harness that never pre-loads at all.
        expect(findCalls).toContain('my_app_widget');
        expect(rowsWithSku(store, 'W-A')).toHaveLength(1);
    });

    it('an UNPROVISIONED table in the postgres phrasing (42P01) is benign too', async () => {
        const { engine, findCalls, failReadsWith } = createEngine();
        failReadsWith(Object.assign(
            new Error('relation "my_app_widget" does not exist'),
            { code: '42P01' },
        ));

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('upsert', [{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(findCalls).toContain('my_app_widget');
    });

    it('a missing COLUMN on an existing table stays loud (the superstring case)', async () => {
        const { engine } = createEngine();
        // Postgres phrases this failure as `column "x" of relation "y" does not
        // exist` — which CONTAINS a complete, legal missing-table phrase.
        // `isMissingTableError`'s front-exclusion is what keeps it loud, and
        // this pin is what stops a future hand-rolled code test reading it as
        // benign and silently re-arming the duplicate-row outcome.
        const injected = Object.assign(
            new Error('column "sku" of relation "my_app_widget" does not exist'),
            { code: '42703' },
        );
        (engine.find as unknown as { mockImplementation: (f: () => Promise<never>) => void })
            .mockImplementation(async () => { throw injected; });

        const caught = await rejection(() => new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf('upsert', [{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        }));

        expect(caught).toBe(injected);
        expect(caught.message).toBe('column "sku" of relation "my_app_widget" does not exist');
    });
});
