/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A successful save or action reads the namespace again and takes the whole
 * payload, manifest included (objectui#13382).
 *
 * ## What was broken
 *
 * After objectstack#25448 the server's `GET /api/settings/:namespace` puts a
 * live-status `info_banner` (id `live_status`) first in `manifest.specifiers`
 * on every read. For `mail` it reads "No mail leaves this machine" while the
 * log transport is in use, and names the SMTP host once one is configured.
 * `SettingsView`'s save merged only the PUT's `values` into the page and its
 * action handler read nothing, so the manifest from the first GET stayed on
 * screen and the banner kept the pre-save sentence until a reload.
 *
 * ## What is driven here
 *
 * The page under a real `I18nProvider` and router, over a stubbed `fetch`
 * whose first GET answers one banner sentence and every later GET another.
 * No case remounts the page: the second sentence can only reach the screen
 * through a read the page itself makes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { I18nProvider, en } from '@object-ui/i18n';
// The banner body renders behind two lazy boundaries: `SettingsField`'s own
// `import('@object-ui/plugin-markdown')` and the plugin's
// `import('./MarkdownImpl')`. Importing both here, by the specifiers that
// resolve to the same modules, puts their load in the import phase, outside
// any `findBy` budget (AGENTS.md, test discipline).
import '@object-ui/plugin-markdown';
import '../../../../../../packages/plugin-markdown/src/MarkdownImpl';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import { SettingsView } from '../SettingsView';

const BEFORE = 'No mail leaves this machine';
const AFTER = 'Mail is delivered through SMTP (smtp.example.com:587)';

/** The `mail` GET payload: the live-status banner first, one text field, one action. */
function mailPayload(bannerText: string, host: string) {
  return {
    manifest: {
      namespace: 'mail',
      version: 1,
      label: 'Email',
      specifiers: [
        { type: 'info_banner', id: 'live_status', label: 'Delivery', bannerText },
        { type: 'text', key: 'smtp_host', label: 'SMTP host' },
        { type: 'action_button', id: 'test', label: 'Send test email' },
      ],
    },
    values: { smtp_host: { value: host, source: 'tenant', locked: false } },
  };
}

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/** The `sms` GET payload: a second namespace to move to. */
const SMS_PAYLOAD = {
  manifest: {
    namespace: 'sms',
    version: 1,
    label: 'SMS',
    specifiers: [{ type: 'text', key: 'sender_id', label: 'Sender ID' }],
  },
  values: { sender_id: { value: 'ACME', source: 'tenant', locked: false } },
};

/**
 * How the fake answers the second and later `mail` GETs: a payload, a
 * rejection, or held until the case calls `releaseHeld`.
 */
let laterGets: 'serve' | 'fail' | 'hold' = 'serve';
let releaseHeld: (() => void) | null = null;

/**
 * GET: the first answers BEFORE with the stored host; every later one answers
 * AFTER with the host the last PUT stored (or fails, per `laterGets`).
 * PUT: answers the values it was sent. POST (the action): succeeds.
 */
function serve() {
  let gets = 0;
  let storedHost = 'localhost';
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'PUT') {
      const sent = JSON.parse(String(init!.body)) as Record<string, unknown>;
      storedHost = String(sent.smtp_host);
      return ok({
        success: true,
        data: { values: { smtp_host: { value: sent.smtp_host, source: 'tenant', locked: false } } },
      });
    }
    if (method === 'POST') {
      return ok({ success: true, data: { ok: true, message: 'Test email sent' } });
    }
    if (String(url).endsWith('/api/settings/sms')) {
      return ok({ success: true, data: structuredClone(SMS_PAYLOAD) });
    }
    gets += 1;
    if (gets === 1) return ok({ success: true, data: mailPayload(BEFORE, storedHost) });
    if (laterGets === 'fail') {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ success: false, error: { code: 'UNAVAILABLE', message: 'Settings unavailable' } }),
      } as unknown as Response;
    }
    if (laterGets === 'hold') {
      const host = storedHost;
      return new Promise<Response>((resolve) => {
        releaseHeld = () => resolve(ok({ success: true, data: mailPayload(AFTER, host) }));
      });
    }
    return ok({ success: true, data: mailPayload(AFTER, storedHost) });
  });
}

