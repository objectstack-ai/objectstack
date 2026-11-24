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
 *  - the proposal rule: a Slack link is proposed only for a verified email
 *    and names no one before it is confirmed, and a confirmation holds only
 *    while that email is still verified and still the person's, and applies
 *    only to the proposal that was checked; a proposal stores no Slack user,
 *    the confirmation records the one Slack names for the email then;
 *  - the token: a value that is not a Slack token is refused before Slack is
 *    asked;
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
import { enMessages, frMessages } from './translations/messages.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = {
    name: 'sys_user', label: 'User', managedBy: 'better-auth',
    fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        email_verified: { type: 'boolean', label: 'Email Verified' },
        banned: { type: 'boolean', label: 'Banned' },
    },
};
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };
const GOOD = 'xoxb-acme';

/** The callers, by bearer. `setup.write` is the organization administrator's capability. */
const CONTEXTS: Record<string, ExecutionContext> = {
    admin_a: { userId: 'u_admin', tenantId: 'org_a', systemPermissions: ['setup.access', 'setup.write'] } as ExecutionContext,
    ada: { userId: 'u_ada', tenantId: 'org_a', systemPermissions: ['setup.access'] } as ExecutionContext,
    bob: { userId: 'u_bob', tenantId: 'org_a', systemPermissions: [] } as ExecutionContext,
    bob_fr: { userId: 'u_bob', tenantId: 'org_a', locale: 'fr-FR', systemPermissions: [] } as ExecutionContext,
    ada_no_org: { userId: 'u_ada', systemPermissions: [] } as ExecutionContext,
    admin_b: { userId: 'u_admin', tenantId: 'org_b', systemPermissions: ['setup.access', 'setup.write'] } as ExecutionContext,
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
        'ada.new@example.test': { id: 'UADA2', real_name: 'Ada New' },
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

async function boot(opts: { linkPageSize?: number } = {}) {
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
    for (const id of ['u_admin', 'u_ada', 'u_bob']) {
        await ql.insert('sys_user', { id, name: id, email: `${id}@example.test`, email_verified: true }, SYSTEM);
    }
    for (const [id, user] of [['m_admin', 'u_admin'], ['m_ada', 'u_ada'], ['m_bob', 'u_bob']]) {
        await ql.insert('sys_member', { id, user_id: user, organization_id: 'org_a', role: 'member' }, SYSTEM);
    }
    engine = ql;

    const { slack, calls, directory } = scriptedSlack();
    const notices: any[] = [];
    // The engine the store writes through; `beforeLinkUpdate` runs once, just before the store's next link write.
    const race: { beforeLinkUpdate?: () => Promise<unknown> } = {};
    const data = new Proxy(ql, {
        get(target, prop) {
            if (prop === 'update') {
                return async (object: string, values: unknown, options: unknown) => {
                    const before = object === CHANNEL_USER_LINK_OBJECT ? race.beforeLinkUpdate : undefined;
                    race.beforeLinkUpdate = undefined;
                    if (before) await before();
                    return ql.update(object, values, options as never);
                };
            }
            const member = Reflect.get(target, prop, target);
            return typeof member === 'function' ? member.bind(target) : member;
        },
    });
    const store = new SlackLinkStore({
        getData: () => data as any, getSlack: () => slack, notify: async (i) => notices.push(i), logger: silent,
        ...(opts.linkPageSize ? { linkPageSize: opts.linkPageSize } : {}),
    });
    expect(bindSlackLinkRemovalTriggers(ql as any, store, silent)).toBe(true);
    // The platform's write audit (plugin-audit) is an `after*` hook attributing `session.userId`; this stands in for it.
    const audit: Array<{ event: string; id: unknown; by: unknown; written: string }> = [];
    for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
        ql.registerHook(event, async (ctx: any) => {
            audit.push({ event, id: ctx.input?.id ?? ctx.result?.id, by: ctx.session?.userId, written: JSON.stringify([ctx.input?.data ?? null, ctx.result ?? null]) });
        }, { object: CHANNEL_USER_LINK_OBJECT });
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
    const setUser = (id: string, values: Record<string, unknown>) => ql.update('sys_user', values, { where: { id }, ...SYSTEM } as never);
    return { ql, driver, store, call, links, install, connect, setUser, race, calls, directory, notices, audit };
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

    it('a value that is not a Slack token is refused before Slack is asked, and nothing is saved', async () => {
        const t = await boot();
        for (const token of ['xoxb:acme', 'xoxb/acme', 'xoxb-åcme', 'xoxb acme', 'xoxb-acme\n']) {
            const put = await t.call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_a', { body: { token: `${token}x` } });
            expect([put.body.error.code, put.status], token).toEqual(['VALIDATION_ERROR', 400]);
        }
        expect(t.calls).toEqual([]);
        expect(await t.ql.find(CHANNEL_ACCOUNT_OBJECT, {}, SYSTEM)).toHaveLength(0);
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
        expect(proposed.body.data.link).toEqual({ state: 'proposed' });
        expect(await t.store.confirmedUsers('org_a', ['u_ada'])).toEqual(new Set());

        const confirmed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(confirmed.body.data.link).toMatchObject({ slackUserId: 'UADA', slackUserName: 'Ada', state: 'confirmed' });
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

describe('the proposal rule — a verified email, and no one named before it is confirmed', () => {
    const lookups = (calls: Array<{ method: string }>) => calls.filter((c) => c.method.startsWith('users.lookupByEmail'));

    it('an unverified email is answered exactly as no match, and Slack is not asked', async () => {
        const t = await boot();
        await t.install();
        await t.setUser('u_bob', { email: 'nobody@example.test' });
        const noMatch = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'bob');
        expect(lookups(t.calls)).toHaveLength(1);

        await t.setUser('u_ada', { email_verified: false });
        const unverified = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        expect([unverified.status, unverified.body]).toEqual([noMatch.status, noMatch.body]);
        expect(unverified.body.data).toEqual({ link: null });
        expect(lookups(t.calls)).toHaveLength(1);
        expect(JSON.stringify(unverified.body)).not.toMatch(/UADA|Ada/);
        expect(await t.links()).toEqual([]);
    });

    it('a match names no Slack user, to the person or an administrator, until the person confirms it', async () => {
        const t = await boot();
        await t.install();
        const proposed = await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        const own = await t.call('GET', SLACK_LINK_ROUTE, 'ada');
        const listed = await t.call('GET', SLACK_LINKS_ROUTE, 'admin_a');
        expect(proposed.body.data).toEqual({ link: { state: 'proposed' } });
        expect(own.body.data.link).toEqual({ state: 'proposed' });
        expect(listed.body.data.links).toMatchObject([{ userId: 'u_ada', slackUserId: null, slackUserName: null, state: 'proposed' }]);
        for (const answer of [proposed, own, listed]) expect(JSON.stringify(answer.body)).not.toMatch(/UADA|Ada/);

        const confirmed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(confirmed.body.data.link).toMatchObject({ slackUserId: 'UADA', slackUserName: 'Ada', state: 'confirmed' });
        expect((await t.call('GET', SLACK_LINKS_ROUTE, 'admin_a')).body.data.links).toMatchObject([{ slackUserId: 'UADA', slackUserName: 'Ada' }]);
    });

    it('a confirmation is refused once the email changed or is no longer verified, and holds while it is unchanged', async () => {
        const t = await boot();
        await t.install();
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'bob');
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'admin_a');

        await t.setUser('u_ada', { email: 'ada.new@example.test' });
        const changed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect([changed.body.error.code, changed.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        expect(changed.body.error.userMessage).toBe(enMessages.slackLinkProposalOutdated);

        await t.setUser('u_bob', { email_verified: false });
        const unverified = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'bob_fr');
        expect([unverified.body.error.code, unverified.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        expect(unverified.body.error.userMessage).toBe(frMessages.slackLinkProposalOutdated);

        const unchanged = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'admin_a');
        expect(unchanged.body.data.link).toMatchObject({ slackUserId: 'UADM', state: 'confirmed' });
        expect(await t.store.confirmedUsers('org_a', ['u_ada', 'u_bob', 'u_admin'])).toEqual(new Set(['u_admin']));
        expect((await t.links()).filter((l) => l.state === 'proposed').map((l) => l.user_id).sort()).toEqual(['u_ada', 'u_bob']);
    });

    it('a confirmation applies only to the proposal that was checked: a row changed before the write is not confirmed', async () => {
        const t = await boot();
        await t.install();
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        const [row] = (await t.ql.find(CHANNEL_USER_LINK_OBJECT, { fields: ['id'] }, SYSTEM)) as any[];
        t.race.beforeLinkUpdate = () => t.ql.update(CHANNEL_USER_LINK_OBJECT, { proposal_email_hash: 'f'.repeat(64) }, { where: { id: row.id }, ...SYSTEM } as never);
        const raced = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(t.race.beforeLinkUpdate).toBeUndefined();
        expect([raced.body.error.code, raced.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        const [after] = (await t.ql.find(CHANNEL_USER_LINK_OBJECT, { fields: ['state', 'confirmed_at'] }, SYSTEM)) as any[];
        expect([after.state, after.confirmed_at ?? null]).toEqual(['proposed', null]);
        expect(await t.store.confirmedUsers('org_a', ['u_ada'])).toEqual(new Set());
    });

    it('a proposal stores no Slack user; the confirmation records the one Slack names for the verified email', async () => {
        const t = await boot();
        await t.install();
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        const stored = async () => (await t.driver.find(CHANNEL_USER_LINK_OBJECT, { where: {} } as never)) as any[];
        const [proposed] = await stored();
        expect([proposed.state, proposed.external_user_id ?? null, proposed.external_display_name ?? null]).toEqual(['proposed', null, null]);
        const inserted = t.audit.filter((a) => a.event === 'afterInsert');
        expect(inserted).toHaveLength(1);
        expect(inserted[0]!.written).not.toMatch(/UADA|Ada/);
        expect(lookups(t.calls)).toHaveLength(1);

        const confirmed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(confirmed.body.data.link).toMatchObject({ slackUserId: 'UADA', slackUserName: 'Ada', state: 'confirmed' });
        expect(lookups(t.calls)).toHaveLength(2);
        const [row] = await stored();
        expect([row.state, row.external_user_id, row.external_display_name]).toEqual(['confirmed', 'UADA', 'Ada']);
    });

    it('a confirmation is refused when Slack no longer names a user for the email, or names one linked to someone else', async () => {
        const t = await boot();
        await t.install();
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        delete t.directory['u_ada@example.test'];
        const gone = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect([gone.body.error.code, gone.status]).toEqual(['RESOURCE_CONFLICT', 409]);

        // Two people whose verified email Slack resolves to one user: the first to confirm holds it.
        await t.setUser('u_admin', { email: 'u_bob@example.test' });
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'bob');
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'admin_a');
        expect((await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'bob')).body.data.link).toMatchObject({ slackUserId: 'UBOB', state: 'confirmed' });
        const taken = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'admin_a');
        expect([taken.body.error.code, taken.status]).toEqual(['RESOURCE_CONFLICT', 409]);
        expect(await t.store.confirmedUsers('org_a', ['u_ada', 'u_bob', 'u_admin'])).toEqual(new Set(['u_bob']));
    });

    it('a new proposal replaces one made for another email, and confirms for the new one', async () => {
        const t = await boot();
        await t.install();
        await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada');
        await t.setUser('u_ada', { email: 'ada.new@example.test' });
        expect((await t.call('POST', `${SLACK_LINK_ROUTE}/proposal`, 'ada')).body.data).toEqual({ link: { state: 'proposed' } });
        expect(await t.links()).toHaveLength(1);
        const confirmed = await t.call('POST', `${SLACK_LINK_ROUTE}/confirm`, 'ada');
        expect(confirmed.body.data.link).toMatchObject({ slackUserId: 'UADA2', state: 'confirmed' });
        expect(t.audit.filter((a) => a.event === 'afterDelete').map((a) => a.by)).toEqual(['u_ada']);
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
        expect(t.audit.filter((a) => a.event === 'afterDelete').map(({ event, id, by }) => ({ event, id, by }))).toEqual([{ event: 'afterDelete', id: row.id, by: 'u_admin' }]);
        expect(t.notices).toHaveLength(1);
        expect(t.notices[0]).toMatchObject({
            topic: SLACK_LINK_REMOVED_TOPIC, audience: ['user:u_ada'], organizationId: 'org_a', channels: ['inbox', 'email'], actorId: 'u_admin',
            keyedText: { titleKey: 'messages.slackLinkRemovedTitle', bodyKey: 'messages.slackLinkRemovedBody', params: { workspace: 'Acme' } },
        });

        const again = await t.connect('ada');
        expect(again.body.data.link).toMatchObject({ slackUserId: 'UADA', state: 'confirmed' });
        expect(t.audit.filter((a) => a.event === 'afterInsert').map((a) => a.by)).toEqual(['u_ada', 'u_ada']);
    });

    it('(2) an administrator removes only a link to their own organization\'s install', async () => {
        const t = await boot();
        await t.install();
        await t.connect('ada');
        await t.call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_b', { body: { token: GOOD } });
        const [row] = (await t.ql.find(CHANNEL_USER_LINK_OBJECT, { fields: ['id'] }, SYSTEM)) as any[];
        const other = await t.call('DELETE', `${SLACK_LINKS_ROUTE}/:id`, 'admin_b', { id: String(row.id) });
        expect([other.body.error?.code, other.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
        expect(await t.links()).toHaveLength(1);
        expect(t.notices).toEqual([]);
    });

    it('(2) the uninstall tells every linked person, however many pages their links take', async () => {
        const t = await boot({ linkPageSize: 2 });
        await t.install();
        for (const bearer of ['ada', 'bob', 'admin_a']) await t.connect(bearer);
        expect((await t.call('DELETE', SLACK_ACCOUNT_ROUTE, 'admin_a')).body.data).toEqual({ removed: true });
        expect(t.notices.map((n) => n.audience[0]).sort()).toEqual(['user:u_ada', 'user:u_admin', 'user:u_bob']);
        expect(t.audit.filter((a) => a.event === 'afterDelete').map((a) => a.by)).toEqual(['u_admin', 'u_admin', 'u_admin']);
        expect(await t.links()).toEqual([]);
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

    it('(3) a ban removes the person\'s links in every organization in one write, each removal audited', async () => {
        const t = await boot();
        await t.install();
        await t.call('PUT', SLACK_ACCOUNT_ROUTE, 'admin_b', { body: { token: GOOD } });
        await t.connect('admin_a');
        await t.connect('admin_b');
        await t.connect('ada');
        expect((await t.links()).map((l) => l.user_id).sort()).toEqual(['u_ada', 'u_admin', 'u_admin']);
        const deletes = vi.spyOn(t.ql, 'delete');
        await t.ql.update('sys_user', { banned: true }, { where: { id: 'u_admin' }, context: { isSystem: true, userId: 'u_ada' } } as never);
        expect(deletes.mock.calls.filter(([object]) => object === CHANNEL_USER_LINK_OBJECT)).toHaveLength(1);
        expect((await t.links()).map((l) => l.user_id)).toEqual(['u_ada']);
        expect(t.audit.filter((a) => a.event === 'afterDelete').map((a) => a.by)).toEqual(['u_ada', 'u_ada']);
    });

    it('(3) a link goes when the person\'s membership moves to another organization, audited as who moved it', async () => {
        const t = await boot();
        await t.install();
        await t.connect('ada');
        await t.connect('bob');
        const mover = { context: { isSystem: true, userId: 'u_admin' } as ExecutionContext };
        await t.ql.update('sys_member', { organization_id: 'org_b' }, { where: { id: 'm_bob' }, ...mover } as never);
        expect((await t.links()).map((l) => l.user_id)).toEqual(['u_ada']);
        expect(t.audit.filter((a) => a.event === 'afterDelete').map((a) => a.by)).toEqual(['u_admin']);
        // A write that leaves the organization as it was removes nothing.
        await t.ql.update('sys_member', { role: 'admin' }, { where: { id: 'm_ada' }, ...mover } as never);
        expect((await t.links()).map((l) => l.user_id)).toEqual(['u_ada']);
    });
});
