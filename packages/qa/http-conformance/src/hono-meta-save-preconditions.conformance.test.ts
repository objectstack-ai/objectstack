// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22221] Through a REAL `createHonoApp` host, `PUT /meta/:type/:name` honours
 * `If-Match`, `If-None-Match: *` and `?mode=draft` — the composed-host pin of
 * #22141's write preconditions.
 *
 * ## What this pins
 *
 * A host that mounts only `@objectstack/hono`'s `${prefix}/*` catch-all has no
 * `RestServer`: every `/meta` save goes catch-all → `HttpDispatcher.dispatch()`
 * → `handleMetadataRequest`'s `PUT` branch, which reads the precondition and
 * the lifecycle through `metaSaveRequestOptions` (`@objectstack/rest`). That
 * read sees the request only through what the catch-all hands `dispatch()`:
 *
 *  - the two headers ride `{ request: c.req.raw }` — the raw Fetch `Request`,
 *    read as `context.request.headers`;
 *  - `?mode` rides the query argument the catch-all flattens from the URL.
 *
 * `packages/runtime`'s `meta-save-preconditions-parity.test.ts` holds the
 * dispatcher's half by repeating the catch-all's statements into `dispatch()`;
 * it cannot reach the adapter itself (see below). These rows go through
 * `app.request(...)`, so the adapter's hand-off is in the path: if the
 * catch-all stopped handing on the raw `Request`, dropped its headers or its
 * query, the rows here go red. Each row reads the STORE after the request, not
 * only the answer on the wire.
 *
 * The four rows are the card's: a stale `If-Match`, `If-None-Match: *` over an
 * existing row, `?mode=draft`, and the unguarded control.
 *
 * ## ⚠️ Why this lives HERE and not in `packages/adapters/hono` or `packages/runtime`
 *
 * `packages/adapters/hono/vitest.config.ts` aliases `@objectstack/runtime` to a
 * stub, and `packages/runtime` cannot depend on `@objectstack/hono` (that
 * package depends on it). This package boots the two for real:
 * `@objectstack/hono` is aliased to this checkout's adapter SOURCE (the
 * subject), and `@objectstack/runtime` resolves through its `dist/` (a
 * ledgered pair in `scripts/check-test-source-alias.mjs`), so a runtime change
 * reaches these rows once that package is rebuilt, as CI builds it.
 *
 * ## The rig
 *
 * The read-side twin (`hono-meta-item-read-gate.conformance.test.ts`) answers
 * reads from a stub protocol, which keeps no version and no draft, so a save
 * there could not be refused or staged. Here the protocol is the real one:
 * `ObjectQLPlugin`'s built-in assembly registers `ObjectStackProtocolImplementation`
 * and the `sys_metadata*` objects, over an in-memory SQLite (pure-JS WASM)
 * driver handed to it as a `driver.*` service. The one stubbed seam is the
 * dispatcher's identity step, as in the read-side twin: every request is the
 * same author holding `manage_metadata`, so no row depends on the request for
 * who the caller is.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HttpDispatcher } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';
/** An author: `manage_metadata` saves, and reads drafts. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (name: string, label: string) => ({
    name,
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

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

interface Answer { status: number; body: any }
interface SaveOptions { headers?: Record<string, string>; query?: Record<string, string> }

/** The real store, the real protocol over it, and the REAL `createHonoApp` over both. */
async function boot() {
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();

    const kernel = new LiteKernel();
    liveKernels.push(kernel);
    kernel.use({
        name: 'test-meta-save-driver',
        version: '1.0.0',
        init: (c: any) => { c.registerService('driver.memory', driver); },
    } as any);
    kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerObject(TASK as any);
    await ql.syncObjectSchema('task');

    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
        .mockImplementation(async () => clone(AUTHOR));

    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX, cors: false });

    const send = async (method: 'PUT' | 'GET', name: string, { headers = {}, query = {} }: SaveOptions, body?: unknown): Promise<Answer> => {
        const url = new URL(`http://localhost${PREFIX}/meta/view/${name}`);
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
        const res = await app.request(url.toString(), {
            method,
            headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: res.status, body: JSON.parse(await res.text()) };
    };

    return {
        save: (name: string, label: string, opts: SaveOptions = {}) => send('PUT', name, opts, view(name, label)),
        read: (name: string, query: Record<string, string> = {}) => send('GET', name, { query }),
        /** The stored labels of a view, by lifecycle — the store, not the door's word for it. */
        stored: async (name: string, state: 'active' | 'draft'): Promise<string[]> => {
            const rows = await ql.find('sys_metadata', { where: { type: 'view', name, state } });
            return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)).label as string);
        },
    };
}

