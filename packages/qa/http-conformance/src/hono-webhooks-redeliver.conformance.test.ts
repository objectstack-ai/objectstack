// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22755] The webhook redeliver door through BOTH doors, on the REAL
 * plugin-webhooks member — segment 2 of #22564's stage 2 (ruling A on #22438),
 * with segment 1's contract and #22756's member behind it. This is the
 * end-to-end pin the card owes as the segment that landed second.
 *
 *  - THE SELF-HOSTED DOOR: a kernel with a real `HonoServerPlugin` (port 0), on
 *    whose raw app `WebhookOutboxPlugin` mounts `POST
 *    /api/v1/webhooks/redeliver` itself, driven over a real socket.
 *  - THE HOSTED DOOR: a kernel with NO `http.server` — a tenant kernel owns no
 *    socket — under the real `createHonoApp` (this checkout's source, via the
 *    package alias), whose `${prefix}/*` catch-all hands the request to the
 *    real `HttpDispatcher` and its `/webhooks/redeliver` domain, which forwards
 *    it to the real `webhooks` slot's `handleRedeliver`.
 *
 * Both kernels run the real plugin's boot (its `kernel:ready` hook installs the
 * redelivery veto and registers the `webhooks` slot, and mounts the route where
 * a raw app exists) over the real `MessagingService` and the real
 * `MemoryHttpOutbox`, so every answer below is the member's or the mount's own.
 * The data engine (the subscriptions the veto reads) and the `auth` service
 * (sessions keyed by the `Authorization` header) are fixtures, as in the
 * plugin's own member suite.
 *
 * What this pins:
 *  1. the hosted door reaches the member: an authenticated `POST` replays a
 *     finished delivery in the caller's organization, and the row's status
 *     moves in the outbox — so the JSON body crossed the catch-all unread, or
 *     the member would have answered `400 INVALID_REQUEST`;
 *  2. an anonymous call is refused at the hosted door exactly as the
 *     self-hosted mount refuses it, and so is every other refusal the contract
 *     declares — status, `code`, headers and body bytes equal at both doors;
 *  3. method: the domain is exact-`POST`, and the member never runs for any
 *     other method — the hosted door answers the dispatcher's
 *     `404 ROUTE_NOT_FOUND` (the self-hosted door's own 404 is
 *     plugin-hono-server's `ENDPOINT_NOT_FOUND`, measured beside it);
 *  4. absence across the segment boundary: with the member removed from the
 *     real service, with the slot left empty by the plugin's own boot (a
 *     messaging service that cannot take the veto), or with no plugin at all,
 *     the hosted door answers `501 NOT_IMPLEMENTED` — ⛔ never
 *     `ROUTE_NOT_FOUND`;
 *  5. CONTROL: on the kernel with `http.server` the route is mounted once, on
 *     the raw app, and answered by the mount — no dispatcher envelope in its
 *     bytes; this change adds no mount there.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { MemoryHttpOutbox, MessagingService } from '@objectstack/service-messaging';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer, IWebhookService } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const PATH = `${PREFIX}/webhooks/redeliver`;
const SUBSCRIPTION = 'wh_live';
const GONE_SUBSCRIPTION = 'wh_gone';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

/**
 * Stands in for the plugin's declared dependency
 * (`dependencies = ['com.objectstack.service.messaging']`) and registers what
 * it resolves: the real messaging service over a real outbox, an engine
 * holding the subscriptions, and an `auth` service whose sessions are keyed by
 * the request's `Authorization` header (`Bearer <user>@<org>`).
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: silentLogger });

    constructor(private readonly guardable: boolean) {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        const subscriptions = new Map<string, Record<string, unknown>>([
            [SUBSCRIPTION, { id: SUBSCRIPTION, name: 'orders_hook', active: true }],
        ]);
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', {
            registry: { listItems: () => [], getObject: () => undefined },
            async find() { return []; },
            async findOne(object: string, opts?: any) {
                assertEngineFindOnePredicate(object, opts);
                return subscriptions.get(opts?.where?.id) ?? null;
            },
            registerHook() { /* provenance stamp + headers gate + cleartext gate */ },
            unregisterHooksByPackage() { return 0; },
        });
        const messaging = this.messaging;
        ctx.registerService('messaging', this.guardable
            ? messaging
            // A messaging surface with no `registerRedeliverGuard`: the plugin
            // then installs no veto and, by its own rule, registers no slot.
            : {
                enqueueHttp: (input: any) => messaging.enqueueHttp(input),
                isHttpDeliveryReady: () => messaging.isHttpDeliveryReady(),
                redeliverHttp: (id: string, o: any) => messaging.redeliverHttp(id, o),
            });
        ctx.registerService('auth', {
            api: {
                async getSession(input: { headers: Headers }) {
                    const match = /^Bearer (\w+)@(\w+)$/.exec(input.headers.get('authorization') ?? '');
                    if (!match) return null;
                    return { user: { id: match[1] }, session: { userId: match[1], activeOrganizationId: match[2] } };
                },
            },
        });
    }
}

