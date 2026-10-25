/**
 * objectui#12365 — `PASSWORD_RESET_REQUIRED` is an auth-policy gate.
 *
 * The backend answers an administrator-forced password change with
 * `403 { error: { code: 'PASSWORD_RESET_REQUIRED' } }`, distinct from natural
 * expiry (objectstack#23287 ruling C′). The authenticated fetch wrapper must
 * raise the remediation event for it exactly as it does for
 * `PASSWORD_EXPIRED`, or a force-reset user is left on raw 403s with no
 * overlay. A `.test.tsx` so it runs under happy-dom, like
 * `createAuthenticatedFetch.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAuthenticatedFetch } from '../createAuthenticatedFetch';
import { TokenStorage } from '../createAuthClient';
import { authGateEvents, detectAuthGate, type AuthGateInfo } from '../auth-gate-events';

const API_URL = 'http://localhost/api/v1/data/account';

function gateBody(code: string, message = 'You must change your password before continuing.') {
  return { error: { code, message } };
}

describe('PASSWORD_RESET_REQUIRED auth gate (objectui#12365)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a 403 PASSWORD_RESET_REQUIRED API response raises the remediation event', async () => {
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(gateBody('PASSWORD_RESET_REQUIRED')), { status: 403 })));
    const seen: AuthGateInfo[] = [];
    const unsubscribe = authGateEvents.subscribe((g) => seen.push(g));
    try {
      const response = await createAuthenticatedFetch()(API_URL);
      expect(response.status).toBe(403);
    } finally {
      unsubscribe();
    }
    expect(seen).toEqual([
      { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' },
    ]);
  });

  it('detectAuthGate recognises all three remediation codes, and nothing else', () => {
    for (const code of ['MFA_REQUIRED', 'PASSWORD_EXPIRED', 'PASSWORD_RESET_REQUIRED']) {
      expect(detectAuthGate(403, gateBody(code, 'm'))).toEqual({ code, message: 'm' });
    }
    // An ordinary permission denial is not a gate.
    expect(detectAuthGate(403, gateBody('PERMISSION_DENIED'))).toBeNull();
    // The code only counts on a 403.
    expect(detectAuthGate(401, gateBody('PASSWORD_RESET_REQUIRED'))).toBeNull();
  });
});
