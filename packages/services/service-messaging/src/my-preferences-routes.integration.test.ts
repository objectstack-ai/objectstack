// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The caller's own notification preferences door,
 * `GET /api/v1/messaging/me/preferences` (rulings 6968686390 and 6969143776),
 * driven through the handler it mounts: the real platform resolver turns the
 * request's bearer into an execution context, the topic list is the real
 * preference options read, and the answer is the real `MessagingService`'s
 * resolver over a real `ObjectQL` / `SqlDriver` (better-sqlite3) holding two
 * organizations.
 *
 *  - the answer is the person's EFFECTIVE preferences, cell by cell equal to
 *    what `emit`'s filter decides for them (one implementation);
 *  - each cell says where it comes from: their row, the organization's
 *    default, the built-in default, or a mandatory topic;
 *  - nothing of another person, or of another organization, leaves the door:
 *    no row of theirs, no id, and no value of theirs decides a cell;
 *  - anonymous, a held sign-in and any query parameter are refused by
 *    envelope before anything is read; a source that cannot be read is a
 *    fault, never an "everything on" answer.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysNotification } from '@objectstack/platform-objects';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { MY_PREFERENCES_ROUTE, registerMyPreferencesRoutes } from './my-preferences-routes.js';
import { MessagingService } from './messaging-service.js';
import { NotificationPreference } from './objects/notification-preference.object.js';
import type { MessagingChannel } from './channel.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } } };
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

const ALICE = 'usr_alice';
const BOB = 'usr_bob';

/** The sessions the fake auth service knows, by bearer token. */
const SESSIONS: Record<string, { userId: string; organizationId?: string; authGate?: { code: string; message: string } }> = {
    alice: { userId: ALICE, organizationId: 'org_a' },
    nobody: { userId: 'usr_loner' },
    held: { userId: ALICE, organizationId: 'org_a', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
};

const MEMBERSHIPS = [{ id: 'mem_alice', user_id: ALICE, organization_id: 'org_a', role: 'member' }];

/** Topics `security.*` are mandatory on this deployment. */
const MANDATORY = ['security.'];

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
    vi.restoreAllMocks();
});

const sys = (organization: string) => ({ context: { isSystem: true, tenantId: organization } as ExecutionContext });

async function boot(): Promise<ObjectQL> {
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysNotification, NotificationPreference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'isolated');
    for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, { context: { isSystem: true } as ExecutionContext });
    for (const id of [ALICE, BOB]) await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: { isSystem: true } as ExecutionContext });
    engine = ql;
    return ql;
}

/** A preference row stored in `organization`, as the Setup grid or the person writes it. */
async function pref(ql: ObjectQL, organization: string, row: Record<string, unknown>): Promise<string> {
    return String((await ql.insert('sys_notification_preference', row, sys(organization))).id);
}

function channel(id: string): MessagingChannel {
    return { id, send: async () => ({ status: 'sent' }) } as unknown as MessagingChannel;
}

