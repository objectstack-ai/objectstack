/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A toggle whose specifier declares `confirmOffText` asks before it goes off
 * (objectstack#30500, ruling A on objectstack#30418).
 *
 * The spec's `SpecifierSchema` declares the key on `toggle` specifiers:
 * "Confirm dialog text shown before a toggle's value changes to off (omit = no
 * confirm)", and `auth.manifest.ts` declares it on `email_password_enabled`.
 * The pins:
 *
 *   - declared, on → off: a confirmation carrying the text opens and the
 *     switch stays on; Cancel leaves it on with nothing in the draft and no
 *     PUT; Continue turns it off and the page's Save sends `false`;
 *   - declared, off → on: no confirmation, the change is drafted at once;
 *   - not declared: no confirmation, the off is drafted at once, as before;
 *   - the text resolves through `settings.NAMESPACE.keys.KEY.confirmOffText`,
 *     and a miss is the manifest literal, an inline locale map picked for the
 *     page's language.
 *
 * The whole page over a stubbed `fetch` and the REAL `../api` module, so the
 * save assertions read the PUT body as it leaves the client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  createI18n,
  I18nProvider,
  transformSpecTranslations,
  type SpecTranslationData,
} from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

/** `auth.manifest.ts`'s own literal for `email_password_enabled`. */
const CONFIRM_OFF = 'People who sign in with a password will need another way in.';
const PASSWORD_LABEL = 'Enable email/password login';
const SIGNUP_LABEL = 'Allow sign-up';

type Spec = Record<string, unknown>;

function payloadOf(passwordOn: boolean, extra: Partial<Spec> = {}) {
  return {
    manifest: {
      namespace: 'auth',
      version: 1,
      label: 'Authentication',
      specifiers: [
        {
          type: 'toggle',
          key: 'email_password_enabled',
          label: PASSWORD_LABEL,
          default: true,
          confirmOffText: CONFIRM_OFF,
          ...extra,
        },
        // No `confirmOffText`: behaves as before.
        { type: 'toggle', key: 'signup_enabled', label: SIGNUP_LABEL, default: true },
      ],
    },
    values: {
      email_password_enabled: { value: passwordOn, source: 'global', locked: false },
      signup_enabled: { value: true, source: 'global', locked: false },
    },
  };
}

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/** GET answers the page; PUT answers the values it was sent. */
function serve(payload: unknown) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(sent).map(([k, v]) => [k, { value: v, source: 'global', locked: false }]),
      );
      return ok({ success: true, data: { values } });
    }
    return ok({ success: true, data: structuredClone(payload) });
  });
}

function puts() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
}

function renderView(instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })) {
  return render(
    <I18nProvider instance={instance}>
      <MemoryRouter initialEntries={['/settings/auth']}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function switchFor(label: string): Promise<HTMLElement> {
  return screen.findByRole('switch', { name: label });
}

async function save() {
  fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(puts()).toHaveLength(1));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a toggle that declares confirmOffText asks before it goes off (objectstack#30500)', () => {
  it('turning it off opens a confirmation carrying the text, and the switch stays on', async () => {
    serve(payloadOf(true));
    renderView();
    const sw = await switchFor(PASSWORD_LABEL);
    expect(sw).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(sw);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(CONFIRM_OFF);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    // Nothing reached the draft while the question is open.
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });

  it('Cancel leaves the switch on, drafts nothing and sends nothing', async () => {
    serve(payloadOf(true));
    renderView();
    const sw = await switchFor(PASSWORD_LABEL);

    fireEvent.click(sw);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
    expect(puts()).toHaveLength(0);
    // Focus goes back to the switch the question was asked about.
    expect(document.activeElement).toBe(sw);
  });

  it('Continue turns the switch off, and Save sends false', async () => {
    serve(payloadOf(true));
    renderView();
    const sw = await switchFor(PASSWORD_LABEL);

    fireEvent.click(sw);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('settings-unsaved-count')).toHaveTextContent('1');

    await save();
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({
      email_password_enabled: false,
    });
  });

  it('turning it on asks nothing and drafts the change at once', async () => {
    serve(payloadOf(false));
    renderView();
    const sw = await switchFor(PASSWORD_LABEL);
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await save();
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({
      email_password_enabled: true,
    });
  });

  it('asks again on the next turn to off after a Continue and a turn back on', async () => {
    serve(payloadOf(true));
    renderView();
    const sw = await switchFor(PASSWORD_LABEL);

    fireEvent.click(sw);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(sw);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(CONFIRM_OFF);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});

describe('a toggle without confirmOffText changes at once, as before (objectstack#30500)', () => {
  it('turning it off asks nothing, and Save sends false', async () => {
    serve(payloadOf(true));
    renderView();
    const sw = await switchFor(SIGNUP_LABEL);

    fireEvent.click(sw);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await save();
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ signup_enabled: false });
  });
});

describe('the confirmOffText the dialog shows (objectstack#30500)', () => {
  it('reads settings.NAMESPACE.keys.KEY.confirmOffText when the locale carries it', async () => {
    const served: SpecTranslationData = {
      settings: {
        auth: {
          keys: {
            email_password_enabled: {
              label: PASSWORD_LABEL,
              confirmOffText: 'Translated: password sign-in goes away.',
            },
          },
        },
      },
    };
    serve(payloadOf(true));
    renderView(
      createI18n({
        defaultLanguage: 'en',
        detectBrowserLanguage: false,
        resources: { en: transformSpecTranslations(served) },
      }),
    );

    fireEvent.click(await switchFor(PASSWORD_LABEL));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Translated: password sign-in goes away.');
    expect(dialog).not.toHaveTextContent(CONFIRM_OFF);
  });

  it('picks an inline locale map literal for the page language when no translation is served', async () => {
    serve(
      payloadOf(true, {
        confirmOffText: { en: CONFIRM_OFF, de: 'Wer sich mit Passwort anmeldet, braucht einen anderen Weg.' },
      }),
    );
    renderView(createI18n({ defaultLanguage: 'de', detectBrowserLanguage: false }));

    fireEvent.click(await switchFor(PASSWORD_LABEL));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Wer sich mit Passwort anmeldet, braucht einen anderen Weg.');
    expect(dialog).not.toHaveTextContent(CONFIRM_OFF);
  });
});
