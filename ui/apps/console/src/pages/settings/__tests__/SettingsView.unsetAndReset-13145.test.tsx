/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A saved settings value can go back to unset, and an override back to the
 * value the layer above carries (objectui#13145).
 *
 * ## What was broken
 *
 * The settings door reads `null` as "clear this layer's value": the server
 * deletes the row and the key falls back to the layer above (measured on the
 * card: `PUT {"smtp_host": null}` restores the default). The console never
 * sent it. An emptied text box went into the draft as `""`, a stored value
 * like any other, so Setup, Email refused the save of a cleared SMTP host as
 * incomplete. And a row carrying the `Overrides` badge had no action at all
 * that would clear it, so a Localization value changed and changed back stayed
 * an override for good.
 *
 * ## What is driven here
 *
 * The whole page over a stubbed `fetch`, the REAL `../api` module, so each
 * assertion reads the PUT body as it leaves the client: a `null` dropped or
 * rewritten by a serializer would show up here, not only a wrong draft.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

/** A tenant value over a manifest default: the row reads `Overrides`. */
const OVERRIDES_COUNTRY = {
  value: 'GB',
  source: 'tenant',
  locked: false,
  cascadeChain: [
    { scope: 'tenant', value: 'GB', effective: true },
    { scope: 'default', value: 'US' },
  ],
};

/** The server's answer once the tenant row is cleared: the global layer shows through. */
const INHERITED_COUNTRY = {
  value: 'US',
  source: 'global',
  locked: false,
  cascadeChain: [
    { scope: 'tenant', value: null },
    { scope: 'global', value: 'US', effective: true },
    { scope: 'default', value: 'US' },
  ],
};

const PAYLOAD = {
  manifest: {
    namespace: 'mail',
    version: 1,
    label: 'Email',
    specifiers: [
      { type: 'text', key: 'smtp_host', label: 'SMTP Host' },
      { type: 'number', key: 'smtp_port', label: 'SMTP Port' },
      { type: 'password', key: 'smtp_password', label: 'SMTP Password' },
      { type: 'text', key: 'default_country', label: 'Default country' },
      { type: 'text', key: 'sender_name', label: 'Sender name' },
    ],
  },
  values: {
    smtp_host: { value: 'UX test', source: 'tenant', locked: false },
    smtp_port: { value: 25, source: 'tenant', locked: false },
    smtp_password: { value: '********', source: 'tenant', locked: false },
    default_country: OVERRIDES_COUNTRY,
    sender_name: INHERITED_COUNTRY,
  },
};

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/**
 * GET answers the page; PUT answers `values` (the read-back the view merges)
 * and stores them, so a later GET answers the same: the page reads the
 * namespace again after a save (objectui#13382).
 */
function serve(putValues: Record<string, unknown> = {}, payload: unknown = PAYLOAD) {
  const stored = structuredClone(payload) as { values: Record<string, unknown> };
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      Object.assign(stored.values, structuredClone(putValues));
      return ok({ success: true, data: { values: putValues } });
    }
    return ok({ success: true, data: structuredClone(stored) });
  });
}

/** The raw body of the one PUT the page sent. */
function sentBody(): string {
  const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
  expect(puts).toHaveLength(1);
  return String((puts[0][1] as RequestInit).body);
}

