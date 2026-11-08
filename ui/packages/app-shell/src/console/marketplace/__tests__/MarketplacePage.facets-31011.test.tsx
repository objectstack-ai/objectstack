// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog's facet filters and card badges read the marketplace taxonomy
 * of `@objectstack/spec/marketplace` (objectstack#31011), and the catalog list
 * door filters and pages by it (objectstack#31267).
 *
 * ## What the cases pin
 *
 * - The page filters nothing itself. The search text, the selection and the
 *   page window travel with the list read, spelled as the door reads them:
 *   `businessFunctions`, `industries` and `solutionTypes`, each ONE
 *   comma-joined parameter in the spec's order, a facet with nothing selected
 *   left out (never sent empty), `limit` / `offset`, and never `category`. The
 *   cards drawn are the server's answer, whatever they carry.
 * - Business function and industry are toggle rows (several values, one
 *   parameter); solution type is a segment with All, which drops the
 *   parameter. A new search or selection reads from the first page.
 * - The pager walks the server's `total` by `offset`.
 * - A drawn facet offers every spec value, in the spec's order. A facet no
 *   answered listing carries is not drawn: with no taxonomy on the wire there
 *   is no filter at all. Once drawn, a facet stays drawn while a selection
 *   narrows the page to listings without it.
 * - The card shows the primary business function (the first listed) and a
 *   Beta badge for `maturity: 'beta'` only. A value outside the spec's
 *   vocabulary is drawn nowhere; a list column that is not an array reads as
 *   no values and the catalog still renders.
 *
 * Every click and keystroke goes through the rendered page. `fetch` is
 * stubbed by path; the catalog stub records each list read's query and answers
 * from `catalogAnswer`. The labels are the `en` pack's.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en } from '@object-ui/i18n/locales';
import {
  MarketplaceBusinessFunctionSchema,
  MarketplaceIndustrySchema,
  MarketplaceSolutionTypeSchema,
} from '@objectstack/spec/marketplace';

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
import { CATALOG_PAGE_SIZE, MarketplacePage } from '../MarketplacePage';

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

/** Each catalog list read's query, in order. */
let catalogQueries: URLSearchParams[] = [];
/** The rows and total the stubbed list door answers a read with. */
let catalogAnswer: (query: URLSearchParams) => { items: unknown[]; total?: number } = () => ({ items: [] });

async function boot(answerWith: typeof catalogAnswer) {
  resetRuntimeConfigForTesting();
  catalogQueries = [];
  catalogAnswer = answerWith;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = new URL(String(input), 'http://console.test');
      const path = url.pathname;
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
        catalogQueries.push(url.searchParams);
        const { items, total } = catalogAnswer(url.searchParams);
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('offset'));
        return answer(200, { success: true, data: { items, total: total ?? items.length, limit, offset } });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: [], total: 0 } });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
}

/** Render the page; it has answered once `ready` is on screen. */
async function renderPage(answerWith: typeof catalogAnswer, ready?: string) {
  await boot(answerWith);
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
  const first = answerWith(new URLSearchParams()).items[0] as { manifest_id: string } | undefined;
  await screen.findByTestId(ready ?? `marketplace-card-${first!.manifest_id}`);
}

/** The whole catalog, every read: the console's filtering is not exercised. */
const always = (items: unknown[]) => () => ({ items });

/** The newest list read's query, as `key=value` pairs in the order sent. */
const lastQuery = () => [...catalogQueries[catalogQueries.length - 1]!.entries()].map(([k, v]) => `${k}=${v}`);

/** Wait for a list read whose query is exactly `pairs`, then for its answer to be drawn. */
async function expectRead(pairs: string[]) {
  await waitFor(() => expect(lastQuery()).toEqual(pairs));
}

/** The manifest ids of the cards drawn, in order. */
const shownCards = () =>
  screen.queryAllByTestId(/^marketplace-card-com\./).map((el) => el.getAttribute('data-testid')!.replace('marketplace-card-', ''));

