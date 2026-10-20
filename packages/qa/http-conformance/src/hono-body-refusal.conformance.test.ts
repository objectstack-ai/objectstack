// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23914] Through a REAL `createHonoApp` host over the REAL dispatcher and
 * data domain: a declared JSON body that does not parse is refused `400
 * INVALID_REQUEST` by its READER, after the dispatcher's gates, with the same
 * answer `@objectstack/plugin-hono-server` gives — and never handed to the
 * data domain as `{}`.
 *
 * ## What this pins
 *
 *  1. The card's bodies at the data door — a truncated query, `{ not json`, a
 *     truncated `PATCH`, a truncated create — each answer the adapter's
 *     refusal; the store is read back after the writes and is unchanged.
 *  2. Parity: the same body to a `HonoHttpServer` route that reads `req.body`
 *     answers the same status and the same bytes.
 *  3. Order: the dispatcher's gates run before the refusal. With the ADR-0069
 *     gate active and its session read failing, a truncated query answers the
 *     gate's `503`, not the body's `400` — the body is refused by its reader,
 *     and the gate stops the request before any reader runs.
 *  4. CONTROL: a valid query filters, and an empty body is the empty query.
 *
 * A domain that forwards the request and reads its own bytes is NOT refused
 * by the adapter: `hono-webhooks-redeliver.conformance.test.ts` holds the
 * hosted door's `/webhooks/redeliver` answer to a body that is not JSON byte
 * for byte equal to the self-hosted mount's (the member's own refusal).
 *
 * `@objectstack/hono` resolves to this checkout's adapter SOURCE (the
 * subject); `@objectstack/runtime` and `@objectstack/plugin-hono-server`
 * through their `dist/`, as in the sibling `hono-*.conformance.test.ts` files.
 * WHO the caller is comes from the dispatcher's identity step, replaced on the
 * prototype with one member, as in `hono-declared-envelope.conformance.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HttpDispatcher } from '@objectstack/runtime';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { createHonoApp } from '@objectstack/hono';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PREFIX = '/api/v1';
const MEMBER = { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] };
const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        status: { name: 'status', type: 'text' as const, label: 'Status' },
    },
};
const REFUSAL = /^The request body could not be parsed as JSON/;

const liveKernels: LiteKernel[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (liveKernels.length) {
        const kernel = liveKernels.pop();
        await Promise.race([
            kernel?.shutdown(),
            new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
        ]);
    }
});

/** The real store, the real protocol over it, and the REAL `createHonoApp` over both. */
async function boot(auth?: Record<string, unknown>) {
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    const kernel = new LiteKernel();
    liveKernels.push(kernel);
    kernel.use({
        name: 'test-body-refusal-services',
        version: '1.0.0',
        init: (c: any) => {
            c.registerService('driver.memory', driver);
            if (auth) c.registerService('auth', auth);
        },
    } as any);
    kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerObject(TASK as any);
    await ql.syncObjectSchema(TASK.name);
    // A real `single` install's Default Organization: the writes below derive
    // it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(ql as any);

    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
        .mockImplementation(async () => ({ ...MEMBER }));

    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX, cors: false });
    /** A request whose body is sent exactly as written, declared as JSON. */
    const send = async (method: string, path: string, body?: string) => {
        const res = await app.request(`http://localhost${PREFIX}${path}`, {
            method,
            headers: body === undefined ? {} : { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body }),
        });
        return { status: res.status, text: await res.text() };
    };
    const seed = async (name: string, status: string): Promise<string> => String(((await ql.insert('task', { name, status })) as any).id);
    const rows = async (): Promise<any[]> => (await ql.find('task', {})) ?? [];
    return { send, seed, rows };
}

/** The records a data answer carries, wherever its envelope puts them. */
function recordsOf(text: string): unknown[] {
    const body = JSON.parse(text);
    const data = body?.data ?? body;
    const records = data?.records ?? data?.value ?? data;
    return Array.isArray(records) ? records : [];
}

function expectRefused(answer: { status: number; text: string }, sent: string) {
    expect(answer.status, answer.text).toBe(400);
    expect(JSON.parse(answer.text)).toEqual({
        success: false,
        error: { code: 'INVALID_REQUEST', message: expect.stringMatching(REFUSAL) },
    });
    expect(answer.text).not.toContain(sent.trim());
}

describe('[#23914] a real createHonoApp host: the data domain\'s read of an unparseable body is refused', () => {
    it('step 2 / step 3 — a truncated query and `{ not json` answer the refusal, not every row', async () => {
        const host = await boot();
        await host.seed('a', 'churned');
        await host.seed('b', 'active');
        for (const sent of ['{"where": {"status": "churned"}', '{ not json']) {
            expectRefused(await host.send('POST', '/data/task/query', sent), sent);
        }
    });

    it('step 5 — a truncated PATCH answers the refusal, and the stored row is unchanged', async () => {
        const host = await boot();
        const id = await host.seed('kept', 'active');
        const before = await host.rows();
        const sent = '{"name": "HACKED"';
        expectRefused(await host.send('PATCH', `/data/task/${id}`, sent), sent);
        expect(await host.rows()).toEqual(before);
    });

    it('step 6 — a truncated create answers the refusal, not a validation error, and writes nothing', async () => {
        const host = await boot();
        const sent = '{"name": "Door Truncated Create"';
        expectRefused(await host.send('POST', '/data/task', sent), sent);
        expect(await host.rows()).toEqual([]);
    });

    it('parity — a HonoHttpServer route that reads req.body answers the same status and the same bytes', async () => {
        const host = await boot();
        const server = new HonoHttpServer(0);
        server.post(`${PREFIX}/data/:object/query`, (req, res) => { res.json({ query: req.body }); });
        for (const sent of ['{"where": {"status": "churned"}', '{ not json']) {
            const hosted = await host.send('POST', '/data/task/query', sent);
            const direct = await server.getRawApp().fetch(new Request(`http://direct.test${PREFIX}/data/task/query`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: sent,
            }));
            expect({ status: direct.status, text: await direct.text() }).toEqual(hosted);
        }
    });

    it('order — the dispatcher\'s gates run before the refusal: an active ADR-0069 gate whose session read fails answers 503', async () => {
        const host = await boot({
            isAuthGateActive: () => true,
            api: { getSession: async () => { throw new Error('session store down'); } },
        });
        const answer = await host.send('POST', '/data/task/query', '{"where": {"status": "churned"}');
        expect(answer.status, answer.text).toBe(503);
        expect(JSON.parse(answer.text)).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    });

    it('CONTROL — a valid query filters, and an empty body is the empty query', async () => {
        const host = await boot();
        await host.seed('a', 'churned');
        await host.seed('b', 'active');
        const filtered = await host.send('POST', '/data/task/query', '{"where": {"status": "churned"}}');
        expect(filtered.status, filtered.text).toBe(200);
        expect(recordsOf(filtered.text)).toHaveLength(1);
        const empty = await host.send('POST', '/data/task/query', '');
        expect(empty.status, empty.text).toBe(200);
        expect(recordsOf(empty.text)).toHaveLength(2);
    });
});
