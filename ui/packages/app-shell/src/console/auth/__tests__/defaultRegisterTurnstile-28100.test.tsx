/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28100 — `DefaultRegisterPage` renders the opt-in Turnstile
 * challenge exactly when the server's auth config serves
 * `features.turnstileSiteKey`, as the console's own `/register` does
 * (`apps/console/src/pages/auth/__tests__/turnstileWidget-28100.test.tsx`).
 * The wire half is `@object-ui/auth`'s `registerTurnstile-28100.test.tsx`.
 *
 * Cloudflare's script is never loaded: `window.turnstile` is a double.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient, TurnstileApi } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

const en = builtInLocales.en.auth;
const SITE_KEY = 'site-key-default-page';

function renderRegister(config: Record<string, unknown>) {
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="http://localhost/api/v1/auth" client={client}>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

let renderWidget: ReturnType<typeof vi.fn>;

beforeEach(() => {
  renderWidget = vi.fn(() => 'widget-1');
  window.turnstile = { render: renderWidget, reset: vi.fn(), remove: vi.fn() } as unknown as TurnstileApi;
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe('DefaultRegisterPage and the Turnstile challenge (objectstack#28100)', () => {
  it('renders the widget with the served site key and holds submit until it is solved', async () => {
    renderRegister({ features: { turnstileSiteKey: SITE_KEY } });

    await screen.findByLabelText(en.register.confirmPasswordLabel);
    expect(screen.getByTestId('turnstile-widget')).toBeInTheDocument();
    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    expect(renderWidget.mock.calls[0][1]).toMatchObject({ sitekey: SITE_KEY });
    expect(screen.getByRole('button', { name: en.register.submitButton })).toBeDisabled();
  });

  it('renders no widget when the config serves no site key', async () => {
    renderRegister({ features: {} });

    await screen.findByLabelText(en.register.confirmPasswordLabel);
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(renderWidget).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en.register.submitButton })).not.toBeDisabled();
  });
});
