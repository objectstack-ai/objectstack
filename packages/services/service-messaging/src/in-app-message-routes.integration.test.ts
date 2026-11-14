// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32445, ruling 6810324463 letter A, PR 2] The in-app message door,
 * `POST /api/v1/messaging/in-app-messages`, driven through the handler it
 * mounts, over a real `ObjectQL` on `SqlDriver` (better-sqlite3) holding two
 * organizations and a real `MessagingService` with the inbox channel:
 *
 *  - through the platform's one composition, an anonymous caller, a held
 *    sign-in and a plain member (who holds no `setup.write`) are refused
 *    before anything is read or sent;
 *  - an organization administrator's message to everyone reaches every member
 *    of THEIR current organization and nobody in the other one, from either
 *    side (the boundary pin the seat asked for, ablated in the PR);
 *  - a message to picked members reaches exactly those members; a picked id
 *    that is not a member of the sender's organization — a member of another
 *    one, a selector, an address — is refused by name and nothing is sent;
 *  - the form is judged against its closed set, every refusal sends nothing;
 *  - the answer counts the people the message went to.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysNotification } from '@objectstack/platform-objects';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
    IN_APP_MESSAGE_RECIPIENT_ID_MAX,
    IN_APP_MESSAGE_RECIPIENTS_MAX,
    IN_APP_MESSAGE_ROUTE,
    IN_APP_MESSAGE_TITLE_MAX,
    IN_APP_MESSAGE_TOPIC,
    registerInAppMessageRoutes,
    type InAppMessageRoutesDeps,
} from './in-app-message-routes.js';
import { resolveMessagingCaller } from './messaging-request-caller.js';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel, INBOX_OBJECT } from './inbox-channel.js';
import type { MessagingChannel } from './channel.js';
import { currentCredentialUseClient, hashApiKey } from '@objectstack/core';
import { InboxMessage, NotificationDelivery, NotificationPreference, NotificationReceipt } from './objects/index.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };
// Declared as the platform declares them: better-auth owns both tables.
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = {
    name: 'sys_user', label: 'User', managedBy: 'better-auth',
    fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } },
};
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

/** org_a's members: an owner, an admin, a member, one with no role. org_b holds one. */
const ORG_A = ['u_owner', 'u_admin', 'u_member', 'u_no_role'];
const ORG_B = ['u_elsewhere'];

/** The callers the injected composition answers, by bearer: what the platform resolver hands the door. */
const CONTEXTS: Record<string, ExecutionContext> = {
    // An organization administrator of org_a: the organization_admin set's capabilities, there.
    admin_a: { userId: 'u_admin', tenantId: 'org_a', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'] } as ExecutionContext,
    // The administrator of org_b.
    admin_b: { userId: 'u_elsewhere', tenantId: 'org_b', systemPermissions: ['setup.access', 'setup.write'] } as ExecutionContext,
    // A member of org_a holding Setup access but not the write capability.
    reader_a: { userId: 'u_member', tenantId: 'org_a', systemPermissions: ['setup.access'] } as ExecutionContext,
    // The capability with no current organization.
    admin_no_org: { userId: 'u_admin', systemPermissions: ['setup.write'] } as ExecutionContext,
};

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
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysMember, SysNotification, InboxMessage, NotificationReceipt, NotificationDelivery, NotificationPreference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
    for (const id of [...ORG_A, ...ORG_B]) await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYSTEM);
    const member = (id: string, user: string, organization: string, role: string | null) =>
        ql.insert('sys_member', { id, user_id: user, organization_id: organization, role }, SYSTEM);
    await member('m1', 'u_owner', 'org_a', 'owner');
    await member('m2', 'u_admin', 'org_a', 'admin');
    await member('m3', 'u_member', 'org_a', 'member');
    await member('m4', 'u_no_role', 'org_a', null);
    await member('m5', 'u_elsewhere', 'org_b', 'admin');
    engine = ql;
    return ql;
}

interface DoorOptions {
    resolveCaller?: InAppMessageRoutesDeps['resolveCaller'];
    messaging?: 'none' | 'throws';
    /** The inbox channel the service registers, built over the real one; `null` registers none. */
    inbox?: ((real: MessagingChannel) => MessagingChannel) | null;
    /** Every `sys_member` read throws: the fan-out's member lookup included. */
    memberReadFails?: boolean;
}

