/**
 * objectui#13208 — the remediation overlay on an IMPERSONATION session.
 *
 * The overlay is `fixed inset-0` above every route, so it covers the
 * impersonation banner and its "Stop impersonating" button. An administrator
 * who impersonated a user held by a credential posture was offered that user's
 * own change-password (or MFA enrolment) form, and "Sign out instead", which
 * drops the administrator's session too. The ruling (objectstack#24762, E,
 * item 6): on an impersonation session the overlay offers "Stop impersonating"
 * and no longer offers the held user's forms to the impersonator.
 *
 * ## The harness
 *
 * The REAL identity flow, as in `ImpersonationBanner.test.tsx`: `AuthProvider`
 * resolves the session from a client that answers as a function of the token
 * in `TokenStorage`, and the gate is raised the way the console raises it, by
 * a 403 policy body coming back through `createAuthenticatedFetch`. Nothing
 * injects `impersonatedBy` or `remediationRequired` into context. The banner
 * renders beside the overlay, as in `ConsoleShell`, and its appearance is how
 * a case knows the impersonated session has resolved before the gate arrives.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, TokenStorage, createAuthenticatedFetch } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { I18nProvider } from '@object-ui/i18n';
import { RemediationOverlay } from '../RemediationOverlay';
import { ImpersonationBanner } from '../../layout/ImpersonationBanner';

const ADMIN_TOKEN = 'admin-token';
const IMPERSONATED_TOKEN = 'impersonated-token';
const STOP_PATH = '/api/v1/auth/admin/stop-impersonating';
const HELD_MESSAGE = 'You must change your password before continuing.';

const ADMIN_SESSION = {
  user: { id: 'usr_admin', name: 'Dev Admin', email: 'admin@objectos.ai' },
  session: { token: ADMIN_TOKEN },
};
const IMPERSONATED_SESSION = {
  user: { id: 'usr_dave', name: 'RT8 Dave', email: 'rt8-dave@example.com' },
  session: { token: IMPERSONATED_TOKEN, impersonatedBy: 'usr_admin' },
};

function tokenBoundClient(): AuthClient {
  return {
    getSession: vi.fn(async () => {
      const token = TokenStorage.get();
      if (token === IMPERSONATED_TOKEN) return IMPERSONATED_SESSION;
      if (token === ADMIN_TOKEN) return ADMIN_SESSION;
      return null;
    }),
    listOrganizations: vi.fn(async () => []),
    getActiveOrganization: vi.fn(async () => null),
    getActiveMember: vi.fn(async () => null),
  } as unknown as AuthClient;
}

/**
 * Every data call answers with the posture gate; the stop endpoint answers
 * with `stop`. Records the URL and bearer of each call.
 */
