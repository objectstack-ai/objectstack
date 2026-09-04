// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 items 1 and 2 — the two plural reads that disagreed, made to agree.
 *
 * ---------------------------------------------------------------------------
 * The defects
 * ---------------------------------------------------------------------------
 * 1. **`listNames` had no per-loader `try`/`catch`** while its two siblings
 *    (`list()` via `admitLoaderItems`, and `loadMany`) have carried one since
 *    #5108. One storage outage therefore produced two different facts
 *    depending only on which method a caller happened to call: `loadMany`
 *    answered a short-but-successful set, `listNames` threw. A caller reading
 *    both — the ADR-0110 D5 action-governance audit is one — had no way to see
 *    that one loader fault was behind both.
 *
 * 2. **There was no keyed plural read on the manager at all.** `loadMany`
 *    returns bodies, so every consumer keys them by `body.name` — a guess that
 *    is right for most items and drops the rest ENTIRELY. #14205 ruled that
 *    identity is the key the STORE holds an item under, and taught the
 *    LOADERS to answer with it (`MetadataLoader.loadManyKeyed`), but the
 *    manager exposed that only inside `list()`, which throws the key away
 *    again. `loadManyKeyed()` is the missing public read.
 *
 * ---------------------------------------------------------------------------
 * Why the failures here are REAL and not stubbed
 * ---------------------------------------------------------------------------
 * Every case runs a real `MetadataManager` over a real `DatabaseLoader` over a
 * driver double, or over a real `MemoryLoader`. The outage cases come from a
 * driver whose `find()` throws `ECONNREFUSED`, so the `catch` under test is
 * the thing being exercised rather than a verdict handed in. The one
 * hand-written loader is the shape the fix exists for — `RemoteLoader`'s: a
 * loader that serves bodies and cannot produce store keys, so it has no
 * `loadManyKeyed` to delegate to.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, in two independent halves, and the halves must go red
 * SEPARATELY — the whole point of item 1 is that it is a defect in
 * `listNames` independent of any consumer:
 *
 *  - reverting item 1 (delete `listNames`' `try`/`catch`) reds every case in
 *    "`listNames` — one loader's fault is not the whole enumeration's" that
 *    involves a broken loader, and NOTHING in the `loadManyKeyed` block;
 *  - reverting item 2 (delete `MetadataManager.loadManyKeyed`) reds every case
 *    in the `loadManyKeyed` block and nothing in the `listNames` block.
 *
 * The measured outcome is recorded in the PR body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { MemoryLoader } from './loaders/memory-loader.js';
import type { MetadataLoader } from './loaders/loader-interface.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
};

vi.mock('@objectstack/core', async (orig) => ({
    ...((await orig()) as object),
    createLogger: () => logger,
}));

const TYPE = 'action';

/** The one-row fixture the outage cases share. */
const rowsFromDb = () => [row('from_db', { name: 'from_db' })];

/** A `sys_metadata` row: identity in the `name` COLUMN, body in `metadata`. */
function row(name: string, body: Record<string, unknown>) {
    return {
        id: `md_${name}`,
        name,
        type: TYPE,
        namespace: 'default',
        scope: 'platform',
        state: 'active',
        version: 1,
        metadata: JSON.stringify(body),
    };
}

const CONNECT_REFUSED = () =>
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });

/**
 * A `sys_metadata`-shaped read-only driver over a fixed row array, counting
 * the verbs it served.
 *
 * The WHERE matcher REFUSES what it does not implement rather than reading a
 * combinator as a field name — `check:where-matcher-conformance`'s conforming
 * shape: `{ $or: [...] }` must not silently match nothing. `find` applies the
 * caller's `limit` by PRESENCE, after the filter, per
 * `check:objectql-double-limit`.
 *
 * ⛔ It carries NO failure switch, and that is a gate's requirement rather
 * than taste: an injected fail-here hook makes this double undrivable by
 * `check:objectql-double-limit`'s control probe — the probe stubs the hook,
 * the double throws, and the candidate files as UNJUDGED debt instead of being
 * graded. Measured on this very file, on the first run of that gate. The
 * outage lives in {@link findDownStore} instead, a separate double that
 * overrides only `find`.
 */
