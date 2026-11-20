// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] The Slack link store and its doors, over a real `ObjectQL`
 * on `SqlDriver` (better-sqlite3) with the `secret` channel wired, Slack
 * answered by a scripted `slack` client service:
 *
 *  - the install: an administrator's token is proven by Slack, stored
 *    encrypted (never in the row, never in an answer), and read back only by
 *    the privileged dereference under its own organization;
 *  - the person: a proposal by email delivers nothing until confirmed;
 *  - the riders of ruling 7024100939: (1) every removal is a write the audit
 *    hook sees, attributed to who removed it; (2) an administrator's removal
 *    tells the person by inbox and email; (3) a link goes with the person's
 *    deletion, their ban and their leaving the organization; (4) an
 *    administrator's removal does not stop a new link; (5) the administrator
 *    doors demand `setup.write`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysSecret } from '@objectstack/platform-objects';
import { envelopeViolations } from '@objectstack/spec/api';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ChannelAccount, ChannelUserLink } from './objects/index.js';
import {
    CHANNEL_ACCOUNT_OBJECT,
    CHANNEL_USER_LINK_OBJECT,
    SLACK_LINK_REMOVED_TOPIC,
    SlackLinkStore,
    bindSlackLinkRemovalTriggers,
    type SlackClientSurface,
} from './slack-links.js';
import { SLACK_ACCOUNT_ROUTE, SLACK_ADMIN_CAPABILITY, SLACK_LINK_ROUTE, SLACK_LINKS_ROUTE, registerSlackLinkRoutes } from './slack-link-routes.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = {
    name: 'sys_user', label: 'User', managedBy: 'better-auth',
    fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' }, banned: { type: 'boolean', label: 'Banned' } },
};
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };
const GOOD = 'xoxb-acme';

/** The callers, by bearer. `setup.write` is the organization administrator's capability. */
const CONTEXTS: Record<string, ExecutionContext> = {
    admin_a: { userId: 'u_admin', tenantId: 'org_a', systemPermissions: ['setup.access', 'setup.write'] } as ExecutionContext,
    ada: { userId: 'u_ada', tenantId: 'org_a', systemPermissions: ['setup.access'] } as ExecutionContext,
    bob: { userId: 'u_bob', tenantId: 'org_a', systemPermissions: [] } as ExecutionContext,
    ada_no_org: { userId: 'u_ada', systemPermissions: [] } as ExecutionContext,
};

/** Reversible test crypto that binds the organization: a handle opens only under the tenant it was sealed for. */
function tenantBoundCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
            return { id: `sec_${++n}`, kmsKeyId: 'local', alg: 'test', version: 1, ciphertext: Buffer.from(`${ctx.tenantId}|${plain}`).toString('base64') };
        },
        async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
            const [tenant, ...rest] = Buffer.from(handle.ciphertext, 'base64').toString().split('|');
            if (tenant !== String(ctx.tenantId)) throw new Error('AAD mismatch');
            return rest.join('|');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> { return handle; },
        digest: (plain: string) => `d:${plain.length}`,
        async keyedDigest(plain: string) { return `k:${plain.length}`; },
    };
}

/** Slack, scripted: who holds which email, and the tokens it accepts. */
function scriptedSlack() {
    const directory: Record<string, { id: string; real_name: string }> = {
        'u_ada@example.test': { id: 'UADA', real_name: 'Ada' },
        'u_bob@example.test': { id: 'UBOB', real_name: 'Bob' },
        'u_admin@example.test': { id: 'UADM', real_name: 'Admin' },
    };
    const calls: Array<{ token: string; method: string }> = [];
    const answer = (ok: boolean, body: Record<string, unknown>) => ({ ok, status: 200, body: { ok, ...body }, error: ok ? undefined : body.error });
    const slack: SlackClientSurface = {
        client: (token) => ({
            async call(input) {
                const method = String(input.method);
                calls.push({ token, method });
                if (token !== GOOD) return answer(false, { error: 'invalid_auth' });
                if (method === 'auth.test') return answer(true, { team_id: 'T1', team: 'Acme', user_id: 'UBOT' });
                const email = decodeURIComponent(method.split('email=')[1] ?? '');
                const user = directory[email];
                return user ? answer(true, { user }) : answer(false, { error: 'users_not_found' });
            },
        }),
    };
    return { slack, calls, directory };
}

