// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26644] The runtime dispatcher's `/data` doors answer an empty projection
 * and a count flag that is neither `true` nor `false` the way `RestServer`
 * does: `400 VALIDATION_ERROR`, naming the parameter the caller wrote, before
 * any read.
 *
 * The refusal lives once, in the shared normalizer both transports hand their
 * request to (`metadata-protocol`'s `findData` / `getData`; the per-spelling pin
 * is `protocol.empty-projection-unknown-count.test.ts`, the REST half
 * `packages/rest/src/data-empty-projection-count-door.test.ts`). This file is
 * the dispatcher's half: `GET /data/:object`, `POST /data/:object/query` and
 * `GET /data/:object/:id`, as the host catch-all hands them over.
 *
 * Measured on the base (`0f3d068cf1`): every refused request below answered
 * `200` — every column for the empty projections, a `total` for the count.
 *
 * The dispatcher's `/data` domain does not catch the normalizer's throw, so it
 * leaves `dispatch()` and the HOST's exit renders it; both exits are asked here
 * through their own readers (`declaredEnvelopeForThrow` for
 * `@objectstack/hono`'s catch-all, `resolveThrownHttpError` for
 * `dispatcher-plugin`), ⛔ not restated.
 *
 * The rig is `data-hook-condition-refusal.test.ts`'s: a real store
 * (better-sqlite3 `:memory:`, the real `ObjectQL`, a real
 * `ObjectStackProtocolImplementation`) and `HttpDispatcher.dispatch()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const PACKAGE_ID = 'objectstack-test';
const CALLER = { userId: 'u_member', isSystem: false };
const INQUIRY = {
    name: 'inquiry', label: 'Inquiry',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        note: { name: 'note', type: 'text' as const, label: 'Note' },
    },
};

type Answer = { status: number; code?: string; message?: string; body?: any };

describe('[#26644] the dispatcher /data doors — an empty projection and an unrecognised count flag', () => {
    let engine: ObjectQL;
    let driver: any;
    const reads = { n: 0 };
    let dispatcher: HttpDispatcher;

    /** What the request answered — the returned response, or what the host exits make of the throw. */
    const ask = async (method: 'GET' | 'POST', path: string, query: Record<string, unknown>, body?: unknown): Promise<Answer> => {
        const raw = new Request(`http://localhost${PREFIX}${path}`, {
            method,
            ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
        let returned: any;
        try {
            returned = await dispatcher.dispatch(method, path, body, query, { request: raw } as any, PREFIX);
        } catch (thrown) {
            const envelope = declaredEnvelopeForThrow(thrown);
            const resolved = resolveThrownHttpError(thrown);
            // The two host exits must agree before either is believed.
            expect(envelope?.status, 'catch-all status').toBe(resolved.status);
            expect(envelope?.body.error.code, 'catch-all code').toBe(resolved.code);
            return { status: resolved.status, code: resolved.code, message: envelope?.body.error.message };
        }
        const res = returned.response;
        return { status: res.status, code: res.body?.error?.code, message: res.body?.error?.message, body: res.body };
    };

    beforeAll(async () => {
        engine = new ObjectQL();
        driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(INQUIRY as any, PACKAGE_ID);
        await engine.syncSchemas();
        for (const id of ['r1', 'r2', 'r3']) await engine.insert('inquiry', { id, name: `n-${id}`, note: `x-${id}` } as any);
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
            const real = driver[verb].bind(driver);
            driver[verb] = (o: string, ...rest: unknown[]) => { if (o === 'inquiry') reads.n += 1; return real(o, ...rest); };
        }

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        // `callData`'s exposure gate reads the kernel's `metadata` service.
        const metadata = { getObject: async (name: string) => engine.registry.getObject(name) };
        const services: Record<string, unknown> = { protocol, metadata };
        const get = (n: string) => services[n] ?? null;
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
        dispatcher = new HttpDispatcher(kernel);
        (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    });

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    it.each<[string, 'GET' | 'POST', string, Record<string, unknown>, unknown, string, string]>([
        ['GET list ?$select= (the card)', 'GET', '/data/inquiry', { $select: '' }, undefined, '$select', 'names no field'],
        ['GET list ?$select=, (the card)', 'GET', '/data/inquiry', { $select: ',' }, undefined, '$select', 'names no field'],
        ['GET list ?select= (the card)', 'GET', '/data/inquiry', { select: '' }, undefined, 'select', 'names no field'],
        ['GET list ?$count=maybe (the card)', 'GET', '/data/inquiry', { $top: '2', $count: 'maybe' }, undefined, '$count', 'must be true or false'],
        ['POST query {"select":""}', 'POST', '/data/inquiry/query', {}, { select: '' }, 'select', 'names no field'],
        ['POST query {"fields":[]}', 'POST', '/data/inquiry/query', {}, { fields: [] }, 'fields', 'names no field'],
        ['GET by id ?select=', 'GET', '/data/inquiry/r1', { select: '' }, undefined, 'select', 'names no field'],
        ['GET by id ?select=,', 'GET', '/data/inquiry/r1', { select: ',' }, undefined, 'select', 'names no field'],
    ])('%s: 400 VALIDATION_ERROR naming the spelling — no read', async (_name, method, path, query, body, param, sentence) => {
        const before = reads.n;

        const answer = await ask(method, path, query, body);

        expect(answer.status, JSON.stringify(answer)).toBe(400);
        expect(answer.code).toBe('VALIDATION_ERROR');
        expect(answer.message).toContain(`Query parameter '${param}' ${sentence}`);
        expect(reads.n - before, 'no read of the object — the refusal precedes the driver').toBe(0);
    });

    it('CONTROL: a named projection and a true / false / absent count answer exactly as before', async () => {
        const projected = await ask('GET', '/data/inquiry', { $select: 'name', $orderby: 'name' });
        expect(projected.status, JSON.stringify(projected)).toBe(200);
        const records = projected.body.data.records;
        expect(records.map((r: any) => r.name)).toEqual(['n-r1', 'n-r2', 'n-r3']);
        expect(records.every((r: any) => !('note' in r))).toBe(true);

        const counted = await ask('GET', '/data/inquiry', { $top: '2', $count: 'true' });
        expect(counted.body.data.total).toBe(3);
        const optedOut = await ask('GET', '/data/inquiry', { $top: '2', $count: 'false' });
        expect(optedOut.status, JSON.stringify(optedOut)).toBe(200);
        expect('total' in optedOut.body.data).toBe(false);
        const absent = await ask('GET', '/data/inquiry', { $top: '2' });
        expect(absent.body.data.total).toBe(3);

        const one = await ask('GET', '/data/inquiry/r1', { select: 'name' });
        expect(one.status, JSON.stringify(one)).toBe(200);
        expect(one.body.data.record.name).toBe('n-r1');
        expect('note' in one.body.data.record).toBe(false);
    });
});
