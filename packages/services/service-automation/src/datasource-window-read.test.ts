// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D2] The windowed read of a datasource source, on both read paths,
 * read through the REAL engine:
 *
 * - **floored** — a plugin driver on an external datasource, read through the
 *   engine's external-driver floor with a small `external.rowCap`. The driver
 *   double is the honest plugin driver the floor is built for: it pushes down
 *   only the bounds its mode names, returns rows in reverse order (no ordering
 *   is relied on), and stops at the `limit` it is sent.
 * - **builtin** — the SQL driver on SQLite, a federated table addressed by
 *   `external.remoteName` with its key mapped onto `id` by `columnMap`.
 *
 * Every case asserts on the rows WRITTEN (what the pull would land) and the
 * positions COMMITTED, and a refusal asserts the ADR-0112 `code` + `status`
 * and the `reason` discriminator.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
    readSourceInWindows,
    canonOf,
    canonOfStart,
    spellCanon,
    type SyncWindow,
    type SyncWindowQuery,
    type SyncWindowSource,
} from './datasource-window-read.js';
import { ConnectorPullError } from './pull-refusal.js';

type Row = Record<string, unknown>;

// ─── the floored path: a plugin driver behind the engine's floor ─────────

type Pushdown = 'both' | 'lower' | 'upper' | 'none';

/** How the remote behind the plugin driver answers. */
interface RemoteBehaviour {
    /** Which of a range's two bounds (`$gte`, `$lt`) the driver sends to the remote. */
    pushdown: Pushdown;
    /** Fields whose predicates the driver does NOT push (they reach the floor only). */
    unpushed: string[];
    /** Called after each `find` answers — a remote written to while the pull reads it. */
    afterFind?: (call: number) => void;
}

/**
 * The parts of `where` this driver pushes down: an equality on any field, and
 * a range's bounds as its `pushdown` names them. A field in `unpushed`, and any
 * other operator, is NOT pushed — the driver answers a superset, which the
 * floor re-applies in memory.
 */
function pushedDown(where: unknown, row: Row, behaviour: RemoteBehaviour): boolean {
    if (where === null || typeof where !== 'object') return true;
    const w = where as Record<string, unknown>;
    return Object.keys(w).every((key) => {
        const cond = w[key];
        if (key === '$and') return !Array.isArray(cond) || cond.every((part) => pushedDown(part, row, behaviour));
        if (key.startsWith('$') || behaviour.unpushed.includes(key)) return true;
        const value = row[key];
        if (cond === null || typeof cond !== 'object') return value === cond;
        const ops = cond as Record<string, unknown>;
        // Only a comparison of two numbers or two strings is pushed; anything else is left to the floor.
        const comparable = (b: unknown) => (typeof value === 'number' && typeof b === 'number')
            || (typeof value === 'string' && typeof b === 'string');
        const below = (b: unknown) => (typeof value === 'number' ? value < (b as number) : String(value) < String(b));
        const mode = behaviour.pushdown;
        if ('$gte' in ops && (mode === 'both' || mode === 'lower')) {
            if (value === null || value === undefined) return false;
            if (comparable(ops.$gte) && below(ops.$gte)) return false;
        }
        if ('$lt' in ops && (mode === 'both' || mode === 'upper')) {
            if (value === null || value === undefined) return false;
            if (comparable(ops.$lt) && !below(ops.$lt)) return false;
        }
        return true;
    });
}

interface PluginRemote {
    rows: Row[];
    sent: Row[];
    behaviour: RemoteBehaviour;
}

