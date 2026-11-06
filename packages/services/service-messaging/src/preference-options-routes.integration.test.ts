// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The preference options door, `GET /api/v1/messaging/preference-options`
 * (#30208 row 6, ruling E on #30527), driven through the handler it mounts:
 * the real platform resolver turns the request's bearer into an execution
 * context, and the stored topics are read from a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3) holding two organizations, on the `isolated`
 * posture.
 *
 *  - a member is served `*` first, then the platform's fixed topics, the
 *    topics this environment's flow notify steps send under, and their own
 *    organization's stored topics, each with its sources; and `*` first, then
 *    every known channel, a known one with no transport marked not configured;
 *  - a topic stored in one organization never appears for another (the
 *    isolation pin, ablated once in the PR);
 *  - anonymous, a held sign-in and a query parameter are refused by envelope
 *    before anything is read; a source that cannot be read is a fault, never a
 *    partial list.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysNotification } from '@objectstack/platform-objects';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { PREFERENCE_OPTIONS_ROUTE, registerPreferenceOptionsRoutes } from './preference-options-routes.js';
import { PLATFORM_NOTIFICATION_TOPICS } from './preference-options.js';
import { MessagingService } from './messaging-service.js';
import type { MessagingChannel } from './channel.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

/** The sessions the fake auth service knows, by bearer token. */
const SESSIONS: Record<string, { userId: string; organizationId?: string; authGate?: { code: string; message: string } }> = {
    alice: { userId: 'usr_alice', organizationId: 'org_a' },
    bob: { userId: 'usr_bob', organizationId: 'org_b' },
    held: { userId: 'usr_alice', organizationId: 'org_a', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
};

/** This environment's flows: a step naming its topic, a step naming none, a non-notify step. */
const FLOWS = [
    { name: 'deal_won', nodes: [{ id: 'n', type: 'notify', config: { topic: 'deal.won' } }, { id: 'e', type: 'end' }] },
    { item: { name: 'plain', nodes: [{ id: 'n', type: 'notify', config: {} }] } },
    { name: 'update', nodes: [{ id: 'u', type: 'update_record', config: { topic: 'not.a.notify.topic' } }] },
];

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
    vi.restoreAllMocks();
});

async function boot(): Promise<ObjectQL> {
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SysNotification]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'isolated');
    for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
    engine = ql;
    return ql;
}

/** An event row stored in `organization`, as the emit path stores it. */
async function stored(ql: ObjectQL, organization: string, topic: string): Promise<void> {
    await ql.insert('sys_notification', { topic, title: topic }, { context: { isSystem: true, tenantId: organization } as ExecutionContext });
}

function channel(id: string): MessagingChannel {
    return { id, send: async () => ({ status: 'sent' }) } as unknown as MessagingChannel;
}

interface DoorSetup {
    ql: ObjectQL;
    flows?: () => Promise<readonly unknown[] | undefined>;
}

function door(setup: DoorSetup) {
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
    // inbox and sms mounted; email known, its transport absent.
    const service = new MessagingService({ logger: silent });
    service.registerChannel(channel('inbox'));
    service.registerChannelProvider('email', () => undefined);
    service.registerChannelProvider('sms', () => channel('sms'));

    const aggregate = vi.spyOn(setup.ql, 'aggregate');
    const flows = vi.fn(setup.flows ?? (async () => FLOWS));
    registerPreferenceOptionsRoutes(http as never, {
        // The resolver's grant reads: this caller holds no position or permission set.
        getEngine: () => ({ find: async () => [] }),
        getAuth: () => auth as never,
        tenancy: undefined,
        knownChannels: () => service.getKnownChannels(),
        getData: () => setup.ql as never,
        readFlows: flows,
    });

    async function call(opts: { bearer?: string; query?: Record<string, string> } = {}) {
        const handler = handlers.get(`GET ${PREFERENCE_OPTIONS_ROUTE}`);
        if (!handler) throw new Error('the door mounted no GET handler at its route');
        const answer: { status: number; body: any } = { status: 0, body: undefined };
        const res = {
            status: (code: number) => { answer.status = code; return res; },
            json: (body: unknown) => { answer.body = body; },
            header: () => res,
            send: () => undefined,
        };
        await handler(
            {
                params: {},
                query: opts.query ?? {},
                headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
                method: 'GET',
                path: PREFERENCE_OPTIONS_ROUTE,
            },
            res,
        );
        expect(envelopeViolations(answer.body), JSON.stringify(answer.body)).toEqual([]);
        return answer;
    }

    return { call, aggregate, flows };
}

/** The refusal envelope's `code` and `status`, after checking the error parses as the declared `ApiError`. */
function envelope(answer: { status: number; body: any }): [unknown, number] {
    expect(answer.body?.success).toBe(false);
    expect(ApiErrorSchema.safeParse(answer.body.error).success, JSON.stringify(answer.body.error)).toBe(true);
    return [answer.body.error.code, answer.status];
}

const valuesOf = (list: Array<{ value: string }>) => list.map((o) => o.value);

