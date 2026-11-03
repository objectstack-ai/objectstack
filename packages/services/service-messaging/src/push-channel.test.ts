// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `push` channel (#29041): which devices one delivery reaches, the data it
 * carries (`PushDeliveryDataSchema`), what it does with a token the vendor
 * reports dead, how each outcome is graded, and its mount in
 * `MessagingServicePlugin` (present exactly while a `push` service is).
 */

import { describe, it, expect } from 'vitest';
import type { UserDevice } from '@objectstack/spec/system';
import { PushDeliveryDataSchema } from '@objectstack/spec/api';
import { createPushChannel, deliveryData, truncateUtf8, type PushSenderSurface } from './push-channel.js';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import type { Delivery } from './channel.js';

const ctx = { logger: { info() {}, warn() {}, error() {} } };

function device(over: Partial<UserDevice> & { deviceId: string; token: string }): UserDevice {
    return { userId: 'usr_1', vendor: 'apns', platform: 'ios', enabled: true, ...over };
}

type Answer = Awaited<ReturnType<PushSenderSurface['send']>>;

/** A push service double: answers per token, records every send. */
function pushDouble(answers: Record<string, Answer> = {}, vendors: string[] = ['apns', 'fcm']) {
    const sent: Array<Parameters<PushSenderSurface['send']>[0]> = [];
    const push: PushSenderSurface = {
        vendors: () => vendors,
        async send(m) {
            sent.push(m);
            return answers[m.token] ?? { status: 'sent', messageId: `id-${m.token}` };
        },
    };
    return { push, sent };
}

function registry(devices: UserDevice[]) {
    const retired: string[] = [];
    return {
        retired,
        devices: {
            async listDevices(userId: string) { return devices.filter((d) => d.userId === userId); },
            async invalidateDeviceToken(token: string) { retired.push(token); },
        },
    };
}

function delivery(over: Partial<Delivery['notification']> = {}): Delivery {
    return {
        channel: 'push',
        recipient: 'usr_1',
        notification: {
            notificationId: 'ntf_1',
            title: 'Deal won',
            body: 'Acme signed',
            recipients: ['usr_1'],
            actionUrl: '/opportunity/123',
            ...over,
        },
    };
}

