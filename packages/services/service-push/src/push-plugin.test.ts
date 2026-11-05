// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PushServicePlugin` reads `PushServiceConfigSchema` (`@objectstack/spec/system`)
 * and registers the kernel's `push` service; `PushService` routes by vendor.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import { PushServicePlugin, PUSH_RELAY_AIR_GAPPED_MESSAGE } from './push-plugin.js';
import { PushService, type IPushTransport, type PushMessage } from './push-service.js';
import { envPushCredentialResolver } from './credential.js';

function context() {
    const services = new Map<string, unknown>();
    const lines: string[] = [];
    const hooks = new Map<string, Array<() => Promise<void> | void>>();
    const logger = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m), debug() {} };
    return {
        services,
        lines,
        /** Runs the handlers registered for `event`, as the kernel does. */
        async fire(event: string) { for (const h of hooks.get(event) ?? []) await h(); },
        ctx: {
            registerService: (name: string, s: unknown) => services.set(name, s),
            getService: (name: string) => {
                if (!services.has(name)) throw new Error(`service '${name}' is not registered`);
                return services.get(name);
            },
            hook: (event: string, h: () => Promise<void> | void) => hooks.set(event, [...(hooks.get(event) ?? []), h]),
            logger,
        } as never,
    };
}

const SECRET = 'oscc_secret-binding-credential-29920';

function cloudBinding(credential: () => string): ICloudBindingService {
    return { credential, bound: () => credential() !== '', controlPlaneUrl: () => 'https://cloud.example.com' };
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

const RELAY_CONFIGS = [
    ['no config', undefined],
    ['the empty config', {}],
    ["transport: 'relay'", { transport: 'relay' as const }],
    ['a staging relay endpoint', { transport: 'relay' as const, endpoint: 'https://relay.staging.example.com' }],
] as const;

describe('PushServicePlugin — the hosted relay', () => {
    beforeEach(() => vi.stubEnv('OS_CLOUD_URL', ''));
    afterEach(() => vi.unstubAllEnvs());

    it.each(RELAY_CONFIGS)('boots the relay transport (%s), unbound: the push service lists no vendor', async (_name, config) => {
        const { ctx, services } = context();
        await new PushServicePlugin({ config }).init(ctx);
        expect(services.get('push')).toBeInstanceOf(PushService);
        expect((services.get('push') as PushService).vendors()).toEqual([]);
    });

    it('bound: lists both vendors and sends one POST carrying the binding credential, which no log line carries', async () => {
        const { ctx, services, lines, fire } = context();
        services.set('cloud-binding', cloudBinding(() => SECRET));
        const calls: Array<{ url: string; headers: Record<string, string> }> = [];
        const relayFetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, headers: init.headers as Record<string, string> });
            const body = JSON.parse(String(init.body));
            return new Response(JSON.stringify({ results: [{ token: body.deliveries[0].token, status: 'ok' }] }), { status: 200 });
        }) as unknown as typeof fetch;
        const plugin = new PushServicePlugin({ config: {}, relayFetch });
        await plugin.init(ctx);
        await plugin.start(ctx);
        await fire('kernel:ready');
        const push = services.get('push') as PushService;
        expect(push.vendors().sort()).toEqual(['apns', 'fcm']);
        expect(await push.send(message)).toEqual({ status: 'sent' });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://cloud.example.com/api/v1/cloud/push/send');
        expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
        expect(lines.join('\n')).not.toContain(SECRET);
        expect(lines.some((l) => /not bound to the cloud/.test(l))).toBe(false);
    });

    it('unbound at kernel:ready: warns once, and the bind takes effect without a restart', async () => {
        const { ctx, services, lines, fire } = context();
        let credential = '';
        services.set('cloud-binding', cloudBinding(() => credential));
        const plugin = new PushServicePlugin({ config: {} });
        await plugin.init(ctx);
        await plugin.start(ctx);
        await fire('kernel:ready');
        const warned = lines.filter((l) => /not bound to the cloud/.test(l));
        expect(warned).toHaveLength(1);
        expect(warned[0]).toMatch(/transport_not_configured/);
        const push = services.get('push') as PushService;
        expect(push.vendors()).toEqual([]);
        credential = SECRET;
        expect(push.vendors().sort()).toEqual(['apns', 'fcm']);
    });

    it.each(RELAY_CONFIGS)('refuses the relay at init under OS_CLOUD_URL=off (%s), registering nothing', async (_name, config) => {
        vi.stubEnv('OS_CLOUD_URL', 'off');
        const { ctx, services } = context();
        await expect(new PushServicePlugin({ config }).init(ctx)).rejects.toThrow(PUSH_RELAY_AIR_GAPPED_MESSAGE);
        expect(services.has('push')).toBe(false);
    });

    it('names the air gap and both ways out (the inbox, the direct transport) in the refusal', () => {
        expect(PUSH_RELAY_AIR_GAPPED_MESSAGE).toContain('declared it has no control plane');
        expect(PUSH_RELAY_AIR_GAPPED_MESSAGE).toContain('in-app inbox');
        expect(PUSH_RELAY_AIR_GAPPED_MESSAGE).toContain("transport: 'direct'");
    });

    it('a direct block still boots under OS_CLOUD_URL=off', async () => {
        vi.stubEnv('OS_CLOUD_URL', 'off');
        const { ctx, services } = context();
        await new PushServicePlugin({ config: { fcm: FCM } }).init(ctx);
        expect((services.get('push') as PushService).vendors()).toEqual(['fcm']);
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
