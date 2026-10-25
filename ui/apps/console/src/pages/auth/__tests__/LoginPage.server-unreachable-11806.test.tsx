/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11806 — the console's `/login` when the server cannot be reached.
 *
 * The page reads `/api/v1/auth/config` to decide the "Sign up" offer. It held
 * that config as `null` both while the read was pending and after it failed,
 * and `decideSignUpOffer` answers `null` as "offer the link" — so with the
 * server down the page drew a live-looking form, offered "Sign up", and the
 * visitor found out only on submit.
 *
 * The auth client is a stub whose `getConfig` is scripted read by read and,
 * like `createAuthClient`'s, shares one in-flight read between callers and
 * forgets a failed one. A scripted rejection stands for the real client's
 * final answer: `createAuthClient` retries the read itself before it rejects.
 * Visible text is read from the en locale pack, not copied here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient, AuthPublicConfig } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

const en = builtInLocales.en;
const SIGN_UP_LINK = { name: en.auth.login.signUpText } as const;
const UNREACHABLE = en.console.error.connectionFailed;
const RETRY = { name: en.console.actions.retry } as const;
const RETRYING = { name: en.console.actions.retrying } as const;

/** What the real client rejects with once its own retries ran out on a 502. */
const BAD_GATEWAY = () => Promise.reject(new Error('Failed to load auth config (status 502)'));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A signed-out visitor whose config reads are answered, in order, by `reads`.
 * `serverReads()` counts the reads that reached the "server".
 */
function scriptedClient(reads: Array<() => Promise<AuthPublicConfig>>) {
  let inFlight: Promise<AuthPublicConfig> | null = null;
  let served = 0;
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn(() => {
      if (!inFlight) {
        const read = (reads[served] ?? (() => new Promise<never>(() => {})))();
        served += 1;
        inFlight = read;
        read.catch(() => {
          if (inFlight === read) inFlight = null;
        });
      }
      return inFlight;
    }),
  } as unknown as AuthClient;
  return { client, serverReads: () => served };
}

function renderLogin(client: AuthClient) {
  window.history.replaceState({}, '', '/login');
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

const OPEN: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: false },
  features: { audiencePosture: 'open' },
};
const SIGN_UP_OFF: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: true },
  features: { audiencePosture: 'open' },
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('console LoginPage — the server cannot be reached (objectui#11806)', () => {
  it('while the config read is pending, offers no "Sign up" and does not call the server unreachable', async () => {
    const { client } = scriptedClient([() => new Promise<never>(() => {})]);
    renderLogin(client);

    await screen.findByTestId('login-config-loading');
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });

  it('when the config read fails, replaces the form with "Cannot connect to server" and Retry, and offers no "Sign up"', async () => {
    const { client } = scriptedClient([BAD_GATEWAY]);
    renderLogin(client);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(UNREACHABLE)).toBeInTheDocument();
    expect(within(alert).getByText(en.console.error.checkServer)).toBeInTheDocument();
    expect(screen.getByRole('button', RETRY)).toBeEnabled();
    expect(screen.queryByLabelText(en.auth.login.emailLabel)).toBeNull();
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
  });

  it.each([
    ['open', OPEN, '/register'],
    ['disableSignUp: true', SIGN_UP_OFF, null],
  ] as const)(
    'Retry reads the config again; once a %s answer lands the form returns with the offer that answer decides',
    async (_label, config, signUpHref) => {
      const second = deferred<AuthPublicConfig>();
      const { client, serverReads } = scriptedClient([BAD_GATEWAY, () => second.promise]);
      renderLogin(client);

      await userEvent.click(await screen.findByRole('button', RETRY));

      // In flight: still the unreachable state, the button busy — no form yet.
      expect(screen.getByRole('button', RETRYING)).toBeDisabled();
      expect(screen.queryByLabelText(en.auth.login.emailLabel)).toBeNull();
      expect(serverReads()).toBe(2);

      second.resolve(config);

      await screen.findByLabelText(en.auth.login.emailLabel);
      expect(screen.queryByText(UNREACHABLE)).toBeNull();
      const link = screen.queryByRole('link', SIGN_UP_LINK);
      expect(link?.getAttribute('href') ?? null).toBe(signUpHref);
    },
  );
});
