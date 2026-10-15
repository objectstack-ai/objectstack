// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23365] Through a REAL `createHonoApp` host, an escaped throw that carries a
 * declared ADR-0112 envelope is answered as that envelope by BOTH of the
 * adapter's catch arms — the composed-host pin.
 *
 * ## What this pins
 *
 * `createHonoApp` has two catch arms: the `${authMount}/*` mount's and the
 * `${prefix}/*` catch-all's around `HttpDispatcher.dispatch()`. Both used to
 * answer `errorJson(c, err.message || …, err.statusCode || 500)`, reading
 * `statusCode` only, so a throw that declared `status` and a registered `code`
 * lost both and answered `500 INTERNAL_ERROR`. Measured on this host before the
 * change, every declared row below answered `500 INTERNAL_ERROR`.
 *
 * Both arms now ask the ONE recogniser #16545 landed for the direct-mount
 * adapter (`declaredEnvelopeForThrow`, `@objectstack/plugin-hono-server`), so a
 * `createHonoApp` host and a `HonoHttpServer` host answer the same throw alike.
 * A throw the recogniser does not accept takes the arm's unchanged answer.
 *
 * Each declared row's producer is the REAL one, reached the way a caller
 * reaches it:
 *
 *  - a missing record — `recordNotFoundError` (`@objectstack/core`), raised by
 *    the real protocol's `getData` / `updateData` / `deleteData`;
 *  - a stale `If-Match` — the protocol's `ConcurrentUpdateError` (409);
 *  - `If-Match: ""` — the protocol's `MalformedVersionTokenError` (400);
 *  - an authorization-store outage — `AuthzStoreUnavailableError` (503),
 *    raised by the dispatcher's own ADR-0069 gate when an active gate's session
 *    read fails (`enforceAuthGate`, which sits above `dispatch()`'s `try`);
 *  - a restricted delete — the engine's referential `restrict` (409
 *    `DELETE_RESTRICTED`), and an unknown field filter or an unregistered
 *    object — the protocol's list normalizer (400 `INVALID_FIELD`) and its
 *    registry gate (404 `OBJECT_NOT_FOUND`).
 *
 * Each row reads the answer on the wire (status, `success`, nested
 * `error.code`), and the write rows also read the STORE afterwards.
 *
 * ## The other direction
 *
 * A throw that is NOT a declared envelope keeps the arm's answer: a bare
 * `Error` is still `500 INTERNAL_ERROR` carrying `code` and `message` only, with
 * no `cause` in the body; a throw that declares `statusCode` and no registered
 * code (the shape `callData`'s exposure gate throws) keeps the status it
 * declared. The declared 503 also carries no `cause`: the session read's own
 * failure stays off the wire.
 *
 * ## The auth-mount arm
 *
 * No in-repo producer was found that leaves `authService.handleRequest` with a
 * declared envelope: better-auth's router answers its own failures as a
 * `Response`. The arm takes the same rendering for uniformity — one rule, not
 * two — and its rows use a host-supplied auth service whose `handleRequest`
 * throws, which is the shape a host's own `IAuthService` could take.
 *
 * ## ⚠️ Why this lives HERE and not in `packages/adapters/hono`
 *
 * `packages/adapters/hono/vitest.config.ts` aliases `@objectstack/runtime` to a
 * stub, so no test there reaches the real dispatcher. Here `@objectstack/hono`
 * is aliased to this checkout's adapter SOURCE (the subject), and
 * `@objectstack/runtime` resolves through its `dist/` (a ledgered pair in
 * `scripts/check-test-source-alias.mjs`), as in the sibling
 * `hono-*.conformance.test.ts` files. `@objectstack/plugin-hono-server`, where
 * the recogniser lives, also resolves through its `dist/`, so a change there
 * reaches these rows once that package is rebuilt, which is how CI builds the
 * closure.
 *
 * ## The one seam that is stubbed
 *
 * WHO the caller is comes from the dispatcher's identity step
 * (`timedResolveExecutionContext`), replaced on the prototype with one member,
 * as in the sibling files. The protocol is the real one: `ObjectQLPlugin`
 * registers `ObjectStackProtocolImplementation` over an in-memory SQLite
 * (pure-JS WASM) driver. The two fallback controls on the catch-all replace one
 * protocol call with a throw of the shape under test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, AuthzStoreUnavailableError } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HttpDispatcher } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';