function flooredEngine(opts: { rows: Row[]; pushdown?: Pushdown; unpushed?: string[]; rowCap?: number }) {
    const remote: PluginRemote = {
        rows: opts.rows.map((r) => ({ ...r })),
        sent: [],
        behaviour: { pushdown: opts.pushdown ?? 'both', unpushed: opts.unpushed ?? [] },
    };
    const driver = {
        name: 'warehouse',
        version: '0.0.1',
        supports: { transactionsUnsupported: true },
        async connect() {},
        async disconnect() {},
        async find(_object: string, query: Row = {}) {
            remote.sent.push({ ...query });
            const answer = remote.rows
                .filter((r) => pushedDown(query.where, r, remote.behaviour))
                .map((r) => ({ ...r }))
                .reverse();
            remote.behaviour.afterFind?.(remote.sent.length);
            // The caller's bound, applied after the filter, by presence: the floor sends cap + 1.
            return typeof query.limit === 'number' ? answer.slice(0, query.limit) : answer;
        },
        async findOne() { throw new Error('the floor answers findOne itself'); },
        async count() { throw new Error('the floor answers count itself'); },
        async syncSchema() {},
    };
    const engine = new ObjectQL();
    engine.registerDriver(driver as any);
    engine.registerDatasourceDef({
        name: 'warehouse',
        driver: 'com_vendor_warehouse',
        schemaMode: 'external',
        external: { rowCap: opts.rowCap ?? 4 },
    } as any);
    engine.registerApp({
        id: 'wh_pkg',
        name: 'Warehouse',
        objects: [{
            name: 'wh_order',
            datasource: 'warehouse',
            external: { remoteName: 'fact_orders', columnMap: { ORDER_NO: 'id' } },
            fields: {
                seq: { type: 'number', scale: 0, precision: 15 },
                updated_at: { type: 'datetime' },
                organization_id: { type: 'text' },
                amount: { type: 'number' },
            },
        }],
    } as any);
    return { engine, remote };
}

const FLOORED_SOURCE: SyncWindowSource = {
    mapping: 'wh_orders', object: 'wh_order', datasource: 'warehouse', field: 'seq', kind: 'integer', key: 'id',
};

/** A writer that writes every row, recording each batch; and a commit log. */
function recorder(refuse: (row: Row) => boolean = () => false) {
    const written: Row[] = [];
    const commits: Array<{ position: number; window: SyncWindow }> = [];
    return {
        written,
        commits,
        async write(rows: Row[]) {
            return rows.map((row) => {
                if (refuse(row)) return false;
                written.push(row);
                return true;
            });
        },
        async commit(position: number, window: SyncWindow) { commits.push({ position, window }); },
    };
}

function seqRows(values: number[], extra: Partial<Row> = {}): Row[] {
    return values.map((seq, i) => ({ id: `o${String(i).padStart(3, '0')}`, seq, amount: i, ...extra }));
}

const lastOf = <T>(list: T[]): T | undefined => list[list.length - 1];

async function refusalOf(p: Promise<unknown>): Promise<ConnectorPullError> {
    const err = await p.then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ConnectorPullError);
    return err as ConnectorPullError;
}

