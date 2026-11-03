// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The APNs transport against a local HTTP/2 server standing in for the APNs
 * gateway: the request it makes (path, headers, a provider token the public
 * key verifies, the payload with the delivery data beside `aps`), and how it
 * reads each answer APNs gives.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http2 from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ApnsPushTransport } from './apns.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const TOKEN = 'ab'.repeat(32);

interface Seen { headers: http2.IncomingHttpHeaders; body: string }
type Answer = { status: number; body?: unknown; apnsId?: string };

const servers: http2.Http2Server[] = [];
const transports: ApnsPushTransport[] = [];

afterEach(async () => {
    for (const t of transports.splice(0)) await t.close();
    for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A gateway that answers each request with the next queued answer (the last one repeats). */
async function gateway(answers: Answer[]) {
    const seen: Seen[] = [];
    const server = http2.createServer();
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
        let body = '';
        stream.setEncoding('utf8');
        stream.on('data', (c: string) => { body += c; });
        stream.on('end', () => {
            seen.push({ headers, body });
            const a = answers[Math.min(seen.length - 1, answers.length - 1)];
            stream.respond({ ':status': a.status, ...(a.apnsId ? { 'apns-id': a.apnsId } : {}) });
            stream.end(a.body === undefined ? '' : JSON.stringify(a.body));
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function transport(origin: string, opts: { resolve?: (ref: string) => string | undefined; now?: () => number } = {}) {
    const t = new ApnsPushTransport({
        config: { teamId: 'TEAM123456', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'sandbox', credentialRef: 'APNS_KEY' },
        resolveCredential: opts.resolve ?? ((ref) => (ref === 'APNS_KEY' ? P8 : undefined)),
        origin,
        now: opts.now,
    });
    transports.push(t);
    return t;
}

const message = { vendor: 'apns' as const, token: TOKEN, title: 'Deal won', body: 'Acme signed', data: { notificationId: 'ntf_1', route: '/apps/crm/opportunity/123' } };

function verifiesEs256(jwt: string): boolean {
    const [h, c, s] = jwt.split('.');
    return verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
}

describe('ApnsPushTransport', () => {
    it('posts the alert to /3/device/TOKEN with a provider token the key verifies, the data beside aps', async () => {
        const gw = await gateway([{ status: 200, apnsId: 'apns-id-1' }]);
        const result = await transport(gw.origin).send(message);

        expect(result).toEqual({ status: 'sent', messageId: 'apns-id-1' });
        expect(gw.seen).toHaveLength(1);
        const { headers, body } = gw.seen[0];
        expect(headers[':method']).toBe('POST');
        expect(headers[':path']).toBe(`/3/device/${TOKEN}`);
        expect(headers['apns-topic']).toBe('com.example.app');
        expect(headers['apns-push-type']).toBe('alert');
        const jwt = String(headers.authorization).replace(/^bearer /, '');
        expect(verifiesEs256(jwt)).toBe(true);
        const [h, c] = jwt.split('.').slice(0, 2).map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
        expect(h).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
        expect(c.iss).toBe('TEAM123456');
        expect(JSON.parse(body)).toEqual({
            notificationId: 'ntf_1',
            route: '/apps/crm/opportunity/123',
            aps: { alert: { title: 'Deal won', body: 'Acme signed' }, sound: 'default' },
        });
    });

    it.each([
        [400, 'BadDeviceToken'],
        [410, 'Unregistered'],
    ])('answers %i %s as invalid_token', async (status, reason) => {
        const gw = await gateway([{ status, body: { reason } }]);
        expect(await transport(gw.origin).send(message)).toEqual({ status: 'invalid_token', reason });
    });

    it('re-signs once on ExpiredProviderToken and delivers', async () => {
        let t = 1_000_000;
        const gw = await gateway([{ status: 403, body: { reason: 'ExpiredProviderToken' } }, { status: 200, apnsId: 'x' }]);
        const apns = transport(gw.origin, { now: () => (t += 1000) });
        expect(await apns.send(message)).toEqual({ status: 'sent', messageId: 'x' });
        expect(gw.seen).toHaveLength(2);
        expect(gw.seen[0].headers.authorization).not.toBe(gw.seen[1].headers.authorization);
    });

    it('reuses one provider token for fifty minutes, then mints a new one', async () => {
        let t = 1_000_000_000;
        const gw = await gateway([{ status: 200 }]);
        const apns = transport(gw.origin, { now: () => t });
        await apns.send(message);
        t += 49 * 60 * 1000;
        await apns.send(message);
        t += 2 * 60 * 1000;
        await apns.send(message);
        const auth = gw.seen.map((s) => s.headers.authorization);
        expect(auth[0]).toBe(auth[1]);
        expect(auth[2]).not.toBe(auth[1]);
    });

    it.each([
        [429, 'TooManyRequests', true],
        [503, 'ServiceUnavailable', true],
        [500, 'InternalServerError', true],
        [413, 'PayloadTooLarge', false],
        [403, 'InvalidProviderToken', false],
    ])('answers %i %s as failed, retryable %s', async (status, reason, retryable) => {
        const gw = await gateway([{ status, body: { reason } }]);
        const result = await transport(gw.origin).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable });
        expect((result as { error: string }).error).toContain(reason);
    });

    it('refuses a credentialRef that names nothing without sending, naming the reference and no value', async () => {
        const gw = await gateway([{ status: 200 }]);
        const result = await transport(gw.origin, { resolve: () => undefined }).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(/^credential_unresolved: .*'APNS_KEY'/);
        expect(gw.seen).toHaveLength(0);
    });

    it('refuses a reference that names something other than a signing key, never echoing it', async () => {
        const gw = await gateway([{ status: 200 }]);
        const result = await transport(gw.origin, { resolve: () => 'not-a-key-value' }).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(/^credential_unusable: /);
        expect((result as { error: string }).error).not.toContain('not-a-key-value');
        expect(gw.seen).toHaveLength(0);
    });

    it('answers a token that is not hex as invalid_token and never puts it in a request path', async () => {
        const gw = await gateway([{ status: 200 }]);
        const result = await transport(gw.origin).send({ ...message, token: '../../3/device/x' });
        expect(result).toMatchObject({ status: 'invalid_token' });
        expect(gw.seen).toHaveLength(0);
    });
});