async function door(opts: DoorOptions = {}) {
    const ql = await boot();
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const http = {
        post: vi.fn((path: string, handler: (req: unknown, res: unknown) => Promise<void>) => handlers.set(`POST ${path}`, handler)),
        get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn(),
    };
    const messaging = new MessagingService({ logger: silent, getData: () => ql as any });
    const realInbox = createInboxChannel({ getData: () => ql as any });
    if (opts.inbox !== null) messaging.registerChannel(opts.inbox ? opts.inbox(realInbox) : realInbox);
    const emit = vi.spyOn(messaging, 'emit');
    if (opts.messaging === 'throws') emit.mockRejectedValue(new Error('the outbox is down'));
    const realFind = ql.find.bind(ql);
    const find = vi.spyOn(ql, 'find');
    if (opts.memberReadFails) {
        find.mockImplementation((async (object: string, ...rest: unknown[]) => {
            if (object === 'sys_member') throw new Error('the membership table is unreachable');
            return (realFind as (...args: unknown[]) => unknown)(object, ...rest);
        }) as never);
    }

    registerInAppMessageRoutes(http as never, {
        resolveCaller: opts.resolveCaller ?? (async (req) => {
            const bearer = String((req.headers as Record<string, unknown>)?.authorization ?? '').replace(/^Bearer /, '');
            return CONTEXTS[bearer];
        }),
        getMessaging: () => (opts.messaging === 'none' ? undefined : messaging),
        getData: () => ql as any,
    });

    async function call(input: { bearer?: string; body?: unknown; query?: Record<string, string> } = {}) {
        const handler = handlers.get(`POST ${IN_APP_MESSAGE_ROUTE}`);
        if (!handler) throw new Error('the door mounted no POST handler at its route');
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
                query: input.query ?? {},
                headers: input.bearer ? { authorization: `Bearer ${input.bearer}` } : {},
                method: 'POST',
                path: IN_APP_MESSAGE_ROUTE,
                body: input.body,
            },
            res,
        );
        expect(envelopeViolations(answer.body), JSON.stringify(answer.body)).toEqual([]);
        return answer;
    }

    /** The inbox rows written, as `user_id → organization_id`, and their text. */
    async function inbox() {
        const rows = ((await ql.find(INBOX_OBJECT, { fields: ['user_id', 'organization_id', 'topic', 'title', 'body_md', 'severity', 'action_url'] }, SYSTEM)) ?? []) as Array<Record<string, unknown>>;
        return rows;
    }

    /** The `sys_member` reads the door made (the emit's own fan-out reads excluded by the caller). */
    const memberReads = () => find.mock.calls.filter((c) => c[0] === 'sys_member');

    return { ql, call, inbox, emit, memberReads, http };
}

/** The refusal envelope's `code` and `status`, after checking the error parses as the declared `ApiError`. */
function envelope(answer: { status: number; body: any }): [unknown, number] {
    expect(answer.body?.success).toBe(false);
    expect(ApiErrorSchema.safeParse(answer.body.error).success, JSON.stringify(answer.body.error)).toBe(true);
    return [answer.body.error.code, answer.status];
}

const MESSAGE = { title: 'Maintenance window', body: 'The app is read-only on Saturday, 02:00 to 04:00.' };

describe('the in-app message door — mounted', () => {
    it('registers exactly one route: POST /api/v1/messaging/in-app-messages', async () => {
        const d = await door();
        expect(d.http.post.mock.calls.map((c) => c[0])).toEqual(['/api/v1/messaging/in-app-messages']);
        expect(d.http.get).not.toHaveBeenCalled();
    });
});

