// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10900 — the marketplace search box's zh placeholder says what it
 * searches in plain Chinese, and says nothing the search does not do.
 *
 * The 2026-09-28 cloud E2E, browser in zh-CN, read 「按名称或 manifest ID 搜索应用…」:
 * `manifest ID` is jargon to a customer, and English inside the Chinese line.
 * The zh pack now reads 「按名称或标识搜索应用…」 — 标识 being the identifier each
 * card prints under its name (the `manifest_id` code), which is the vocabulary
 * the zh pack already uses for identifiers. `en` and the eight other packs
 * dropped the same jargon in objectui#10969: `en` now names the "app ID".
 *
 * The placeholder is only honest if the search matches what it names. The
 * catalog list door does the matching (objectstack#31267): its `q` matches the
 * display name and the manifest id, `catalogRowMatches` in
 * `@objectstack/cloud-connection`'s marketplace proxy. So this suite measures
 * the console's half: the box's text reaches the list read as `q`, trimmed,
 * from the first page, and the cards drawn are the door's answer.
 *
 * Harness: `MarketplacePage.guardOrder.test.tsx`'s — the real runtime-config
 * boot, an admin viewer, the API module stubbed — with the REAL
 * `useObjectTranslation` under a real `I18nProvider`, since the pack value is
 * the subject here.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const PKG = {
  id: 'pkg_1',
  manifest_id: 'com.acme.helpdesk',
  display_name: 'Service Desk',
  description: 'Tickets and SLAs',
  category: null,
  latest_version: null,
};

/** The door's answer to a read: the package, unless the text names neither its name nor its id. */
const listMarketplacePackages = vi.fn(async (params: { q?: string } = {}) => ({
  items: params.q === 'no-such-package' ? [] : [PKG],
}));

vi.mock('../marketplaceApi', () => ({
  listMarketplacePackages: (params: { q?: string }) => listMarketplacePackages(params),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ items: [] }),
  listInstalledPackages: async () => ({ items: [] }),
  installPackage: async () => ({}),
  installLocal: async () => ({}),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));

import { I18nProvider } from '@object-ui/i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

beforeEach(async () => {
  listMarketplacePackages.mockClear();
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: 'https://cloud.objectos.ai',
        singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

function renderIn(config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
}

describe('MarketplacePage search placeholder (objectui#10900)', () => {
  it('zh: plain Chinese, no manifest jargon', async () => {
    renderIn(ZH);
    const search = await screen.findByLabelText('搜索市场应用');
    expect(search).toHaveAttribute('placeholder', '按名称或标识搜索应用…');
    expect(search.getAttribute('placeholder')).not.toMatch(/manifest/i);
  });

  it('en: plain English, no manifest jargon (objectui#10969)', async () => {
    renderIn(EN);
    const search = await screen.findByLabelText('Search marketplace apps');
    expect(search).toHaveAttribute('placeholder', 'Search apps by name or app ID…');
    expect(search.getAttribute('placeholder')).not.toMatch(/manifest/i);
  });

  it('the search sends the text the placeholder asks for to the list door, which matches it', async () => {
    renderIn(ZH);
    await screen.findByTestId(`marketplace-card-${PKG.manifest_id}`);
    const search = screen.getByLabelText('搜索市场应用');
    const lastRead = () => listMarketplacePackages.mock.calls.at(-1)![0];

    // The name, then the identifier: each reaches the read as `q`, trimmed.
    fireEvent.change(search, { target: { value: 'service desk' } });
    await waitFor(() => expect(lastRead()).toMatchObject({ q: 'service desk', offset: 0 }));
    expect(screen.getByTestId(`marketplace-card-${PKG.manifest_id}`)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: ' com.acme ' } });
    await waitFor(() => expect(lastRead()).toMatchObject({ q: 'com.acme', offset: 0 }));
    expect(screen.getByTestId(`marketplace-card-${PKG.manifest_id}`)).toBeInTheDocument();

    // Text that names neither: the door answers nothing, and nothing is drawn.
    fireEvent.change(search, { target: { value: 'no-such-package' } });
    await waitFor(() => expect(screen.queryByTestId(`marketplace-card-${PKG.manifest_id}`)).toBeNull());
  });
});
