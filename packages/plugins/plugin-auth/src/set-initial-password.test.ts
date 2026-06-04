// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { runSetInitialPassword, type SetPasswordCapableApi } from './set-initial-password.js';

function makeRequest(body: unknown): Request {
  return new Request('https://example.test/api/v1/auth/set-initial-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=abc' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Mimic a better-call APIError (`{ statusCode, status, body: { code, message } }`). */
function apiError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, status: code, body: { code, message } });
}

describe('runSetInitialPassword', () => {
  it('rejects a missing newPassword with 400 invalid_request (no API call)', async () => {
    const api: SetPasswordCapableApi = { setPassword: vi.fn() };
    const res = await runSetInitialPassword(api, makeRequest({}));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: 'invalid_request', message: 'newPassword is required' } });
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400', async () => {
    const api: SetPasswordCapableApi = { setPassword: vi.fn() };
    const res = await runSetInitialPassword(api, makeRequest('not-json{'));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('invalid_request');
  });

  it('forwards newPassword + session headers to better-auth and returns 200 on success', async () => {
    const setPassword = vi.fn().mockResolvedValue({ status: true });
    const req = makeRequest({ newPassword: 'super-secret-pw' });
    const res = await runSetInitialPassword({ setPassword }, req);

    expect(res).toEqual({ status: 200, body: { success: true } });
    expect(setPassword).toHaveBeenCalledTimes(1);
    const arg = setPassword.mock.calls[0][0];
    expect(arg.body).toEqual({ newPassword: 'super-secret-pw' });
    // The session cookie must ride along so better-auth's session middleware
    // can identify the caller.
    expect(arg.headers.get('cookie')).toContain('better-auth.session_token');
  });

  it('maps PASSWORD_ALREADY_SET to 409 (use change-password)', async () => {
    const setPassword = vi.fn().mockRejectedValue(
      apiError(400, 'PASSWORD_ALREADY_SET', 'A local password is already set'),
    );
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }));
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'PASSWORD_ALREADY_SET', message: 'A local password is already set' });
  });

  it('preserves length-validation errors (400 PASSWORD_TOO_SHORT)', async () => {
    const setPassword = vi.fn().mockRejectedValue(apiError(400, 'PASSWORD_TOO_SHORT', 'Password is too short'));
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'short' }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('passes through a 401 when no session is present', async () => {
    const setPassword = vi.fn().mockRejectedValue(apiError(401, 'UNAUTHORIZED', 'Sign in first'));
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }));
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
  });

  it('falls back to 500 internal for a plain (non-APIError) throw', async () => {
    const setPassword = vi.fn().mockRejectedValue(new Error('adapter exploded'));
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }));
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'internal', message: 'adapter exploded' });
  });
});
