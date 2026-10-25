/**
 * #3238: autofill/copy-paste smuggle leading/trailing whitespace into the
 * email field; the server then rejects it ("Invalid email"). RegisterForm and
 * ForgotPasswordForm must trim the email before sending, matching LoginForm
 * (whose trim tests live in LoginForm.test.tsx).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { RegisterForm } from '../RegisterForm';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import type { AuthClient, AuthPublicConfig } from '../types';

function createMockClient(
  config: AuthPublicConfig,
  overrides: Partial<AuthClient> = {},
): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({ user: { id: '1' }, session: { token: 't' } }),
    signUp: vi.fn().mockResolvedValue({ user: { id: '2' }, session: null, requiresVerification: false }),
    signOut: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue(config),
    ...overrides,
  } as unknown as AuthClient;
}

function renderWithAuth(client: AuthClient, ui: React.ReactElement) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client}>
      {ui}
    </AuthProvider>,
  );
}

describe('RegisterForm — email whitespace trimming (#3238)', () => {
  it('trims whitespace around the email before signUp', async () => {
    const signUp = vi
      .fn()
      .mockResolvedValue({ user: { id: '2' }, session: null, requiresVerification: false });
    renderWithAuth(createMockClient({}, { signUp }), <RegisterForm />);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  new@objectos.ai  ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        name: 'Test User',
        email: 'new@objectos.ai',
        password: 'password123',
      }),
    );
  });
});

describe('ForgotPasswordForm — email whitespace trimming (#3238)', () => {
  it('trims whitespace around the email before requesting the reset link', async () => {
    const forgotPassword = vi.fn().mockResolvedValue(undefined);
    renderWithAuth(createMockClient({}, { forgotPassword }), <ForgotPasswordForm />);

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: '  reset@objectos.ai  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('reset@objectos.ai'));
  });
});
