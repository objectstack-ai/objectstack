/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30313 — the Allowed IP ranges row shows the caller's address as
 * the server judges it, before a save.
 *
 * A save of `auth.allowed_ip_ranges` whose list leaves the saving request's own
 * address out is refused (`invalid_value`, `constraint.clientAddress`), and the
 * row said nothing about that address until the refusal. The server serves it
 * at `GET /api/v1/auth/admin/client-address` (objectstack#30398), as
 * `{ clientAddress, trustProxy }` from the save check's own call, so the page
 * reads it and draws it under the row. The console never works the address
 * out itself.
 *
 * The whole page over a stubbed `fetch` and the REAL `../api` module, so the
 * URL, the envelope unwrap and the shape check are under test along with the
 * row. Expected sentences come from the shipped `en` pack rather than being
 * retyped, so the copy can be reworded without editing this file; what is
 * pinned is which sentence each state draws, what it is filled with, and on
 * which row.
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

const CLIENT_ADDRESS_URL = '/api/v1/auth/admin/client-address';

/** The `auth` rows that matter here: the list, and a neighbour that must stay bare. */
const AUTH = {
  manifest: {
    namespace: 'auth',
    version: 1,
    label: 'Authentication',
    specifiers: [
      { type: 'textarea', key: 'allowed_ip_ranges', label: 'Allowed IP ranges', description: 'CIDR ranges.' },
      { type: 'text', key: 'trusted_origins', label: 'Trusted origins' },
    ],
  },
  values: {
    allowed_ip_ranges: { value: null, source: 'default', locked: false },
    trusted_origins: { value: null, source: 'default', locked: false },
  },
};

const LOCALIZATION = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    specifiers: [{ type: 'textarea', key: 'allowed_ip_ranges', label: 'Allowed IP ranges' }],
  },
  values: { allowed_ip_ranges: { value: null, source: 'default', locked: false } },
};

const ok = (data: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) }) as unknown as Response;

const refused = (status: number, code: string) =>
  ({
    ok: false,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
    json: async () => ({ success: false, error: { code, message: 'Platform admin required.' } }),
  }) as unknown as Response;

const fetchMock = vi.fn();

/** Serve the namespace page, and answer the address read with `address`. */
function serve(page: unknown, address: () => Promise<Response>) {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith(CLIENT_ADDRESS_URL) ? address() : ok(page),
  );
}

const addressReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(CLIENT_ADDRESS_URL));

const sentence = (key: 'clientAddressDirect' | 'clientAddressViaProxy' | 'clientAddressUnknown', address?: string) =>
  en.console.settingsView[key].replace('{{address}}', address ?? '');

/** The row a key draws, found by the hook the page itself uses. */
const rowOf = (key: string) => document.querySelector<HTMLElement>(`[data-settings-key="${key}"]`);

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

