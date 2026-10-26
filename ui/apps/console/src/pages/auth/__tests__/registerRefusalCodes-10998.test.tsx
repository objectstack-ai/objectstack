/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10998 — a refused self-registration is shown in the session's
 * language, not as the server's raw English message.
 *
 * The server's audience gate refuses `POST /auth/sign-up/email` with `403` and
 * one of two stable codes: `SELF_REGISTRATION_CLOSED` (the environment admits
 * new accounts by invitation only — the stock default) and
 * `EMAIL_DOMAIN_NOT_ALLOWED` (only allowlisted email domains may register).
 * `RegisterForm` shows `errorMessages[code]` when the page maps the code and
 * the server's `message` otherwise. `RegisterPage` mapped only the two
 * user-exists codes, so a zh-CN user read an English sentence that also named
 * the internal setting behind it.
 *
 * Rendered as shipped: the console page, `@object-ui/auth`'s real form, a real
 * `AuthProvider` over a real `createAuthClient`, and a real `I18nProvider`.
 * Only `fetch` is a stub, answering `/sign-up/email` the way the server does.
 *
 * The expected text is read from the locale packs rather than copied here, so
 * the pin holds the mapping and not the wording.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

// The zh catalogue is otherwise fetched by a lazy `import()` on first render;
// making it resident here keeps that load out of the `findBy*` windows below.
registerBuiltInLocales();

const AUTH_URL = 'http://localhost/api/v1/auth';

/** The server's own `message` for each refusal, as the audience gate sends it. */
const SERVER_MESSAGE = {
  SELF_REGISTRATION_CLOSED:
    'Self-registration is closed on this environment (audience posture invite_only). ' +
    'Ask an administrator for an invitation.',
  EMAIL_DOMAIN_NOT_ALLOWED:
    'Self-registration on this environment is limited to approved email domains, and this address ' +
    'is not on the list. Use your organization email, or ask an administrator for an invitation.',
} as const;

/** A signed-out visitor; `/sign-up/email` answers 403 with `{ code, message }`. */
function refusingServer(code: string, message: string): typeof fetch {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-up/email')) return json(403, { code, message });
    if (url.endsWith('/config')) return json(200, {});
    return json(200, null);
  }) as typeof fetch;
}

type Lang = 'zh' | 'en';

/** Labels as the page renders them in `lang`, read from that pack. */
function registerLabels(lang: Lang) {
  const r = builtInLocales[lang].auth.register;
  return {
    name: r.nameLabel,
    email: r.emailLabel,
    password: r.passwordLabel,
    confirm: r.confirmPasswordLabel,
    submit: r.submitButton,
  };
}

/** Submit the form against a server that refuses with `code`; return the banner text. */
async function submitRefused(lang: Lang, code: string, message: string): Promise<string> {
  window.history.replaceState({}, '', '/register');
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn: refusingServer(code, message) });
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={['/register']}>
          <RegisterPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

  const l = registerLabels(lang);
  await userEvent.type(await screen.findByLabelText(l.name), 'Wang Wei');
  await userEvent.type(screen.getByLabelText(l.email), 'someone@example.com');
  await userEvent.type(screen.getByLabelText(l.password), 'hunter2hunter2');
  await userEvent.type(screen.getByLabelText(l.confirm), 'hunter2hunter2');
  await userEvent.click(screen.getByRole('button', { name: l.submit }));

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

const zhErrors = builtInLocales.zh.auth.register.errors;
const enErrors = builtInLocales.en.auth.register.errors;

describe('console RegisterPage — audience refusals under zh-CN (objectui#10998)', () => {
  it('the zh pack translates both refusals (so the assertions below can tell zh from English)', () => {
    expect(zhErrors.selfRegistrationClosed).not.toBe(enErrors.selfRegistrationClosed);
    expect(zhErrors.emailDomainNotAllowed).not.toBe(enErrors.emailDomainNotAllowed);
  });

  it('SELF_REGISTRATION_CLOSED shows the localized text, not the server message', async () => {
    const text = await submitRefused(
      'zh',
      'SELF_REGISTRATION_CLOSED',
      SERVER_MESSAGE.SELF_REGISTRATION_CLOSED,
    );
    expect(text).toBe(zhErrors.selfRegistrationClosed);
    expect(screen.queryByText(SERVER_MESSAGE.SELF_REGISTRATION_CLOSED)).toBeNull();
    expect(document.body.textContent).not.toMatch(/audience posture/);
  });

  it('EMAIL_DOMAIN_NOT_ALLOWED shows the localized text, not the server message', async () => {
    const text = await submitRefused(
      'zh',
      'EMAIL_DOMAIN_NOT_ALLOWED',
      SERVER_MESSAGE.EMAIL_DOMAIN_NOT_ALLOWED,
    );
    expect(text).toBe(zhErrors.emailDomainNotAllowed);
    expect(screen.queryByText(SERVER_MESSAGE.EMAIL_DOMAIN_NOT_ALLOWED)).toBeNull();
  });

  it('a code the page does not map still shows the raw server message', async () => {
    const raw = 'The server refused this sign-up for a reason the console has no text for.';
    const text = await submitRefused('zh', 'UNMAPPED_REFUSAL_FOR_TEST', raw);
    expect(text).toBe(raw);
  });
});

describe('console RegisterPage — audience refusals under en (objectui#10998)', () => {
  it('SELF_REGISTRATION_CLOSED resolves the en pack text through the same map', async () => {
    const text = await submitRefused(
      'en',
      'SELF_REGISTRATION_CLOSED',
      SERVER_MESSAGE.SELF_REGISTRATION_CLOSED,
    );
    expect(text).toBe(enErrors.selfRegistrationClosed);
    expect(document.body.textContent).not.toMatch(/audience posture/);
  });
});
