// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling record 6257816853, slice 5 letter A] Who the `/auth/me` door names,
 * on every wiring of the services it reads.
 *
 * The door is `makeExecutionContextResolver`, the resolver all three
 * current-user routes call and the named export cloud's serverless host
 * composes directly (cloud#924). It is driven here through that export, over
 * 18 wirings of the auth service, its session read, the data engine and the
 * services beside them. Each row pins the door's answer: no context, the
 * signed-in caller with the organization it resolves in, or the
 * authorization-store outage the host answers as its `503`.
 *
 * Before ruling record 6257816853 the door composed its own resolution, and a
 * measurement of it against `resolveRequestExecutionContext` under this door's
 * parameters read the same answer on 15 of these wirings. The other 3 are the
 * three session reads that carry `session.userId` and no `user.id`: the
 * hand-written door dropped them as signed out, and the composition reads
 * `user.id ?? session.userId`. Under the ruling the door calls the composition
 * and adopts its reading, so those three now answer signed in as that user,
 * and the other 15 keep the answers they had.
 *
 * Each row also asks the composition, under the parameters this door declares
 * ({@link DOOR_PARAMETERS}), and requires the same answer. The one difference
 * is the door's own `catch`: the composition propagates every rejection, and
 * the door answers each one but the authorization-store outage as no context
 * (an auth service whose `getApi()` rejects is the wiring that shows it).
 */

import { describe, expect, it } from 'vitest';
import {
    hashApiKey,
    isAuthzStoreUnavailableError,
    resolveRequestExecutionContext,
    type RequestExecutionContextInput,
} from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { makeExecutionContextResolver } from './current-user-endpoints';

const ORG = 'org_alpha';
const OTHER_ORG = 'org_other';
const KEY = 'osk_resolver_wirings_key';
const FUTURE = '2999-01-01T00:00:00Z';
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };

/** The parameters this door declares to the composition. */
const DOOR_PARAMETERS: Omit<RequestExecutionContextInput, 'headers' | 'ql' | 'authService'> = {
    tenancy: undefined,
    anonymous: 'fail-closed',
    authGate: 'withhold',
    credentials: 'session-only',
    sessionApi: 'required',
    session: 'request',
    localization: 'withhold',
    requestLocale: undefined,
    accessToken: 'withhold',
    oauth: undefined,
    onAdmission: undefined,
};

type Row = Record<string, unknown>;

/**
 * An engine answering the grant tables. `u1` is a member of {@link ORG} only,
 * and the key belongs to `u_key`, a member too, so a door that admitted the
 * key would name somebody. `failMembers`: the permission store's membership
 * read fails (the outage).
 */
function engine(opts: { failMembers?: boolean } = {}) {
    const tables: Record<string, Row[]> = {
        sys_api_key: [{ id: 'k1', key: hashApiKey(KEY), revoked: false, user_id: 'u_key', active_organization_id: ORG, expires_at: FUTURE }],
        sys_user: [{ id: 'u1', email: 'u1@example.com' }, { id: 'u_key', email: 'key@example.com' }],
        sys_member: [
            { user_id: 'u1', organization_id: ORG, role: 'admin' },
            { user_id: 'u_key', organization_id: ORG, role: 'member' },
        ],
        sys_user_position: [],
        sys_user_permission_set: [],
        sys_position: [],
        sys_position_permission_set: [],
        sys_permission_set: [],
    };
    const matches = (row: Row, where: Row | undefined) => Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
        if (v !== null && typeof v === 'object') {
            const list = (v as { $in?: unknown[] }).$in;
            if (!Array.isArray(list)) throw new Error(`fixture: unsupported operator on ${k}`);
            return list.includes(row[k] ?? null);
        }
        return (row[k] ?? null) === (v ?? null);
    });
    return {
        async find(object: string, q: { where?: Row; limit?: number } = {}) {
            if (opts.failMembers && object === 'sys_member') throw new Error('connection refused');
            const rows = (tables[object] ?? []).filter((row) => matches(row, q.where));
            return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        registry: { getAllApps: () => [], getAllObjects: () => [] },
        getSchema: () => undefined,
    };
}

