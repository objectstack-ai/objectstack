// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30588 — the marketplace pages' strings are a lazy namespace, and
 * a visitor reading the console in another language never sees them in
 * English or as raw keys while it loads.
 *
 * `marketplace.*` (bar the families Studio's packages page reads) left the ten
 * language packs for `@object-ui/i18n/namespaces/marketplace`, fetched when a
 * marketplace page mounts. Both pages wrap their bodies in
 * `MarketplaceNamespaceGate`, which renders the copy-free load skeleton
 * (`marketplace-resolving`) until the namespace is in, then the page — in the
 * console's language from the first frame that has text. A catalogue that
 * cannot be fetched is said in the console's own resident error words, with
 * Try again.
 *
 * Every text node the page ever adds is recorded (a MutationObserver over the
 * render container, attached before the first render), so "never English,
 * never a raw key" is checked over the whole sequence, not only its end.
 *
 * ## The registry is put back in its production state
 *
 * The DOM setup calls `registerBuiltInLocales()`, which registers every
 * language COMPLETE — the namespace included — so the page would never need a
 * fetch. That is the all-ten door's promise, not what a console visitor gets.
 * This file re-registers each language as its pack alone, at module scope —
 * the registry a console that awaited `preloadBootstrapLocale()` holds. The
 * `dom` project isolates each file's module graph, so this stays here.
 *
 * Harness: `MarketplacePage.searchPlaceholder-10900.test.tsx`'s and
 * `MarketplacePackagePage.guardOrder.test.tsx`'s — the real runtime-config
 * boot, an admin viewer, the API module stubbed — under a real `I18nProvider`.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const arChunk = vi.hoisted(() => ({ fails: false, requests: 0 }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.helpdesk' }),
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

vi.mock('../marketplaceApi', () => ({
  listMarketplacePackages: async () => ({ items: [PKG] }),
  getMarketplacePackage: async () => ({ package: PKG, versions: [] }),
  getCloudInstallationInfo: async () => null,
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ items: [] }),
  listInstalledPackages: async () => ({ items: [] }),
  installPackage: async () => ({}),
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => [],
  cloudConsoleUrl: () => '',
  reseedSampleData: async () => ({ ok: true }),
  purgeSampleData: async () => ({ ok: true }),
  reseedLocalSampleData: async () => ({ ok: true }),
  purgeLocalSampleData: async () => ({ ok: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

// The Arabic catalogue's chunk, failing while a case says so.
vi.mock('@object-ui/i18n/namespaces/marketplace/ar', async (importOriginal) => {
  arChunk.requests += 1;
  if (arChunk.fails) throw new Error('chunk offline');
  return importOriginal();
});

import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { BUILT_IN_LANGUAGE_CODES, registerBuiltInLocale } from '@object-ui/i18n/locales/registry';
import en from '@object-ui/i18n/locales/en';
import zh from '@object-ui/i18n/locales/zh';
import ja from '@object-ui/i18n/locales/ja';
import ko from '@object-ui/i18n/locales/ko';
import de from '@object-ui/i18n/locales/de';
import fr from '@object-ui/i18n/locales/fr';
import es from '@object-ui/i18n/locales/es';
import pt from '@object-ui/i18n/locales/pt';
import ru from '@object-ui/i18n/locales/ru';
import ar from '@object-ui/i18n/locales/ar';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const PACKS: Record<string, Record<string, unknown>> = { en, zh, ja, ko, de, fr, es, pt, ru, ar };
for (const code of BUILT_IN_LANGUAGE_CODES) registerBuiltInLocale(code, PACKS[code]);

const ENGLISH = builtInLocales.en.marketplace;
const RAW_KEY = /\bmarketplace\.[A-Za-z]/;

beforeEach(async () => {
  arChunk.fails = false;
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

/** Render `page` in `language`, recording the text of every node it ever adds. */
function renderRecording(page: ReactElement, language: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const texts: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') texts.push(record.target.textContent ?? '');
      for (const node of Array.from(record.addedNodes)) texts.push(node.textContent ?? '');
    }
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  const result = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {page}
    </I18nProvider>,
    { container },
  );
  // The first commit is synchronous; record it whatever the observer batched.
  texts.push(container.textContent ?? '');
  return {
    ...result,
    /** Everything the page has shown so far, once the observer has delivered. */
    async shown(): Promise<string[]> {
      await act(async () => {
        await Promise.resolve();
      });
      for (const record of observer.takeRecords()) {
        for (const node of Array.from(record.addedNodes)) texts.push(node.textContent ?? '');
      }
      return texts;
    },
  };
}

describe('the marketplace pages wait for their strings (objectstack#30588)', () => {
  it('zh-CN: the catalogue page shows the load skeleton, then Chinese, and never English or a raw key', async () => {
    const zhMarketplace = builtInLocales.zh.marketplace;
    const view = renderRecording(<MarketplacePage />, 'zh-CN');
    expect(screen.getByTestId('marketplace-resolving')).toBeInTheDocument();

    expect(await screen.findByText(zhMarketplace.title)).toBeInTheDocument();
    expect(screen.getByText(zhMarketplace.subtitle)).toBeInTheDocument();

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.title);
    expect(shown).not.toContain(ENGLISH.subtitle);
    expect(shown).not.toMatch(RAW_KEY);
  });

  it('de: the package page shows the load skeleton, then German, and never English or a raw key', async () => {
    const deMarketplace = builtInLocales.de.marketplace;
    const view = renderRecording(<MarketplacePackagePage />, 'de');
    expect(screen.getByTestId('marketplace-resolving')).toBeInTheDocument();

    expect((await screen.findAllByText(deMarketplace.back)).length).toBeGreaterThan(0);

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.back);
    expect(shown).not.toMatch(RAW_KEY);
  });

  it('ar: a catalogue that cannot be fetched is said in resident words, and Try again fetches it', async () => {
    arChunk.fails = true;
    const view = renderRecording(<MarketplacePage />, 'ar');

    const failed = await screen.findByTestId('marketplace-namespace-failed');
    expect(failed).toHaveTextContent(ar.console.errors.somethingWentWrong);
    expect(arChunk.requests).toBe(1);

    arChunk.fails = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ar.console.errors.tryAgain }));
    });
    expect(await screen.findByText(builtInLocales.ar.marketplace.title)).toBeInTheDocument();
    expect(arChunk.requests).toBe(2);

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.title);
    expect(shown).not.toMatch(RAW_KEY);
  });
});