const MEMBER = { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] };
const MISSING_ID = 'no_such_row';
/** A version token that names a real instant, and never the stored one. */
const STALE_VERSION = '"2001-01-01T00:00:00.000Z"';
/** A cause's text, so a row can assert it never reaches the wire. */
const CAUSE_TEXT = 'SQLITE_BUSY: database is locked while reading sys_session';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** [#23587] A parent whose delete a child's `restrict` lookup refuses. */
const ACCOUNT = {
    name: 'account',
    label: 'Account',
    fields: {
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};
const CONTACT = {
    name: 'contact',
    label: 'Contact',
    fields: {
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        account: { name: 'account', type: 'lookup' as const, reference: 'account', label: 'Account', deleteBehavior: 'restrict' as const },
    },
};

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

/**
 * The real store, the real protocol over it, and the REAL `createHonoApp` over
 * both. `auth`, when given, is registered as the kernel's `auth` service.
 */
async function boot(auth?: Record<string, unknown>) {
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();

    const kernel = new LiteKernel();
    liveKernels.push(kernel);
    kernel.use({
        name: 'test-declared-envelope-services',
        version: '1.0.0',
        init: (c: any) => {
            c.registerService('driver.memory', driver);
            if (auth) c.registerService('auth', auth);
        },
    } as any);
    kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    for (const object of [TASK, ACCOUNT, CONTACT]) {
        ql.registerObject(object as any);
        await ql.syncObjectSchema(object.name);
    }

    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
        .mockImplementation(async () => ({ ...MEMBER }));

    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX, cors: false });

    const send = async (method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Answer> => {
        const res = await app.request(`http://localhost${PREFIX}${path}`, {
            method,
            headers: opts.body === undefined ? (opts.headers ?? {}) : { 'content-type': 'application/json', ...opts.headers },
            ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        });
        const text = await res.text();
        return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
    };

    /** A stored task, written through the engine, read back with its version. */
    const seed = async (name: string): Promise<string> => {
        const created: any = await ql.insert('task', { name });
        return String(created.id);
    };
    /** The stored names, by id — the store, not the door's word for it. */
    const stored = async (id: string): Promise<string | undefined> => {
        const rows: any[] = await ql.find('task', { where: { id } }) ?? [];
        return rows[0]?.name;
    };

    return { ql, send, seed, stored, protocol: kernel.getService<any>('protocol') };
}

/** The ADR-0112 envelope's three load-bearing slots. */
const envelope = (a: Answer) => ({ status: a.status, success: a.body?.success, code: a.body?.error?.code });

describe('[#23365] a real createHonoApp host: the dispatch() catch-all renders a declared envelope', () => {
    it('control: an existing record is served, and the rig answers 200', async () => {
        const host = await boot();
        const id = await host.seed('present');
        const answer = await host.send('GET', `/data/task/${id}`);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    }, 60_000);

    it.each(['GET', 'PATCH', 'DELETE'])('%s of a missing record: 404 RECORD_NOT_FOUND', async (method) => {
        const host = await boot();
        const answer = await host.send(method, `/data/task/${MISSING_ID}`, method === 'PATCH' ? { body: { name: 'x' } } : {});
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 404, success: false, code: 'RECORD_NOT_FOUND' });
    }, 60_000);

    it('PATCH with a stale If-Match: 409 CONCURRENT_UPDATE, and the stored row is unchanged', async () => {
        const host = await boot();
        const id = await host.seed('original');
        const answer = await host.send('PATCH', `/data/task/${id}`, { headers: { 'If-Match': STALE_VERSION }, body: { name: 'lost update' } });
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 409, success: false, code: 'CONCURRENT_UPDATE' });
        expect(await host.stored(id)).toBe('original');
    }, 60_000);

    it('DELETE with a stale If-Match: 409 CONCURRENT_UPDATE, and the row is still stored', async () => {
        const host = await boot();
        const id = await host.seed('kept');
        const answer = await host.send('DELETE', `/data/task/${id}`, { headers: { 'If-Match': STALE_VERSION } });
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 409, success: false, code: 'CONCURRENT_UPDATE' });
        expect(await host.stored(id)).toBe('kept');
    }, 60_000);

    it.each(['PATCH', 'DELETE'])('%s with If-Match: "" (the empty entity-tag): 400 VALIDATION_FAILED, the row untouched', async (method) => {
        const host = await boot();
        const id = await host.seed('untouched');
        const answer = await host.send(method, `/data/task/${id}`, {
            headers: { 'If-Match': '""' },
            ...(method === 'PATCH' ? { body: { name: 'unguarded write' } } : {}),
        });
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 400, success: false, code: 'VALIDATION_FAILED' });
        expect(await host.stored(id)).toBe('untouched');
    }, 60_000);

    it('an authorization-store outage (the ADR-0069 gate\'s session read fails): 503 SERVICE_UNAVAILABLE, no cause in the body', async () => {
        const host = await boot({
            isAuthGateActive: () => true,
            api: { getSession: async () => { throw new Error(CAUSE_TEXT); } },
        });
        const answer = await host.send('GET', `/data/task/${MISSING_ID}`);
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 503, success: false, code: 'SERVICE_UNAVAILABLE' });
        expect(answer.body.error).not.toHaveProperty('cause');
        expect(JSON.stringify(answer.body)).not.toContain(CAUSE_TEXT);
    }, 60_000);

    it('control: a bare Error is still 500 INTERNAL_ERROR, carrying code and message only, with no cause in the body', async () => {
        const host = await boot();
        const id = await host.seed('present');
        vi.spyOn(host.protocol, 'getData').mockRejectedValueOnce(new Error('handler fault', { cause: new Error(CAUSE_TEXT) }));
        const answer = await host.send('GET', `/data/task/${id}`);
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 500, success: false, code: 'INTERNAL_ERROR' });
        expect(Object.keys(answer.body.error).sort()).toEqual(['code', 'message']);
        expect(JSON.stringify(answer.body)).not.toContain(CAUSE_TEXT);
    }, 60_000);

    it('control: a throw declaring `statusCode` and no registered code keeps the status it declared', async () => {
        const host = await boot();
        const id = await host.seed('present');
        // The shape `callData` throws when the data service is missing.
        vi.spyOn(host.protocol, 'getData').mockRejectedValueOnce({ statusCode: 503, message: 'Data service not available' });
        const answer = await host.send('GET', `/data/task/${id}`);
        expect(answer.status, JSON.stringify(answer.body)).toBe(503);
        expect(answer.body).toEqual({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Data service not available' } });
    }, 60_000);
});

