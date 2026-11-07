/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A field an env variable pins can have its SAVED value cleared from Setup
 * (objectstack#30665), so removing the variable later does not bring that
 * value back.
 *
 * The namespace read lists, beneath an in-force `env` entry, the stored
 * cascade the key falls back to (objectstack#30823), a secret's entries as the
 * read mask or `null`; and the server lets a clear (`null`) through the pin
 * while refusing every other write (objectstack#30385). The control appears
 * only where a value is stored at the scope this page writes, the one the
 * clear nulls.
 *
 * Driven over a stubbed `fetch` and the REAL `../api` module, so the PUT body
 * is read as it leaves the client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import { SettingsView } from '../SettingsView';

const MASK = '•'.repeat(8);
const ENV = (value: unknown, name: string) => ({
  scope: 'env',
  value,
  locked: true,
  lockedReason: `Set via env: ${name}`,
  effective: true,
});

/** Pinned, with a value stored at the page's write scope beneath the pin. */
function pinned(value: unknown, name: string, beneath: Array<{ scope: string; value: unknown }>) {
  return {
    value,
    source: 'env',
    locked: true,
    lockedReason: `Set via env: ${name}`,
    cascadeChain: [ENV(value, name), ...beneath],
  };
}

const PAYLOAD = {
  manifest: {
    namespace: 'auth',
    version: 1,
    label: 'Authentication',
    scope: 'global',
    specifiers: [
      { type: 'text', key: 'allowed_ip_ranges', label: 'Allowed IP ranges' },
      { type: 'password', key: 'webhook_secret', label: 'Webhook secret' },
      { type: 'toggle', key: 'require_mfa', label: 'Require MFA', default: false },
      { type: 'text', key: 'sign_in_message', label: 'Sign-in message', default: 'Welcome' },
      { type: 'text', key: 'org_banner', label: 'Organization banner', scope: 'tenant' },
      { type: 'text', key: 'support_email', label: 'Support email' },
    ],
  },
  values: {
    allowed_ip_ranges: pinned('', 'OS_AUTH_ALLOWED_IP_RANGES', [
      { scope: 'global', value: '10.0.0.0/8' },
      { scope: 'default', value: null },
    ]),
    webhook_secret: pinned(MASK, 'OS_AUTH_WEBHOOK_SECRET', [
      { scope: 'global', value: MASK },
      { scope: 'default', value: null },
    ]),
    require_mfa: pinned(true, 'OS_AUTH_REQUIRE_MFA', [
      { scope: 'global', value: false },
      { scope: 'default', value: false },
    ]),
    // Pinned, nothing stored beneath: only the default.
    sign_in_message: pinned('Hi', 'OS_AUTH_SIGN_IN_MESSAGE', [
      { scope: 'global', value: null },
      { scope: 'default', value: 'Welcome' },
    ]),
    // Pinned, stored only ABOVE the page's write scope: a tenant clear cannot remove it.
    org_banner: pinned('Hello', 'OS_AUTH_ORG_BANNER', [
      { scope: 'global', value: 'Old banner' },
      { scope: 'default', value: null },
    ]),
    // Not pinned at all.
    support_email: { value: 'help@example.com', source: 'global', locked: false },
  },
};

/** The server's answer to the clear: the pin still answers, nothing stored beneath. */
const CLEARED_IP_RANGES = pinned('', 'OS_AUTH_ALLOWED_IP_RANGES', []);
const REREAD_IP_RANGES = pinned('', 'OS_AUTH_ALLOWED_IP_RANGES', [
  { scope: 'global', value: null },
  { scope: 'default', value: null },
]);

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/** GET answers the page; a PUT answers `putValues` and the next GET reads `rereadValues`. */
function serve(putValues: Record<string, unknown>, rereadValues: Record<string, unknown> = putValues) {
  const stored = structuredClone(PAYLOAD) as { values: Record<string, unknown> };
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      Object.assign(stored.values, structuredClone(rereadValues));
      return ok({ success: true, data: { values: putValues } });
    }
    return ok({ success: true, data: structuredClone(stored) });
  });
}

function puts(): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => String((init as RequestInit).body));
}

function renderView() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/auth']}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The row a field label belongs to. */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest('[data-settings-key]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

const CLEAR = /^clear the saved value$/i;

