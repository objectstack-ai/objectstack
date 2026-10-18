// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform-admin judge reads `user.isPlatformAdmin` and `user.role`, which
 * `AuthSessionApi.getSession` declares for it (`@objectstack/spec/contracts`).
 * A field better-auth or `customSession` stops sending reads `undefined`; this
 * pins the direction that `undefined` is judged in: it REFUSES, never admits.
 *
 * Every user below carries an `id`, so the identity refusal (401) is not the
 * answer that hides the authorization one (403).
 */

import { describe, it, expect } from 'vitest';
import { isPlatformAdminUser, judgePlatformAdmin } from './platform-admin-gate.js';

const ID = { id: 'usr_signed_in', email: 'signed-in@example.com' };

const NOT_ADMIN: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['both fields absent', { ...ID }],
  ['both fields `undefined`', { ...ID, isPlatformAdmin: undefined, role: undefined }],
  ['`isPlatformAdmin` absent, `role` null', { ...ID, role: null }],
  ['`isPlatformAdmin` false, `role` absent', { ...ID, isPlatformAdmin: false }],
  // Truthy is not `true`, and a near-miss spelling is not `'admin'`.
  ['`isPlatformAdmin` the string `"true"`', { ...ID, isPlatformAdmin: 'true' }],
  ['`role` `"Admin"`', { ...ID, role: 'Admin' }],
];

describe('isPlatformAdminUser: an absent or `undefined` signal is not a platform admin', () => {
  for (const [label, user] of NOT_ADMIN) {
    it(`${label} → false`, () => {
      expect(isPlatformAdminUser(user)).toBe(false);
    });
  }

  it('the two admitting signals still admit (the control)', () => {
    expect(isPlatformAdminUser({ ...ID, isPlatformAdmin: true })).toBe(true);
    expect(isPlatformAdminUser({ ...ID, role: 'admin' })).toBe(true);
  });
});

describe('judgePlatformAdmin: a signed-in session whose signals read `undefined` is refused 403', () => {
  for (const [label, user] of NOT_ADMIN) {
    it(`${label} → 403 PERMISSION_DENIED`, () => {
      const verdict = judgePlatformAdmin({ user, session: { userId: ID.id } });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.refusal.status).toBe(403);
      expect(verdict.refusal.body.error.code).toBe('PERMISSION_DENIED');
    });
  }

  it('a session with `isPlatformAdmin: true` is admitted (the control)', () => {
    const verdict = judgePlatformAdmin({ user: { ...ID, isPlatformAdmin: true }, session: { userId: ID.id } });
    expect(verdict).toEqual({ ok: true, actor: { id: ID.id, email: ID.email } });
  });
});
