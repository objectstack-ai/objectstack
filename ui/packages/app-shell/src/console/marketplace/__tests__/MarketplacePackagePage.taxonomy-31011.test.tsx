// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package Details page shows the listing's marketplace taxonomy
 * (objectstack#31011): every business function in the listing's order, the
 * industries, the solution type and the Beta badge.
 *
 * ## What the cases pin
 *
 * - Each facet the listing carries is one labelled group of badges, labelled
 *   from the pack.
 * - The solution type is always drawn: an undeclared one reads as the spec's
 *   default, `app`, as the catalog page filters and counts it.
 * - Beta shows for `maturity: 'beta'` only.
 * - A listing with no taxonomy draws only that default type and no Beta; a
 *   value outside the spec's vocabulary is drawn nowhere, never as its raw
 *   spelling; a list column that is not an array reads as no values.
 *
 * `marketplaceApi` is not mocked: one stubbed `fetch` answers by path with the
 * detail body the proxy serves.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en } from '@object-ui/i18n/locales';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = { packageId: 'com.acme.crm' };
  return { useNavigate: () => navigate, useParams: () => params };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const L = en.marketplace;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function renderDetail(taxonomy: Record<string, unknown>) {
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
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: [], total: 0 } });
      }
      if (path === '/api/v1/marketplace/packages/com.acme.crm' && method === 'GET') {
        return answer(200, {
          success: true,
          data: {
            package: {
              id: 'com.acme.crm',
              manifest_id: 'com.acme.crm',
              display_name: 'Acme CRM',
              latest_version: { id: 'ver_crm_1', version: '1.0.0' },
              ...taxonomy,
            },
            versions: [],
          },
        });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MarketplacePackagePage />
    </I18nProvider>,
  );
  await screen.findByRole('heading', { name: 'Acme CRM' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Details — the marketplace taxonomy (objectstack#31011)', () => {
  it('shows every business function in order, the industries, the solution type and Beta', async () => {
    await renderDetail({
      business_functions: ['sales', 'customer_service', 'marketing'],
      industries: ['retail', 'logistics'],
      solution_type: 'template',
      maturity: 'beta',
    });

    const fn = screen.getByRole('group', { name: L.facet.businessFunction });
    expect(within(fn).getAllByText(/./).slice(1).map((el) => el.textContent)).toEqual([
      L.businessFunction.sales,
      L.businessFunction.customer_service,
      L.businessFunction.marketing,
    ]);
    const industry = screen.getByRole('group', { name: L.facet.industry });
    expect(within(industry).getByText(L.industry.retail)).toBeInTheDocument();
    expect(within(industry).getByText(L.industry.logistics)).toBeInTheDocument();
    const type = screen.getByRole('group', { name: L.facet.solutionType });
    expect(within(type).getByText(L.solutionType.template)).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-detail-beta')).toHaveTextContent(L.maturity.beta);
  });

  it('a stable listing with no industries shows no Beta and no industry group', async () => {
    await renderDetail({ business_functions: ['finance'], solution_type: 'app', maturity: 'stable' });

    expect(screen.getByRole('group', { name: L.facet.businessFunction })).toHaveTextContent(L.businessFunction.finance);
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(screen.queryByTestId('marketplace-detail-beta')).toBeNull();
  });

  it('a listing with no taxonomy draws the default solution type and nothing else', async () => {
    await renderDetail({});

    const type = screen.getByRole('group', { name: L.facet.solutionType });
    expect(within(type).getByText(L.solutionType.app)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: L.facet.businessFunction })).toBeNull();
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(screen.queryByTestId('marketplace-detail-beta')).toBeNull();
  });

  it('values outside the spec, and list columns that are not arrays, are drawn nowhere', async () => {
    await renderDetail({ business_functions: ['crm'], industries: 'retail', solution_type: 'theme' });

    expect(within(screen.getByRole('group', { name: L.facet.solutionType })).getByText(L.solutionType.app))
      .toBeInTheDocument();
    expect(screen.queryByRole('group', { name: L.facet.businessFunction })).toBeNull();
    expect(screen.queryByRole('group', { name: L.facet.industry })).toBeNull();
    expect(screen.queryByText('crm')).toBeNull();
    expect(screen.queryByText('theme')).toBeNull();
    expect(screen.queryByText('retail')).toBeNull();
  });
});

/**
 * The package page's languages group (objectstack#31462), in the taxonomy
 * strip: every language the latest version ships, the default first and
 * marked, each with its coverage; "No language information" for a version
 * measured before the control plane measured languages; nothing when the
 * catalog serves neither key.
 */
describe('Details — the languages an app ships (objectstack#31462)', () => {
  const version = (extra: Record<string, unknown>) => ({ latest_version: { id: 'ver_crm_1', version: '1.0.0', ...extra } });

  it('lists every language, the default first and marked, each with its coverage', async () => {
    await renderDetail(version({
      supported_locales: ['zh-CN', 'en', 'ja-JP', 'de', 'th'],
      locale_coverage: {
        default_locale: 'zh-CN',
        expected_keys: 120,
        locales: [
          { locale: 'zh-CN', translated: 120, coverage_percent: 100 },
          { locale: 'en', translated: 114, coverage_percent: 95 },
          { locale: 'ja-JP', translated: 72, coverage_percent: 60 },
          { locale: 'de', translated: 30, coverage_percent: 25 },
          { locale: 'th', translated: 3, coverage_percent: 2.5 },
        ],
      },
    }));

    const group = screen.getByRole('group', { name: L.facet.languages });
    expect(group).toHaveAttribute('data-state', 'listed');
    expect(within(group).getAllByTestId(/^marketplace-detail-language-/).map((b) => b.textContent)).toEqual([
      `简体中文 100%${L.languages.default}`,
      'English 95%',
      '日本語 60%',
      'Deutsch 25%',
      'ไทย 2.5%',
    ]);
    // The served code stays on the badge, so a reader can see what was declared.
    expect(screen.getByTestId('marketplace-detail-language-zh-CN')).toHaveAttribute('title', 'zh-CN');
  });

  it('a version published before the measurement reads "No language information", never "English only"', async () => {
    await renderDetail(version({ supported_locales: null, locale_coverage: null }));

    const group = screen.getByRole('group', { name: L.facet.languages });
    expect(group).toHaveAttribute('data-state', 'unknown');
    expect(group).toHaveTextContent(L.languages.none);
    expect(group).not.toHaveTextContent('English');
  });

  it('CONTROL: a catalog that serves neither key draws no languages group', async () => {
    await renderDetail({});

    expect(screen.queryByRole('group', { name: L.facet.languages })).toBeNull();
    expect(screen.queryByText(L.languages.none)).toBeNull();
  });
});
