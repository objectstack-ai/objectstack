/**
 * objectui#10893 — a registration started from an invitation link must carry
 * the invitation into the verification mail.
 *
 * better-auth builds the mail's link server-side as
 * `…/verify-email?token=…&callbackURL=VALUE`, taking VALUE from the
 * `/sign-up/email` request body and defaulting it to `/`. The register page
 * kept `?redirect=/accept-invitation/ID` all the way to the "check your inbox"
 * screen, but nothing put it in the body, so the invitee verified, landed on
 * `/`, and was offered "Create workspace" instead of the invitation.
 *
 * This pins the whole in-package seam on the WIRE, not on a mock of the next
 * hop: `RegisterForm` → `useAuth().signUp` → `AuthProvider` → the real
 * `createAuthClient` → the better-auth client → the request body. A mocked
 * `client.signUp` would pass with any one of those links dropping the value.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { RegisterForm } from '../RegisterForm';
import { createAuthClient } from '../createAuthClient';

/** Answers `/sign-up/email` as a verification-gated server does (token null). */
function verificationGatedServer() {
  const signUpBodies: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-up/email')) {
      signUpBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ user: { id: 'u_new', name: 'Invitee', email: 'invitee@example.com' }, token: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // No session, no config — the provider settles as signed-out.
    return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetchFn, signUpBodies };
}

async function register(ui: React.ReactElement, fetchFn: typeof fetch) {
  const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn });
  render(
    <AuthProvider authUrl="http://localhost/api/v1/auth" client={client}>
      {ui}
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Invitee' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invitee@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'hunter2hunter2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
}

describe('RegisterForm → sign-up wire: the verification callback (objectui#10893)', () => {
  it('puts verificationCallbackURL on the /sign-up/email body as callbackURL', async () => {
    const { fetchFn, signUpBodies } = verificationGatedServer();
    const onVerificationRequired = vi.fn();

    await register(
      <RegisterForm
        verificationCallbackURL="/_console/accept-invitation/inv_1"
        onVerificationRequired={onVerificationRequired}
      />,
      fetchFn as unknown as typeof fetch,
    );

    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalledWith('invitee@example.com'));
    expect(signUpBodies).toHaveLength(1);
    expect(signUpBodies[0].callbackURL).toBe('/_console/accept-invitation/inv_1');
  });

  it('sends no callbackURL when the form has none, leaving the server default in charge', async () => {
    const { fetchFn, signUpBodies } = verificationGatedServer();
    const onVerificationRequired = vi.fn();

    await register(
      <RegisterForm onVerificationRequired={onVerificationRequired} />,
      fetchFn as unknown as typeof fetch,
    );

    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalled());
    expect(signUpBodies).toHaveLength(1);
    expect(Object.keys(signUpBodies[0])).not.toContain('callbackURL');
  });
});