let engine: ObjectQL | undefined;
afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot() {
    const ql = new ObjectQL({ logger: silent });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    ql.registerDriver(driver, true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysMember, SysSecret, ChannelAccount, ChannelUserLink]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    ql.setCryptoProvider(tenantBoundCrypto());
    for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, SYSTEM);
    for (const id of ['u_admin', 'u_ada', 'u_bob']) await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYSTEM);
    for (const [id, user] of [['m_admin', 'u_admin'], ['m_ada', 'u_ada'], ['m_bob', 'u_bob']]) {
        await ql.insert('sys_member', { id, user_id: user, organization_id: 'org_a', role: 'member' }, SYSTEM);
    }
    engine = ql;

    const { slack, calls } = scriptedSlack();
    const notices: any[] = [];
    const store = new SlackLinkStore({ getData: () => ql as any, getSlack: () => slack, notify: async (i) => notices.push(i), logger: silent });
    expect(bindSlackLinkRemovalTriggers(ql as any, store, silent)).toBe(true);
    // The platform's write audit (plugin-audit) is an `after*` hook attributing `session.userId`; this stands in for it.
    const audit: Array<{ event: string; id: unknown; by: unknown }> = [];
    for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
        ql.registerHook(event, async (ctx: any) => { audit.push({ event, id: ctx.input?.id ?? ctx.result?.id, by: ctx.session?.userId }); }, { object: CHANNEL_USER_LINK_OBJECT });
    }

    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const mount = (verb: string) => vi.fn((path: string, h: any) => handlers.set(`${verb} ${path}`, h));
    const http = { get: mount('GET'), post: mount('POST'), put: mount('PUT'), delete: mount('DELETE'), patch: vi.fn(), use: vi.fn() };
    registerSlackLinkRoutes(http as never, { resolveCaller: async (req: any) => CONTEXTS[req.headers.authorization], getStore: () => store });

    async function call(verb: string, route: string, bearer: string, opts: { body?: unknown; query?: Record<string, string>; id?: string } = {}) {
        const handler = handlers.get(`${verb} ${route}`);
        if (!handler) throw new Error(`no ${verb} ${route}`);
        const out: { status: number; body: any } = { status: 0, body: undefined };
        const res = { status: (c: number) => { out.status = c; return res; }, json: (b: unknown) => { out.body = b; }, header: () => res, send: () => undefined };
        await handler({ params: opts.id ? { id: opts.id } : {}, query: opts.query ?? {}, headers: { authorization: bearer }, method: verb, path: route, body: opts.body }, res);
        expect(envelopeViolations(out.body), JSON.stringify(out.body)).toEqual([]);
        return out;
    }
    const links = async () => (await ql.find(CHANNEL_USER_LINK_OBJECT, { fields: ['user_id', 'state', 'external_user_id'] }, SYSTEM)) as any[];
    const install = () => call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_a', { body: { token: GOOD } });
    const connect = async (bearer: string) => {
        await call('POST', `${SLACK_LINK_ROUTE}/proposal`, bearer);
        return call('POST', `${SLACK_LINK_ROUTE}/confirm`, bearer);
    };
    return { ql, driver, store, call, links, install, connect, calls, notices, audit };
}

