/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A new translation function does not reload a settings namespace or drop its
 * draft (objectui#13254).
 *
 * ## What was broken
 *
 * `SettingsView` loaded its namespace from a `useCallback` keyed on
 * `[namespace, t]`, and the effect that runs the load depended on that
 * callback. i18next hands every reader a new `t` on a language switch and on
 * every write to its store (`useObjectTranslation` subscribes to `added`), so
 * each new `t` re-ran the fetch, and its success path reset the draft: the
 * edited value went back to the stored one and the "N unsaved changes" bar
 * disappeared, with no question asked.
 *
 * ## What is driven here
 *
 * The page under a real `I18nProvider` and router, over a stubbed `fetch`. The
 * new `t` comes from the provider itself, two ways: a language switch through
 * the provider's own `changeLanguage`, and a translation bundle written into
 * the i18next store with the language unchanged. Each case first asserts that
 * `t` really changed identity, so a pass cannot come from a `t` that never
 * moved.
 *
 * ## Out of this file's reach, by design
 *
 * In the console the page also sits under `ConnectedShell`, which remounts its
 * whole route subtree when the language changes; that remount drops the draft
 * on its own and is not mounted here. This file pins the page's own share.
 */

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { I18nProvider, en, useObjectTranslation } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

/** A namespace's GET payload: one text field with a stored value. */
function payloadFor(namespace: string, label: string, key: string, fieldLabel: string, value: string) {
  return {
    manifest: { namespace, version: 1, label, specifiers: [{ type: 'text', key, label: fieldLabel }] },
    values: { [key]: { value, source: 'tenant', locked: false } },
  };
}

const PAYLOADS: Record<string, unknown> = {
  localization: payloadFor('localization', 'Localization', 'default_country', 'Default country', 'US'),
  company: payloadFor('company', 'Company', 'company_name', 'Company name', 'Acme'),
};

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/**
 * GET answers the namespace named in the URL; PUT answers the values it was
 * sent and stores them, so a later GET answers the same: the page reads the
 * namespace again after a save (objectui#13382).
 */
function serve() {
  const stored = structuredClone(PAYLOADS) as Record<string, { values: Record<string, unknown> }>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const namespace = decodeURIComponent(String(url).split('/').pop() ?? '');
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(sent).map(([k, v]) => [k, { value: v, source: 'tenant', locked: false }]),
      );
      Object.assign(stored[namespace].values, structuredClone(values));
      return ok({ success: true, data: { values } });
    }
    return ok({ success: true, data: structuredClone(stored[namespace]) });
  });
}

/** The `GET /api/settings/NAMESPACE` requests sent so far. */
function getsOf(namespace: string): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith(`/api/settings/${namespace}`) &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
  ).length;
}

