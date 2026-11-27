/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34171 — a cloud-managed runtime refuses "Forgot password?" with
 * 409 `RESOURCE_CONFLICT` in the ADR-0112 envelope, because no local password
 * is set or reset there for anyone. The forgot-password page this package
 * publishes shows that refusal in the session's language and points at the
 * identity provider's button, not the server's English sentence.
 *
 * Rendered as shipped: the exported page, `@object-ui/auth`'s real form, a real
 * `AuthProvider` over a real `createAuthClient`, and a real `I18nProvider`.
 * Only `fetch` is a stub. The expected text is read from the locale packs.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, createAuthClient } from '@object-ui/auth';
import { ForgotPasswordPage } from '../ForgotPasswordPage';
import { passwordDoorRefusalMessages, signInRefusalMessages } from '../signInRefusalMessages';

registerBuiltInLocales();

const AUTH_URL = 'http://localhost/api/v1/auth';
const MANAGED_SENTENCE =
  "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and no "
  + 'local password is set or reset here for anyone, an administrator included. No reset link or code was sent.';

/** `/request-password-reset` answers `body` with `status`; everything else answers empty. */
function server(status: number, body: unknown): typeof fetch {
  const json = (s: number, b: unknown) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/request-password-reset')) return json(status, body);
    if (url.endsWith('/config')) return json(200, {});
    return json(200, null);
  }) as typeof fetch;
}

async function submitAgainst(fetchFn: typeof fetch): Promise<string> {
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <MemoryRouter initialEntries={['/forgot-password']}>
          <ForgotPasswordPage />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
  const l = builtInLocales['zh-Hans'].auth.forgotPassword;
  await userEvent.type(await screen.findByLabelText(l.emailLabel), 'someone@example.com');
  await userEvent.click(screen.getByRole('button', { name: l.submitButton }));
  return (await screen.findByRole('alert')).textContent ?? '';
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

describe('ForgotPasswordPage — a cloud-managed reset refusal is localized (objectstack#34171)', () => {
  it('the zh pack translates the managed reset sentence', () => {
    expect(zhErrors.managedPasswordReset).toBeTruthy();
    expect(zhErrors.managedPasswordReset).not.toBe(enErrors.managedPasswordReset);
  });

  it('409 RESOURCE_CONFLICT in the envelope shows the localized sentence, not the server text', async () => {
    const text = await submitAgainst(
      server(409, { success: false, error: { code: 'RESOURCE_CONFLICT', message: MANAGED_SENTENCE } }),
    );
    expect(text).toBe(zhErrors.managedPasswordReset);
    expect(screen.queryByText(MANAGED_SENTENCE)).toBeNull();
  });

  it('CONTROL: another refusal still shows its own server message', async () => {
    const raw = 'The server refused this reset for a reason the page has no text for.';
    const text = await submitAgainst(server(400, { code: 'UNMAPPED_REFUSAL_FOR_TEST', message: raw }));
    expect(text).toBe(raw);
  });
});

describe('passwordDoorRefusalMessages — the reset doors carry only the managed sentence (objectstack#34171)', () => {
  const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

  it('maps RESOURCE_CONFLICT and nothing from the sign-in step', () => {
    const map = passwordDoorRefusalMessages(t);
    expect(Object.keys(map)).toEqual(['RESOURCE_CONFLICT']);
    // The sign-in map's two-factor sentence must not reach a reset door.
    expect(map.INVALID_CODE).toBeUndefined();
    expect(signInRefusalMessages(t).INVALID_CODE).toBeTruthy();
  });

  it('the sign-in and reset sentences differ: the sign-in one points above, the reset one at the sign-in page', () => {
    expect(passwordDoorRefusalMessages(t).RESOURCE_CONFLICT).not.toBe(signInRefusalMessages(t).RESOURCE_CONFLICT);
  });
});
