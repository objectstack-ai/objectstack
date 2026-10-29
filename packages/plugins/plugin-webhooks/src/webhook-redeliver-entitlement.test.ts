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
 * The caller's context is resolved by the real composition
 * (`resolveRequestExecutionContext`), so the organization vetting is the real
 * session arm, fed the fixture's `tenancy` service and `sys_member` rows.
 *
 * What this pins:
 *  1. an entitled caller is admitted: the delivery is replayed, and the gate
 *     asked about the caller the session named, in its organization;
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
 *     `503 SERVICE_UNAVAILABLE` and replays nothing; the first is also said
 *     once at boot;
 *  5. order: an anonymous caller is still `401` and the gate is never asked;
 *  6. the organization claim is vetted against the tenancy posture, as on the
 *     data API: on a walled posture a claim no current membership backs is
 *     refused with the same answer as (2), nothing replayed; a backed claim is
 *     admitted and the replay is scoped to that organization;
 *  7. the door's `tenancy` resolver, on a real `ObjectKernel`: never
 *     registered reads as no posture, registered-and-failing is the `503`.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { LiteKernel, ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IWebhookService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { MemoryHttpOutbox, MessagingService } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';
import { judgeRedeliverEntitlement, redeliverTenancyResolver } from './redeliver-entitlement.js';
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
const NO_DECIDER_BOOT_LINE = 'no security service is registered to decide who may administer webhooks';

type SecurityShape = 'double' | 'absent' | 'throws';

interface Membership {
    readonly user_id: string;
    readonly organization_id: string;
}

interface FixtureOptions {
    readonly security?: SecurityShape;
    /** The `tenancy` service's posture; omitted, no `tenancy` service is registered. */
    readonly posture?: 'single' | 'isolated' | 'group';
    /** The `sys_member` rows the permission store holds. */
    readonly memberships?: readonly Membership[];
}

/** Equality on every key of a `where`, the only shape the grant resolver issues here. */
const matches = (row: Membership, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);

class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: { info() {}, warn() {}, error() {}, debug() {} } as any });
    readonly app = new Hono();
    readonly security: WebhookAdministrationSecurityDouble = webhookAdministrationSecurity((id) => id === ADMIN);
    readonly redeliverCalls: Array<{ id: string; tenantId: unknown }> = [];

    constructor(private readonly options: FixtureOptions) {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        const subscriptions = new Map<string, Record<string, unknown>>([
            [LIVE, { id: LIVE, name: LIVE_NAME, active: true }],
            [INACTIVE, { id: INACTIVE, name: INACTIVE_NAME, active: false }],
        ]);
        const memberships = this.options.memberships ?? [];
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', {
            registry: { listItems: () => [], getObject: () => undefined },
            async find(object: string, query?: any) {
                if (object !== 'sys_member') return [];
                const rows = memberships.filter((row) => matches(row, query?.where));
                return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
            },
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
            calls.push({ id, tenantId: options?.tenantId });
            return realRedeliver(id, options);
        }) as typeof messaging.redeliverHttp;
        ctx.registerService('messaging', messaging);
        const shape = this.options.security ?? 'double';
        if (shape === 'double') ctx.registerService('security', this.security);
        if (shape === 'throws') {
            ctx.registerService('security', {
                async explain() { throw new Error('permission store unreachable'); },
            });
        }
        if (this.options.posture) ctx.registerService('tenancy', { posture: this.options.posture });
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

