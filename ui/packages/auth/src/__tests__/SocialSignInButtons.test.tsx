/**
 * Tests for SocialSignInButtons — the provider buttons ("Continue with …").
 *
 * objectui#2458 item 1: clicking a provider button used to give ZERO feedback
 * while the `/sign-in/oauth2` round-trip was in flight, and a sign-in call
 * that resolved without navigating anywhere failed silently. The button must
 * show a pending state, block double-clicks, and surface failures inline.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { SocialSignInButtons } from '../SocialSignInButtons';
import type { AuthClient, AuthPublicConfig } from '../types';

const PROVIDER_CONFIG: AuthPublicConfig = {
  socialProviders: [
    { id: 'objectstack-cloud', name: 'ObjectStack', enabled: true, type: 'oidc' },
  ],
};

function createMockClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(PROVIDER_CONFIG),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthClient;
}

function renderButtons(client: AuthClient) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <SocialSignInButtons mode="sign-in" />
    </AuthProvider>,
  );
}

const BUTTON = { name: /Continue with ObjectStack/ } as const;

describe('SocialSignInButtons — pending state + failure surfacing', () => {
  it('disables the button and marks it busy while sign-in is in flight', async () => {
    let resolveSignIn!: () => void;
    const signInWithProvider = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSignIn = resolve; }),
    );
    renderButtons(createMockClient({ signInWithProvider }));

    const button = await screen.findByRole('button', BUTTON);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    });

    // Success ends in a full-page navigation — the button must NOT re-enable
    // during page teardown.
    resolveSignIn();
    await waitFor(() => expect(signInWithProvider).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
  });

  it('ignores clicks while a sign-in is already in flight (no double-submit)', async () => {
    const signInWithProvider = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    renderButtons(createMockClient({ signInWithProvider }));

    const button = await screen.findByRole('button', BUTTON);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(signInWithProvider).toHaveBeenCalledTimes(1));
  });

  it('surfaces a failed sign-in as an inline alert and re-enables the button', async () => {
    const signInWithProvider = vi.fn().mockRejectedValue(
      new Error('Sign-in with "objectstack-cloud" did not return a redirect URL — please try again or contact your administrator.'),
    );
    renderButtons(createMockClient({ signInWithProvider }));

    const button = await screen.findByRole('button', BUTTON);
    fireEvent.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/did not return a redirect URL/);
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
});