function door(ql: ObjectQL, opts: { failFlows?: boolean } = {}) {
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const http = {
        get: vi.fn((path: string, handler: (req: unknown, res: unknown) => Promise<void>) => handlers.set(`GET ${path}`, handler)),
        post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn(),
    };
    const auth = {
        api: {
            getSession: vi.fn(async (input: { headers: Headers }) => {
                const bearer = input.headers.get('authorization')?.replace(/^Bearer /, '');
                const s = bearer ? SESSIONS[bearer] : undefined;
                if (!s) return null;
                return {
                    user: { id: s.userId, email: `${s.userId}@example.test`, ...(s.authGate ? { authGate: s.authGate } : {}) },
                    session: { id: `ses_${bearer}`, userId: s.userId, activeOrganizationId: s.organizationId },
                };
            }),
        },
    };
    // inbox mounted; email known, its transport absent.
    const service = new MessagingService({ logger: silent, getData: () => ql as never, mandatoryTopics: MANDATORY });
    service.registerChannel(channel('inbox'));
    service.registerChannelProvider('email', () => undefined);

    const find = vi.spyOn(ql, 'find');
    const effective = vi.spyOn(service, 'effectivePreferencesFor');
    registerMyPreferencesRoutes(http as never, {
        getEngine: () => ({
            find: async (object: string, q: any = {}) => {
                if (object !== 'sys_member') return [];
                const rows = MEMBERSHIPS.filter((row) => Object.entries(q?.where ?? {}).every(([k, v]) => {
                    if (k.startsWith('$')) throw new Error(`membership double: ${k} is not implemented`);
                    return (row as Record<string, unknown>)[k] === v;
                }));
                return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
            },
        }),
        getAuth: () => auth as never,
        tenancy: undefined,
        knownChannels: () => service.getKnownChannels(),
        getData: () => ql as never,
        readFlows: async () => {
            if (opts.failFlows) throw new Error('the flow list could not be read');
            return [];
        },
        effectivePreferences: (userId, organizationId, topics, channels) =>
            service.effectivePreferencesFor(userId, organizationId, topics, channels),
    });

    async function call(o: { bearer?: string; query?: Record<string, string> } = {}) {
        const handler = handlers.get(`GET ${MY_PREFERENCES_ROUTE}`);
        if (!handler) throw new Error('the door mounted no GET handler at its route');
        const answer: { status: number; body: any } = { status: 0, body: undefined };
        const res = {
            status: (code: number) => { answer.status = code; return res; },
            json: (body: unknown) => { answer.body = body; },
            header: () => res,
            send: () => undefined,
        };
        await handler(
            { params: {}, query: o.query ?? {}, headers: o.bearer ? { authorization: `Bearer ${o.bearer}` } : {}, method: 'GET', path: MY_PREFERENCES_ROUTE },
            res,
        );
        expect(envelopeViolations(answer.body), JSON.stringify(answer.body)).toEqual([]);
        return answer;
    }

    return { call, find, effective, service };
}

function envelope(answer: { status: number; body: any }): [unknown, number] {
    expect(answer.body?.success).toBe(false);
    expect(ApiErrorSchema.safeParse(answer.body.error).success, JSON.stringify(answer.body.error)).toBe(true);
    return [answer.body.error.code, answer.status];
}

const topicOf = (data: any, topic: string) => data.topics.find((t: any) => t.topic === topic);
const cellOf = (data: any, topic: string, ch: string) => topicOf(data, topic)?.channels.find((c: any) => c.channel === ch);

describe('the caller\'s own preferences door — mounted', () => {
    it('registers exactly one route: GET /api/v1/messaging/me/preferences', () => {
        const http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn() };
        registerMyPreferencesRoutes(http as never, {} as never);
        expect(http.get.mock.calls.map((c) => c[0])).toEqual(['/api/v1/messaging/me/preferences']);
        for (const verb of ['post', 'put', 'patch', 'delete', 'use'] as const) expect(http[verb]).not.toHaveBeenCalled();
    });
});