/**
 * [#23531] The stale-`If-Match` `409` above carries the server's
 * `currentVersion`, as `RestServer`'s does. The wire contract and
 * `ConcurrentUpdateError`'s docblock name it, and objectui's conflict bar reads
 * it. Before this card the body was `code` and `message` only.
 *
 * The field rides `error.details`, the wrapped envelope's declared context
 * slot, which is where `@objectstack/client` reads a wrapped body's context
 * from. `currentVersion` is proved by USE, not by spelling: echoed back as the
 * next `If-Match`, it is accepted ("Overwrite anyway" in the conflict bar), so
 * it is the record's real version token.
 *
 * `currentRecord` is asserted ABSENT. The real protocol below states it (the
 * system-context row its `probeRecord` read, thrown before the caller's write
 * policy runs), and `RestServer` forwards it. These doors hold it until the
 * producer answers #23586, so the absence is the door's doing, not the
 * producer's.
 */
describe('[#23531] a real createHonoApp host: the 409 CONCURRENT_UPDATE carries currentVersion, and holds currentRecord (#23586)', () => {
    it('PATCH with a stale If-Match: currentVersion in `error.details` and accepted when echoed; no currentRecord', async () => {
        const host = await boot();
        const id = await host.seed('original');
        const answer = await host.send('PATCH', `/data/task/${id}`, { headers: { 'If-Match': STALE_VERSION }, body: { name: 'lost update' } });
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 409, success: false, code: 'CONCURRENT_UPDATE' });

        const details = answer.body.error.details;
        expect(typeof details?.currentVersion, JSON.stringify(answer.body)).toBe('string');
        // Held until #23586: the protocol stated it, and the door does not forward it.
        expect(details, JSON.stringify(answer.body)).not.toHaveProperty('currentRecord');
        expect(JSON.stringify(answer.body)).not.toContain('original');
        expect(await host.stored(id)).toBe('original');

        const overwrite = await host.send('PATCH', `/data/task/${id}`, { headers: { 'If-Match': `"${details.currentVersion}"` }, body: { name: 'overwritten' } });
        expect(overwrite.status, JSON.stringify(overwrite.body)).toBe(200);
        expect(await host.stored(id)).toBe('overwritten');
    }, 60_000);

    it('DELETE with a stale If-Match: currentVersion in `error.details` and accepted when echoed; no currentRecord', async () => {
        const host = await boot();
        const id = await host.seed('kept');
        const answer = await host.send('DELETE', `/data/task/${id}`, { headers: { 'If-Match': STALE_VERSION } });
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 409, success: false, code: 'CONCURRENT_UPDATE' });

        const details = answer.body.error.details;
        expect(typeof details?.currentVersion, JSON.stringify(answer.body)).toBe('string');
        // Held until #23586: the protocol stated it, and the door does not forward it.
        expect(details, JSON.stringify(answer.body)).not.toHaveProperty('currentRecord');
        expect(JSON.stringify(answer.body)).not.toContain('kept');
        expect(await host.stored(id)).toBe('kept');

        const overwrite = await host.send('DELETE', `/data/task/${id}`, { headers: { 'If-Match': `"${details.currentVersion}"` } });
        expect(overwrite.status, JSON.stringify(overwrite.body)).toBe(200);
        expect(await host.stored(id)).toBeUndefined();
    }, 60_000);
});