describe('[ADR-0153 D2] floored: windows bounded on both sides, through the floor', () => {
    it('an open-above window under the cap is the whole tail: one read, every row, committed at its largest value', async () => {
        const { engine } = flooredEngine({ rows: seqRows([5, 9, 7]) });
        const rec = recorder();
        const report = await readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q),
            ...rec,
        }, { path: 'floored', from: 0 });
        expect(rec.written.map((r) => r.seq).sort()).toEqual([5, 7, 9]);
        expect(report.reads).toBe(1);
        expect(rec.commits).toEqual([{ position: 9, window: { lo: 0 } }]);
    });

    it('over the cap it halves windows below a value the source showed, until every row is written exactly once', async () => {
        const values = Array.from({ length: 23 }, (_, i) => 100 + i * 3);
        const { engine, remote } = flooredEngine({ rows: seqRows(values), rowCap: 4 });
        const rec = recorder();
        const report = await readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q),
            ...rec,
        }, { path: 'floored', from: 100 });
        const seqs = rec.written.map((r) => r.seq as number);
        expect([...seqs].sort((a, b) => a - b)).toEqual(values);
        expect(new Set(rec.written.map((r) => r.id)).size).toBe(values.length);
        expect(report.halvings).toBeGreaterThan(0);
        // Commits only ever at a window's end, never moving down, ending at the largest value.
        const positions = rec.commits.map((c) => c.position);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(positions[positions.length - 1]).toBe(values[values.length - 1]);
        // Invariant 3: every bound sent is compared with >= / < only, never > or <=.
        const sentOps = JSON.stringify(remote.sent.map((s) => s.where));
        expect(sentOps).not.toMatch(/\$gt"|\$lte"/);
        // The floor sent cap + 1 every time, never an offset.
        expect(remote.sent.every((s) => s.limit === 5 && s.offset === undefined)).toBe(true);
    });

    it('a bounded window ends at or below a value an over-cap answer showed (invariant 12)', async () => {
        const values = Array.from({ length: 12 }, (_, i) => 10 + i);
        const { engine, remote } = flooredEngine({ rows: seqRows(values), rowCap: 4 });
        const rec = recorder();
        await readSourceInWindows(FLOORED_SOURCE, { find: (q) => engine.find('wh_order', q), ...rec },
            { path: 'floored', from: 10 });
        const max = Math.max(...values);
        for (const query of remote.sent) {
            const parts = ((query.where as any)?.$and ?? [query.where]) as Row[];
            for (const part of parts) {
                const lt = (part.seq as Row | undefined)?.$lt;
                if (lt !== undefined) expect(lt as number).toBeLessThanOrEqual(max);
            }
        }
    });

    it('one canon step holding more rows than the cap refuses sync_window_unsplittable (422), naming the value and the remedy', async () => {
        const { engine } = flooredEngine({ rows: [...seqRows([1, 2]), ...seqRows([7, 7, 7, 7, 7, 7]).map((r, i) => ({ ...r, id: `x${i}` }))], rowCap: 4 });
        const rec = recorder();
        const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 0 }));
        expect(err.code).toBe('EXTERNAL_ROW_CAP_EXCEEDED');
        expect(err.status).toBe(422);
        expect(err.reason).toBe('sync_window_unsplittable');
        expect(err.message).toContain('external.rowCap');
        // The windows below the crowded value were read to their end and committed first.
        expect(rec.written.map((r) => r.seq).sort()).toEqual([1, 2]);
        expect(lastOf(rec.commits)?.position).toBe(2);
    });

    it('a bounded window halved to one canon step and still over the cap refuses sync_window_unsplittable at that value', async () => {
        const crowded = seqRows([5, 5, 5, 5, 5]).map((r, i) => ({ ...r, id: `c${i}` }));
        const { engine } = flooredEngine({ rows: [...crowded, ...seqRows([9])], rowCap: 4 });
        const rec = recorder();
        const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 0 }));
        expect(err.code).toBe('EXTERNAL_ROW_CAP_EXCEEDED');
        expect(err.status).toBe(422);
        expect(err.reason).toBe('sync_window_unsplittable');
        // Halving reached the one-step window [5, 6) before refusing: nothing below 5 was there to write.
        expect(rec.written).toEqual([]);
    });

    for (const mode of ['lower', 'upper', 'none'] as const) {
        it(`a driver that pushes ${mode === 'none' ? 'neither bound' : `only the ${mode} bound`} refuses sync_bounds_not_pushed (422), never a halving loop`, async () => {
            const values = Array.from({ length: 12 }, (_, i) => 10 + i);
            const { engine, remote } = flooredEngine({ rows: seqRows(values), rowCap: 4, pushdown: mode });
            const rec = recorder();
            const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
                find: (q) => engine.find('wh_order', q), ...rec,
            }, { path: 'floored', from: 10 }));
            expect(err.code).toBe('EXTERNAL_ROW_CAP_EXCEEDED');
            expect(err.status).toBe(422);
            expect(err.reason).toBe('sync_bounds_not_pushed');
            expect(err.message).toContain("datasource 'warehouse'");
            // Refused once one window's answer shows a value outside its bounds — for an upper-only driver,
            // once the rows below `hi` pass the cap — never after halving down to one step.
            expect(remote.sent.length).toBeLessThan(8);
        });
    }

    it('a driver that pushes the bounds but not the organization equality: halving helps, and only the job\'s organization is written', async () => {
        const mine = seqRows(Array.from({ length: 6 }, (_, i) => 10 + i), { organization_id: 'org_a' });
        const theirs = seqRows(Array.from({ length: 6 }, (_, i) => 10 + i), { organization_id: 'org_b' })
            .map((r, i) => ({ ...r, id: `b${i}` }));
        const { engine, remote } = flooredEngine({ rows: [...mine, ...theirs], rowCap: 4, unpushed: ['organization_id'] });
        const rec = recorder();
        await readSourceInWindows({ ...FLOORED_SOURCE, scope: { organization_id: 'org_a' } }, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 10 });
        expect(rec.written.every((r) => r.organization_id === 'org_a')).toBe(true);
        expect(rec.written).toHaveLength(6);
        // Invariant 10: every read carried the organization conjunct.
        expect(remote.sent.every((s) => JSON.stringify(s.where).includes('"organization_id":"org_a"'))).toBe(true);
    });

    it('committed 5000, source maximum 5400, writes of 5401 to 6200 during the run: every row is pulled by this run or the next', async () => {
        const before = Array.from({ length: 9 }, (_, i) => 5000 + i * 50); // 5000..5400
        const during = Array.from({ length: 8 }, (_, i) => 5401 + i * 114); // 5401..6199
        const { engine, remote } = flooredEngine({ rows: seqRows(before), rowCap: 4 });
        let landed = false;
        remote.behaviour.afterFind = () => {
            if (landed) return;
            landed = true;
            remote.rows.push(...seqRows(during).map((r, i) => ({ ...r, id: `late${i}` })));
        };
        const rec = recorder();
        const first = await readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 5000 });
        expect(first.committed).toBeDefined();
        await readSourceInWindows(FLOORED_SOURCE, { find: (q) => engine.find('wh_order', q), ...rec },
            { path: 'floored', from: first.committed as number });
        const pulled = new Set(rec.written.map((r) => r.seq));
        for (const value of [...before, ...during]) expect(pulled.has(value), String(value)).toBe(true);
    });

    it('an integer watermark outside ±2^53 refuses watermark_not_exact (400) before its batch is written', async () => {
        const { engine } = flooredEngine({ rows: [{ id: 'o1', seq: 2 ** 53 + 2 }] });
        const rec = recorder();
        const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 0 }));
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.reason).toBe('watermark_not_exact');
        expect(rec.written).toEqual([]);
    });

    it('a key read back as a number outside ±2^53 refuses source_key_not_exact (400) before its batch is written', async () => {
        const { engine } = flooredEngine({ rows: [{ id: 2 ** 53 + 2, seq: 3 }] });
        const rec = recorder();
        const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 0 }));
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.reason).toBe('source_key_not_exact');
        expect(rec.written).toEqual([]);
    });

    it('[N3] an unreadable watermark in an over-cap answer is the data\'s fault (watermark_not_exact), not the driver\'s', async () => {
        const junk = seqRows([1, 2, 3, 4, 5]).map((r) => ({ ...r, seq: 'not-a-number' }));
        const { engine } = flooredEngine({ rows: junk, rowCap: 4 });
        const err = await refusalOf(readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...recorder(),
        }, { path: 'floored', from: 0 }));
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.reason).toBe('watermark_not_exact');
    });

    it('a run that writes no row commits nothing: the position stays where it was', async () => {
        const { engine } = flooredEngine({ rows: seqRows([3, 4]) });
        const rec = recorder(() => true);
        const report = await readSourceInWindows(FLOORED_SOURCE, {
            find: (q) => engine.find('wh_order', q), ...rec,
        }, { path: 'floored', from: 0 });
        expect(rec.commits).toEqual([]);
        expect(report.committed).toBeUndefined();
        expect(report.read).toBe(2);
    });

    it('a refused row below a written one stays behind the commit; one above every written row keeps the position below it', async () => {
        const { engine } = flooredEngine({ rows: seqRows([3, 5, 8]) });
        const rec = recorder((row) => row.seq === 8);
        await readSourceInWindows(FLOORED_SOURCE, { find: (q) => engine.find('wh_order', q), ...rec },
            { path: 'floored', from: 0 });
        // (a) of invariant 9 is the largest value WRITTEN: the refused 8 is read again next run.
        expect(lastOf(rec.commits)?.position).toBe(5);
    });
});

