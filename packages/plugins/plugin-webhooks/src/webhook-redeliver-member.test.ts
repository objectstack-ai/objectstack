// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22756] `IWebhookService.handleRedeliver`: the webhook redeliver door
 * (`POST /api/v1/webhooks/redeliver`) served from a web-standard `Request`,
 * through the kernel's `webhooks` slot, for a kernel with no raw app.
 *
 * Driven on a real `LiteKernel`, with the plugin's REAL boot: its
 * `kernel:ready` hook installs the #8069 veto, registers the `webhooks` slot
 * and mounts the self-hosted route on a real Hono app when `http.server`
 * offers one. The messaging service is the real `MessagingService` over the
 * real `MemoryHttpOutbox`, so every refusal below is the outbox's own (the
 * tenant scope, the row-local refusals and the veto), not a fixture's.
 *
 * What this pins:
 *  1. the member, read off the started `webhooks` slot on a kernel with no
 *     `http.server` (the hosted shape), answers every arm of the contract:
 *     401 / 400 / 400 / 404 / 409 ×2 / 500 / 200, each with `code` + `status`;
 *  2. parity: for the same request the member answers what the mount answers,
 *     status, headers and body bytes;
 *  3. the composition: the route is mounted once where a raw app exists, read
 *     from `http.server` before the `http-server` alias, and never where none
 *     does; the slot is registered everywhere the veto is, and nowhere else;
 *  4. the veto no longer needs realtime or auto-enqueue: a redelivery of a
 *     delivery whose subscription is gone is refused by both faces;
 *  5. [#22804] a delivery whose subscription is inactive is refused by both
 *     faces, `409 DELIVERY_NOT_ELIGIBLE` with a reason naming the state and the
 *     remedy, beside its controls: active and signed replays, gone keeps its
 *     own refusal, and the same delivery replays once re-activated.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IWebhookService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { MemoryHttpOutbox, MessagingService } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin, type WebhookOutboxPluginOptions } from './webhook-outbox-plugin.js';
import { webhookAdministrationSecurity } from './redeliver-entitlement.testkit.js';

const PATH = '/api/v1/webhooks/redeliver';
const ORIGIN = 'http://webhooks.test';
const SUBSCRIPTION = 'wh_live';
const GONE_SUBSCRIPTION = 'wh_gone';
/** [#22804] A subscription an operator switched off: `active: false`. */
const INACTIVE_SUBSCRIPTION = 'wh_off';
/** [#22804] An active subscription that stores a signing secret which resolves. */
const SIGNED_SUBSCRIPTION = 'wh_signed';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

/** The slice of ObjectQL the plugin's boot and the veto's lookup touch. */
function fakeEngine(subscriptions: Map<string, Record<string, unknown>>) {
    return {
        registry: { listItems: () => [], getObject: () => undefined },
        async find() { return []; },
        async findOne(object: string, opts?: any) {
            assertEngineFindOnePredicate(object, opts);
            return subscriptions.get(opts?.where?.id) ?? null;
        },
        registerHook() { /* provenance stamp + headers gate + cleartext gate */ },
        unregisterHooksByPackage() { return 0; },
        /** [#22804] The privileged dereference: only the signed subscription's key resolves. */
        async resolveSecretField(_object: string, id: string) {
            return id === SIGNED_SUBSCRIPTION ? 'whsec_live' : null;
        },
    };
}

/** Realtime that records nothing; present only where a case asks for it. */
const fakeRealtime = () => ({
    async subscribe() { return `sub_${randomUUID()}`; },
    async unsubscribe() {},
    async publish() {},
});

type ServerShape = 'none' | 'canonical' | 'alias' | 'both' | 'split';

interface BootOptions {
    server?: ServerShape;
    realtime?: boolean;
    outbox?: boolean;
    /** `false` hands the plugin a messaging surface with no `registerRedeliverGuard`. */
    guardable?: boolean;
    plugin?: WebhookOutboxPluginOptions;
}