describe('createPushChannel — send', () => {
    it('pushes every enabled device of the recipient, with the notification id and the actionUrl as route', async () => {
        const { push, sent } = pushDouble();
        const reg = registry([
            device({ deviceId: 'd1', token: 'tok-ios' }),
            device({ deviceId: 'd2', token: 'tok-android', vendor: 'fcm', platform: 'android' }),
            device({ deviceId: 'd3', token: 'tok-off', enabled: false }),
            device({ deviceId: 'd4', token: 'tok-other-user', userId: 'usr_2' }),
        ]);
        const channel = createPushChannel({ getPush: () => push, devices: reg.devices });
        const result = await channel.send(ctx, delivery());

        expect(result).toEqual({ ok: true, externalId: 'id-tok-ios,id-tok-android' });
        expect(sent.map((m) => [m.vendor, m.token])).toEqual([['apns', 'tok-ios'], ['fcm', 'tok-android']]);
        expect(sent[0]).toMatchObject({ title: 'Deal won', body: 'Acme signed' });
        expect(sent[0].data).toEqual({ notificationId: 'ntf_1', route: '/opportunity/123' });
        // The data is the declared delivery data.
        expect(PushDeliveryDataSchema.safeParse(sent[0].data).success).toBe(true);
    });

    it('leaves out a route that is not a same-server path, and still delivers', async () => {
        for (const actionUrl of ['https://evil.example/x', '//evil.example/x', '/a/../../api/v1/me', undefined]) {
            const { push, sent } = pushDouble();
            const channel = createPushChannel({ getPush: () => push, devices: registry([device({ deviceId: 'd1', token: 't1' })]).devices });
            expect((await channel.send(ctx, delivery({ actionUrl }))).ok).toBe(true);
            expect(sent[0].data).toEqual({ notificationId: 'ntf_1' });
        }
    });

    it('retires a token the vendor reports dead, and the recipient\'s other device still gets the push', async () => {
        const { push, sent } = pushDouble({ 'tok-dead': { status: 'invalid_token', reason: 'Unregistered' } });
        const reg = registry([device({ deviceId: 'd1', token: 'tok-dead' }), device({ deviceId: 'd2', token: 'tok-live' })]);
        const channel = createPushChannel({ getPush: () => push, devices: reg.devices });
        const result = await channel.send(ctx, delivery());

        expect(result.ok).toBe(true);
        expect(sent.map((m) => m.token)).toEqual(['tok-dead', 'tok-live']);
        expect(reg.retired).toEqual(['tok-dead']);
    });

    it('grades a delivery whose every device was reported dead invalid_recipient, retiring each', async () => {
        const dead: Answer = { status: 'invalid_token', reason: 'BadDeviceToken' };
        const { push } = pushDouble({ a: dead, b: dead });
        const reg = registry([device({ deviceId: 'd1', token: 'a' }), device({ deviceId: 'd2', token: 'b' })]);
        const channel = createPushChannel({ getPush: () => push, devices: reg.devices });
        const result = await channel.send(ctx, delivery());

        expect(result.ok).toBe(false);
        expect(channel.classifyError!(result.error)).toBe('invalid_recipient');
        expect(reg.retired).toEqual(['a', 'b']);
    });

    it('grades a recipient with no enabled device invalid_recipient without sending', async () => {
        const { push, sent } = pushDouble();
        const channel = createPushChannel({
            getPush: () => push,
            devices: registry([device({ deviceId: 'd1', token: 't', enabled: false })]).devices,
        });
        const result = await channel.send(ctx, delivery());
        expect(result.ok).toBe(false);
        expect(channel.classifyError!(result.error)).toBe('invalid_recipient');
        expect(sent).toHaveLength(0);
    });

    it('grades devices only on a vendor no transport is configured for as permanent, without sending', async () => {
        const { push, sent } = pushDouble({}, ['apns']);
        const channel = createPushChannel({
            getPush: () => push,
            devices: registry([device({ deviceId: 'd1', token: 't', vendor: 'fcm', platform: 'android' })]).devices,
        });
        const result = await channel.send(ctx, delivery());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('fcm');
        expect(channel.classifyError!(result.error)).toBe('permanent');
        expect(sent).toHaveLength(0);
    });

    it('grades a retryable vendor failure retryable, and a refusal no retry repairs permanent', async () => {
        const reg = registry([device({ deviceId: 'd1', token: 't' })]);
        const retry = createPushChannel({
            getPush: () => pushDouble({ t: { status: 'failed', error: 'APNs answered 503 ServiceUnavailable', retryable: true } }).push,
            devices: reg.devices,
        });
        const r1 = await retry.send(ctx, delivery());
        expect(r1.ok).toBe(false);
        expect(retry.classifyError!(r1.error)).toBe('retryable');

        const refuse = createPushChannel({
            getPush: () => pushDouble({ t: { status: 'failed', error: 'APNs answered 413 PayloadTooLarge', retryable: false } }).push,
            devices: reg.devices,
        });
        const r2 = await refuse.send(ctx, delivery());
        expect(r2.ok).toBe(false);
        expect(refuse.classifyError!(r2.error)).toBe('permanent');
    });

    it('counts a delivery with one device pushed as delivered, so a retry never pushes that device twice', async () => {
        const { push } = pushDouble({ b: { status: 'failed', error: 'timeout', retryable: true } });
        const channel = createPushChannel({
            getPush: () => push,
            devices: registry([device({ deviceId: 'd1', token: 'a' }), device({ deviceId: 'd2', token: 'b' })]).devices,
        });
        expect(await channel.send(ctx, delivery())).toEqual({ ok: true, externalId: 'id-a' });
    });

    it('shortens a long title and body to the byte ceilings on a character boundary', async () => {
        const { push, sent } = pushDouble();
        const channel = createPushChannel({ getPush: () => push, devices: registry([device({ deviceId: 'd1', token: 't' })]).devices });
        await channel.send(ctx, delivery({ title: '标'.repeat(200), body: '题\n'.repeat(2000) }));
        expect(Buffer.byteLength(sent[0].title, 'utf8')).toBeLessThanOrEqual(256);
        expect(Buffer.byteLength(sent[0].body, 'utf8')).toBeLessThanOrEqual(2048);
        expect(sent[0].title.endsWith('…')).toBe(true);
        expect(sent[0].body).not.toContain('\n');
    });
});