describe('the caller\'s own preferences door — the effective matrix', () => {
    it('answers each cell with its value and where it comes from, and the general settings', async () => {
        const ql = await boot();
        // The organization's defaults.
        await pref(ql, 'org_a', { topic: 'approval.reminder', channel: 'email', enabled: false });
        await pref(ql, 'org_a', { topic: 'approval.comment', channel: '*', enabled: false });
        await pref(ql, 'org_a', { topic: '*', channel: '*', enabled: true, digest: 'daily' });
        // Alice's own rows.
        const ownReminder = await pref(ql, 'org_a', { user_id: ALICE, topic: 'approval.reminder', channel: 'inbox', enabled: false });
        const ownMandatory = await pref(ql, 'org_a', { user_id: ALICE, topic: 'security.access_upgrade', channel: 'email', enabled: false });
        const ownCustom = await pref(ql, 'org_a', { user_id: ALICE, topic: 'custom.only_mine', channel: 'slack', enabled: false });
        const d = door(ql);

        const answer = await d.call({ bearer: 'alice' });
        expect(answer.status).toBe(200);
        const data = answer.body.data;

        // Columns: every known channel, then a channel only her own rows name.
        expect(data.channels).toEqual([
            { channel: 'inbox', configured: true },
            { channel: 'email', configured: false },
            { channel: 'slack', configured: false },
        ]);
        // Rows: `*` first, the catalogue, then a topic only her own rows name.
        expect(data.topics[0]).toMatchObject({ topic: '*', wildcard: true, mandatory: false });
        expect(data.topics.at(-1)).toMatchObject({ topic: 'custom.only_mine', wildcard: false });
        for (const t of data.topics) expect(t.channels.map((c: any) => c.channel)).toEqual(['inbox', 'email', 'slack']);

        expect(cellOf(data, 'approval.reminder', 'inbox')).toEqual({ channel: 'inbox', enabled: false, source: 'own', ownRowId: ownReminder });
        expect(cellOf(data, 'approval.reminder', 'email')).toEqual({ channel: 'email', enabled: false, source: 'default' });
        expect(cellOf(data, 'approval.comment', 'inbox')).toEqual({ channel: 'inbox', enabled: false, source: 'default' });
        expect(cellOf(data, 'approval.requested', 'inbox')).toEqual({ channel: 'inbox', enabled: true, source: 'default' });
        expect(cellOf(data, 'custom.only_mine', 'slack')).toEqual({ channel: 'slack', enabled: false, source: 'own', ownRowId: ownCustom });
        // A mandatory topic is on, whatever her row says, and still offers her row's id.
        expect(topicOf(data, 'security.access_upgrade').mandatory).toBe(true);
        expect(cellOf(data, 'security.access_upgrade', 'email')).toEqual({ channel: 'email', enabled: true, source: 'mandatory', ownRowId: ownMandatory });

        expect(data.general).toEqual({
            enabled: { value: true, source: 'default' },
            digest: { value: 'daily', source: 'default' },
            quietHours: { value: null, source: 'builtin' },
        });
    });

    it("her own general (*, *) row carries her quiet hours, and decides every cell no more specific row of hers decides", async () => {
        const ql = await boot();
        await pref(ql, 'org_a', { topic: 'approval.reminder', channel: 'email', enabled: false });
        await pref(ql, 'org_a', { topic: '*', channel: '*', enabled: true, digest: 'daily' });
        const ownGeneral = await pref(ql, 'org_a', {
            user_id: ALICE, topic: '*', channel: '*', enabled: true,
            quiet_hours: { tz: 'Europe/Berlin', start: '22:00', end: '07:00' },
        });
        const data = (await door(ql).call({ bearer: 'alice' })).body.data;
        expect(data.general).toEqual({
            ownRowId: ownGeneral,
            enabled: { value: true, source: 'own' },
            digest: { value: 'daily', source: 'default' },
            quietHours: { value: { tz: 'Europe/Berlin', start: '22:00', end: '07:00' }, source: 'own' },
        });
        // A person's rows come before the organization's in the lookup, so her (*, *) row
        // decides even where the default names the exact topic and channel.
        expect(cellOf(data, 'approval.reminder', 'email')).toEqual({ channel: 'email', enabled: true, source: 'own' });
    });

    it('with no row at all every cell is the built-in default: on', async () => {
        const ql = await boot();
        const data = (await door(ql).call({ bearer: 'alice' })).body.data;
        for (const t of data.topics) {
            for (const c of t.channels) expect(c).toEqual({ channel: c.channel, enabled: true, source: t.mandatory ? 'mandatory' : 'builtin' });
        }
        expect(data.general).toEqual({
            enabled: { value: true, source: 'builtin' },
            digest: { value: 'none', source: 'builtin' },
            quietHours: { value: null, source: 'builtin' },
        });
    });

    it('every cell equals what emit\'s filter decides for her (one implementation)', async () => {
        const ql = await boot();
        await pref(ql, 'org_a', { topic: 'collab.mention', channel: 'email', enabled: false });
        await pref(ql, 'org_a', { topic: '*', channel: 'inbox', enabled: false });
        await pref(ql, 'org_a', { user_id: ALICE, topic: 'collab.mention', channel: '*', enabled: true });
        await pref(ql, 'org_a', { user_id: ALICE, topic: 'approval.requested', channel: 'email', enabled: false });
        await pref(ql, 'org_a', { user_id: ALICE, topic: 'security.access_upgrade', channel: '*', enabled: false });
        const d = door(ql);
        const data = (await d.call({ bearer: 'alice' })).body.data;
        const resolver = (d.service as any).preferences;
        const channels = data.channels.map((c: any) => c.channel);
        for (const t of data.topics) {
            const [target] = await resolver.filter([ALICE], channels, { topic: t.topic, organizationId: 'org_a' });
            const accepted = target?.channels ?? [];
            expect(t.channels.filter((c: any) => c.enabled).map((c: any) => c.channel), t.topic).toEqual(accepted);
        }
    });

    it("nothing of another person or another organization leaves the door", async () => {
        const ql = await boot();
        const bobs = await pref(ql, 'org_a', { user_id: BOB, topic: 'deal.won', channel: 'inbox', enabled: false });
        const bobsGeneral = await pref(ql, 'org_a', { user_id: BOB, topic: '*', channel: '*', enabled: false, digest: 'weekly' });
        await pref(ql, 'org_b', { topic: 'approval.requested', channel: 'inbox', enabled: false });
        await pref(ql, 'org_b', { topic: '*', channel: '*', enabled: true, digest: 'weekly' });
        await pref(ql, 'org_b', { user_id: ALICE, topic: 'approval.requested', channel: 'email', enabled: false });
        const d = door(ql);
        const answer = await d.call({ bearer: 'alice' });
        const text = JSON.stringify(answer.body);
        for (const leaked of [BOB, bobs, bobsGeneral, 'deal.won']) expect(text).not.toContain(leaked);
        const data = answer.body.data;
        expect(cellOf(data, 'approval.requested', 'inbox')).toEqual({ channel: 'inbox', enabled: true, source: 'builtin' });
        expect(cellOf(data, 'approval.requested', 'email')).toEqual({ channel: 'email', enabled: true, source: 'builtin' });
        expect(data.general.digest).toEqual({ value: 'none', source: 'builtin' });
        // The read was the caller's organization's, by its term.
        const prefReads = d.find.mock.calls.filter((c) => c[0] === 'sys_notification_preference');
        expect(prefReads.length).toBe(1);
        expect((prefReads[0][1] as any).where).toEqual({ organization_id: 'org_a' });
    });

    it('a caller with no organization reads no preference row, and is answered the built-in defaults', async () => {
        const ql = await boot();
        await pref(ql, 'org_a', { topic: '*', channel: '*', enabled: false });
        const d = door(ql);
        const answer = await d.call({ bearer: 'nobody' });
        expect(answer.status).toBe(200);
        expect(d.find.mock.calls.filter((c) => c[0] === 'sys_notification_preference')).toEqual([]);
        expect(answer.body.data.general.enabled).toEqual({ value: true, source: 'builtin' });
    });
});

