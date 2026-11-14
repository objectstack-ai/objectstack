// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared SSO-only judge and the reset-door reader (`sso-only-local-password.ts`).
 *
 * The doors are pinned end to end where their harnesses live: the set doors in
 * `cloud-managed.test.ts`, the reset doors in
 * `password-reset-ends-sessions.test.ts`. This file pins the two pieces those
 * doors share: the verdict table of `judgeSsoOnlyLocalPassword` (including the
 * fail-closed answer for a source that cannot be read), and that
 * `resolveResetDoorUserId` names a user only for a credential the door itself
 * would accept.
 */

import { describe, it, expect } from 'vitest';
import {
  judgeSsoOnlyLocalPassword,
  resolveResetDoorUserId,
  ssoOnlyPasswordRefusal,
  SSO_ONLY_REFUSAL_CODE,
  SSO_ONLY_REFUSAL_MESSAGES,
  SSO_ONLY_REFUSAL_STATUS,
  type ResetDoorContext,
} from './sso-only-local-password';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_STATUS } from './cloud-managed';

const engineWith = (source: string | null) => ({
  find: async () => [{ id: 'u1', source }],
});

describe('judgeSsoOnlyLocalPassword', () => {
  it('allows every user while SSO-only mode is off, and reads nothing', async () => {
    let reads = 0;
    const engine = { find: async () => { reads += 1; return [{ id: 'u1', source: 'idp_provisioned' }]; } };
    const verdict = await judgeSsoOnlyLocalPassword({ ssoOnly: false, engine, userId: 'u1', selfPlatformAdmin: () => false });
    expect(verdict).toBe('allow');
    expect(reads).toBe(0);
  });

  it('refuses an idp_provisioned user, allows the platform administrator setting their own', async () => {
    const base = { ssoOnly: true, engine: engineWith('idp_provisioned'), userId: 'u1' };
    expect(await judgeSsoOnlyLocalPassword({ ...base, selfPlatformAdmin: () => false })).toBe('refuse');
    expect(await judgeSsoOnlyLocalPassword({ ...base, selfPlatformAdmin: async () => true })).toBe('allow');
  });

  it('allows an environment-native user and a row with no source, and asks no standing for them', async () => {
    for (const source of ['env_native', null]) {
      let asked = 0;
      const verdict = await judgeSsoOnlyLocalPassword({
        ssoOnly: true,
        engine: engineWith(source),
        userId: 'u1',
        selfPlatformAdmin: () => { asked += 1; return false; },
      });
      expect({ source, verdict, asked }).toEqual({ source, verdict: 'allow', asked: 0 });
    }
  });

  it('fails closed when the source cannot be read: no engine, no read surface, or a read that throws', async () => {
    const throwing = { find: async () => { throw new Error('down'); } };
    for (const engine of [undefined, {}, throwing]) {
      expect(await judgeSsoOnlyLocalPassword({ ssoOnly: true, engine, userId: 'u1', selfPlatformAdmin: () => true }))
        .toBe('unreadable');
    }
  });
});

describe('ssoOnlyPasswordRefusal', () => {
  it('carries the cloud-managed refusals\' code and status', () => {
    expect(SSO_ONLY_REFUSAL_CODE).toBe(CLOUD_MANAGED_REFUSAL_CODE);
    expect(SSO_ONLY_REFUSAL_STATUS).toBe(CLOUD_MANAGED_REFUSAL_STATUS);
  });

  it('answers the registered RESOURCE_CONFLICT with status 409 and the door sentence', () => {
    for (const door of Object.keys(SSO_ONLY_REFUSAL_MESSAGES) as Array<keyof typeof SSO_ONLY_REFUSAL_MESSAGES>) {
      expect(ssoOnlyPasswordRefusal(door)).toEqual({
        status: 409,
        body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: SSO_ONLY_REFUSAL_MESSAGES[door] } },
      });
      expect(SSO_ONLY_REFUSAL_MESSAGES[door]).toMatch(/^This environment is in SSO-only mode/);
    }
  });
});

