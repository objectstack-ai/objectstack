// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23586] A `409 CONCURRENT_UPDATE` reports only what the caller may read —
 * with the REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a
 * real `SqlDriver`), at both doors of `PATCH` and `DELETE /data/:object/:id`:
 * `RestServer`'s routes and the runtime dispatcher's `/data` domain.
 *
 * ## What was wrong
 *
 * `updateData` / `deleteData` judge the caller's version token on the row
 * `probeRecord` reads with a SYSTEM context (an existence question, on
 * purpose), and they judge it before `engine.update` / `engine.delete` runs
 * the caller's write policy. The conflict carried that system-read row as
 * `currentRecord`. So a stale token got a member a row their RLS hides, or a
 * field their FLS hides, and the `409` itself (with `currentVersion`) told
 * them a hidden row exists where the same request without a token answers
 * `404`.
 *
 * ## What is held here, per door and per verb
 *
 *  - **A row the caller's RLS hides:** a stale token answers exactly what the
 *    same request without a token answers (the control): `404
 *    RECORD_NOT_FOUND`, the same status and the same body, with no
 *    `currentVersion` and no `currentRecord`. The row is untouched.
 *  - **The same, on an object the caller reads but may not write:** the write
 *    door answers first, so the control is its `403` — and a stale token, on
 *    the hidden row and on an id naming no row, gets that same `403` body. The
 *    comparison gives no answer of its own for a row the caller does not read.
 *    A row the caller reads there still conflicts `409`.
 *  - **A field the caller's FLS hides:** the `409`'s `currentRecord` does not
 *    carry it, as the caller's own read of the row does not.
 *  - **A row the caller may read whole (the positive control):** a stale token
 *    still answers `409` with the row and its version, so conflict detection
 *    is not weakened.
 *  - **A token that matches:** the request reads the store exactly as often as
 *    one with no token. Only the mismatch branch reads again.
 *
 * ## How each door is read
 *
 * `RestServer`: its registered handler, the auth boundary (`resolveExecCtx`)
 * stubbed, and the body it answered. The dispatcher: `/data` has no local
 * catch, so the protocol's throw reaches the host's exit; it is rendered here
 * through `declaredEnvelopeForThrow` (`plugin-hono-server`), the exit both
 * Hono hosts answer a throw with, and the thrown error itself is read too.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { EngineQueryOptions } from '@objectstack/spec/data';
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
const DATA = `${PREFIX}/data`;

/** The object with a row scope and a hidden field. */
const SCOPED = 'occ_vis_ledger';
/** An object no row or field rule names: the positive control. */
const PLAIN = 'occ_vis_plain';
/** An object the member reads but may not write, under the same row scope as {@link SCOPED}. */
const READONLY = 'occ_vis_readonly';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member',
    objects: {
        '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
        [READONLY]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    fields: { [`${SCOPED}.secret`]: { readable: false, editable: false } },
    rowLevelSecurity: [
        { name: 'region_scope', object: SCOPED, operation: 'all', using: "record.region != 'HIDDEN'" },
        { name: 'region_scope_readonly', object: READONLY, operation: 'all', using: "record.region != 'HIDDEN'" },
    ],
});

const MEMBER_CTX = { userId: 'usr_member', positions: [] as string[], permissions: [MEMBER_SET.name], posture: 'MEMBER' as const };

/** A well-formed instant no row here carries: a token read before a write that moved it. */
const STALE = '2000-01-01T00:00:00.000Z';

/** The row RLS hides from the member. */
const HIDDEN_ID = 'h1';
/** The row the member reads, without its `secret`. */
const MASKED_ID = 'v1';
/** The positive control's row. */
const PLAIN_ID = 'p1';
/** The row the member reads on {@link READONLY}. */
const READABLE_ID = 'r1';
/** An id that names no row anywhere. */
const MISSING_ID = 'occ_vis_missing';

/** A by-id read's options, typed to the engine's contract. */
const byId = (id: string, context: EngineQueryOptions['context']): EngineQueryOptions => ({ where: { id }, context });

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

interface Answer {
    status: number;
    body: any;
    /** The dispatcher only: the error the protocol threw, before the exit rendered it. */
    thrown?: any;
}

