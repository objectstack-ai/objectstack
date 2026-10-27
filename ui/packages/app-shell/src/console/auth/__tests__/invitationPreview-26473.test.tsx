/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #26473 — a visitor who opens an invitation link signed out is greeted by
 * WHO invited them and to WHAT, on `DefaultLoginPage` and on the
 * `DefaultRegisterPage` it hands to.
 *
 * The server's signed-out read is `GET {authUrl}/organization/invitation-preview?id=ID`
 * (objectstack `plugin-auth` `invitation-preview.ts`): `{ success, data:
 * { organizationName, inviterName, email } }` with the address MASKED, and one
 * uniform 404 for any id that is not a pending, unexpired invitation. Three
 * outcomes are pinned here, each on both pages where it differs:
 *
 *  - found: the card names the inviter and the organization, and shows the
 *    masked address as the one to use, while the email field stays EMPTY — a
 *    masked value is not an address and is never prefilled;
 *  - 404: today's generic invitation copy;
 *  - a failed read (5xx, a network failure, a body of the wrong shape):
 *    today's generic copy too, and the page keeps working.
 *
 * Rendered as shipped, like `defaultPagesFollowPosture-11705.test.tsx` beside
 * this file: the exported pages, `@object-ui/auth`'s real forms, a real
 * `AuthProvider` over a real `createAuthClient` and a real `I18nProvider`;
 * only `fetch` is a stub. Generic copy is read from the en pack.
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

const CONFIG: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
  features: { audiencePosture: 'invite_only' },
};

type PreviewAnswer = 'found' | 'found-no-inviter' | 404 | 500 | 'network' | 'wrong-shape';

let previewRequests: string[];

function stubServer(answer: PreviewAnswer): typeof fetch {
  previewRequests = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/organization/invitation-preview')) {
      previewRequests.push(`${init?.method ?? 'GET'} ${url}`);
      switch (answer) {
        case 'found':
          return json({ success: true, data: { organizationName: ORG, inviterName: INVITER, email: MASKED } });
        case 'found-no-inviter':
          return json({ success: true, data: { organizationName: ORG, inviterName: null, email: MASKED } });
        case 404:
          return json(
            { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Invitation not found.' } },
            404,
          );
        case 500:
          return json(
            { success: false, error: { code: 'INTERNAL_ERROR', message: 'The invitation preview is unavailable.' } },
            500,
          );
        case 'network':
          throw new TypeError('Failed to fetch');
        case 'wrong-shape':
          return json({ organizationName: ORG });
      }
    }
    if (url.endsWith('/bootstrap-status')) return json({ hasOwner: true });
    if (url.endsWith('/config')) return json({ success: true, data: CONFIG });
    return json(null);
  }) as typeof fetch;
}

function renderAt(path: string, answer: PreviewAnswer) {
  const fetchFn = stubServer(answer);
  vi.stubGlobal('fetch', fetchFn);
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

/** The preview was asked for, and its answer had the chance to land. */
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
});

describe('DefaultLoginPage — the invitation landing reads the signed-out preview (#26473)', () => {
  it('found: names the inviter and the organization, and shows the masked address', async () => {
    renderAt(`/login${INVITE_QUERY}`, 'found');

    const heading = await screen.findByRole('heading', { name: new RegExp(ORG) });
    expect(heading).toHaveTextContent(INVITER);
    expect(screen.getByText(new RegExp(MASKED.replace(/[*.]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.login.invitationTitle })).toBeNull();
    // One anonymous read, by the id the link carries.
    expect(previewRequests).toEqual([
      `GET ${AUTH_URL}/organization/invitation-preview?id=${INVITATION_ID}`,
    ]);
    // The masked value is a hint, never a prefill.
    expect(await screen.findByLabelText(en.login.emailLabel)).toHaveValue('');
  });

  it('found without an inviter name: names the organization alone', async () => {
    renderAt(`/login${INVITE_QUERY}`, 'found-no-inviter');

    const heading = await screen.findByRole('heading', { name: new RegExp(ORG) });
    expect(heading).not.toHaveTextContent('null');
    expect(screen.queryByRole('heading', { name: en.login.invitationTitle })).toBeNull();
  });

  it('404: keeps the generic invitation copy', async () => {
    renderAt(`/login${INVITE_QUERY}`, 404);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.login.invitationTitle })).toBeInTheDocument();
    expect(screen.getByText(en.login.invitationDescription)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(ORG))).toBeNull();
  });

  it.each([500, 'network', 'wrong-shape'] as const)(
    'a failed read (%s): keeps the generic copy and the sign-in form',
    async (answer) => {
      renderAt(`/login${INVITE_QUERY}`, answer);
      await previewAnswered();

      expect(await screen.findByRole('heading', { name: en.login.invitationTitle })).toBeInTheDocument();
      expect(await screen.findByLabelText(en.login.emailLabel)).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(ORG))).toBeNull();
    },
  );

  it('asks for no preview when the visitor did not come from an invitation', async () => {
    renderAt('/login', 'found');
    await screen.findByLabelText(en.login.emailLabel);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(previewRequests).toEqual([]);
  });
});

describe('DefaultRegisterPage — the sign-up step reads the same preview (#26473)', () => {
  it('found: names the inviter and the organization, shows the masked address, prefills nothing', async () => {
    renderAt(`/register${INVITE_QUERY}`, 'found');

    const heading = await screen.findByRole('heading', { name: new RegExp(ORG) });
    expect(heading).toHaveTextContent(INVITER);
    expect(screen.getByText(new RegExp(MASKED.replace(/[*.]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.register.invitationTitle })).toBeNull();
    expect(screen.getByLabelText(en.register.emailLabel)).toHaveValue('');
  });

  it('404: keeps the generic invitation copy', async () => {
    renderAt(`/register${INVITE_QUERY}`, 404);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.register.invitationTitle })).toBeInTheDocument();
    expect(screen.getByText(en.register.invitationDescription)).toBeInTheDocument();
  });

  it('a failed read: keeps the generic copy and the form', async () => {
    renderAt(`/register${INVITE_QUERY}`, 500);
    await previewAnswered();

    expect(await screen.findByRole('heading', { name: en.register.invitationTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(en.register.emailLabel)).toBeInTheDocument();
  });
});
