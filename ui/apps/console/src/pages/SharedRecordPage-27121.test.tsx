// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27121 — the shared-record page reads the resolve answer's
 * `fields` projection (objectstack#26991): each row carries the field's
 * authored label, a picklist value its authored option label, a currency
 * value its currency through `resolveFieldCurrency`, and a filled lookup a
 * neutral "Linked record" in place of its stored id (objectstack#31326). A key
 * with no `fields` entry, and an answer from a server that predates the
 * projection, keep the humanized label and the JSON-shape value.
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
import { I18nProvider, resolveFieldCurrency } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
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
function shareServer(
  record: Record<string, unknown>,
  fields?: Record<string, unknown>,
  objectName = 'account',
): string[] {
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
              object_name: objectName,
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

function renderLink(dataSource?: Record<string, unknown>, language?: 'zh') {
  const routed = (
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>
  );
  const withData = dataSource ? (
    <SchemaRendererProvider dataSource={dataSource as never}>{routed}</SchemaRendererProvider>
  ) : (
    routed
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {withData}
      </I18nProvider>
    ) : (
      withData
    ),
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

  it('a lookup shows a neutral placeholder under its authored label, and nothing but resolve is fetched', async () => {
    const requested = shareServer(ACCOUNT, FIELDS);
    renderLink();

    await screen.findByText('Shared account');
    expect(cellOf('Parent Account').textContent).toBe('Linked record');
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
    expect(cellOf('Parent Account').textContent).toBe('Linked record');
    // Neither the stored id nor the target's name reaches the page.
    expect(document.body.innerHTML).not.toContain('acc_parent_9');
    expect(document.body.textContent).not.toContain('Globex');
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

/**
 * objectstack#31326 — a lookup or master-detail value is the stored id of
 * another record. The page shows a neutral, localized "Linked record" for a
 * filled one and the empty face for an empty one; the id never reaches the
 * DOM. Which field is one is read from the `type` the projection serves.
 */
describe('SharedRecordPage — a lookup shows a neutral placeholder, never its stored id (objectstack#31326)', () => {
  /** An `opportunity` as resolve hands it over: one filled and one empty lookup, a master-detail, a multi lookup. */
  const OPPORTUNITY = {
    id: 'opp_7',
    name: 'Renewal 2027',
    account_id: 'acc_9f3e1c',
    partner_id: null,
    plan_id: 'plan_mdx_42',
    contact_ids: ['con_a11', 'con_b22'],
    created_by: 'usr_creator_5',
  };
  const OPPORTUNITY_FIELDS = {
    id: { label: 'Record ID', type: 'text' },
    name: { label: 'Opportunity Name', type: 'text' },
    account_id: { label: 'Account', type: 'lookup', reference: 'account', displayField: 'name' },
    partner_id: { label: 'Partner', type: 'lookup', reference: 'account', displayField: 'name' },
    plan_id: { label: 'Plan', type: 'master_detail', reference: 'plan', displayField: 'title' },
    contact_ids: { label: 'Contacts', type: 'lookup', reference: 'contact', multiple: true },
    created_by: { label: 'Created By', type: 'lookup', reference: 'sys_user' },
  };
  const STORED_IDS = ['acc_9f3e1c', 'plan_mdx_42', 'con_a11', 'con_b22', 'usr_creator_5'];

  it('a filled lookup shows the placeholder, and its id appears nowhere in the DOM', async () => {
    const requested = shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink();

    await screen.findByText('Shared opportunity');
    expect(cellOf('Account').textContent).toBe('Linked record');
    expect(cellOf('Created By').textContent).toBe('Linked record');
    expect(document.body.innerHTML).not.toContain('acc_9f3e1c');
    expect(document.body.innerHTML).not.toContain('usr_creator_5');
    expect(requested).toEqual([RESOLVE_PATH]);
  });

  it('a filled master-detail shows the placeholder, and its id appears nowhere in the DOM', async () => {
    shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink();

    await screen.findByText('Shared opportunity');
    expect(cellOf('Plan').textContent).toBe('Linked record');
    expect(document.body.innerHTML).not.toContain('plan_mdx_42');
  });

  it('a multiple lookup shows the placeholder, and none of its ids', async () => {
    shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink();

    await screen.findByText('Shared opportunity');
    expect(cellOf('Contacts').textContent).toBe('Linked record');
    for (const id of STORED_IDS) expect(document.body.innerHTML).not.toContain(id);
  });

  it('an empty lookup renders empty, as before', async () => {
    shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink();

    await screen.findByText('Shared opportunity');
    expect(cellOf('Partner').textContent).toBe('—');
  });

  it('the placeholder speaks the session language', async () => {
    const zh = builtInLocales['zh-Hans'].sharedRecord.linkedRecord;
    // Guard: a real zh row, not an English copy.
    expect(zh).not.toBe(builtInLocales.en.sharedRecord.linkedRecord);
    shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink(undefined, 'zh');

    await screen.findByText(builtInLocales['zh-Hans'].sharedRecord.sharedObject.replace('{{object}}', 'opportunity'));
    expect(cellOf('Account').textContent).toBe(zh);
    expect(document.body.innerHTML).not.toContain('acc_9f3e1c');
  });

  it('a text field renders its value as before (control)', async () => {
    shareServer(OPPORTUNITY, OPPORTUNITY_FIELDS, 'opportunity');
    renderLink();

    await screen.findByText('Shared opportunity');
    expect(cellOf('Opportunity Name').textContent).toBe('Renewal 2027');
    expect(cellOf('Record ID').textContent).toBe('opp_7');
  });
});
