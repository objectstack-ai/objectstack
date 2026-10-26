/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dirty settings page is guarded against the shell's own departures too
 * (objectui#13231).
 *
 * ## What was broken
 *
 * objectui#13163 made the page ask before a link, its own crumb or a tab close
 * took its edits. Measured in Chromium on `/apps/crm/system/settings/localization`
 * afterwards: the shell's menus — Help, the avatar's Profile and organization
 * entries, the workspace switcher, a sidebar entry's Design — navigate with
 * `navigate()` from a button, so they left at once and the edit was lost; an
 * organization switch sent `set-active` before anything could ask.
 *
 * ## What is driven here
 *
 * The real page registers its edits with the shell's unsaved-edits seam, and
 * a stand-in shell menu leaves through the seam's `confirmUnsavedLeave` from
 * `@object-ui/app-shell`'s entry — the export each shell menu uses
 * (`AppHeader.unsavedEditsLeave-13231` pins the menus themselves). So what is
 * read here is that the page's registration reaches the shell: the question it
 * asks, and that it comes and goes with the page's own dirty state. The
 * harness is `SettingsView.leaveGuard-13163`'s: the whole page under a real
 * `BrowserRouter` over a stubbed `fetch`, with `window.confirm` a spy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { I18nProvider, en } from '@object-ui/i18n';
import { confirmUnsavedLeave } from '@object-ui/app-shell';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

const LOCALIZATION = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    specifiers: [{ type: 'text', key: 'default_country', label: 'Default country' }],
  },
  values: { default_country: { value: 'US', source: 'tenant', locked: false } },
};

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/** GET answers the namespace; PUT answers the values it was sent. */
function serve() {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(sent).map(([k, v]) => [k, { value: v, source: 'tenant', locked: false }]),
      );
      return ok({ success: true, data: { values } });
    }
    return ok({ success: true, data: structuredClone(LOCALIZATION) });
  });
}

/** Stand-ins for two shell menu entries: a `navigate()` from a button, and an organization switch. */
function ShellMenu({ switchOrganization }: { switchOrganization: () => Promise<void> }) {
  const navigate = useNavigate();
  return (
    <nav>
      <button type="button" onClick={() => confirmUnsavedLeave(() => navigate('/apps/account/profile'))}>
        Profile
      </button>
      <button type="button" onClick={() => confirmUnsavedLeave(() => switchOrganization())}>
        Globex
      </button>
    </nav>
  );
}

function renderPage(switchOrganization = vi.fn(async () => undefined)) {
  window.history.replaceState(null, '', '/settings/localization');
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BrowserRouter>
        <ShellMenu switchOrganization={switchOrganization} />
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
          <Route path="/apps/account/profile" element={<div>Profile page</div>} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>,
  );
  return switchOrganization;
}

/** Change Default country, the card's own step. The bar then reads "1 unsaved change". */
async function editDefaultCountry() {
  fireEvent.change(await screen.findByDisplayValue('US'), { target: { value: 'FR' } });
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
}

function expectEditKept() {
  expect(window.location.pathname).toBe('/settings/localization');
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
  expect(screen.getByDisplayValue('FR')).toBeTruthy();
}

/**
 * The prompt, answered by the test: Cancel unless a case says OK. Stubbed as a
 * global because happy-dom's window has no `confirm` to spy on.
 */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  confirmSpy = stubConfirm();
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a dirty settings page is guarded against the shell\'s departures (objectui#13231)', () => {
  it('a shell menu entry asks the page\'s own question; Cancel keeps the URL and the edit', async () => {
    renderPage();
    await editDefaultCountry();

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(en.form.unsavedChanges);
    expect(screen.queryByText('Profile page')).toBeNull();
    expectEditKept();
  });

  it('a shell menu entry: OK leaves, and the edit goes with the page', async () => {
    confirmSpy.mockReturnValue(true);
    renderPage();
    await editDefaultCountry();

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Profile page')).toBeTruthy();
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });

  it('an organization switch asks first; Cancel sends nothing and keeps the edit', async () => {
    const switchOrganization = renderPage();
    await editDefaultCountry();

    fireEvent.click(screen.getByRole('button', { name: 'Globex' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(switchOrganization).not.toHaveBeenCalled();
    expectEditKept();
  });
});

describe('CONTROLS: the page registers only while it holds edits (objectui#13231)', () => {
  it('a clean page: the shell leaves at once', async () => {
    renderPage();
    await screen.findByDisplayValue('US');

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Profile page')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('after a successful save: the shell leaves at once', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByTestId('settings-unsaved-count')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Profile page')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('after Discard: an organization switch goes at once', async () => {
    const switchOrganization = renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Globex' }));
    expect(switchOrganization).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
