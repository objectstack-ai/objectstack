// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PushServicePlugin` reads `PushServiceConfigSchema` (`@objectstack/spec/system`)
 * and registers the kernel's `push` service; `PushService` routes by vendor.
 */

import { describe, it, expect } from 'vitest';
import { PushServicePlugin, PUSH_RELAY_NOT_SERVED_MESSAGE } from './push-plugin.js';
import { PushService, type IPushTransport, type PushMessage } from './push-service.js';
import { envPushCredentialResolver } from './credential.js';

function context() {
    const services = new Map<string, unknown>();
    const lines: string[] = [];
    const logger = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error() {}, debug() {} };
    return {
        services,
        lines,
        ctx: { registerService: (name: string, s: unknown) => services.set(name, s), logger } as never,
    };
}

const APNS = { teamId: 'TEAM123456', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production' as const, credentialRef: 'APNS_KEY' };
const FCM = { projectId: 'example-app', credentialRef: 'FCM_ACCOUNT' };
const message: PushMessage = { vendor: 'fcm', token: 't', title: 'x', body: 'y', data: {} };

describe('PushServicePlugin', () => {
    it('registers the push service with one transport per configured vendor', async () => {
        const { ctx, services } = context();
        await new PushServicePlugin({ config: { apns: APNS, fcm: FCM } }).init(ctx);
        const push = services.get('push') as PushService;
        expect(push).toBeInstanceOf(PushService);
        expect(push.vendors().sort()).toEqual(['apns', 'fcm']);
    });

    it('boots the direct transport, named or read from a vendor block', async () => {
        for (const config of [{ transport: 'direct' as const, apns: APNS }, { apns: APNS }]) {
            const { ctx, services } = context();
            await new PushServicePlugin({ config }).init(ctx);
            expect((services.get('push') as PushService).vendors()).toEqual(['apns']);
        }
    });

    it.each([
        ['no config', undefined],
        ['the empty config', {}],
        ["transport: 'relay'", { transport: 'relay' as const }],
        ['a staging relay endpoint', { transport: 'relay' as const, endpoint: 'https://relay.staging.example.com' }],
    ])('refuses the relay transport at init (%s), registering nothing', async (_name, config) => {
        const { ctx, services } = context();
        const init = new PushServicePlugin({ config }).init(ctx);
        await expect(init).rejects.toThrow(PUSH_RELAY_NOT_SERVED_MESSAGE);
        expect(services.has('push')).toBe(false);
    });

    it('names the follow-up card and the direct transport in the relay refusal', () => {
        expect(PUSH_RELAY_NOT_SERVED_MESSAGE).toContain('#29920');
        expect(PUSH_RELAY_NOT_SERVED_MESSAGE).toContain("transport: 'direct'");
        expect(PUSH_RELAY_NOT_SERVED_MESSAGE).toContain('credentialRef');
    });

    it('refuses an inline secret at init with the schema\'s guidance, registering nothing', async () => {
        const { ctx, services } = context();
        const plugin = new PushServicePlugin({ config: { apns: { ...APNS, privateKey: '-----BEGIN PRIVATE KEY-----' } } as never });
        await expect(plugin.init(ctx)).rejects.toThrow(/credentialRef/);
        expect(services.has('push')).toBe(false);
    });

    it('lets a host transport win over that vendor\'s config block', async () => {
        const { ctx, services } = context();
        const sent: PushMessage[] = [];
        const fcm: IPushTransport = { vendor: 'fcm', async send(m) { sent.push(m); return { status: 'sent', messageId: 'host' }; } };
        await new PushServicePlugin({ config: { fcm: FCM }, transports: { fcm } }).init(ctx);
        expect(await (services.get('push') as PushService).send(message)).toEqual({ status: 'sent', messageId: 'host' });
        expect(sent).toHaveLength(1);
    });
});

describe('PushService', () => {
    it('answers a vendor with no transport as a non-retryable failure', async () => {
        const push = new PushService({ transports: {} });
        expect(await push.send(message)).toEqual({
            status: 'failed',
            error: 'vendor_not_configured: no fcm transport is configured',
            retryable: false,
        });
    });

    it('answers a transport that throws as a retryable failure, logging a masked token', async () => {
        const warned: string[] = [];
        const push = new PushService({
            transports: { fcm: { vendor: 'fcm', async send() { throw new Error('socket hang up'); } } },
            logger: { warn: (m) => warned.push(m) },
        });
        const result = await push.send({ ...message, token: 'secret-device-token-123456' });
        expect(result).toMatchObject({ status: 'failed', retryable: true });
        expect(warned[0]).toContain('***123456');
        expect(warned[0]).not.toContain('secret-device-token');
    });
});

describe('envPushCredentialResolver', () => {
    it('reads the environment variable the reference names', () => {
        process.env.PUSH_TEST_REF_29041 = 'value';
        try {
            expect(envPushCredentialResolver('PUSH_TEST_REF_29041')).toBe('value');
            expect(envPushCredentialResolver('PUSH_TEST_REF_29041_ABSENT')).toBeUndefined();
        } finally {
            delete process.env.PUSH_TEST_REF_29041;
        }
    });
});