describe('the in-app message door — who may send, through the platform composition', () => {
    // The fake auth service and the resolver's grant reads, as the preference
    // options door's test spells them: this caller holds no position or
    // permission set, and a current membership in the organization its session names.
    const SESSIONS: Record<string, { userId: string; organizationId: string; authGate?: { code: string; message: string } }> = {
        member: { userId: 'u_member', organizationId: 'org_a' },
        held: { userId: 'u_admin', organizationId: 'org_a', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
    };
    const MEMBERSHIPS = [
        { id: 'm3', user_id: 'u_member', organization_id: 'org_a', role: 'member' },
        { id: 'm2', user_id: 'u_admin', organization_id: 'org_a', role: 'admin' },
    ];
    const composition: InAppMessageRoutesDeps['resolveCaller'] = (req) => resolveMessagingCaller(req, {
        getEngine: () => ({
            find: async (object: string, q: any = {}) => {
                if (object !== 'sys_member') return [];
                const rows = MEMBERSHIPS.filter((row) => Object.entries(q?.where ?? {}).every(([k, v]) => {
                    // Scalar equality only: a combinator is refused, never read as a field name.
                    if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`membership double: ${k} is not implemented`);
                    return (row as Record<string, unknown>)[k] === v;
                }));
                return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
            },
        }),
        getAuth: () => ({
            api: {
                getSession: async (input: { headers: Headers }) => {
                    const bearer = input.headers.get('authorization')?.replace(/^Bearer /, '');
                    const s = bearer ? SESSIONS[bearer] : undefined;
                    if (!s) return null;
                    return {
                        user: { id: s.userId, email: `${s.userId}@example.test`, ...(s.authGate ? { authGate: s.authGate } : {}) },
                        session: { id: `ses_${bearer}`, userId: s.userId, activeOrganizationId: s.organizationId },
                    };
                },
            },
        }) as never,
        tenancy: undefined,
    });

    it('refuses an anonymous caller 401 UNAUTHENTICATED, and sends nothing', async () => {
        const d = await door({ resolveCaller: composition });
        expect(envelope(await d.call({ body: { ...MESSAGE, everyone: true } }))).toEqual(['UNAUTHENTICATED', 401]);
        expect(d.emit).not.toHaveBeenCalled();
    });

    it("refuses a held sign-in 403 with the policy's own code, and sends nothing", async () => {
        const d = await door({ resolveCaller: composition });
        expect(envelope(await d.call({ bearer: 'held', body: { ...MESSAGE, everyone: true } }))).toEqual(['PASSWORD_EXPIRED', 403]);
        expect(d.emit).not.toHaveBeenCalled();
    });

    it('refuses a plain member 403 PERMISSION_DENIED naming setup.write, before a membership read or a send', async () => {
        const d = await door({ resolveCaller: composition });
        const answer = await d.call({ bearer: 'member', body: { ...MESSAGE, everyone: true } });
        expect(envelope(answer)).toEqual(['PERMISSION_DENIED', 403]);
        expect(String(answer.body.error.message)).toContain('`setup.write`');
        expect(d.emit).not.toHaveBeenCalled();
        expect(d.memberReads()).toEqual([]);
        expect(await d.inbox()).toEqual([]);
    });
});

describe('the in-app message door — the capability and the organization', () => {
    it('refuses a caller without setup.write in their current organization, Setup access notwithstanding', async () => {
        const d = await door();
        expect(envelope(await d.call({ bearer: 'reader_a', body: { ...MESSAGE, everyone: true } }))).toEqual(['PERMISSION_DENIED', 403]);
        expect(d.emit).not.toHaveBeenCalled();
    });

    it('refuses a caller with no current organization 403, before anything is read', async () => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_no_org', body: { ...MESSAGE, everyone: true } });
        expect(envelope(answer)).toEqual(['PERMISSION_DENIED', 403]);
        expect(String(answer.body.error.message)).toContain('no current organization');
        expect(d.emit).not.toHaveBeenCalled();
        expect(d.memberReads()).toEqual([]);
    });
});

describe('the in-app message door — everyone in the organization', () => {
    it("reaches every member of the sender's current organization, and nobody in the other one", async () => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, everyone: true, severity: 'warning', link: '/apps/setup' } });

        expect(answer.status).toBe(200);
        expect(answer.body.data).toMatchObject({ recipients: ORG_A.length, failed: 0 });
        expect(typeof answer.body.data.notificationId).toBe('string');
        const rows = await d.inbox();
        expect(rows.map((r) => r.user_id).sort()).toEqual([...ORG_A].sort());
        expect(rows.some((r) => ORG_B.includes(String(r.user_id)))).toBe(false);
        expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set(['org_a']));
        for (const row of rows) {
            expect(row).toMatchObject({
                topic: IN_APP_MESSAGE_TOPIC, title: MESSAGE.title, body_md: MESSAGE.body, severity: 'warning', action_url: '/apps/setup',
            });
        }
        // The emit names the caller's organization and the one selector, in-app only, the sender as actor.
        expect(d.emit).toHaveBeenCalledTimes(1);
        expect(d.emit.mock.calls[0][0]).toMatchObject({
            topic: 'org.announcement', audience: 'org:members', organizationId: 'org_a', actorId: 'u_admin', channels: ['inbox'],
        });
    });

    it("from the other side: org_b's administrator reaches org_b's member, and nobody in org_a", async () => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_b', body: { ...MESSAGE, everyone: true } });
        expect(answer.status).toBe(200);
        expect(answer.body.data.recipients).toBe(ORG_B.length);
        const rows = await d.inbox();
        expect(rows.map((r) => r.user_id)).toEqual(ORG_B);
        expect(rows.map((r) => r.organization_id)).toEqual(['org_b']);
        expect(rows[0].severity).toBe('info');
    });
});

