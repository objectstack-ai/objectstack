// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22774] `ITriggerApiService.handleInboundHook`: the inbound-hook door
 * (`POST /api/v1/automation/hooks/:flowName/:hookId`) served from a
 * web-standard `Request`, through the kernel's `trigger-api` slot, for a
 * kernel with no raw app.
 *
 * Driven on a real `LiteKernel`, with the plugin's REAL boot: its
 * `kernel:ready` hook registers the `api` trigger with the automation
 * registry, registers the `trigger-api` slot beside it, and mounts the
 * self-hosted route on a real Hono app when `http.server` (or its alias)
 * offers one. Every answer below is the trigger's own (`ApiTrigger`'s hook
 * match, secret read and verifier), not a fixture's.
 *
 * What this pins:
 *  1. the member, read off the started slot on a kernel with no HTTP server
 *     (the hosted shape), answers every arm of the contract, each with its
 *     `code` and `status`, in both signature forms, and enqueues nothing for
 *     a post that does not verify;
 *  2. parity: for the same request the member answers what the self-hosted
 *     mount answers on `http.server`, status, headers and body bytes;
 *  3. the composition: the route is mounted once where a raw app exists, read
 *     from `http.server` before the `http-server` alias; the slot is
 *     registered wherever the trigger is installed, and nowhere else;
 *  4. the member takes its path parameters from `hook`, never from the URL,
 *     and reads the body bytes the sender signed, never a re-serialised copy.
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { ITriggerApiService } from '@objectstack/spec/contracts';
import type { ApiTrigger, FlowTrigger } from './api-trigger.js';
import { ApiTriggerPlugin, HOOKS_PATH } from './plugin.js';

const ORIGIN = 'http://hooks.test';
const NOW = 1760000000;
const FLOW = 'lead_intake';
const HOOK_ID = 'hk_22774';
const SECRET = 'pin-member-secret-7c31';
const UNREADABLE = 'unreadable_secret';
/** Every publish answers this id, so a `202` is the same bytes through both faces. */
const MESSAGE_ID = 'msg_parity';
const BODY = JSON.stringify({ event: 'invoice.paid', id: 'evt_22774' });