async function confirmClear(label: string) {
  fireEvent.click(within(rowOf(label)).getByRole('button', { name: CLEAR }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: CLEAR }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('clear the value saved beneath an env pin (objectstack#30665)', () => {
  it('offers the clear only on a pinned row with a value stored at the scope the page writes', async () => {
    serve({});
    renderView();
    await screen.findByText('Allowed IP ranges');

    for (const label of ['Allowed IP ranges', 'Webhook secret', 'Require MFA']) {
      expect(within(rowOf(label)).getByRole('button', { name: CLEAR })).toBeTruthy();
    }
    for (const label of ['Sign-in message', 'Organization banner', 'Support email']) {
      expect(within(rowOf(label)).queryByRole('button', { name: CLEAR })).toBeNull();
      expect(within(rowOf(label)).queryByTestId('settings-saved-beneath-pin')).toBeNull();
    }
    expect(screen.getAllByRole('button', { name: CLEAR })).toHaveLength(3);
  });

  it('says the environment value stays in force, and never says delete', async () => {
    serve({});
    renderView();
    await screen.findByText('Allowed IP ranges');
    const line = within(rowOf('Allowed IP ranges')).getByTestId('settings-saved-beneath-pin');
    expect(line.textContent).toMatch(/environment value stays in force/i);

    fireEvent.click(within(rowOf('Allowed IP ranges')).getByRole('button', { name: CLEAR }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/environment value stays in force/i);
    for (const text of [line.textContent, dialog.textContent]) expect(text).not.toMatch(/delet/i);
  });

  it('sends null for that one key after the confirm, and the row follows the server answer', async () => {
    serve({ allowed_ip_ranges: CLEARED_IP_RANGES }, { allowed_ip_ranges: REREAD_IP_RANGES });
    renderView();
    await screen.findByText('Allowed IP ranges');

    await confirmClear('Allowed IP ranges');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toBe('{"allowed_ip_ranges":null}');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved value cleared'));

    // Still pinned, still read-only, and nothing left to clear.
    await waitFor(() =>
      expect(within(rowOf('Allowed IP ranges')).queryByRole('button', { name: CLEAR })).toBeNull(),
    );
    const row = rowOf('Allowed IP ranges');
    expect(within(row).getByText('Locked by env')).toBeTruthy();
    expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    // The other pinned rows keep theirs.
    expect(screen.getAllByRole('button', { name: CLEAR })).toHaveLength(2);
  });

  it('a masked secret beneath the pin is a stored value, and its clear sends null', async () => {
    serve({ webhook_secret: pinned(MASK, 'OS_AUTH_WEBHOOK_SECRET', []) });
    renderView();
    await screen.findByText('Webhook secret');
    await confirmClear('Webhook secret');
    await waitFor(() => expect(puts()).toEqual(['{"webhook_secret":null}']));
  });

  it('CONTROL: Cancel sends nothing', async () => {
    serve({});
    renderView();
    await screen.findByText('Allowed IP ranges');
    fireEvent.click(within(rowOf('Allowed IP ranges')).getByRole('button', { name: CLEAR }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(puts()).toEqual([]);
  });

  it('leaves the page draft alone: only the cleared key is written, the edit stays unsaved', async () => {
    serve({ allowed_ip_ranges: CLEARED_IP_RANGES });
    renderView();
    fireEvent.change(await screen.findByDisplayValue('help@example.com'), {
      target: { value: 'ops@example.com' },
    });
    expect(screen.getByTestId('settings-unsaved-count')).toBeTruthy();

    await confirmClear('Allowed IP ranges');
    await waitFor(() => expect(puts()).toEqual(['{"allowed_ip_ranges":null}']));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByTestId('settings-unsaved-count')).toBeTruthy();
    expect(screen.getByDisplayValue('ops@example.com')).toBeTruthy();
  });

  it("a refused clear shows the server's sentence", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return {
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({
            success: false,
            error: {
              code: 'SETTINGS_LOCKED',
              message: "Setting 'auth.allowed_ip_ranges' is locked (locked-by-global).",
              details: { key: 'allowed_ip_ranges' },
            },
          }),
        } as unknown as Response;
      }
      return ok({ success: true, data: structuredClone(PAYLOAD) });
    });
    renderView();
    await screen.findByText('Allowed IP ranges');
    await confirmClear('Allowed IP ranges');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Setting 'auth.allowed_ip_ranges' is locked (locked-by-global).",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(rowOf('Allowed IP ranges')).getByRole('button', { name: CLEAR })).toBeTruthy();
  });
});