describe('the in-app message door — picked members', () => {
    it('reaches exactly the members picked, a duplicate counted once', async () => {
        const d = await door();
        const answer = await d.call({
            bearer: 'admin_a',
            body: { ...MESSAGE, recipients: ['u_member', 'u_no_role', 'u_member'], link: 'https://status.example.com/incidents' },
        });
        expect(answer.status).toBe(200);
        expect(answer.body.data.recipients).toBe(2);
        const rows = await d.inbox();
        expect(rows.map((r) => r.user_id).sort()).toEqual(['u_member', 'u_no_role']);
        expect(rows.map((r) => r.action_url)).toEqual(['https://status.example.com/incidents', 'https://status.example.com/incidents']);
        expect(d.emit.mock.calls[0][0]).toMatchObject({ audience: ['user:u_member', 'user:u_no_role'], organizationId: 'org_a' });
    });

    it("refuses a picked member of another organization by name, and sends to nobody — the picked members included", async () => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: ['u_member', 'u_elsewhere'] } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain("'u_elsewhere'");
        expect(String(answer.body.error.message)).not.toContain("'u_member'");
        expect(d.emit).not.toHaveBeenCalled();
        expect(await d.inbox()).toEqual([]);
        // The read asked about the picked ids in the caller's organization only, under the fan-out's system opt-in.
        const [read] = d.memberReads();
        expect(read[1]).toMatchObject({ where: { organization_id: 'org_a', user_id: { $in: ['u_member', 'u_elsewhere'] } }, fields: ['user_id'] });
        expect(read[2]).toEqual({ context: { isSystem: true } });
    });

    it.each([
        ['an audience selector', 'org:members'],
        ['another selector', 'role:admin'],
        ['an address', 'u_owner@example.test'],
        ['an unknown id', 'u_nobody'],
    ])('refuses %s in recipients as no member of the organization', async (_what, id) => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: [id] } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain(`'${id}'`);
        expect(d.emit).not.toHaveBeenCalled();
    });
});

describe('the in-app message door — the form is a closed set, and every refusal sends nothing', () => {
    it.each<[string, unknown, string]>([
        ['not an object', 'hello', 'JSON object'],
        ['an unknown field', { ...MESSAGE, everyone: true, priority: 'high' }, "'priority'"],
        ['an organization named in the body', { ...MESSAGE, everyone: true, organizationId: 'org_b' }, "'organizationId' is not accepted"],
        ['both everyone and recipients', { ...MESSAGE, everyone: true, recipients: ['u_member'] }, 'not both'],
        ['neither everyone nor recipients', { ...MESSAGE }, 'at least one recipient'],
        ['everyone false and no recipients', { ...MESSAGE, everyone: false, recipients: [] }, 'at least one recipient'],
        ['everyone not a boolean', { ...MESSAGE, everyone: 'yes' }, "'everyone'"],
        ['recipients not a list of ids', { ...MESSAGE, recipients: 'u_member' }, "'recipients'"],
        ['a recipient id past its bound', { ...MESSAGE, recipients: ['u_member', 'x'.repeat(IN_APP_MESSAGE_RECIPIENT_ID_MAX + 1)] }, `'recipients' item 2 is ${IN_APP_MESSAGE_RECIPIENT_ID_MAX + 1} characters long`],
        ['too many recipients', { ...MESSAGE, recipients: Array.from({ length: IN_APP_MESSAGE_RECIPIENTS_MAX + 1 }, (_, i) => `u_${i}`) }, `at most ${IN_APP_MESSAGE_RECIPIENTS_MAX}`],
        ['no title', { body: MESSAGE.body, everyone: true }, "'title' is required"],
        ['a blank title', { ...MESSAGE, title: '   ', everyone: true }, "'title' is required"],
        ['a title past the inbox column', { ...MESSAGE, title: 'x'.repeat(IN_APP_MESSAGE_TITLE_MAX + 1), everyone: true }, `at most ${IN_APP_MESSAGE_TITLE_MAX}`],
        ['no body', { title: MESSAGE.title, everyone: true }, "'body' is required"],
        ['an unknown severity', { ...MESSAGE, everyone: true, severity: 'urgent' }, "'severity' must be one of info, warning, critical"],
        ['a script link', { ...MESSAGE, everyone: true, link: 'javascript:alert(1)' }, "'link' must be"],
        ['a protocol-relative link', { ...MESSAGE, everyone: true, link: '//evil.example/x' }, "'link' must be"],
        ['a link with a space', { ...MESSAGE, everyone: true, link: '/apps/a b' }, "'link' must be"],
    ])('refuses %s 400 VALIDATION_ERROR', async (_what, body, says) => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_a', body });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain(says);
        expect(String(answer.body.error.message)).toContain('Nothing was sent.');
        expect(d.emit).not.toHaveBeenCalled();
        expect(d.memberReads()).toEqual([]);
        expect(await d.inbox()).toEqual([]);
    });

    it('refuses a query parameter 400 naming it, and sends nothing', async () => {
        const d = await door();
        const answer = await d.call({ bearer: 'admin_a', query: { dryRun: 'true' }, body: { ...MESSAGE, everyone: true } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain("'dryRun'");
        expect(d.emit).not.toHaveBeenCalled();
    });
});

describe('the in-app message door — what this host cannot do', () => {
    it('answers 503 SERVICE_UNAVAILABLE with no messaging service, before anything is read', async () => {
        const d = await door({ messaging: 'none' });
        expect(envelope(await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: ['u_member'] } }))).toEqual(['SERVICE_UNAVAILABLE', 503]);
        expect(d.memberReads()).toEqual([]);
    });

    it('answers a send that throws as a 500 fault, never a success', async () => {
        const d = await door({ messaging: 'throws' });
        expect(envelope(await d.call({ bearer: 'admin_a', body: { ...MESSAGE, everyone: true } }))).toEqual(['INTERNAL_ERROR', 500]);
    });
});

