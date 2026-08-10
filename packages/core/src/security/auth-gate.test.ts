// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { isAuthGateAllowlisted, evaluateAuthGate, normalizeAuthGate } from './auth-gate';

describe('auth-gate (ADR-0069 session gate)', () => {
  describe('isAuthGateAllowlisted', () => {
    it('allows auth + remediation + health paths (both REST and dispatcher shapes)', () => {
      for (const p of [
        '/api/v1/auth/change-password',
        '/api/v1/auth/two-factor/enable',
        '/api/v1/auth/sign-out',
        '/auth/sign-out',
        '/api/v1/health',
        '/api/v1/discovery',
        '/api/v1/me/apps',
        '/api/v1/auth/me/localization',
      ]) {
        expect(isAuthGateAllowlisted(p)).toBe(true);
      }
    });
    it('blocks data / meta / settings paths', () => {
      for (const p of ['/api/v1/data/sys_user', '/api/v1/meta/object/foo', '/api/settings/auth', '/api/v1/ai/chat']) {
        expect(isAuthGateAllowlisted(p)).toBe(false);
      }
    });
    it('strips query and trailing slash', () => {
      expect(isAuthGateAllowlisted('/api/v1/auth/sign-out/?x=1')).toBe(true);
      expect(isAuthGateAllowlisted('/api/v1/data/x/')).toBe(false);
    });
  });

  describe('evaluateAuthGate', () => {
    it('returns null when the user carries no authGate', () => {
      expect(evaluateAuthGate({ id: 'u1' }, '/api/v1/data/x')).toBeNull();
    });
    it('returns null on an allow-listed path even when gated', () => {
      const u = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'm' } };
      expect(evaluateAuthGate(u, '/api/v1/auth/change-password')).toBeNull();
    });
    it('returns the gate on a blocked path', () => {
      const u = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } };
      expect(evaluateAuthGate(u, '/api/v1/data/sys_user')).toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
    });
    it('falls back to a generic message when none provided', () => {
      const u = { authGate: { code: 'MFA_REQUIRED' } };
      const g = evaluateAuthGate(u, '/api/v1/data/x');
      expect(g?.code).toBe('MFA_REQUIRED');
      expect(typeof g?.message).toBe('string');
    });
  });

  // #7280 — `ExecutionContext.authGate` is now DECLARED (`{ code, message }`,
  // both required), and the session user it is lifted from crosses an external
  // boundary as `any`. This is the one place that turns the loose thing into
  // the declared thing, for BOTH consumers: `evaluateAuthGate` (the seams that
  // decide per path) and REST's `computeExecCtx` (the seam that puts the
  // posture on the envelope). A test here is what stops the two from
  // re-deriving it differently.
  describe('normalizeAuthGate (#7280)', () => {
    it('returns null for a user with no gate, and for no user at all', () => {
      expect(normalizeAuthGate({ id: 'u1' })).toBeNull();
      expect(normalizeAuthGate(undefined)).toBeNull();
      expect(normalizeAuthGate(null)).toBeNull();
    });

    it('returns null when the gate names no string code — that is not a gate', () => {
      expect(normalizeAuthGate({ authGate: {} })).toBeNull();
      expect(normalizeAuthGate({ authGate: { code: 403 } })).toBeNull();
    });

    it('passes a well-formed gate through verbatim', () => {
      expect(normalizeAuthGate({ authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } }))
        .toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
    });

    it('fills a missing or blank message, so the declared shape is always met', () => {
      // Without this the envelope would carry `message: undefined` into a 403
      // body — the loose shape the declaration exists to rule out.
      for (const gate of [{ code: 'MFA_REQUIRED' }, { code: 'MFA_REQUIRED', message: '' }]) {
        const g = normalizeAuthGate({ authGate: gate });
        expect(g?.code).toBe('MFA_REQUIRED');
        expect(typeof g?.message).toBe('string');
        expect(g?.message.length).toBeGreaterThan(0);
      }
    });

    it('drops any key the declaration does not name', () => {
      const g = normalizeAuthGate({
        authGate: { code: 'PASSWORD_EXPIRED', message: 'm', redirectTo: '/change-password' },
      });
      expect(Object.keys(g ?? {}).sort()).toEqual(['code', 'message']);
    });
  });
});