/** A save the host accepted: `200`, `success: true`, and the receipt. */
const accepted = (a: Answer) => {
    expect({ status: a.status, success: a.body?.success }, JSON.stringify(a.body)).toEqual({ status: 200, success: true });
    return a.body.data;
};

/** A save the host refused: the ADR-0112 envelope, status and nested `code` both. */
const refused = (a: Answer) => ({ status: a.status, success: a.body?.success, code: a.body?.error?.code });

describe('[#22221] a real createHonoApp host: PUT /meta/:type/:name honours If-Match, If-None-Match and ?mode=draft', () => {
    it('control: an unguarded save writes the active row, and the last writer wins', async () => {
        const host = await boot();
        expect(accepted(await host.save('case_grid', 'v1')).state).toBe('active');
        expect(accepted(await host.save('case_grid', 'v2')).state).toBe('active');

        expect(await host.stored('case_grid', 'active')).toEqual(['v2']);
        expect(await host.stored('case_grid', 'draft')).toEqual([]);
    }, 60_000);

    it('a stale If-Match: 409 METADATA_CONFLICT, the stored row unchanged; the current token still saves', async () => {
        const host = await boot();
        const first = accepted(await host.save('case_grid', 'v1'));
        const second = accepted(await host.save('case_grid', 'v2'));
        expect(second.version).not.toBe(first.version);

        const stale = await host.save('case_grid', 'v3 over a stale read', { headers: { 'If-Match': first.version } });
        expect(refused(stale)).toEqual({ status: 409, success: false, code: 'METADATA_CONFLICT' });
        expect(await host.stored('case_grid', 'active')).toEqual(['v2']);

        // Preservation: the token the last receipt served still pins a save.
        accepted(await host.save('case_grid', 'v3', { headers: { 'If-Match': second.version } }));
        expect(await host.stored('case_grid', 'active')).toEqual(['v3']);
    }, 60_000);

    it('If-None-Match: * over an existing row: 409 METADATA_CONFLICT, the stored row unchanged', async () => {
        const host = await boot();
        accepted(await host.save('fresh_grid', 'first', { headers: { 'If-None-Match': '*' } }));
        expect(await host.stored('fresh_grid', 'active')).toEqual(['first']);

        const again = await host.save('fresh_grid', 'second', { headers: { 'If-None-Match': '*' } });
        expect(refused(again)).toEqual({ status: 409, success: false, code: 'METADATA_CONFLICT' });
        expect(await host.stored('fresh_grid', 'active')).toEqual(['first']);
    }, 60_000);

    it('?mode=draft stages a draft: the active row unchanged, the draft read back through ?state=draft', async () => {
        const host = await boot();
        accepted(await host.save('case_grid', 'live'));

        expect(accepted(await host.save('case_grid', 'staged', { query: { mode: 'draft' } })).state).toBe('draft');
        expect(await host.stored('case_grid', 'active')).toEqual(['live']);
        expect(await host.stored('case_grid', 'draft')).toEqual(['staged']);

        // The doors the platform reads it through, on the same host: the draft
        // read answers the staged row, the plain read still the active one.
        const draftRead = await host.read('case_grid', { state: 'draft' });
        expect(draftRead.status, JSON.stringify(draftRead.body)).toBe(200);
        expect(draftRead.body?.data?.item?.label).toBe('staged');
        const plainRead = await host.read('case_grid');
        expect(plainRead.status, JSON.stringify(plainRead.body)).toBe(200);
        expect(plainRead.body?.data?.item?.label).toBe('live');
    }, 60_000);
});
