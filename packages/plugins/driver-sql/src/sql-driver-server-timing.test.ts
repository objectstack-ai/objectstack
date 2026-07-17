// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerfTiming, runWithPerfTiming, type ServerTimingMark } from '@objectstack/observability';
import { SqlDriver } from '../src/index.js';

/**
 * Per-query SQL timing → Server-Timing `db` span (perf-tuning mode).
 *
 * The driver wires knex's `query` / `query-response` events into the ambient
 * request collector so every request's response can report total DB time and a
 * query count. These tests assert the wiring itself: attribution is correct
 * under concurrency (ALS, not a global counter) and it costs nothing when off.
 */
describe('SqlDriver Server-Timing db span', () => {
    let driver: SqlDriver;
    let knexInstance: any;

    beforeEach(async () => {
        driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
        });
        knexInstance = (driver as any).knex;
        await knexInstance.schema.createTable('orders', (t: any) => {
            t.string('id').primary();
            t.string('customer');
            t.string('status');
        });
        await knexInstance('orders').insert([
            { id: '1', customer: 'Alice', status: 'open' },
            { id: '2', customer: 'Bob', status: 'closed' },
        ]);
    });

    afterEach(async () => {
        await knexInstance.destroy();
    });

    const dbMark = (t: PerfTiming): ServerTimingMark | undefined =>
        t.marks().find((m) => m.name === 'db');

    it('records a db mark with a query count for a real find()', async () => {
        const t = new PerfTiming();
        const rows = await runWithPerfTiming(t, () =>
            driver.find('orders', { where: { status: 'open' } }),
        );
        expect(rows).toHaveLength(1);
        const mark = dbMark(t);
        expect(mark).toBeDefined();
        expect(mark!.dur).toBeGreaterThanOrEqual(0);
        // find issues at least the SELECT; the mark folds however many it ran.
        expect(mark!.desc).toMatch(/^\d+ queries$/);
        expect(t.toHeader()).toContain('db;dur=');
    });

    it('folds N raw queries into one aggregate with count N', async () => {
        const t = new PerfTiming();
        await runWithPerfTiming(t, async () => {
            await knexInstance('orders').select('*');
            await knexInstance('orders').where({ status: 'open' }).select('*');
            await knexInstance('orders').count({ n: '*' });
        });
        expect(dbMark(t)?.desc).toBe('3 queries');
    });

    it('attributes queries to the originating request under concurrency (ALS, not globals)', async () => {
        const tA = new PerfTiming();
        const tB = new PerfTiming();
        // Interleave two "requests": A runs 3 queries, B runs 2, awaiting a
        // macrotask between each so the two async chains actually overlap.
        const tick = () => new Promise((r) => setTimeout(r, 0));
        await Promise.all([
            runWithPerfTiming(tA, async () => {
                await knexInstance('orders').select('id');
                await tick();
                await knexInstance('orders').select('id');
                await tick();
                await knexInstance('orders').select('id');
            }),
            runWithPerfTiming(tB, async () => {
                await tick();
                await knexInstance('orders').select('customer');
                await tick();
                await knexInstance('orders').select('customer');
            }),
        ]);
        expect(dbMark(tA)?.desc).toBe('3 queries');
        expect(dbMark(tB)?.desc).toBe('2 queries');
    });

    it('is a no-op with zero overhead when no collector is active', async () => {
        // No runWithPerfTiming scope → currentPerfTiming() is undefined.
        await expect(knexInstance('orders').select('*')).resolves.toBeDefined();
        // A subsequent in-scope query still records correctly (no stale state).
        const t = new PerfTiming();
        await runWithPerfTiming(t, async () => {
            await knexInstance('orders').select('*');
        });
        expect(dbMark(t)?.desc).toBe('1 queries');
    });
});
