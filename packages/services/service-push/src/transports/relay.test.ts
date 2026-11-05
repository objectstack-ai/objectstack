// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hosted push relay sender (#29920): one `PushRelayRequestSchema` POST per
 * push, authenticated by the `cloud-binding` service's credential, read on
 * every send. Each arm the maintainer ruled is pinned here: bound, unbound,
 * the default address and an explicit endpoint, no address at all, a 401, and
 * the per-delivery `ok` / `invalid` / `retry` answers.
 */

import { describe, it, expect } from 'vitest';
import { PushRelayRequestSchema } from '@objectstack/spec/api';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import type { PushMessage } from '../push-service.js';
import { PushService } from '../push-service.js';
import {
    DEFAULT_PUSH_NOTICE,
    PUSH_RELAY_PATH,
    RELAY_ADDRESS_NOT_PUBLISHED,
    RELAY_BINDING_REFUSED,
    RELAY_NOT_BOUND,
    RelayPushSender,
    relayTransport,
} from './relay.js';

const SECRET = 'oscc_secret-binding-credential-29920';

function binding(over: Partial<{ credential: string; controlPlaneUrl: string }> = {}): ICloudBindingService {
    const credential = over.credential ?? SECRET;
    return {
        credential: () => credential,
        bound: () => credential !== '',
        controlPlaneUrl: () => over.controlPlaneUrl ?? 'https://cloud.example.com',
    };
}

interface Call { url: string; headers: Record<string, string>; body: unknown }

/** A relay double: records each request and answers with the given status and body. */
function relay(status = 200, answer?: (body: { deliveries: Array<{ token: string }> }) => unknown) {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, headers: init.headers as Record<string, string>, body });
        const payload = answer
            ? answer(body)
            : { results: body.deliveries.map((d: { token: string }) => ({ token: d.token, status: 'ok' })) };
        return new Response(JSON.stringify(payload), { status });
    }) as unknown as typeof fetch;
    return { calls, fetch: fetchImpl };
}

const message: PushMessage = {
    vendor: 'apns',
    token: 'device-token-abcdef',
    title: 'Deal won',
    body: 'Acme signed the contract',
    data: { notificationId: 'ntf_1', route: '/opportunity/1' },
    notice: '您有一条新通知',
};

describe('RelayPushSender — a bound server', () => {
    it('POSTs one ID-only delivery to the control plane relay path, with the binding credential as bearer', async () => {
        const r = relay();
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        expect(await sender.send(message)).toEqual({ status: 'sent' });

        expect(r.calls).toHaveLength(1);
        const [call] = r.calls;
        expect(call!.url).toBe(`https://cloud.example.com${PUSH_RELAY_PATH}`);
        expect(PUSH_RELAY_PATH).toBe('/api/v1/cloud/push/send');
        expect(call!.headers.authorization).toBe(`Bearer ${SECRET}`);
        // The wire the relay pins: it parses, and it carries no content.
        expect(PushRelayRequestSchema.safeParse(call!.body).success).toBe(true);
        expect(call!.body).toEqual({
            deliveries: [{
                token: 'device-token-abcdef',
                vendor: 'apns',
                payload: { data: { notificationId: 'ntf_1', route: '/opportunity/1' }, text: '您有一条新通知' },
                priority: 'high',
            }],
        });
        expect(JSON.stringify(call!.body)).not.toContain('Deal won');
        expect(JSON.stringify(call!.body)).not.toContain('Acme signed');
    });

    it('sends to an explicit relay endpoint, which wins over the control plane', async () => {
        const r = relay();
        const sender = new RelayPushSender({
            config: { transport: 'relay', endpoint: 'https://relay.staging.example.com/send' },
            binding: () => binding(),
            fetch: r.fetch,
        });
        await sender.send(message);
        expect(r.calls[0]!.url).toBe('https://relay.staging.example.com/send');
    });

    it('sends the English line when the caller names none', async () => {
        const r = relay();
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        await sender.send({ ...message, notice: undefined });
        expect((r.calls[0]!.body as { deliveries: Array<{ payload: { text: string } }> }).deliveries[0]!.payload.text)
            .toBe(DEFAULT_PUSH_NOTICE);
    });

    it('reads the credential on every send: a bind done while the server runs takes effect at once', async () => {
        let credential = '';
        const live: ICloudBindingService = {
            credential: () => credential,
            bound: () => credential !== '',
            controlPlaneUrl: () => 'https://cloud.example.com',
        };
        const r = relay();
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => live, fetch: r.fetch });
        expect(sender.bound()).toBe(false);
        expect(await sender.send(message)).toMatchObject({ status: 'failed', retryable: false });
        credential = SECRET;
        expect(sender.bound()).toBe(true);
        expect(await sender.send(message)).toEqual({ status: 'sent' });
        expect(r.calls).toHaveLength(1);
    });
});