/** What the door answers: no context, the caller it names, or the outage. */
type Answer = 'none' | 'outage' | { userId: string; tenantId: string };

interface Wiring {
    name: string;
    /** How the auth service exposes its session read, if there is one. */
    auth: 'none' | 'no-session-api' | 'api' | 'getApi' | 'getApi-rejects';
    /** What the session read answers (or throws), for every request. */
    session?: () => unknown;
    headers?: Record<string, string>;
    failMembers?: true;
    /** Services registered beside the auth service; the door reads neither. */
    tenancy?: unknown;
    settings?: unknown;
    answer: Answer;
}

const read = (value: unknown) => () => value;
const signedIn = (tenantId: string = ORG): Answer => ({ userId: 'u1', tenantId });
const SESSION = { user: { id: 'u1', email: 'u1@example.com' }, session: { id: 'sess_1', userId: 'u1', token: 'bearer_1', activeOrganizationId: ORG } };

const WIRINGS: Wiring[] = [
    { name: 'no auth service', auth: 'none', answer: 'none' },
    { name: 'an auth service with neither `api` nor `getApi`', auth: 'no-session-api', answer: 'none' },
    { name: "an auth service whose `getApi()` rejects (the door's catch answers it)", auth: 'getApi-rejects', answer: 'none' },
    { name: 'the session read answers null', auth: 'api', session: read(null), answer: 'none' },
    { name: 'the session read answers undefined', auth: 'api', session: read(undefined), answer: 'none' },
    { name: 'the session read throws', auth: 'api', session: () => { throw new Error('session backend unavailable'); }, answer: 'none' },
    { name: 'a full session through `api`', auth: 'api', session: read(SESSION), answer: signedIn() },
    { name: 'a full session through `getApi()`', auth: 'getApi', session: read(SESSION), answer: signedIn() },
    {
        name: 'a session the authentication policy holds (ADR-0069): served, and no posture is carried',
        auth: 'api',
        session: read({ user: { id: 'u1', authGate: PASSWORD_EXPIRED }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
    {
        name: 'Accept-Language beside a settings service: no locale or time zone is resolved',
        auth: 'api',
        headers: { 'accept-language': 'zh-CN' },
        settings: { get: async () => ({ value: 'Europe/Paris' }) },
        session: read({ user: { id: 'u1' }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
    {
        name: "a walled tenancy service: no posture is read, so the session's claimed organization stands",
        auth: 'api',
        tenancy: { posture: 'isolated' },
        session: read({ user: { id: 'u1' }, session: { userId: 'u1', activeOrganizationId: OTHER_ORG } }),
        answer: signedIn(OTHER_ORG),
    },
    { name: 'an API key alone: this door opens no API-key door', auth: 'api', headers: { 'x-api-key': KEY }, session: read(null), answer: 'none' },
    {
        name: 'an API key beside a session: the session names the caller',
        auth: 'api',
        headers: { 'x-api-key': KEY },
        session: read({ user: { id: 'u1' }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
    {
        name: 'a permission store that cannot be read is the outage',
        auth: 'api',
        failMembers: true,
        session: read({ user: { id: 'u1' }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: 'outage',
    },
    {
        name: 'an empty `user.id` beside `session.userId` names nobody',
        auth: 'api',
        session: read({ user: { id: '' }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: 'none',
    },
    // The composition's reading (ruling record 6257816853 item 1): a session
    // read that carries `session.userId` and no `user.id` names that user.
    {
        name: 'the ruled reading: `session.userId` with no user names that user',
        auth: 'api',
        session: read({ session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
    {
        name: 'the ruled reading: `session.userId` beside a user with no id names that user',
        auth: 'api',
        session: read({ user: { email: 'u1@example.com' }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
    {
        name: 'the ruled reading: `session.userId` beside `user.id: null` names that user',
        auth: 'api',
        session: read({ user: { id: null }, session: { userId: 'u1', activeOrganizationId: ORG } }),
        answer: signedIn(),
    },
];

function authService(w: Wiring): unknown {
    const api = { getSession: async () => w.session?.() };
    // A gate is active, and no posture holds a user by account: neither moves
    // a row, since this door carries no gate.
    const beside = { isAuthGateActive: () => true, resolveUserAuthGates: async () => [] };
    switch (w.auth) {
        case 'none': return undefined;
        case 'no-session-api': return beside;
        case 'api': return { api, ...beside };
        case 'getApi': return { getApi: async () => api, ...beside };
        case 'getApi-rejects': return { getApi: async () => { throw new Error('getApi down'); }, ...beside };
    }
}

/** A call settled into a reading of its own, so a rejection is a reading too. */
interface Settled {
    threw: boolean;
    context?: ExecutionContext;
    rejected?: unknown;
}

async function settle(call: () => Promise<ExecutionContext | undefined>): Promise<Settled> {
    try {
        return { threw: false, context: await call() };
    } catch (err) {
        return { threw: true, rejected: err };
    }
}

describe('[ruling 6257816853] the /auth/me door names the caller on every wiring of the services it reads', () => {
    it('declares every wiring once', () => {
        expect(WIRINGS).toHaveLength(18);
        expect(new Set(WIRINGS.map((w) => w.name)).size).toBe(WIRINGS.length);
    });

    it.each(WIRINGS)('$name', async (w) => {
        const ql = engine({ failMembers: w.failMembers });
        const auth = authService(w);
        const services: Record<string, unknown> = { objectql: ql };
        if (auth !== undefined) services.auth = auth;
        if (w.tenancy !== undefined) services.tenancy = w.tenancy;
        if (w.settings !== undefined) services.settings = w.settings;
        const headers = new Headers(w.headers ?? {});

        const door = await settle(() =>
            makeExecutionContextResolver({ getService: <T,>(name: string) => services[name] as T | undefined })({ req: { raw: { headers } } }),
        );
        const composition = await settle(() => resolveRequestExecutionContext({
            headers,
            ql,
            authService: auth as RequestExecutionContextInput['authService'],
            ...DOOR_PARAMETERS,
        }));

        if (w.answer === 'outage') {
            expect(isAuthzStoreUnavailableError(door.rejected)).toBe(true);
            expect(isAuthzStoreUnavailableError(composition.rejected)).toBe(true);
            return;
        }
        expect(door.threw).toBe(false);
        if (w.answer === 'none') {
            expect(door.context).toBeUndefined();
            // The composition answers no context too, or rejects with something
            // other than the outage, which the door's `catch` answers as none.
            if (composition.threw) {
                expect(isAuthzStoreUnavailableError(composition.rejected)).toBe(false);
            } else {
                expect(composition.context).toBeUndefined();
            }
            return;
        }
        expect(door.context).toMatchObject({ userId: w.answer.userId, tenantId: w.answer.tenantId, principalKind: 'human', isSystem: false });
        // Withheld by this door: the ADR-0069 posture, the session bearer, and
        // the localization the endpoints resolve for themselves.
        expect(door.context?.authGate).toBeUndefined();
        expect(door.context?.accessToken).toBeUndefined();
        expect(door.context?.locale).toBeUndefined();
        expect(door.context?.timezone).toBeUndefined();
        expect(door.context).toEqual(composition.context);
    });

    it("CONTROL: the wiring the door's catch answers is a rejection of the composition", async () => {
        // Without this, the `getApi()` row could pass on a composition that
        // swallowed the rejection itself, and the door's catch would go unread.
        const w = WIRINGS.find((row) => row.auth === 'getApi-rejects')!;
        const composition = await settle(() => resolveRequestExecutionContext({
            headers: new Headers(),
            ql: engine(),
            authService: authService(w) as RequestExecutionContextInput['authService'],
            ...DOOR_PARAMETERS,
        }));
        expect(composition.threw).toBe(true);
        expect((composition.rejected as Error | undefined)?.message).toBe('getApi down');
    });
});
