// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26816] `GET /data/:object/:id` answers one request one way on both hosts:
 * `RestServer`'s route and the runtime dispatcher's twin, over ONE store with
 * the REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`).
 *
 * Measured on the base (`5787df4d4b`): the dispatcher answered a malformed
 * query on an existing record `400`, `RestServer` answered it `404` (its catch
 * rewrote every mapped `400`), so a client told "no such record" by one host
 * was told "fix your query" by the other. Both now answer `400`; the `404`s —
 * a missing id, and a row the caller's row scope hides — were already one
 * answer on both hosts and stay so.
 *
 * The REST door's own pin, with the reason the `404` needed no rewrite, is
 * `packages/rest/src/data-record-read-malformed-query-door.test.ts`. The
 * dispatcher's `/data` domain does not catch `getData`'s throw, so it leaves
 * `dispatch()` and the HOST's exit renders it; both exits are asked through
 * their own readers (`declaredEnvelopeForThrow` for `@objectstack/hono`'s
 * catch-all, `resolveThrownHttpError` for `dispatcher-plugin`), ⛔ not
 * restated — the rig of `data-empty-projection-count.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from '@objectstack/rest';
import { declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const PREFIX = '/api/v1';
const OBJECT = 'by_id_parity_26816';
const ME = 'usr_26816_member';
const OTHER = 'usr_26816_other';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member',
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    // The caller reads its own rows only.
    rowLevelSecurity: [{ name: 'own_rows', object: OBJECT, operation: 'select', using: 'record.owner == current_user.id' }],
});
const MEMBER_CTX = { userId: ME, positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const MINE = 'r_mine';
const HIDDEN = 'r_hidden';
const NOWHERE = 'r_nowhere';

/**
 * What a host answered, reduced to what both envelopes state: REST's flat
 * body (`error`, `code`, `field`) and the dispatcher's ADR-0112 one
 * (`error.message`, `error.code`, `error.details.field`).
 */
type Answer = { status: number; code?: string; field?: string; message?: string };

/** name · id · querystring · the status, code and field both hosts give. */
const CASES: ReadonlyArray<readonly [string, string, Record<string, string>, Omit<Answer, 'message'>]> = [
    ['own record ?select=nope (the card)', MINE, { select: 'nope' }, { status: 400, code: 'INVALID_FIELD', field: 'nope' }],
    ['own record ?select= (the card)', MINE, { select: '' }, { status: 400, code: 'VALIDATION_ERROR' }],
    ['own record ?select=,', MINE, { select: ',' }, { status: 400, code: 'VALIDATION_ERROR' }],
    ['own record ?expand=nope', MINE, { expand: 'nope' }, { status: 400, code: 'INVALID_FIELD', field: 'nope' }],
    ['hidden row ?select=nope', HIDDEN, { select: 'nope' }, { status: 400, code: 'INVALID_FIELD', field: 'nope' }],
    ['missing id ?select=nope', NOWHERE, { select: 'nope' }, { status: 400, code: 'INVALID_FIELD', field: 'nope' }],
    ['CONTROL missing id', NOWHERE, {}, { status: 404, code: 'RECORD_NOT_FOUND' }],
    ['CONTROL hidden row', HIDDEN, {}, { status: 404, code: 'RECORD_NOT_FOUND' }],
    ['CONTROL hidden row ?select=title', HIDDEN, { select: 'title' }, { status: 404, code: 'RECORD_NOT_FOUND' }],
    ['CONTROL own record ?select=title', MINE, { select: 'title' }, { status: 200 }],
    ['CONTROL own record', MINE, {}, { status: 200 }],
];

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = {
        write: () => true, end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

describe('[#26816] GET /data/:object/:id — RestServer and the dispatcher give one answer', () => {
    let engine: ObjectQL;
    let rest: (id: string, query: Record<string, string>) => Promise<Answer>;
    let dispatched: (id: string, query: Record<string, string>) => Promise<Answer>;

    beforeAll(async () => {
        engine = new ObjectQL();
        engine.registerDriver(
            new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
            true,
        );
        await engine.init();
        engine.registerApp({
            id: 'com.objectstack.qa.by-id-status-parity-26816',
            name: 'By-id read: one answer on both hosts',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJECT,
                    label: 'Ledger',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text' },
                        owner: { name: 'owner', type: 'text' },
                    },
                },
            ],
        } as never);
        await engine.syncSchemas();
        // A real `single` install's Default Organization (ADR-0131 D9, D1).
        await installDefaultOrganization(engine);

        const securityServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
                list: async () => [MEMBER_SET],
            },
        };
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: (name: string) => {
                if (!(name in securityServices)) throw new Error(`service not registered: ${name}`);
                return securityServices[name];
            },
        };
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);

        await engine.insert(OBJECT, [
            { id: MINE, title: 'mine', owner: ME },
            { id: HIDDEN, title: 'theirs', owner: OTHER },
        ], { context: SYS_CTX } as never);

        const protocol = new ObjectStackProtocolImplementation(engine as any);

        const server = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (server as any).resolveExecCtx = async () => ({ ...MEMBER_CTX });
        server.registerRoutes();
        const route = server.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id');
        expect(route).toBeDefined();
        rest = async (id, query) => {
            const res = makeRes();
            await route!.handler({ params: { object: OBJECT, id }, query, headers: {} } as any, res);
            const body = res._json;
            return { status: res._status ?? 200, code: body?.code, field: body?.field, message: body?.error };
        };

        // `callData`'s exposure gate reads the kernel's `metadata` service.
        const metadata = { getObject: async (name: string) => engine.registry.getObject(name) };
        const services: Record<string, unknown> = { protocol, metadata };
        const get = (n: string) => services[n] ?? null;
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
        const dispatcher = new HttpDispatcher(kernel);
        (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER_CTX });
        dispatched = async (id, query) => {
            const path = `/data/${OBJECT}/${id}`;
            const raw = new Request(`http://localhost${PREFIX}${path}`, { method: 'GET' });
            let returned: any;
            try {
                returned = await dispatcher.dispatch('GET', path, undefined, query, { request: raw } as any, PREFIX);
            } catch (thrown) {
                const envelope = declaredEnvelopeForThrow(thrown);
                const resolved = resolveThrownHttpError(thrown);
                // The two host exits must agree before either is believed.
                expect(envelope?.status, 'catch-all status').toBe(resolved.status);
                expect(envelope?.body.error.code, 'catch-all code').toBe(resolved.code);
                const details = envelope?.body.error.details as Record<string, unknown> | undefined;
                const field = details?.field;
                const message = envelope?.body.error.message;
                return {
                    status: resolved.status,
                    code: resolved.code,
                    field: typeof field === 'string' ? field : undefined,
                    message: typeof message === 'string' ? message : undefined,
                };
            }
            const res = returned.response;
            return { status: res.status, code: res.body?.error?.code, field: res.body?.error?.details?.field, message: res.body?.error?.message };
        };
    });

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    it.each(CASES)('%s: both hosts answer it the same', async (_name, id, query, expected) => {
        const viaRest = await rest(id, query);
        const viaDispatcher = await dispatched(id, query);

        const { message: restMessage, ...restAnswer } = viaRest;
        const { message: dispatcherMessage, ...dispatcherAnswer } = viaDispatcher;
        expect(restAnswer, 'RestServer').toEqual(expected);
        expect(dispatcherAnswer, 'the dispatcher').toEqual(expected);
        // One refusal, one sentence: the same text whichever host carried it.
        expect(restMessage, 'the refusal sentence').toBe(dispatcherMessage);
    });
});