/** The `PUT` bodies sent so far, parsed. */
function puts(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

/**
 * The provider's live translation function and i18next instance, as the page
 * itself reads them, plus the two controls a test needs: the language switch
 * and a move to another namespace (a button, so the leave guard is not asked).
 */
const seen: { t: unknown; i18n: { addResourceBundle: (...a: unknown[]) => unknown } | null } = {
  t: null,
  i18n: null,
};
function Controls() {
  const { t, i18n, changeLanguage } = useObjectTranslation();
  const navigate = useNavigate();
  useEffect(() => {
    seen.t = t;
    seen.i18n = i18n as unknown as typeof seen.i18n;
  });
  return (
    <div>
      <button type="button" onClick={() => void changeLanguage('zh')}>switch to zh</button>
      <button type="button" onClick={() => navigate('/settings/company')}>open company</button>
      <button type="button" onClick={() => navigate('/settings/localization')}>open localization</button>
    </div>
  );
}

function renderPage() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/localization']}>
        <Controls />
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Change Default country, US to FR. The bar then reads "1 unsaved change". */
async function editDefaultCountry() {
  fireEvent.change(await screen.findByDisplayValue('US'), { target: { value: 'FR' } });
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The provider remembers an explicit switch in `localStorage`; each case
  // starts in `en`.
  window.localStorage.clear();
  seen.t = null;
  seen.i18n = null;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a new translation function keeps the draft (objectui#13254)', () => {
  it('a language change re-labels the page, keeps the edit and its bar, and sends no second GET', async () => {
    renderPage();
    await editDefaultCountry();
    expect(getsOf('localization')).toBe(1);
    const tBefore = seen.t;

    fireEvent.click(screen.getByRole('button', { name: 'switch to zh' }));

    // The page re-labels: the crumb and the bar speak zh. The bar still counts
    // the one edit, and the box still holds it.
    expect(await screen.findByText('全部设置')).toBeTruthy();
    expect(seen.t).not.toBe(tBefore);
    expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 项未保存的更改');
    expect(screen.getByDisplayValue('FR')).toBeTruthy();
    expect(screen.queryByDisplayValue('US')).toBeNull();
    expect(getsOf('localization')).toBe(1);
  });

  it('a translation bundle landing in the store (same language, new t) keeps the edit and sends no GET', async () => {
    renderPage();
    await editDefaultCountry();
    const tBefore = seen.t;

    act(() => {
      seen.i18n!.addResourceBundle('en', 'translation', { probe13254: { hello: 'Hello' } }, true, true);
    });

    await waitFor(() => expect(seen.t).not.toBe(tBefore));
    expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
    expect(screen.getByDisplayValue('FR')).toBeTruthy();
    expect(getsOf('localization')).toBe(1);
  });
});

describe('the draft still resets where it should (objectui#13254 controls)', () => {
  it('a namespace change loads the new namespace and the old draft does not come back', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: 'switch to zh' }));
    expect(await screen.findByText('全部设置')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'open company' }));
    expect(await screen.findByDisplayValue('Acme')).toBeTruthy();
    expect(getsOf('company')).toBe(1);
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'open localization' }));
    expect(await screen.findByDisplayValue('US')).toBeTruthy();
    expect(getsOf('localization')).toBe(2);
    expect(screen.queryByDisplayValue('FR')).toBeNull();
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });

  it('after a language change, Save sends the kept edit and the bar goes', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: 'switch to zh' }));
    expect(await screen.findByText('全部设置')).toBeTruthy();
    // The language change itself sent no GET.
    expect(getsOf('localization')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }));

    await waitFor(() => expect(screen.queryByTestId('settings-unsaved-count')).toBeNull());
    expect(puts()).toEqual([{ default_country: 'FR' }]);
    // The one GET after the save is the page's re-read (objectui#13382).
    await waitFor(() => expect(getsOf('localization')).toBe(2));
    expect(screen.getByDisplayValue('FR')).toBeTruthy();
  });

  it('after a language change, Discard goes back to the stored value without a GET', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: 'switch to zh' }));
    expect(await screen.findByText('全部设置')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /放弃/ }));

    expect(screen.getByDisplayValue('US')).toBeTruthy();
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
    expect(puts()).toEqual([]);
    expect(getsOf('localization')).toBe(1);
  });
});

describe('the load-failure card (objectui#13254: translated at render, not in the fetch)', () => {
  it('shows the server sentence when the refusal carries one', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ success: false, error: { code: 'FORBIDDEN', message: 'Not allowed to read localization' } }),
    }));
    renderPage();
    expect(await screen.findByText('Not allowed to read localization')).toBeTruthy();
  });

  it('without a sentence it shows the pack fallback, which follows a language change with no refetch', async () => {
    fetchMock.mockImplementation(async () => {
      throw {};
    });
    renderPage();
    expect(await screen.findByText(en.console.settingsView.loadError)).toBeTruthy();
    expect(getsOf('localization')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'switch to zh' }));

    expect(await screen.findByText('加载设置失败')).toBeTruthy();
    expect(getsOf('localization')).toBe(1);
  });
});
