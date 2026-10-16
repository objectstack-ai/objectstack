// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23772] The principal-session mint: its refusals, its TTL, its cookie and
 * its active organization, on a real `AuthManager`. The two lanes' renewal
 * and revoke pins are `principal-session-mint.{cookie,bearer}-lane.pin.test.ts`.
 *
 * Every refusal asserts the envelope (`code` + `status`), AND that nothing
 * was minted: `internalAdapter.createSession` was never called and no
 * `sys_session` row appeared — a refusal after a mint would leave a live
 * credential behind.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { SystemUserId } from '@objectstack/spec/system';
import { PRINCIPAL_SESSION_MAX_TTL_SECONDS, type IAuthService } from '@objectstack/spec/contracts';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { bootMintFixture, expiresAtMs, rawTokenOf, type MintFixture } from './principal-session-mint-test-support';
import { PRINCIPAL_SESSION_TOKEN_PREFIX, holdPrincipalSessionExpiry } from './principal-session-mint';

const SLACK_MS = 5_000;

let fx: MintFixture;
let createSession: ReturnType<typeof vi.spyOn>;

const sessionRows = () => (fx.engine.tables.get('sys_session') ?? []).length;
const userRow = () => (fx.engine.tables.get('sys_user') ?? []).find((r) => r.id === fx.userId)!;

/** The refusal envelope, and the proof nothing was minted. */
async function expectRefused(promise: Promise<unknown>, code: string, status: number) {
  const rows = sessionRows();
  const err: any = await promise.then(
    () => { throw new Error(`expected a ${status} ${code} refusal, the mint succeeded`); },
    (e) => e,
  );
  expect({ code: err?.code, status: err?.status }).toEqual({ code, status });
  expect(createSession, 'a session was minted before the refusal').not.toHaveBeenCalled();
  expect(sessionRows(), 'a session row appeared on a refusal').toBe(rows);
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fx = await bootMintFixture(createMemoryEngine as any);
  const ctx: any = await fx.manager.getAuthContext();
  createSession = vi.spyOn(ctx.internalAdapter, 'createSession');
});

beforeEach(() => createSession.mockClear());

afterAll(() => vi.restoreAllMocks());

describe('[#23772] refusals — before anything is minted', () => {
  it('a context with no user → PERMISSION_DENIED / 403', async () => {
    await expectRefused(fx.manager.mintPrincipalSession(fx.human({ userId: undefined })), 'PERMISSION_DENIED', 403);
  });

  it('a system context → PERMISSION_DENIED / 403', async () => {
    await expectRefused(fx.manager.mintPrincipalSession(fx.human({ isSystem: true })), 'PERMISSION_DENIED', 403);
  });

  for (const kind of ['agent', 'service', 'guest', 'system'] as const) {
    it(`principalKind '${kind}' → PERMISSION_DENIED / 403`, async () => {
      await expectRefused(fx.manager.mintPrincipalSession(fx.human({ principalKind: kind })), 'PERMISSION_DENIED', 403);
    });
  }

  for (const ttlSeconds of [0, -1, PRINCIPAL_SESSION_MAX_TTL_SECONDS + 1, 1.5, Number.NaN]) {
    it(`ttlSeconds ${ttlSeconds} → VALIDATION_ERROR / 400 (refused, never clamped)`, async () => {
      await expectRefused(fx.manager.mintPrincipalSession(fx.human(), { ttlSeconds }), 'VALIDATION_ERROR', 400);
    });
  }

  it('a carried authGate → 403 with the posture code', async () => {
    const held = fx.human({ authGate: { code: 'MFA_REQUIRED', message: 'Enrol a second factor.' } });
    await expectRefused(fx.manager.mintPrincipalSession(held), 'MFA_REQUIRED', 403);
  });

  it('a posture computed now (not carried on the context) → 403 with its code', async () => {
    const live = vi.spyOn(fx.manager, 'resolveUserAuthGates')
      .mockResolvedValueOnce([{ code: 'PASSWORD_EXPIRED', message: 'Change your password.' }] as any);
    await expectRefused(fx.manager.mintPrincipalSession(fx.human({ tenantId: 'org_live' })), 'PASSWORD_EXPIRED', 403);
    expect(live).toHaveBeenCalledWith(fx.userId, { organizationId: 'org_live' });
  });

  it('an unknown user → PERMISSION_DENIED / 403', async () => {
    await expectRefused(fx.manager.mintPrincipalSession(fx.human({ userId: 'usr_absent_23772' })), 'PERMISSION_DENIED', 403);
  });

  it('the system user row and a role=system row → PERMISSION_DENIED / 403 (isHumanUserRow)', async () => {
    const users = fx.engine.tables.get('sys_user')!;
    users.push({ ...userRow(), id: SystemUserId.SYSTEM, email: 'system.23772@example.com', role: 'user' });
    try {
      await expectRefused(fx.manager.mintPrincipalSession(fx.human({ userId: SystemUserId.SYSTEM })), 'PERMISSION_DENIED', 403);
    } finally {
      users.splice(users.findIndex((r) => r.id === SystemUserId.SYSTEM), 1);
    }
    const row = userRow();
    row.role = 'system';
    try {
      await expectRefused(fx.manager.mintPrincipalSession(fx.human()), 'PERMISSION_DENIED', 403);
    } finally {
      row.role = 'user';
    }
  });

  it('a banned user → PERMISSION_DENIED / 403; a lapsed ban mints', async () => {
    const row = userRow();
    row.banned = true;
    try {
      await expectRefused(fx.manager.mintPrincipalSession(fx.human()), 'PERMISSION_DENIED', 403);
      row.ban_expires = new Date(Date.now() - 60_000);
      const minted = await fx.manager.mintPrincipalSession(fx.human());
      await minted.revoke();
    } finally {
      row.banned = false;
      row.ban_expires = null;
    }
  });
});

