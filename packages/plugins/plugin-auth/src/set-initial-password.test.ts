// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
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
    expect(res.body).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: 'newPassword is required' } });
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  // [#24032] This row asserted only 400 + INVALID_REQUEST, which the old
  // `parsed = {}` swallow also answered ("newPassword is required"), so it
  // could not tell a refused body from one read as empty. It now pins the
  // refusal itself, and the undeclared spelling, which is still no body.
  it('refuses a declared-JSON body that does not parse, before setPassword', async () => {
    const api: SetPasswordCapableApi = { setPassword: vi.fn() };
    const res = await runSetInitialPassword(api, makeRequest('not-json{'));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(res.body.error?.message.startsWith('The request body could not be parsed as JSON')).toBe(true);
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  it('a body that does not declare JSON and does not parse is still no body', async () => {
    const api: SetPasswordCapableApi = { setPassword: vi.fn() };
    const req = new Request('https://example.test/api/v1/auth/set-initial-password', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: 'better-auth.session_token=abc' },
      body: 'not-json{',
    });
    const res = await runSetInitialPassword(api, req);
    expect(res.body).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: 'newPassword is required' } });
    expect(api.setPassword).not.toHaveBeenCalled();
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

});

describe('an unclassified internal failure is answered with the generic message and logged once', () => {
  const MARKER = 'unclassified-failure-marker-5b1e';

  it('a throw with no vendor code answers 500 INTERNAL_ERROR in the generic words, and the logger receives the error once', async () => {
    const thrown = new Error(`adapter exploded ${MARKER}`);
    const setPassword = vi.fn().mockRejectedValue(thrown);
    const logger = { error: vi.fn() };
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }), { logger });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE } });
    expect(JSON.stringify(res)).not.toContain(MARKER);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('[AuthPlugin] set-initial-password failed', thrown);
  });

  it('a thrown non-Error is answered the same way, and reaches the logger as an Error', async () => {
    const setPassword = vi.fn().mockRejectedValue(MARKER);
    const logger = { error: vi.fn() };
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }), { logger });
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE });
    expect(JSON.stringify(res)).not.toContain(MARKER);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('CONTROL: a refusal the vendor classifies keeps its own message, code and status, and is not logged', async () => {
    const setPassword = vi.fn().mockRejectedValue(apiError(400, 'PASSWORD_TOO_SHORT', 'Password is too short'));
    const logger = { error: vi.fn() };
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'short' }), { logger });
    expect(res).toEqual({
      status: 400,
      body: { success: false, error: { code: 'PASSWORD_TOO_SHORT', message: 'Password is too short' } },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('CONTROL: a throw whose status addresses the caller (4xx) keeps its own answer, and is not logged', async () => {
    const setPassword = vi.fn().mockRejectedValue(Object.assign(new Error('Sign in first'), { statusCode: 401 }));
    const logger = { error: vi.fn() };
    const res = await runSetInitialPassword({ setPassword }, makeRequest({ newPassword: 'x'.repeat(12) }), { logger });
    expect(res).toEqual({ status: 401, body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'Sign in first' } } });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
