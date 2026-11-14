/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — direct sign-in (objectstack#33183, `../directSignIn`).
 *
 * With the server's `features.directSignIn` on, a signed-out visitor is sent
 * straight to the identity provider through the start door, returning to this
 * same page marked `direct=returned`. The loop guard keeps the page drawn on an
 * `error`, on a return without a session, and for an OAuth client's hand-off;
 * `?local=1` draws today's page while the local path is `hidden`, and is
 * ignored while it is `off`; with it `off` the page draws no local way in,
 * whatever state brought the visitor to it. With the flag off the page is
 * today's.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { decideDirectSignIn, directSignInStartUrl } from '../directSignIn';
import { serveDeploymentWithOwner } from '../../../__tests__/helpers/ownerProbeDouble';

// The page asks whether this deployment has an owner; this one has.
serveDeploymentWithOwner();

beforeEach(() => {
  vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ON = { features: { directSignIn: true, localSignIn: 'hidden' as const } };
const ON_LOCAL_OFF = { features: { directSignIn: true, localSignIn: 'off' as const } };

function renderLogin(search: string, config: unknown) {
  window.history.replaceState({}, '', `/login${search}`);
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const doorFor = (returnPath: string) =>
  `/api/v1/auth/sign-in/direct?callbackURL=${encodeURIComponent(returnPath)}`;

describe('decideDirectSignIn', () => {
  const decide = (features: unknown, search: string) =>
    decideDirectSignIn({ features: features as never, search });

  it('is off unless the server says directSignIn: true', () => {
    expect(decide(undefined, '')).toBe('off');
    expect(decide({}, '')).toBe('off');
    expect(decide({ directSignIn: false }, '')).toBe('off');
  });

  it('starts on a plain visit, holds on error, and stops on a return without a session', () => {
    expect(decide(ON.features, '?redirect=%2Fapps')).toBe('start');
    expect(decide(ON.features, '?error=access_denied')).toBe('hold');
    expect(decide(ON.features, '?error=direct_sign_in_unavailable')).toBe('hold');
    expect(decide(ON.features, '?redirect=%2Fapps&direct=returned')).toBe('incomplete');
  });

  it('keeps an OAuth client hand-off on today\'s page', () => {
    expect(decide(ON.features, '?client_id=c&redirect_uri=https%3A%2F%2Fapp.example%2Fcb')).toBe('handoff');
  });

  it('draws the local page for ?local=1 only while the local path is hidden', () => {
    expect(decide(ON.features, '?local=1')).toBe('local');
    expect(decide(ON_LOCAL_OFF.features, '?local=1')).toBe('start');
  });

  it('builds the start URL from this page, marked, without local or a previous error', () => {
    expect(directSignInStartUrl('/api/v1/auth', '/_console/login', '?redirect=%2Fapps&local=1&error=x&error_description=y')).toBe(
      doorFor('/_console/login?redirect=%2Fapps&direct=returned'),
    );
  });
});

describe('LoginPage — direct sign-in', () => {
  it('CONTROL: with the flag off the page draws its form and navigates nowhere', async () => {
    renderLogin('?redirect=%2Fapps%2Fcrm', {});
    await screen.findByLabelText('Email');
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor straight to the start door, returning to this page', async () => {
    renderLogin('?redirect=%2Fapps%2Fcrm', ON);
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledTimes(1));
    expect(window.location.replace).toHaveBeenCalledWith(doorFor('/login?redirect=%2Fapps%2Fcrm&direct=returned'));
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('draws today\'s page at ?local=1 while the local path is hidden', async () => {
    renderLogin('?local=1', ON);
    await screen.findByLabelText('Email');
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('ignores ?local=1 while the local path is off', async () => {
    renderLogin('?local=1', ON_LOCAL_OFF);
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledTimes(1));
    expect(window.location.replace).toHaveBeenCalledWith(doorFor('/login?direct=returned'));
  });

  it('does not loop on an identity-provider error: it says so and starts again only when asked', async () => {
    renderLogin('?redirect=%2Fapps&error=access_denied&error_description=denied', ON);
    const retry = await screen.findByTestId('direct-sign-in-retry-button');
    expect(screen.getByTestId('sso-callback-refusal')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(window.location.replace).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(window.location.replace).toHaveBeenCalledWith(doorFor('/login?redirect=%2Fapps&direct=returned'));
  });

  it('does not loop on a return without a session', async () => {
    renderLogin('?redirect=%2Fapps&direct=returned', ON);
    await screen.findByTestId('direct-sign-in-incomplete');
    expect(screen.getByTestId('direct-sign-in-retry-button')).toBeTruthy();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('keeps an OAuth client hand-off on today\'s page', async () => {
    renderLogin('?client_id=c&redirect_uri=https%3A%2F%2Fapp.example%2Fcb', ON);
    await screen.findByLabelText('Email');
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('draws no local way in on an OAuth client hand-off while the local path is off', async () => {
    renderLogin('?client_id=c&redirect_uri=https%3A%2F%2Fapp.example%2Fcb', ON_LOCAL_OFF);
    await screen.findByTestId('login-no-sign-in-method');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByTestId('login-password-toggle')).toBeNull();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('draws no local way in when no provider can start while the local path is off', async () => {
    renderLogin('', { features: { directSignIn: false, localSignIn: 'off', ssoEnforced: true, sso: true } });
    await screen.findByTestId('login-sso-email-form');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByRole('button', { name: /password/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /sign up|create/i })).toBeNull();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('CONTROL: the same refused start with the local path hidden keeps the break-glass link', async () => {
    renderLogin('', { features: { directSignIn: false, localSignIn: 'hidden', ssoEnforced: true, sso: true } });
    await screen.findByTestId('login-sso-email-form');
    expect(screen.getByRole('button', { name: /password/i })).toBeTruthy();
  });

  it('names a door that could not start, on today\'s page, when the server no longer offers direct sign-in', async () => {
    renderLogin('?error=direct_sign_in_unavailable', { features: { directSignIn: false } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Single sign-on could not be started for this system. Ask your administrator to check which sign-in service it uses.',
    );
    await screen.findByLabelText('Email');
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
