/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11806 — the console's `/register` when the server cannot be
 * reached.
 *
 * The page reads `/api/v1/auth/config` to decide what a visitor is offered. It
 * stored a failed read as `{ config: null }`, and `decideSignUpOffer` answers
 * `null` as "offer the form" — so with the server down the page drew the full
 * registration form, and the visitor found out only on submit. `/login` had
 * the same defect; its pins are `LoginPage.server-unreachable-11806.test.tsx`
 * beside this file.
 *
 * The auth client is a stub whose `getConfig` is scripted read by read and,
 * like `createAuthClient`'s, shares one in-flight read between callers and
 * forgets a failed one. A scripted rejection stands for the real client's
 * final answer: `createAuthClient` retries the read itself before it rejects.
 * Visible text is read from the en locale pack, not copied here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient, AuthPublicConfig } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

const en = builtInLocales.en;
const CREATE_ACCOUNT = { name: en.auth.register.submitButton } as const;
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

/** Mount `/register` and `/login` as `App.tsx` routes them; `/login` is a marker. */
function renderRegister(client: AuthClient) {
  window.history.replaceState({}, '', '/register');
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<div data-testid="login-route" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

/** Let a settled promise's state update land before a negative assertion. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe('console RegisterPage — the server cannot be reached (objectui#11806)', () => {
  it('while the config read is pending, offers no form and does not call the server unreachable', async () => {
    const { client } = scriptedClient([() => new Promise<never>(() => {})]);
    renderRegister(client);

    await waitFor(() => expect(client.getConfig).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
    expect(screen.queryByTestId('register-by-invitation')).toBeNull();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });

  it('when the config read fails, shows "Cannot connect to server" and Retry in place of the form', async () => {
    const { client } = scriptedClient([BAD_GATEWAY]);
    renderRegister(client);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(UNREACHABLE)).toBeInTheDocument();
    expect(within(alert).getByText(en.console.error.checkServer)).toBeInTheDocument();
    expect(screen.getByRole('button', RETRY)).toBeEnabled();
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
    expect(screen.queryByLabelText(en.auth.register.nameLabel)).toBeNull();
  });

  it('Retry reads the config again; an open answer brings the form', async () => {
    const second = deferred<AuthPublicConfig>();
    const { client, serverReads } = scriptedClient([BAD_GATEWAY, () => second.promise]);
    renderRegister(client);

    await userEvent.click(await screen.findByRole('button', RETRY));

    // In flight: still the unreachable state, the button busy — no form yet.
    expect(screen.getByRole('button', RETRYING)).toBeDisabled();
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
    expect(serverReads()).toBe(2);

    second.resolve(OPEN);

    expect(await screen.findByRole('button', CREATE_ACCOUNT)).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });

  it('Retry reads the config again; a disableSignUp: true answer bounces to /login, never showing the form', async () => {
    const { client } = scriptedClient([BAD_GATEWAY, () => Promise.resolve(SIGN_UP_OFF)]);
    renderRegister(client);

    await userEvent.click(await screen.findByRole('button', RETRY));

    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
    expect(screen.queryByRole('button', CREATE_ACCOUNT)).toBeNull();
  });
});
