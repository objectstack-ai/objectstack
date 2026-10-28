// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27121 — the shared-record page reads the resolve answer's
 * `fields` projection (objectstack#26991): each row carries the field's
 * authored label, a picklist value its authored option label, a currency
 * value its currency through `resolveFieldCurrency`, and a lookup its stored
 * id. A key with no `fields` entry, and an answer from a server that predates
 * the projection, keep the humanized label and the JSON-shape value.
 *
 * The stub answers `/share-links/:token/resolve` the way both producers do:
 * enveloped, with the redacted fields already stripped from `record` and
 * `fields` covering exactly the keys `record` carries. Every visitor is
 * anonymous, and every request the page makes is recorded, so a renderer that
 * fetched the lookup target (or `/meta`) would show up here.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { formatCurrency } from '@object-ui/fields';
import { resolveFieldCurrency } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import SharedRecordPage from './SharedRecordPage';

const TOKEN = 'tok_27121';
const RESOLVE_PATH = `/api/v1/share-links/${TOKEN}/resolve`;

/** An `account`-like record as resolve hands it over, `ssn` already redacted. */
const ACCOUNT = {
  id: 'acc_1',
  name: 'Acme Corporation',
  account_type: 'customer',
  regions: ['emea', 'apac'],
  annual_revenue: 1250000,
  pipeline_value: 480000,
  parent_id: 'acc_parent_9',
  founded_on: '2026-03-15',
};

const FIXED_EUR = { currencyMode: 'fixed', defaultCurrency: 'EUR' } as const;
const DYNAMIC = { currencyMode: 'dynamic', defaultCurrency: 'CNY' } as const;

/** The projection the server builds for ACCOUNT — `founded_on` deliberately left out. */
const FIELDS = {
  id: { label: 'Record ID', type: 'text' },
  name: { label: 'Account Name', type: 'text' },
  account_type: {
    label: 'Relationship',
    type: 'select',
    options: [
      { value: 'prospect', label: 'Prospect' },
      { value: 'customer', label: 'Paying customer', color: 'green' },
    ],
  },
  regions: {
    label: 'Sales Regions',
    type: 'multiselect',
    multiple: true,
    options: [
      { value: 'emea', label: 'Europe & Africa' },
      { value: 'apac', label: 'Asia Pacific' },
    ],
  },
  annual_revenue: { label: 'Yearly Revenue', type: 'currency', currencyConfig: FIXED_EUR },
  pipeline_value: { label: 'Open Pipeline', type: 'currency', currencyConfig: DYNAMIC },
  parent_id: { label: 'Parent Account', type: 'lookup', reference: 'account', displayField: 'name' },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stub the resolve route; answer `fields` only when given. Returns every requested path. */
function shareServer(record: Record<string, unknown>, fields?: Record<string, unknown>): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(raw, 'http://localhost');
      requested.push(pathname);
      if (pathname === RESOLVE_PATH) {
        return json(200, {
          success: true,
          data: {
            record,
            link: {
              id: 'sl_1',
              token: TOKEN,
              object_name: 'account',
              record_id: String(record.id),
              permission: 'view',
              audience: 'anyone',
            },
            redactFields: ['ssn'],
            ...(fields ? { fields } : {}),
          },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return requested;
}

function renderLink(dataSource?: Record<string, unknown>) {
  const routed = (
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    dataSource ? <SchemaRendererProvider dataSource={dataSource as never}>{routed}</SchemaRendererProvider> : routed,
  );
}

/** The value cell beside the row whose label reads `label`. */
function cellOf(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.parentElement?.querySelector('dd');
  expect(value).not.toBeNull();
  return value as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SharedRecordPage — rows read the resolve answer’s fields projection (objectstack#27121)', () => {
  it('labels each row with the field’s authored label', async () => {
    shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    expect(cellOf('Account Name')).toHaveTextContent('Acme Corporation');
    expect(cellOf('Yearly Revenue')).toBeInTheDocument();
    expect(cellOf('Record ID')).toHaveTextContent('acc_1');
    // The humanized key is gone wherever an authored label exists.
    expect(screen.queryByText('Name', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Annual Revenue', { selector: 'dt' })).toBeNull();
  });

  it('a picklist value shows its authored option label and colour, one per value when multiple', async () => {
    shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    const relationship = cellOf('Relationship');
    const badge = within(relationship).getByText('Paying customer');
    // The option label, not the stored code.
    expect(relationship.textContent).toBe('Paying customer');
    // The option's declared colour reaches the badge the detail view draws.
    expect(badge.closest('[class*="green"]')).not.toBeNull();

    const regions = cellOf('Sales Regions');
    expect(within(regions).getByText('Europe & Africa')).toBeInTheDocument();
    expect(within(regions).getByText('Asia Pacific')).toBeInTheDocument();
  });

  it('a currency value is formatted in the currency resolveFieldCurrency answers for its currencyConfig', async () => {
    shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    // Fixed mode: the declared code.
    const eur = resolveFieldCurrency({ currencyConfig: FIXED_EUR });
    expect(eur).toBe('EUR');
    expect(cellOf('Yearly Revenue')).toHaveTextContent(formatCurrency(1250000, eur, 'en'));
    expect(cellOf('Yearly Revenue').textContent).toContain('€');

    // Dynamic mode with no tenant default on this page: whatever the shared
    // resolution answers today (no code), so a plain amount and never CNY.
    const dynamic = resolveFieldCurrency({ currencyConfig: DYNAMIC });
    expect(dynamic).toBeUndefined();
    expect(cellOf('Open Pipeline')).toHaveTextContent(formatCurrency(480000, dynamic, 'en'));
    expect(cellOf('Open Pipeline').textContent).not.toMatch(/CN¥|¥|CNY/);
  });

  it('a lookup shows its stored id under its authored label, and nothing but resolve is fetched', async () => {
    const requested = shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    expect(cellOf('Parent Account').textContent).toBe('acc_parent_9');
    // One request, to resolve: no lookup-name read, no /meta, no /data.
    expect(requested).toEqual([RESOLVE_PATH]);
  });

  it('a lookup never reads its target, even under a host that holds a data source', async () => {
    // The `/s/:token` route mounts no data source today; this pins the page's
    // own guard, so hoisting one above the route cannot turn an anonymous
    // visit into a read of the referenced record.
    const dataSource = {
      find: vi.fn(async () => ({ data: [{ id: 'acc_parent_9', name: 'Globex' }] })),
      findOne: vi.fn(async () => ({ id: 'acc_parent_9', name: 'Globex' })),
      getObjectSchema: vi.fn(async () => ({ name: 'account', fields: {} })),
    };
    const requested = shareServer(ACCOUNT, FIELDS);
    renderLink(dataSource);

    await screen.findByText('Shared account');
    // Let any effect a renderer scheduled settle before reading the spies.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cellOf('Parent Account').textContent).toBe('acc_parent_9');
    expect(dataSource.find).not.toHaveBeenCalled();
    expect(dataSource.findOne).not.toHaveBeenCalled();
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
    expect(requested).toEqual([RESOLVE_PATH]);
  });

  it('a key with no fields entry keeps the humanized label and the JSON-shape value (control)', async () => {
    shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    const founded = cellOf('Founded On');
    expect(founded.textContent).not.toBe('2026-03-15');
    expect(founded.textContent).not.toBe('');
  });

  it('an answer without fields (an older server) renders exactly as before the projection', async () => {
    const requested = shareServer(ACCOUNT);
    const { container } = renderLink();

    await screen.findByText('Shared account');
    expect(cellOf('Name').textContent).toBe('Acme Corporation');
    expect(cellOf('Account Type').textContent).toBe('customer');
    expect(cellOf('Annual Revenue').textContent).toBe('1,250,000');
    expect(cellOf('Parent Id').textContent).toBe('acc_parent_9');
    expect(screen.queryByText('Account Name', { selector: 'dt' })).toBeNull();
    expect(container.querySelectorAll('dt')).toHaveLength(Object.keys(ACCOUNT).length);
    expect(requested).toEqual([RESOLVE_PATH]);
  });
});