type Verb = 'PATCH' | 'DELETE';

interface Door {
    send(verb: Verb, object: string, id: string, headers?: Record<string, string>): Promise<Answer>;
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

/** The PATCH body every request below sends; DELETE carries none. */
const PATCH_BODY = { title: 'written' };

function restDoor(protocol: ObjectStackProtocolImplementation): Door {
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(MEMBER_CTX);
    rest.registerRoutes();
    const routeOf = (verb: Verb) => {
        const route = rest.getRoutes().find((r: any) => r.method === verb && r.path === `${DATA}/:object/:id`);
        if (!route) throw new Error(`${verb} ${DATA}/:object/:id is not registered`);
        return route;
    };
    return {
        send: async (verb, object, id, headers = {}) => {
            const res = makeRes();
            await routeOf(verb).handler({
                method: verb, path: `${DATA}/${object}/${id}`, params: { object, id },
                headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
                query: {},
                body: verb === 'PATCH' ? clone(PATCH_BODY) : undefined,
            }, res);
            return { status: res.statusCode, body: res.body };
        },
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()`, over a
 * real Fetch `Request` (the sibling `data-update-expected-version.test.ts`
 * spells the same statements), and the exit's rendering of a throw.
 */
function dispatcherDoor(protocol: ObjectStackProtocolImplementation): Door {
    const services: Record<string, unknown> = { protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(MEMBER_CTX);
    return {
        send: async (verb, object, id, headers = {}) => {
            const raw = new Request(`http://localhost${DATA}/${object}/${id}`, {
                method: verb,
                headers: { 'content-type': 'application/json', ...headers },
                ...(verb === 'PATCH' ? { body: JSON.stringify(PATCH_BODY) } : {}),
            });
            const url = new URL(raw.url);
            let body: unknown;
            try { body = JSON.parse(await raw.clone().text()); } catch { body = {}; }
            try {
                const res: any = await dispatcher.dispatch(verb, url.pathname.substring(PREFIX.length), body, {}, { request: raw } as any, PREFIX);
                return { status: res.response?.status ?? 0, body: res.response?.body };
            } catch (thrown) {
                const envelope = declaredEnvelopeForThrow(thrown);
                if (envelope) return { status: envelope.status, body: envelope.body, thrown };
                const resolved = resolveThrownHttpError(thrown);
                return { status: resolved.status, body: { code: resolved.code, message: resolved.message }, thrown };
            }
        },
    };
}

const ifMatch = (token: string) => ({ 'If-Match': `"${token}"` });