const sigBodyOnly = (secret: string, body: string): string =>
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
const sigV1 = (secret: string, body: string, t: number): string =>
    `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');

type ServerShape = 'none' | 'canonical' | 'alias' | 'both' | 'split';

interface BootOptions {
    server?: ServerShape;
    /** `false` registers no automation service: the trigger is never installed. */
    automation?: boolean;
    /** `'absent'` registers no queue service; `'throws'` registers one whose publish throws. */
    queue?: 'ok' | 'absent' | 'throws';
}

interface Published {
    queue: string;
    data: unknown;
    idempotencyKey?: string;
}

/**
 * Stands in for the plugin's declared dependency
 * (`dependencies = ['com.objectstack.service.queue']`) and registers the
 * collaborators it resolves at `kernel:ready`: the automation trigger
 * registry, the queue, and the host's server under the names the shape asks.
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.queue';
    type = 'standard' as const;
    version = '1.0.0';
    readonly triggers: FlowTrigger[] = [];
    readonly published: Published[] = [];
    readonly canonicalApp = new Hono();
    readonly aliasApp = new Hono();

    constructor(private readonly options: BootOptions) {}

    init(ctx: PluginContext): void {
        if (this.options.automation !== false) {
            ctx.registerService('automation', { registerTrigger: (t: FlowTrigger) => { this.triggers.push(t); } });
        }
        const queueMode = this.options.queue ?? 'ok';
        if (queueMode !== 'absent') {
            const published = this.published;
            ctx.registerService('queue', {
                async publish(queue: string, data: unknown, options?: { idempotencyKey?: string }) {
                    if (queueMode === 'throws') throw new Error('broker offline');
                    published.push({ queue, data, idempotencyKey: options?.idempotencyKey });
                    return MESSAGE_ID;
                },
                async subscribe() { /* the consumer is not under test here */ },
                async unsubscribe() { /* nothing subscribed */ },
            });
        }
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
class ObservedApiTriggerPlugin extends ApiTriggerPlugin {
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

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
});

afterEach(async () => {
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function boot(options: BootOptions = {}) {
    const fixture = new FixturePlugin(options);
    const plugin = new ObservedApiTriggerPlugin();
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    openKernels.push(kernel);
    kernel.use(fixture);
    kernel.use(plugin);
    await kernel.bootstrap();

    // Arm the flows through the trigger the plugin registered, as the engine
    // binds them: one with a literal secret, one whose secret cannot be read.
    const trigger = fixture.triggers[0] as ApiTrigger | undefined;
    if (trigger) {
        trigger.start({ flowName: FLOW, config: { hookId: HOOK_ID, secret: SECRET } }, async () => {});
        trigger.start(
            { flowName: UNREADABLE, config: {}, resolveSecret: async () => { throw new Error('credential store offline'); } },
            async () => {},
        );
    }

    const slot = (): ITriggerApiService | undefined => {
        try { return kernel.getService<ITriggerApiService>('trigger-api'); } catch { return undefined; }
    };
    const member = (request: Request, hook: { flowName: string; hookId: string }): Promise<Response> => {
        const svc = slot();
        if (typeof svc?.handleInboundHook !== 'function') throw new Error('the trigger-api slot holds no handleInboundHook');
        return svc.handleInboundHook(request, hook);
    };
    const mounted = (app: Hono) => app.routes.filter((r) => r.path === HOOKS_PATH).map((r) => r.method);

    return { kernel, fixture, plugin, trigger, slot, member, mounted };
}

/** An inbound-hook `POST` to `flowName`/`hookId`, the body sent as the bytes given. */
const hookRequest = (
    flowName: string,
    hookId: string,
    body: string,
    headers: Record<string, string> = {},
): Request =>
    new Request(`${ORIGIN}/api/v1/automation/hooks/${encodeURIComponent(flowName)}/${encodeURIComponent(hookId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
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

/** A body whose bytes are not what `JSON.stringify` of its value produces: spacing and key order. */
const HAND_WRITTEN_BODY = '{ "id" : "evt_hand",\n  "event": "invoice.paid" }';

/**
 * One row per arm of the contract: where the post goes, what it carries, and
 * the answer the contract declares. `published` is whether it may enqueue.
 */
interface Row {
    label: string;
    flowName: string;
    hookId: string;
    body: string;
    headers: Record<string, string>;
    status: number;
    code: string | null;
    published: boolean;
}

const sig = (body: string) => ({ 'x-objectstack-signature': sigV1(SECRET, body, NOW) });

const ROWS: Row[] = [
    // One refusal for every post that does not verify.
    { label: 'an unknown flow, unsigned', flowName: 'never_armed', hookId: HOOK_ID, body: BODY, headers: {}, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'an unknown flow, signed with an armed flow\'s secret', flowName: 'never_armed', hookId: HOOK_ID, body: BODY, headers: sig(BODY), status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'the wrong hook id, correctly signed', flowName: FLOW, hookId: 'default', body: BODY, headers: sig(BODY), status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'an armed flow, unsigned', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: {}, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'a malformed signature', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { 'x-objectstack-signature': 'not-a-signature-value' }, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'a body-only signature under another secret', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { 'x-objectstack-signature': sigBodyOnly('not-the-secret', BODY) }, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'a timestamped signature under another secret', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { 'x-objectstack-signature': sigV1('not-the-secret', BODY, NOW) }, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'the right secret, a timestamp outside the window', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { 'x-objectstack-signature': sigV1(SECRET, BODY, NOW - 3600) }, status: 401, code: 'INVALID_SIGNATURE', published: false },
    { label: 'unsigned, from a signed-in caller', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { Authorization: 'Bearer tok_admin', Cookie: 'better-auth.session_token=tok.sig' }, status: 401, code: 'INVALID_SIGNATURE', published: false },
    // The residual: an armed hook whose secret cannot be read.
    { label: 'an unreadable secret, unsigned', flowName: UNREADABLE, hookId: 'default', body: BODY, headers: {}, status: 503, code: 'SERVICE_UNAVAILABLE', published: false },
    { label: 'an unreadable secret, signed', flowName: UNREADABLE, hookId: 'default', body: BODY, headers: { 'x-objectstack-signature': sigBodyOnly('anything', BODY) }, status: 503, code: 'SERVICE_UNAVAILABLE', published: false },
    // Only then is the body read as JSON.
    { label: 'a verified body that is not JSON', flowName: FLOW, hookId: HOOK_ID, body: '{not json', headers: sig('{not json'), status: 400, code: 'INVALID_REQUEST', published: false },
    { label: 'a verified body that is a JSON array', flowName: FLOW, hookId: HOOK_ID, body: '[1,2]', headers: sig('[1,2]'), status: 400, code: 'INVALID_REQUEST', published: false },
    // Accepted: both signature forms, the empty body, and bytes as the sender wrote them.
    { label: 'a timestamped signature', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: sig(BODY), status: 202, code: null, published: true },
    { label: 'a body-only signature (deprecated, still accepted)', flowName: FLOW, hookId: HOOK_ID, body: BODY, headers: { 'x-objectstack-signature': sigBodyOnly(SECRET, BODY) }, status: 202, code: null, published: true },
    { label: 'an empty body, signed', flowName: FLOW, hookId: HOOK_ID, body: '', headers: sig(''), status: 202, code: null, published: true },
    { label: 'a hand-written body, signed over its own bytes', flowName: FLOW, hookId: HOOK_ID, body: HAND_WRITTEN_BODY, headers: sig(HAND_WRITTEN_BODY), status: 202, code: null, published: true },
];

describe('[#22774] handleInboundHook — the inbound-hook door from a Request, on a kernel with no HTTP server', () => {
    it('the started kernel holds the member in its trigger-api slot, and mounts nothing', async () => {
        const { slot, plugin, fixture, mounted } = await boot();
        expect(typeof slot()?.handleInboundHook).toBe('function');
        expect(mounted(fixture.canonicalApp)).toEqual([]);
        expect(plugin.lines('info', 'hooks mounted')).toEqual([]);
        expect(plugin.lines('warn', 'hooks endpoint not mounted')).toHaveLength(1);
    });

    it('answers every arm the contract declares, each with its code and its status, and enqueues only what verified', async () => {
        const { member, fixture } = await boot();
        for (const row of ROWS) {
            const before = fixture.published.length;
            const answer = await snapshot(await member(
                hookRequest(row.flowName, row.hookId, row.body, row.headers),
                { flowName: row.flowName, hookId: row.hookId },
            ));
            expect(answer.status, row.label).toBe(row.status);
            expect(answer.headers, row.label).toEqual(JSON_HEADERS);
            const body = json(answer);
            if (row.code) {
                expect(body, row.label).toMatchObject({ success: false, error: { code: row.code } });
                expect(typeof body.error.message, row.label).toBe('string');
            } else {
                expect(body, row.label).toEqual({ accepted: true, messageId: MESSAGE_ID });
            }
            expect(fixture.published.length - before, `${row.label}: enqueued`).toBe(row.published ? 1 : 0);
        }
    });

    it('enqueues the payload on the flow\'s queue, passing x-idempotency-key through', async () => {
        const { member, fixture } = await boot();
        const res = await member(
            hookRequest(FLOW, HOOK_ID, BODY, { ...sig(BODY), 'x-idempotency-key': 'idem-22774' }),
            { flowName: FLOW, hookId: HOOK_ID },
        );
        expect(res.status).toBe(202);
        expect(fixture.published).toEqual([
            { queue: `flow-api:${FLOW}`, data: { payload: JSON.parse(BODY) }, idempotencyKey: 'idem-22774' },
        ]);
    });

    it('answers 503 SERVICE_UNAVAILABLE with no queue service, and 503 ENQUEUE_FAILED when the publish throws', async () => {
        for (const [queue, code] of [['absent', 'SERVICE_UNAVAILABLE'], ['throws', 'ENQUEUE_FAILED']] as const) {
            const { member } = await boot({ queue });
            const answer = await snapshot(await member(hookRequest(FLOW, HOOK_ID, BODY, sig(BODY)), { flowName: FLOW, hookId: HOOK_ID }));
            expect(answer.status, queue).toBe(503);
            expect(json(answer), queue).toMatchObject({ success: false, error: { code } });
        }
    });

    it('takes the flow and the hook id from `hook`, never from the request URL', async () => {
        const { member, fixture } = await boot();
        // The URL names another flow and hook id, under the environment scope
        // a dispatcher strips; the route the caller matched is the authority.
        const request = new Request(`${ORIGIN}/api/v1/environments/env_1/automation/hooks/other_flow/zzz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...sig(BODY) },
            body: BODY,
        });
        const res = await member(request, { flowName: FLOW, hookId: HOOK_ID });
        expect(res.status).toBe(202);
        expect(fixture.published.map((p) => p.queue)).toEqual([`flow-api:${FLOW}`]);
    });
});

describe('[#22774] parity — the member answers what the self-hosted mount answers on http.server', () => {
    it('every arm: status, headers and body bytes equal, through the member and the mount', async () => {
        const { fixture, member } = await boot({ server: 'canonical' });
        for (const row of ROWS) {
            const make = () => hookRequest(row.flowName, row.hookId, row.body, row.headers);
            const viaMember = await snapshot(await member(make(), { flowName: row.flowName, hookId: row.hookId }));
            const viaMount = await snapshot(await fixture.canonicalApp.fetch(make()));
            expect(viaMount.status, `${row.label}: the mount's own answer`).toBe(row.status);
            expect(viaMember, row.label).toEqual(viaMount);
        }
        // Every accepted row enqueued once per face, and nothing else did.
        expect(fixture.published).toHaveLength(2 * ROWS.filter((r) => r.published).length);
    });

    it('the queue faults: the same status, headers and bytes through both faces', async () => {
        for (const queue of ['absent', 'throws'] as const) {
            const { fixture, member } = await boot({ server: 'canonical', queue });
            const make = () => hookRequest(FLOW, HOOK_ID, BODY, sig(BODY));
            const viaMember = await snapshot(await member(make(), { flowName: FLOW, hookId: HOOK_ID }));
            const viaMount = await snapshot(await fixture.canonicalApp.fetch(make()));
            expect(viaMount.status, queue).toBe(503);
            expect(viaMember, queue).toEqual(viaMount);
        }
    });
});

describe('[#22774] the composition — one mount where a raw app exists, read from http.server first', () => {
    it('http.server and its alias on one server (plugin-hono-server\'s shape): mounted once', async () => {
        const { fixture, mounted, slot, plugin } = await boot({ server: 'both' });
        expect(mounted(fixture.canonicalApp)).toEqual(['POST']);
        expect(typeof slot()?.handleInboundHook).toBe('function');
        expect(plugin.lines('info', 'hooks mounted')).toHaveLength(1);
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

    it('no automation service: no trigger installed, so no trigger-api slot and no mount, and the boot says so', async () => {
        const { fixture, mounted, slot, plugin } = await boot({ automation: false, server: 'both' });
        expect(fixture.triggers).toEqual([]);
        expect(slot()).toBeUndefined();
        expect(mounted(fixture.canonicalApp)).toEqual([]);
        expect(plugin.lines('warn', 'trigger-api service not registered')).toHaveLength(1);
    });
});
