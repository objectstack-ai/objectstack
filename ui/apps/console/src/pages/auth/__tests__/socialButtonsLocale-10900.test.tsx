/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10900 — the environment login and sign-up pages render their social
 * provider button and the divider under it in the session's language.
 *
 * The 2026-09-28 cloud E2E, browser in zh-CN, read `Continue with ObjectStack`
 * and `OR CONTINUE WITH EMAIL` (the capitals are the divider's `uppercase`
 * class) on the environment login page. Both were `SocialSignInButtons`
 * defaults that no label reached. The pages now pass `auth.login.*` /
 * `auth.register.*` `socialButton` and `orText` through the forms' `labels`.
 *
 * Rendered as shipped: the console page, `@object-ui/auth`'s real form and
 * buttons, a real `AuthProvider` and a real `I18nProvider`; only the auth
 * client is a stub, answering `/auth/config` with one social provider. The
 * provider's own name stays as the server reports it.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
});

const CONFIG = {
  socialProviders: [{ id: 'objectstack-cloud', name: 'ObjectStack', enabled: true, type: 'oidc' }],
  emailPassword: { enabled: true, disableSignUp: false },
};

function createMockClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(CONFIG),
  } as unknown as AuthClient;
}

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function renderAt(path: '/login' | '/register', config: typeof ZH | typeof EN) {
  window.history.replaceState({}, '', path);
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
        <MemoryRouter initialEntries={[path]}>
          {path === '/login' ? <LoginPage /> : <RegisterPage />}
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

// Button names are matched at their END: an unknown provider id renders a
// one-letter icon badge inside the button, ahead of the label.
describe('console LoginPage — social sign-in under zh-CN (objectui#10900)', () => {
  it('renders the button and the divider in Chinese under zh', async () => {
    renderAt('/login', ZH);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 继续$/ })).toBeInTheDocument();
    expect(screen.getByText('或使用邮箱继续')).toBeInTheDocument();
    expect(screen.queryByText(/Continue with/)).toBeNull();
    expect(screen.queryByText('or continue with email')).toBeNull();
  });

  it('stays English under en', async () => {
    renderAt('/login', EN);
    expect(await screen.findByRole('button', { name: /Continue with ObjectStack$/ })).toBeInTheDocument();
    expect(screen.getByText('or continue with email')).toBeInTheDocument();
  });
});

describe('console RegisterPage — social sign-up under zh-CN (objectui#10900)', () => {
  it('renders the button and the divider in Chinese under zh', async () => {
    renderAt('/register', ZH);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 注册$/ })).toBeInTheDocument();
    expect(screen.getByText('或使用邮箱继续')).toBeInTheDocument();
    expect(screen.queryByText(/Sign up with/)).toBeNull();
  });

  it('stays English under en', async () => {
    renderAt('/register', EN);
    expect(await screen.findByRole('button', { name: /Sign up with ObjectStack$/ })).toBeInTheDocument();
    expect(screen.getByText('or continue with email')).toBeInTheDocument();
  });
});
