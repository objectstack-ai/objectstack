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
function serve(putValues: Record<string, unknown> = {}) {
  const stored = structuredClone(PAYLOAD) as { values: Record<string, unknown> };
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

function renderView() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/mail']}>
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