describe('the Slack install — an administrator\'s token, at rest', () => {
    it('is proven by Slack, encrypted in the row, never answered, and opens only under its organization', async () => {
        const t = await boot();
        const put = await t.call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_a', { body: { token: GOOD } });
        expect(put.status).toBe(200);
        expect(put.body.data.account).toMatchObject({ workspace: 'Acme', workspaceId: 'T1', status: 'active' });
        expect(t.calls.map((c) => c.method)).toEqual(['auth.test']);
        expect(JSON.stringify(put.body)).not.toContain(GOOD);
        expect(JSON.stringify((await t.call('GET', SLACK_ACCOUNT_ROUTE, 'admin_a')).body)).not.toContain(GOOD);

        // The stored row, read below the engine: the column holds a reference, never the token.
        const raw = await t.driver.find(CHANNEL_ACCOUNT_OBJECT, { where: {} } as never);
        expect(raw).toHaveLength(1);
        expect(JSON.stringify(raw)).not.toContain(GOOD);
        const id = String((raw as any[])[0].id);
        expect(await t.ql.resolveSecretField(CHANNEL_ACCOUNT_OBJECT, id, 'bot_token', { tenantId: 'org_a' })).toBe(GOOD);
        await expect(t.ql.resolveSecretField(CHANNEL_ACCOUNT_OBJECT, id, 'bot_token', { tenantId: 'org_b' })).rejects.toThrow();
    });

    it('a token Slack refuses is not saved', async () => {
        const t = await boot();
        const put = await t.call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_a', { body: { token: 'xoxb-wrong' } });
        expect([put.body.error.code, put.status]).toEqual(['VALIDATION_ERROR', 400]);
        expect(await t.ql.find(CHANNEL_ACCOUNT_OBJECT, {}, SYSTEM)).toHaveLength(0);
    });
});