/** The `GET /api/settings/mail` requests sent so far. */
function gets(): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith('/api/settings/mail') &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
  ).length;
}

/** A move to another namespace, by a button so the leave guard is not asked. */
function OpenSms() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/settings/sms')}>
      open sms
    </button>
  );
}

function renderPage() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/mail']}>
        <OpenSms />
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Edit SMTP host, localhost to smtp.example.com. */
async function editHost() {
  fireEvent.change(await screen.findByDisplayValue('localhost'), { target: { value: 'smtp.example.com' } });
  expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  laterGets = 'serve';
  releaseHeld = null;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the settings page reads its namespace again after a save or action (objectui#13382)', () => {
  it('control: the first load shows the first GET banner and sends one GET', async () => {
    renderPage();
    expect(await screen.findByText(BEFORE)).toBeTruthy();
    expect(screen.getByDisplayValue('localhost')).toBeTruthy();
    expect(screen.queryByText(AFTER)).toBeNull();
    expect(gets()).toBe(1);
  });

  it('after a save, the banner shows what the next GET returns, without a remount or a placeholder', async () => {
    const { container } = renderPage();
    await editHost();
    const fieldList = container.querySelector('.divide-y');
    expect(screen.getByText(BEFORE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: en.console.settingsView.saveChanges }));

    expect(await screen.findByText(AFTER)).toBeTruthy();
    expect(screen.queryByText(BEFORE)).toBeNull();
    expect(gets()).toBe(2);
    // The same field list node: the page re-read in place, it did not drop
    // to its loading skeleton and build the form again.
    expect(container.querySelector('.divide-y')).toBe(fieldList);
    expect(screen.getByDisplayValue('smtp.example.com')).toBeTruthy();
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(en.console.settingsView.saved);
  });

  it('after a successful action, the banner shows what the next GET returns', async () => {
    renderPage();
    expect(await screen.findByText(BEFORE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));

    expect(await screen.findByText(AFTER)).toBeTruthy();
    expect(screen.queryByText(BEFORE)).toBeNull();
    expect(gets()).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('Test email sent');
  });

  it('an unsaved draft survives an action and its re-read', async () => {
    renderPage();
    await editHost();

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));

    expect(await screen.findByText(AFTER)).toBeTruthy();
    // The re-read answered the stored host, localhost; the box still holds
    // the edit, and the bar still counts it.
    expect(screen.getByDisplayValue('smtp.example.com')).toBeTruthy();
    expect(screen.queryByDisplayValue('localhost')).toBeNull();
    expect(screen.getByTestId('settings-unsaved-count').textContent).toBe('1 unsaved change');
  });

  it('a save whose re-read fails still shows the saved value and the success toast, and no error', async () => {
    laterGets = 'fail';
    renderPage();
    await editHost();

    fireEvent.click(screen.getByRole('button', { name: en.console.settingsView.saveChanges }));

    await waitFor(() => expect(gets()).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('settings-unsaved-count')).toBeNull());
    // Let the rejected re-read settle before reading the page.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByDisplayValue('smtp.example.com')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(en.console.settingsView.saved);
    expect(toast.error).not.toHaveBeenCalled();
    // The page stays the form: the first banner, no load-failure card.
    expect(screen.getByText(BEFORE)).toBeTruthy();
    expect(screen.queryByText('Settings unavailable')).toBeNull();
    expect(screen.queryByText(en.console.settingsView.loadError)).toBeNull();
  });

  it('a re-read that lands after a move to another namespace is dropped', async () => {
    laterGets = 'hold';
    renderPage();
    expect(await screen.findByText(BEFORE)).toBeTruthy();

    // The action succeeds and its re-read of `mail` is held in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(releaseHeld).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'open sms' }));
    expect(await screen.findByDisplayValue('ACME')).toBeTruthy();

    await act(async () => {
      releaseHeld!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Still the sms page: the late mail payload did not replace it.
    expect(screen.getByDisplayValue('ACME')).toBeTruthy();
    expect(screen.queryByText(AFTER)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send test email' })).toBeNull();
  });
});
