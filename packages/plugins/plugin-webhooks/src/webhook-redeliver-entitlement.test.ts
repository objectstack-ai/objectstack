// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The webhook redeliver door (`POST /api/v1/webhooks/redeliver`) is gated on
 * webhook-administration access (`redeliver-entitlement.ts`), at the HTTP
 * layer, on BOTH faces: the self-hosted raw-app mount and the `webhooks`
 * slot's `handleRedeliver`.
 *
 * Driven on a real `LiteKernel` with the plugin's real boot, over the real
 * `MessagingService` and `MemoryHttpOutbox`, so a replay is a real row reset
 * and a refusal is observable as a row left alone. The `security` service is
 * a double that answers the gate's one question (may this caller `update`
 * `sys_webhook`?) for a named administrator, and records what it was asked.
 *
 * What this pins:
 *  1. an entitled caller is admitted: the delivery is replayed, and the gate
 *     asked about the caller the session named;
 *  2. a signed-in caller who is not entitled is refused `403
 *     PERMISSION_DENIED` with ONE answer whatever the request names — an
 *     existing delivery, another organization's, one whose subscription is
 *     inactive or gone, an unknown id, a malformed body — so no answer depends
 *     on a row, none carries a delivery id, subscription id or webhook name,
 *     and no row is touched;
 *  3. control: the entitled caller still gets the row-level refusals
 *     (the inactive subscription's `409`), so the gate hides nothing from an
 *     administrator;
 *  4. fail closed: no security service, or one whose decision throws, refuses
 *     `503 SERVICE_UNAVAILABLE` and replays nothing;
 *  5. order: an anonymous caller is still `401` and the gate is never asked.
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
import { webhookAdministrationSecurity, type WebhookAdministrationSecurityDouble } from './redeliver-entitlement.testkit.js';

const PATH = '/api/v1/webhooks/redeliver';
const ORIGIN = 'http://webhooks.test';
const ADMIN = 'u_admin';
const MEMBER = 'u_member';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const LIVE = 'wh_live';
const LIVE_NAME = 'orders_hook';
const INACTIVE = 'wh_off';
const INACTIVE_NAME = 'paused_hook';
const GONE = 'wh_gone';

type SecurityShape = 'double' | 'absent' | 'throws';

class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: { info() {}, warn() {}, error() {}, debug() {} } as any });
    readonly app = new Hono();
    readonly security: WebhookAdministrationSecurityDouble = webhookAdministrationSecurity((id) => id === ADMIN);
    readonly redeliverCalls: string[] = [];

    constructor(private readonly securityShape: SecurityShape) {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        const subscriptions = new Map<string, Record<string, unknown>>([
            [LIVE, { id: LIVE, name: LIVE_NAME, active: true }],
            [INACTIVE, { id: INACTIVE, name: INACTIVE_NAME, active: false }],
        ]);
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
        const messaging = this.messaging;
        const calls = this.redeliverCalls;
        const realRedeliver = messaging.redeliverHttp.bind(messaging);
        messaging.redeliverHttp = (async (id: string, options: any) => {
            calls.push(id);
            return realRedeliver(id, options);
        }) as typeof messaging.redeliverHttp;
        ctx.registerService('messaging', messaging);
        if (this.securityShape === 'double') ctx.registerService('security', this.security);
        if (this.securityShape === 'throws') {
            ctx.registerService('security', {
                async explain() { throw new Error('permission store unreachable'); },
            });
        }
        ctx.registerService('auth', {
            api: {
                async getSession(input: { headers: Headers }) {
                    const match = /^Bearer (\w+)@(\w+)$/.exec(input.headers.get('authorization') ?? '');
                    if (!match) return null;
                    return { user: { id: match[1] }, session: { userId: match[1], activeOrganizationId: match[2] } };
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

async function boot(securityShape: SecurityShape = 'double') {
    const fixture = new FixturePlugin(securityShape);
    const errors: string[] = [];
    class ObservedPlugin extends WebhookOutboxPlugin {
        override async init(ctx: PluginContext): Promise<void> {
            const original = ctx.logger.error?.bind(ctx.logger);
            ctx.logger.error = ((message: unknown, ...rest: unknown[]) => {
                errors.push(String(message));
                return original?.(message as any, ...(rest as []));
            }) as any;
            await super.init(ctx);
        }
    }
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    openKernels.push(kernel);
    kernel.use(fixture);
    kernel.use(new ObservedPlugin());
    await kernel.bootstrap();

    const slot = kernel.getService<IWebhookService>('webhooks');
    const faces = {
        member: (init: RequestInit) => slot.handleRedeliver!(new Request(`${ORIGIN}${PATH}`, init)),
        mount: (init: RequestInit) => Promise.resolve(fixture.app.request(`${ORIGIN}${PATH}`, init)),
    };

    /** A delivery attempted once and dead-lettered: a row an administrator may replay. */
    const attempted = async (organizationId: string, refId = LIVE): Promise<string> => {
        const id = await fixture.outbox.enqueue({
            source: 'webhook', refId, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
            payload: { event: 'record.created' }, organizationId,
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
    return { fixture, faces, attempted, statusOf, errors };
}

const post = (body: unknown, caller: string | null): RequestInit => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        ...(caller ? { Authorization: `Bearer ${caller}@${ORG_A}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function read(res: Response) {
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) };
}

describe('the redeliver door admits a caller entitled to administer webhooks', () => {
    for (const face of ['member', 'mount'] as const) {
        it(`${face}: an administrator replays a finished delivery, and the gate asked about that caller`, async () => {
            const { fixture, faces, attempted, statusOf } = await boot();
            const id = await attempted(ORG_A);

            const answer = await read(await faces[face](post({ deliveryId: id }, ADMIN)));

            expect(answer.status).toBe(200);
            expect(answer.json).toEqual({ success: true, data: { id, status: 'pending' } });
            expect(await statusOf(id)).toBe('pending');
            expect(fixture.security.asked).toEqual([{ object: 'sys_webhook', operation: 'update', userId: ADMIN }]);
        });

        it(`${face}: control — an administrator still gets the row-level refusal for an inactive subscription`, async () => {
            const { faces, attempted, statusOf } = await boot();
            const id = await attempted(ORG_A, INACTIVE);

            const answer = await read(await faces[face](post({ deliveryId: id }, ADMIN)));

            expect(answer.status).toBe(409);
            expect(answer.json).toMatchObject({ success: false, error: { code: 'DELIVERY_NOT_ELIGIBLE' } });
            expect(answer.text).toContain(INACTIVE_NAME);
            expect(await statusOf(id)).toBe('dead');
        });
    }
});

describe('the redeliver door refuses a signed-in caller not entitled to administer webhooks', () => {
    for (const face of ['member', 'mount'] as const) {
        it(`${face}: 403 PERMISSION_DENIED, one answer whatever the request names, no row detail, nothing replayed`, async () => {
            const { fixture, faces, attempted, statusOf } = await boot();
            const finished = await attempted(ORG_A);
            const otherOrg = await attempted(ORG_B);
            const inactive = await attempted(ORG_A, INACTIVE);
            const gone = await attempted(ORG_A, GONE);

            const requests: Array<[string, RequestInit]> = [
                ['a finished delivery of the caller\'s organization', post({ deliveryId: finished }, MEMBER)],
                ['another organization\'s delivery', post({ deliveryId: otherOrg }, MEMBER)],
                ['a delivery whose subscription is inactive', post({ deliveryId: inactive }, MEMBER)],
                ['a delivery whose subscription is gone', post({ deliveryId: gone }, MEMBER)],
                ['an unknown delivery', post({ deliveryId: randomUUID() }, MEMBER)],
                ['no deliveryId', post({}, MEMBER)],
                ['a body that is not JSON', post('{deliveryId:', MEMBER)],
            ];
            const answers = [];
            for (const [label, init] of requests) {
                const answer = await read(await faces[face](init));
                expect(answer.status, label).toBe(403);
                expect(answer.json, label).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
                for (const detail of [finished, otherOrg, inactive, gone, LIVE, INACTIVE, GONE, LIVE_NAME, INACTIVE_NAME]) {
                    expect(answer.text, `${label} discloses ${detail}`).not.toContain(detail);
                }
                answers.push(answer.text);
            }
            // One answer for every request: nothing in it depends on a row.
            expect(new Set(answers).size).toBe(1);
            // Refused before any row was looked up, and no row was touched.
            expect(fixture.redeliverCalls).toEqual([]);
            for (const id of [finished, otherOrg, inactive, gone]) expect(await statusOf(id)).toBe('dead');
        });
    }

    it('an anonymous caller is still 401 UNAUTHENTICATED, and the gate is never asked', async () => {
        const { fixture, faces, attempted } = await boot();
        const id = await attempted(ORG_A);
        const answer = await read(await faces.member(post({ deliveryId: id }, null)));
        expect(answer.status).toBe(401);
        expect(answer.json).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
        expect(fixture.security.asked).toEqual([]);
    });
});

describe('the redeliver door fails closed when entitlement cannot be decided', () => {
    for (const [shape, label] of [['absent', 'no security service is registered'], ['throws', 'the decision throws']] as const) {
        for (const face of ['member', 'mount'] as const) {
            it(`${face}: ${label} → 503 SERVICE_UNAVAILABLE, nothing replayed`, async () => {
                const { fixture, faces, attempted, statusOf, errors } = await boot(shape);
                const id = await attempted(ORG_A);

                const answer = await read(await faces[face](post({ deliveryId: id }, ADMIN)));

                expect(answer.status).toBe(503);
                expect(answer.json).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
                expect(answer.text).not.toContain(id);
                expect(fixture.redeliverCalls).toEqual([]);
                expect(await statusOf(id)).toBe('dead');
                if (shape === 'throws') {
                    expect(errors.some((m) => m.includes('redeliver entitlement could not be decided'))).toBe(true);
                }
            });
        }
    }
});