const liveKernels: LiteKernel[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (liveKernels.length) {
        const kernel = liveKernels.pop();
        await Promise.race([kernel?.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
});

/**
 * One kernel. `selfHosted` gives it the real Hono server (and so a raw app the
 * plugin mounts its route on); without it the kernel has no `http.server`, the
 * hosted shape. `webhooks: false` composes no plugin-webhooks at all;
 * `guardable: false` composes it over a messaging service it cannot install its
 * veto on, so its own boot leaves the slot empty.
 */
async function bootKernel(opts: { selfHosted: boolean; webhooks?: boolean; guardable?: boolean }) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as any);
    liveKernels.push(kernel);
    const fixture = new FixturePlugin(opts.guardable !== false);
    if (opts.selfHosted) kernel.use(new HonoServerPlugin({ port: 0 }));
    kernel.use(fixture);
    if (opts.webhooks !== false) kernel.use(new WebhookOutboxPlugin());
    await kernel.bootstrap();

    /** A delivery attempted once and dead-lettered: a row redeliver may replay. */
    const attempted = async (organizationId: string, refId = SUBSCRIPTION): Promise<string> => {
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
    /** A delivery still waiting for its first attempt: not finished, so not replayable. */
    const pending = (organizationId: string) => fixture.outbox.enqueue({
        source: 'webhook', refId: SUBSCRIPTION, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
        payload: { event: 'record.created' }, organizationId,
    });
    /** A parked record of a delivery that could never be prepared: never sent. */
    const parked = (organizationId: string) => fixture.messaging.enqueueHttp({
        source: 'webhook', refId: SUBSCRIPTION, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
        payload: { event: 'record.created' }, organizationId, undeliverableReason: 'secret unresolvable',
    });
    const statusOf = async (id: string) => (await fixture.outbox.list()).find((row) => row.id === id)?.status;
    const slot = (): IWebhookService | undefined => {
        try { return kernel.getService<IWebhookService>('webhooks') ?? undefined; } catch { return undefined; }
    };
    return { kernel, attempted, pending, parked, statusOf, slot };
}

/** The self-hosted door: the plugin's own raw-app mount, over a real socket. */
async function selfHostedDoor() {
    const booted = await bootKernel({ selfHosted: true });
    const server = booted.kernel.getService<IHttpServer>('http.server');
    const base = `http://127.0.0.1:${server.getPort!()}`;
    return { ...booted, server, send: (init: RequestInit, path = PATH) => fetch(`${base}${path}`, init) };
}

/** The hosted door: `createHonoApp` over a kernel with no `http.server`. */
async function hostedDoor(opts: { webhooks?: boolean; guardable?: boolean } = {}) {
    const booted = await bootKernel({ selfHosted: false, ...opts });
    let server: unknown;
    try { server = booted.kernel.getService<unknown>('http.server'); } catch { server = undefined; }
    expect(server, 'the hosted shape owns no socket').toBeUndefined();
    const app = createHonoApp({ kernel: booted.kernel as any, prefix: PREFIX });
    return { ...booted, send: (init: RequestInit, path = PATH) => app.request(`http://tenant.example${path}`, init) };
}

/** A redeliver `POST`. `auth` is `user@org`; a string body is sent as it is. */
const redeliver = (body: unknown, auth: string | null = `u_1@${ORG_A}`): RequestInit => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

describe('[#22755] the hosted door reaches the real webhooks member through createHonoApp', () => {
    it('an authenticated POST replays a finished delivery — the JSON body crossed the catch-all unread', async () => {
        const door = await hostedDoor();
        const id = await door.attempted(ORG_A);
        expect(await door.statusOf(id)).toBe('dead');

        const answer = await snapshot(await door.send(redeliver({ deliveryId: id })));
        expect(answer.status).toBe(200);
        expect(answer.headers).toContainEqual(['content-type', 'application/json']);
        expect(JSON.parse(answer.body)).toEqual({ success: true, data: { id, status: 'pending' } });
        expect(await door.statusOf(id), 'the replay landed in the outbox').toBe('pending');
    }, 60_000);
});

describe('[#22755] every refusal — anonymous first — is the self-hosted mount\'s, at the hosted door', () => {
    it('status, code, headers and body bytes equal at both doors (the row id masked)', async () => {
        const selfHosted = await selfHostedDoor();
        const hosted = await hostedDoor();

        /** Each refusal, built per door against that door's own outbox. */
        type Case = [label: string, status: number, code: string, make: (d: typeof hosted | typeof selfHosted) => Promise<[RequestInit, string]>];
        const cases: Case[] = [
            ['anonymous', 401, 'UNAUTHENTICATED', async (d) => [redeliver({ deliveryId: await d.attempted(ORG_A) }, null), '']],
            ['not JSON', 400, 'INVALID_REQUEST', async () => [redeliver('{deliveryId:'), '']],
            ['empty body', 400, 'INVALID_REQUEST', async () => [redeliver(''), '']],
            ['no deliveryId', 400, 'MISSING_REQUIRED_FIELD', async () => [redeliver({}), '']],
            ['blank deliveryId', 400, 'MISSING_REQUIRED_FIELD', async () => [redeliver({ deliveryId: '   ' }), '']],
            ['unknown delivery', 404, 'RESOURCE_NOT_FOUND', async () => [redeliver({ deliveryId: 'no_such_row' }), '']],
            ['another organization\'s delivery', 404, 'RESOURCE_NOT_FOUND', async (d) => {
                const id = await d.attempted(ORG_B);
                return [redeliver({ deliveryId: id }), id];
            }],
            ['not yet finished', 409, 'DELIVERY_NOT_ELIGIBLE', async (d) => {
                const id = await d.pending(ORG_A);
                return [redeliver({ deliveryId: id }), id];
            }],
            ['parked, never sent', 409, 'DELIVERY_NEVER_SENT', async (d) => {
                const id = await d.parked(ORG_A);
                return [redeliver({ deliveryId: id }), id];
            }],
            ['subscription gone (the veto)', 409, 'DELIVERY_NOT_ELIGIBLE', async (d) => {
                const id = await d.attempted(ORG_A, GONE_SUBSCRIPTION);
                return [redeliver({ deliveryId: id }), id];
            }],
        ];

        for (const [label, status, code, make] of cases) {
            const [sInit, sId] = await make(selfHosted);
            const [hInit, hId] = await make(hosted);
            const viaMount = await snapshot(await selfHosted.send(sInit));
            const viaDomain = await snapshot(await hosted.send(hInit));
            const mask = (s: { status: number; headers: [string, string][]; body: string }, id: string) =>
                ({ ...s, body: id ? s.body.split(id).join('ID') : s.body });

            expect(viaMount.status, label).toBe(status);
            expect(JSON.parse(viaMount.body), label).toMatchObject({ success: false, error: { code } });
            expect(mask(viaDomain, hId), label).toEqual(mask(viaMount, sId));
        }
    }, 60_000);
});

describe('[#22755] method — exact POST, and the member never runs for anything else', () => {
    it('the hosted door answers 404 ROUTE_NOT_FOUND for every non-POST, without asking the member', async () => {
        const selfHosted = await selfHostedDoor();
        const hosted = await hostedDoor();
        const member = vi.spyOn(hosted.slot()!, 'handleRedeliver');
        const id = await hosted.attempted(ORG_A);

        for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
            const init: RequestInit = method === 'GET' || method === 'HEAD'
                ? { method, headers: { Authorization: `Bearer u_1@${ORG_A}` } }
                : { ...redeliver({ deliveryId: id }), method };
            const viaDomain = await hosted.send(init);
            const viaMount = await selfHosted.send(init);
            expect(viaDomain.status, method).toBe(404);
            expect(viaMount.status, method).toBe(404);
            if (method !== 'HEAD') {
                expect(JSON.parse(await viaDomain.text()).error?.code, method).toBe('ROUTE_NOT_FOUND');
                // Measured beside it: the self-hosted door's own miss is
                // plugin-hono-server's, with its own code. Both are 404.
                expect(JSON.parse(await viaMount.text()).error?.code, method).toBe('ENDPOINT_NOT_FOUND');
            }
        }
        expect(member).not.toHaveBeenCalled();
        expect(await hosted.statusOf(id), 'nothing was replayed').toBe('dead');
    }, 60_000);
});

