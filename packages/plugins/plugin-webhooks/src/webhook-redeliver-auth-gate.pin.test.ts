// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — the webhook redeliver door refuses a session the authentication
 * policy HOLDS (an expired password, enforced MFA not yet enrolled) with the
 * REST seam's answer, on both of its faces, before it replays anything.
 *
 * ## What was open
 *
 * `serveRedeliver` read the caller's session for its 401 and for the tenant it
 * threads into the replay, and never asked the ADR-0069 gate about it. The
 * posture rides on the session user (`user.authGate`, set by plugin-auth's
 * `customSession` enrichment), so a held session replayed deliveries as an
 * ordinary signed-in caller — measured on a serve-shaped boot before this
 * change, where REST's `enforceAuth` and the dispatcher answer the same
 * session `403` with the gate's `code`.
 *
 * ## The census comes from the mount
 *
 * The door has two faces: the route mounted on the host's raw app, read off
 * that app's own route table with a count, and the `webhooks` slot's
 * `handleRedeliver`. Every case below is driven through both.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status` AND `error.code` — plus the gate's own
 * message, and a delivery that was NOT replayed: refusing after the replay
 * would already have re-sent it.
 *
 * ## Controls
 *
 * The same caller un-held replays the same delivery, and a CORS preflight is
 * answered the same held or not.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IWebhookService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { MemoryHttpOutbox, MessagingService } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';
import { webhookAdministrationSecurity } from './redeliver-entitlement.testkit.js';

const PATH = '/api/v1/webhooks/redeliver';
const ORIGIN = 'http://webhooks.test';
const SUBSCRIPTION = 'wh_live';
const ORG = 'org_a';
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

/** The gate postures plugin-auth's enrichment writes, one per policy. */
const POSTURES: Record<string, { code: string; message: string }> = {
    PASSWORD_EXPIRED: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' },
    MFA_REQUIRED: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
    },
};

/**
 * The collaborators the plugin resolves: the real messaging service over a
 * real outbox, an engine holding one active subscription, the host's raw app,
 * and an `auth` service whose session is keyed by `Bearer user@org`, held when
 * the credential names a posture (`Bearer user@org!PASSWORD_EXPIRED`) — the
 * session user then carries `authGate` exactly as `customSession` attaches it.
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: silentLogger });
    readonly app = new Hono();

    constructor() {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        const subscriptions = new Map([[SUBSCRIPTION, { id: SUBSCRIPTION, name: 'orders_hook', active: true }]]);
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', {
            registry: { listItems: () => [], getObject: () => undefined },
            async find() { return []; },
            async findOne(object: string, opts?: any) {
                assertEngineFindOnePredicate(object, opts);
                return subscriptions.get(opts?.where?.id) ?? null;
            },
            registerHook() {},
            unregisterHooksByPackage() { return 0; },
            async resolveSecretField() { return null; },
        });
        ctx.registerService('messaging', this.messaging);
        // The entitlement gate: every signed-in caller here administers webhooks.
        ctx.registerService('security', webhookAdministrationSecurity());
        ctx.registerService('auth', {
            api: {
                async getSession(input: { headers: Headers }) {
                    const auth = input.headers.get('authorization') ?? '';
                    const match = /^Bearer (\w+)@(\w+)(?:!(\w+))?$/.exec(auth);
                    if (!match) return null;
                    const authGate = match[3] ? POSTURES[match[3]] : undefined;
                    return {
                        user: { id: match[1], ...(authGate ? { authGate } : {}) },
                        session: { userId: match[1], activeOrganizationId: match[2] },
                    };
                },
            },
        });
        const app = this.app;
        ctx.registerService('http.server', { getRawApp: () => app });
    }
}

const openKernels: LiteKernel[] = [];

afterEach(async () => {
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
});

async function boot() {
    const fixture = new FixturePlugin();
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    openKernels.push(kernel);
    kernel.use(fixture);
    kernel.use(new WebhookOutboxPlugin());
    await kernel.bootstrap();

    /** The two faces of the one door. */
    const faces: Record<'mount' | 'member', (request: Request) => Promise<Response>> = {
        mount: async (request) => fixture.app.fetch(request),
        member: (request) => {
            const svc = kernel.getService<IWebhookService>('webhooks');
            if (typeof svc?.handleRedeliver !== 'function') throw new Error('the webhooks slot holds no handleRedeliver');
            return svc.handleRedeliver(request);
        },
    };
    /** A delivery the dispatcher attempted once and dead-lettered: a row redeliver may replay. */
    const attempted = async (): Promise<string> => {
        const id = await fixture.outbox.enqueue({
            source: 'webhook', refId: SUBSCRIPTION, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
            payload: { event: 'record.created' }, organizationId: ORG,
        });
        const claimed = (await fixture.outbox.claim({ nodeId: 'node_1', limit: 100, claimTtlMs: 60_000 }))
            .find((row) => row.id === id)!;
        await fixture.outbox.ack(
            id,
            { success: false, dead: true, httpStatus: 500, error: 'HTTP 500', durationMs: 5 },
            { claimedBy: claimed.claimedBy!, claimedAt: claimed.claimedAt! },
        );
        return id;
    };
    const statusOf = async (id: string) => (await fixture.outbox.list()).find((row) => row.id === id)?.status;
    return { kernel, fixture, faces, attempted, statusOf };
}

const redeliver = (deliveryId: string, auth: string, method = 'POST') =>
    new Request(`${ORIGIN}${PATH}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(method === 'POST' ? { body: JSON.stringify({ deliveryId }) } : {}),
    });