function countingStore(rows: Array<Record<string, unknown>>) {
    const calls = { find: 0, findOne: 0, count: 0 };
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`countingStore: unsupported WHERE combinator '${k}'`);
            if (v !== null && typeof v === 'object') throw new Error(`countingStore: unsupported WHERE operator on '${k}'`);
            return r[k] === v;
        });
    const driver = {
        name: 'counting',
        version: '1.0.0',
        supports: {},
        connect: async (): Promise<void> => {},
        disconnect: async (): Promise<void> => {},
        syncSchema: async (): Promise<void> => {},
        async find(_table: string, q: any) {
            calls.find += 1;
            const hits = rows.filter((r) => matches(r, q?.where ?? {}));
            return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        async findOne(_table: string, q: any) {
            calls.findOne += 1;
            return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
        },
        async count(_table: string, q: any) {
            calls.count += 1;
            return rows.filter((r) => matches(r, q?.where ?? {})).length;
        },
    } as unknown as IDataDriver;
    return { driver, calls };
}

/**
 * The same store with its LIST read down — a separate double rather than a
 * flag on {@link countingStore}, for the reason stated there. Overriding
 * `find` on the base leaves `findOne` reading the base's implementation, which
 * is exactly what these cases need: the plural read out, the by-name read
 * served.
 */
function findDownStore(rows: Array<Record<string, unknown>>) {
    const base = countingStore(rows);
    const driver = {
        ...(base.driver as unknown as Record<string, unknown>),
        async find() { throw CONNECT_REFUSED(); },
    } as unknown as IDataDriver;
    return { driver, calls: base.calls };
}

type Store = { driver: IDataDriver; calls: { find: number; findOne: number; count: number } };

/** A real `MetadataManager` over a real `DatabaseLoader` over `rows`. */
function planeOver(rows: Array<Record<string, unknown>>, store: Store = countingStore(rows)) {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver: store.driver, cache: { enabled: false } }));
    return { manager, calls: store.calls };
}

/**
 * `RemoteLoader`'s shape, minimally: bodies over a wire format that carries no
 * store keys, so there is NO `loadManyKeyed` to delegate to. This is the
 * loader the fallback exists for, and the only way to exercise it.
 */
function keylessLoader(items: Record<string, unknown>): MetadataLoader & { calls: { list: number; load: number; loadMany: number } } {
    const calls = { list: 0, load: 0, loadMany: 0 };
    return {
        calls,
        contract: { name: 'keyless', protocol: 'http:', capabilities: { read: true } } as any,
        async load(_type: string, name: string) {
            calls.load += 1;
            return { data: items[name] ?? null };
        },
        async loadMany() {
            calls.loadMany += 1;
            return Object.values(items) as any[];
        },
        async exists(_type: string, name: string) {
            return name in items;
        },
        async stat() {
            return null;
        },
        async list() {
            calls.list += 1;
            return Object.keys(items);
        },
    } as unknown as MetadataLoader & { calls: { list: number; load: number; loadMany: number } };
}

beforeEach(() => {
    logger.error.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
});

