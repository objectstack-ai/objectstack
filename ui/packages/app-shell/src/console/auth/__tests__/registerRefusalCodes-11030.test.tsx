/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11030 — `DefaultRegisterPage`, the register page this package
 * publishes for hosts (`examples/console-starter` mounts it at `/register`),
 * shows a refused sign-up in the session's language, not as the server's raw
 * English message.
 *
 * objectui#10998 fixed the console app's own page; this one passed no
 * `errorMessages` at all, so `RegisterForm` fell back to `authError.message`
 * for every code — including `SELF_REGISTRATION_CLOSED`, whose message names
 * the internal setting behind it. Both pages now pass `signUpRefusalMessages`.
 * The console page keeps its own pin
 * (`apps/console/src/pages/auth/__tests__/registerRefusalCodes-10998.test.tsx`),
 * unchanged, as the control that the shared map keeps the console behaviour.
 *
 * Rendered as shipped: the exported page, `@object-ui/auth`'s real form, a
 * real `AuthProvider` over a real `createAuthClient`, and a real
 * `I18nProvider`. Only `fetch` is a stub, answering `/sign-up/email` the way
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
import { RegisterPage } from '../RegisterPage';

// The zh catalogue is otherwise fetched by a lazy `import()` on first render;
// making it resident here keeps that load out of the `findBy*` windows below.
registerBuiltInLocales();

const AUTH_URL = 'http://localhost/api/v1/auth';

/** The server's own `message` for each refusal, as the server sends it. */
const SERVER_MESSAGE = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'User already exists. Use another email.',
  USER_ALREADY_EXISTS: 'User already exists.',
  SELF_REGISTRATION_CLOSED:
    'Self-registration is closed on this environment (audience posture invite_only). ' +
    'Ask an administrator for an invitation.',
  EMAIL_DOMAIN_NOT_ALLOWED:
    'Self-registration on this environment is limited to approved email domains, and this address ' +
    'is not on the list. Use your organization email, or ask an administrator for an invitation.',
} as const;

type RefusalCode = keyof typeof SERVER_MESSAGE;

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

/** Submit the zh form against a server that refuses with `code`; return the banner text. */
async function submitRefused(code: string, message: string): Promise<string> {
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn: refusingServer(code, message) });
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={['/register']}>
          <RegisterPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

  const r = builtInLocales.zh.auth.register;
  await userEvent.type(await screen.findByLabelText(r.nameLabel), 'Wang Wei');
  await userEvent.type(screen.getByLabelText(r.emailLabel), 'someone@example.com');
  await userEvent.type(screen.getByLabelText(r.passwordLabel), 'hunter2hunter2');
  await userEvent.type(screen.getByLabelText(r.confirmPasswordLabel), 'hunter2hunter2');
  await userEvent.click(screen.getByRole('button', { name: r.submitButton }));

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

const EXPECTED: Record<RefusalCode, string> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: zhErrors.userExists,
  USER_ALREADY_EXISTS: zhErrors.userExists,
  SELF_REGISTRATION_CLOSED: zhErrors.selfRegistrationClosed,
  EMAIL_DOMAIN_NOT_ALLOWED: zhErrors.emailDomainNotAllowed,
};

describe('DefaultRegisterPage — sign-up refusals under zh-CN (objectui#11030)', () => {
  it('the zh pack translates all three refusal keys (so the assertions below can tell zh from English)', () => {
    expect(zhErrors.userExists).not.toBe(enErrors.userExists);
    expect(zhErrors.selfRegistrationClosed).not.toBe(enErrors.selfRegistrationClosed);
    expect(zhErrors.emailDomainNotAllowed).not.toBe(enErrors.emailDomainNotAllowed);
  });

  it.each(Object.keys(SERVER_MESSAGE) as RefusalCode[])(
    '%s shows the localized text, not the server message',
    async (code) => {
      const text = await submitRefused(code, SERVER_MESSAGE[code]);
      expect(text).toBe(EXPECTED[code]);
      expect(screen.queryByText(SERVER_MESSAGE[code])).toBeNull();
      expect(document.body.textContent).not.toMatch(/audience posture/);
    },
  );

  it('a code the page does not map still shows the raw server message', async () => {
    const raw = 'The server refused this sign-up for a reason the page has no text for.';
    const text = await submitRefused('UNMAPPED_REFUSAL_FOR_TEST', raw);
    expect(text).toBe(raw);
  });
});
