// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10900 — `DefaultLoginPage` / `DefaultRegisterPage`, the auth pages
 * this package publishes for hosts, localize the social provider button and
 * the divider under it the same way the console's own pages do.
 *
 * The console app's pages carry the E2E finding's pin
 * (`apps/console/src/pages/auth/__tests__/socialButtonsLocale-10900.test.tsx`);
 * these two are the other callers of `LoginForm` / `RegisterForm` in the tree,
 * and were left passing no social labels at all. Rendered with the real forms,
 * a real `AuthProvider` over a stub client and a real `I18nProvider`.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { AuthProvider, type AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { RegisterPage } from '../RegisterPage';

afterEach(cleanup);

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

function renderPage(page: 'login' | 'register', config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
        <MemoryRouter>{page === 'login' ? <LoginPage /> : <RegisterPage />}</MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

// Button names are matched at their END: an unknown provider id renders a
// one-letter icon badge inside the button, ahead of the label.
describe('DefaultLoginPage / DefaultRegisterPage — social labels (objectui#10900)', () => {
  it('login: Chinese under zh', async () => {
    renderPage('login', ZH);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 继续$/ })).toBeInTheDocument();
    expect(screen.getByText('或使用邮箱继续')).toBeInTheDocument();
  });

  it('login: English under en', async () => {
    renderPage('login', EN);
    expect(await screen.findByRole('button', { name: /Continue with ObjectStack$/ })).toBeInTheDocument();
    expect(screen.getByText('or continue with email')).toBeInTheDocument();
  });

  it('register: Chinese under zh', async () => {
    renderPage('register', ZH);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 注册$/ })).toBeInTheDocument();
    expect(screen.getByText('或使用邮箱继续')).toBeInTheDocument();
  });

  it('register: English under en', async () => {
    renderPage('register', EN);
    expect(await screen.findByRole('button', { name: /Sign up with ObjectStack$/ })).toBeInTheDocument();
    expect(screen.getByText('or continue with email')).toBeInTheDocument();
  });
});