const facetButton = (facet: string, value: string) => screen.getByTestId(`marketplace-facet-${facet}-${value}`);
const facetValues = (name: string) =>
  within(screen.getByRole('group', { name })).getAllByRole('button').map((b) => b.getAttribute('data-testid'));

const WINDOW = [`limit=${CATALOG_PAGE_SIZE}`, 'offset=0'];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Marketplace facet filters read through the list door (objectstack#31011, objectstack#31267)', () => {
  it('the first read sends the page window and no filter; every spec value is offered, without a count', async () => {
    await renderPage(always(TAXONOMY_CATALOG));

    expect(catalogQueries).toHaveLength(1);
    expect(lastQuery()).toEqual(WINDOW);

    expect(facetValues(L.facet.businessFunction)).toEqual(
      MarketplaceBusinessFunctionSchema.options.map((v) => `marketplace-facet-businessFunction-${v}`),
    );
    expect(facetValues(L.facet.industry)).toEqual(
      MarketplaceIndustrySchema.options.map((v) => `marketplace-facet-industry-${v}`),
    );
    expect(facetValues(L.facet.solutionType)).toEqual([
      'marketplace-facet-solutionType-all',
      ...MarketplaceSolutionTypeSchema.options.map((v) => `marketplace-facet-solutionType-${v}`),
    ]);
    expect(facetButton('businessFunction', 'sales')).toHaveTextContent(L.businessFunction.sales);
    expect(facetButton('industry', 'manufacturing')).toHaveTextContent(L.industry.manufacturing);
    // No count: a page of the filtered catalog cannot count the catalog.
    expect(facetButton('businessFunction', 'sales')).toHaveTextContent(new RegExp(`^${L.businessFunction.sales}$`));
    expect(screen.queryByTestId('marketplace-facet-businessFunction-sales-count')).toBeNull();
    expect(within(screen.getByRole('group', { name: L.facet.solutionType })).getByRole('button', { name: L.all }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('a toggle row sends its values as one comma-joined parameter, in the spec order, and drops it when cleared', async () => {
    await renderPage(always(TAXONOMY_CATALOG));

    fireEvent.click(facetButton('businessFunction', 'hr'));
    expect(facetButton('businessFunction', 'hr')).toHaveAttribute('aria-pressed', 'true');
    await expectRead(['businessFunctions=hr', ...WINDOW]);

    fireEvent.click(facetButton('businessFunction', 'sales'));
    await expectRead(['businessFunctions=sales,hr', ...WINDOW]);

    // A second click clears a value; the last one cleared drops the parameter.
    fireEvent.click(facetButton('businessFunction', 'hr'));
    await expectRead(['businessFunctions=sales', ...WINDOW]);
    fireEvent.click(facetButton('businessFunction', 'sales'));
    await expectRead(WINDOW);

    for (const query of catalogQueries) {
      expect(query.getAll('businessFunctions').length).toBeLessThanOrEqual(1);
      expect(query.has('category')).toBe(false);
      for (const [, value] of query) expect(value).not.toBe('');
    }
  });

  it('the facets travel together, and the segment sends one solution type until All drops it', async () => {
    await renderPage(always(TAXONOMY_CATALOG));

    fireEvent.click(facetButton('businessFunction', 'sales'));
    fireEvent.click(facetButton('industry', 'retail'));
    fireEvent.click(facetButton('industry', 'manufacturing'));
    fireEvent.click(facetButton('solutionType', 'connector'));
    await expectRead([
      'businessFunctions=sales',
      'industries=manufacturing,retail',
      'solutionTypes=connector',
      ...WINDOW,
    ]);

    fireEvent.click(facetButton('solutionType', 'template'));
    expect(facetButton('solutionType', 'connector')).toHaveAttribute('aria-pressed', 'false');
    await expectRead(['businessFunctions=sales', 'industries=manufacturing,retail', 'solutionTypes=template', ...WINDOW]);

    fireEvent.click(facetButton('solutionType', 'all'));
    await expectRead(['businessFunctions=sales', 'industries=manufacturing,retail', ...WINDOW]);
  });

  it('draws the cards the server answered, and filters none of them out', async () => {
    // The stub answers a `hr` read with listings that carry no `hr` at all: the
    // console draws them, because filtering is the server's.
    await renderPage((query) => ({ items: query.has('businessFunctions') ? [SALES, BILLING] : TAXONOMY_CATALOG }));

    expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.hiring', 'com.acme.billing', 'com.acme.untyped']);
    fireEvent.click(facetButton('businessFunction', 'hr'));
    await waitFor(() => expect(shownCards()).toEqual(['com.acme.sales', 'com.acme.billing']));
  });

  it('the search box reads once typing pauses, with the selection, from the first page', async () => {
    await renderPage((query) => ({ items: TAXONOMY_CATALOG, total: query.has('q') ? 4 : 60 }));

    fireEvent.click(screen.getByTestId('marketplace-pager-next'));
    await expectRead([`limit=${CATALOG_PAGE_SIZE}`, `offset=${CATALOG_PAGE_SIZE}`]);
    fireEvent.click(facetButton('industry', 'retail'));
    await expectRead(['industries=retail', ...WINDOW]);
    const reads = catalogQueries.length;

    fireEvent.change(screen.getByLabelText(L.searchAria), { target: { value: '  Billing' } });
    await expectRead(['q=Billing', 'industries=retail', ...WINDOW]);
    // The keystrokes made one read, after the pause.
    expect(catalogQueries).toHaveLength(reads + 1);
  });

  it('an empty answer says nothing matches under a filter, and that nothing is listed without one', async () => {
    await renderPage((query) => ({ items: query.has('industries') ? [] : TAXONOMY_CATALOG }));

    fireEvent.click(facetButton('industry', 'healthcare'));
    await waitFor(() => expect(screen.getByTestId('marketplace-empty')).toHaveTextContent(L.noMatchFilters));
    cleanup();

    await renderPage(() => ({ items: [] }), 'marketplace-empty');
    expect(screen.getByTestId('marketplace-empty')).toHaveTextContent(L.noApprovedYet);
  });
});

describe('Marketplace catalog pager (objectstack#31267)', () => {
  const PAGE = (n: number) => Array.from({ length: n }, (_, i) => row(`p${i}`, `Package ${i}`, {}));

  it('walks the server total by offset, and a new selection reads from the first page', async () => {
    await renderPage(() => ({ items: [SALES, ...PAGE(CATALOG_PAGE_SIZE - 1)], total: 2 * CATALOG_PAGE_SIZE + 5 }));
    const info = () => screen.getByTestId('marketplace-pager-info');
    const previous = () => screen.getByTestId('marketplace-pager-previous');
    const next = () => screen.getByTestId('marketplace-pager-next');

    expect(info()).toHaveTextContent(en.table.pageInfo.replace('{{current}}', '1').replace('{{total}}', '3'));
    expect(previous()).toHaveTextContent(en.common.previous);
    expect(previous()).toBeDisabled();

    fireEvent.click(next());
    await expectRead([`limit=${CATALOG_PAGE_SIZE}`, `offset=${CATALOG_PAGE_SIZE}`]);
    // The pager waits for the page it asked for before it turns again.
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await expectRead([`limit=${CATALOG_PAGE_SIZE}`, `offset=${2 * CATALOG_PAGE_SIZE}`]);
    await waitFor(() => expect(info()).toHaveTextContent(en.table.pageInfo.replace('{{current}}', '3').replace('{{total}}', '3')));
    await waitFor(() => expect(previous()).toBeEnabled());
    expect(next()).toBeDisabled();

    fireEvent.click(previous());
    await expectRead([`limit=${CATALOG_PAGE_SIZE}`, `offset=${CATALOG_PAGE_SIZE}`]);

    fireEvent.click(facetButton('businessFunction', 'marketing'));
    await expectRead(['businessFunctions=marketing', ...WINDOW]);
  });

  it('draws no pager while the answer fits one page', async () => {
    await renderPage(always(TAXONOMY_CATALOG));
    expect(screen.queryByTestId('marketplace-pager')).toBeNull();
  });
});

describe('Marketplace facets hide with no data (objectstack#31011)', () => {
  it('a catalog serving no taxonomy draws no filter, no function badge and no Beta badge', async () => {
    await renderPage(always([
      row('plain', 'Plain App', {}),
      row('nulls', 'Null App', { business_functions: null, industries: null, solution_type: null, maturity: null }),
    ]));

    expect(screen.queryByTestId('marketplace-facets')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-function')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-beta')).toBeNull();
    expect(shownCards()).toEqual(['com.acme.plain', 'com.acme.nulls']);
  });

  it('industries and solution type hide while no answered listing carries one', async () => {
    await renderPage(always([
      row('a', 'A', { business_functions: ['legal'] }),
      row('b', 'B', { business_functions: ['it'], industries: [] }),
    ]));

    expect(screen.getByRole('group', { name: L.facet.businessFunction })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(screen.queryByRole('group', { name: L.facet.solutionType })).toBeNull();
  });

  it('a drawn facet stays drawn when a selection narrows the page to listings without it', async () => {
    const BARE = row('bare', 'Bare Retail', { industries: ['retail'] });
    await renderPage((query) => ({ items: query.has('industries') ? [BARE] : TAXONOMY_CATALOG }));

    fireEvent.click(facetButton('industry', 'retail'));
    await waitFor(() => expect(shownCards()).toEqual(['com.acme.bare']));
    expect(screen.getByRole('group', { name: L.facet.businessFunction })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: L.facet.solutionType })).toBeInTheDocument();
  });

  it('a value outside the spec vocabulary is drawn nowhere', async () => {
    await renderPage(always([
      row('legacy', 'Legacy CRM', { business_functions: ['crm'], industries: ['general'], solution_type: 'theme' }),
    ]));

    expect(screen.queryByTestId('marketplace-facets')).toBeNull();
    expect(screen.queryByTestId('marketplace-card-function')).toBeNull();
    expect(screen.queryByText('crm')).toBeNull();
  });

  it('a list column that is not an array reads as no values, and the catalog still renders', async () => {
    await renderPage(always([
      row('string', 'String Columns', { business_functions: 'sales', industries: 'retail' }),
      row('object', 'Object Columns', { business_functions: { 0: 'hr' }, industries: 7 }),
      row('array', 'Array Columns', { business_functions: ['legal'] }),
    ]));

    expect(shownCards()).toEqual(['com.acme.string', 'com.acme.object', 'com.acme.array']);
    expect(screen.getByRole('group', { name: L.facet.businessFunction })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(within(screen.getByTestId('marketplace-card-com.acme.string')).queryByTestId('marketplace-card-function'))
      .toBeNull();
  });
});

describe('Marketplace card badges (objectstack#31011)', () => {
  it('a card shows its primary business function, the first one listed', async () => {
    await renderPage(always(TAXONOMY_CATALOG));

    const billing = screen.getByTestId('marketplace-card-com.acme.billing');
    expect(within(billing).getByTestId('marketplace-card-function')).toHaveTextContent(L.businessFunction.finance);
    expect(within(billing).queryByText(L.businessFunction.sales)).toBeNull();
    const sales = screen.getByTestId('marketplace-card-com.acme.sales');
    expect(within(sales).getByTestId('marketplace-card-function')).toHaveTextContent(L.businessFunction.sales);
  });

  it('Beta shows on a beta listing only', async () => {
    await renderPage(always(TAXONOMY_CATALOG));

    expect(screen.getAllByTestId('marketplace-card-beta')).toHaveLength(1);
    const hiring = screen.getByTestId('marketplace-card-com.acme.hiring');
    expect(within(hiring).getByTestId('marketplace-card-beta')).toHaveTextContent(L.maturity.beta);
    // `stable` and an absent maturity draw none.
    for (const id of ['com.acme.sales', 'com.acme.billing', 'com.acme.untyped']) {
      expect(within(screen.getByTestId(`marketplace-card-${id}`)).queryByTestId('marketplace-card-beta')).toBeNull();
    }
  });
});