describe('createPushChannel — no transport', () => {
    it('refuses with transport_not_configured, permanent, and answers unavailable, when no push service is registered', async () => {
        const channel = createPushChannel({ getPush: () => undefined, devices: registry([]).devices });
        const result = await channel.send(ctx, delivery());
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/^transport_not_configured: /);
        expect(channel.classifyError!(result.error)).toBe('permanent');
        expect(await channel.isAvailable!(ctx, {})).toEqual({ available: false, reason: 'transport_not_configured' });
    });

    it('answers unavailable for a push service with no vendor, available for one with a vendor', async () => {
        const none = createPushChannel({ getPush: () => pushDouble({}, []).push, devices: registry([]).devices });
        expect(await none.isAvailable!(ctx, {})).toEqual({ available: false, reason: 'transport_not_configured' });
        const one = createPushChannel({ getPush: () => pushDouble({}, ['fcm']).push, devices: registry([]).devices });
        expect(await one.isAvailable!(ctx, {})).toEqual({ available: true });
    });
});

describe('deliveryData / truncateUtf8', () => {
    it('admits both inbox actionUrl shapes as route', () => {
        expect(deliveryData('n', '/opportunity/1')).toEqual({ notificationId: 'n', route: '/opportunity/1' });
        expect(deliveryData('n', '/apps/crm/opportunity/1')).toEqual({ notificationId: 'n', route: '/apps/crm/opportunity/1' });
    });

    it('leaves a short string as it is', () => {
        expect(truncateUtf8('abc', 10)).toBe('abc');
    });
});

describe('MessagingServicePlugin mounts the push channel while a push service is registered', () => {
    function kernelCtx() {
        const services = new Map<string, unknown>();
        const ready: Array<() => Promise<void>> = [];
        const devices = [{ id: 'r1', user_id: 'usr_1', device_id: 'd1', vendor: 'apns', platform: 'ios', token: 'tok-1', enabled: true }];
        services.set('manifest', { register() {} });
        services.set('data', {
            async insert(_o: string, row: Record<string, unknown>) { return { id: 'evt_1', ...row }; },
            async find(object: string, q: { where?: Record<string, unknown> } = {}) {
                return object === 'sys_user_device' ? devices.filter((d) => d.user_id === q.where?.user_id) : [];
            },
            async findOne() { return null; },
            async update() { return {}; },
            async delete() { return {}; },
        });
        const ctx = {
            logger: { info() {}, warn() {}, error() {}, debug() {}, child: () => ctx.logger },
            registerService: (name: string, svc: unknown) => services.set(name, svc),
            getService: <T>(name: string): T => {
                if (!services.has(name)) throw new Error(`service '${name}' not found`);
                return services.get(name) as T;
            },
            hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') ready.push(fn); },
        } as never;
        return { ctx, services, ready };
    }

    it('refuses push before a push service exists, and delivers through it once one is registered', async () => {
        const { ctx, services, ready } = kernelCtx();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        for (const fn of ready) await fn();
        const messaging = services.get('messaging') as MessagingService;
        const emit = { topic: 'deal.won', audience: ['usr_1'], channels: ['push'], payload: { title: 'Deal won', url: '/opportunity/9' } };

        const before = await messaging.emit(emit);
        expect(before.deliveries).toEqual([
            expect.objectContaining({ channel: 'push', recipient: 'usr_1', ok: false, error: "channel 'push' not registered" }),
        ]);

        const { push, sent } = pushDouble();
        services.set('push', push);
        const after = await messaging.emit(emit);
        expect(after.deliveries).toEqual([expect.objectContaining({ channel: 'push', recipient: 'usr_1', ok: true })]);
        expect(sent).toEqual([expect.objectContaining({ vendor: 'apns', token: 'tok-1', title: 'Deal won', data: { notificationId: 'evt_1', route: '/opportunity/9' } })]);
    });
});
