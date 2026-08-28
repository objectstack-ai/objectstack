// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12852] `resolveSoleOrganizationId` must not answer a FAILED
 * `sys_organization` read with `undefined`.
 *
 * `undefined` is not a neutral value at this seam. It is the verdict the
 * method's own JSDoc calls "genuinely ambiguous" (zero or several orgs), so
 * `load()` stamps no `organization_id` and every BUSINESS seed row of the run
 * lands org-less — invisible afterwards under strict org-scoping. And nothing
 * says so: `SeedLoadResult` has an `errors` field, and this path never touches
 * it, so a transient outage mid-seed reads to the operator as a clean,
 * successful seed. ADR-0110 D3's exact shape — "the read found no sole
 * organization" and "the read could not run" are different facts.
 *
 * The sibling probe on the objectql side, `ObjectQL.probeInstallOrganizations`,
 * had the SAME shape and was repaired by PR #9817 to bind the parameter and ask
 * the declared predicate. This site was missed by that pass; the repair here is
 * that repair, copied.
 *
 * Only an unprovisioned TABLE is truthful emptiness — precisely the cause the
 * swallowed comment already named — so the JSDoc's "or when `sys_organization`
 * is absent" stays true while every other cause stops being answered as an
 * emptiness.
 *
 * Every expectation below is written against LITERALS — the exact injected
 * error object, its literal message and code, literal row counts and literal
 * stamped ids — never a value re-derived from the code under test. Each failure
 * assertion is paired with a positive control in this same file (the probe
 * SUCCEEDING with one org, with none, and — for the benign branch — proof the
 * injected throw actually fired), so a harness that had stopped exercising the
 * seam could not pass vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. From `@objectstack/metadata-core`, not `@objectstack/objectql` —
// objectql depends on THIS package, so that import would close a dependency
// cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
// `.js` extension deliberately: `moduleResolution: nodenext` requires it, and
// an extensionless specifier is exactly the TS2835 that makes up part of this
// package's frozen TEST_DEBT (#5278). That ledger is shrink-only, so a new file
// may not add to it.
import { SeedLoaderService } from './seed-loader.js';

interface StoreRow extends Record<string, unknown> {
    id: string;
}

/**
 * The fixture's WHERE matcher, flat equality only.
 *
 * A combinator is REFUSED rather than read as a field name: a matcher that
 * treats `$or` as a column answers a combinator query with an empty result set
 * and nothing erroring, which is the silently-wrong shape
 * `pnpm check:where-matcher` exists to keep out. This fixture only ever
 * receives flat equality (`organization_id`, `sku`).
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        return row[k] === v;
    });
}

function createLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * A faithful in-memory engine plus a PER-OBJECT read-failure injector.
 *
 * Per-object, deliberately: the defect is specific to the `sys_organization`
 * probe, so the widget reads must keep succeeding. A blanket read failure would
 * also fail the loader's existing-records pre-load (#8896's already-repaired
 * seam), and every assertion below would then be satisfied by that repair
 * instead of this one.
 *
 * `findCalls` records that a read really ran, which is what turns "the seed
 * proceeded" into "the seed proceeded AND the injected throw fired".
 */