async function read(res: Response) {
    const text = await res.text();
    let body: any;
    try {
        body = text ? JSON.parse(text) : undefined;
    } catch {
        body = text;
    }
    return { status: res.status, body };
}

const FACES = ['mount', 'member'] as const;

describe('the redeliver door census — read off the mount', () => {
    it('mounts exactly one route on the host raw app, POST at the redeliver path, and fills the webhooks slot', async () => {
        const { kernel, fixture } = await boot();
        // ⭐ A count, on purpose: a second route on this app has to come through this file.
        expect(fixture.app.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${PATH}`]);
        expect(typeof kernel.getService<IWebhookService>('webhooks').handleRedeliver).toBe('function');
    });
});

describe('ADR-0069 — a held session is refused 403 with the gate code, on both faces, before any replay', () => {
    for (const face of FACES) {
        for (const posture of Object.keys(POSTURES)) {
            it(`${face} · held by ${posture} → 403 ${posture}, the delivery not replayed`, async () => {
                const { faces, attempted, statusOf } = await boot();
                const id = await attempted();
                const before = await statusOf(id);
                const { status, body } = await read(await faces[face](redeliver(id, `u_1@${ORG}!${posture}`)));
                expect(status).toBe(403);
                expect(body?.success).toBe(false);
                expect(body?.error?.code).toBe(posture);
                expect(body?.error?.message).toBe(POSTURES[posture]!.message);
                expect(body?.data).toBeUndefined();
                expect(await statusOf(id)).toBe(before);
            });
        }
    }
});

describe('CONTROL — the same caller un-held replays the same delivery', () => {
    for (const face of FACES) {
        it(`${face} · un-held → 200, and the delivery is replayed`, async () => {
            const { faces, attempted, statusOf } = await boot();
            const id = await attempted();
            const before = await statusOf(id);
            const { status, body } = await read(await faces[face](redeliver(id, `u_1@${ORG}`)));
            expect(status).toBe(200);
            expect(body?.success).toBe(true);
            expect(body?.data?.id).toBe(id);
            expect(await statusOf(id)).not.toBe(before);
        });
    }
});

describe('CONTROL — a CORS preflight is answered the same, held or not', () => {
    it('OPTIONS on the mounted path: held === un-held, and never the gate', async () => {
        const { faces, attempted } = await boot();
        const id = await attempted();
        const held = await read(await faces.mount(redeliver(id, `u_1@${ORG}!PASSWORD_EXPIRED`, 'OPTIONS')));
        const unheld = await read(await faces.mount(redeliver(id, `u_1@${ORG}`, 'OPTIONS')));
        expect(held).toEqual(unheld);
        expect(held.body?.error?.code).not.toBe('PASSWORD_EXPIRED');
    });
});
