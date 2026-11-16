// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34206, ADR-0156 D7] The compiled metadata answer cache behind the served
// item read (`getMetaItem`). Each invalidation pin is paired with a control on
// the same harness (a degenerate cache passes either half alone), and each
// revocation-shaped pin asserts the changed metadata is IN the next answer,
// not only that an entry went.
//
// The harness is the overlay cache's (`protocol.item-read-overlay-cache.test.ts`)
// grown by the counters this cache reads: a registry with `revision` and
// `objectRevision`, a metadata service with `revision` and
// `loaderChangeMark()`, and an `objectql` service answering the live trailers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
// The served read reaches a dynamic `import('@objectstack/lint')` (metadata diagnostics): pay its load at collection.
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { META_COMPILE_CACHE_TTL_ENV, metaCompileCacheTtlMs } from './meta-compile-cache.js';
import { servedRowChangedAtOf } from './served-row-changed-at.js';

type Row = Record<string, unknown>;

const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`store double: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') {
        const set = (v as { $in?: unknown }).$in;
        if (!Array.isArray(set)) throw new Error(`store double: unsupported operator in ${JSON.stringify(v)}`);
        return set.includes(row[k] ?? null);
    }
    return v === undefined || (row[k] ?? null) === (v ?? null);
});

type Middleware = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;

const storedObject = (label: string, updatedAt = '2026-11-16T00:00:00.000Z'): Row => ({
    id: 'r_widget', type: 'object', name: 'widget', state: 'active', package_id: null,
    updated_at: updatedAt,
    metadata: JSON.stringify({ name: 'widget', label, fields: {}, actions: [{ name: 'approve' }, { name: 'reject' }] }),
});

const storedView = (label: string): Row => ({
    id: 'r_view', type: 'view', name: 'widget_list', state: 'active', package_id: null,
    updated_at: '2026-11-16T00:00:00.000Z',
    metadata: JSON.stringify({ name: 'widget_list', label, object: 'widget' }),
});

interface HarnessOptions {
    /** Omit the registry's `revision` (the cache must decline). */
    registryRevision?: boolean;
    /** The metadata service: `true` (counted, with a loader mark), `'no-revision'`, `'no-mark'`, or `false` (none). */
    metadataService?: true | 'no-revision' | 'no-mark' | false;
}

function harness(rows: Row[], opts: HarnessOptions = {}) {
    const reads: Array<{ op: string; where: Row }> = [];
    let epoch = 0;
    const seam = {
        get current() { return epoch; },
        bump(): number { epoch += 1; return epoch; },
        subscribe(): () => void { return () => {}; },
    };
    const registryCalls: string[] = [];
    const registry: Record<string, unknown> = {
        objectRevision: 0,
        getItem: () => undefined,
        getObject: () => undefined,
        listItems: () => [],
        getPackage: () => undefined,
        getArtifactItem: () => undefined,
        isPackageDisabled: () => false,
        registerItem: () => { registryCalls.push('registerItem'); },
        registerObject: () => { registryCalls.push('registerObject'); },
        applyNavContributions: (app: unknown) => app,
        // ADR-0150 D3: a by-name read of a package-scoped type needs the resolver.
        readsByPackage: () => true,
        resolveItem: (type: string, name: string) => (registry.getItem as (t: string, n: string) => unknown)(type, name),
    };
    if (opts.registryRevision !== false) registry.revision = 0;
    const engine: Record<string, unknown> = {
        registry,
        writeEpoch: seam,
        find: async (table: string, q: { where?: Row; limit?: number; orderBy?: unknown } = {}) => {
            if (table !== 'sys_metadata') return [];
            reads.push({ op: 'find', where: structuredClone(q.where ?? {}) });
            let hits = rows.filter((r) => matches(r, q.where));
            if (q.orderBy !== undefined) hits = [...hits].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
            return typeof q.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where?: Row } = {}) => {
            assertEngineFindOnePredicate(table, q as never);
            if (table !== 'sys_metadata') return null;
            reads.push({ op: 'findOne', where: structuredClone(q.where ?? {}) });
            return rows.find((r) => matches(r, q.where)) ?? null;
        },
        count: async (table: string, q: { where?: Row } = {}) => {
            if (table !== 'sys_metadata') return 0;
            reads.push({ op: 'count', where: structuredClone(q.where ?? {}) });
            return rows.filter((r) => matches(r, q.where)).length;
        },
    };
    const middlewares: Middleware[] = [];
    engine.registerMiddleware = (fn: Middleware) => { middlewares.push(fn); };

    let loaderMark = 'files-1';
    const metadataReads: string[] = [];
    let metadataService: Record<string, unknown> | undefined;
    const kind = opts.metadataService ?? true;
    if (kind !== false) {
        metadataService = {
            getDiagnosed: async (type: string, name: string) => {
                metadataReads.push(`${type}/${name}`);
                return { data: undefined, degraded: false, errors: [] };
            },
        };
        if (kind !== 'no-revision') metadataService.revision = 0;
        if (kind !== 'no-mark') metadataService.loaderChangeMark = async () => loaderMark;
    }
    let disabledActions: string[] = [];
    let disabledActionsReads = 0;
    const objectql = {
        getDisabledActions: () => { disabledActionsReads += 1; return disabledActions; },
        getCascadeDeleteObjects: () => ['widget_line'],
    };
    const services = new Map<string, unknown>([['objectql', objectql]]);
    if (metadataService) services.set('metadata', metadataService);
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services) as any;

    /** A `sys_metadata` write as the engine makes one: the epoch, then the middleware chain around the row. */
    const write = async (apply: () => void, object = 'sys_metadata') => {
        seam.bump();
        const chain = [...middlewares];
        let i = 0;
        const next = async (): Promise<void> => {
            if (i < chain.length) return chain[i++]!({ object, operation: 'update' }, next);
            apply();
        };
        await next();
    };
    const byNameReads = (name: string) => reads.filter((r) => r.where.name === name).length;
    return {
        protocol, engine, registry, services, reads, registryCalls, metadataReads, write, byNameReads,
        get metadataService() { return metadataService; },
        setLoaderMark: (mark: string) => { loaderMark = mark; },
        setDisabledActions: (names: string[]) => { disabledActions = names; },
        get disabledActionsReads() { return disabledActionsReads; },
    };
}

const read = (h: ReturnType<typeof harness>, type = 'object', name = 'widget') =>
    h.protocol.getMetaItem({ type, name });

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('[#34206, ADR-0156] the compiled item answer is cached while every source is unchanged', () => {
    it('⭐ a repeat reads ZERO sources and serves an equal answer', async () => {
        const h = harness([storedObject('Widget')]);
        const first = await read(h);
        const storeReads = h.reads.length;
        const serviceReads = h.metadataReads.length;
        expect(h.byNameReads('widget')).toBeGreaterThan(0);
        const second = await read(h);
        expect(h.reads.length).toBe(storeReads);
        expect(h.metadataReads.length).toBe(serviceReads);
        expect(second).toEqual(first);
        expect(second.item.label).toBe('Widget');
    });

    it('cached ≡ uncached: the hit equals the answer the cache-off read gives, for each cached type', async () => {
        const rows = [storedObject('Widget'), storedView('All widgets')];
        for (const [type, name] of [['object', 'widget'], ['view', 'widget_list']] as const) {
            const cached = harness(rows);
            await read(cached, type, name);
            const hit = await read(cached, type, name);
            vi.stubEnv(META_COMPILE_CACHE_TTL_ENV, '0');
            const uncached = await read(harness(rows), type, name);
            vi.unstubAllEnvs();
            expect(hit).toEqual(uncached);
            expect(servedRowChangedAtOf(hit)).toBe(servedRowChangedAtOf(uncached));
            expect(servedRowChangedAtOf(hit)).toBeDefined();
        }
    });

    it('each call gets its own copy: editing an answer reaches neither the entry nor the next caller', async () => {
        const h = harness([storedObject('Widget')]);
        const first = await read(h);
        first.item.label = 'edited';
        const second = await read(h);
        second.item.fields.injected = { type: 'text' };
        const third = await read(h);
        expect(second.item.label).toBe('Widget');
        expect(third.item.fields.injected).toBeUndefined();
        expect(third).toEqual({ ...first, item: { ...first.item, label: 'Widget' } });
    });

    it('the live trailers are read on every hit, never cached', async () => {
        const h = harness([storedObject('Widget')]);
        const first = await read(h);
        expect(first.disabledActions).toEqual([]);
        expect(first.cascadeDeleteObjects).toEqual(['widget_line']);
        const readsBefore = h.disabledActionsReads;
        h.setDisabledActions(['approve']);
        const second = await read(h);
        expect(h.disabledActionsReads).toBe(readsBefore + 1);
        expect(second.disabledActions).toEqual(['approve']);
        expect(Object.keys(second)).toEqual(Object.keys(first));
    });

    it('a trailer the live read no longer answers is absent from the hit, not served from the entry', async () => {
        const h = harness([storedObject('Widget')]);
        const first = await read(h);
        expect(first.cascadeDeleteObjects).toEqual(['widget_line']);
        // The engine no longer holds the object: its closure answers nothing.
        (h.services.get('objectql') as Record<string, unknown>).getCascadeDeleteObjects = () => undefined;
        const before = h.byNameReads('widget');
        const second = await read(h);
        expect(h.byNameReads('widget')).toBe(before); // non-vacuity: a hit
        expect('cascadeDeleteObjects' in second).toBe(false);
    });

    it('[D4] a hit leaves the registry exactly as a miss does: the served read registers nothing either way', async () => {
        const h = harness([storedObject('Widget')]);
        await read(h);
        const afterMiss = [...h.registryCalls];
        await read(h);
        expect(h.registryCalls).toEqual(afterMiss);
    });

    it('a read the cache does not answer (a package, a draft preview, a state) is read every time', async () => {
        const h = harness([storedObject('Widget')]);
        for (const request of [
            { type: 'object', name: 'widget', packageId: 'com.acme' },
            { type: 'object', name: 'widget', previewDrafts: true },
            { type: 'object', name: 'widget', state: 'active' },
        ]) {
            await h.protocol.getMetaItem(request).catch(() => undefined);
            const before = h.reads.length;
            await h.protocol.getMetaItem(request).catch(() => undefined);
            expect(h.reads.length, JSON.stringify(request)).toBeGreaterThan(before);
        }
    });
});

describe('[#34206, ADR-0156 D7] every source retires the entry, and a change elsewhere does not', () => {
    it('stored rows: a sys_metadata write retires it and the next answer carries the new row', async () => {
        const rows = [storedObject('Widget')];
        const h = harness(rows);
        await read(h);
        await h.write(() => { rows[0] = storedObject('Gadget'); });
        const after = await read(h);
        expect(after.item.label).toBe('Gadget');
    });

    it('control: a write to another object keeps the entry', async () => {
        const rows = [storedObject('Widget')];
        const h = harness(rows);
        await read(h);
        const before = h.reads.length;
        await h.write(() => {}, 'crm_account');
        await read(h);
        expect(h.reads.length).toBe(before);
    });

    it('schema registry: a move of `revision` retires it', async () => {
        const rows = [storedObject('Widget')];
        const h = harness(rows);
        await read(h);
        const before = h.byNameReads('widget');
        (h.registry.revision as number)++;
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('schema registry: a move of `objectRevision` retires it', async () => {
        const h = harness([storedObject('Widget')]);
        await read(h);
        const before = h.byNameReads('widget');
        (h.registry.objectRevision as number)++;
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('schema registry: a registry item change is in the next answer (an app\'s registered body)', async () => {
        const h = harness([]);
        let label = 'Sales';
        h.registry.getItem = (type: string, name: string) =>
            (type === 'app' && name === 'sales' ? { name: 'sales', label, navigation: [] } : undefined);
        const first = await read(h, 'app', 'sales');
        expect(first.item.label).toBe('Sales');
        label = 'Revenue';
        // Unchanged counter: the entry stands (the double changed under the registry's own code).
        expect((await read(h, 'app', 'sales')).item.label).toBe('Sales');
        (h.registry.revision as number)++;
        expect((await read(h, 'app', 'sales')).item.label).toBe('Revenue');
    });

    it('metadata service: a move of its `revision` retires it, and so does another service in its slot', async () => {
        const h = harness([storedObject('Widget')]);
        await read(h);
        let before = h.byNameReads('widget');
        (h.metadataService!.revision as number)++;
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
        before = h.byNameReads('widget');
        h.services.set('metadata', { ...h.metadataService!, getDiagnosed: h.metadataService!.getDiagnosed });
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('control: a repeat with every counter unchanged keeps the entry', async () => {
        const h = harness([storedObject('Widget')]);
        await read(h);
        const before = h.reads.length;
        for (let i = 0; i < 3; i++) await read(h);
        expect(h.reads.length).toBe(before);
    });
});

describe('[#34206, ADR-0156 D2] a source without its counter makes the cache decline', () => {
    for (const [label, opts] of [
        ['a registry without `revision`', { registryRevision: false }],
        ['a metadata service without `revision`', { metadataService: 'no-revision' }],
    ] as const) {
        it(label, async () => {
            const h = harness([storedObject('Widget')], opts as HarnessOptions);
            await read(h);
            const before = h.byNameReads('widget');
            await read(h);
            expect(h.byNameReads('widget')).toBeGreaterThan(before);
        });
    }

    it('an engine without the overlay seam', async () => {
        const h = harness([storedObject('Widget')]);
        delete h.engine.writeEpoch;
        await read(h);
        const before = h.byNameReads('widget');
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('no metadata service at all is no source, and the cache answers', async () => {
        const h = harness([storedObject('Widget')], { metadataService: false });
        await read(h);
        const before = h.reads.length;
        await read(h);
        expect(h.reads.length).toBe(before);
    });
});

describe('[#34206, ADR-0156 D6] `OS_METADATA_COMPILE_CACHE_TTL_MS=0` is the uncached read', () => {
    it('the same reads, in the same order, as an engine the cache declines', async () => {
        const rows = [storedObject('Widget')];
        vi.stubEnv(META_COMPILE_CACHE_TTL_ENV, '0');
        const off = harness(rows);
        await read(off);
        await read(off);
        vi.unstubAllEnvs();
        const declined = harness(rows, { registryRevision: false });
        await read(declined);
        await read(declined);
        expect(off.reads).toEqual(declined.reads);
        expect(off.metadataReads).toEqual(declined.metadataReads);
    });

    it('the knob: unset is the default, a malformed or negative value is off', () => {
        expect(metaCompileCacheTtlMs({})).toBe(30_000);
        expect(metaCompileCacheTtlMs({ [META_COMPILE_CACHE_TTL_ENV]: '5000' })).toBe(5000);
        expect(metaCompileCacheTtlMs({ [META_COMPILE_CACHE_TTL_ENV]: 'soon' })).toBe(0);
        expect(metaCompileCacheTtlMs({ [META_COMPILE_CACHE_TTL_ENV]: '-1' })).toBe(0);
    });
});

describe('[#34206, ADR-0156 D5] at the bound the cache confirms before it recompiles', () => {
    const atBound = () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        return { pass: () => { now += 30_001; } };
    };

    it('nothing moved: the entries stand for another bound, with no recompile', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')]);
        await read(h);
        clock.pass();
        await read(h); // the first bound may drop: the loader mark grows as reads probe
        const before = h.byNameReads('widget');
        clock.pass();
        await read(h);
        expect(h.byNameReads('widget')).toBe(before);
    });

    it('the store moved under another writer (no engine seam saw it): every entry goes, and the next answer carries the row', async () => {
        const clock = atBound();
        const rows = [storedObject('Widget')];
        const h = harness(rows);
        await read(h);
        clock.pass();
        await read(h);
        rows[0] = storedObject('Gadget', '2026-11-16T01:00:00.000Z');
        // Inside the bound the out-of-process write is not seen (ADR-0156 D1 (b)).
        expect((await read(h)).item.label).toBe('Widget');
        clock.pass();
        expect((await read(h)).item.label).toBe('Gadget');
    });

    it('a loader\'s backing store moved (a file under a running process): every entry goes', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')]);
        await read(h);
        clock.pass();
        await read(h);
        const before = h.byNameReads('widget');
        h.setLoaderMark('files-2');
        clock.pass();
        await read(h);
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('an in-process write that lands while the confirmation awaits the store is not hidden by the entry it retires', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')]);
        await read(h);
        clock.pass();
        await read(h);
        // The registry moves while the confirmation's store reading is in flight.
        const count = h.engine.count as (...a: unknown[]) => Promise<number>;
        h.engine.count = async (...a: unknown[]) => {
            h.engine.count = count;
            (h.registry.revision as number)++;
            return count(...a);
        };
        clock.pass();
        const before = h.byNameReads('widget');
        await read(h);
        expect(h.engine.count).toBe(count); // non-vacuity: the confirmation ran and saw the move mid-flight
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('a store outage at the confirmation fails the read as the uncached read does, and never serves the unconfirmed entry', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')]);
        await read(h);
        const count = h.engine.count as (...a: unknown[]) => Promise<number>;
        const outage = new Error('connect ECONNREFUSED 127.0.0.1:5432');
        h.engine.count = async () => { throw outage; };
        clock.pass();
        const failure = await read(h).then(() => undefined, (e: unknown) => e as Error & { cause?: unknown });
        expect(failure).toBeInstanceOf(Error);
        expect(failure?.cause).toBe(outage);
        // The store is back with the reading the entry was last confirmed at:
        // the confirmation now succeeds, and the answer is right.
        h.engine.count = count;
        expect((await read(h)).item.label).toBe('Widget');
    });

    it('a store not provisioned yet at the confirmation: no reading, so the entry is recompiled, not renewed', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')]);
        await read(h);
        h.engine.count = async () => { throw new Error('SQLITE_ERROR: no such table: sys_metadata'); };
        clock.pass();
        const before = h.byNameReads('widget');
        expect((await read(h)).item.label).toBe('Widget');
        expect(h.byNameReads('widget')).toBeGreaterThan(before);
    });

    it('⛔ a source the confirmation cannot observe: nothing is renewed, every bound recompiles', async () => {
        const clock = atBound();
        const h = harness([storedObject('Widget')], { metadataService: 'no-mark' });
        await read(h);
        let before = h.byNameReads('widget');
        await read(h);
        expect(h.byNameReads('widget')).toBe(before); // inside the bound it is still a cache
        for (let i = 0; i < 2; i++) {
            clock.pass();
            before = h.byNameReads('widget');
            await read(h);
            expect(h.byNameReads('widget')).toBeGreaterThan(before);
        }
    });
});