/**
 * Stands in for the plugin's declared dependency
 * (`dependencies = ['com.objectstack.service.messaging']`) and registers the
 * collaborators it resolves: the real messaging service over a real outbox,
 * an engine holding the subscriptions, an `auth` service whose sessions are
 * keyed by the request's `Authorization` header, and the host's server.
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly subscriptions = new Map<string, Record<string, unknown>>([
        [SUBSCRIPTION, { id: SUBSCRIPTION, name: 'orders_hook', active: true }],
        [INACTIVE_SUBSCRIPTION, { id: INACTIVE_SUBSCRIPTION, name: 'paused_hook', active: false }],
        [SIGNED_SUBSCRIPTION, {
            id: SIGNED_SUBSCRIPTION, name: 'signed_hook', active: true, signing_secret: 'secret:sec_22804',
        }],
    ]);
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: silentLogger });
    readonly sessionReads: any[] = [];
    readonly canonicalApp = new Hono();
    readonly aliasApp = new Hono();

    constructor(private readonly options: BootOptions) {
        if (options.outbox !== false) this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', fakeEngine(this.subscriptions));
        if (this.options.realtime) ctx.registerService('realtime', fakeRealtime());
        const messaging = this.messaging;
        ctx.registerService('messaging', this.options.guardable === false
            ? {
                enqueueHttp: (input: any) => messaging.enqueueHttp(input),
                isHttpDeliveryReady: () => messaging.isHttpDeliveryReady(),
                redeliverHttp: (id: string, o: any) => messaging.redeliverHttp(id, o),
            }
            : messaging);
        const reads = this.sessionReads;
        // The entitlement gate: every signed-in caller here administers webhooks.
        ctx.registerService('security', webhookAdministrationSecurity());
        ctx.registerService('auth', {
            api: {
                async getSession(input: { headers: Headers; query?: unknown }) {
                    reads.push(input);
                    const auth = input.headers.get('authorization') ?? '';
                    const match = /^Bearer (\w+)@(\w+)$/.exec(auth);
                    if (!match) return null;
                    return { user: { id: match[1] }, session: { userId: match[1], activeOrganizationId: match[2] } };
                },
            },
        });
        const server = (app: Hono) => ({ getRawApp: () => app });
        const shape = this.options.server ?? 'none';
        if (shape === 'canonical' || shape === 'both' || shape === 'split') {
            ctx.registerService('http.server', server(this.canonicalApp));
        }
        if (shape === 'alias' || shape === 'both') ctx.registerService('http-server', server(this.canonicalApp));
        if (shape === 'split') ctx.registerService('http-server', server(this.aliasApp));
    }
}

/** The real plugin, with what it logs during boot observed. */
class ObservedWebhookPlugin extends WebhookOutboxPlugin {
    readonly logs: Array<{ level: string; message: string }> = [];

    override async init(ctx: PluginContext): Promise<void> {
        for (const level of ['debug', 'info', 'warn', 'error'] as const) {
            vi.spyOn(ctx.logger, level).mockImplementation((message: unknown) => {
                this.logs.push({ level, message: String(message) });
            });
        }
        await super.init(ctx);
    }

    lines(level: string, fragment: string): string[] {
        return this.logs.filter((l) => l.level === level && l.message.includes(fragment)).map((l) => l.message);
    }
}

const openKernels: LiteKernel[] = [];

afterEach(async () => {
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
    vi.restoreAllMocks();
});