describe('[#23586] a 409 CONCURRENT_UPDATE reports only what the caller may read — the real security layer', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    const doors: Array<[string, Door]> = [];

    /** The row as the system reads it now (`null` once deleted). */
    const systemRow = async (object: string, id: string) =>
        (await engine.findOne(object, byId(id, SYS_CTX))) as any;
    /** The row's current version token, as the system reads it. */
    const versionOf = async (object: string, id: string): Promise<string> => {
        const row = await systemRow(object, id);
        const v = row?.updated_at instanceof Date ? row.updated_at.toISOString() : String(row?.updated_at ?? '');
        if (!v) throw new Error(`${object}/${id} carries no updated_at, so no version token exists to pin`);
        return v;
    };

    beforeAll(async () => {
        engine = new ObjectQL();
        engine.registerDriver(
            new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
            true,
        );
        await engine.init();
        engine.registerApp({
            id: 'com.objectstack.qa.occ-conflict-caller-visibility',
            name: 'OCC conflict caller visibility',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: SCOPED,
                    label: 'Ledger',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text' },
                        region: { name: 'region', type: 'text' },
                        secret: { name: 'secret', type: 'text' },
                    },
                },
                {
                    name: READONLY,
                    label: 'Read-only ledger',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text' },
                        region: { name: 'region', type: 'text' },
                    },
                },
                {
                    name: PLAIN,
                    label: 'Plain',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text' },
                        note: { name: 'note', type: 'text' },
                    },
                },
            ],
        } as never);
        await engine.syncSchemas();
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(engine);

        const services: Record<string, unknown> = {
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
                if (!(name in services)) throw new Error(`service not registered: ${name}`);
                return services[name];
            },
        };
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

        protocol = new ObjectStackProtocolImplementation(engine as any);
        doors.push(['RestServer', restDoor(protocol)], ['the dispatcher', dispatcherDoor(protocol)]);
    }, 60_000);

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    /** A fresh copy of the three rows, so each case starts from a known store. */
    async function seed(): Promise<void> {
        for (const [object, id] of [[SCOPED, HIDDEN_ID], [SCOPED, MASKED_ID], [PLAIN, PLAIN_ID], [READONLY, HIDDEN_ID], [READONLY, READABLE_ID]] as const) {
            if (await systemRow(object, id)) await engine.delete(object, { where: { id }, context: SYS_CTX } as any);
        }
        await engine.insert(SCOPED, [
            { id: HIDDEN_ID, title: 'hidden', region: 'HIDDEN', secret: 'hidden-secret' },
            { id: MASKED_ID, title: 'visible', region: 'NA', secret: 'masked-secret' },
        ], { context: SYS_CTX } as never);
        await engine.insert(PLAIN, [{ id: PLAIN_ID, title: 'plain', note: 'readable' }], { context: SYS_CTX } as never);
        await engine.insert(READONLY, [
            { id: HIDDEN_ID, title: 'hidden', region: 'HIDDEN' },
            { id: READABLE_ID, title: 'readable', region: 'NA' },
        ], { context: SYS_CTX } as never);
    }

    /** The body with the id it names written out, so the answers for two ids compare. */
    const withoutId = (body: unknown, id: string) => JSON.parse(JSON.stringify(body ?? null).split(id).join('ID'));

    const codeOf = (body: any): string | undefined =>
        body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
    /** Where either door puts a conflict's state: flat beside `code`, or in the envelope's `details`. */
    const conflictState = (body: any): Record<string, unknown> =>
        (body?.error && typeof body.error === 'object' ? body.error.details : body) ?? {};

    for (const verb of ['PATCH', 'DELETE'] as const) {
        for (const doorIndex of [0, 1]) {
            const doorName = doorIndex === 0 ? 'RestServer' : 'the dispatcher';
            const door = () => doors[doorIndex][1];

            describe(`${doorName}: ${verb} /data/:object/:id`, () => {
                it('a row RLS hides: a stale token answers exactly what the control (no token) answers — 404, no version, no record', async () => {
                    await seed();
                    const control = await door().send(verb, SCOPED, HIDDEN_ID);
                    expect({ status: control.status, code: codeOf(control.body) }, JSON.stringify(control.body))
                        .toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });

                    const stale = await door().send(verb, SCOPED, HIDDEN_ID, ifMatch(STALE));
                    // Indistinguishable: status, and the whole body (code, message, keys).
                    expect(stale.status, JSON.stringify(stale.body)).toBe(control.status);
                    expect(stale.body).toEqual(control.body);
                    const wire = JSON.stringify(stale.body);
                    expect(wire).not.toContain('currentVersion');
                    expect(wire).not.toContain('currentRecord');
                    expect(wire).not.toContain('hidden-secret');
                    if (stale.thrown !== undefined) {
                        // The dispatcher's throw itself carries no row and no version.
                        expect(stale.thrown.currentRecord).toBeUndefined();
                        expect(stale.thrown.currentVersion).toBeUndefined();
                        expect(stale.thrown.code).toBe(control.thrown?.code);
                    }
                    // Nothing was written.
                    expect(await systemRow(SCOPED, HIDDEN_ID)).toMatchObject({ title: 'hidden', secret: 'hidden-secret' });
                }, 60_000);

                it('a row RLS hides on an object the caller reads but may not write: a stale token answers the write door\'s 403, as the control does, and so does an id naming no row', async () => {
                    await seed();
                    const control = await door().send(verb, READONLY, HIDDEN_ID);
                    expect({ status: control.status, code: codeOf(control.body) }, JSON.stringify(control.body))
                        .toEqual({ status: 403, code: 'PERMISSION_DENIED' });

                    const stale = await door().send(verb, READONLY, HIDDEN_ID, ifMatch(STALE));
                    expect(stale.status, JSON.stringify(stale.body)).toBe(control.status);
                    expect(stale.body).toEqual(control.body);
                    const missing = await door().send(verb, READONLY, MISSING_ID, ifMatch(STALE));
                    expect(missing.status, JSON.stringify(missing.body)).toBe(control.status);
                    expect(withoutId(missing.body, MISSING_ID)).toEqual(withoutId(control.body, HIDDEN_ID));
                    expect(await systemRow(READONLY, HIDDEN_ID)).toMatchObject({ title: 'hidden' });

                    // A row the caller reads on the same object still conflicts: the record it is
                    // shown is one it can GET anyway.
                    const readable = await door().send(verb, READONLY, READABLE_ID, ifMatch(STALE));
                    expect({ status: readable.status, code: codeOf(readable.body) }, JSON.stringify(readable.body))
                        .toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
                    expect(await systemRow(READONLY, READABLE_ID)).toMatchObject({ title: 'readable' });
                }, 60_000);

                it('a field FLS hides: the 409 carries the row the caller reads, without that field', async () => {
                    await seed();
                    const version = await versionOf(SCOPED, MASKED_ID);
                    const stale = await door().send(verb, SCOPED, MASKED_ID, ifMatch(STALE));
                    expect({ status: stale.status, code: codeOf(stale.body) }, JSON.stringify(stale.body))
                        .toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
                    expect(conflictState(stale.body).currentVersion).toBe(version);
                    expect(JSON.stringify(stale.body)).not.toContain('masked-secret');

                    // The record the conflict holds is the caller's own read of the row.
                    const thrownRecord = stale.thrown?.currentRecord;
                    const record: any = doorIndex === 0 ? conflictState(stale.body).currentRecord : thrownRecord;
                    expect(record).toMatchObject({ id: MASKED_ID, title: 'visible', region: 'NA' });
                    expect(record).not.toHaveProperty('secret');
                    const callerRead: any = await engine.findOne(SCOPED, byId(MASKED_ID, clone(MEMBER_CTX)));
                    expect(callerRead).not.toHaveProperty('secret');
                    expect(record).toEqual(callerRead);

                    expect(await systemRow(SCOPED, MASKED_ID)).toMatchObject({ title: 'visible', secret: 'masked-secret' });
                }, 60_000);

                it('positive control: a row the caller reads whole still conflicts, with the whole row and its version', async () => {
                    await seed();
                    const version = await versionOf(PLAIN, PLAIN_ID);
                    const stale = await door().send(verb, PLAIN, PLAIN_ID, ifMatch(STALE));
                    expect({ status: stale.status, code: codeOf(stale.body) }, JSON.stringify(stale.body))
                        .toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
                    expect(conflictState(stale.body).currentVersion).toBe(version);
                    const record: any = doorIndex === 0 ? conflictState(stale.body).currentRecord : stale.thrown?.currentRecord;
                    expect(record).toEqual(await systemRow(PLAIN, PLAIN_ID));
                    expect(record).toMatchObject({ id: PLAIN_ID, title: 'plain', note: 'readable' });
                    // Not written.
                    expect(await systemRow(PLAIN, PLAIN_ID)).toMatchObject({ title: 'plain' });
                }, 60_000);

                it('a matching token reads the store exactly as often as no token, and is served', async () => {
                    const findOne = vi.spyOn(engine, 'findOne');
                    try {
                        await seed();
                        findOne.mockClear();
                        const plain = await door().send(verb, PLAIN, PLAIN_ID);
                        expect(plain.status, JSON.stringify(plain.body)).toBe(200);
                        const withoutToken = findOne.mock.calls.length;

                        await seed();
                        const version = await versionOf(PLAIN, PLAIN_ID);
                        findOne.mockClear();
                        const matched = await door().send(verb, PLAIN, PLAIN_ID, ifMatch(version));
                        expect(matched.status, JSON.stringify(matched.body)).toBe(200);
                        // Both verbs probe once more when a token is present and skip the probe without
                        // one: neither looks the record up ahead of the engine, which judges the write
                        // first. Nothing else is read on the match path.
                        expect(findOne.mock.calls.length).toBe(withoutToken + 1);
                    } finally {
                        findOne.mockRestore();
                    }
                }, 60_000);
            });
        }
    }
});
