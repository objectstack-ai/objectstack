// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog's facet filters and card badges read the marketplace taxonomy
 * of `@objectstack/spec/marketplace` (objectstack#31011).
 *
 * ## What the cases pin
 *
 * - Business function and industry are toggle rows: OR inside a row. Solution
 *   type is a segment with All. The rows combine with AND, and with the search
 *   box. Each value carries the count of listings that hold it under the other
 *   facets' selection.
 * - A facet no loaded listing carries is not drawn: with no taxonomy on the
 *   wire there is no filter at all, and industries hide while only business
 *   functions are served.
 * - A listing that declares no solution type is counted and filtered under
 *   the spec's default, `app`.
 * - The card shows the primary business function (the first listed) and a
 *   Beta badge for `maturity: 'beta'` only.
 * - A value outside the spec's vocabulary is drawn nowhere, neither as a
 *   facet value nor as a badge: no raw spelling reaches the page.
 * - A list column that is not an array (the proxy hands rows over unparsed)
 *   reads as no values: its facet hides and the catalog still renders.
 *
 * Every click goes through the rendered buttons. `fetch` is stubbed by path
 * with the catalog body the proxy serves; the labels are the `en` pack's.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en } from '@object-ui/i18n/locales';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = {};
  return { useNavigate: () => navigate, useParams: () => params };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const L = en.marketplace;

const row = (id: string, name: string, taxonomy: Record<string, unknown>) => ({
  id: `pkg_${id}`,
  manifest_id: `com.acme.${id}`,
  display_name: name,
  publisher: 'acme',
  latest_version: { id: `ver_${id}`, version: '1.0.0' },
  ...taxonomy,
});

const SALES = row('sales', 'Sales Pipeline', {
  business_functions: ['sales', 'marketing'],
  industries: ['manufacturing'],
  solution_type: 'app',
  maturity: 'stable',
});
const HIRING = row('hiring', 'Hiring Kit', {
  business_functions: ['hr'],
  industries: [],
  solution_type: 'template',
  maturity: 'beta',
});
const BILLING = row('billing', 'Billing Connector', {
  business_functions: ['finance', 'sales'],
  industries: ['retail'],
  solution_type: 'connector',
});
/** Declares no solution type: the spec reads it as `app`. */
const UNTYPED = row('untyped', 'Untyped Desk', { business_functions: ['customer_service'] });

const TAXONOMY_CATALOG = [SALES, HIRING, BILLING, UNTYPED];

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function boot(items: unknown[]) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        return answer(200, { success: true, data: { items, total: items.length, limit: 100, offset: 0 } });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: [], total: 0 } });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
}

async function renderPage(items: unknown[]) {
  await boot(items);
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
  // The catalog has answered once its first card is drawn.
  await screen.findByTestId(`marketplace-card-${(items[0] as { manifest_id: string }).manifest_id}`);
}

/** The manifest ids of the cards drawn, in order. */
const shownCards = () =>
  screen.queryAllByTestId(/^marketplace-card-com\./).map((el) => el.getAttribute('data-testid')!.replace('marketplace-card-', ''));

const facetButton = (facet: string, value: string) => screen.getByTestId(`marketplace-facet-${facet}-${value}`);
const facetCount = (facet: string, value: string) =>
  screen.getByTestId(`marketplace-facet-${facet}-${value}-count`).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Marketplace facet filters (objectstack#31011)', () => {
  it('draws the three facets in the spec order, labelled from the pack, each value with its count', async () => {
    await renderPage(TAXONOMY_CATALOG);

    const fn = screen.getByRole('group', { name: L.facet.businessFunction });
    // Only the values a loaded listing carries, in the spec's order.
    expect(within(fn).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'marketplace-facet-businessFunction-sales',
      'marketplace-facet-businessFunction-marketing',
      'marketplace-facet-businessFunction-customer_service',
      'marketplace-facet-businessFunction-finance',
      'marketplace-facet-businessFunction-hr',
    ]);
    expect(facetButton('businessFunction', 'sales')).toHaveTextContent(L.businessFunction.sales);
    expect(facetCount('businessFunction', 'sales')).toBe('2');
    expect(facetCount('businessFunction', 'hr')).toBe('1');

    expect(screen.getByRole('group', { name: L.facet.industry })).toBeInTheDocument();
    expect(facetButton('industry', 'manufacturing')).toHaveTextContent(L.industry.manufacturing);

    const type = screen.getByRole('group', { name: L.facet.solutionType });
    expect(within(type).getByRole('button', { name: L.all })).toHaveAttribute('aria-pressed', 'true');
    // The untyped listing counts under the default, `app`.
    expect(facetCount('solutionType', 'app')).toBe('2');
    expect(facetCount('solutionType', 'template')).toBe('1');
    expect(facetCount('solutionType', 'connector')).toBe('1');
  });

  it('ORs the values inside one facet', async () => {
    await renderPage(TAXONOMY_CATALOG);

    fireEvent.click(facetButton('businessFunction', 'sales'));
    expect(facetButton('businessFunction', 'sales')).toHaveAttribute('aria-pressed', 'true');
    expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.billing']);

    fireEvent.click(facetButton('businessFunction', 'hr'));
    expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.hiring', 'com.acme.billing']);

    // A second click clears the value.
    fireEvent.click(facetButton('businessFunction', 'sales'));
    fireEvent.click(facetButton('businessFunction', 'hr'));
    expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.hiring', 'com.acme.billing', 'com.acme.untyped']);
  });

  it('ANDs the facets, and counts each against the others', async () => {
    await renderPage(TAXONOMY_CATALOG);

    fireEvent.click(facetButton('businessFunction', 'sales'));
    fireEvent.click(facetButton('industry', 'manufacturing'));
    expect(shownCards()).toEqual(['com.acme.sales']);
    // Sales under the industry selection: one listing; the industry facet
    // counts under the business-function selection.
    expect(facetCount('businessFunction', 'sales')).toBe('1');
    expect(facetCount('industry', 'retail')).toBe('1');

    fireEvent.click(facetButton('solutionType', 'connector'));
    expect(shownCards()).toEqual([]);
    expect(screen.getByText(L.noMatchFilters)).toBeInTheDocument();

    fireEvent.click(facetButton('industry', 'retail'));
    expect(shownCards()).toEqual(['com.acme.billing']);
  });

  it('the solution-type segment selects one value, the default included, and All clears it', async () => {
    await renderPage(TAXONOMY_CATALOG);

    fireEvent.click(facetButton('solutionType', 'template'));
    expect(shownCards()).toEqual(['com.acme.hiring']);

    fireEvent.click(facetButton('solutionType', 'app'));
    expect(facetButton('solutionType', 'template')).toHaveAttribute('aria-pressed', 'false');
    expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.untyped']);

    fireEvent.click(facetButton('solutionType', 'all'));
    expect(shownCards()).toHaveLength(4);
  });

  it('the search box and the facets combine', async () => {
    await renderPage(TAXONOMY_CATALOG);

    fireEvent.change(screen.getByLabelText(L.searchAria), { target: { value: 'connector' } });
    expect(shownCards()).toEqual(['com.acme.billing']);
    // The buttons stay; their counts follow the search.
    expect(facetCount('businessFunction', 'hr')).toBe('0');
    expect(facetCount('businessFunction', 'sales')).toBe('1');

    fireEvent.click(facetButton('businessFunction', 'hr'));
    expect(shownCards()).toEqual([]);
  });
});

