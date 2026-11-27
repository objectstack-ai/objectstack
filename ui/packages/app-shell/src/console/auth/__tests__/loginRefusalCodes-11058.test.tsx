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

/**
 * A signed-out visitor; `/sign-in/email` answers with `{ code, message }`, plus
 * any further body fields the server sends (`details`).
 */
function refusingServer(
  status: number,
  code: string,
  message: string,
  config: unknown = {},
  extra: Record<string, unknown> = {},
): typeof fetch {
  const json = (s: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: s, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-in/email')) return json(status, { code, message, ...extra });
    if (url.endsWith('/config')) return json(200, config);
    return json(200, null);
  }) as typeof fetch;
}

/** Submit the zh form against a server that refuses with `code`; return the banner text. */
async function submitRefused(
  status: number,
  code: string,
  message: string,
  config?: unknown,
  extra?: Record<string, unknown>,
): Promise<string> {
  return submitAgainst(refusingServer(status, code, message, config, extra));
}

/** Submit the zh form against `fetchFn`; return the banner text. */
async function submitAgainst(fetchFn: typeof fetch): Promise<string> {
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

  const l = builtInLocales['zh-Hans'].auth.login;
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

const zhErrors = builtInLocales['zh-Hans'].auth.login.errors;
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

describe('DefaultLoginPage — with no mail service, a wrong password points to the administrator (objectstack#32021)', () => {
  const { status, message } = SERVER_REFUSAL.INVALID_EMAIL_OR_PASSWORD;
  const noMail = { success: true, data: { features: { emailDelivery: false } } };

  it('the zh pack translates the no-mail text', () => {
    expect(zhErrors.invalidCredentialsNoMail).not.toBe(enErrors.invalidCredentialsNoMail);
    expect(zhErrors.invalidCredentialsNoMail).not.toBe(zhErrors.invalidCredentials);
  });

  it('features.emailDelivery: false — the refusal asks the administrator, in the session language', async () => {
    // The config read lands before the visitor finishes typing.
    const text = await submitRefused(status, 'INVALID_EMAIL_OR_PASSWORD', message, noMail);
    expect(text).toBe(zhErrors.invalidCredentialsNoMail);
  });

  it('CONTROL: features.emailDelivery: true keeps the reset hint', async () => {
    const text = await submitRefused(status, 'INVALID_EMAIL_OR_PASSWORD', message, {
      success: true,
      data: { features: { emailDelivery: true } },
    });
    expect(text).toBe(zhErrors.invalidCredentials);
  });
});

// objectstack#32432 — plugin-auth refuses the password sign-in of an account its
// identity provider deactivated through SCIM with better-auth's `403
// BANNED_USER` and `details: { cause: 'scim_deactivated' }`; an
// administrator's ban answers the same status, code and message with no
// `details`. The page tells them apart by `code` and `details.cause`, never by
// the message: the whole read path runs here, from the fetch answer through
// `createAuthClient` and `LoginForm` to this package's map and the zh pack.
describe('DefaultLoginPage — a SCIM-deactivated sign-in is not shown as a ban (objectstack#32432)', () => {
  const BAN_MESSAGE =
    'You have been banned from this application. Please contact support if you believe this is an error.';

  it('the zh pack translates the deactivation sentence', () => {
    expect(zhErrors.accountDeactivated).toBeTruthy();
    expect(zhErrors.accountDeactivated).not.toBe(enErrors.accountDeactivated);
  });

  it('details.cause scim_deactivated shows the deactivation sentence, not the ban message', async () => {
    const text = await submitRefused(403, 'BANNED_USER', BAN_MESSAGE, undefined, {
      details: { cause: 'scim_deactivated' },
    });
    expect(text).toBe(zhErrors.accountDeactivated);
    expect(screen.queryByText(BAN_MESSAGE)).toBeNull();
  });

  it('CONTROL: an administrator\'s ban (no details) keeps the ban wording', async () => {
    const text = await submitRefused(403, 'BANNED_USER', BAN_MESSAGE);
    expect(text).toBe(BAN_MESSAGE);
  });
});

// objectstack#34171 — a cloud-managed runtime refuses the password sign-in with
// 409 `RESOURCE_CONFLICT` in the ADR-0112 envelope, `{ success: false, error:
// { code, message } }` (plugin-auth `cloudManagedRefusal`, and the hosted relay
// in front of it), not in better-auth's flat body. The whole read path runs:
// `createAuthClient` reads the envelope's code, `LoginForm` looks it up in this
// package's map, and the page shows the zh sentence that points at the
// identity provider's button, never the server's English sentence or the
// client's status line.
describe('DefaultLoginPage — a cloud-managed password refusal is localized (objectstack#34171)', () => {
  const HOSTED_SENTENCE =
    'This environment is hosted: everyone signs in through the cloud, with their own cloud account, and no local password '
    + 'is kept here for anyone. Sign in with ObjectOS Cloud. No password was set or accepted.';

  function envelopeServer(status: number, code: string, message: string): typeof fetch {
    const json = (s: number, body: unknown) =>
      new Response(JSON.stringify(body), { status: s, headers: { 'Content-Type': 'application/json' } });
    return (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/sign-in/email')) return json(status, { success: false, error: { code, message } });
      if (url.endsWith('/config')) return json(200, {});
      return json(200, null);
    }) as typeof fetch;
  }

  it('the zh pack translates the managed sign-in sentence', () => {
    expect(zhErrors.managedPasswordSignIn).toBeTruthy();
    expect(zhErrors.managedPasswordSignIn).not.toBe(enErrors.managedPasswordSignIn);
  });

  it('409 RESOURCE_CONFLICT in the envelope shows the localized sentence, not the server or status text', async () => {
    const text = await submitAgainst(envelopeServer(409, 'RESOURCE_CONFLICT', HOSTED_SENTENCE));
    expect(text).toBe(zhErrors.managedPasswordSignIn);
    expect(screen.queryByText(HOSTED_SENTENCE)).toBeNull();
    expect(screen.queryByText(/Auth request failed/)).toBeNull();
  });

  it('CONTROL: another code in the envelope still shows its own server message', async () => {
    const raw = 'The server refused this sign-in for a reason the page has no text for.';
    const text = await submitAgainst(envelopeServer(400, 'UNMAPPED_REFUSAL_FOR_TEST', raw));
    expect(text).toBe(raw);
  });
});
