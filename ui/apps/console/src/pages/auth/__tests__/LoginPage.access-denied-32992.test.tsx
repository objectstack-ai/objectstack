/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — an `access_denied` return (objectstack#32992).
 *
 * The control plane's identity provider refuses an account that is not a
 * member of the environment's organization, and sends the browser back to the
 * environment's callback with `error=access_denied` (plugin-auth
 * `oauth-authorize-refusal.ts`); the callback lands it here. The page says the
 * account has no access to this environment, never that a link expired, and,
 * on an environment the control plane runs, offers the provider's own two ways
 * on: switch account (the provider's end-session door, in a new tab) and back
 * to the console.
 *
 * Driven through the real LoginPage: the server's `/auth/config` answer comes
 * through the auth client, the control plane's address through the runtime
 * config `initRuntimeConfig()` reads, as at boot.
 */

import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { initRuntimeConfig } from '@object-ui/app-shell';
import { resetRuntimeConfigForTesting } from '../../../../../../packages/app-shell/src/runtime-config';
import { resetInflightGetsForTesting } from '../../../../../../packages/types/src/http-inflight';
import { LoginPage } from '../LoginPage';

const CONTROL_PLANE = 'https://cloud.example.test';

const ACCESS_DENIED_SENTENCE =
  "The account you signed in with does not have access to this environment. Sign in with an account that has access, or ask an administrator of this environment's organization to add you as a member.";
const GENERIC =
  'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.';

/** The provider's own `error_description` (plugin-auth `ENV_ACCESS_DENIED_MESSAGE`). */
const PROVIDER_DESCRIPTION = 'You are not authorized to sign in to this environment.';

beforeAll(async () => {
  // The deployment has an owner, and the runtime names its control plane.
  vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/bootstrap-status')) return json({ hasOwner: true });
    if (url.endsWith('/api/v1/runtime/config')) return json({ cloudUrl: `${CONTROL_PLANE}/` });
    throw new Error(`access-denied test: no double for ${url}`);
  }) as typeof fetch);
  resetInflightGetsForTesting();
  resetRuntimeConfigForTesting();
  await initRuntimeConfig();
});

afterAll(() => {
  resetRuntimeConfigForTesting();
  resetInflightGetsForTesting();
  vi.unstubAllGlobals();
});

afterEach(cleanup);

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

const MANAGED = { features: { cloudManaged: true } };
const RETURN = `?${new URLSearchParams({ error: 'access_denied', error_description: PROVIDER_DESCRIPTION, state: 'abc' })}`;

describe('LoginPage — an access_denied return (objectstack#32992)', () => {
  it('says the account has no access here and offers switch account and back to console', async () => {
    renderLogin(RETURN, MANAGED);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ACCESS_DENIED_SENTENCE);
    expect(alert.textContent).not.toBe(GENERIC);
    // The technical cause stays behind the toggle.
    expect(screen.getByTestId('sso-callback-refusal-detail').textContent).toBe(
      `access_denied: ${PROVIDER_DESCRIPTION}`,
    );

    const actions = await screen.findByTestId('sso-access-denied-actions');
    const switchAccount = within(actions).getByRole('link', { name: 'Switch account' });
    // The identity provider's end-session door: ending the refused account's
    // session there is what makes the next sign-in ask who you are.
    expect(switchAccount.getAttribute('href')).toBe(`${CONTROL_PLANE}/api/v1/auth/oauth2/end-session`);
    expect(switchAccount.getAttribute('target')).toBe('_blank');
    expect(switchAccount.getAttribute('rel')).toBe('noopener noreferrer');
    const back = within(actions).getByRole('link', { name: 'Back to console' });
    expect(back.getAttribute('href')).toBe(CONTROL_PLANE);

    // The way back in stays on the page, below the refusal.
    expect(await screen.findByLabelText('Email')).toBeTruthy();
  });

  it('under direct sign-in, keeps the retry beside the two actions, never a loop', async () => {
    renderLogin(RETURN, { features: { cloudManaged: true, directSignIn: true, localSignIn: 'hidden' } });

    expect((await screen.findByRole('alert')).textContent).toBe(ACCESS_DENIED_SENTENCE);
    expect(await screen.findByTestId('sso-access-denied-actions')).toBeTruthy();
    expect(screen.getByTestId('direct-sign-in-retry-button')).toBeTruthy();
  });

  it('off the control plane: its own sentence, and no link it cannot address', async () => {
    renderLogin(RETURN, { features: {} });

    expect((await screen.findByRole('alert')).textContent).toBe(ACCESS_DENIED_SENTENCE);
    await screen.findByLabelText('Email');
    expect(screen.queryByTestId('sso-access-denied-actions')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Switch account' })).toBeNull();
  });

  it('CONTROL: another error code keeps the generic sentence and offers no actions', async () => {
    renderLogin('?error=invalid_provider&error_description=id_token_audience_mismatch', MANAGED);

    expect((await screen.findByRole('alert')).textContent).toBe(GENERIC);
    await screen.findByLabelText('Email');
    expect(screen.queryByTestId('sso-access-denied-actions')).toBeNull();
  });
});

const NOT_MEMBER_SENTENCE =
  "The account you signed in with is not a member of this environment's organization. Sign in with an account that is, or ask an administrator of the organization to invite you.";
const INVITATION_PENDING_SENTENCE =
  "You have been invited to this environment's organization, but the invitation has not been accepted yet. Accept the invitation from your email, then sign in again.";

/** An `access_denied` return carrying the host's reason (objectstack#34168). */
function returnWith(reason: string, error = 'access_denied'): string {
  return `?${new URLSearchParams({
    error,
    error_description: PROVIDER_DESCRIPTION,
    objectstack_error_reason: reason,
    state: 'abc',
  })}`;
}

describe("LoginPage — the host's refusal reason (objectstack#34168)", () => {
  it('not_member: says the account is not a member of the organization', async () => {
    renderLogin(returnWith('not_member'), MANAGED);

    expect((await screen.findByRole('alert')).textContent).toBe(NOT_MEMBER_SENTENCE);
    // The ways on and the technical cause are as for any access_denied return.
    expect(await screen.findByTestId('sso-access-denied-actions')).toBeTruthy();
    expect(screen.getByTestId('sso-callback-refusal-detail').textContent).toBe(
      `access_denied: ${PROVIDER_DESCRIPTION}`,
    );
  });

  it('invitation_pending: says the invitation is not accepted yet', async () => {
    renderLogin(returnWith('invitation_pending'), MANAGED);

    expect((await screen.findByRole('alert')).textContent).toBe(INVITATION_PENDING_SENTENCE);
    expect(await screen.findByTestId('sso-access-denied-actions')).toBeTruthy();
  });

  it('a reason this page has no sentence for keeps the access_denied sentence', async () => {
    renderLogin(returnWith('suspended'), MANAGED);

    expect((await screen.findByRole('alert')).textContent).toBe(ACCESS_DENIED_SENTENCE);
  });

  it('a reason beside another error code is not read', async () => {
    renderLogin(returnWith('not_member', 'invalid_provider'), MANAGED);

    expect((await screen.findByRole('alert')).textContent).toBe(GENERIC);
    await screen.findByLabelText('Email');
  });
});
