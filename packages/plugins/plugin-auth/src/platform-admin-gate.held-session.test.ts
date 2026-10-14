// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D3 on the platform-admin judge: a held session is refused with the
 * gate's own code, between the identity refusal and the authorization one.
 *
 * The posture is the `authGate` that `customSession` stamps on the session
 * user; the decision is core's shared `evaluateAuthGate`, consulted pathless
 * (see the header of `platform-admin-gate.ts`). The booted half of this pin,
 * a real held session against a real mount, lives in `@objectstack/verify`
 * (`held-session-platform-admin.pin.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { judgePlatformAdmin } from './platform-admin-gate.js';

const ADMIN = { id: 'usr_admin', email: 'admin@example.com', isPlatformAdmin: true, role: 'user' };
const MEMBER = { id: 'usr_member', positions: ['user'], role: 'user' };

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };
const MFA_REQUIRED = { code: 'MFA_REQUIRED', message: 'Set up an authenticator app.' };

describe('judgePlatformAdmin: a held session (ADR-0069 D3)', () => {
  for (const gate of [PASSWORD_EXPIRED, MFA_REQUIRED]) {
    it(`refuses a held platform admin 403 ${gate.code}, in the judge's envelope`, () => {
      const verdict = judgePlatformAdmin({ user: { ...ADMIN, authGate: gate } });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal.status).toBe(403);
      expect(verdict.refusal.body).toEqual({
        success: false,
        error: { code: gate.code, message: gate.message },
      });
    });

    it(`answers a held non-admin with the posture (${gate.code}), not PERMISSION_DENIED`, () => {
      const verdict = judgePlatformAdmin({ user: { ...MEMBER, authGate: gate } });
      expect(verdict.ok).toBe(false);
      expect(!verdict.ok && verdict.refusal.status).toBe(403);
      expect(!verdict.ok && verdict.refusal.body.error.code).toBe(gate.code);
    });
  }

  it('takes the normalized posture: a code with no message still refuses with a message', () => {
    // The shared decision normalizes the posture; the judge does not re-derive it.
    const verdict = judgePlatformAdmin({ user: { ...ADMIN, authGate: { code: 'MFA_REQUIRED' } } });
    expect(!verdict.ok && verdict.refusal.body.error.code).toBe('MFA_REQUIRED');
    const message = !verdict.ok ? verdict.refusal.body.error.message : '';
    expect(typeof message === 'string' && message.length > 0).toBe(true);
  });

  it('keeps identity first: an anonymous caller is still 401 UNAUTHENTICATED', () => {
    const verdict = judgePlatformAdmin({ user: { authGate: MFA_REQUIRED } });
    expect(!verdict.ok && verdict.refusal.status).toBe(401);
    expect(!verdict.ok && verdict.refusal.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('admits an unheld platform admin unchanged (control)', () => {
    const verdict = judgePlatformAdmin({ user: ADMIN });
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.actor).toEqual({ id: 'usr_admin', email: 'admin@example.com' });
  });

  it('reads a posture without a string code as no posture (control)', () => {
    // `normalizeAuthGate`: a gate naming no string `code` is not a gate.
    expect(judgePlatformAdmin({ user: { ...ADMIN, authGate: { code: 7 } } }).ok).toBe(true);
  });
});
