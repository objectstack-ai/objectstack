/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12762 — `DefaultLoginPage`, the login page this package publishes
 * for hosts, renders `LoginForm`'s SSO copy and its phone sign-in copy in the
 * session's language.
 *
 * It passed `LoginForm` none of the four SSO labels and none of the ten phone
 * and verification-code labels, so `LoginForm` drew its English defaults
 * there. The page now passes every `LoginFormLabels` member from the
 * `auth.login.*` key of the same name — the keys the console's own login page
 * reads. Its pins are `LoginPage.ssoLabels-12762.test.tsx` and the
 * enumeration pin over both pages, `loginFormLabels-everyMember-12762.test.tsx`,
 * in `apps/console/src/pages/auth/__tests__`.
 *
 * Rendered with the real form, a real `AuthProvider` over a stub client and a
 * real `I18nProvider`. The Chinese is read from the zh bundle, not copied here;
 * what is pinned is that the page draws the bundle's value and not the English
 * default.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, type AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

afterEach(cleanup);

const SSO_CONFIG = {
  socialProviders: [{ id: 'acme', name: 'Acme IdP', enabled: true, type: 'oidc' }],
  emailPassword: { enabled: true, disableSignUp: false },
  features: { sso: true, ssoEnforced: true },
};

const PHONE_CONFIG = {
  socialProviders: [],
  emailPassword: { enabled: true, disableSignUp: false },
  features: { phoneNumber: true, phoneNumberOtp: true },
};

/** `LoginForm`'s own English default for each of the four SSO labels. */
const SSO_ENGLISH = {
  ssoOnlyDescription: "Sign in with your organization's single sign-on",
  usePasswordText: 'Use a password instead',
  backToSsoText: 'Back to single sign-on',
  ssoButton: 'Sign in with SSO',
} as const;
const SSO_KEYS = Object.keys(SSO_ENGLISH) as Array<keyof typeof SSO_ENGLISH>;

function createMockClient(config: Record<string, unknown>): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
}

function renderLogin(language: 'zh' | 'en', config: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={createMockClient(config)}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

async function expectSsoCopy(expected: Record<keyof typeof SSO_ENGLISH, string>) {
  expect(await screen.findByText(expected.ssoOnlyDescription)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: expected.usePasswordText }));
  expect(await screen.findByRole('button', { name: expected.backToSsoText })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: expected.ssoButton })).toBeInTheDocument();
}

describe('DefaultLoginPage — SSO copy (objectui#12762)', () => {
  it('draws the zh bundle value of each SSO label under zh, and no English default', async () => {
    const zh = builtInLocales.zh.auth.login;
    for (const key of SSO_KEYS) {
      expect(typeof zh[key], `zh auth.login.${key}`).toBe('string');
      expect(zh[key], `zh auth.login.${key}`).not.toBe(SSO_ENGLISH[key]);
    }

    renderLogin('zh', SSO_CONFIG);
    await expectSsoCopy(zh);
    for (const key of SSO_KEYS) expect(screen.queryByText(SSO_ENGLISH[key]), key).toBeNull();
  });

  it("is LoginForm's own English under en", async () => {
    renderLogin('en', SSO_CONFIG);
    await expectSsoCopy(SSO_ENGLISH);
  });
});

describe('DefaultLoginPage — phone sign-in copy under zh (objectui#12762)', () => {
  it('draws the zh bundle value of the phone and verification-code labels', async () => {
    const zh = builtInLocales.zh.auth.login;
    const en = builtInLocales.en.auth.login;
    renderLogin('zh', PHONE_CONFIG);

    // Phone + password: the identifier field accepts either.
    expect(await screen.findByLabelText(zh.emailOrPhoneLabel)).toHaveAttribute(
      'placeholder',
      zh.emailOrPhonePlaceholder,
    );
    fireEvent.click(screen.getByRole('button', { name: zh.usePhoneOtpText }));

    // Phone + verification code.
    expect(await screen.findByLabelText(zh.phoneLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(zh.otpCodeLabel)).toHaveAttribute('placeholder', zh.otpCodePlaceholder);
    expect(screen.getByRole('button', { name: zh.sendOtpButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zh.usePasswordSignInText })).toBeInTheDocument();
    for (const key of ['phoneLabel', 'otpCodeLabel', 'sendOtpButton', 'usePasswordSignInText'] as const) {
      expect(screen.queryByText(en[key]), key).toBeNull();
    }
  });
});
