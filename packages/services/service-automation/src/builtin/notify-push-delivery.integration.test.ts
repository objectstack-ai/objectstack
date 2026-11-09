// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29041] A `notify` flow node naming the `push` channel delivers a push to
 * the devices the recipient registered, through mock APNs and FCM endpoints,
 * and a token the vendor reports dead is retired.
 *
 * Before #29041 the same flow succeeded with `acted: 0`: no `push` channel was
 * registered, so fan-out refused the delivery and no request left the box.
 *
 * Wired through the REAL stack below the node: `MessagingService` (inline
 * fan-out) with its device registry, the `push` channel from
 * service-messaging, and `PushService` from service-push with its real APNs
 * (HTTP/2, ES256 provider token) and FCM (HTTP v1, OAuth service account)
 * transports, pointed at local servers. Credentials reach the transports only
 * through `credentialRef`, resolved by the resolver the test hands in.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import http2 from 'node:http2';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { MessagingService, createInboxChannel, createPushChannel } from '@objectstack/service-messaging';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { ApnsPushTransport, FcmPushTransport, PushService } from '@objectstack/service-push';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A data engine over in-memory tables: equality `where` on plain fields, which is all this path reads. */
function memoryEngine() {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$') || (typeof v === 'object' && v !== null)) {
                throw new Error(`this double matches equality on plain fields only: ${JSON.stringify(where)}`);
            }
            return row[k] === v;
        });
    let seq = 0;
    return {
        tables,
        async insert(object: string, row: Record<string, unknown>) {
            const stored = { ...row, id: row.id != null ? String(row.id) : `row_${++seq}` };
            (tables[object] ??= []).push(stored);
            return { ...stored };
        },
        async find(object: string, q: { where?: Record<string, unknown>; limit?: number } = {}) {
            const rows = (tables[object] ?? []).filter((r) => matches(r, q.where));
            return (typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows).map((r) => ({ ...r }));
        },
        async findOne(object: string, q: { where?: Record<string, unknown> } = {}) {
            assertEngineFindOnePredicate(object, q as EngineFindOneQueryInput);
            const hit = (tables[object] ?? []).find((r) => matches(r, q.where));
            return hit ? { ...hit } : null;
        },
        async update(object: string, values: Record<string, unknown>, opts: { where?: Record<string, unknown> }) {
            assertEngineUpdateDispatch(values as never, opts as never);
            for (const r of tables[object] ?? []) if (matches(r, opts.where)) Object.assign(r, values);
            return {};
        },
        async delete(object: string, opts: { where?: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts as never);
            tables[object] = (tables[object] ?? []).filter((r) => !matches(r, opts.where));
            return {};
        },
    };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    // Last opened, first closed: a transport's held session goes before the server it holds.
    for (const close of closers.splice(0).reverse()) await close();
});

/** Mock APNs gateway (HTTP/2): answers 410 Unregistered for the tokens in `dead`, else 200. */
async function mockApns(dead: Set<string>) {
    const pushes: Array<{ token: string; payload: any }> = [];
    const server = http2.createServer();
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
        let body = '';
        stream.setEncoding('utf8');
        stream.on('data', (c: string) => { body += c; });
        stream.on('end', () => {
            const token = String(headers[':path']).replace('/3/device/', '');
            pushes.push({ token, payload: JSON.parse(body) });
            if (dead.has(token)) {
                stream.respond({ ':status': 410 });
                stream.end(JSON.stringify({ reason: 'Unregistered' }));
            } else {
                stream.respond({ ':status': 200, 'apns-id': `apns-${pushes.length}` });
                stream.end();
            }
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, pushes };
}

/** Mock Google: the OAuth token endpoint and the FCM v1 send endpoint. */
async function mockFcm() {
    const pushes: Array<{ url: string; message: any }> = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => { body += c; });
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            if (req.url === '/token') {
                res.end(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
                return;
            }
            pushes.push({ url: String(req.url), message: JSON.parse(body).message });
            res.end(JSON.stringify({ name: `projects/p/messages/${pushes.length}` }));
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { origin, tokenUri: `${origin}/token`, pushes };
}

const APNS_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    .export({ type: 'pkcs8', format: 'pem' }).toString();
const FCM_ACCOUNT = JSON.stringify({
    client_email: 'push@p.iam.gserviceaccount.com',
    private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
/** The secrets layer of this test: each credentialRef names one secret. */
const SECRETS: Record<string, string> = { APNS_SIGNING_KEY: APNS_KEY, FCM_SERVICE_ACCOUNT: FCM_ACCOUNT };

const IOS_TOKEN = 'a1'.repeat(32);
const DEAD_IOS_TOKEN = 'd0'.repeat(32);
const ANDROID_TOKEN = 'fcm-android-token-1';

async function boot(dead: Set<string> = new Set()) {
    const apns = await mockApns(dead);
    const fcm = await mockFcm();
    const data = memoryEngine();
    const getData = () => data as any;
    const resolveCredential = (ref: string) => SECRETS[ref];
    const apnsTransport = new ApnsPushTransport({
        config: { teamId: 'TEAM123456', keyId: 'KEY1234567', topic: 'com.example.crm', environment: 'sandbox', credentialRef: 'APNS_SIGNING_KEY' },
        resolveCredential,
        origin: apns.origin,
    });
    closers.push(() => apnsTransport.close());
    const push = new PushService({
        transports: {
            apns: apnsTransport,
            fcm: new FcmPushTransport({
                config: { projectId: 'p', credentialRef: 'FCM_SERVICE_ACCOUNT' },
                resolveCredential,
                origin: fcm.origin,
                tokenUri: fcm.tokenUri,
            }),
        },
    });

    const messaging = new MessagingService({ logger: silentLogger(), getData });
    messaging.registerChannel(createInboxChannel({ getData }));
    messaging.registerChannel(createPushChannel({ getPush: () => push, devices: messaging }));

    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : name === 'data' ? getData() : undefined),
    } as any);
    return { engine, messaging, apns, fcm };
}