describe("#14423 item 1 — `listNames`: one loader's fault is not the whole enumeration's", () => {
    it('CONTROL — every loader healthy: `listNames` unions the registry and the loaders', async () => {
        const { manager } = planeOver([row('from_db', { name: 'from_db' })]);
        manager.registerInMemory(TYPE, 'from_code', { name: 'from_code' });

        expect((await manager.listNames(TYPE)).sort()).toEqual(['from_code', 'from_db']);
    });

    it('the defect, as an assertion: a loader whose `list` throws no longer takes `listNames` down', async () => {
        const { manager } = planeOver(rowsFromDb(), findDownStore(rowsFromDb()));
        manager.registerInMemory(TYPE, 'from_code', { name: 'from_code' });

        // Before item 1 this REJECTED. The registry name was reachable the
        // whole time; nothing but the missing `catch` withheld it.
        await expect(manager.listNames(TYPE)).resolves.toEqual(['from_code']);
    });

    it('PARITY — the same outage now reaches `listNames` and `loadMany` the same way', async () => {
        const { manager } = planeOver(rowsFromDb(), findDownStore(rowsFromDb()));

        // The asymmetry this card is about, stated as one assertion: both
        // plural reads answer, neither throws, and the outage is spoken ONCE
        // through the shared seam rather than in two vocabularies.
        await expect(manager.loadMany(TYPE)).resolves.toEqual([]);
        await expect(manager.listNames(TYPE)).resolves.toEqual([]);

        const outageLines = logger.error.mock.calls.filter(([message]) =>
            typeof message === 'string' && message.includes('could NOT be read'));
        expect(outageLines).toHaveLength(1);
        expect(outageLines[0][0]).toContain('database');
    });

    it('a healthy loader beside a broken one still contributes its names', async () => {
        const { manager } = planeOver(rowsFromDb(), findDownStore(rowsFromDb()));
        const memory = new MemoryLoader();
        await memory.save(TYPE, 'from_memory', { name: 'from_memory' });
        manager.registerLoader(memory);

        expect(await manager.listNames(TYPE)).toEqual(['from_memory']);
    });

    it('recovery is un-said through the same helper `loadMany` uses', async () => {
        // Two conforming doubles, SWITCHED between — never one double with a
        // failure flag, for the reason in `countingStore`'s docblock.
        const rows = rowsFromDb();
        const healthy = countingStore(rows);
        const down = findDownStore(rows);
        let current: IDataDriver = down.driver;
        const switching = {
            ...(healthy.driver as unknown as Record<string, unknown>),
            find: (table: string, q: unknown) => (current as unknown as {
                find: (t: string, q: unknown) => Promise<unknown>;
            }).find(table, q),
        } as unknown as IDataDriver;
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        manager.registerLoader(new DatabaseLoader({ driver: switching, cache: { enabled: false } }));

        expect(await manager.listNames(TYPE)).toEqual([]);
        expect(logger.error).toHaveBeenCalled();

        current = healthy.driver;
        expect(await manager.listNames(TYPE)).toEqual(['from_db']);
        expect(logger.info.mock.calls.some(([m]) =>
            typeof m === 'string' && m.includes('is readable again'))).toBe(true);
    });
});

