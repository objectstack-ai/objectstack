// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The FCM HTTP v1 transport against a local HTTP server standing in for both
 * Google's OAuth token endpoint and the FCM send endpoint: the signed
 * assertion it exchanges, the message it posts (the delivery data in
 * `message.data`), and how it reads each answer FCM gives.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { FcmPushTransport } from './fcm.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    client_email: 'push@example-app.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});

interface Seen { url: string; headers: http.IncomingHttpHeaders; body: string }
type Answer = { status: number; body?: unknown };

const servers: http.Server[] = [];
afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** One server: `/token` answers with `tokenAnswers`, everything else with `sendAnswers` (the last answer repeats). */
async function google(sendAnswers: Answer[], tokenAnswers: Answer[] = [{ status: 200, body: { access_token: 'at-1', expires_in: 3600 } }]) {
    const tokens: Seen[] = [];
    const sends: Seen[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => { body += c; });
        req.on('end', () => {
            const isToken = req.url === '/token';
            const log = isToken ? tokens : sends;
            const queue = isToken ? tokenAnswers : sendAnswers;
            log.push({ url: String(req.url), headers: req.headers, body });
            const a = queue[Math.min(log.length - 1, queue.length - 1)];
            res.writeHead(a.status, { 'content-type': 'application/json' });
            res.end(a.body === undefined ? '' : JSON.stringify(a.body));
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { origin, tokenUri: `${origin}/token`, tokens, sends };
}

function transport(g: { origin: string; tokenUri: string }, opts: { resolve?: (ref: string) => string | undefined; now?: () => number } = {}) {
    return new FcmPushTransport({
        config: { projectId: 'example-app', credentialRef: 'FCM_ACCOUNT' },
        resolveCredential: opts.resolve ?? ((ref) => (ref === 'FCM_ACCOUNT' ? SERVICE_ACCOUNT : undefined)),
        origin: g.origin,
        tokenUri: g.tokenUri,
        now: opts.now,
    });
}

const message = { vendor: 'fcm' as const, token: 'fcm-token-1', title: 'Deal won', body: 'Acme signed', data: { notificationId: 'ntf_1', route: '/opportunity/123' } };

const unregistered = {
    status: 404,
    body: { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } },
};

describe('FcmPushTransport', () => {
    it('exchanges a signed RS256 assertion, then posts the message with the data in message.data', async () => {
        const g = await google([{ status: 200, body: { name: 'projects/example-app/messages/0:1' } }]);
        const result = await transport(g).send(message);

        expect(result).toEqual({ status: 'sent', messageId: 'projects/example-app/messages/0:1' });
        expect(g.tokens).toHaveLength(1);
        const form = new URLSearchParams(g.tokens[0].body);
        expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
        const [h, c, s] = String(form.get('assertion')).split('.');
        expect(verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
        const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
        expect(claims).toMatchObject({
            iss: 'push@example-app.iam.gserviceaccount.com',
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: g.tokenUri,
        });

        expect(g.sends).toHaveLength(1);
        expect(g.sends[0].url).toBe('/v1/projects/example-app/messages:send');
        expect(g.sends[0].headers.authorization).toBe('Bearer at-1');
        expect(JSON.parse(g.sends[0].body)).toEqual({
            message: {
                token: 'fcm-token-1',
                notification: { title: 'Deal won', body: 'Acme signed' },
                data: { notificationId: 'ntf_1', route: '/opportunity/123' },
            },
        });
    });

    it('answers UNREGISTERED as invalid_token', async () => {
        const g = await google([unregistered]);
        expect(await transport(g).send(message)).toEqual({ status: 'invalid_token', reason: 'UNREGISTERED' });
    });

    it('keeps the access token across sends until it nears expiry', async () => {
        let t = 1_000_000_000;
        const g = await google([{ status: 200, body: { name: 'm' } }]);
        const fcm = transport(g, { now: () => t });
        await fcm.send(message);
        t += 30 * 60 * 1000;
        await fcm.send(message);
        expect(g.tokens).toHaveLength(1);
        t += 30 * 60 * 1000;
        await fcm.send(message);
        expect(g.tokens).toHaveLength(2);
    });

    it('refreshes the access token once on a 401 and delivers', async () => {
        const g = await google(
            [{ status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED' } } }, { status: 200, body: { name: 'm' } }],
            [{ status: 200, body: { access_token: 'at-1', expires_in: 3600 } }, { status: 200, body: { access_token: 'at-2', expires_in: 3600 } }],
        );
        expect(await transport(g).send(message)).toEqual({ status: 'sent', messageId: 'm' });
        expect(g.sends.map((s) => s.headers.authorization)).toEqual(['Bearer at-1', 'Bearer at-2']);
    });

    it.each([
        [429, 'QUOTA_EXCEEDED', true],
        [503, 'UNAVAILABLE', true],
        [400, 'INVALID_ARGUMENT', false],
        [403, 'SENDER_ID_MISMATCH', false],
    ])('answers %i %s as failed, retryable %s', async (status, errorCode, retryable) => {
        const g = await google([{ status, body: { error: { code: status, status: errorCode, details: [{ errorCode }] } } }]);
        const result = await transport(g).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable });
        expect((result as { error: string }).error).toContain(errorCode);
    });

    it('refuses a reference that names no service-account JSON, without echoing it or calling Google', async () => {
        const g = await google([{ status: 200, body: { name: 'm' } }]);
        const result = await transport(g, { resolve: () => 'plainly-not-json' }).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(/^credential_unusable: .*'FCM_ACCOUNT'/);
        expect((result as { error: string }).error).not.toContain('plainly-not-json');
        expect(g.tokens).toHaveLength(0);
        expect(g.sends).toHaveLength(0);
    });

    it('answers a token endpoint that refuses the service account as a non-retryable credential failure', async () => {
        const g = await google([{ status: 200 }], [{ status: 400, body: { error: 'invalid_grant' } }]);
        const result = await transport(g).send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(/^credential_refused: /);
        expect(g.sends).toHaveLength(0);
    });
});
