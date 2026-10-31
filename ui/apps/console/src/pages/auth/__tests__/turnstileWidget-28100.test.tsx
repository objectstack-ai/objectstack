/**
 * objectstack#28100 — the Console's sign-up surfaces render the opt-in
 * Turnstile challenge exactly when the server serves
 * `features.turnstileSiteKey`.
 *
 * Two pages post `/sign-up/email`: `/register` and the first-run `/setup`
 * wizard (the first owner registers through the same door). With the key,
 * the server refuses a sign-up without a token, so both render the widget
 * with that key and hold their submit until it is solved; without it, neither
 * draws anything new. The wire half (the token as `x-captcha-response`) is
 * pinned in `@object-ui/auth`'s `registerTurnstile-28100.test.tsx`.
 *
 * Cloudflare's script is never loaded: `window.turnstile` is a double.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient, TurnstileApi } from '@object-ui/auth';
import { I18nProvider } from '@object-ui/i18n';
import { RegisterPage } from '../RegisterPage';
import { SetupPage } from '../SetupPage';

const SITE_KEY = 'site-key-console';

function clientFor(config: Record<string, unknown>): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
}

function renderAt(path: '/register' | '/setup', config: Record<string, unknown>) {
  window.history.replaceState({}, '', path);
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={clientFor(config)}>
        <MemoryRouter initialEntries={[path]}>
          {path === '/register' ? <RegisterPage /> : <SetupPage />}
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

let render_: ReturnType<typeof vi.fn>;

beforeEach(() => {
  render_ = vi.fn(() => 'widget-1');
  window.turnstile = { render: render_, reset: vi.fn(), remove: vi.fn() } as unknown as TurnstileApi;
  // `/setup`'s bootstrap probe: a fresh deployment, so the wizard renders.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ hasOwner: false }) })));
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/register and the Turnstile challenge (objectstack#28100)', () => {
  it('renders the widget with the served site key, and holds submit until it is solved', async () => {
    renderAt('/register', { features: { turnstileSiteKey: SITE_KEY } });

    await screen.findByLabelText('Confirm Password');
    expect(screen.getByTestId('turnstile-widget')).toBeInTheDocument();
    await waitFor(() => expect(render_).toHaveBeenCalled());
    expect(render_.mock.calls[0][1]).toMatchObject({ sitekey: SITE_KEY });
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  });

  it('renders no widget when the config serves no site key', async () => {
    renderAt('/register', { features: {} });

    await screen.findByLabelText('Confirm Password');
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(render_).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create Account' })).not.toBeDisabled();
  });
});

describe('/setup and the Turnstile challenge (objectstack#28100)', () => {
  it('renders the widget with the served site key, and holds submit until it is solved', async () => {
    renderAt('/setup', { features: { turnstileSiteKey: SITE_KEY } });

    expect(await screen.findByTestId('turnstile-widget')).toBeInTheDocument();
    await waitFor(() => expect(render_).toHaveBeenCalled());
    expect(render_.mock.calls[0][1]).toMatchObject({ sitekey: SITE_KEY });
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeDisabled();
  });

  it('renders no widget when the config serves no site key', async () => {
    renderAt('/setup', { features: {} });

    await screen.findByLabelText('Your name');
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create owner account' })).not.toBeDisabled();
  });
});