describe('#14423 item 2 — `MetadataManager.loadManyKeyed`: the plural read under the STORE key', () => {
    it('the defect, as an assertion: a body with no `name` is served by `load` and is NOT nameable from `loadMany`', async () => {
        // #14205's shape: identity in the `name` COLUMN, body carries none.
        const { manager } = planeOver([row('promote_lead', { type: 'script', target: 'promote_lead' })]);

        const bodies = await manager.loadMany<any>(TYPE);
        expect(bodies).toHaveLength(1);
        expect(bodies.map((b: any) => b?.name)).toEqual([undefined]); // unnamed

        expect((await manager.loadDiagnosed<any>(TYPE, 'promote_lead')).data).toBeTruthy();

        // The keyed read carries the identity the store holds.
        const keyed = await manager.loadManyKeyed<any>(TYPE);
        expect(keyed.map((e) => e.name)).toEqual(['promote_lead']);
        expect(keyed[0].data).toEqual({ type: 'script', target: 'promote_lead' });
    });

    it("⛔ `loadMany`'s published return shape does NOT change — the key travels BESIDE the body, never inside it", async () => {
        const { manager } = planeOver([row('promote_lead', { type: 'script', target: 'promote_lead' })]);

        const [body] = await manager.loadMany<any>(TYPE);
        const [entry] = await manager.loadManyKeyed<any>(TYPE);

        expect(body).toEqual({ type: 'script', target: 'promote_lead' }); // no `name` folded in
        expect(entry.data).toEqual(body);                                 // the SAME body
        expect(Object.keys(entry).sort()).toEqual(['data', 'name']);
    });

    it('DELEGATES to the loader — one query, no per-name reads (the census reading: `{find:1, findOne:0}`)', async () => {
        const { manager, calls } = planeOver([
            row('a', { name: 'a' }), row('b', { name: 'b' }), row('c', { name: 'c' }),
            row('d', { name: 'd' }), row('e', { name: 'e' }),
        ]);

        const keyed = await manager.loadManyKeyed<any>(TYPE);

        expect(keyed.map((e) => e.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
        // Delegate FIRST, fall back SECOND — the order is the cost. Enumerate-
        // then-read-each on this same loader would be `{find:1, findOne:5}`.
        expect(calls).toEqual({ find: 1, findOne: 0, count: 0 });
    });

    it('FALLS BACK for a loader that cannot key — `list()` + per-name `load()`, which still serves the nameless body', async () => {
        const keyless = keylessLoader({
            promote_lead: { type: 'script', target: 'promote_lead' }, // body has NO `name`
        });
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        manager.registerLoader(keyless);

        const keyed = await manager.loadManyKeyed<any>(TYPE);

        expect(keyed).toEqual([{ name: 'promote_lead', data: { type: 'script', target: 'promote_lead' } }]);
        // ⛔ NOT `loadMany` keyed by `body.name` — that is the pre-#14205
        // fallback, and it drops exactly this item.
        expect(keyless.calls).toEqual({ list: 1, load: 1, loadMany: 0 });
    });

    it('per-loader fault isolation — a broken loader does not take the keyed read down', async () => {
        const { manager } = planeOver(rowsFromDb(), findDownStore(rowsFromDb()));
        const memory = new MemoryLoader();
        await memory.save(TYPE, 'from_memory', { name: 'from_memory' });
        manager.registerLoader(memory);

        const keyed = await manager.loadManyKeyed<any>(TYPE);

        expect(keyed.map((e) => e.name)).toEqual(['from_memory']);
        expect(logger.error.mock.calls.some(([m]) =>
            typeof m === 'string' && m.includes('could NOT be read'))).toBe(true);
    });

    it('the FIRST loader wins a key collision, mirroring `list()`', async () => {
        const { manager } = planeOver([row('shared', { name: 'shared', from: 'database' })]);
        const memory = new MemoryLoader();
        await memory.save(TYPE, 'shared', { name: 'shared', from: 'memory' });
        manager.registerLoader(memory);

        const keyed = await manager.loadManyKeyed<any>(TYPE);

        expect(keyed).toHaveLength(1);
        expect((keyed[0].data as any).from).toBe('database');
    });

    it("COST of the audit's by-name rung: `loadDiagnosed` is exactly ONE `findOne` per name", async () => {
        // The other half of the #14423 cost question (the ruling's item 6).
        // The keyed enumeration above is `{find:1, findOne:0}`; the by-name
        // rung the audit adds costs one `findOne` per name PROBED — and it
        // probes only the handlers still unaccounted for after set
        // reconciliation and the registry rung, which is zero on a healthy
        // composition (pinned in objectql's own suite).
        const { manager, calls } = planeOver([
            row('a', { name: 'a' }), row('b', { name: 'b' }), row('c', { name: 'c' }),
        ]);

        expect((await manager.loadDiagnosed<any>(TYPE, 'a')).data).toBeTruthy();
        expect(calls).toEqual({ find: 0, findOne: 1, count: 0 });

        expect((await manager.loadDiagnosed<any>(TYPE, 'b')).data).toBeTruthy();
        expect(calls).toEqual({ find: 0, findOne: 2, count: 0 });

        // ...so N probes cost N `findOne`, linear and bounded by the
        // accusation list — never by the population.
        expect((await manager.loadDiagnosed<any>(TYPE, 'absent')).data).toBeNull();
        expect(calls).toEqual({ find: 0, findOne: 3, count: 0 });
    });

    it('reads the LOADERS, the same population `loadMany` and `loadDiagnosed` read — not the in-memory registry', async () => {
        const { manager } = planeOver([row('from_db', { name: 'from_db' })]);
        manager.registerInMemory(TYPE, 'from_code', { name: 'from_code' });

        // Deliberate, and the reason is the audit's: this is `loadMany` KEYED,
        // and its by-name twin `loadDiagnosed` walks the loaders alone too. A
        // caller wanting the registry as well has `list()`/`listNames()`.
        expect((await manager.loadManyKeyed<any>(TYPE)).map((e) => e.name)).toEqual(['from_db']);
        expect((await manager.loadMany<any>(TYPE)).map((b: any) => b?.name)).toEqual(['from_db']);
        expect((await manager.listNames(TYPE)).sort()).toEqual(['from_code', 'from_db']);
    });
});
