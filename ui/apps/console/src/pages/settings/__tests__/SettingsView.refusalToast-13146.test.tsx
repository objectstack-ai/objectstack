/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13146 — a save the server refuses field by field toasts the refused
 * settings by their labels, not the server's summary sentence.
 *
 * `SettingsValidationError.message` (objectstack `service-settings`) is written
 * for logs: `Settings for '<namespace>' are incomplete: <key> — <row message>`,
 * one `<key> — <row message>` per refused key. The page handed it to the toast
 * verbatim, so an admin read the namespace and the machine keys, the word
 * "incomplete" for a value that was present but malformed, and, for a key whose
 * row message carries help text (Authentication's "Key policy started at"),
 * that whole paragraph a second time. The rows already showed each reason.
 *
 * The bodies below are the wire shape `PUT /api/settings/:namespace` answers
 * (`error.details.fields` is `FieldError[]`), with the two refusals the card
 * reproduced. The controls are plain text inputs: what a row draws for the
 * value is beside the point, the toast and the row's error are under test.
 *
 * Expected toasts are read from the shipped `en` pack rather than retyped, so
 * the copy can be reworded without editing this file; what is pinned is which
 * plural slot is used, what it is filled with, and what never reaches it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, en } from '@object-ui/i18n';

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

import { SettingsView } from '../SettingsView';

const LOCALIZATION = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    specifiers: [
      { type: 'text', key: 'timezone', label: 'Default timezone' },
      { type: 'text', key: 'currency', label: 'Default currency' },
    ],
  },
  values: {
    timezone: { value: 'UTC', source: 'default', locked: false },
    currency: { value: 'USD', source: 'default', locked: false },
  },
};

const AUTH = {
  manifest: {
    namespace: 'auth',
    version: 1,
    label: 'Authentication',
    specifiers: [
      { type: 'text', key: 'api_key_policy_started_at', label: 'Key policy started at' },
    ],
  },
  values: {
    api_key_policy_started_at: { value: '2026-01-01T00:00:00Z', source: 'tenant', locked: false },
  },
};

const TIMEZONE_MESSAGE =
  'Default timezone must be a valid IANA time zone identifier, e.g. Europe/Zurich (got "Mars/Olympus")';
const CURRENCY_MESSAGE = 'Default currency must be a valid ISO 4217 currency code (got "XYZ")';
const POLICY_MESSAGE =
  'Key policy started at does not match the expected format. Recorded automatically (UTC, ISO 8601) ' +
  'the first time the server runs with this policy.';

interface Refused {
  field: string;
  code: string;
  message: string;
  label?: string;
}