// ─── the built-in path: the SQL driver on SQLite, a federated table ───────

let sqlDriver: any;
afterEach(async () => { await sqlDriver?.disconnect(); sqlDriver = undefined; });

async function builtinEngine(rows: Array<{ no: string; at: string | null; org?: string }>) {
    const d = new SqlDriver({
        client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, schemaMode: 'external',
    } as any) as any;
    d.name = 'erp';
    await d.connect();
    sqlDriver = d;
    await d.knex.raw('create table ERP_ORDERS (ORDER_NO text primary key, UPDATED_AT text, ORG text)');
    for (const r of rows) {
        await d.knex.raw('insert into ERP_ORDERS values (?, ?, ?)', [r.no, r.at, r.org ?? 'org_a']);
    }
    const object = {
        name: 'erp_order',
        datasource: 'erp',
        external: { remoteName: 'ERP_ORDERS', columnMap: { ORDER_NO: 'id', UPDATED_AT: 'updated_at', ORG: 'organization_id' } },
        fields: { updated_at: { type: 'datetime' }, organization_id: { type: 'text' } },
    };
    d.registerExternalObject(object);
    const engine = new ObjectQL();
    engine.registerDriver(d);
    engine.registerDatasourceDef({ name: 'erp', driver: 'sqlite', schemaMode: 'external' } as any);
    engine.registerApp({ id: 'erp_pkg', name: 'ERP', objects: [object] } as any);
    const sent: SyncWindowQuery[] = [];
    const find = (q: SyncWindowQuery) => { sent.push(q); return engine.find('erp_order', q); };
    return { engine, driver: d, find, sent };
}