async function boot(options: BootOptions = {}) {
    const fixture = new FixturePlugin(options);
    const plugin = new ObservedWebhookPlugin(options.plugin);
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    openKernels.push(kernel);
    kernel.use(fixture);
    kernel.use(plugin);
    await kernel.bootstrap();

    const slot = (): IWebhookService | undefined => {
        try { return kernel.getService<IWebhookService>('webhooks'); } catch { return undefined; }
    };
    const member = (request: Request): Promise<Response> => {
        const svc = slot();
        if (typeof svc?.handleRedeliver !== 'function') throw new Error('the webhooks slot holds no handleRedeliver');
        return svc.handleRedeliver(request);
    };
    const mounted = (app: Hono) => app.routes.filter((r) => r.path === PATH).map((r) => r.method);

    /** A delivery the dispatcher attempted once and dead-lettered: a row redeliver may replay. */
    const attempted = async (organizationId: string | undefined, refId = SUBSCRIPTION): Promise<string> => {
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
    const pending = (organizationId: string | undefined) => fixture.outbox.enqueue({
        source: 'webhook', refId: SUBSCRIPTION, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
        payload: { event: 'record.created' }, organizationId,
    });
    /** A parked record of a delivery that could never be prepared: never sent. */
    const parked = (organizationId: string | undefined) => fixture.messaging.enqueueHttp({
        source: 'webhook', refId: SUBSCRIPTION, dedupKey: randomUUID(), url: 'https://receiver.example/hook',
        payload: { event: 'record.created' }, organizationId, undeliverableReason: 'secret unresolvable',
    });
    const statusOf = async (id: string) => (await fixture.outbox.list()).find((row) => row.id === id)?.status;

    return { kernel, fixture, plugin, slot, member, mounted, attempted, pending, parked, statusOf };
}

/** A redeliver `POST`. `auth` is `user@org`; a string body is sent as it is. */
const redeliver = (body: unknown, auth: string | null = `u_1@${ORG_A}`, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}${PATH}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
            ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

/** Everything a response says, the body as bytes. */
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()],
        body: new Uint8Array(await res.arrayBuffer()),
    };
}
const json = (s: { body: Uint8Array }) => JSON.parse(new TextDecoder().decode(s.body));
const JSON_HEADERS = [['content-type', 'application/json']];

