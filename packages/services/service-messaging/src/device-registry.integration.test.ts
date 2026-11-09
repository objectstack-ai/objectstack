// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The push device registry (ADR-0012 §6): `MessagingService`'s four
 * `INotificationService` device members over `sys_user_device`, pinned on a
 * real `ObjectQL` over `SqlDriver` (better-sqlite3) with the real `sys_user`.
 *
 * What the contract (`@objectstack/spec/contracts` `INotificationService`)
 * and spec's three rules (`system/push-device.zod.ts`) owe, one case each:
 *
 *  - register, then refresh the same `deviceId`: one row, token and
 *    `last_seen_at` moved;
 *  - a registration without `deviceId` mints one; the same user registering
 *    the same token again without it gets the SAME id back, never a second row;
 *  - a second user registering the token takes it over, and the first user's
 *    row for it is removed (rule b);
 *  - unregister by another user answers `NOT_FOUND` (404) and the row
 *    survives; the owner's unregister removes it;
 *  - `invalidateDeviceToken` keeps the row, disabled with its time (rule c);
 *    a later registration of the same device re-enables it and clears the
 *    time; a token nobody holds is a no-op;
 *  - the vendor derives from the platform, and a `web` registration without
 *    one is refused `VALIDATION_FAILED` at `vendor`, storing nothing;
 *  - `listDevices` answers only the caller's devices, newest first;
 *  - a takeover whose write is refused leaves the previous holder's row in
 *    place: the delete and the write are one engine transaction;
 *  - the database refuses a second holder of a token (the unique index), and
 *    two concurrent registrations of one token end with one row;
 *  - the registration's `origin` (ruling B on the push delivery decision) is
 *    stored on the row, `null` without one, replaced by a refresh, answered
 *    by `listDevices`, and copied into the data of a push to that device.
 *
 * Refusals assert `code` AND `status` (ADR-0112).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects';
import { validationFailureDetails } from '@objectstack/types';
import { PushDeliveryDataSchema } from '@objectstack/spec/api';
import { UserDevice } from './objects/user-device.object.js';
import { MessagingService } from './messaging-service.js';
import { USER_DEVICE_OBJECT } from './device-registry.js';
import { createPushChannel } from './push-channel.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as any;
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

/** A clock the test moves, so `last_seen_at` ordering is not a race. */
function clock() {
    let t = Date.parse('2026-11-02T10:00:00.000Z');
    return { now: () => new Date(t).toISOString(), tick: (ms = 60_000) => { t += ms; } };
}

async function boot() {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(driver, true);
    await ql.init();
    ql.registry.registerObject(SysUser as any, '@objectstack/plugin-auth');
    ql.registry.registerObject(UserDevice as any, '@objectstack/service-messaging');
    await ql.syncSchemas();
    await installDefaultOrganization(ql as any);
    engine = ql;
    const time = clock();
    const service = new MessagingService({ logger: silent, getData: () => ql as any, now: time.now });
    const alice = String((await ql.insert('sys_user', { name: 'Alice', email: 'alice@device.test' }, SYS)).id);
    const bob = String((await ql.insert('sys_user', { name: 'Bob', email: 'bob@device.test' }, SYS)).id);
    const rows = async (where: Record<string, unknown> = {}) =>
        (await ql.find(USER_DEVICE_OBJECT, { where }, SYS)) as Array<Record<string, any>>;
    return { ql, service, time, alice, bob, rows };
}

async function thrown(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('the call resolved; a refusal was expected');
}