describe('resolveResetDoorUserId', () => {
  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 60_000);

  const ctxFor = (
    path: string,
    body: Record<string, unknown>,
    rows: Record<string, { value: string; expiresAt: Date }>,
    users: Record<string, string> = {},
  ): ResetDoorContext => ({
    path,
    body,
    context: {
      internalAdapter: { findVerificationValue: async (identifier) => rows[identifier] ?? null },
      adapter: {
        findOne: async ({ where }) => {
          const phone = String(where[0]?.value ?? '');
          return users[phone] ? { id: users[phone] } : null;
        },
      },
    },
  });

  const user = (userId: string) => ({ ok: true, userId });
  const nobody = { ok: true, userId: undefined };
  const unreadable = { ok: false };

  it('names the user of a live emailed token, and nobody for an expired or unknown one', async () => {
    const live = ctxFor('/reset-password', { token: 't1' }, { 'reset-password:t1': { value: 'u1', expiresAt: future() } });
    expect(await resolveResetDoorUserId(live, 3)).toEqual(user('u1'));
    const expired = ctxFor('/reset-password', { token: 't1' }, { 'reset-password:t1': { value: 'u1', expiresAt: past() } });
    expect(await resolveResetDoorUserId(expired, 3)).toEqual(nobody);
    const unknown = ctxFor('/reset-password', { token: 't2' }, { 'reset-password:t1': { value: 'u1', expiresAt: future() } });
    expect(await resolveResetDoorUserId(unknown, 3)).toEqual(nobody);
  });

  it('names the user of a matching texted code inside its budget, and nobody otherwise', async () => {
    const id = '+15550100-request-password-reset';
    const users = { '+15550100': 'u2' };
    const at = (value: string, expiresAt = future()) =>
      ctxFor('/phone-number/reset-password', { phoneNumber: '+15550100', otp: '123456' }, { [id]: { value, expiresAt } }, users);
    expect(await resolveResetDoorUserId(at('123456:0'), 3)).toEqual(user('u2'));
    expect(await resolveResetDoorUserId(at('123456:2'), 3)).toEqual(user('u2'));
    expect(await resolveResetDoorUserId(at('654321:0'), 3)).toEqual(nobody);
    expect(await resolveResetDoorUserId(at('123456:3'), 3)).toEqual(nobody);
    expect(await resolveResetDoorUserId(at('123456:0', past()), 3)).toEqual(nobody);
  });

  it('names nobody on any other path, and reads nothing there', async () => {
    let reads = 0;
    const counting: ResetDoorContext = {
      path: '/change-password',
      body: { token: 't1' },
      context: { internalAdapter: { findVerificationValue: async () => { reads += 1; return null; } } },
    };
    expect(await resolveResetDoorUserId(counting, 3)).toEqual(nobody);
    expect(reads).toBe(0);
  });

  it('answers unreadable when a reset record cannot be read: no read surface, or a read that throws', async () => {
    const down = async () => { throw new Error('down'); };
    const cases: ResetDoorContext[] = [
      { path: '/reset-password', body: { token: 't1' }, context: {} },
      { path: '/reset-password', body: { token: 't1' }, context: { internalAdapter: { findVerificationValue: down } } },
      {
        path: '/phone-number/reset-password',
        body: { phoneNumber: '+15550100', otp: '123456' },
        context: { internalAdapter: { findVerificationValue: down } },
      },
      {
        path: '/phone-number/reset-password',
        body: { phoneNumber: '+15550100', otp: '123456' },
        context: {
          internalAdapter: { findVerificationValue: async () => ({ value: '123456:0', expiresAt: future() }) },
          adapter: { findOne: down },
        },
      },
    ];
    for (const ctx of cases) expect(await resolveResetDoorUserId(ctx, 3)).toEqual(unreadable);
  });
});
