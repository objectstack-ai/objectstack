/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12762 — the console login page renders `LoginForm`'s SSO copy in the
 * session's language.
 *
 * On a zh-CN console with SSO-only mode on, the line above the federated
 * button ("Sign in with your organization's single sign-on") and the
 * break-glass link ("Use a password instead") read English, and so did the
 * SSO button and the link back once the password form was opened: no host
 * passed those four labels and no bundle had keys for them, so `LoginForm`
 * drew its own English defaults. The page now passes `auth.login.ssoButton`,
 * `ssoOnlyDescription`, `usePasswordText` and `backToSsoText`.
 *
 * Rendered as shipped: the console page, `@object-ui/auth`'s real form, a real
 * `AuthProvider` and a real `I18nProvider`; only the auth client is a stub,
 * answering `/auth/config` with SSO on and enforced and one OIDC provider.
 * The Chinese is read from the zh bundle, not copied here; what is pinned is
 * that the page draws the bundle's value and not the English default.
 *
 * Every other label member is held by the enumeration pin beside this file,
 * `loginFormLabels-everyMember-12762.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
});

const CONFIG = {
  socialProviders: [{ id: 'acme', name: 'Acme IdP', enabled: true, type: 'oidc' }],
  emailPassword: { enabled: true, disableSignUp: false },
  features: { sso: true, ssoEnforced: true },
};

/** `LoginForm`'s own English default for each of the four labels. */
const ENGLISH = {
  ssoOnlyDescription: "Sign in with your organization's single sign-on",
  usePasswordText: 'Use a password instead',
  backToSsoText: 'Back to single sign-on',
  ssoButton: 'Sign in with SSO',
} as const;
const SSO_KEYS = Object.keys(ENGLISH) as Array<keyof typeof ENGLISH>;

function createMockClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(CONFIG),
  } as unknown as AuthClient;
}

function renderLogin(language: 'zh' | 'en') {
  window.history.replaceState({}, '', '/login');
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

/**
 * Reads the four SSO strings through the SSO-only view and the break-glass
 * form it opens, asserting each one renders as `expected`.
 */
async function expectSsoCopy(expected: Record<keyof typeof ENGLISH, string>) {
  expect(await screen.findByText(expected.ssoOnlyDescription)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: expected.usePasswordText }));
  expect(await screen.findByRole('button', { name: expected.backToSsoText })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: expected.ssoButton })).toBeInTheDocument();
}

describe('console LoginPage — SSO copy under zh (objectui#12762)', () => {
  it('draws the zh bundle value of each SSO label, and no English default', async () => {
    const zh = builtInLocales.zh.auth.login;
    for (const key of SSO_KEYS) {
      expect(typeof zh[key], `zh auth.login.${key}`).toBe('string');
      expect(zh[key], `zh auth.login.${key}`).not.toBe(ENGLISH[key]);
    }

    renderLogin('zh');
    await expectSsoCopy(zh);
    for (const key of SSO_KEYS) expect(screen.queryByText(ENGLISH[key]), key).toBeNull();
  });
});

describe('console LoginPage — SSO copy under en (objectui#12762)', () => {
  it("is LoginForm's own English: the en bundle carries the defaults verbatim", async () => {
    const en = builtInLocales.en.auth.login;
    for (const key of SSO_KEYS) expect(en[key], `en auth.login.${key}`).toBe(ENGLISH[key]);

    renderLogin('en');
    await expectSsoCopy(ENGLISH);
  });
});