async function runNotify(stack: Awaited<ReturnType<typeof boot>>, config: Record<string, unknown>, record?: Record<string, unknown>) {
    stack.engine.registerFlow('deal_won', {
        name: 'deal_won',
        label: 'Deal won',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'tell_owner', type: 'notify', label: 'Tell owner', config },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'tell_owner' },
            { id: 'e2', source: 'tell_owner', target: 'end' },
        ],
    } as any);
    const context = record ? { tenantId: 'org_1', object: 'opportunity', record } : { tenantId: 'org_1' };
    return stack.engine.execute('deal_won', context as any);
}

describe('#29041 — a notify node naming the push channel', () => {
    it('delivers to the devices the signed-in user registered, through mock APNs and FCM, carrying route', async () => {
        const stack = await boot();
        // What `POST /api/v1/notifications/devices` does for the session user.
        await stack.messaging.registerDevice('usr_owner', { token: IOS_TOKEN, platform: 'ios', deviceId: 'iphone' });
        await stack.messaging.registerDevice('usr_owner', { token: ANDROID_TOKEN, platform: 'android', deviceId: 'pixel' });

        const run = await runNotify(stack, {
            title: 'Deal won',
            message: 'Acme signed',
            recipients: ['usr_owner'],
            channels: ['push'],
            actionUrl: '/apps/crm/opportunity/123',
        });

        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ selected: 1, acted: 1 });

        expect(stack.apns.pushes).toHaveLength(1);
        const apns = stack.apns.pushes[0];
        expect(apns.token).toBe(IOS_TOKEN);
        expect(apns.payload.aps.alert).toEqual({ title: 'Deal won', body: 'Acme signed' });
        expect(apns.payload.route).toBe('/apps/crm/opportunity/123');
        expect(typeof apns.payload.notificationId).toBe('string');

        expect(stack.fcm.pushes).toHaveLength(1);
        const fcm = stack.fcm.pushes[0];
        expect(fcm.url).toBe('/v1/projects/p/messages:send');
        expect(fcm.message).toMatchObject({
            token: ANDROID_TOKEN,
            notification: { title: 'Deal won', body: 'Acme signed' },
            data: { route: '/apps/crm/opportunity/123', notificationId: apns.payload.notificationId },
        });
    });

    it('carries the source record\'s app-relative path as route when the payload names no url', async () => {
        const stack = await boot();
        await stack.messaging.registerDevice('usr_owner', { token: IOS_TOKEN, platform: 'ios' });
        const run = await stack.messaging.emit({
            topic: 'deal.won',
            audience: ['usr_owner'],
            channels: ['push'],
            source: { object: 'opportunity', id: '123' },
            payload: { title: 'Deal won' },
        } as any);
        expect(run.delivered).toBe(1);
        expect(stack.apns.pushes[0].payload.route).toBe('/opportunity/123');
    });

    it('retires a token APNs reports Unregistered, and the user\'s other device still gets the push', async () => {
        const stack = await boot(new Set([DEAD_IOS_TOKEN]));
        await stack.messaging.registerDevice('usr_owner', { token: DEAD_IOS_TOKEN, platform: 'ios', deviceId: 'old-iphone' });
        await stack.messaging.registerDevice('usr_owner', { token: ANDROID_TOKEN, platform: 'android', deviceId: 'pixel' });

        const run = await runNotify(stack, { title: 'Deal won', recipients: ['usr_owner'], channels: ['push'] });
        expect(run.success).toBe(true);
        expect(stack.fcm.pushes).toHaveLength(1);

        const devices = await stack.messaging.listDevices('usr_owner');
        const old = devices.find((d) => d.deviceId === 'old-iphone');
        expect(old).toMatchObject({ enabled: false });
        expect(typeof old?.invalidatedAt).toBe('string');
        expect(devices.find((d) => d.deviceId === 'pixel')).toMatchObject({ enabled: true });

        // The retired device is not pushed again.
        await runNotify(stack, { title: 'Second deal', recipients: ['usr_owner'], channels: ['push'] });
        expect(stack.apns.pushes.map((p) => p.token)).toEqual([DEAD_IOS_TOKEN]);
        expect(stack.fcm.pushes).toHaveLength(2);
    });
});
