/**
 * #27509 — an invitation link the server no longer knows, on the console's
 * own `/login` and `/register`. The package's default pages carry the same
 * pins in
 * `packages/app-shell/src/console/auth/__tests__/invitationGone-27509.test.tsx`.
 *
 * The signed-out preview door answers ONE 404 body
 * (`RESOURCE_NOT_FOUND`) for an unknown, expired, accepted, rejected or
 * cancelled id (ADR-0138 D2). Both pages used to read it as "no preview" and
 * still offer the accept-and-register flow, whose refusal then told the link
 * holder to ask for an invitation. Pinned here:
 *
 *  - the door's 404: the "no longer valid" notice, with no sign-up prompt and
 *    no form, on both pages;
 *  - a sign-up refused with `SELF_REGISTRATION_CLOSED` from an invitation
 *    link re-reads the preview: an answer keeps the form and the refusal names
 *    the masked address the invitation was sent to; the door's 404 turns the
 *    page into the notice.
 *
 * A failed read and a server without the route keep today's generic copy;
 * those pins live in `invitationPreview-26473.test.tsx` beside this file.
 *
 * Rendered with a real `AuthProvider` over a real `createAuthClient` and a
 * real `I18nProvider`; only `fetch` is a stub. Copy is read from the en pack.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

const AUTH_URL = 'http://localhost/api/v1/auth';
const en = builtInLocales.en.auth;
const INVITATION_ID = 'inv_27509';
const INVITE_QUERY = `?redirect=${encodeURIComponent(`/accept-invitation/${INVITATION_ID}`)}`;
const ORG = 'Default Organization';
const MASKED = 'i***@example.com';

const CONFIG: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
  features: { audiencePosture: 'invite_only' },
};

/** What the preview door answers, one entry per read; the last repeats. */
type PreviewAnswer = 'found' | 'gone';

let previewRequests: string[];
let signUpRequests: number;

function stubServer(answers: PreviewAnswer[]): typeof fetch {
  previewRequests = [];
  signUpRequests = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/organization/invitation-preview')) {
      const answer = answers[Math.min(previewRequests.length, answers.length - 1)];
      previewRequests.push(url);
      return answer === 'found'
        ? json({ success: true, data: { organizationName: ORG, inviterName: 'Dev Admin', email: MASKED } })
        : json(
            {
              success: false,
              error: {
                code: 'RESOURCE_NOT_FOUND',
                message: 'Invitation not found. It may have expired, been used, or been withdrawn.',
              },
            },
            404,
          );
    }
    if (url.includes('/sign-up/email')) {
      signUpRequests += 1;
      return json(
        { code: 'SELF_REGISTRATION_CLOSED', message: 'Self-registration is closed on this environment.' },
        403,
      );
    }
    if (url.endsWith('/bootstrap-status')) return json({ hasOwner: true });
    if (url.endsWith('/config')) return json({ success: true, data: CONFIG });
    return json(null);
  }) as typeof fetch;
}

function renderAt(path: string, answers: PreviewAnswer[]) {
  const fetchFn = stubServer(answers);
  vi.stubGlobal('fetch', fetchFn);
  window.history.replaceState({}, '', path);
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

async function submitRegistration(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(en.register.nameLabel), 'Invitee');
  await user.type(screen.getByLabelText(en.register.emailLabel), email);
  await user.type(screen.getByLabelText(en.register.passwordLabel), 'correct-horse-1');
  await user.type(screen.getByLabelText(en.register.confirmPasswordLabel), 'correct-horse-1');
  await user.click(screen.getByRole('button', { name: en.register.submitButton }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('the door\'s 404: the invitation link is no longer valid (#27509)', () => {
  it('console /login: the notice, with no sign-up prompt and no sign-in form', async () => {
    renderAt(`/login${INVITE_QUERY}`, ['gone']);

    expect(await screen.findByTestId('invitation-gone')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.login.invitationGoneTitle })).toBeInTheDocument();
    expect(screen.queryByText(en.login.invitationSignUpButton)).toBeNull();
    expect(screen.queryByLabelText(en.login.emailLabel)).toBeNull();
    expect(screen.queryByRole('heading', { name: en.login.invitationTitle })).toBeNull();
    // The way on is the plain sign-in, not back into the invitation.
    expect(screen.getByRole('link', { name: en.login.invitationGoneSignIn })).toHaveAttribute('href', '/login');
  });

  it('console /register: the notice, with no registration form', async () => {
    renderAt(`/register${INVITE_QUERY}`, ['gone']);

    expect(await screen.findByTestId('invitation-gone')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.login.invitationGoneTitle })).toBeInTheDocument();
    expect(screen.queryByLabelText(en.register.emailLabel)).toBeNull();
    expect(screen.queryByRole('heading', { name: en.register.invitationTitle })).toBeNull();
  });

  it('a live invitation keeps the prompt and the form (the control)', async () => {
    renderAt(`/login${INVITE_QUERY}`, ['found']);

    expect(await screen.findByRole('heading', { name: new RegExp(ORG) })).toBeInTheDocument();
    expect(await screen.findByText(en.login.invitationSignUpButton)).toBeInTheDocument();
    expect(screen.getByLabelText(en.login.emailLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('invitation-gone')).toBeNull();
  });
});

describe('console /register — a refused invitation sign-up re-reads the preview (#27509)', () => {
  it('still pending: keeps the form, and the refusal names the masked invited address', async () => {
    renderAt(`/register${INVITE_QUERY}`, ['found', 'found']);
    await screen.findByRole('heading', { name: new RegExp(ORG) });

    await submitRegistration('someone@example.com');

    const sentTo = en.register.errors.invitationSentTo.replace('{{email}}', MASKED);
    expect(await screen.findByText(sentTo)).toBeInTheDocument();
    expect(screen.queryByText(en.register.errors.selfRegistrationClosed)).toBeNull();
    expect(signUpRequests).toBe(1);
    await waitFor(() => expect(previewRequests).toHaveLength(2));
    expect(screen.getByLabelText(en.register.emailLabel)).toBeInTheDocument();
  });

  it('gone meanwhile: the page becomes the notice', async () => {
    renderAt(`/register${INVITE_QUERY}`, ['found', 'gone']);
    await screen.findByRole('heading', { name: new RegExp(ORG) });

    await submitRegistration('invitee2@example.com');

    expect(await screen.findByTestId('invitation-gone')).toBeInTheDocument();
    expect(previewRequests).toHaveLength(2);
    expect(screen.queryByLabelText(en.register.emailLabel)).toBeNull();
  });
});