describe('[#23772] the minted session', () => {
  it("AuthManager's method IS the contract member (a drift fails the test layer's typecheck)", () => {
    const member: Required<IAuthService>['mintPrincipalSession'] = fx.manager.mintPrincipalSession.bind(fx.manager);
    expect(typeof member).toBe('function');
  });

  it('a human principal (principalKind absent or human) mints, branded, impersonatedBy unset', async () => {
    for (const ctx of [fx.human(), fx.human({ principalKind: 'human' })]) {
      const minted = await fx.manager.mintPrincipalSession(ctx);
      const row = fx.row(rawTokenOf(minted))!;
      expect(row.user_id).toBe(fx.userId);
      expect(String(row.token).startsWith(PRINCIPAL_SESSION_TOKEN_PREFIX)).toBe(true);
      expect(row.impersonated_by ?? null).toBeNull();
      await minted.revoke();
    }
  });

  it('TTL: the ceiling by default, a shorter ask honoured', async () => {
    const byDefault = await fx.manager.mintPrincipalSession(fx.human());
    expect(Math.abs(expiresAtMs(fx.row(rawTokenOf(byDefault))) - (Date.now() + PRINCIPAL_SESSION_MAX_TTL_SECONDS * 1000)))
      .toBeLessThan(SLACK_MS);
    await byDefault.revoke();

    const short = await fx.manager.mintPrincipalSession(fx.human(), { ttlSeconds: 30 });
    expect(Math.abs(new Date(short.expiresAt).getTime() - (Date.now() + 30_000))).toBeLessThan(SLACK_MS);
    await short.revoke();
  });

  it("carries the context's tenantId as the session's active organization", async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human({ tenantId: 'org_23772' }));
    expect(fx.row(rawTokenOf(minted))!.active_organization_id).toBe('org_23772');
    await minted.revoke();
  });

  it('the cookie is the plugin session cookie: better-auth.session_token, not Secure on http', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    expect(minted.cookie).toMatchObject({ name: 'better-auth.session_token', path: '/', httpOnly: true, secure: false });
    expect(minted.cookie.value).toBe(minted.token);
    await minted.revoke();
  });
});

describe('[#23772] cookie names under cookiePrefix and __Secure-', () => {
  it('a prefixed secure deployment names the cookie __Secure-PREFIX.session_token, and it authenticates', async () => {
    const secure = await bootMintFixture(createMemoryEngine as any, {
      origin: 'https://app.example.com',
      advanced: { cookiePrefix: 'acme', useSecureCookies: true },
    });
    const minted = await secure.manager.mintPrincipalSession(secure.human());
    expect(minted.cookie).toMatchObject({ name: '__Secure-acme.session_token', secure: true, httpOnly: true });

    const res = await secure.getSession({ cookie: `${minted.cookie.name}=${minted.cookie.value}` });
    expect(res.body?.user?.id).toBe(secure.userId);
    await minted.revoke();
  });
});

describe('[#23772] holdPrincipalSessionExpiry — the renewal guard itself', () => {
  const ceiling = new Date(Date.now() + 60_000);
  const minted = { context: { session: { session: { token: `${PRINCIPAL_SESSION_TOKEN_PREFIX}x`, expiresAt: ceiling } } } };
  const plain = { context: { session: { session: { token: 'plain', expiresAt: ceiling } } } };
  const renewal = { expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() };

  it('pins a raised expiry of a minted session back to its own', () => {
    expect(holdPrincipalSessionExpiry(renewal, minted)?.expiresAt).toEqual(ceiling);
  });

  it('leaves alone any other session, an update without expiresAt, and a lowered expiry (a revocation)', () => {
    expect(holdPrincipalSessionExpiry(renewal, plain)).toBeUndefined();
    expect(holdPrincipalSessionExpiry({ activeOrganizationId: 'o' }, minted)).toBeUndefined();
    expect(holdPrincipalSessionExpiry({ expiresAt: new Date(Date.now() - 1000) }, minted)).toBeUndefined();
    expect(holdPrincipalSessionExpiry(renewal, undefined)).toBeUndefined();
  });
});