describe('[#22756] handleRedeliver — the redeliver door from a Request, on a kernel with no http.server', () => {
    it('the started kernel holds the member in its webhooks slot, and mounts nothing', async () => {
        const { slot, plugin } = await boot();
        expect(typeof slot()?.handleRedeliver).toBe('function');
        expect(plugin.lines('info', 'redeliver endpoint mounted')).toEqual([]);
    });

    it('answers every refusal the contract declares, each with its code and its status', async () => {
        const { member, attempted, pending, parked, statusOf } = await boot();
        const crossOrg = await attempted(ORG_B);
        const vetoed = await attempted(ORG_A, GONE_SUBSCRIPTION);
        const inactive = await attempted(ORG_A, INACTIVE_SUBSCRIPTION);
        const neverSent = await parked(ORG_A);
        const notFinished = await pending(ORG_A);

        const cases: Array<[string, Request, number, string]> = [
            ['no signed-in user', redeliver({ deliveryId: crossOrg }, null), 401, 'UNAUTHENTICATED'],
            ['a body that is not JSON', redeliver('{deliveryId:'), 400, 'INVALID_REQUEST'],
            ['no deliveryId', redeliver({}), 400, 'MISSING_REQUIRED_FIELD'],
            ['a deliveryId that is not a string', redeliver({ deliveryId: 42 }), 400, 'MISSING_REQUIRED_FIELD'],
            ['a blank deliveryId', redeliver({ deliveryId: '   ' }), 400, 'MISSING_REQUIRED_FIELD'],
            ['an unknown delivery', redeliver({ deliveryId: 'no_such_row' }), 404, 'RESOURCE_NOT_FOUND'],
            ['another organization\'s delivery', redeliver({ deliveryId: crossOrg }), 404, 'RESOURCE_NOT_FOUND'],
            ['a delivery not yet finished', redeliver({ deliveryId: notFinished }), 409, 'DELIVERY_NOT_ELIGIBLE'],
            ['a parked delivery, never sent', redeliver({ deliveryId: neverSent }), 409, 'DELIVERY_NEVER_SENT'],
            ['a delivery whose subscription is gone (the veto)', redeliver({ deliveryId: vetoed }), 409, 'DELIVERY_NOT_ELIGIBLE'],
            ['a delivery whose subscription is inactive (the veto)', redeliver({ deliveryId: inactive }), 409, 'DELIVERY_NOT_ELIGIBLE'],
        ];
        for (const [label, request, status, code] of cases) {
            const answer = await snapshot(await member(request));
            expect(answer.status, label).toBe(status);
            expect(answer.headers, label).toEqual(JSON_HEADERS);
            const body = json(answer);
            expect(body, label).toMatchObject({ success: false, error: { code } });
            expect(typeof body.error.message, label).toBe('string');
        }
        // Every refusal wrote nothing.
        expect(await statusOf(crossOrg)).toBe('dead');
        expect(await statusOf(vetoed)).toBe('dead');
        expect(await statusOf(inactive)).toBe('dead');
        expect(await statusOf(neverSent)).toBe('dead');
        expect(await statusOf(notFinished)).toBe('pending');
    });

    it('replays a finished delivery in the caller\'s organization: 200 with its id and new status', async () => {
        const { member, attempted, statusOf } = await boot();
        const id = await attempted(ORG_A);
        expect(await statusOf(id)).toBe('dead');

        const answer = await snapshot(await member(redeliver({ deliveryId: ` ${id} ` })));
        expect(answer.status).toBe(200);
        expect(answer.headers).toEqual(JSON_HEADERS);
        expect(json(answer)).toEqual({ success: true, data: { id, status: 'pending' } });
        expect(await statusOf(id)).toBe('pending');
    });

    it('answers 500 INTERNAL_ERROR for any other failure — a messaging service with no outbox', async () => {
        const { member } = await boot({ outbox: false });
        const answer = await snapshot(await member(redeliver({ deliveryId: 'del_1' })));
        expect(answer.status).toBe(500);
        expect(json(answer)).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
    });

    it('reads the caller\'s session by the in-process rule: a cookie request reads without renewal', async () => {
        const { member, fixture } = await boot();
        await member(redeliver({ deliveryId: 'no_such_row' }, `u_1@${ORG_A}`, { Cookie: 'better-auth.session_token=tok.sig' }));
        await member(redeliver({ deliveryId: 'no_such_row' }));
        expect(fixture.sessionReads).toHaveLength(2);
        expect(fixture.sessionReads[0].query).toEqual({ disableRefresh: true });
        expect('query' in fixture.sessionReads[1]).toBe(false);
    });
});

describe('[#22756] parity — the member answers what the self-hosted mount answers', () => {
    it('every refusal: status, headers and body bytes equal, through the member and the mount', async () => {
        const { fixture, member, attempted, pending, parked } = await boot({ server: 'both' });
        const app = fixture.canonicalApp;
        const crossOrg = await attempted(ORG_B);
        const vetoed = await attempted(ORG_A, GONE_SUBSCRIPTION);
        const inactive = await attempted(ORG_A, INACTIVE_SUBSCRIPTION);
        const neverSent = await parked(ORG_A);
        const notFinished = await pending(ORG_A);

        const requests: Array<[string, () => Request]> = [
            ['401', () => redeliver({ deliveryId: crossOrg }, null)],
            ['400 not JSON', () => redeliver('{deliveryId:')],
            ['400 empty body', () => redeliver('')],
            ['400 no deliveryId', () => redeliver({})],
            ['400 not a string', () => redeliver({ deliveryId: 42 })],
            ['400 blank', () => redeliver({ deliveryId: '   ' })],
            ['404 unknown', () => redeliver({ deliveryId: 'no_such_row' })],
            ['404 cross-org', () => redeliver({ deliveryId: crossOrg })],
            ['409 not finished', () => redeliver({ deliveryId: notFinished })],
            ['409 never sent', () => redeliver({ deliveryId: neverSent })],
            ['409 veto', () => redeliver({ deliveryId: vetoed })],
            ['409 veto, inactive', () => redeliver({ deliveryId: inactive })],
        ];
        for (const [label, make] of requests) {
            const viaMember = await snapshot(await member(make()));
            const viaMount = await snapshot(await app.fetch(make()));
            expect(viaMount.status, label).toBeGreaterThanOrEqual(400);
            expect(viaMember, label).toEqual(viaMount);
        }
    });

    it('a replay: the same status, headers and bytes but for the row id — twin rows, one per face', async () => {
        const { fixture, member, attempted, statusOf } = await boot({ server: 'both' });
        const viaMemberId = await attempted(ORG_A);
        const viaMountId = await attempted(ORG_A);

        const viaMember = await snapshot(await member(redeliver({ deliveryId: viaMemberId })));
        const viaMount = await snapshot(await fixture.canonicalApp.fetch(redeliver({ deliveryId: viaMountId })));
        expect(viaMount.status).toBe(200);
        expect(viaMember.status).toBe(viaMount.status);
        expect(viaMember.headers).toEqual(viaMount.headers);
        const text = (s: { body: Uint8Array }, id: string) => new TextDecoder().decode(s.body).replace(id, 'ID');
        expect(text(viaMember, viaMemberId)).toBe(text(viaMount, viaMountId));
        expect([await statusOf(viaMemberId), await statusOf(viaMountId)]).toEqual(['pending', 'pending']);
    });
});

