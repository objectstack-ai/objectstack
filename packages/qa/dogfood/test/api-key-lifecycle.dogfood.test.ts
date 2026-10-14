// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A] The API-key lifecycle policy, end to end on the showcase
 * stack: the real engine, the real settings service, the real doors.
 *
 * What a unit double cannot prove, and this does:
 *  - the policy's landing is RECORDED in the `auth` settings on boot
 *    (`api_key_policy_started_at`), so the anchor survives a restart;
 *  - a signing with no `expires_at` gets the 90-day default, and one past the
 *    one-year ceiling is refused `400 API_KEY_EXPIRY_TOO_LONG`;
 *  - one admitted call really WRITES `last_used_at` through the real engine —
 *    the column is readonly and identity-managed, and the stamp's system write
 *    must land anyway;
 *  - a key that existed with no expiry gets its grace stamped onto
 *    `expires_at` (the landing plus 365 days) the first time it is used.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { hashApiKey } from '@objectstack/core';
import { bootShowcase } from './showcase-boot.js';

const DAY = 86_400_000;

describe('#23367: the API-key lifecycle policy on a real stack', () => {
  let stack: VerifyStack;
  let token: string;

  const readKey = async (id: string) => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    return body.record ?? body.data ?? {};
  };

  beforeAll(async () => {
    stack = await bootShowcase({});
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('records when the policy took effect, once, in the auth settings', async () => {
    const settings = await stack.kernel.getServiceAsync<any>('settings');
    const started = await settings.get('auth', 'api_key_policy_started_at', {});
    expect(started.source).not.toBe('default');
    expect(Number.isNaN(Date.parse(String(started.value)))).toBe(false);
  });

  it('signs with the 90-day default, refuses a date past the ceiling, and stamps the first use', async () => {
    const before = Date.now();
    const minted = await stack.apiAs(token, 'POST', '/keys', { name: 'lifecycle-default' });
    expect(minted.status).toBe(201);
    const data: any = (await minted.json()).data;
    const expiresMs = Date.parse(String(data.expires_at));
    expect(expiresMs).toBeGreaterThanOrEqual(before + 90 * DAY - 60_000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 90 * DAY + 60_000);

    const tooFar = await stack.apiAs(token, 'POST', '/keys', {
      name: 'lifecycle-too-far',
      expires_at: new Date(Date.now() + 400 * DAY).toISOString(),
    });
    expect(tooFar.status).toBe(400);
    expect(((await tooFar.json()) as any)?.error?.code).toBe('API_KEY_EXPIRY_TOO_LONG');

    expect((await readKey(String(data.id))).last_used_at ?? null).toBeNull();
    const used = await stack.api('/data/sys_api_key', { headers: { 'x-api-key': String(data.key) } });
    expect(used.status).toBe(200);
    const stamped = await readKey(String(data.id));
    expect(Number.isNaN(Date.parse(String(stamped.last_used_at)))).toBe(false);
  });

  it('gives a key that existed with no expiry its grace, stamped on first use', async () => {
    const settings = await stack.kernel.getServiceAsync<any>('settings');
    const startedAt = Date.parse(String((await settings.get('auth', 'api_key_policy_started_at', {})).value));

    // A key from before the policy: inserted the way a pre-policy mint left it,
    // with no `expires_at`, owned by the signed-in admin.
    const probe = await stack.apiAs(token, 'POST', '/keys', { name: 'lifecycle-owner-probe' });
    expect(probe.status).toBe(201);
    const userId = String((await readKey(String(((await probe.json()) as any).data.id))).user_id);
    const raw = 'osk_lifecycle_legacy_key_dogfood';
    const engine = await stack.kernel.getServiceAsync<any>('objectql');
    const inserted: any = await engine.insert('sys_api_key', {
      name: 'legacy', key: hashApiKey(raw), prefix: raw.slice(0, 12), user_id: userId, revoked: false,
    }, { context: { isSystem: true } });
    const id = String(inserted?.id ?? inserted?.[0]?.id);

    const used = await stack.api('/data/sys_api_key', { headers: { 'x-api-key': raw } });
    expect(used.status).toBe(200);
    const row = await readKey(id);
    // The grace is the landing plus a year, wherever the key was first seen.
    expect(Math.abs(Date.parse(String(row.expires_at)) - (startedAt + 365 * DAY))).toBeLessThan(1000);
  });
});
