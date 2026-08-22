// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10740 — `POST /api/v1/webhooks/redeliver` carries the CALLER'S tenant.
 *
 * This route is the reason `SqlHttpOutbox.redeliver` is classified
 * request-contextual rather than as a dispatcher sweep: its auth gate is "any
 * authenticated user", and `sys_http_delivery` is a tenant-scoped object. On a
 * walled deployment (`OS_TENANCY_POSTURE=isolated`) an unscoped replay from
 * here is an authenticated user writing another organization's delivery row —
 * exactly what the driver's tenant audit exists to catch, and the one site
 * where silencing that audit would convert a detectable hole into an
 * undetectable one.
 *
 * ## What this file pins that the service-level test cannot
 * The tenant has to come from the REQUEST. `service-messaging`'s
 * `delivery-update-tenant-audit.integration.test.ts` proves the outbox applies
 * whatever tenant it is handed, right down to the options that reach the
 * driver; nothing there can prove the route hands it the right one, or hands
 * it anything at all. Here the session is the only source of the value, so a
 * route that dropped it would go red.
 *
 * It also pins the HTTP half of the ADR-0112 envelope: the service layer
 * carries the `code`, and the `status` exists only at this boundary. Both are
 * asserted for the cross-tenant refusal — a `code` assertion alone would not
 * notice the refusal surfacing as a 500.
 */

import { describe, it, expect } from 'vitest';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

/** Captures the handler `registerAdminRoutes` mounts, and lets us call it. */
function mountRoute(opts: {
    session: any;
    redeliverHttp: (id: string, options: { tenantId: string | undefined }) => Promise<any>;
}): { post: (body: any) => Promise<{ status: number; json: any }> } {
    let handler: ((c: any) => Promise<any>) | undefined;
    const rawApp = {
        post(path: string, h: (c: any) => Promise<any>) {
            if (path === '/api/v1/webhooks/redeliver') handler = h;
        },
    };
    const services: Record<string, any> = {
        'http-server': { getRawApp: () => rawApp },
        messaging: {
            // `getMessaging` gates on this being a function.
            enqueueHttp: async () => 'unused',
            isHttpDeliveryReady: () => true,
            registerRedeliverGuard: () => {},
            redeliverHttp: opts.redeliverHttp,
        },
        auth: { api: { getSession: async () => opts.session } },
    };
    const ctx: any = {
        getService: (n: string) => services[n],
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };
    (new WebhookOutboxPlugin() as any).registerAdminRoutes(ctx);
    if (!handler) throw new Error('route was not mounted');

    return {
        async post(body: any) {
            let status = 200;
            let json: any;
            const c = {
                req: { raw: { headers: new Headers() }, json: async () => body },
                json(payload: any, s?: number) {
                    json = payload;
                    if (s !== undefined) status = s;
                    return { status, json };
                },
            };
            await handler!(c);
            return { status, json };
        },
    };
}

/** A better-auth session envelope: `{ user, session }`. */
const sessionFor = (userId: string, activeOrganizationId?: string) => ({
    user: { id: userId },
    session: { userId, ...(activeOrganizationId ? { activeOrganizationId } : {}) },
});

describe('POST /api/v1/webhooks/redeliver — the caller\'s tenant reaches the outbox (#10740)', () => {
    it('threads the session\'s active organization into redeliverHttp', async () => {
        const seen: Array<{ id: string; tenantId: string | undefined }> = [];
        const route = mountRoute({
            session: sessionFor('user_1', 'org_a'),
            async redeliverHttp(id, options) {
                seen.push({ id, tenantId: options.tenantId });
                return { id, status: 'pending' };
            },
        });

        const res = await route.post({ deliveryId: 'del_1' });

        expect(res.status).toBe(200);
        expect(res.json).toEqual({ success: true, data: { id: 'del_1', status: 'pending' } });
        // The whole point: not `undefined`, and not some other org.
        expect(seen).toEqual([{ id: 'del_1', tenantId: 'org_a' }]);
    });

    it('refuses a cross-tenant delivery id with RESOURCE_NOT_FOUND and 404', async () => {
        // The outbox scopes its reads by the tenant it is handed, so a row in
        // another organization is INVISIBLE rather than forbidden — which is
        // also what stops this endpoint being an existence oracle for other
        // tenants' delivery ids.
        const route = mountRoute({
            session: sessionFor('user_1', 'org_a'),
            async redeliverHttp() {
                const err: any = new Error("Delivery row 'del_other' not found");
                err.name = 'HttpRedeliverError';
                err.code = 'RESOURCE_NOT_FOUND';
                throw err;
            },
        });

        const res = await route.post({ deliveryId: 'del_other' });

        // ADR-0112: `code` AND `status`. Either alone passes on a refusal that
        // surfaced as a 500, or on a 404 carrying the wrong code.
        expect(res.json?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(res.status).toBe(404);
    });

    it('threads `undefined` for a session with no active organization — reported, never silenced', async () => {
        // The honest half. The deployment could not tell the route which
        // organization is asking, so the write goes out unscoped and the
        // driver's tenant-audit line fires for it. ⛔ The repair for that is
        // never `bypassTenantAudit`, which would hide the report and close
        // nothing — so what this pins is that the route invents no tenant.
        const seen: Array<string | undefined> = [];
        const route = mountRoute({
            session: sessionFor('user_1'),
            async redeliverHttp(id, options) {
                seen.push(options.tenantId);
                return { id, status: 'pending' };
            },
        });

        const res = await route.post({ deliveryId: 'del_1' });

        expect(res.status).toBe(200);
        expect(seen).toEqual([undefined]);
    });

    it('never reaches the outbox at all for an unauthenticated caller', async () => {
        // The pre-existing gate, re-pinned because the session lookup was
        // widened from "user id" to the whole envelope: a widening that lost
        // the auth check would be invisible to every assertion above.
        let called = 0;
        const route = mountRoute({
            session: null,
            async redeliverHttp(id) {
                called += 1;
                return { id, status: 'pending' };
            },
        });

        const res = await route.post({ deliveryId: 'del_1' });

        expect(res.status).toBe(401);
        expect(res.json?.error?.code).toBe('UNAUTHENTICATED');
        expect(called).toBe(0);
    });
});
