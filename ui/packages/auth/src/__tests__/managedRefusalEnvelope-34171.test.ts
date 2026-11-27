/**
 * objectstack#34171 — the ADR-0112 envelope's code survives the client boundary.
 *
 * A cloud-managed runtime refuses the password doors with 409
 * `RESOURCE_CONFLICT` in the platform envelope, `{ success: false, error: {
 * code, message } }` (plugin-auth `cloudManagedRefusal`, and the hosted relay
 * in front of it), not in better-auth's flat `{ code, message }`. better-fetch
 * spreads that body under `error.error`, and `toAuthError` read only the top
 * level, so every door rejected with `Auth request failed with status 409` and
 * no code: no host map could localize it. This drives the REAL client over a
 * mocked `fetch`, like `authErrorStatus-33650.test.ts` next door.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

const MANAGED = 'This environment is cloud-managed: no local password is set or reset here.';
const ENVELOPE = { success: false, error: { code: 'RESOURCE_CONFLICT', message: MANAGED } };

function answering(pathFragment: string, status: number, body: unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const hit = url.includes(pathFragment);
    return new Response(JSON.stringify(hit ? body : {}), {
      status: hit ? status : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

type Rejection = Error & { code?: string; status?: number; details?: Record<string, unknown>; userMessage?: string };

async function rejectionOf(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
  } catch (err) {
    return err as Rejection;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function clientFor(pathFragment: string, status: number, body: unknown) {
  const fetchFn = answering(pathFragment, status, body);
  return createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: fetchFn as unknown as typeof fetch });
}

describe('#34171 — an ADR-0112 envelope refusal keeps its code on every password door', () => {
  const doors: Array<[string, string, (c: ReturnType<typeof createAuthClient>) => Promise<unknown>]> = [
    ['signIn', '/sign-in/email', (c) => c.signIn({ email: 'a@example.com', password: 'pw' })],
    ['forgotPassword', '/request-password-reset', (c) => c.forgotPassword('a@example.com')],
    ['resetPassword', '/reset-password', (c) => c.resetPassword('tok', 'new-password-1')],
    ['setInitialPassword', '/set-initial-password', (c) => c.setInitialPassword('new-password-1')],
  ];

  it.each(doors)('%s: code RESOURCE_CONFLICT, the envelope message, status 409', async (_name, path, call) => {
    const err = await rejectionOf(call(clientFor(path, 409, ENVELOPE)));
    expect(err.code).toBe('RESOURCE_CONFLICT');
    expect(err.status).toBe(409);
    expect(err.message).toBe(MANAGED);
  });

  it('carries the envelope\'s details and userMessage too', async () => {
    const body = {
      success: false,
      error: { code: 'RESOURCE_CONFLICT', message: MANAGED, details: { door: 'signIn' }, userMessage: 'Shown text.' },
    };
    const err = await rejectionOf(clientFor('/sign-in/email', 409, body).signIn({ email: 'a@example.com', password: 'pw' }));
    expect(err.details).toEqual({ door: 'signIn' });
    expect(err.userMessage).toBe('Shown text.');
  });

  it('CONTROL: better-auth\'s flat refusal answers exactly as before', async () => {
    const err = await rejectionOf(
      clientFor('/sign-in/email', 401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' })
        .signIn({ email: 'a@example.com', password: 'pw' }),
    );
    expect(err.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(err.message).toBe('Invalid email or password');
    expect(err.status).toBe(401);
  });

  it('CONTROL: the flat body wins where both name a code or a message', async () => {
    const body = { code: 'FLAT_CODE', message: 'Flat message', error: { code: 'NESTED_CODE', message: 'Nested message' } };
    const err = await rejectionOf(clientFor('/sign-in/email', 400, body).signIn({ email: 'a@example.com', password: 'pw' }));
    expect(err.code).toBe('FLAT_CODE');
    expect(err.message).toBe('Flat message');
  });

  it('CONTROL: a body with neither keeps the status line and no code', async () => {
    const err = await rejectionOf(clientFor('/sign-in/email', 500, {}).signIn({ email: 'a@example.com', password: 'pw' }));
    expect(err.code).toBeUndefined();
    expect(err.message).toBe('Auth request failed with status 500');
  });
});
