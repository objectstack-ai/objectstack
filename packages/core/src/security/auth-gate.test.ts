// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { isAuthGateAllowlisted, evaluateAuthGate } from './auth-gate';

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
});
