// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The push device registry over HTTP on the real showcase stack (ADR-0012
 * §6): `POST /api/v1/notifications/devices` and
 * `DELETE /api/v1/notifications/devices/:deviceId`, with the real
 * composition, the real auth, the real messaging service and the real
 * `sys_user_device` table.
 *
 * The engine-level pins live beside the registry
 * (`service-messaging/src/device-registry.integration.test.ts`); this file is
 * the face a signed-in mobile session actually reaches:
 *
 *  - `[anonymous]` both routes answer `401 UNAUTHENTICATED`;
 *  - `[register]` a member registers, then refreshes the same device id: one
 *    row, the new token;
 *  - `[owner]` another member's unregister of that device answers `404
 *    NOT_FOUND` and the row survives; the owner's removes it;
 *  - `[takeover]` a second member registering the same token takes it over,
 *    and the first member's row for it is gone (their own unregister is 404);
 *  - `[invalidate]` a token the push channel reports dead keeps its row,
 *    disabled; the device's next registration re-enables it and clears the
 *    time;
 *  - `[body]` a body outside `RegisterDeviceRequestSchema`, and a web
 *    registration with no vendor, answer `400 VALIDATION_FAILED`;
 *  - `[data-api]` the generic data API neither lists, reads nor writes
 *    `sys_user_device` for a plain member (`404 OBJECT_API_DISABLED`, the
 *    exposure gate's answer): the device routes are the only door.
 *
 * Refusals assert `code` AND `status` (ADR-0112).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const OBJ = 'sys_user_device';
const SYS = { isSystem: true } as const;
const ALICE = 'device.alice@verify.test';
const BOB = 'device.bob@verify.test';

const codeOf = (b: any) => (b?.error && typeof b.error === 'object' ? b.error.code : undefined) ?? b?.code ?? null;

describe('push device registry over HTTP (ADR-0012 §6)', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceTok: string;
  let bobTok: string;
  let aliceId: string;
  let bobId: string;

  const userIdOf = async (email: string): Promise<string> => {
    const id = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(id, `${email} provisioned`).toBeTruthy();
    return String(id);
  };
  const rows = async (where: Record<string, unknown>) =>
    (await ql.find(OBJ, { where, context: SYS })) as Array<Record<string, any>>;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    aliceTok = await stack.signUp(ALICE);
    bobTok = await stack.signUp(BOB);
    ql = await stack.kernel.getServiceAsync('objectql');
    aliceId = await userIdOf(ALICE);
    bobId = await userIdOf(BOB);
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('[anonymous] both routes answer 401 UNAUTHENTICATED', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/v1/notifications/devices', { token: 'anon', platform: 'ios' }],
      ['DELETE', '/api/v1/notifications/devices/anything', undefined],
    ] as const) {
      const res = await stack.raw(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      expect(res.status, `${method} ${path}: ${text}`).toBe(401);
      expect(codeOf(JSON.parse(text))).toBe('UNAUTHENTICATED');
    }
    expect(await rows({ token: 'anon' })).toHaveLength(0);
  });

  it('[register] registers, then refreshes the same device id: one row, the new token', async () => {
    const first = await call(aliceTok, 'POST', '/notifications/devices', { token: 'alice-tok-1', platform: 'ios', deviceId: 'alice-phone' });
    expect(first.status, first.text).toBe(200);
    expect(first.body?.data).toEqual({ deviceId: 'alice-phone', success: true });

    const again = await call(aliceTok, 'POST', '/notifications/devices', { token: 'alice-tok-2', platform: 'ios', deviceId: 'alice-phone' });
    expect(again.status, again.text).toBe(200);

    const mine = await rows({ user_id: aliceId });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ device_id: 'alice-phone', token: 'alice-tok-2', vendor: 'apns', enabled: true });
  });

  it('[owner] another member\'s unregister is 404 NOT_FOUND and the row survives; the owner removes it', async () => {
    await call(aliceTok, 'POST', '/notifications/devices', { token: 'alice-tok-own', platform: 'android', deviceId: 'alice-tablet' });

    const refused = await call(bobTok, 'DELETE', '/notifications/devices/alice-tablet');
    expect(refused.status, refused.text).toBe(404);
    expect(codeOf(refused.body)).toBe('NOT_FOUND');
    expect(await rows({ device_id: 'alice-tablet' })).toHaveLength(1);

    const removed = await call(aliceTok, 'DELETE', '/notifications/devices/alice-tablet');
    expect(removed.status, removed.text).toBe(200);
    expect(await rows({ device_id: 'alice-tablet' })).toHaveLength(0);
  });

  it('[takeover] a second member registering the token takes it over; the first member\'s row is gone', async () => {
    await call(aliceTok, 'POST', '/notifications/devices', { token: 'shared-phone-tok', platform: 'ios', deviceId: 'alice-old-phone' });

    const taken = await call(bobTok, 'POST', '/notifications/devices', { token: 'shared-phone-tok', platform: 'ios', deviceId: 'bob-phone' });
    expect(taken.status, taken.text).toBe(200);

    const holders = await rows({ token: 'shared-phone-tok' });
    expect(holders).toHaveLength(1);
    expect(String(holders[0].user_id)).toBe(bobId);
    const gone = await call(aliceTok, 'DELETE', '/notifications/devices/alice-old-phone');
    expect(gone.status, gone.text).toBe(404);
    expect(codeOf(gone.body)).toBe('NOT_FOUND');
  });

  it('[invalidate] a dead token keeps its row disabled; the next registration re-enables it', async () => {
    await call(bobTok, 'POST', '/notifications/devices', { token: 'bob-dead-tok', platform: 'android', deviceId: 'bob-tablet' });
    const notification = await stack.kernel.getServiceAsync<any>('notification');
    await notification.invalidateDeviceToken('bob-dead-tok');

    const [dead] = await rows({ device_id: 'bob-tablet' });
    expect(dead.enabled).toBe(false);
    expect(dead.invalidated_at).toBeTruthy();

    const revived = await call(bobTok, 'POST', '/notifications/devices', { token: 'bob-dead-tok', platform: 'android', deviceId: 'bob-tablet' });
    expect(revived.status, revived.text).toBe(200);
    const [after] = await rows({ device_id: 'bob-tablet' });
    expect(after.id).toBe(dead.id);
    expect(after.enabled).toBe(true);
    expect(after.invalidated_at ?? null).toBeNull();
  });

  it('[body] a body outside the schema, and a web registration with no vendor, answer 400 VALIDATION_FAILED', async () => {
    for (const body of [{ platform: 'ios' }, { token: 't', platform: 'blackberry' }, { token: 'web-tok', platform: 'web' }]) {
      const res = await call(aliceTok, 'POST', '/notifications/devices', body);
      expect(res.status, `${JSON.stringify(body)}: ${res.text}`).toBe(400);
      expect(codeOf(res.body)).toBe('VALIDATION_FAILED');
    }
    expect(await rows({ token: 'web-tok' })).toHaveLength(0);
  });

  it('[data-api] the generic data API neither lists, reads nor writes sys_user_device for a member', async () => {
    await call(bobTok, 'POST', '/notifications/devices', { token: 'bob-data-api-tok', platform: 'ios', deviceId: 'bob-data-api' });
    const [own] = await rows({ device_id: 'bob-data-api' });
    expect(own, 'bob holds a device row to aim at').toBeTruthy();
    const attempts = [
      await call(bobTok, 'GET', `/data/${OBJ}`),
      await call(bobTok, 'GET', `/data/${OBJ}/${own.id}`),
      await call(bobTok, 'POST', `/data/${OBJ}`, { user_id: bobId, device_id: 'via-data-api', token: 'via-data-api', vendor: 'apns', platform: 'ios' }),
      await call(bobTok, 'PATCH', `/data/${OBJ}/${own.id}`, { token: 'patched' }),
      await call(bobTok, 'DELETE', `/data/${OBJ}/${own.id}`),
    ];
    // The exposure gate's answer for an object not exposed via the API.
    for (const res of attempts) {
      expect(res.status, res.text).toBe(404);
      expect(codeOf(res.body), res.text).toBe('OBJECT_API_DISABLED');
    }
    expect(await rows({ token: 'via-data-api' })).toHaveLength(0);
    const [still] = await rows({ id: own.id });
    expect(still?.token).toBe(own.token);
  });
});