describe('RelayPushSender — what the relay answers', () => {
    it('`invalid` is a dead token, so the channel retires the device row', async () => {
        const r = relay(200, (b) => ({ results: [{ token: b.deliveries[0]!.token, status: 'invalid' }] }));
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        expect(await sender.send(message)).toEqual({ status: 'invalid_token', reason: 'relay: invalid' });
    });

    it('`retry` is a retryable failure', async () => {
        const r = relay(200, (b) => ({ results: [{ token: b.deliveries[0]!.token, status: 'retry' }] }));
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        expect(await sender.send(message)).toMatchObject({ status: 'failed', retryable: true });
    });

    it('401 fails the request, not retryable, naming the lapsed binding — never the credential', async () => {
        const r = relay(401, () => ({
            success: false,
            error: {
                code: 'UNAUTHENTICATED',
                message: 'The server binding credential was not accepted',
                httpStatus: 401,
                details: { reason: 'binding_revoked' },
                helpText: 'Bind the server to the cloud again',
            },
        }));
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        const result = await sender.send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        const error = (result as { error: string }).error;
        expect(error.startsWith(`${RELAY_BINDING_REFUSED}:`)).toBe(true);
        expect(error).toContain('binding_revoked');
        expect(error).not.toContain(SECRET);
    });

    it('429 RATE_LIMIT_EXCEEDED is retryable, as the relay error schema pins; QUOTA_EXCEEDED is not', async () => {
        const limited = relay(429, () => ({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many', httpStatus: 429, retryAfterSeconds: 5, helpText: 'Wait' },
        }));
        const quota = relay(429, () => ({
            success: false,
            error: { code: 'QUOTA_EXCEEDED', message: 'Quota', httpStatus: 429, helpText: 'Raise the plan' },
        }));
        const send = (f: typeof fetch) => new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: f }).send(message);
        expect(await send(limited.fetch)).toMatchObject({ status: 'failed', retryable: true });
        expect(await send(quota.fetch)).toMatchObject({ status: 'failed', retryable: false });
    });

    it('a 5xx is retryable, another refusal is not', async () => {
        const send = (status: number) => new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: relay(status, () => ({})).fetch }).send(message);
        expect(await send(503)).toMatchObject({ status: 'failed', retryable: true });
        expect(await send(400)).toMatchObject({ status: 'failed', retryable: false });
    });
});

describe('RelayPushSender — nothing is sent', () => {
    it('an unbound server fails the send, not retryable, naming the missing binding', async () => {
        for (const resolve of [() => binding({ credential: '' }), () => undefined, () => { throw new Error('not registered'); }]) {
            const r = relay();
            const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: resolve, fetch: r.fetch });
            const result = await sender.send(message);
            expect(result).toMatchObject({ status: 'failed', retryable: false });
            expect((result as { error: string }).error).toMatch(new RegExp(`^${RELAY_NOT_BOUND}: the server is not bound to cloud`));
            expect(r.calls).toHaveLength(0);
        }
    });

    it('no endpoint and no control-plane URL fails the send, naming the relay address as not published', async () => {
        const r = relay();
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding({ controlPlaneUrl: '' }), fetch: r.fetch });
        const result = await sender.send(message);
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(new RegExp(`^${RELAY_ADDRESS_NOT_PUBLISHED}: `));
        expect(r.calls).toHaveLength(0);
    });

    it('a content key in the delivery data is refused before anything leaves the server', async () => {
        const r = relay();
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => binding(), fetch: r.fetch });
        const result = await sender.send({ ...message, data: { notificationId: 'ntf_1', title: 'Deal won' } });
        expect(result).toMatchObject({ status: 'failed', retryable: false });
        expect((result as { error: string }).error).toMatch(/^relay_payload_refused: deliveries\.0\.payload\.data: Unrecognized key.*`title`/);
        expect(r.calls).toHaveLength(0);
    });
});

describe('relayTransport — the push service lists a vendor only while the server is bound', () => {
    it('an unbound server lists no vendor, so the push channel reports transport_not_configured', () => {
        let credential = '';
        const live: ICloudBindingService = { credential: () => credential, bound: () => credential !== '', controlPlaneUrl: () => 'https://cloud.example.com' };
        const sender = new RelayPushSender({ config: { transport: 'relay' }, binding: () => live });
        const push = new PushService({ transports: { apns: relayTransport('apns', sender), fcm: relayTransport('fcm', sender) } });
        expect(push.vendors()).toEqual([]);
        credential = SECRET;
        expect(push.vendors().sort()).toEqual(['apns', 'fcm']);
    });
});