function createEngine() {
    const store: Record<string, StoreRow[]> = {};
    const findCalls: string[] = [];
    const failFor: Record<string, unknown> = {};
    let idCounter = 0;

    const engine = {
        find: vi.fn(async (objectName: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
            findCalls.push(objectName);
            if (objectName in failFor) throw failFor[objectName];
            let records = store[objectName] ?? [];
            if (query?.where) records = records.filter((r) => matchesWhere(r, query.where!));
            if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
            return records;
        }),
        findOne: vi.fn(async (objectName: string, query?: Record<string, unknown>) => {
            assertEngineFindOnePredicate(objectName, query);
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
            // that form.
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
        failReadsOf: (objectName: string, error: unknown) => { failFor[objectName] = error; },
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

const seedOf = (records: Array<Record<string, unknown>>) => [{
    object: 'my_app_widget',
    externalId: 'sku',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records,
}] as never;

/** The real driver phrasings, verbatim. */
const connectionDropped = () =>
    Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
const permissionDenied = () =>
    Object.assign(new Error('permission denied for table sys_organization'), { code: '42501' });
const tableNotProvisioned = () =>
    Object.assign(new Error('SQLITE_ERROR: no such table: sys_organization'), { code: 'SQLITE_ERROR' });

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

const widgets = (store: Record<string, StoreRow[]>) => store.my_app_widget ?? [];

describe('[#12852] seed loader — a sole-organization read that FAILED is not "no sole organization"', () => {
    // ── POSITIVE CONTROLS. Without these, every assertion below could pass on
    //    a harness that no longer consults `resolveSoleOrganizationId` at all.

    it('control: a probe that RUNS and finds exactly one org stamps business rows with it', async () => {
        const { engine, store, findCalls } = createEngine();
        store.sys_organization = [{ id: 'org_solo' }];

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(findCalls).toContain('sys_organization');
        expect(result.summary.totalInserted).toBe(1);
        expect(widgets(store)).toHaveLength(1);
        expect(widgets(store)[0].organization_id).toBe('org_solo');
    });

    it('control: a probe that RUNS and finds NO org leaves the row org-less — the declared ambiguity', async () => {
        const { engine, store, findCalls } = createEngine();

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(findCalls).toContain('sys_organization');
        expect(result.summary.totalInserted).toBe(1);
        expect(widgets(store)[0].organization_id).toBeUndefined();
    });

    it('control: a probe that RUNS and finds SEVERAL orgs leaves the row org-less — the declared ambiguity', async () => {
        const { engine, store } = createEngine();
        store.sys_organization = [{ id: 'org_a' }, { id: 'org_b' }];

        await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(widgets(store)[0].organization_id).toBeUndefined();
    });

    // ── THE FIX — a probe that could not run must surface, not invent "none".

    it('a dropped connection surfaces that error and writes NO org-less rows', async () => {
        const { engine, store, findCalls, failReadsOf } = createEngine();
        // An org that the probe MUST see. Pre-fix the failed read hid it and
        // the seed wrote rows that no member of `org_solo` could ever see.
        store.sys_organization = [{ id: 'org_solo' }];
        const injected = connectionDropped();
        failReadsOf('sys_organization', injected);

        const caught = await rejection(() => new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        }));

        // The caller receives the READ's own failure, envelope intact — this
        // fix mints no new code and no new result field.
        expect(caught).toBe(injected);
        expect(caught.message).toBe('connection terminated unexpectedly');
        expect(caught.code).toBe('ECONNRESET');
        // Proof the probe really ran and really threw.
        expect(findCalls).toContain('sys_organization');
        // …and emphatically NOT the pre-fix outcome: a batch of org-less rows
        // reported as a clean seed.
        expect(widgets(store)).toHaveLength(0);
    });

    it('a permission refusal surfaces the same way', async () => {
        const { engine, store, failReadsOf } = createEngine();
        const injected = permissionDenied();
        failReadsOf('sys_organization', injected);

        const caught = await rejection(() => new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        }));

        expect(caught).toBe(injected);
        expect(caught.code).toBe('42501');
        expect(widgets(store)).toHaveLength(0);
    });

    // ── THE ONE BENIGN CASE — an unprovisioned table can hold no org, so
    //    "no sole organization" IS the truth and the historical
    //    global/cross-tenant NULL is the right answer.

    it('an UNPROVISIONED sys_organization is truthful emptiness: the seed writes its rows org-less', async () => {
        const { engine, store, findCalls, failReadsOf } = createEngine();
        failReadsOf('sys_organization', tableNotProvisioned());

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(result.summary.totalErrored).toBe(0);
        // Proof the benign branch was actually EXERCISED — the probe ran and
        // threw. Without this, the passing insert above would be consistent
        // with a harness that never probes at all.
        expect(findCalls).toContain('sys_organization');
        expect(widgets(store)).toHaveLength(1);
        expect(widgets(store)[0].organization_id).toBeUndefined();
    });

    it('an UNPROVISIONED sys_organization in the postgres phrasing (42P01) is benign too', async () => {
        const { engine, store, findCalls, failReadsOf } = createEngine();
        failReadsOf('sys_organization', Object.assign(
            new Error('relation "sys_organization" does not exist'),
            { code: '42P01' },
        ));

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(findCalls).toContain('sys_organization');
        expect(widgets(store)[0].organization_id).toBeUndefined();
    });

    it('a missing COLUMN on an existing sys_organization stays loud (the superstring case)', async () => {
        const { engine, store, failReadsOf } = createEngine();
        // Postgres phrases this failure as `column "x" of relation "y" does not
        // exist` — which CONTAINS a complete, legal missing-table phrase.
        // `isMissingTableError`'s front-exclusion is what keeps it loud, and
        // this pin is what stops a future hand-rolled message test reading it
        // as benign and silently re-arming the org-less write.
        const injected = Object.assign(
            new Error('column "id" of relation "sys_organization" does not exist'),
            { code: '42703' },
        );
        failReadsOf('sys_organization', injected);

        const caught = await rejection(() => new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: CONFIG,
        }));

        expect(caught).toBe(injected);
        expect(caught.message).toBe('column "id" of relation "sys_organization" does not exist');
        expect(widgets(store)).toHaveLength(0);
    });

    // ── NON-EFFECT — a caller that pinned its own org never asks the probe, so
    //    an unreadable `sys_organization` cannot fail a scoped seed.

    it('a pinned config.organizationId never consults the probe at all', async () => {
        const { engine, store, findCalls, failReadsOf } = createEngine();
        failReadsOf('sys_organization', connectionDropped());

        const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
            seeds: seedOf([{ name: 'Fresh', sku: 'W-A' }]),
            config: { ...(CONFIG as object), organizationId: 'org_pinned' } as never,
        });

        expect(result.summary.totalInserted).toBe(1);
        expect(findCalls).not.toContain('sys_organization');
        expect(widgets(store)[0].organization_id).toBe('org_pinned');
    });
});
