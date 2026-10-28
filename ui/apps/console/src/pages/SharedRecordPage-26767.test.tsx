// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26767 — a share link to any object other than `ai_conversations`
 * renders the shared record read-only, as labelled rows, and never as the raw
 * `JSON.stringify(record)` dump it used to print in a `pre` block.
 *
 * The stub answers `/share-links/:token/resolve` the way both producers do: the
 * enveloped `{ success, data: { record, link, redactFields } }`, with the
 * redacted fields already stripped from `record`. Every visitor is anonymous.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { formatDate } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import SharedRecordPage from './SharedRecordPage';

const TOKEN = 'tok_26767';

/** An `account`-like record as resolve hands it over, `ssn` already redacted. */
const ACCOUNT = {
  id: 'acc_1',
  name: 'Acme Corporation',
  annual_revenue: 1250000,
  is_active: true,
  founded_on: '2026-03-15',
  tags: ['enterprise', 'emea'],
  billing_address: { city: 'Paris', zip: '75001' },
  parent_id: null,
  created_at: '2026-01-02T03:04:05.000Z',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function shareServer(objectName: string, record: Record<string, unknown>, redactFields: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(raw, 'http://localhost');
      if (pathname === `/api/v1/share-links/${TOKEN}/resolve`) {
        return json(200, {
          success: true,
          data: {
            record,
            link: {
              id: 'sl_1',
              token: TOKEN,
              object_name: objectName,
              record_id: String(record.id),
              permission: 'view',
              audience: 'anyone',
            },
            redactFields,
          },
        });
      }
      if (pathname === `/api/v1/share-links/${TOKEN}/messages`) return json(200, { success: true, data: [] });
      return new Response(null, { status: 404 });
    }),
  );
}

function renderLink(language?: 'zh') {
  const routed = (
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {routed}
      </I18nProvider>
    ) : (
      routed
    ),
  );
}

/** The value cell beside the row whose label reads `label`. */
function valueOf(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.parentElement?.querySelector('dd');
  expect(value).not.toBeNull();
  return value!.textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SharedRecordPage — a shared non-chat record renders as read-only rows (objectstack#26767)', () => {
  it('renders each record key as a labelled, formatted row, and no pre block or JSON', async () => {
    shareServer('account', ACCOUNT, ['ssn']);
    const { container } = renderLink();

    expect(await screen.findByText('Shared account')).toBeInTheDocument();

    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('"name"');
    expect(container.textContent).not.toContain('{');

    expect(valueOf('Name')).toBe('Acme Corporation');
    expect(valueOf('Annual Revenue')).toBe('1,250,000');
    expect(valueOf('Is Active')).toBe('Yes');
    expect(valueOf('Founded On')).toBe(formatDate('2026-03-15', undefined, { locale: 'en' }));
    expect(valueOf('Founded On')).not.toBe('2026-03-15');
    expect(valueOf('Parent Id')).toBe('—');
    expect(valueOf('Created At')).not.toContain('T03:04:05');

    // Exactly the keys the record carried: no row is added, none is dropped.
    expect(container.querySelectorAll('dt')).toHaveLength(Object.keys(ACCOUNT).length);
    // System fields are shown, ordered after the business fields.
    const system = screen.getByTestId('shared-record-system-fields');
    expect(within(system).getByText('Id', { selector: 'dt' })).toBeInTheDocument();
    expect(within(system).getByText('Created At', { selector: 'dt' })).toBeInTheDocument();
    expect(within(system).queryByText('Name', { selector: 'dt' })).toBeNull();
  });

  it('a nested value renders as text, never as [object Object] or JSON', async () => {
    shareServer('account', ACCOUNT, []);
    const { container } = renderLink();

    await screen.findByText('Shared account');
    expect(valueOf('Tags')).toBe('enterprise, emea');
    expect(valueOf('Billing Address')).toBe('City: Paris; Zip: 75001');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('a redacted field stays absent, and the hidden-fields line still shows', async () => {
    shareServer('account', ACCOUNT, ['ssn']);
    renderLink();

    await screen.findByText('Shared account');
    expect(screen.queryByText('Ssn', { selector: 'dt' })).toBeNull();
    expect(screen.getByText('Some fields are hidden by the owner: ssn')).toBeInTheDocument();
  });

  it('a record with no fields left says so instead of an empty box', async () => {
    shareServer('account', {}, ['name']);
    const { container } = renderLink();

    await screen.findByText('Shared account');
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(container.querySelector('dt')).toBeNull();
  });

  it('the ai_conversations branch is unchanged: the transcript, not a field list', async () => {
    shareServer('ai_conversations', { id: 'conv_1', title: 'Quarterly plan' }, []);
    const { container } = renderLink();

    expect(await screen.findByText('Quarterly plan')).toBeInTheDocument();
    expect(await screen.findByText('This conversation has no messages yet.')).toBeInTheDocument();
    expect(container.querySelector('dt')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('under zh the value words come from the zh pack', async () => {
    const { zh, en } = builtInLocales;
    // Guard: these are real zh rows, not English copies.
    expect(zh.common.yes).not.toBe(en.common.yes);
    expect(zh.sharedRecord.redactedFields).not.toBe(en.sharedRecord.redactedFields);

    shareServer('account', { id: 'acc_1', is_active: true, is_vip: false }, ['ssn']);
    renderLink('zh');

    expect(await screen.findByText('分享的 account')).toBeInTheDocument();
    expect(valueOf('Is Active')).toBe(zh.common.yes);
    expect(valueOf('Is Vip')).toBe(zh.common.no);
    expect(screen.getByText(zh.sharedRecord.redactedFields.replace('{{fields}}', 'ssn'))).toBeInTheDocument();
  });
});