describe('the in-app message door — one recipient id is bounded', () => {
    it('refuses an id past the bound by its position, never echoing it, before any read', async () => {
        const d = await door();
        const long = `u_${'y'.repeat(IN_APP_MESSAGE_RECIPIENT_ID_MAX)}`;
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: [long] } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain("'recipients' item 1");
        expect(String(answer.body.error.message)).not.toContain(long);
        expect(d.memberReads()).toEqual([]);
        expect(d.emit).not.toHaveBeenCalled();
    });

    it('reads an id at the bound, and refuses it as no member like any other unknown id', async () => {
        const d = await door();
        const atBound = 'z'.repeat(IN_APP_MESSAGE_RECIPIENT_ID_MAX);
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: [atBound] } });
        expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
        expect(String(answer.body.error.message)).toContain('not a member');
        expect(d.memberReads()).toHaveLength(1);
        expect(d.emit).not.toHaveBeenCalled();
    });
});

describe('the in-app message door — the answer counts only accepted deliveries', () => {
    it('counts a recipient whose delivery failed in `failed`, never in `recipients`', async () => {
        const d = await door({
            inbox: (real) => ({
                id: real.id,
                send: (ctx, delivery) => (delivery.recipient === 'u_no_role'
                    ? Promise.resolve({ ok: false, error: 'the inbox row could not be written' })
                    : real.send(ctx, delivery)),
            }),
        });
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: ['u_member', 'u_no_role'] } });
        expect(answer.status).toBe(200);
        expect(answer.body.data).toMatchObject({ recipients: 1, delivered: 1, failed: 1 });
        expect((await d.inbox()).map((r) => r.user_id)).toEqual(['u_member']);
    });

    it('answers 503 SERVICE_UNAVAILABLE, never a 200, when this host has no inbox channel', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const d = await door({ inbox: null });
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: ['u_member', 'u_no_role'] } });
        expect(envelope(answer)).toEqual(['SERVICE_UNAVAILABLE', 503]);
        expect(String(answer.body.error.message)).toContain('No one received this message.');
        // The delivery errors go to the fault log, never onto the wire.
        expect(String(answer.body.error.message)).not.toContain('not registered');
        expect(answer.body.data).toBeUndefined();
        expect(d.emit).toHaveBeenCalledTimes(1);
        expect(await d.inbox()).toEqual([]);
        error.mockRestore();
    });

    it("answers 503 SERVICE_UNAVAILABLE naming the reason when the inbox is unavailable in the sender's organization", async () => {
        const d = await door({
            inbox: (real) => ({ id: real.id, send: real.send.bind(real), isAvailable: () => ({ available: false, reason: 'transport_not_configured' }) }),
        });
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, everyone: true } });
        expect(envelope(answer)).toEqual(['SERVICE_UNAVAILABLE', 503]);
        expect(String(answer.body.error.message)).toContain('inbox: transport_not_configured');
        expect(await d.inbox()).toEqual([]);
    });

    it("answers 503 SERVICE_UNAVAILABLE, never a 200 with 0 recipients, when everyone's member lookup fails", async () => {
        const d = await door({ memberReadFails: true });
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, everyone: true } });
        expect(envelope(answer)).toEqual(['SERVICE_UNAVAILABLE', 503]);
        expect(String(answer.body.error.message)).toContain('could not be read');
        expect(d.emit).toHaveBeenCalledTimes(1);
        expect(await d.inbox()).toEqual([]);
    });

    it('answers 409 RESOURCE_CONFLICT when every picked member turned the topic off', async () => {
        const d = await door();
        for (const user of ['u_member', 'u_no_role']) {
            await d.ql.insert('sys_notification_preference', {
                id: `pref_${user}`, user_id: user, organization_id: 'org_a', topic: IN_APP_MESSAGE_TOPIC, channel: 'inbox', enabled: false,
            }, SYSTEM);
        }
        const answer = await d.call({ bearer: 'admin_a', body: { ...MESSAGE, recipients: ['u_member', 'u_no_role'] } });
        expect(envelope(answer)).toEqual(['RESOURCE_CONFLICT', 409]);
        expect(String(answer.body.error.message)).toContain('turned off');
        expect(await d.inbox()).toEqual([]);
    });
});

