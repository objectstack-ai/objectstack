/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29105 — a password sign-in for an account with two-factor
 * sign-in on asks for the second factor in place.
 *
 * The server accepts the password and answers a challenge instead of a
 * session. `LoginForm` used to drop that answer: the page stayed as it was,
 * with no code field and no message, and the user could not get in at all.
 * These run the real `AuthProvider` and `LoginForm` over a stub client whose
 * `signIn` answers the challenge, as better-auth's `/sign-in/email` does.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm, type LoginFormProps } from '../LoginForm';
import { useAuth } from '../useAuth';
import type { AuthClient } from '../types';

const USER = { id: 'u1', name: 'Totp User', email: 'totp@example.com' };

function refusal(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function stubClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({ twoFactor: { methods: ['totp'] } }),
    verifySignInTwoFactor: vi.fn().mockResolvedValue({ user: USER, session: { token: 'session-token' } }),
    signOut: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as AuthClient;
}

/** Shows who the provider says is signed in, next to the form. */
function SignedInAs() {
  const { user } = useAuth();
  return <output data-testid="signed-in-as">{user?.email ?? ''}</output>;
}

function renderLogin(client: AuthClient, props: LoginFormProps = {}) {
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <LoginForm {...props} />
      <SignedInAs />
    </AuthProvider>,
  );
}

async function submitPassword() {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: USER.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await screen.findByTestId('two-factor-challenge');
}

function enterCode(label: string, code: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('LoginForm — two-factor sign-in (objectstack#29105)', () => {
  it('asks for the authenticator code after the password, then signs the user in', async () => {
    const client = stubClient();
    const onSuccess = vi.fn();
    renderLogin(client, { onSuccess });

    await submitPassword();
    // The password step is gone, nobody is signed in yet, and the host was not told it succeeded.
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByTestId('signed-in-as').textContent).toBe('');
    expect(onSuccess).not.toHaveBeenCalled();

    // An authenticator shows "123 456"; the space is not part of the code.
    enterCode('Authentication code', '123 456');

    await waitFor(() => expect(screen.getByTestId('signed-in-as').textContent).toBe(USER.email));
    expect(client.verifySignInTwoFactor).toHaveBeenCalledWith('123456', 'totp');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('says a wrong code is wrong, in place, and lets the user try again', async () => {
    const verify = vi
      .fn()
      .mockRejectedValueOnce(refusal('INVALID_CODE', 'Invalid code'))
      .mockResolvedValueOnce({ user: USER, session: { token: 'session-token' } });
    renderLogin(stubClient({ verifySignInTwoFactor: verify }), {
      errorMessages: { INVALID_CODE: 'That code is not valid.' },
    });

    await submitPassword();
    enterCode('Authentication code', '000000');

    expect((await screen.findByRole('alert')).textContent).toContain('That code is not valid.');
    expect(screen.getByTestId('two-factor-challenge')).toBeTruthy();
    expect(screen.getByTestId('signed-in-as').textContent).toBe('');

    enterCode('Authentication code', '654321');
    await waitFor(() => expect(screen.getByTestId('signed-in-as').textContent).toBe(USER.email));
    expect(verify).toHaveBeenLastCalledWith('654321', 'totp');
  });

  it('accepts a backup code instead of the authenticator code', async () => {
    const client = stubClient();
    renderLogin(client);

    await submitPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    enterCode('Backup code', ' abcde-fghij ');

    await waitFor(() => expect(screen.getByTestId('signed-in-as').textContent).toBe(USER.email));
    expect(client.verifySignInTwoFactor).toHaveBeenCalledWith('abcde-fghij', 'backup-code');
  });

  it('goes back to the password step on "Back to sign in"', async () => {
    const client = stubClient();
    renderLogin(client);

    await submitPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-challenge')).toBeNull();
    expect(client.verifySignInTwoFactor).not.toHaveBeenCalled();
  });

  it('returns to the password step with the reason when the server has dropped the challenge', async () => {
    renderLogin(
      stubClient({
        verifySignInTwoFactor: vi
          .fn()
          .mockRejectedValue(refusal('TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'Too many attempts.')),
      }),
      { errorMessages: { TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Sign in with your password again.' } },
    );

    await submitPassword();
    enterCode('Authentication code', '111111');

    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-challenge')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Sign in with your password again.');
  });

  it('offers only backup codes when the server lists no authenticator method', async () => {
    renderLogin(stubClient({ signIn: vi.fn().mockResolvedValue({ twoFactor: { methods: [] } }) }));

    await submitPassword();

    expect(screen.getByLabelText('Backup code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use your authenticator app instead' })).toBeNull();
  });

  it('signs a user without two-factor sign-in straight in, as before', async () => {
    const client = stubClient({
      signIn: vi.fn().mockResolvedValue({ user: USER, session: { token: 'plain-token' } }),
    });
    const onSuccess = vi.fn();
    renderLogin(client, { onSuccess });

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: USER.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('signed-in-as').textContent).toBe(USER.email);
    expect(screen.queryByTestId('two-factor-challenge')).toBeNull();
    expect(client.verifySignInTwoFactor).not.toHaveBeenCalled();
  });
});
