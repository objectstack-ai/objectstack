// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] Whether the messaging service knows the `slack` channel is a
 * composition fact: `MessagingServicePlugin` registers its provider only where
 * connector-slack's `slack` client service resolves at `kernel:ready`.
 *
 *  - without that service, `getKnownChannels()` does not list `slack`, so the
 *    two preference doors (`GET /api/v1/messaging/preference-options`,
 *    `GET /api/v1/messaging/me/preferences`) answer the channels they answer
 *    on a composition with no Slack at all;
 *  - with it, `slack` is known and mounted, and both doors list it.
 *
 * The `/automation` save doors read the same list; their side is pinned in
 * `@objectstack/runtime` (`automation-notify-slack-composition.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import { MY_PREFERENCES_ROUTE } from './my-preferences-routes.js';
import { PREFERENCE_OPTIONS_ROUTE } from './preference-options-routes.js';

const USER = 'usr_alice';
const ORG = 'org_a';

/** A plugin context with a fake engine, an HTTP server that keeps its handlers, and a session for one member. */
async function compose(opts: { slack: boolean }) {
    const tables = new Set<string>();
    const engine = {
        async syncObjectSchema(name: string) { tables.add(name); },
        async find(object: string, q: any = {}) {
            if (object === 'sys_member') {
                const where = q?.where ?? {};
                return where.user_id === USER && where.organization_id === ORG
                    ? [{ id: 'mem_alice', user_id: USER, organization_id: ORG, role: 'member' }]
                    : [];
            }
            return [] as unknown[];
        },
        async aggregate() { return [] as unknown[]; },
        async count() { return 0; },
        async insert() { return {}; },
        async findOne(object: string, query?: EngineFindOneQueryInput) { assertEngineFindOnePredicate(object, query); return null; },
        async update() { return {}; },
        async delete() { return {}; },
    };
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const mount = (verb: string) => (path: string, handler: (req: unknown, res: unknown) => Promise<void>) => { handlers.set(`${verb} ${path}`, handler); };
    const services = new Map<string, unknown>([
        ['data', engine],
        ['objectql', engine],
        ['manifest', { register() {} }],
        ['http-server', { get: mount('GET'), post: mount('POST'), put: mount('PUT'), delete: mount('DELETE'), patch: mount('PATCH'), use() {} }],
        ['auth', {
            api: {
                getSession: async ({ headers }: { headers: Headers }) => headers.get('authorization') === 'Bearer alice'
                    ? { user: { id: USER, email: `${USER}@example.test` }, session: { id: 'ses_alice', userId: USER, activeOrganizationId: ORG } }
                    : null,
            },
        }],
    ]);
    // connector-slack's client service, registered at init as ConnectorSlackPlugin does.
    if (opts.slack) services.set('slack', { client: () => ({ call: async () => ({ ok: true, status: 200, body: { ok: true } }) }) });
    const readyHooks: Array<() => Promise<void> | void> = [];
    const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
    const ctx = {
        logger,
        getService(name: string) {
            if (!services.has(name)) throw new Error(`[Kernel] Service '${name}' not found`);
            return services.get(name);
        },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook(event: string, fn: () => Promise<void> | void) { if (event === 'kernel:ready') readyHooks.push(fn); },
    } as any;
    await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
    for (const fn of readyHooks) await fn();

    async function get(route: string) {
        const handler = handlers.get(`GET ${route}`);
        if (!handler) throw new Error(`no GET ${route}`);
        const out: { status: number; body: any } = { status: 0, body: undefined };
        const res = { status: (c: number) => { out.status = c; return res; }, json: (b: unknown) => { out.body = b; }, header: () => res, send: () => undefined };
        await handler({ params: {}, query: {}, headers: { authorization: 'Bearer alice' }, method: 'GET', path: route }, res);
        expect(out.status, JSON.stringify(out.body)).toBe(200);
        return out.body.data;
    }
    return {
        messaging: services.get('messaging') as MessagingService,
        optionChannels: async () => (await get(PREFERENCE_OPTIONS_ROUTE)).channels.map((c: any) => c.value),
        myChannels: async () => (await get(MY_PREFERENCES_ROUTE)).channels.map((c: any) => c.channel),
    };
}

describe('the slack channel is known only where connector-slack is composed', () => {
    it('without a slack service: not known, not mounted, and neither preference door lists it', async () => {
        const c = await compose({ slack: false });
        expect(c.messaging.getKnownChannels().map((k) => k.id)).not.toContain('slack');
        expect(c.messaging.getChannel('slack')).toBeUndefined();
        expect(await c.optionChannels()).not.toContain('slack');
        expect(await c.myChannels()).not.toContain('slack');
        // The control: the channels the doors list are the service's own.
        expect(await c.optionChannels()).toContain('inbox');
        expect(await c.myChannels()).toContain('inbox');
    });

    it('with a slack service: known and mounted, and both preference doors list it', async () => {
        const c = await compose({ slack: true });
        expect(c.messaging.getKnownChannels()).toContainEqual({ id: 'slack', configured: true });
        expect(c.messaging.getChannel('slack')?.id).toBe('slack');
        expect(await c.optionChannels()).toContain('slack');
        expect(await c.myChannels()).toContain('slack');
    });
});