async function boot(options: FixtureOptions = {}) {
    const fixture = new FixturePlugin(options);
    const errors: string[] = [];
    const warnings: string[] = [];
    class ObservedPlugin extends WebhookOutboxPlugin {
        override async init(ctx: PluginContext): Promise<void> {
            const originalError = ctx.logger.error?.bind(ctx.logger);
            ctx.logger.error = ((message: unknown, ...rest: unknown[]) => {
                errors.push(String(message));
                return originalError?.(message as any, ...(rest as []));
            }) as any;
            const originalWarn = ctx.logger.warn?.bind(ctx.logger);
            ctx.logger.warn = ((message: unknown, ...rest: unknown[]) => {
                warnings.push(String(message));
                return originalWarn?.(message as any, ...(rest as []));
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
    return { fixture, faces, attempted, statusOf, errors, warnings };
}

const post = (body: unknown, caller: string | null, organization: string = ORG_A): RequestInit => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        ...(caller ? { Authorization: `Bearer ${caller}@${organization}` } : {}),
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
            const { fixture, faces, attempted, statusOf, warnings } = await boot();
            const id = await attempted(ORG_A);

            const answer = await read(await faces[face](post({ deliveryId: id }, ADMIN)));

            expect(answer.status).toBe(200);
            expect(answer.json).toEqual({ success: true, data: { id, status: 'pending' } });
            expect(await statusOf(id)).toBe('pending');
            expect(fixture.security.asked).toEqual([
                { object: 'sys_webhook', operation: 'update', userId: ADMIN, tenantId: ORG_A },
            ]);
            expect(fixture.redeliverCalls).toEqual([{ id, tenantId: ORG_A }]);
            // A kernel with a security service says nothing about it at boot.
            expect(warnings.filter((m) => m.includes(NO_DECIDER_BOOT_LINE))).toEqual([]);
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
                const { fixture, faces, attempted, statusOf, errors } = await boot({ security: shape });
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

    it('a kernel with no security service says so ONCE at boot, naming the remedy, though both faces are served', async () => {
        const { warnings } = await boot({ security: 'absent' });
        const lines = warnings.filter((m) => m.includes(NO_DECIDER_BOOT_LINE));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('503 SERVICE_UNAVAILABLE');
        expect(lines[0]).toContain('@objectstack/plugin-security');
    });
});

describe('the redeliver door vets the organization claim against the tenancy posture, as the data API does', () => {
    for (const face of ['member', 'mount'] as const) {
        it(`${face}: isolated — a claim no current membership backs is refused with the caller-level answer, nothing replayed`, async () => {
            // ADMIN would be admitted by the security double; only the vetting
            // stands between. MEMBER's claim IS backed, so its refusal is the
            // administration refusal the answer is compared against.
            const { fixture, faces, attempted, statusOf } = await boot({
                posture: 'isolated',
                memberships: [{ user_id: MEMBER, organization_id: ORG_A }],
            });
            const id = await attempted(ORG_A);

            const refused = await read(await faces[face](post({ deliveryId: id }, ADMIN)));
            const unentitled = await read(await faces[face](post({ deliveryId: id }, MEMBER)));

            expect(refused.status).toBe(403);
            expect(refused.json).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
            // The same body as the refusal of a caller who administers nothing.
            expect(refused.text).toBe(unentitled.text);
            expect(refused.text).not.toContain(id);
            expect(fixture.redeliverCalls).toEqual([]);
            expect(await statusOf(id)).toBe('dead');
        });

        it(`${face}: group — a claim on an organization the caller left is refused, for its rows and for the organization it still belongs to`, async () => {
            const { fixture, faces, attempted, statusOf } = await boot({
                posture: 'group',
                memberships: [
                    { user_id: ADMIN, organization_id: ORG_B },
                    { user_id: MEMBER, organization_id: ORG_A },
                ],
            });
            const claimed = await attempted(ORG_A);
            const stillMember = await attempted(ORG_B);
            const unentitled = await read(await faces[face](post({ deliveryId: claimed }, MEMBER)));

            for (const id of [claimed, stillMember]) {
                const answer = await read(await faces[face](post({ deliveryId: id }, ADMIN, ORG_A)));
                expect(answer.status, id).toBe(403);
                expect(answer.text, id).toBe(unentitled.text);
            }
            expect(fixture.redeliverCalls).toEqual([]);
            for (const id of [claimed, stillMember]) expect(await statusOf(id)).toBe('dead');
        });

        it(`${face}: control — a claim a current membership backs is admitted, and the replay is scoped to that organization`, async () => {
            const { fixture, faces, attempted, statusOf } = await boot({
                posture: 'isolated',
                memberships: [{ user_id: ADMIN, organization_id: ORG_A }],
            });
            const own = await attempted(ORG_A);
            const other = await attempted(ORG_B);

            const admitted = await read(await faces[face](post({ deliveryId: own }, ADMIN)));
            expect(admitted.status).toBe(200);
            expect(await statusOf(own)).toBe('pending');

            const outside = await read(await faces[face](post({ deliveryId: other }, ADMIN)));
            expect(outside.status).toBe(404);
            expect(outside.json).toMatchObject({ success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
            expect(await statusOf(other)).toBe('dead');

            expect(fixture.redeliverCalls).toEqual([
                { id: own, tenantId: ORG_A },
                { id: other, tenantId: ORG_A },
            ]);
            expect(fixture.security.asked.map((q) => q.tenantId)).toEqual([ORG_A, ORG_A]);
        });
    }
});

describe('the door\'s tenancy resolver, on a real ObjectKernel registry', () => {
    // The classification under test is the registry's own (branded "never
    // registered" versus the unbranded rejection of a factory that threw), so
    // the kernel is real and nothing at the seam is stubbed.
    const kernelWith = (wiring: 'unregistered' | 'isolated' | 'factory-throws') => {
        const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
        if (wiring === 'isolated') kernel.registerService('tenancy', { posture: 'isolated' });
        if (wiring === 'factory-throws') {
            kernel.registerServiceFactory('tenancy', () => {
                throw new Error('tenancy backend unavailable');
            });
        }
        return kernel;
    };
    const judge = async (kernel: ObjectKernel) => {
        const security = webhookAdministrationSecurity((id) => id === ADMIN);
        const logged: string[] = [];
        const ctx = {
            getKernel: () => kernel,
            getService: <T>(name: string): T => kernel.getService<T>(name),
        } as unknown as PluginContext;
        const verdict = await judgeRedeliverEntitlement({
            headers: new Headers(),
            ql: { async find() { return []; } },
            authService: undefined,
            tenancy: redeliverTenancyResolver(ctx),
            security,
            userId: ADMIN,
            activeOrganizationId: ORG_A,
            logError: (message) => logged.push(message),
        });
        return { verdict, asked: security.asked, logged };
    };

    it('never registered: no posture, so the claim stands and the caller is admitted in it', async () => {
        const { verdict, asked } = await judge(kernelWith('unregistered'));
        expect(verdict).toEqual({ admitted: true, tenantId: ORG_A });
        expect(asked.map((q) => q.tenantId)).toEqual([ORG_A]);
    });

    it('registered with a walled posture: the unbacked claim is dropped and refused 403', async () => {
        const { verdict } = await judge(kernelWith('isolated'));
        expect(verdict).toMatchObject({ admitted: false, refusal: { status: 403, code: 'PERMISSION_DENIED' } });
    });

    it('registered and unable to answer: no verdict was reached, so 503, the cause logged, and the security service never asked', async () => {
        const { verdict, asked, logged } = await judge(kernelWith('factory-throws'));
        expect(verdict).toMatchObject({ admitted: false, refusal: { status: 503, code: 'SERVICE_UNAVAILABLE' } });
        expect(asked).toEqual([]);
        expect(logged.some((m) => m.includes('redeliver entitlement could not be decided'))).toBe(true);
    });
});
