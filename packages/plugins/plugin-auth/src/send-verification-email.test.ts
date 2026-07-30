// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { runResendVerificationEmail } from './send-verification-email.js';

const SEND_URL = 'https://example.test/api/v1/auth/send-verification-email';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(SEND_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * A fake better-auth universal handler. Answers `/get-session` from
 * `sessionEmail` (null → unauthenticated 401) and records every
 * `/send-verification-email` re-dispatch in `sent`.
 */
function makeHandle(opts: { sessionEmail?: string | null; sendStatus?: number; sendBody?: unknown }) {
  const sent: Array<{ url: string; body: any }> = [];
  const handle = vi.fn(async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/get-session')) {
      if (opts.sessionEmail == null) {
        return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ user: { email: opts.sessionEmail } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/send-verification-email')) {
      const body = await req.json().catch(() => ({}));
      sent.push({ url: req.url, body });
      return new Response(JSON.stringify(opts.sendBody ?? { status: true }), {
        status: opts.sendStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { handle, sent };
}

describe('runResendVerificationEmail', () => {
  it('defaults the address to the session email when the body omits it (one-click resend)', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: 'me@example.test' });
    const req = makeRequest({}, { cookie: 'better-auth.session_token=abc' });

    const res = await runResendVerificationEmail(handle, req);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ email: 'me@example.test' });
    // The session cookie must ride along on the /get-session lookup.
    const sessionCall = handle.mock.calls.find(([r]) => new URL((r as Request).url).pathname.endsWith('/get-session'));
    expect((sessionCall![0] as Request).headers.get('cookie')).toContain('better-auth.session_token');
  });

  it('passes an explicitly-supplied email straight through (no session lookup)', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: 'me@example.test' });
    const res = await runResendVerificationEmail(handle, makeRequest({ email: 'other@example.test' }));

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ email: 'other@example.test' });
    // No /get-session round-trip when the email is already provided.
    const sessionCalls = handle.mock.calls.filter(([r]) => new URL((r as Request).url).pathname.endsWith('/get-session'));
    expect(sessionCalls).toHaveLength(0);
  });

  it('forwards an explicit callbackURL alongside the email', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: null });
    await runResendVerificationEmail(handle, makeRequest({ email: 'a@b.test', callbackURL: '/welcome' }));
    expect(sent[0].body).toEqual({ email: 'a@b.test', callbackURL: '/welcome' });
  });

  it('returns 400 when the body has no email and there is no session', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: null });
    const res = await runResendVerificationEmail(handle, makeRequest({}));

    expect(res.status).toBe(400);
    expect((res.body as any).error?.code).toBe('INVALID_REQUEST');
    // Never re-dispatched — nothing to send to.
    expect(sent).toHaveLength(0);
  });

  it('tolerates a non-JSON body and falls back to the session email', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: 'me@example.test' });
    const res = await runResendVerificationEmail(handle, makeRequest('not-json{'));
    expect(res.status).toBe(200);
    expect(sent[0].body).toEqual({ email: 'me@example.test' });
  });

  it('passes through the native error status/body on failure', async () => {
    const { handle } = makeHandle({
      sessionEmail: 'me@example.test',
      sendStatus: 429,
      sendBody: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });
    const res = await runResendVerificationEmail(handle, makeRequest({}));
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' });
  });

  it('ignores a blank email string and defaults to the session', async () => {
    const { handle, sent } = makeHandle({ sessionEmail: 'me@example.test' });
    await runResendVerificationEmail(handle, makeRequest({ email: '   ' }));
    expect(sent[0].body).toEqual({ email: 'me@example.test' });
  });
});