/**
 * [#23587] The other structured refusals the real engine and protocol raise on
 * this host carry `RestServer`'s fields in `error.details`, as the `409
 * CONCURRENT_UPDATE` above carries `currentVersion`. Before this card each
 * answered `code` and `message` only. Measured on this host at `16abea884`:
 *
 *     DELETE /api/v1/data/account/ID   (a contact's `restrict` lookup names it)
 *       409 {"success":false,"error":{"code":"DELETE_RESTRICTED",
 *            "message":"This Account is still referenced by 1 Contact record(s) through …"}}
 *
 * while `RestServer`'s `mapDataError` answers the same throw with
 * `developerMessage`, `dependentObject` and `dependentCount` beside its code.
 * The `DELETE_RESTRICTED` row compares each field with the throw the engine
 * really raised, read off the protocol call, so the door is shown to relay the
 * producer's values rather than to spell its own. `object` is not among them:
 * that arm adds the ROUTE's object, and this recogniser has no route.
 */
describe('[#23587] a real createHonoApp host: a structured refusal carries RestServer’s fields in `error.details`', () => {
    it('DELETE of a restricted parent: 409 DELETE_RESTRICTED with the engine’s developerMessage, dependentObject and dependentCount; the row is kept', async () => {
        const host = await boot();
        const account: any = await host.ql.insert('account', { name: 'acme' });
        await host.ql.insert('contact', { name: 'ada', account: account.id });

        const produced: any[] = [];
        const deleteData = host.protocol.deleteData.bind(host.protocol);
        vi.spyOn(host.protocol, 'deleteData').mockImplementation(async (...args: any[]) => {
            try {
                return await deleteData(...args);
            } catch (thrown) {
                produced.push(thrown);
                throw thrown;
            }
        });

        const answer = await host.send('DELETE', `/data/account/${account.id}`);
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 409, success: false, code: 'DELETE_RESTRICTED' });

        // The real producer stated all three; without this the equality below
        // could hold between two absences.
        expect(produced).toHaveLength(1);
        expect(typeof produced[0].developerMessage, JSON.stringify(produced[0])).toBe('string');
        expect(answer.body.error.details, JSON.stringify(answer.body)).toEqual({
            developerMessage: produced[0].developerMessage,
            dependentObject: 'contact',
            dependentCount: 1,
        });
        expect(answer.body.error.message).toBe(produced[0].message);

        const kept: any[] = await host.ql.find('account', { where: { id: account.id } }) ?? [];
        expect(kept).toHaveLength(1);
    }, 60_000);

    it('GET with an unknown field filter: 400 INVALID_FIELD with the field and the object it names', async () => {
        const host = await boot();
        const answer = await host.send('GET', '/data/task?nosuchfield=1');
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 400, success: false, code: 'INVALID_FIELD' });
        expect(answer.body.error.details, JSON.stringify(answer.body)).toEqual({ field: 'nosuchfield', object: 'task' });
    }, 60_000);

    it('GET of an unregistered object: 404 OBJECT_NOT_FOUND with the object it names', async () => {
        const host = await boot();
        const answer = await host.send('GET', '/data/ghost');
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 404, success: false, code: 'OBJECT_NOT_FOUND' });
        expect(answer.body.error.details, JSON.stringify(answer.body)).toEqual({ object: 'ghost' });
    }, 60_000);
});

describe('[#23365] a real createHonoApp host: the auth-mount arm renders a declared envelope', () => {
    it('an auth service that throws a declared envelope: that envelope, with no cause in the body', async () => {
        const host = await boot({
            handleRequest: async () => { throw new AuthzStoreUnavailableError('sys_session', new Error(CAUSE_TEXT)); },
        });
        const answer = await host.send('GET', '/auth/get-session');
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 503, success: false, code: 'SERVICE_UNAVAILABLE' });
        expect(answer.body.error).not.toHaveProperty('cause');
        expect(JSON.stringify(answer.body)).not.toContain(CAUSE_TEXT);
    }, 60_000);

    it('control: an auth service that throws a bare Error is still 500 INTERNAL_ERROR, code and message only', async () => {
        const host = await boot({
            handleRequest: async () => { throw new Error('auth handler fault', { cause: new Error(CAUSE_TEXT) }); },
        });
        const answer = await host.send('GET', '/auth/get-session');
        expect(envelope(answer), JSON.stringify(answer.body)).toEqual({ status: 500, success: false, code: 'INTERNAL_ERROR' });
        expect(Object.keys(answer.body.error).sort()).toEqual(['code', 'message']);
        expect(JSON.stringify(answer.body)).not.toContain(CAUSE_TEXT);
    }, 60_000);
});