const BUILTIN_SOURCE: SyncWindowSource = {
    mapping: 'erp_orders', object: 'erp_order', datasource: 'erp', field: 'updated_at', kind: 'datetime', key: 'id',
};

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

describe('[ADR-0153 D2] builtin: aligned windows read whole, paged by key', () => {
    it('reads every row once across pages and windows, and commits only at a window\'s end', async () => {
        const rows = Array.from({ length: 17 }, (_, i) => ({ no: `k${String(i).padStart(2, '0')}`, at: at(i * 1000) }));
        const { find, sent } = await builtinEngine(rows);
        const rec = recorder();
        const report = await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec },
            { path: 'builtin', from: canonOfStart(BUILTIN_SOURCE, '2026-01-01'), pageSize: 3 });
        expect(rec.written.map((r) => r.id).sort()).toEqual(rows.map((r) => r.no));
        expect(report.highWater).toBe(Date.UTC(2026, 0, 1) + 16_000);
        // Pages are cut by key, never by a watermark read back (invariant 5).
        const pageQueries = sent.filter((q) => q.orderBy?.[0]?.field === 'id');
        expect(pageQueries.length).toBeGreaterThan(rec.commits.length);
        expect(JSON.stringify(sent.map((q) => q.where))).not.toMatch(/"updated_at":\{"\$gt"/);
        // Every bounded window ends at or below floor(H0); the last one is open above.
        for (const c of rec.commits) {
            if (c.window.hi !== undefined) expect(c.window.hi).toBeLessThanOrEqual(report.highWater as number);
        }
        expect(lastOf(rec.commits)?.window.hi).toBeUndefined();
        expect(lastOf(rec.commits)?.position).toBe(report.highWater);
    });

    it('more rows than a page sharing ONE millisecond are paged by key to the end, never re-read for ever', async () => {
        const rows = Array.from({ length: 11 }, (_, i) => ({ no: `s${String(i).padStart(2, '0')}`, at: at(5) }));
        const { find } = await builtinEngine(rows);
        const rec = recorder();
        const report = await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec },
            { path: 'builtin', from: canonOfStart(BUILTIN_SOURCE, '2026-01-01'), pageSize: 4 });
        expect(rec.written).toHaveLength(11);
        expect(report.reads).toBeLessThan(10);
    });

    it('a run interrupted after page one commits nothing for that window; the next run reads the whole window again', async () => {
        const rows = Array.from({ length: 9 }, (_, i) => ({ no: `k${i}`, at: at(i) }));
        const { find } = await builtinEngine(rows);
        let batches = 0;
        const rec = recorder();
        const failing = {
            ...rec,
            async write(batch: Row[]) {
                if (++batches === 2) throw new Error('the server stopped');
                return rec.write(batch);
            },
        };
        const from = canonOfStart(BUILTIN_SOURCE, '2026-01-01');
        await expect(readSourceInWindows(BUILTIN_SOURCE, { find, ...failing }, { path: 'builtin', from, pageSize: 2 }))
            .rejects.toThrow('the server stopped');
        const resumeFrom = lastOf(rec.commits)?.position ?? from;
        expect(resumeFrom).toBe(from);
        const again = recorder();
        await readSourceInWindows(BUILTIN_SOURCE, { find, ...again }, { path: 'builtin', from: resumeFrom, pageSize: 2 });
        expect(again.written.map((r) => r.id).sort()).toEqual(rows.map((r) => r.no).sort());
    });

    it('a row behind the key cursor updated during the open-above window is read by this run or the next', async () => {
        const rows = Array.from({ length: 6 }, (_, i) => ({ no: `k${i}`, at: at(100) }));
        const { find, driver } = await builtinEngine(rows);
        const rec = recorder();
        let pages = 0;
        const bumping = {
            ...rec,
            async write(batch: Row[]) {
                if (++pages === 2) {
                    // k0 is behind the cursor now; the source stamps it later than any value read.
                    await driver.knex.raw('update ERP_ORDERS set UPDATED_AT = ? where ORDER_NO = ?', [at(900), 'k0']);
                }
                return rec.write(batch);
            },
        };
        const first = await readSourceInWindows(BUILTIN_SOURCE, { find, ...bumping },
            { path: 'builtin', from: canonOfStart(BUILTIN_SOURCE, '2026-01-01'), pageSize: 2 });
        // (b) of invariant 9 held the commit at the high-water read before the window's first page.
        expect(first.committed).toBe(Date.UTC(2026, 0, 1) + 100);
        await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec }, { path: 'builtin', from: first.committed as number, pageSize: 2 });
        const k0 = rec.written.filter((r) => r.id === 'k0').map((r) => r.updated_at);
        expect(k0).toContain(at(900));
    });

    it('committed 5000, source maximum 5400, writes of 5401 to 6200 during the run: every row is pulled by this run or the next', async () => {
        const before = Array.from({ length: 9 }, (_, i) => 5000 + i * 50);
        const during = Array.from({ length: 8 }, (_, i) => 5401 + i * 114);
        const { find, driver } = await builtinEngine(before.map((v, i) => ({ no: `b${i}`, at: at(v) })));
        const rec = recorder();
        let wrote = false;
        const late = {
            ...rec,
            async write(batch: Row[]) {
                if (!wrote) {
                    wrote = true;
                    for (const [i, v] of during.entries()) {
                        await driver.knex.raw('insert into ERP_ORDERS values (?, ?, ?)', [`late${i}`, at(v), 'org_a']);
                    }
                }
                return rec.write(batch);
            },
        };
        const first = await readSourceInWindows(BUILTIN_SOURCE, { find, ...late },
            { path: 'builtin', from: Date.UTC(2026, 0, 1) + 5000, pageSize: 3 });
        await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec },
            { path: 'builtin', from: first.committed as number, pageSize: 3 });
        const pulled = new Set(rec.written.map((r) => r.id));
        for (const i of before.keys()) expect(pulled.has(`b${i}`)).toBe(true);
        for (const i of during.keys()) expect(pulled.has(`late${i}`)).toBe(true);
    });

    it('a NULL watermark is in no window; the organization conjunct rides on every read, the high-water reads included', async () => {
        const { find, sent } = await builtinEngine([
            { no: 'a1', at: at(1) }, { no: 'a2', at: null }, { no: 'b1', at: at(2), org: 'org_b' },
        ]);
        const rec = recorder();
        await readSourceInWindows({ ...BUILTIN_SOURCE, scope: { organization_id: 'org_a' } }, { find, ...rec },
            { path: 'builtin', from: canonOfStart(BUILTIN_SOURCE, '2026-01-01') });
        expect(rec.written.map((r) => r.id)).toEqual(['a1']);
        expect(sent.every((q) => JSON.stringify(q.where).includes('"organization_id":"org_a"'))).toBe(true);
    });

    it('SQLite: a 64-bit INTEGER key or watermark comes back as a JS number past 2^53, and refuses the run by name', async () => {
        // The client default this dialect has (better-sqlite3, no `safeIntegers`): a 64-bit integer is read as a
        // number, rounded past 2^53. Measured here, so the run-time refusal is what keeps it from being a cursor.
        const d = new SqlDriver({
            client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, schemaMode: 'external',
        } as any) as any;
        d.name = 'ledger';
        await d.connect();
        sqlDriver = d;
        await d.knex.raw('create table LEDGER (K integer primary key, SEQ integer)');
        await d.knex.raw('insert into LEDGER values (9007199254740993, 1), (2, 9007199254740993)');
        const object = {
            name: 'ledger_row', datasource: 'ledger',
            external: { remoteName: 'LEDGER', columnMap: { K: 'id', SEQ: 'seq' } },
            fields: { id: { type: 'number', scale: 0, precision: 15 }, seq: { type: 'number', scale: 0, precision: 15 } },
        };
        d.registerExternalObject(object);
        const engine = new ObjectQL();
        engine.registerDriver(d);
        engine.registerDatasourceDef({ name: 'ledger', driver: 'sqlite', schemaMode: 'external' } as any);
        engine.registerApp({ id: 'ledger_pkg', name: 'Ledger', objects: [object] } as any);
        const raw = await engine.find('ledger_row', { where: { seq: 1 } });
        expect(typeof raw[0].id).toBe('number');
        expect(Number.isSafeInteger(raw[0].id)).toBe(false);
        const source: SyncWindowSource = {
            mapping: 'ledger_rows', object: 'ledger_row', datasource: 'ledger', field: 'seq', kind: 'integer', key: 'id',
        };
        const err = await refusalOf(readSourceInWindows(source, {
            find: (q) => engine.find('ledger_row', q), ...recorder(),
        }, { path: 'builtin', from: 0 }));
        // The high-water read meets the 64-bit watermark first.
        expect(err.reason).toBe('watermark_not_exact');
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        await d.knex.raw('update LEDGER set SEQ = 2 where K = 2');
        const keyErr = await refusalOf(readSourceInWindows(source, {
            find: (q) => engine.find('ledger_row', q), ...recorder(),
        }, { path: 'builtin', from: 0 }));
        expect(keyErr.reason).toBe('source_key_not_exact');
        expect(keyErr.status).toBe(400);
    });

    it('[S1] a multi-page window whose high-water read found nothing commits its own lo, never the largest value written', async () => {
        // The source is empty when the high-water values are read; more than a page lands before the window's first page.
        const { driver, find: base } = await builtinEngine([]);
        let calls = 0;
        const find = async (q: SyncWindowQuery) => {
            const rows = await base(q);
            if (++calls === 2) {
                for (let i = 0; i < 5; i++) {
                    await driver.knex.raw('insert into ERP_ORDERS values (?, ?, ?)', [`n${i}`, at(1000 + i), 'org_a']);
                }
            }
            return rows;
        };
        const rec = recorder();
        const from = canonOfStart(BUILTIN_SOURCE, '2026-01-01');
        const report = await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec }, { path: 'builtin', from, pageSize: 2 });
        expect(report.highWater).toBeUndefined();
        expect(rec.written).toHaveLength(5);
        expect(report.committed).toBe(from);
    });

    it('[S1] a commit never goes below where the run started, even when the high-water value sat under it', async () => {
        // The source's maximum (T+100) is below the start (T+500) when it is read; rows above the start land after.
        const { driver, find: base } = await builtinEngine([{ no: 'old', at: at(100) }]);
        let calls = 0;
        const find = async (q: SyncWindowQuery) => {
            const rows = await base(q);
            if (++calls === 2) {
                for (let i = 0; i < 5; i++) {
                    await driver.knex.raw('insert into ERP_ORDERS values (?, ?, ?)', [`n${i}`, at(600 + i), 'org_a']);
                }
            }
            return rows;
        };
        const rec = recorder();
        const from = Date.UTC(2026, 0, 1) + 500;
        const report = await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec }, { path: 'builtin', from, pageSize: 2 });
        expect(report.highWater).toBe(Date.UTC(2026, 0, 1) + 100);
        expect(rec.written.map((r) => r.id).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
        expect(report.committed).toBe(from);
        expect(rec.commits.every((c) => c.position >= from)).toBe(true);
    });

    it('an empty source reads one open-above window and commits nothing', async () => {
        const { find } = await builtinEngine([]);
        const rec = recorder();
        const report = await readSourceInWindows(BUILTIN_SOURCE, { find, ...rec },
            { path: 'builtin', from: canonOfStart(BUILTIN_SOURCE, '2026-01-01') });
        expect(report.highWater).toBeUndefined();
        expect(report.windows).toBe(1);
        expect(rec.commits).toEqual([]);
    });
});