function stubServer(gateCode: string, stop: () => Response) {
  const calls: { url: string; bearer: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      calls.push({ url, bearer: new Headers(init?.headers).get('Authorization') });
      if (url.endsWith(STOP_PATH)) return stop();
      return new Response(JSON.stringify({ error: { code: gateCode, message: HELD_MESSAGE } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** A page's data request, over the console's data lane: the interceptor raises the gate. */
async function raiseGate() {
  await act(async () => {
    await createAuthenticatedFetch()('/api/v1/data/account');
  });
}

/** Records whether the change-password form was EVER in the document, not only at the end. */
function watchForPasswordForm(): () => boolean {
  let seen = false;
  // Read off the ADDED nodes, not the document: the form can be added and
  // removed again before this callback runs.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element && (node.id === 'rem-cur' || node.querySelector('#rem-cur'))) seen = true;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    return seen || document.getElementById('rem-cur') !== null;
  };
}

function renderConsole() {
  const client = tokenBoundClient();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <ImpersonationBanner />
        <RemediationOverlay />
      </AuthProvider>
    </I18nProvider>,
  );
  return client;
}

/** Impersonating RT8 Dave, and a data request has just been held on `gateCode`. */
async function heldWhileImpersonating(gateCode: string, stop: () => Response = () => new Response('{}')) {
  TokenStorage.set(IMPERSONATED_TOKEN);
  const calls = stubServer(gateCode, stop);
  renderConsole();
  await screen.findByTestId('impersonation-banner');
  await raiseGate();
  await screen.findByTestId('remediation-impersonation-exit');
  return calls;
}

describe('RemediationOverlay on an impersonation session (objectui#13208)', () => {
  let reload: Mock<() => void>;

  beforeEach(() => {
    TokenStorage.clear();
    reload = vi.fn<() => void>();
    vi.spyOn(window.location, 'reload').mockImplementation(reload);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TokenStorage.clear();
  });

  it('PASSWORD_RESET_REQUIRED: offers Stop impersonating, not the held user’s password form', async () => {
    await heldWhileImpersonating('PASSWORD_RESET_REQUIRED');

    expect(screen.getByRole('heading', { name: 'RT8 Dave must change their password' })).toBeTruthy();
    expect(screen.getByText(/only they can do this themselves/)).toBeTruthy();
    expect(screen.getByTestId('remediation-impersonation-stop').textContent).toBe('Stop impersonating');
    // Not the target's credential form, and not the message written to them.
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.queryByText(HELD_MESSAGE)).toBeNull();
    // The other way out stays.
    expect(screen.getByRole('button', { name: 'Sign out instead' })).toBeTruthy();
  });

  it('MFA_REQUIRED: offers Stop impersonating, not the held user’s authenticator enrolment', async () => {
    await heldWhileImpersonating('MFA_REQUIRED');

    expect(screen.getByRole('heading', { name: 'RT8 Dave must set up two-factor authentication' })).toBeTruthy();
    expect(screen.getByTestId('remediation-impersonation-stop')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm your password')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Set up two-factor authentication' })).toBeNull();
  });

  it('Stop: ends the impersonation as the banner does, clears the gate and reloads as the administrator', async () => {
    const calls = await heldWhileImpersonating('PASSWORD_RESET_REQUIRED', () =>
      new Response('{}', { status: 200, headers: { 'set-auth-token': ADMIN_TOKEN } }),
    );
    const passwordFormEverShown = watchForPasswordForm();

    await userEvent.click(screen.getByTestId('remediation-impersonation-stop'));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('remediation-impersonation-exit')).toBeNull());
    const stop = calls.filter((c) => c.url.endsWith(STOP_PATH));
    expect(stop).toHaveLength(1);
    // Sent as the impersonated session; the administrator comes back from the
    // `admin_session` cookie and the rotation is adopted.
    expect(stop[0].bearer).toBe(`Bearer ${IMPERSONATED_TOKEN}`);
    expect(TokenStorage.get()).toBe(ADMIN_TOKEN);
    expect(screen.queryByTestId('impersonation-banner')).toBeNull();
    // The session dropped `impersonatedBy` before the gate was cleared: in
    // between, the administrator was never shown the held user's form.
    expect(passwordFormEverShown()).toBe(false);
  });

  it('Stop accepted but nobody restored: says so, keeps the overlay, does not reload', async () => {
    await heldWhileImpersonating('PASSWORD_RESET_REQUIRED', () => new Response('{}', { status: 200 }));

    await userEvent.click(screen.getByTestId('remediation-impersonation-stop'));

    const stranded = await screen.findByTestId('remediation-impersonation-not-restored');
    expect(stranded.textContent).toMatch(/still impersonating RT8 Dave/);
    expect(screen.getByTestId('remediation-impersonation-exit')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('Stop rejected: says why, keeps the overlay, does not reload', async () => {
    await heldWhileImpersonating('PASSWORD_RESET_REQUIRED', () =>
      new Response(JSON.stringify({ message: 'admin session not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await userEvent.click(screen.getByTestId('remediation-impersonation-stop'));

    const error = await screen.findByTestId('remediation-impersonation-stop-error');
    expect(error.textContent).toMatch(/admin session not found/);
    expect(screen.getByTestId('remediation-impersonation-exit')).toBeTruthy();
    expect(TokenStorage.get()).toBe(IMPERSONATED_TOKEN);
    expect(reload).not.toHaveBeenCalled();
  });

  it('an ordinary session is unchanged: the user’s own password form, no Stop', async () => {
    TokenStorage.set(ADMIN_TOKEN);
    stubServer('PASSWORD_RESET_REQUIRED', () => new Response('{}'));
    const client = renderConsole();
    // Resolved as the administrator's own session, so this is "ordinary", not
    // "not loaded yet".
    await waitFor(() => expect(client.getSession).toHaveBeenCalled());
    await act(async () => {});
    await raiseGate();

    expect(await screen.findByLabelText('Current password')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'You must change your password' })).toBeTruthy();
    expect(screen.getByText(HELD_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId('remediation-impersonation-exit')).toBeNull();
    expect(screen.queryByTestId('remediation-impersonation-stop')).toBeNull();
  });
});