/** A data engine that knows one API key, and records the client facts its use stamp runs with. */
function keyEngine(key: string, owner: string, stamps: unknown[]) {
    const keyHash = hashApiKey(key);
    return {
        find: async (object: string, q: any = {}) =>
            object === 'sys_api_key' && q?.where?.key === keyHash
                ? [{ id: 'key_in_app', key: keyHash, user_id: owner, revoked: false, scopes: '[]', expires_at: '2999-01-01T00:00:00Z' }]
                : object === 'sys_user' && (q?.where?.id === owner || q?.where?.id?.$in?.includes?.(owner))
                    ? [{ id: owner }]
                    : [],
        findOne: async () => null,
        update: async () => {
            stamps.push(currentCredentialUseClient() ?? null);
            return {};
        },
    };
}

/**
 * The in-app door hands where the request came from to the key's use stamp,
 * through the shared caller module, as the preference options door does: the
 * transport's peer and the headers go to the auth service's trust rule, and the
 * address it establishes is what the `credential_use` row records, with the
 * user agent. The door reads no forwarded header itself.
 */
describe('the in-app message door — an API key hands its client facts to the key\'s use stamp', () => {
    it('the stamp runs with the address the trust rule established from the peer, and the user agent', async () => {
        const stamps: unknown[] = [];
        const handed: Array<{ headers?: Record<string, unknown>; remoteAddress?: string }> = [];
        const KEY = 'osk_in_app_message_door';
        const d = await door({
            resolveCaller: (req) => resolveMessagingCaller(req, {
                getEngine: () => keyEngine(KEY, 'u_key_owner', stamps),
                getAuth: () => ({
                    api: { getSession: async () => null },
                    resolveClientAddress: (transport: { headers?: Record<string, unknown>; remoteAddress?: string }) => {
                        handed.push(transport);
                        return '203.0.113.7';
                    },
                }) as never,
                tenancy: undefined,
            }),
        });
        const handler = d.http.post.mock.calls[0][1] as (req: unknown, res: unknown) => Promise<void>;
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
                query: {},
                headers: { 'user-agent': 'ci-agent/3.1', 'x-forwarded-for': '198.51.100.9', 'x-api-key': KEY },
                remoteAddress: '10.0.0.5',
                method: 'POST',
                path: IN_APP_MESSAGE_ROUTE,
                body: { ...MESSAGE, everyone: true },
            },
            res,
        );
        expect(handed).toHaveLength(1);
        expect(handed[0].remoteAddress).toBe('10.0.0.5');
        expect(handed[0].headers?.['x-forwarded-for'], 'handed over raw: the auth service decides whether it counts').toBe('198.51.100.9');
        expect(stamps).toEqual([{ ipAddress: '203.0.113.7', userAgent: 'ci-agent/3.1' }]);
        // The key admitted its owner, who holds no `setup.write` here: refused, nothing sent.
        expect(envelope(answer)).toEqual(['PERMISSION_DENIED', 403]);
        expect(d.emit).not.toHaveBeenCalled();
    });
});