describe('the preference options door — mounted', () => {
    it('registers exactly one route: GET /api/v1/messaging/preference-options', () => {
        const http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn() };
        registerPreferenceOptionsRoutes(http as never, {} as never);
        expect(http.get.mock.calls.map((c) => c[0])).toEqual(['/api/v1/messaging/preference-options']);
        for (const verb of ['post', 'put', 'patch', 'delete', 'use'] as const) expect(http[verb]).not.toHaveBeenCalled();
    });
});

describe('the preference options door — the list', () => {
    it('serves * first, then every source, each topic once with all of its sources', async () => {
        const ql = await boot();
        await stored(ql, 'org_a', 'invoice.overdue');
        await stored(ql, 'org_a', 'invoice.overdue');
        await stored(ql, 'org_a', 'approval.requested'); // also a platform topic
        await stored(ql, 'org_a', 'deal.won'); // also a flow topic
        const d = door({ ql });

        const answer = await d.call({ bearer: 'alice' });
        expect(answer.status).toBe(200);
        expect(answer.body.success).toBe(true);
        const { topics, channels } = answer.body.data;

        expect(topics[0]).toEqual({ value: '*', wildcard: true, sources: [] });
        const rest = topics.slice(1);
        expect(valuesOf(rest)).toEqual([...valuesOf(rest)].sort());
        expect(new Set(valuesOf(topics)).size).toBe(topics.length);
        const byValue = new Map(rest.map((t: any) => [t.value, t]));
        for (const platform of PLATFORM_NOTIFICATION_TOPICS) expect(byValue.has(platform), platform).toBe(true);
        expect(byValue.get('approval.requested')).toEqual({ value: 'approval.requested', wildcard: false, sources: ['platform', 'stored'] });
        expect(byValue.get('deal.won')).toEqual({ value: 'deal.won', wildcard: false, sources: ['flow', 'stored'] });
        // A notify step that names no topic sends under `notify`.
        expect(byValue.get('notify')).toEqual({ value: 'notify', wildcard: false, sources: ['flow'] });
        expect(byValue.get('invoice.overdue')).toEqual({ value: 'invoice.overdue', wildcard: false, sources: ['stored'] });
        // A topic on a step that is not a notify step is no notification topic.
        expect(byValue.has('not.a.notify.topic')).toBe(false);

        expect(channels).toEqual([
            { value: '*', wildcard: true, configured: true },
            { value: 'inbox', wildcard: false, configured: true },
            { value: 'email', wildcard: false, configured: false },
            { value: 'sms', wildcard: false, configured: true },
        ]);
    });

    it("a topic stored in one organization never appears for another", async () => {
        const ql = await boot();
        await stored(ql, 'org_a', 'org_a.secret_topic');
        await stored(ql, 'org_b', 'org_b.secret_topic');
        const d = door({ ql });

        const alice = valuesOf((await d.call({ bearer: 'alice' })).body.data.topics);
        const bob = valuesOf((await d.call({ bearer: 'bob' })).body.data.topics);
        expect(alice).toContain('org_a.secret_topic');
        expect(alice).not.toContain('org_b.secret_topic');
        expect(bob).toContain('org_b.secret_topic');
        expect(bob).not.toContain('org_a.secret_topic');
    });

    it('a kernel with no metadata protocol lists no flow topic and still answers', async () => {
        const ql = await boot();
        const d = door({ ql, flows: async () => undefined });
        const answer = await d.call({ bearer: 'alice' });
        expect(answer.status).toBe(200);
        expect(valuesOf(answer.body.data.topics)).not.toContain('deal.won');
        expect(valuesOf(answer.body.data.topics)).not.toContain('notify');
    });
});

describe('the preference options door — refusals, before anything is read', () => {
    it('refuses an anonymous caller 401 UNAUTHENTICATED', async () => {
        const d = door({ ql: await boot() });
        expect(envelope(await d.call())).toEqual(['UNAUTHENTICATED', 401]);
        expect(d.aggregate).not.toHaveBeenCalled();
        expect(d.flows).not.toHaveBeenCalled();
    });

    it("refuses a held sign-in 403 with the policy's own code", async () => {
        const d = door({ ql: await boot() });
        expect(envelope(await d.call({ bearer: 'held' }))).toEqual(['PASSWORD_EXPIRED', 403]);
        expect(d.aggregate).not.toHaveBeenCalled();
    });

    it('refuses a query parameter 400 VALIDATION_ERROR naming it, never ignoring it', async () => {
        const d = door({ ql: await boot() });
        const answer = await d.call({ bearer: 'alice', query: { topic: 'approval' } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(answer.body.error.message).toContain("'topic'");
        expect(d.aggregate).not.toHaveBeenCalled();
        expect(d.flows).not.toHaveBeenCalled();
    });

    it('answers a source it cannot read 500 INTERNAL_ERROR, never a partial list', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const d = door({ ql: await boot(), flows: async () => { throw new Error('the flow list could not be read'); } });
        const answer = await d.call({ bearer: 'alice' });
        expect(envelope(answer)).toEqual(['INTERNAL_ERROR', 500]);
        expect(answer.body.data).toBeUndefined();
        error.mockRestore();
    });
});
