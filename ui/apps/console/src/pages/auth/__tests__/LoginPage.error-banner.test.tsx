/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — OAuth callback `?error=` banner (objectui#2458 item 1).
 *
 * better-auth redirects a failed OAuth callback (expired hand-off, replayed
 * `state`, IdP error) to its error URL with `?error=<code>`; the runtime
 * points that at the console login page. The page must surface the code as a
 * visible banner — before this fix the user landed on a silent login form
 * right after successfully entering their password on the IdP.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { serveDeploymentWithOwner } from '../../../__tests__/helpers/ownerProbeDouble';

// objectstack#32021 — the page asks whether this deployment has an owner; this one has.
serveDeploymentWithOwner();


afterEach(cleanup);

const GENERIC =
  'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.';

function createMockClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
  } as unknown as AuthClient;
}

function renderLogin(search: string) {
  window.history.replaceState({}, '', `/login${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage — OAuth callback error banner', () => {
  it('surfaces ?error= as a visible alert banner, the code behind the details toggle', async () => {
    renderLogin('?error=state_mismatch');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(GENERIC);
    expect(screen.getByTestId('sso-callback-refusal-detail').textContent).toBe('state_mismatch');
  });

  it('keeps the error_description beside the code in the details toggle, out of the alert', async () => {
    renderLogin('?error=access_denied&error_description=User%20cancelled');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/User cancelled/);
    expect(screen.getByTestId('sso-callback-refusal-detail').textContent).toBe('access_denied: User cancelled');
  });

  it('shows no banner on a plain login page', async () => {
    renderLogin('');

    // Wait for the form to settle, then assert no alert is present.
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * objectstack#32087 — each refusal the server lands here with reads as its own
 * end-user sentence, never as an expired link. The `error` / `error_description`
 * pairs are the ones the server redirects with: the first three measured
 * through plugin-auth's real SAML ACS pipeline (the one
 * `sso-saml-refusal-landing.test.ts` drives), with the audience gate's code
 * carrying its administrator-facing message; `state_not_found` is the OIDC
 * callback's answer to a request with no `state`; `unsolicited_response` is
 * the SAML ACS's refusal of an IdP-initiated response (objectstack#32132).
 */
describe('LoginPage — a refused single sign-on names its own cause (objectstack#32087)', () => {
  const SELF_REGISTRATION_CLOSED_MESSAGE =
    'This single sign-on provider does not create accounts for people who were not invited ' +
    '(audience posture invite_only). Ask an administrator for an invitation, or ask them to turn on ' +
    'just-in-time provisioning (allowJit) for this provider.';

  const CASES: ReadonlyArray<{ code: string; description?: string; sentence: string }> = [
    {
      code: 'SELF_REGISTRATION_CLOSED',
      description: SELF_REGISTRATION_CLOSED_MESSAGE,
      sentence: "Your account isn't set up for this system yet. Ask your administrator to invite you.",
    },
    {
      code: 'account_not_linked',
      sentence:
        "An account with your email already exists here, but it isn't connected to single sign-on. Sign in another way, or ask your administrator to connect it.",
    },
    {
      code: 'saml_error',
      description: 'Invalid SAML response',
      sentence:
        "Your organization's sign-in service sent a response this system could not accept. Ask your administrator to check the single sign-on setup.",
    },
    {
      code: 'invalid_saml_response',
      description: 'SAML response binding could not be validated',
      sentence:
        "Your organization's sign-in service sent a response this system could not accept. Ask your administrator to check the single sign-on setup.",
    },
    {
      code: 'unsolicited_response',
      sentence:
        "Sign-in has to start from this system's login page. Enter your work email here and choose Sign in with SSO.",
    },
    {
      code: 'state_not_found',
      sentence:
        "Sign-in has to start from this system's login page. Enter your work email here and choose Sign in with SSO.",
    },
  ];

  for (const { code, description, sentence } of CASES) {
    it(`${code}: its own sentence, not the generic one, with the technical cause only in the toggle`, async () => {
      const query = new URLSearchParams({ error: code, ...(description ? { error_description: description } : {}) });
      renderLogin(`?${query.toString()}`);

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(sentence);
      expect(alert.textContent).not.toBe(GENERIC);
      expect(alert.textContent).not.toContain(code);
      if (description) expect(alert.textContent).not.toContain(description);

      const detail = screen.getByTestId('sso-callback-refusal-detail');
      expect(detail.textContent).toBe(description ? `${code}: ${description}` : code);
      expect(detail.closest('details')).not.toBeNull();
      expect(alert.contains(detail)).toBe(false);
    });
  }

  it('CONTROL: a code with no sentence of its own keeps the generic one', async () => {
    renderLogin('?error=invalid_provider&error_description=id_token_audience_mismatch');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(GENERIC);
    expect(alert.textContent).not.toContain('id_token_audience_mismatch');
    expect(screen.getByTestId('sso-callback-refusal-detail').textContent).toBe(
      'invalid_provider: id_token_audience_mismatch',
    );
  });

  it('CONTROL: a code named like an Object.prototype member keeps the generic one', async () => {
    renderLogin('?error=constructor');

    expect((await screen.findByRole('alert')).textContent).toBe(GENERIC);
  });
});