describe('a person\'s link — proposed by email, delivering once confirmed', () => {
    it('proposes by email match, confirms once, and answers no proposal when no Slack user holds the email', async () => {
        const t = await boot();
        await t.install();
        const proposed = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        expect(proposed.body.data.link).toMatchObject({ slackUserId: 'UADA', slackUserName: 'Ada', state: 'proposed' });
        expect(await t.store.confirmedUsers('org_a', ['u_ada'])).toEqual(new Set());

        const confirmed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(confirmed.body.data.link).toMatchObject({ state: 'confirmed' });
        expect(await t.store.confirmedUsers('org_a', ['u_ada', 'u_bob'])).toEqual(new Set(['u_ada']));
        expect((await t.call('GET', SLACK_LINK_ROUTE, 'ada')).body.data).toMatchObject({ account: { workspace: 'Acme' }, link: { state: 'confirmed' } });

        await t.ql.update('sys_user', { email: 'nobody@example.test' }, { where: { id: 'u_bob' }, ...SYSTEM } as never);
        expect((await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'bob')).body.data.link).toBeNull();
        expect(await t.links()).toHaveLength(1);
    });

    it('refuses with no install, no proposal to confirm, no current organization, and any query parameter', async () => {
        const t = await boot();
        const noInstall = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        expect([noInstall.body.error.code, noInstall.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        await t.install();
        const nothing = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect([nothing.body.error.code, nothing.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
        const noOrg = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada_no_org');
        expect([noOrg.body.error.code, noOrg.status]).toEqual(['PERMISSION_DENIED', 403]);
        const query = await t.call('GET', SLACK_LINK_ROUTE, 'ada', { query: { user: 'u_bob' } });
        expect([query.body.error.code, query.status]).toEqual(['VALIDATION_ERROR', 400]);
        expect(await t.links()).toHaveLength(0);
    });
});

describe('the riders of ruling 7024100939', () => {
    it('(5) every administrator door demands setup.write in the current organization; a person holding none is refused before anything is read', async () => {
        expect(SLACK_ADMIN_CAPABILITY).toBe('setup.write');
        const t = await boot();
        await t.install();
        await t.connect('bob');
        const [link] = await t.links();
        for (const [verb, route, opts] of [
            ['GET', SLACK_ACCOUNT_ROUTE, {}], ['PUT', SLACK_ACCOUNT_ROUTE, { body: { token: GOOD } }], ['DELETE', SLACK_ACCOUNT_ROUTE, {}],
            ['GET', SLACK_LINKS_ROUTE, {}], ['DELETE', `${SLACK_LINKS_ROUTE}/:id`, { id: 'whatever' }],
        ] as const) {
            const refused = await t.call(verb, route, 'ada', opts as never);
            expect([refused.body.error.code, refused.status], `${verb} ${route}`).toEqual(['PERMISSION_DENIED', 403]);
        }
        expect(await t.links()).toEqual([link]);
        expect((await t.call('GET', SLACK_LINKS_ROUTE, 'admin_a')).body.data.links).toMatchObject([{ userId: 'u_bob', state: 'confirmed' }]);
    });

    it('(1)(2)(4) an administrator\'s removal is audited as theirs, tells the person by inbox and email, and the person may link again', async () => {
        const t = await boot();
        await t.install();
        await t.connect('ada');
        const [row] = (await t.ql.find(CHANNEL_USER_LINK_OBJECT, { fields: ['id'] }, SYSTEM)) as any[];
        const removed = await t.call('DELETE', `${SLACK_LINKS_ROUTE}/:id`, 'admin_a', { id: String(row.id) });
        expect(removed.body.data).toEqual({ removed: true });
        expect(t.audit.filter((a) => a.event === 'afterDelete')).toEqual([{ event: 'afterDelete', id: row.id, by: 'u_admin' }]);
        expect(t.notices).toHaveLength(1);
        expect(t.notices[0]).toMatchObject({
            topic: SLACK_LINK_REMOVED_TOPIC, audience: ['user:u_ada'], organizationId: 'org_a', channels: ['inbox', 'email'], actorId: 'u_admin',
            keyedText: { titleKey: 'messages.slackLinkRemovedTitle', bodyKey: 'messages.slackLinkRemovedBody', params: { workspace: 'Acme' } },
        });

        const again = await t.connect('ada');
        expect(again.body.data.link).toMatchObject({ slackUserId: 'UADA', state: 'confirmed' });
        expect(t.audit.filter((a) => a.event === 'afterInsert').map((a) => a.by)).toEqual(['u_ada', 'u_ada']);
    });

    it('(1) the person\'s own removal and the uninstall are audited as their actor; only the administrator\'s tells anyone', async () => {
        const t = await boot();
        await t.install();
        await t.connect('ada');
        await t.connect('bob');
        expect((await t.call('DELETE', SLACK_LINK_ROUTE, 'ada')).body.data).toEqual({ removed: true });
        expect(t.notices).toHaveLength(0);
        expect((await t.call('DELETE', SLACK_ACCOUNT_ROUTE, 'admin_a')).body.data).toEqual({ removed: true });
        expect(t.audit.filter((a) => a.event === 'afterDelete').map((a) => a.by)).toEqual(['u_ada', 'u_admin']);
        expect(t.notices.map((n) => n.audience)).toEqual([['user:u_bob']]);
        expect(await t.links()).toEqual([]);
        expect(await t.ql.find(CHANNEL_ACCOUNT_OBJECT, {}, SYSTEM)).toHaveLength(0);
    });

    it('(3) a link goes when the person leaves the organization, is banned, or is deleted — each removal audited', async () => {
        const t = await boot();
        await t.install();
        await t.connect('ada');
        await t.connect('bob');
        await t.connect('admin_a');
        const left = { context: { isSystem: true, userId: 'u_admin' } as ExecutionContext };
        await t.ql.delete('sys_member', { where: { id: 'm_ada' }, ...left } as never);
        expect((await t.links()).map((l) => l.user_id).sort()).toEqual(['u_admin', 'u_bob']);
        await t.ql.update('sys_user', { banned: true }, { where: { id: 'u_bob' }, ...left } as never);
        expect((await t.links()).map((l) => l.user_id)).toEqual(['u_admin']);
        await t.ql.delete('sys_user', { where: { id: 'u_admin' }, ...SYSTEM } as never);
        expect(await t.links()).toEqual([]);
        expect(t.audit.filter((a) => a.event === 'afterDelete')).toHaveLength(3);
        expect(t.audit.filter((a) => a.event === 'afterDelete').slice(0, 2).map((a) => a.by)).toEqual(['u_admin', 'u_admin']);
    });
});