/** The 400 `SETTINGS_VALIDATION` body, message composed as the server composes it. */
function refusal(namespace: string, fields: Refused[]) {
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({
      success: false,
      error: {
        code: 'SETTINGS_VALIDATION',
        message:
          `Settings for '${namespace}' are incomplete: ` +
          fields.map((f) => `${f.field} — ${f.message}`).join('; '),
        details: { namespace, fields },
      },
    }),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function serve(payload: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: payload }),
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(namespace: string, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/settings/${namespace}`]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/**
 * Edit the first `n` inputs, then press Save: the second of the save bar's two
 * buttons (Discard, Save), found beside its counter so no locale's label is
 * typed here.
 */
async function editAndSave(n: number, response: Response) {
  const inputs = await screen.findAllByRole('textbox');
  for (let i = 0; i < n; i++) {
    fireEvent.change(inputs[i], { target: { value: `edited-${i}` } });
  }
  fetchMock.mockResolvedValueOnce(response);
  const bar = (await screen.findByTestId('settings-unsaved-count')).parentElement!;
  const buttons = bar.querySelectorAll('button');
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  return String(toastError.mock.calls[0]?.[0] ?? '');
}

const fill = (template: string, count: number, settings: string) =>
  template.replace('{{count}}', String(count)).replace('{{settings}}', settings);

const VIEW = en.console.settingsView;

describe('a field-by-field refusal toasts the settings by label (objectui#13146)', () => {
  it('Localization: one refused setting is named by its label, in the singular slot', async () => {
    serve(LOCALIZATION);
    renderAt('localization');
    const msg = await editAndSave(
      1,
      refusal('localization', [
        { field: 'timezone', code: 'value_domain', message: TIMEZONE_MESSAGE, label: 'Default timezone' },
      ]),
    );

    expect(msg).toBe(fill(VIEW.fieldErrorsToast_one, 1, 'Default timezone'));
    // Nothing of the server's log sentence: not the namespace, not the
    // `<key> — ` frame, not "incomplete", not the row's reason.
    expect(msg).not.toContain('localization');
    expect(msg).not.toContain('timezone —');
    expect(msg).not.toMatch(/incomplete/i);
    expect(msg).not.toContain('Mars/Olympus');

    // The row keeps its own message.
    expect((await screen.findByText(TIMEZONE_MESSAGE)).getAttribute('role')).toBe('alert');
  });

  it('Authentication: the machine key and the help paragraph stay out of the toast', async () => {
    serve(AUTH);
    renderAt('auth');
    const msg = await editAndSave(
      1,
      refusal('auth', [
        {
          field: 'api_key_policy_started_at',
          code: 'invalid_format',
          message: POLICY_MESSAGE,
          label: 'Key policy started at',
        },
      ]),
    );

    expect(msg).toBe(fill(VIEW.fieldErrorsToast_one, 1, 'Key policy started at'));
    expect(msg).not.toContain('api_key_policy_started_at');
    expect(msg).not.toContain("'auth'");
    expect(msg).not.toContain('Recorded automatically');
    expect(msg).not.toMatch(/incomplete/i);

    expect(await screen.findByText(POLICY_MESSAGE)).toBeTruthy();
  });

  it('two refused settings: the plural slot, both labels joined by the pack separator', async () => {
    serve(LOCALIZATION);
    renderAt('localization');
    const msg = await editAndSave(
      2,
      refusal('localization', [
        { field: 'timezone', code: 'value_domain', message: TIMEZONE_MESSAGE, label: 'Default timezone' },
        { field: 'currency', code: 'value_domain', message: CURRENCY_MESSAGE, label: 'Default currency' },
      ]),
    );

    const joined = ['Default timezone', 'Default currency'].join(en.validation.formInvalidJoiner);
    expect(msg).toBe(fill(VIEW.fieldErrorsToast_other, 2, joined));
    expect(VIEW.fieldErrorsToast_other).not.toBe(VIEW.fieldErrorsToast_one);
  });

  it('names a setting by the label its row draws, not by the refusal entry', async () => {
    // The settings service fills `FieldError.label` with the manifest literal,
    // untranslated, so in a pack that translates the row it names the setting
    // differently from the row. The row's label is the one the admin can find.
    serve(LOCALIZATION);
    renderAt('localization');
    const msg = await editAndSave(
      1,
      refusal('localization', [
        { field: 'timezone', code: 'value_domain', message: TIMEZONE_MESSAGE, label: 'Zone (as sent)' },
      ]),
    );

    expect(screen.getByText('Default timezone')).toBeTruthy();
    expect(msg).toBe(fill(VIEW.fieldErrorsToast_one, 1, 'Default timezone'));
    expect(msg).not.toContain('Zone (as sent)');
  });

  it('ru: two refused settings take a Russian plural slot, not English', async () => {
    serve(LOCALIZATION);
    renderAt('localization', 'ru');
    const msg = await editAndSave(
      2,
      refusal('localization', [
        { field: 'timezone', code: 'value_domain', message: TIMEZONE_MESSAGE },
        { field: 'currency', code: 'value_domain', message: CURRENCY_MESSAGE },
      ]),
    );

    expect(msg).toMatch(/[А-Яа-я]/);
    expect(msg).toContain('2');
    expect(msg).toContain('Default timezone');
    expect(msg).toContain('Default currency');
    expect(msg).not.toContain('need attention');
    expect(msg).not.toContain('console.settingsView');
  });

  it('a refusal naming no setting on this page toasts the generic sentence, not the server one', async () => {
    serve(LOCALIZATION);
    renderAt('localization');
    const msg = await editAndSave(
      1,
      refusal('localization', [
        { field: 'retired_key', code: 'invalid_value', message: 'Retired key is not accepted.' },
      ]),
    );

    expect(msg).toBe(VIEW.saveFailed);
  });
});

describe('a refusal with no field errors keeps its message (objectui#13146)', () => {
  it('an unscoped server failure still toasts the server sentence', async () => {
    serve(LOCALIZATION);
    renderAt('localization');
    const msg = await editAndSave(1, {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to write namespace' },
      }),
    } as unknown as Response);

    expect(msg).toBe('Failed to write namespace');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
