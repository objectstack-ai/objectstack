// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { SqlDriver } from '@objectstack/driver-sql';

/**
 * End-to-end regression for the Server-Timing `db` span (issue #2408).
 *
 * Boots a REAL HTTP server (Hono, perf-tuning on), opens a socket, and hits a
 * route whose handler runs real SQL through the driver. This is the one thing
 * no single-layer unit test can show: the request-scoped collector that the
 * Hono middleware opens with `AsyncLocalStorage` actually reaches the SQL
 * driver's knex query listener across a genuine HTTP request, so the response's
 * `Server-Timing` header reports the request's query count.
 */
describe('Server-Timing db span over a real HTTP server (integration)', () => {
    let kernel: LiteKernel;
    let driver: SqlDriver;
    let baseUrl: string;

    beforeAll(async () => {
        driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
        });
        const knexInstance = (driver as any).knex;
        await knexInstance.schema.createTable('widgets', (t: any) => {
            t.string('id').primary();
            t.string('name');
        });
        await knexInstance('widgets').insert([
            { id: '1', name: 'a' },
            { id: '2', name: 'b' },
        ]);

        kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, serverTiming: true, cors: false }));
        await kernel.bootstrap();

        const httpServer = kernel.getService<any>('http.server');
        // A route whose handler runs two real queries through the driver — the
        // same shape as a data-API list that does a find + a follow-up lookup.
        httpServer.get('/widgets', async (_req: any, res: any) => {
            const all = await driver.find('widgets', {});
            const one = await driver.find('widgets', { where: { id: '1' } });
            res.json({ all: all.length, one: one.length });
        });
        baseUrl = `http://127.0.0.1:${httpServer.getPort()}`;
    }, 30_000);

    afterAll(async () => {
        try { await (driver as any).knex?.destroy(); } catch { /* noop */ }
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    });

    it('reports the request\'s query count in the Server-Timing header', async () => {
        const res = await fetch(`${baseUrl}/widgets`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ all: 2, one: 1 });

        const header = res.headers.get('Server-Timing');
        expect(header).toBeTruthy();
        expect(header).toMatch(/(^|, )total;dur=/);
        expect(header).toContain('serialize;dur=');
        // Two driver.find() calls → ≥2 SQL queries folded into ONE db span.
        const m = header!.match(/db;dur=[\d.]+;desc="(\d+) queries"/);
        expect(m, `expected a db span in: ${header}`).toBeTruthy();
        expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    });
});