describe('push device registry: INotificationService device members over sys_user_device', () => {
    it('register, then refresh the same deviceId: one row, token and last_seen_at updated', async () => {
        const { ql, service, time, alice, rows } = await boot();
        const first = await service.registerDevice(alice, { token: 'tok-1', platform: 'ios', deviceId: 'dev-a', name: 'iPhone' });
        expect(first).toEqual({ deviceId: 'dev-a', success: true });
        const [before] = await rows({ user_id: alice });

        time.tick();
        const again = await service.registerDevice(alice, { token: 'tok-2', platform: 'ios', deviceId: 'dev-a', locale: 'zh-CN' });
        expect(again).toEqual({ deviceId: 'dev-a', success: true });

        const after = await rows({ user_id: alice });
        expect(after).toHaveLength(1);
        // Rule (a): the registered schema carries no organization column.
        expect(Object.keys((ql.registry.getObject(USER_DEVICE_OBJECT) as any).fields)).not.toContain('organization_id');
        expect(after[0].id).toBe(before.id);
        expect(after[0].token).toBe('tok-2');
        expect(after[0].locale).toBe('zh-CN');
        expect(new Date(after[0].last_seen_at).getTime()).toBeGreaterThan(new Date(before.last_seen_at).getTime());
    });

    it('mints a deviceId when absent, and answers the same id for the same token without one', async () => {
        const { service, alice, rows } = await boot();
        const minted = await service.registerDevice(alice, { token: 'tok-m', platform: 'android' });
        expect(minted.success).toBe(true);
        expect(minted.deviceId).toMatch(/\S/);

        const cleared = await service.registerDevice(alice, { token: 'tok-m', platform: 'android' });
        expect(cleared.deviceId).toBe(minted.deviceId);
        expect(await rows({ token: 'tok-m' })).toHaveLength(1);
    });

    it('a second user registering the token takes it over; the first user\'s row for it is removed', async () => {
        const { service, alice, bob, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-shared', platform: 'ios', deviceId: 'alice-phone' });
        await service.registerDevice(alice, { token: 'tok-other', platform: 'ios', deviceId: 'alice-tablet' });

        const taken = await service.registerDevice(bob, { token: 'tok-shared', platform: 'ios', deviceId: 'bob-phone' });
        expect(taken).toEqual({ deviceId: 'bob-phone', success: true });

        const holders = await rows({ token: 'tok-shared' });
        expect(holders).toHaveLength(1);
        expect(String(holders[0].user_id)).toBe(bob);
        expect((await rows({ user_id: alice })).map((r) => r.device_id)).toEqual(['alice-tablet']);
        expect((await service.listDevices(alice)).map((d) => d.deviceId)).toEqual(['alice-tablet']);
    });

    it('a token this user holds under another deviceId moves to the named device; the stale row goes', async () => {
        const { service, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-x', platform: 'ios', deviceId: 'old-install' });
        await service.registerDevice(alice, { token: 'tok-x', platform: 'ios', deviceId: 'new-install' });
        expect((await rows({ user_id: alice })).map((r) => r.device_id)).toEqual(['new-install']);
    });

    it('unregister by a non-owner is NOT_FOUND (404) and the row survives; the owner removes it', async () => {
        const { service, alice, bob, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-u', platform: 'android', deviceId: 'alice-dev' });

        const refused = await thrown(service.unregisterDevice(bob, 'alice-dev'));
        expect(refused.code).toBe('NOT_FOUND');
        expect(refused.status).toBe(404);
        expect(await rows({ device_id: 'alice-dev' })).toHaveLength(1);

        const unknown = await thrown(service.unregisterDevice(alice, 'no-such-device'));
        expect(unknown.code).toBe('NOT_FOUND');
        expect(unknown.status).toBe(404);

        expect(await service.unregisterDevice(alice, 'alice-dev')).toEqual({ success: true });
        expect(await rows({ device_id: 'alice-dev' })).toHaveLength(0);
    });

    it('invalidateDeviceToken keeps the row disabled with its time; re-registration re-enables and clears it', async () => {
        const { service, time, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-dead', platform: 'ios', deviceId: 'dev-d' });

        time.tick();
        await service.invalidateDeviceToken('tok-dead');
        const [dead] = await rows({ device_id: 'dev-d' });
        expect(dead.enabled).toBe(false);
        expect(dead.invalidated_at).toBeTruthy();
        const [listed] = await service.listDevices(alice);
        expect(listed.enabled).toBe(false);
        expect(listed.invalidatedAt).toBe(time.now());

        // A token nobody holds is a no-op.
        await expect(service.invalidateDeviceToken('tok-nobody')).resolves.toBeUndefined();

        time.tick();
        await service.registerDevice(alice, { token: 'tok-dead', platform: 'ios', deviceId: 'dev-d' });
        const [revived] = await rows({ device_id: 'dev-d' });
        expect(revived.id).toBe(dead.id);
        expect(revived.enabled).toBe(true);
        expect(revived.invalidated_at ?? null).toBeNull();
        const [relisted] = await service.listDevices(alice);
        expect(relisted.enabled).toBe(true);
        expect(relisted).not.toHaveProperty('invalidatedAt');
    });

    it('derives the vendor from the platform, and refuses a web registration without one', async () => {
        const { service, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-ios', platform: 'ios' });
        await service.registerDevice(alice, { token: 'tok-and', platform: 'android' });
        await service.registerDevice(alice, { token: 'tok-web', platform: 'web', vendor: 'fcm' });
        const vendorOf = async (token: string) => (await rows({ token }))[0]?.vendor;
        expect(await vendorOf('tok-ios')).toBe('apns');
        expect(await vendorOf('tok-and')).toBe('fcm');
        expect(await vendorOf('tok-web')).toBe('fcm');

        const refused = await thrown(service.registerDevice(alice, { token: 'tok-web-2', platform: 'web' }));
        const details = validationFailureDetails(refused);
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(details?.fields).toEqual([expect.objectContaining({ field: 'vendor', code: 'required' })]);
        expect(await rows({ token: 'tok-web-2' })).toHaveLength(0);
    });

    it('listDevices answers only the caller\'s devices, newest last_seen_at first', async () => {
        const { service, time, alice, bob } = await boot();
        await service.registerDevice(alice, { token: 't1', platform: 'ios', deviceId: 'older' });
        time.tick();
        await service.registerDevice(alice, { token: 't2', platform: 'android', deviceId: 'newer', appId: 'ai.objectos.app' });
        await service.registerDevice(bob, { token: 't3', platform: 'ios', deviceId: 'bobs' });

        const mine = await service.listDevices(alice);
        expect(mine.map((d) => d.deviceId)).toEqual(['newer', 'older']);
        expect(mine[0]).toMatchObject({ userId: alice, vendor: 'fcm', token: 't2', platform: 'android', appId: 'ai.objectos.app', enabled: true });
        expect(mine.every((d) => d.userId === alice)).toBe(true);
    });

    it('a takeover whose write is refused rolls the previous holder\'s delete back: one unit, not two steps', async () => {
        const { ql, time, alice, bob, rows } = await boot();
        // The real engine, but the registry's insert is refused once armed, as a
        // database refusal of the write would be (after the delete has run).
        let refuseInsert = false;
        const refusing = new Proxy(ql as any, {
            get(target, prop, receiver) {
                if (prop === 'insert') {
                    return async (object: string, ...rest: unknown[]) => {
                        if (refuseInsert && object === USER_DEVICE_OBJECT) throw new Error('write refused by the database');
                        return (target.insert as (...a: unknown[]) => unknown).call(target, object, ...rest);
                    };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const service = new MessagingService({ logger: silent, getData: () => refusing, now: time.now });
        await service.registerDevice(alice, { token: 'tok-unit', platform: 'ios', deviceId: 'alice-phone' });

        refuseInsert = true;
        const refused = await thrown(service.registerDevice(bob, { token: 'tok-unit', platform: 'ios', deviceId: 'bob-phone' }));
        expect(String(refused?.message)).toBe('write refused by the database');

        const holders = await rows({ token: 'tok-unit' });
        expect(holders).toHaveLength(1);
        expect(String(holders[0].user_id)).toBe(alice);
        expect(await rows({ user_id: bob })).toHaveLength(0);
    });

    it('the database refuses a second holder of a token, and concurrent registrations end with one row', async () => {
        const { ql, service, alice, bob, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-race', platform: 'ios', deviceId: 'a1' });

        // The unique index itself: a direct second holder is refused.
        const direct = await thrown(ql.insert(USER_DEVICE_OBJECT, {
            id: 'manual', user_id: bob, device_id: 'b-manual', token: 'tok-race', vendor: 'apns', platform: 'ios', enabled: true,
        }, SYS));
        expect(String(direct?.message ?? direct)).toMatch(/unique|duplicate/i);

        await Promise.all([
            service.registerDevice(bob, { token: 'tok-race', platform: 'ios', deviceId: 'b1' }),
            service.registerDevice(alice, { token: 'tok-race', platform: 'ios', deviceId: 'a2' }),
            service.registerDevice(bob, { token: 'tok-race', platform: 'ios', deviceId: 'b2' }),
        ]);
        expect(await rows({ token: 'tok-race' })).toHaveLength(1);
    });
});

describe('push device registry: the sending server (origin) is stored, read back and pushed', () => {
    it('stores the registration\'s origin on the row and listDevices answers it', async () => {
        const { service, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-o', platform: 'ios', deviceId: 'dev-o', origin: 'https://crm.example.com' });

        const [row] = await rows({ device_id: 'dev-o' });
        expect(row.origin).toBe('https://crm.example.com');
        const [listed] = await service.listDevices(alice);
        expect(listed.origin).toBe('https://crm.example.com');
    });

    it('stores null for a registration without origin, and the device answers no origin member', async () => {
        const { service, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-n', platform: 'android', deviceId: 'dev-n' });

        const [row] = await rows({ device_id: 'dev-n' });
        expect(row.origin ?? null).toBeNull();
        const [listed] = await service.listDevices(alice);
        expect(listed).not.toHaveProperty('origin');
    });

    it('a refresh replaces the stored origin with the one it names, as it does appId and locale', async () => {
        const { service, alice, rows } = await boot();
        await service.registerDevice(alice, { token: 'tok-r', platform: 'ios', deviceId: 'dev-r', origin: 'https://a.example.com' });
        await service.registerDevice(alice, { token: 'tok-r', platform: 'ios', deviceId: 'dev-r', origin: 'http://localhost:3000' });
        expect((await rows({ device_id: 'dev-r' }))[0].origin).toBe('http://localhost:3000');

        await service.registerDevice(alice, { token: 'tok-r', platform: 'ios', deviceId: 'dev-r' });
        expect((await rows({ device_id: 'dev-r' }))[0].origin ?? null).toBeNull();
    });

    it('a push to the device carries the stored origin in its data; a device without one gets none', async () => {
        const { service, alice } = await boot();
        await service.registerDevice(alice, { token: 'tok-s', platform: 'ios', deviceId: 'with-origin', origin: 'https://crm.example.com' });
        await service.registerDevice(alice, { token: 'tok-t', platform: 'android', deviceId: 'without-origin' });

        const sent: Array<{ token: string; data: Record<string, string> }> = [];
        const channel = createPushChannel({
            getPush: () => ({
                vendors: () => ['apns', 'fcm'],
                async send(m) { sent.push({ token: m.token, data: m.data }); return { status: 'sent', messageId: m.token }; },
            }),
            devices: service,
        });
        const result = await channel.send({ logger: silent } as any, {
            channel: 'push',
            recipient: alice,
            notification: { notificationId: 'ntf_o', title: 'Deal won', body: 'Acme', actionUrl: '/opportunity/1' },
        } as any);

        expect(result.ok).toBe(true);
        const byToken = Object.fromEntries(sent.map((m) => [m.token, m.data]));
        expect(byToken['tok-s']).toEqual({ notificationId: 'ntf_o', route: '/opportunity/1', origin: 'https://crm.example.com' });
        expect(byToken['tok-t']).toEqual({ notificationId: 'ntf_o', route: '/opportunity/1' });
        for (const m of sent) expect(PushDeliveryDataSchema.safeParse(m.data).success).toBe(true);
    });
});