describe('[#22756] the composition — one mount where a raw app exists, read from http.server first', () => {
    it('http.server and its alias on one server (plugin-hono-server\'s shape): mounted once', async () => {
        const { fixture, mounted, slot, plugin } = await boot({ server: 'both' });
        expect(mounted(fixture.canonicalApp)).toEqual(['POST']);
        expect(typeof slot()?.handleRedeliver).toBe('function');
        expect(plugin.lines('info', 'redeliver endpoint mounted')).toHaveLength(1);
    });

    it('http.server alone (runtime.ts\'s config.server shape, no alias): mounted once', async () => {
        const { fixture, mounted } = await boot({ server: 'canonical' });
        expect(mounted(fixture.canonicalApp)).toEqual(['POST']);
    });

    it('the alias alone: still mounted once', async () => {
        const { fixture, mounted } = await boot({ server: 'alias' });
        expect(mounted(fixture.canonicalApp)).toEqual(['POST']);
    });

    it('two servers under the two names: the mount goes on http.server\'s, and only there', async () => {
        const { fixture, mounted } = await boot({ server: 'split' });
        expect(mounted(fixture.canonicalApp)).toEqual(['POST']);
        expect(mounted(fixture.aliasApp)).toEqual([]);
    });
});

describe('[#22756] the veto is installed without realtime or auto-enqueue, and the slot only beside it', () => {
    for (const [label, options] of [
        ['no realtime', {}],
        ['realtime present, autoEnqueue: false', { realtime: true, plugin: { autoEnqueue: false } }],
    ] as Array<[string, BootOptions]>) {
        it(`${label}: a delivery whose subscription is gone is refused by both faces`, async () => {
            const { fixture, member, attempted, statusOf } = await boot({ ...options, server: 'both' });
            const vetoed = await attempted(ORG_A, GONE_SUBSCRIPTION);
            // Control: the same kernel replays a delivery whose subscription stands.
            const replayable = await attempted(ORG_A);

            for (const face of [member, (r: Request) => fixture.canonicalApp.fetch(r)]) {
                const answer = await snapshot(await face(redeliver({ deliveryId: vetoed })));
                expect(answer.status).toBe(409);
                expect(json(answer).error.code).toBe('DELIVERY_NOT_ELIGIBLE');
                expect(json(answer).error.message).toContain(GONE_SUBSCRIPTION);
            }
            expect(await statusOf(vetoed)).toBe('dead');
            expect((await member(redeliver({ deliveryId: replayable }))).status).toBe(200);
        });
    }

    it('a messaging service that cannot take the veto: no webhooks slot, and the absence is logged at error', async () => {
        const { slot, plugin } = await boot({ guardable: false });
        expect(slot()).toBeUndefined();
        expect(plugin.lines('error', 'exposes no registerRedeliverGuard')).toHaveLength(1);
    });
});