describe('[#22755] absence across the segment boundary is a typed 501, never ROUTE_NOT_FOUND', () => {
    const notImplemented = async (res: Response) => {
        expect(res.status).toBe(501);
        return JSON.parse(await res.text()) as { error?: { code?: string; message?: string } };
    };

    it('the real service with its handleRedeliver member removed: 501 NOT_IMPLEMENTED, and nothing replayed', async () => {
        const door = await hostedDoor();
        const id = await door.attempted(ORG_A);
        (door.slot() as any).handleRedeliver = undefined;

        const body = await notImplemented(await door.send(redeliver({ deliveryId: id })));
        expect(body.error?.code).toBe('NOT_IMPLEMENTED');
        expect(body.error?.message).toContain('does not implement handleRedeliver');
        expect(await door.statusOf(id)).toBe('dead');
    }, 60_000);

    it('the plugin composed over a messaging service that cannot take the veto: its boot leaves the slot empty — 501', async () => {
        const door = await hostedDoor({ guardable: false });
        expect(door.slot(), 'the plugin registers no slot without its veto').toBeUndefined();
        const body = await notImplemented(await door.send(redeliver({ deliveryId: 'del_1' })));
        expect(body.error?.code).toBe('NOT_IMPLEMENTED');
        expect(body.error?.message).toContain('no webhooks service is registered');
    }, 60_000);

    it('no plugin-webhooks on the kernel: 501 NOT_IMPLEMENTED, and the miss is not a route miss', async () => {
        const door = await hostedDoor({ webhooks: false });
        const body = await notImplemented(await door.send(redeliver({ deliveryId: 'del_1' })));
        expect(body.error?.code).toBe('NOT_IMPLEMENTED');

        // Control, same door: a path no domain claims IS the route miss.
        const miss = await door.send(redeliver({ deliveryId: 'del_1' }), `${PREFIX}/webhooks/redeliverx`);
        expect(miss.status).toBe(404);
        expect((JSON.parse(await miss.text()) as { error?: { code?: string } }).error?.code).toBe('ROUTE_NOT_FOUND');
    }, 60_000);
});

describe('[#22755] CONTROL — the kernel with http.server keeps its one mount', () => {
    it('the route is mounted once, on the raw app, and the mount answers — no dispatcher envelope in its bytes', async () => {
        const door = await selfHostedDoor();
        const rawApp = (door.server as any).getRawApp();
        const mounted = rawApp.routes.filter((r: { path: string }) => r.path === PATH).map((r: { method: string }) => r.method);
        expect(mounted).toEqual(['POST']);

        // The bytes the mount answered before this change existed, measured on
        // the base commit through this same door: the member's own envelope,
        // with none of the dispatcher's `httpStatus` / `route` / `hint` keys.
        const anonymous = await snapshot(await door.send(redeliver({ deliveryId: 'del_1' }, null)));
        expect(anonymous.status).toBe(401);
        expect(anonymous.body).toBe('{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Sign in to redeliver webhook deliveries."}}');
        const unknown = await snapshot(await door.send(redeliver({ deliveryId: 'no_such_row' })));
        expect(unknown.status).toBe(404);
        expect(unknown.body).toBe('{"success":false,"error":{"code":"RESOURCE_NOT_FOUND","message":"Delivery row \'no_such_row\' not found"}}');
    }, 60_000);
});
