/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11058 — `DefaultLoginPage`, the sign-in page this package publishes
 * for hosts (`examples/console-starter` mounts it at `/login`), shows a refused
 * sign-in in the session's language, not as the server's raw English message.
 *
 * It passed no `errorMessages` at all, so `LoginForm` fell back to
 * `authError.message` for every code. It now passes `signInRefusalMessages`,
 * the same map the console app's own login page passes — the sign-in twin of
 * objectui#11030 (`registerRefusalCodes-11030.test.tsx`).
 *
 * Rendered as shipped: the exported page, `@object-ui/auth`'s real form, a
 * real `AuthProvider` over a real `createAuthClient`, and a real
 * `I18nProvider`. Only `fetch` is a stub, answering `/sign-in/email` the way
 * the server does. The expected text is read from the locale packs rather
 * than copied here, so the pin holds the mapping and not the wording.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

// The zh catalogue is otherwise fetched by a lazy `import()` on first render;
// making it resident here keeps that load out of the `findBy*` windows below.
registerBuiltInLocales();

const AUTH_URL = 'http://localhost/api/v1/auth';

/** The server's own status and `message` for each refusal, as the server sends them. */
const SERVER_REFUSAL = {
  INVALID_EMAIL_OR_PASSWORD: { status: 401, message: 'Invalid email or password' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Email not verified' },
} as const;

type RefusalCode = keyof typeof SERVER_REFUSAL;

/** A signed-out visitor; `/sign-in/email` answers with `{ code, message }`. */
function refusingServer(status: number, code: string, message: string): typeof fetch {
  const json = (s: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: s, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-in/email')) return json(status, { code, message });
    if (url.endsWith('/config')) return json(200, {});
    return json(200, null);
  }) as typeof fetch;
}

/** Submit the zh form against a server that refuses with `code`; return the banner text. */
async function submitRefused(status: number, code: string, message: string): Promise<string> {
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn: refusingServer(status, code, message) });
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

  const l = builtInLocales.zh.auth.login;
  await userEvent.type(await screen.findByLabelText(l.emailLabel), 'someone@example.com');
  await userEvent.type(screen.getByLabelText(l.passwordLabel), 'hunter2hunter2');
  await userEvent.click(screen.getByRole('button', { name: l.submitButton }));

  const alert = await screen.findByRole('alert');
  return alert.textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const zhErrors = builtInLocales.zh.auth.login.errors;
const enErrors = builtInLocales.en.auth.login.errors;

const EXPECTED: Record<RefusalCode, string> = {
  INVALID_EMAIL_OR_PASSWORD: zhErrors.invalidCredentials,
  EMAIL_NOT_VERIFIED: zhErrors.emailNotVerified,
};

describe('DefaultLoginPage — sign-in refusals under zh-CN (objectui#11058)', () => {
  it('the zh pack translates both refusal keys (so the assertions below can tell zh from English)', () => {
    expect(zhErrors.invalidCredentials).not.toBe(enErrors.invalidCredentials);
    expect(zhErrors.emailNotVerified).not.toBe(enErrors.emailNotVerified);
  });

  it.each(Object.keys(SERVER_REFUSAL) as RefusalCode[])(
    '%s shows the localized text, not the server message',
    async (code) => {
      const { status, message } = SERVER_REFUSAL[code];
      const text = await submitRefused(status, code, message);
      expect(text).toBe(EXPECTED[code]);
      expect(screen.queryByText(message)).toBeNull();
    },
  );

  it('a code the page does not map still shows the raw server message', async () => {
    const raw = 'The server refused this sign-in for a reason the page has no text for.';
    const text = await submitRefused(400, 'UNMAPPED_REFUSAL_FOR_TEST', raw);
    expect(text).toBe(raw);
  });
});
