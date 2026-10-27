/**
 * #26473 — the console's own `/login` and `/register`, opened signed out from
 * an invitation link, greet the visitor by WHO invited them and to WHAT.
 *
 * The read is app-shell's `useInvitationPreview` over the server's signed-out
 * `GET {authUrl}/organization/invitation-preview?id=ID`; the package's default
 * pages carry the same pins in
 * `packages/app-shell/src/console/auth/__tests__/invitationPreview-26473.test.tsx`.
 * Pinned here for the pages the console actually routes:
 *
 *  - found: the card names the inviter and the organization and shows the
 *    MASKED address as the one to use; the email field stays empty;
 *  - 404: today's generic invitation copy;
 *  - a failed read: today's generic copy too, and the form still renders.
 *
 * Rendered with a real `AuthProvider` over a real `createAuthClient`; only
 * `fetch` is a stub. Generic copy is read from the en pack.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import type { AuthPublicConfig } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

const AUTH_URL = 'http://localhost/api/v1/auth';
const en = builtInLocales.en.auth;
const INVITATION_ID = 'inv_26473';
const INVITE_QUERY = `?redirect=${encodeURIComponent(`/accept-invitation/${INVITATION_ID}`)}`;
const ORG = 'Xiaolin Decoration Studio';
const INVITER = 'Lin Xiao';
const MASKED = 'z***@example.com';
const MASKED_TEXT = new RegExp(MASKED.replace(/[*.]/g, '\\$&'));

const CONFIG: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
  features: { audiencePosture: 'invite_only' },
};

type PreviewAnswer = 'found' | 404 | 500;
let previewRequests: string[];

function stubServer(answer: PreviewAnswer): typeof fetch {
  previewRequests = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/organization/invitation-preview')) {
      previewRequests.push(url);
      if (answer === 'found') {
        return json({ success: true, data: { organizationName: ORG, inviterName: INVITER, email: MASKED } });
      }
      return json(
        {
          success: false,
          error:
            answer === 404
              ? { code: 'RESOURCE_NOT_FOUND', message: 'Invitation not found.' }
              : { code: 'INTERNAL_ERROR', message: 'The invitation preview is unavailable.' },
        },
        answer,
      );
    }
    if (url.endsWith('/bootstrap-status')) return json({ hasOwner: true });
    if (url.endsWith('/config')) return json({ success: true, data: CONFIG });
    return json(null);
  }) as typeof fetch;
}

function renderAt(path: string, answer: PreviewAnswer) {
  const fetchFn = stubServer(answer);
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

async function previewAnswered() {
  await waitFor(() => expect(previewRequests).toHaveLength(1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe('console /login — the invitation landing reads the signed-out preview (#26473)', () => {
  it('found: names the inviter and the organization, shows the masked address, prefills nothing', async () => {
    renderAt(`/login${INVITE_QUERY}`, 'found');

    const heading = await screen.findByRole('heading', { name: new RegExp(ORG) });
    expect(heading).toHaveTextContent(INVITER);
    expect(screen.getByText(MASKED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.login.invitationTitle })).toBeNull();
    expect(previewRequests).toEqual([`${AUTH_URL}/organization/invitation-preview?id=${INVITATION_ID}`]);
    expect(await screen.findByLabelText(en.login.emailLabel)).toHaveValue('');
  });

  it('404: keeps the generic invitation copy', async () => {
    renderAt(`/login${INVITE_QUERY}`, 404);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.login.invitationTitle })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(ORG))).toBeNull();
  });

  it('a failed read: keeps the generic copy and the sign-in form', async () => {
    renderAt(`/login${INVITE_QUERY}`, 500);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.login.invitationTitle })).toBeInTheDocument();
    expect(await screen.findByLabelText(en.login.emailLabel)).toBeInTheDocument();
  });
});

describe('console /register — the sign-up step reads the same preview (#26473)', () => {
  it('found: names the inviter and the organization, shows the masked address, prefills nothing', async () => {
    renderAt(`/register${INVITE_QUERY}`, 'found');

    const heading = await screen.findByRole('heading', { name: new RegExp(ORG) });
    expect(heading).toHaveTextContent(INVITER);
    expect(screen.getByText(MASKED_TEXT)).toBeInTheDocument();
    expect(screen.getByLabelText(en.register.emailLabel)).toHaveValue('');
  });

  it('404: keeps the generic invitation copy', async () => {
    renderAt(`/register${INVITE_QUERY}`, 404);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.register.invitationTitle })).toBeInTheDocument();
  });

  it('a failed read: keeps the generic copy and the form', async () => {
    renderAt(`/register${INVITE_QUERY}`, 500);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.register.invitationTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(en.register.emailLabel)).toBeInTheDocument();
  });
});