describe('[ADR-0153 D2] the canon step', () => {
    it('floors a datetime to the millisecond by truncation, never rounding up (a row at .9996 of a millisecond)', () => {
        const reading = canonOf('datetime', '2026-01-01T00:00:00.9996Z');
        expect(reading).toEqual({ ok: true, canon: Date.UTC(2026, 0, 1) + 999 });
        expect(spellCanon('datetime', Date.UTC(2026, 0, 1) + 999)).toBe('2026-01-01T00:00:00.999Z');
    });

    it('floors a date to its day, and an integer to itself; spells each in its storage form', () => {
        const day = canonOf('date', '2026-03-04T23:59:59Z');
        expect(day.ok && spellCanon('date', day.canon)).toBe('2026-03-04');
        expect(canonOf('integer', 42)).toEqual({ ok: true, canon: 42 });
        expect(canonOf('integer', '42')).toEqual({ ok: true, canon: 42 });
        expect(canonOf('integer', 42n)).toEqual({ ok: true, canon: 42 });
        expect(canonOf('integer', 2 ** 53 + 2)).toEqual({ ok: false, inexact: true });
        expect(canonOf('integer', 2n ** 60n)).toEqual({ ok: false, inexact: true });
        expect(canonOf('datetime', null)).toEqual({ ok: false, inexact: false });
    });

    it('a watermark.start the field\'s kind does not read refuses watermark_start_invalid (400)', () => {
        let caught: unknown;
        try { canonOfStart({ mapping: 'm', field: 'seq', kind: 'integer' }, '2020-01-01'); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(ConnectorPullError);
        expect((caught as ConnectorPullError).code).toBe('VALIDATION_ERROR');
        expect((caught as ConnectorPullError).status).toBe(400);
        expect((caught as ConnectorPullError).reason).toBe('watermark_start_invalid');
    });
});