describe('Marketplace facets hide with no data (objectstack#31011)', () => {
  it('a catalog serving no taxonomy draws no filter, no function badge and no Beta badge', async () => {
    await renderPage([
      row('plain', 'Plain App', {}),
      row('nulls', 'Null App', { business_functions: null, industries: null, solution_type: null, maturity: null }),
    ]);

    expect(screen.queryByTestId('marketplace-facets')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-function')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-beta')).toBeNull();
    expect(shownCards()).toEqual(['com.acme.plain', 'com.acme.nulls']);
  });

  it('industries and solution type hide while no loaded listing carries one', async () => {
    await renderPage([
      row('a', 'A', { business_functions: ['legal'] }),
      row('b', 'B', { business_functions: ['it'], industries: [] }),
    ]);

    expect(screen.getByRole('group', { name: L.facet.businessFunction })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(screen.queryByRole('group', { name: L.facet.solutionType })).toBeNull();
  });

  it('a value outside the spec vocabulary is drawn nowhere', async () => {
    await renderPage([
      row('legacy', 'Legacy CRM', { business_functions: ['crm'], industries: ['general'], solution_type: 'theme' }),
    ]);

    expect(screen.queryByTestId('marketplace-facets')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-function')).toBeNull();
    expect(screen.queryByText('crm')).toBeNull();
  });

  it('a list column that is not an array reads as no values, and the catalog still renders', async () => {
    await renderPage([
      row('string', 'String Columns', { business_functions: 'sales', industries: 'retail' }),
      row('object', 'Object Columns', { business_functions: { 0: 'hr' }, industries: 7 }),
      row('array', 'Array Columns', { business_functions: ['legal'] }),
    ]);

    expect(shownCards()).toEqual(['com.acme.string', 'com.acme.object', 'com.acme.array']);
    const fn = screen.getByRole('group', { name: L.facet.businessFunction });
    expect(within(fn).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'marketplace-facet-businessFunction-legal',
    ]);
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(within(screen.getByTestId('marketplace-card-com.acme.string')).queryByTestId('marketplace-card-function'))
      .toBeNull();
  });
});

describe('Marketplace card badges (objectstack#31011)', () => {
  it('a card shows its primary business function, the first one listed', async () => {
    await renderPage(TAXONOMY_CATALOG);

    const billing = screen.getByTestId('marketplace-card-com.acme.billing');
    expect(within(billing).getByTestId('marketplace-card-function')).toHaveTextContent(L.businessFunction.finance);
    expect(within(billing).queryByText(L.businessFunction.sales)).toBeNull();
    const sales = screen.getByTestId('marketplace-card-com.acme.sales');
    expect(within(sales).getByTestId('marketplace-card-function')).toHaveTextContent(L.businessFunction.sales);
  });

  it('Beta shows on a beta listing only', async () => {
    await renderPage(TAXONOMY_CATALOG);

    expect(screen.getAllByTestId('marketplace-card-beta')).toHaveLength(1);
    const hiring = screen.getByTestId('marketplace-card-com.acme.hiring');
    expect(within(hiring).getByTestId('marketplace-card-beta')).toHaveTextContent(L.maturity.beta);
    // `stable` and an absent maturity draw none.
    for (const id of ['com.acme.sales', 'com.acme.billing', 'com.acme.untyped']) {
      expect(within(screen.getByTestId(`marketplace-card-${id}`)).queryByTestId('marketplace-card-beta')).toBeNull();
    }
  });
});