function renderView(namespace = 'mail') {
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

/** The row (header, control, help) a field label belongs to. */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest('.py-2');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

async function save() {
  fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(sentBody()).toBeTruthy());
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

describe('clearing a text box means unset (objectui#13145)', () => {
  it('a cleared text field is sent as null, not ""', async () => {
    serve();
    renderView();
    fireEvent.change(await screen.findByDisplayValue('UX test'), { target: { value: '' } });
    await save();

    const body = sentBody();
    expect(JSON.parse(body)).toEqual({ smtp_host: null });
    // The wire itself, not only the parse: `""` would also parse as falsy.
    expect(body).toBe('{"smtp_host":null}');
  });

  it('a cleared password box is sent as null, not ""', async () => {
    serve();
    renderView();
    await screen.findByText('SMTP Password');
    const box = rowOf('SMTP Password').querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.change(box, { target: { value: '' } });
    await save();
    expect(JSON.parse(sentBody())).toEqual({ smtp_password: null });
  });

  it('CONTROL: a typed value is still sent as the string', async () => {
    serve();
    renderView();
    fireEvent.change(await screen.findByDisplayValue('UX test'), {
      target: { value: 'smtp.example.com' },
    });
    await save();
    expect(JSON.parse(sentBody())).toEqual({ smtp_host: 'smtp.example.com' });
  });

  it('CONTROL: the number control is unchanged (empty is null, a number is a number)', async () => {
    serve();
    renderView();
    const port = await screen.findByDisplayValue('25');
    fireEvent.change(port, { target: { value: '' } });
    fireEvent.change(port, { target: { value: '2525' } });
    await save();
    expect(JSON.parse(sentBody())).toEqual({ smtp_port: 2525 });
  });
});

describe('Reset to default beside an Overrides badge (objectui#13145)', () => {
  it('sends null for that key, and the badge follows the server answer', async () => {
    serve({ default_country: INHERITED_COUNTRY });
    renderView();
    await screen.findByText('Default country');

    const row = rowOf('Default country');
    expect(within(row).getByText(/^Overrides/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /reset to default/i }));

    // The draft holds the clear: the box empties and the page is dirty.
    expect((row.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('settings-unsaved-count')).toBeTruthy();
    // Nothing left to reset until it is saved or discarded.
    expect(within(row).queryByRole('button', { name: /reset to default/i })).toBeNull();

    await save();
    expect(sentBody()).toBe('{"default_country":null}');

    // The badge is the server's answer for the row, not a state the client made up.
    await waitFor(() => expect(within(rowOf('Default country')).getByText(/^Inherited from/)).toBeTruthy());
    const after = rowOf('Default country');
    expect(within(after).queryByText(/^Overrides/)).toBeNull();
    expect(within(after).queryByRole('button', { name: /reset to default/i })).toBeNull();
    expect((after.querySelector('input') as HTMLInputElement).value).toBe('US');
  });

  it('CONTROL: an Inherited row and a row with no badge offer no reset', async () => {
    serve();
    renderView();
    await screen.findByText('Sender name');
    const inherited = rowOf('Sender name');
    expect(within(inherited).getByText(/^Inherited from/)).toBeTruthy();
    expect(within(inherited).queryByRole('button', { name: /reset to default/i })).toBeNull();
    expect(within(rowOf('SMTP Host')).queryByRole('button', { name: /reset to default/i })).toBeNull();
    // Exactly one reset on the page: the Overrides row's.
    expect(screen.getAllByRole('button', { name: /reset to default/i })).toHaveLength(1);
  });
});

/**
 * A page whose manifest declares `scope: 'global'` writes the deployment's
 * row: the server resolves each key's write scope as the specifier's `scope`,
 * else the manifest's, else the spec default `tenant`. A value at that scope
 * was set on this page, so it is not "inherited", and Reset to default is the
 * way back (objectstack#30329).
 */
const DEPLOYMENT_PAYLOAD = {
  manifest: {
    namespace: 'auth',
    version: 1,
    label: 'Authentication',
    scope: 'global',
    specifiers: [
      { type: 'number', key: 'password_min_length', label: 'Minimum password length', default: 8 },
      { type: 'toggle', key: 'require_mfa', label: 'Require MFA', default: false },
      {
        type: 'select',
        key: 'session_policy',
        label: 'Session policy',
        default: 'lax',
        options: [
          { value: 'strict', label: 'Strict' },
          { value: 'lax', label: 'Lax' },
        ],
      },
      { type: 'number', key: 'max_sessions', label: 'Maximum sessions', default: 5 },
      { type: 'text', key: 'sign_in_message', label: 'Sign-in message', default: 'Welcome' },
      { type: 'text', key: 'org_note', label: 'Organization note', scope: 'tenant' },
    ],
  },
  values: {
    password_min_length: {
      value: 12,
      source: 'global',
      locked: false,
      cascadeChain: [
        { scope: 'global', value: 12, effective: true },
        { scope: 'default', value: 8 },
      ],
    },
    require_mfa: {
      value: true,
      source: 'global',
      locked: false,
      cascadeChain: [
        { scope: 'global', value: true, effective: true },
        { scope: 'default', value: false },
      ],
    },
    session_policy: {
      value: 'strict',
      source: 'global',
      locked: false,
      cascadeChain: [
        { scope: 'global', value: 'strict', effective: true },
        { scope: 'default', value: 'lax' },
      ],
    },
    max_sessions: {
      value: 3,
      source: 'env',
      locked: true,
      lockedReason: 'OS_AUTH_MAX_SESSIONS',
      cascadeChain: [
        { scope: 'env', value: 3, locked: true, effective: true },
        { scope: 'global', value: 4 },
        { scope: 'default', value: 5 },
      ],
    },
    sign_in_message: {
      value: 'Welcome',
      source: 'default',
      locked: false,
      cascadeChain: [{ scope: 'default', value: 'Welcome', effective: true }],
    },
    org_note: {
      value: 'Platform note',
      source: 'global',
      locked: false,
      cascadeChain: [
        { scope: 'global', value: 'Platform note', effective: true },
        { scope: 'tenant', value: null },
        { scope: 'default', value: null },
      ],
    },
  },
};

/** The server's answer once the deployment row is cleared: the default shows. */
const MIN_LENGTH_DEFAULT = {
  value: 8,
  source: 'default',
  locked: false,
  cascadeChain: [{ scope: 'default', value: 8, effective: true }],
};

describe('a value set on a deployment-level page (objectstack#30329)', () => {
  it('reads as changed here, names the default, and Reset sends null', async () => {
    serve({ password_min_length: MIN_LENGTH_DEFAULT }, DEPLOYMENT_PAYLOAD);
    renderView('auth');
    await screen.findByText('Minimum password length');

    const row = rowOf('Minimum password length');
    expect(within(row).queryByText(/^Inherited from/)).toBeNull();
    expect(within(row).getByText('Modified')).toBeTruthy();
    expect(within(row).getByText('Default: 8')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /reset to default/i }));

    // The draft holds the clear; Save confirms it like any other change.
    expect((row.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('settings-unsaved-count')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /reset to default/i })).toBeNull();

    await save();
    expect(sentBody()).toBe('{"password_min_length":null}');

    // After the save the row is the server's answer: the default, no badge.
    await waitFor(() =>
      expect((rowOf('Minimum password length').querySelector('input') as HTMLInputElement).value).toBe('8'),
    );
    const after = rowOf('Minimum password length');
    expect(within(after).queryByText('Modified')).toBeNull();
    expect(within(after).queryByRole('button', { name: /reset to default/i })).toBeNull();
  });

  it('names a toggle default and an option default in words', async () => {
    serve({}, DEPLOYMENT_PAYLOAD);
    renderView('auth');
    await screen.findByText('Require MFA');

    const toggle = screen.getByText('Require MFA').closest('[data-settings-key]') as HTMLElement;
    expect(within(toggle).getByText('Modified')).toBeTruthy();
    expect(within(toggle).getByText('Default: No')).toBeTruthy();
    expect(within(toggle).getByRole('button', { name: /reset to default/i })).toBeTruthy();

    const select = rowOf('Session policy');
    expect(within(select).getByText('Modified')).toBeTruthy();
    expect(within(select).getByText('Default: Lax')).toBeTruthy();
    expect(within(select).getByRole('button', { name: /reset to default/i })).toBeTruthy();
  });

  it('CONTROL: an env-locked value, a default value and a tenant-scoped key offer no reset', async () => {
    serve({}, DEPLOYMENT_PAYLOAD);
    renderView('auth');
    await screen.findByText('Maximum sessions');

    const locked = rowOf('Maximum sessions');
    expect(within(locked).queryByText('Modified')).toBeNull();
    expect(within(locked).queryByRole('button', { name: /reset to default/i })).toBeNull();

    const unset = rowOf('Sign-in message');
    expect(within(unset).queryByText('Modified')).toBeNull();
    expect(within(unset).queryByRole('button', { name: /reset to default/i })).toBeNull();

    // The specifier's own `scope: 'tenant'` outranks the manifest's: this page
    // writes the organization's row, so the deployment value stays inherited.
    const orgNote = rowOf('Organization note');
    expect(within(orgNote).getByText(/^Inherited from/)).toBeTruthy();
    expect(within(orgNote).queryByText('Modified')).toBeNull();
    expect(within(orgNote).queryByRole('button', { name: /reset to default/i })).toBeNull();

    // The three rows set on this page carry the page's only resets.
    expect(screen.getAllByRole('button', { name: /reset to default/i })).toHaveLength(3);
  });
});