describe('the caller\'s own preferences door — refusals, before anything is read', () => {
    it('refuses an anonymous caller 401 UNAUTHENTICATED', async () => {
        const d = door(await boot());
        expect(envelope(await d.call())).toEqual(['UNAUTHENTICATED', 401]);
        expect(d.effective).not.toHaveBeenCalled();
    });

    it("refuses a held sign-in 403 with the policy's own code", async () => {
        const d = door(await boot());
        expect(envelope(await d.call({ bearer: 'held' }))).toEqual(['PASSWORD_EXPIRED', 403]);
        expect(d.effective).not.toHaveBeenCalled();
    });

    it('refuses any query parameter 400 VALIDATION_ERROR naming it — there is no asking about another person', async () => {
        const d = door(await boot());
        const answer = await d.call({ bearer: 'alice', query: { user: BOB } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(answer.body.error.message).toContain("'user'");
        expect(d.effective).not.toHaveBeenCalled();
        expect(d.find).not.toHaveBeenCalled();
    });

    it('answers a source it cannot read 500 INTERNAL_ERROR, never an "everything on" answer', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const d = door(await boot(), { failFlows: true });
        const answer = await d.call({ bearer: 'alice' });
        expect(envelope(answer)).toEqual(['INTERNAL_ERROR', 500]);
        expect(answer.body.data).toBeUndefined();
        error.mockRestore();
    });

    it('answers a preference read that fails 500 INTERNAL_ERROR: the matrix never fails open', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const ql = await boot();
        const d = door(ql);
        d.find.mockImplementation(async (object: string) => {
            if (object === 'sys_notification_preference') throw new Error('no such table');
            return [];
        });
        const answer = await d.call({ bearer: 'alice' });
        expect(envelope(answer)).toEqual(['INTERNAL_ERROR', 500]);
        error.mockRestore();
    });
});