/**
 * [#22804] The veto refuses a delivery whose subscription is inactive.
 *
 * `active: false` is the operator's off switch for an endpoint, and the field
 * declares that an inactive webhook is skipped by the dispatcher; an explicit
 * replay is the dispatcher too. The refusal is the gone case's: `409
 * DELIVERY_NOT_ELIGIBLE`, the row untouched, and a reason an operator can act
 * on — it names the webhook, says it is inactive, and names the remedy.
 * Each control below is what a refuse-everything veto would fail.
 */
describe('[#22804] the veto refuses a delivery whose subscription is inactive, at the door', () => {
    const faces = (fixture: FixturePlugin, member: (r: Request) => Promise<Response>) => [
        ['member', member],
        ['mount', (r: Request) => fixture.canonicalApp.fetch(r)],
    ] as const;

    it('inactive: 409 DELIVERY_NOT_ELIGIBLE naming the webhook, its state and the remedy, on both faces', async () => {
        const { fixture, member, attempted, statusOf } = await boot({ server: 'both' });
        const inactive = await attempted(ORG_A, INACTIVE_SUBSCRIPTION);

        for (const [face, send] of faces(fixture, member)) {
            const answer = await snapshot(await send(redeliver({ deliveryId: inactive })));
            expect(answer.status, face).toBe(409);
            const body = json(answer);
            expect(body, face).toMatchObject({ success: false, error: { code: 'DELIVERY_NOT_ELIGIBLE' } });
            expect(body.error.message, face).toContain("webhook 'paused_hook'");
            expect(body.error.message, face).toMatch(/\binactive\b/);
            expect(body.error.message, face).toMatch(/re-activate the webhook, then redeliver/);
        }
        expect(await statusOf(inactive)).toBe('dead');
    });

    it('control: an active, signed subscription is replayed by both faces', async () => {
        const { fixture, member, attempted, statusOf } = await boot({ server: 'both' });
        for (const [face, send] of faces(fixture, member)) {
            const id = await attempted(ORG_A, SIGNED_SUBSCRIPTION);
            const answer = await snapshot(await send(redeliver({ deliveryId: id })));
            expect(answer.status, face).toBe(200);
            expect(json(answer), face).toEqual({ success: true, data: { id, status: 'pending' } });
            expect(await statusOf(id), face).toBe('pending');
        }
    });

    it('control: a gone subscription keeps its own refusal, unchanged', async () => {
        const { fixture, member, attempted, statusOf } = await boot({ server: 'both' });
        const gone = await attempted(ORG_A, GONE_SUBSCRIPTION);
        for (const [face, send] of faces(fixture, member)) {
            const answer = await snapshot(await send(redeliver({ deliveryId: gone })));
            expect(answer.status, face).toBe(409);
            const body = json(answer);
            expect(body.error.code, face).toBe('DELIVERY_NOT_ELIGIBLE');
            expect(body.error.message, face).toContain(GONE_SUBSCRIPTION);
            expect(body.error.message, face).toContain('no longer exists');
            expect(body.error.message, face).not.toMatch(/\binactive\b/);
        }
        expect(await statusOf(gone)).toBe('dead');
    });

    it('control: the same delivery is replayed once its webhook is re-activated', async () => {
        const { fixture, member, attempted, statusOf } = await boot({ server: 'both' });
        const id = await attempted(ORG_A, INACTIVE_SUBSCRIPTION);
        expect((await member(redeliver({ deliveryId: id }))).status).toBe(409);
        expect(await statusOf(id)).toBe('dead');

        fixture.subscriptions.get(INACTIVE_SUBSCRIPTION)!.active = true;

        const answer = await snapshot(await member(redeliver({ deliveryId: id })));
        expect(answer.status).toBe(200);
        expect(json(answer)).toEqual({ success: true, data: { id, status: 'pending' } });
        expect(await statusOf(id)).toBe('pending');
    });
});