function renderAt(namespace: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/settings/${namespace}`]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('SettingsView — Allowed IP ranges shows the address the server judges (objectstack#30313)', () => {
  it('draws the served address under the list, and only under the list', async () => {
    serve(AUTH, async () => ok({ clientAddress: '203.0.113.7', trustProxy: false }));
    renderAt('auth');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressDirect', '203.0.113.7'));
    expect(rowOf('allowed_ip_ranges')!.contains(note)).toBe(true);
    expect(rowOf('trusted_origins')!.querySelector('[data-testid="settings-field-note"]')).toBeNull();
    // The help text stays: the note is drawn beside it, not in its place.
    expect(rowOf('allowed_ip_ranges')!.textContent).toContain('CIDR ranges.');
    // The control names the note for a screen reader.
    const box = rowOf('allowed_ip_ranges')!.querySelector('textarea')!;
    expect(box.getAttribute('aria-describedby')).toBe(note.id);
    expect(box.hasAttribute('aria-invalid')).toBe(false);

    // One read, at the served route, with the session cookie.
    expect(addressReads()).toHaveLength(1);
    expect(addressReads()[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('says the address came through the trusted proxy when trustProxy is on', async () => {
    serve(AUTH, async () => ok({ clientAddress: '198.51.100.20', trustProxy: true }));
    renderAt('auth');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressViaProxy', '198.51.100.20'));
  });

  it('says no address could be established when the server answers null', async () => {
    serve(AUTH, async () => ok({ clientAddress: null, trustProxy: false }));
    renderAt('auth');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressUnknown'));
  });

  it.each([
    ['a caller who is not a platform admin (403)', async () => refused(403, 'FORBIDDEN')],
    ['no session (401)', async () => refused(401, 'UNAUTHORIZED')],
    ['a body that is not the declared shape', async () => ok({ clientAddress: '203.0.113.7' })],
    ['a network failure', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('draws no note, and the page still renders, on %s', async (_what, answer) => {
    serve(AUTH, answer);
    renderAt('auth');

    await screen.findByText('Allowed IP ranges');
    await waitFor(() => expect(addressReads()).toHaveLength(1));
    // Let the rejected read settle before asserting its absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('settings-field-note')).toBeNull();
    expect(screen.queryByText(/Failed to load settings/)).toBeNull();
  });

  it('never reads the address on another namespace, even one with a same-named key', async () => {
    serve(LOCALIZATION, async () => ok({ clientAddress: '203.0.113.7', trustProxy: false }));
    renderAt('localization');

    await screen.findByText('Allowed IP ranges');
    expect(addressReads()).toHaveLength(0);
    expect(screen.queryByTestId('settings-field-note')).toBeNull();
  });

  it('keeps the note beside the refusal that names the same address', async () => {
    const REFUSAL =
      'No entry in this list matches 203.0.113.7, the address you are connected from, so saving it would refuse your own next sign-in.';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(CLIENT_ADDRESS_URL)) return ok({ clientAddress: '203.0.113.7', trustProxy: false });
      if (init?.method === 'PUT') {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            success: false,
            error: {
              code: 'SETTINGS_VALIDATION',
              message: `Settings for 'auth' are incomplete: allowed_ip_ranges — ${REFUSAL}`,
              details: {
                namespace: 'auth',
                fields: [
                  {
                    field: 'allowed_ip_ranges',
                    code: 'invalid_value',
                    message: REFUSAL,
                    label: 'Allowed IP ranges',
                    constraint: { clientAddress: '203.0.113.7' },
                  },
                ],
              },
            },
          }),
        } as unknown as Response;
      }
      return ok(AUTH);
    });
    renderAt('auth');

    const note = await screen.findByTestId('settings-field-note');
    const box = rowOf('allowed_ip_ranges')!.querySelector('textarea')!;
    fireEvent.change(box, { target: { value: '192.0.2.0/24' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe(REFUSAL);
    expect(rowOf('allowed_ip_ranges')!.contains(error)).toBe(true);
    // The note is still there, after the error, and both describe the control.
    expect(screen.getByTestId('settings-field-note')).toBe(note);
    expect(box.getAttribute('aria-describedby')).toBe(`${error.id} ${note.id}`);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    // The address is read once per visit, not again after the save.
    expect(addressReads()).toHaveLength(1);
  });
});

/**
 * objectstack#31260 — the organization's Allowed IP ranges (Setup → Access
 * policy, the `access_policy` namespace) shows the same note, read from the
 * route an organization administrator may call, `GET /api/v1/auth/client-address`
 * (gated to `setup.write` in the caller's current organization, the list's own
 * write permission). Its save check judges the same address the same way, so the
 * three sentences hold for it unchanged. A refused or failed read leaves the page
 * as it was: no note and no toast.
 */
describe('SettingsView — Access policy shows the address the server judges (objectstack#31260)', () => {
  const ORG_ADDRESS_URL = '/api/v1/auth/client-address';

  const ACCESS_POLICY = {
    manifest: {
      namespace: 'access_policy',
      version: 1,
      label: 'Access policy',
      scope: 'tenant',
      specifiers: [
        { type: 'textarea', key: 'allowed_ip_ranges', label: 'Allowed IP ranges', description: 'CIDR ranges.' },
        { type: 'number', key: 'session_idle_timeout_minutes', label: 'Idle timeout (minutes)' },
      ],
    },
    values: {
      allowed_ip_ranges: { value: null, source: 'default', locked: false },
      session_idle_timeout_minutes: { value: null, source: 'default', locked: false },
    },
  };

  /** The organization route's reads; the platform route's URL does not end with it. */
  const orgReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(ORG_ADDRESS_URL));

  /** Serve the namespace page, and answer the organization route with `address`. */
  function serveOrg(page: unknown, address: () => Promise<Response>) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith(ORG_ADDRESS_URL)) return address();
      if (String(url).endsWith(CLIENT_ADDRESS_URL)) return refused(403, 'PERMISSION_DENIED');
      return ok(page);
    });
  }

  it('draws the address under the list with the proxy sentence when trustProxy is off, from the organization route', async () => {
    serveOrg(ACCESS_POLICY, async () => ok({ clientAddress: '203.0.113.7', trustProxy: false }));
    renderAt('access_policy');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressDirect', '203.0.113.7'));
    expect(rowOf('allowed_ip_ranges')!.contains(note)).toBe(true);
    expect(rowOf('session_idle_timeout_minutes')!.querySelector('[data-testid="settings-field-note"]')).toBeNull();
    const box = rowOf('allowed_ip_ranges')!.querySelector('textarea')!;
    expect(box.getAttribute('aria-describedby')).toBe(note.id);

    // One read, at the organization route, with the session cookie; the
    // platform-admin route is never asked from this page.
    expect(orgReads()).toHaveLength(1);
    expect(orgReads()[0][1]).toMatchObject({ credentials: 'include' });
    expect(addressReads()).toHaveLength(0);
  });

  it('says the address came through the trusted proxy when trustProxy is on', async () => {
    serveOrg(ACCESS_POLICY, async () => ok({ clientAddress: '198.51.100.20', trustProxy: true }));
    renderAt('access_policy');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressViaProxy', '198.51.100.20'));
  });

  it('says no address could be established when the server answers null', async () => {
    serveOrg(ACCESS_POLICY, async () => ok({ clientAddress: null, trustProxy: false }));
    renderAt('access_policy');

    const note = await screen.findByTestId('settings-field-note');
    expect(note.textContent).toBe(sentence('clientAddressUnknown'));
  });

  it.each([
    ['a caller without setup.write (403)', async () => refused(403, 'PERMISSION_DENIED')],
    ['no session (401)', async () => refused(401, 'UNAUTHENTICATED')],
    [
      'a server without the route (404)',
      async () =>
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }),
        }) as unknown as Response,
    ],
    ['a body that is not the declared shape', async () => ok({ trustProxy: false })],
    ['a network failure', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('leaves the page as it was on %s: no note, no toast', async (_what, answer) => {
    serveOrg(ACCESS_POLICY, answer);
    renderAt('access_policy');

    await screen.findByText('Allowed IP ranges');
    await waitFor(() => expect(orgReads()).toHaveLength(1));
    // Let the rejected read settle before asserting its absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('settings-field-note')).toBeNull();
    expect(screen.queryByText(/Failed to load settings/)).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(rowOf('allowed_ip_ranges')!.querySelector('textarea')!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('the Authentication page still reads the platform route, never the organization one', async () => {
    serve(AUTH, async () => ok({ clientAddress: '203.0.113.7', trustProxy: false }));
    renderAt('auth');

    await screen.findByTestId('settings-field-note');
    expect(addressReads()).toHaveLength(1);
    expect(orgReads()).toHaveLength(0);
  });
});
