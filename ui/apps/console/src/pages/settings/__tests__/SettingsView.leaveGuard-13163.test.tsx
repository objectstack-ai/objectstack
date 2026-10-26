/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Leaving a settings page with unsaved edits asks first (objectui#13163).
 *
 * ## What was broken
 *
 * Measured on Setup, Localization: change Default country (the bar reads
 * "1 unsaved change"), click another page in the sidebar — the console
 * navigated at once and the edit was gone. `SettingsView` keeps its edits in
 * component state and nothing stood between that state and a departure: not a
 * sidebar link, not its own "All settings" crumb, not a tab close.
 *
 * ## What is driven here
 *
 * The whole page under a real `BrowserRouter` — the router the console mounts —
 * over a stubbed `fetch`, beside a stand-in sidebar of real `Link`s. A click
 * goes through the document the way a user's does, so the guard's
 * capture-phase listener and the router's own handler race exactly as in the
 * app. `window.confirm` is the prompt (see `useUnsavedLeaveGuard` for why it is
 * not an in-app dialog); a spy answers it.
 *
 * ## Not covered, by design
 *
 * Browser Back / Forward (`popstate`): `BrowserRouter` offers no veto, and the
 * guard does not pretend to have one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { I18nProvider, en } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

/** A namespace's GET payload: one text field with a stored value. */
function payloadFor(namespace: string, label: string, key: string, value: string) {
  return {
    manifest: {
      namespace,
      version: 1,
      label,
      specifiers: [{ type: 'text', key, label: key === 'default_country' ? 'Default country' : 'Company name' }],
    },
    values: { [key]: { value, source: 'tenant', locked: false } },
  };
}

const PAYLOADS: Record<string, unknown> = {
  localization: payloadFor('localization', 'Localization', 'default_country', 'US'),
  company: payloadFor('company', 'Company', 'company_name', 'Acme'),
};

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/** GET answers the namespace named in the URL; PUT answers the values it was sent. */
function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const namespace = decodeURIComponent(String(url).split('/').pop() ?? '');
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(sent).map(([k, v]) => [k, { value: v, source: 'tenant', locked: false }]),
      );
      return ok({ success: true, data: { values } });
    }
    return ok({ success: true, data: structuredClone(PAYLOADS[namespace]) });
  });
}

/**
 * The page at `/settings/localization`, a stand-in sidebar, and the pages a
 * link leads to. `window.history` is set first: `BrowserRouter` reads the
 * document's own location, as it does in the console.
 */
function renderPage() {
  window.history.replaceState(null, '', '/settings/localization');
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BrowserRouter>
        <nav>
          <Link to="/business-units">Business Units</Link>
          <Link to="/settings/company">Company</Link>
          <Link to="/settings/localization">Localization</Link>
          <Link to="/business-units" target="_blank">Business Units in a new tab</Link>
          <a href="/exports/settings.csv" download>Download settings</a>
          <a href="https://docs.example.com/settings">Settings docs</a>
        </nav>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
          <Route path="/business-units" element={<div>Business Units page</div>} />
          <Route path="/system/settings" element={<div>Settings hub page</div>} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>,
  );
}

/** A link in the stand-in sidebar, by its accessible name. */
function link(name: string): HTMLElement {
  return screen.getByRole('link', { name });
}

/** Change Default country, the card's own step. The bar then reads "1 unsaved change". */
async function editDefaultCountry() {
  fireEvent.change(await screen.findByDisplayValue('US'), { target: { value: 'FR' } });
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
}

/** The edit is still on screen: the bar and the box both hold it. */
function expectEditKept() {
  expect(window.location.pathname).toBe('/settings/localization');
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
  expect(screen.getByDisplayValue('FR')).toBeTruthy();
}

/**
 * The prompt, answered by the test: Cancel unless a test says OK. Stubbed as a
 * global because happy-dom's window has no `confirm` to spy on.
 */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;

/**
 * happy-dom performs an anchor's default action (a document navigation) when
 * nothing cancels the click — which the router does for a plain click on a
 * `Link`, but nothing does for the modified, new-tab, download and external
 * clicks the controls send. Cancel it last, in the bubble phase on `window`,
 * so the harness never leaves the page; every listener under test has run by
 * then.
 */
const stopDocumentNavigation = (e: MouseEvent) => e.preventDefault();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  confirmSpy = stubConfirm();
  window.addEventListener('click', stopDocumentNavigation);
  serve();
});

afterEach(() => {
  cleanup();
  window.removeEventListener('click', stopDocumentNavigation);
  vi.unstubAllGlobals();
});

