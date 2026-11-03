// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The device registry's two faces on the `/notifications` domain (ADR-0012
 * §6): `POST /devices` and `DELETE /devices/:deviceId`, driven at the
 * dispatcher facade with a recording service.
 *
 *  - anonymous is refused `401 UNAUTHENTICATED` on both, ahead of the service
 *    (ADR-0138 D2, the domain's first statement);
 *  - the owner is the session's user, never a body member: a body naming
 *    another `userId` registers for the caller;
 *  - a device id the caller does not hold surfaces the service's
 *    `NOT_FOUND` throw (the dispatcher answers it 404);
 *  - the device faces probe their OWN members: a provider without them
 *    answers the 501 capability disclosure, and a provider with them and no
 *    inbox still serves them;
 *  - the path segment is decoded, and a malformed escape is passed raw (an
 *    unknown id) rather than thrown on.
 *
 * The wire-level proof (real composition, real registry, real auth) lives in
 * `packages/qa/dogfood/test/push-device-registry.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

function makeDispatcher(service: Record<string, unknown> | null) {
    const kernel: any = {
        getService: (name: string) => (name === 'notification' ? service : null),
        getServiceAsync: async (name: string) => (name === 'notification' ? service : null),
        context: { getService: (name: string) => (name === 'notification' ? service : null) },
    };
    return new HttpDispatcher(kernel);
}

function deviceService() {
    return {
        listInbox: vi.fn(async () => ({ notifications: [], unreadCount: 0 })),
        registerDevice: vi.fn(async () => ({ deviceId: 'install-1', success: true })),
        unregisterDevice: vi.fn(async (_userId: string, deviceId: string) => {
            if (deviceId !== 'mine') {
                const err = new Error('Device not found.') as Error & { code?: string; status?: number };
                err.code = 'NOT_FOUND';
                err.status = 404;
                throw err;
            }
            return { success: true };
        }),
    };
}

const SIGNED_IN = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);
const ANONYMOUS = () => ({ request: {}, executionContext: {} } as any);

async function thrown(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('the request was served; a refusal was expected');
}

describe('/notifications/devices — the device registry faces', () => {
    it.each([
        ['POST', '/devices', { token: 't', platform: 'ios' }],
        ['DELETE', '/devices/mine', undefined],
    ])('anonymous %s %s is refused 401 UNAUTHENTICATED before the service is asked', async (method, path, body) => {
        const service = deviceService();
        const result = await makeDispatcher(service).handleNotification(path, method, body, {}, ANONYMOUS());
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(401);
        expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
        expect(service.registerDevice).not.toHaveBeenCalled();
        expect(service.unregisterDevice).not.toHaveBeenCalled();
    });

    it('registers for the session user; a body userId is not read', async () => {
        const service = deviceService();
        const body = { token: 't', platform: 'ios', deviceId: 'install-1', userId: 'someone_else' };
        const result = await makeDispatcher(service).handleNotification('/devices', 'POST', body, {}, SIGNED_IN());
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data).toEqual({ deviceId: 'install-1', success: true });
        expect(service.registerDevice).toHaveBeenCalledTimes(1);
        const [userId, request] = service.registerDevice.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(userId).toBe('user_1');
        expect(request).toEqual({ token: 't', platform: 'ios', deviceId: 'install-1' });
    });

    it('unregisters the caller\'s own device, and surfaces NOT_FOUND (404) for one it does not hold', async () => {
        const service = deviceService();
        const dispatcher = makeDispatcher(service);
        const ok = await dispatcher.handleNotification('/devices/mine', 'DELETE', undefined, {}, SIGNED_IN());
        expect(ok.response?.status).toBe(200);
        expect(ok.response?.body?.data).toEqual({ success: true });
        expect(service.unregisterDevice).toHaveBeenLastCalledWith('user_1', 'mine');

        const refused = await thrown(dispatcher.handleNotification('/devices/someone-elses', 'DELETE', undefined, {}, SIGNED_IN()));
        expect(refused.code).toBe('NOT_FOUND');
        expect(refused.status).toBe(404);
    });

    it('decodes the device id segment, and passes a malformed escape through raw', async () => {
        const service = deviceService();
        const dispatcher = makeDispatcher(service);
        await thrown(dispatcher.handleNotification('/devices/a%2Fb', 'DELETE', undefined, {}, SIGNED_IN()));
        expect(service.unregisterDevice).toHaveBeenLastCalledWith('user_1', 'a/b');
        await thrown(dispatcher.handleNotification('/devices/%E0%A4%A', 'DELETE', undefined, {}, SIGNED_IN()));
        expect(service.unregisterDevice).toHaveBeenLastCalledWith('user_1', '%E0%A4%A');
    });

    it('answers 501 when the provider has no device registry, and serves one that has no inbox', async () => {
        const inboxOnly = { listInbox: vi.fn(async () => ({ notifications: [], unreadCount: 0 })) };
        const noRegistry = await makeDispatcher(inboxOnly)
            .handleNotification('/devices', 'POST', { token: 't', platform: 'ios' }, {}, SIGNED_IN());
        expect(noRegistry.response?.status).toBe(501);
        const noUnregister = await makeDispatcher(inboxOnly)
            .handleNotification('/devices/mine', 'DELETE', undefined, {}, SIGNED_IN());
        expect(noUnregister.response?.status).toBe(501);

        const { listInbox: _dropped, ...registryOnly } = deviceService();
        const served = await makeDispatcher(registryOnly)
            .handleNotification('/devices', 'POST', { token: 't', platform: 'android' }, {}, SIGNED_IN());
        expect(served.response?.status).toBe(200);
    });

    it('does not serve a verb or sub-path the two faces do not name', async () => {
        const service = deviceService();
        const dispatcher = makeDispatcher(service);
        for (const [method, path] of [['GET', '/devices'], ['PUT', '/devices'], ['POST', '/devices/mine'], ['DELETE', '/devices/a/b']]) {
            const result = await dispatcher.handleNotification(path, method, undefined, {}, SIGNED_IN());
            expect(result.handled, `${method} ${path}`).toBe(false);
        }
        expect(service.registerDevice).not.toHaveBeenCalled();
        expect(service.unregisterDevice).not.toHaveBeenCalled();

        // Unserved with or without an inbox (the route ledger's refusal rows):
        // only a missing notification service answers 501.
        const { listInbox: _dropped, ...registryOnly } = deviceService();
        const noInbox = await makeDispatcher(registryOnly).handleNotification('/devices', 'GET', undefined, {}, SIGNED_IN());
        expect(noInbox.handled).toBe(false);
        const noService = await makeDispatcher(null).handleNotification('/devices', 'GET', undefined, {}, SIGNED_IN());
        expect(noService.response?.status).toBe(501);
    });
});
