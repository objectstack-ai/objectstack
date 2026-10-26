/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginForm — the `hideHeader` prop and the password reveal toggle
 * (objectui#12600).
 *
 * `hideHeader` lets a host that draws its own header suppress the form's (the
 * lock disc, the title, the description). Its default is the header exactly as
 * before, so every host that does not opt in is unchanged. Under SSO-only mode
 * a headless form still says how to sign in.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm, type LoginFormProps } from '../LoginForm';
import type { AuthClient, AuthPublicConfig } from '../types';

function createMockClient(config: AuthPublicConfig = {}): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({ user: { id: '1' }, session: { token: 't' } }),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
}

function renderLogin(props: LoginFormProps = {}, config: AuthPublicConfig = {}) {
  return render(
    <AuthProvider authUrl="/api/auth" client={createMockClient(config)}>
      <LoginForm title="Form title" description="Form description" {...props} />
    </AuthProvider>,
  );
}

describe('LoginForm — hideHeader (objectui#12600)', () => {
  it('renders its header by default: the lock disc, the title and the description', async () => {
    const { container } = renderLogin();

    await screen.findByLabelText('Email');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Form title');
    expect(screen.getByText('Form description')).toBeTruthy();
    // The lock disc is the header's icon tile.
    expect(container.querySelector('.rounded-2xl svg')).not.toBeNull();
  });

  it('renders no header when the host opts out', async () => {
    const { container } = renderLogin({ hideHeader: true });

    await screen.findByLabelText('Email');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Form title')).toBeNull();
    expect(screen.queryByText('Form description')).toBeNull();
    expect(container.querySelector('.rounded-2xl')).toBeNull();
  });

  it('still says how to sign in under SSO-only mode when the header is hidden', async () => {
    renderLogin({ hideHeader: true }, { features: { ssoEnforced: true } });

    expect(
      await screen.findByText("Sign in with your organization's single sign-on"),
    ).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('LoginForm — password reveal toggle (objectui#12600)', () => {
  it('shows and hides the password, naming the action it will take', async () => {
    renderLogin();

    const password = (await screen.findByLabelText('Password')) as HTMLInputElement;
    expect(password.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });

  it('takes its names from the labels, for i18n', async () => {
    renderLogin({ labels: { showPasswordText: 'Afficher', hidePasswordText: 'Masquer' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Afficher' }));
    expect(screen.getByRole('button', { name: 'Masquer' })).toBeTruthy();
  });

  it('never submits the form', async () => {
    const onSuccess = vi.fn();
    renderLogin({ onSuccess });

    fireEvent.click(await screen.findByRole('button', { name: 'Show password' }));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