describe('environment control', () => {
  it('a plain Link click moves BrowserRouter and the document location together', async () => {
    renderPage();
    await screen.findByDisplayValue('US');
    fireEvent.click(link('Business Units'));
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(window.location.pathname).toBe('/business-units');
  });
});

describe('leaving with an unsaved edit asks first (objectui#13163)', () => {
  it('a sidebar link to another page asks; Keep (Cancel) keeps the URL and the edit', async () => {
    confirmSpy.mockReturnValue(false);
    renderPage();
    await editDefaultCountry();

    fireEvent.click(link('Business Units'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The bundle's leave question, not a key literal or a second wording.
    expect(confirmSpy).toHaveBeenCalledWith(en.form.unsavedChanges);
    expect(screen.queryByText('Business Units page')).toBeNull();
    expectEditKept();
  });

  it('a sidebar link to another page asks; OK leaves and the edit goes with the page', async () => {
    confirmSpy.mockReturnValue(true);
    renderPage();
    await editDefaultCountry();

    fireEvent.click(link('Business Units'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(window.location.pathname).toBe('/business-units');
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });

  it('another settings namespace (same view, new :namespace) asks too', async () => {
    confirmSpy.mockReturnValue(false);
    renderPage();
    await editDefaultCountry();

    fireEvent.click(link('Company'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expectEditKept();

    // OK: the view stays mounted, loads Company, and starts it clean.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(link('Company'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(await screen.findByDisplayValue('Acme')).toBeTruthy();
    expect(window.location.pathname).toBe('/settings/company');
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });

  it('the page\'s own "All settings" crumb asks; Cancel stays, OK goes to the hub', async () => {
    confirmSpy.mockReturnValue(false);
    renderPage();
    await editDefaultCountry();

    fireEvent.click(screen.getByTestId('settings-breadcrumb-hub'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(en.form.unsavedChanges);
    expect(screen.queryByText('Settings hub page')).toBeNull();
    expectEditKept();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('settings-breadcrumb-hub'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Settings hub page')).toBeTruthy();
    expect(window.location.pathname).toBe('/system/settings');
  });

  it('closing the tab or reloading raises the browser\'s own leave prompt', async () => {
    renderPage();
    await editDefaultCountry();

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
});

describe('CONTROLS: no prompt where nothing would be lost (objectui#13163)', () => {
  it('a clean page leaves at once, and a tab close is not held', async () => {
    renderPage();
    await screen.findByDisplayValue('US');

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);

    fireEvent.click(link('Business Units'));
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('after a successful save the page is clean again: no prompt', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByTestId('settings-unsaved-count')).toBeNull());

    // The bar goes in the commit that clears the draft; the guard goes a step
    // later, in the passive effect that releases the page's registration
    // (`useRegisterUnsavedEdits`). The save settles outside `act`, so React
    // runs that effect as a task of its own, and on a loaded machine the wait
    // above can return in between (objectui#13317). So wait on the guard
    // itself, the fact this case asserts. The link listener is removed in the
    // same step, so once a tab close is not held, the click below meets none.
    await waitFor(() => {
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    });

    fireEvent.click(link('Business Units'));
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('after Discard the page is clean again: no prompt', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();

    fireEvent.click(link('Business Units'));
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a link to the page already shown keeps the view, so it does not ask', async () => {
    renderPage();
    await editDefaultCountry();
    fireEvent.click(link('Localization'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expectEditKept();
  });

  it('a modified click, a new-tab link, a download and another origin do not ask', async () => {
    renderPage();
    await editDefaultCountry();

    fireEvent.click(link('Business Units'), { ctrlKey: true });
    fireEvent.click(link('Business Units'), { metaKey: true });
    fireEvent.click(link('Business Units'), { button: 1 });
    fireEvent.click(link('Business Units in a new tab'));
    fireEvent.click(link('Download settings'));
    // Another origin replaces the document, so the `beforeunload` prompt is the one that asks.
    fireEvent.click(link('Settings docs'));

    expect(confirmSpy).not.toHaveBeenCalled();
    expectEditKept();
  });

  it('the listeners go with the page: once it has unmounted, nothing asks', async () => {
    confirmSpy.mockReturnValue(true);
    renderPage();
    await editDefaultCountry();
    fireEvent.click(link('Business Units'));
    expect(await screen.findByText('Business Units page')).toBeTruthy();
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);

    fireEvent.click(link('Company'));
    expect(await screen.findByDisplayValue('Acme')).toBeTruthy();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
