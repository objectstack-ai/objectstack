// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under `cloudUrl: ''` the marketplace load-error hint says only that the
 * catalog is reached through this runtime. It never says the runtime serves the
 * catalog itself, and it names no host (objectui#11726).
 *
 * ## The defect
 *
 * The CLI's cloud-connected `os serve` mounts its runtime config with
 * `controlPlaneUrl: ''` while its marketplace proxy forwards to the default
 * control plane. A catalog load that failed there for a reachability reason (a
 * 502 / 503 / 504 from the proxy, or no answer at all) drew "This runtime
 * serves the marketplace catalog itself.", which is false on that runtime.
 * `''` is the producer's "stay on this origin" spelling: it says where requests
 * go, not who serves them.
 *
 * ## No host is named, and why
 *
 * The card allowed naming the upstream host where a failure carries it in a
 * structured place. None does. The proxy's own failure is a 502 with the
 * `MARKETPLACE_PROXY_FAILED` envelope, whose message is `fetch failed` and
 * which has no host field. An upstream 5xx is forwarded with the upstream's own
 * body, and the only header the proxy adds is `X-Cache`. Reading a host out of
 * the message would treat server prose as data, so the hint names none. The
 * stubbed transport below answers in those shapes.
 *
 * ## Why the REAL packs and the REAL `call()`
 *
 * The subject is the sentence a reader gets, so the hint is read through the
 * real `I18nProvider` in `en` and `zh`. The sibling suites' `«key»` echo proves
 * which key is chosen, not what it says. The catalog request goes through the
 * genuine `listMarketplacePackages` over a stubbed `fetch` that answers real
 * `Response` objects, as `MarketplacePage.loadFailureCause-11688.test.tsx`
 * does, so whether the hint shows at all is decided by the read a browser makes.
 *
 * The same-origin assertions are about the CLAIM, not the whole sentence: the
 * hint routes the catalog through this runtime, and says nothing about the
 * runtime serving it and nothing about a host. The configured plane's hint is
 * pinned verbatim, because "unchanged" is the claim there.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../marketplaceApi', async (importOriginal) => ({
  // `listMarketplacePackages` stays REAL: whether the hint shows is its read.
  ...(await importOriginal<Record<string, unknown>>()),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ connected: false, items: [] }),
  listInstalledPackages: async () => ({ connected: false, items: [] }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** The catalog request's answer, set per case. */
let catalog: () => Promise<Response>;

/** Boot the SPA against a runtime whose config reports `cloudUrl`, marketplace mounted. */
async function bootOn(cloudUrl: string) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/api/v1/marketplace/packages')
        ? catalog()
        : json({
            cloudUrl,
            singleEnvironment: true,
            features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
            branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
          }),
    ),
  );
  await initRuntimeConfig();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

const LANGS = {
  en: { defaultLanguage: 'en', detectBrowserLanguage: false },
  zh: { defaultLanguage: 'zh', detectBrowserLanguage: false },
} as const;
type Lang = keyof typeof LANGS;

function renderIn(lang: Lang) {
  return render(
    <I18nProvider config={LANGS[lang]} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
}

const packValue = (lang: Lang, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], (builtInLocales as Record<string, unknown>)[lang]);

/**
 * What the same-origin hint must and must not say, per language. `routes` is
 * the one thing `''` means; `servesItself` is the claim objectui#11726 removed.
 */
const CLAIMS: Record<Lang, { routes: RegExp; servesItself: RegExp }> = {
  en: { routes: /through this runtime/i, servesItself: /\bserves?\b|\bitself\b/i },
  zh: { routes: /通过本运行时/, servesItself: /自己提供|自身提供|本身提供/ },
};

/** Any host or URL, or an unfilled `{{url}}` hole. */
const NAMES_A_HOST = /https?:\/\/|objectos\.ai|acme|\{\{\s*url\s*\}\}/i;

/** The failures whose cause IS reachability, in the shapes the proxy returns. */
const REACHABILITY_FAILURES: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
  [
    "the proxy could not reach its upstream (502, the proxy's own envelope)",
    async () => json({ success: false, error: { code: 'MARKETPLACE_PROXY_FAILED', message: 'fetch failed' } }, 502, 'Bad Gateway'),
  ],
  [
    'the upstream answered 503, forwarded verbatim',
    async () => json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' } }, 503, 'Service Unavailable'),
  ],
  [
    'the upstream answered 504 with an empty body',
    async () => new Response('', { status: 504, statusText: 'Gateway Timeout', headers: { 'content-type': 'text/plain;charset=UTF-8' } }),
  ],
  [
    'no server answered at all',
    async () => {
      throw new TypeError('Failed to fetch');
    },
  ],
];

describe.each(Object.keys(LANGS) as Lang[])(
  '%s: under `cloudUrl: ""` the hint routes the catalog through this runtime and claims nothing more (objectui#11726)',
  (lang) => {
    it.each(REACHABILITY_FAILURES)('%s', async (_label, failure) => {
      await bootOn('');
      catalog = failure;

      renderIn(lang);

      const text = (await screen.findByTestId('marketplace-load-hint')).textContent ?? '';
      // The sentence drawn is this pack's same-origin hint, not a fallback.
      expect(text).toBe(packValue(lang, 'marketplace.load.failedHintSameOrigin'));
      expect(text).toMatch(CLAIMS[lang].routes);
      expect(text).not.toMatch(CLAIMS[lang].servesItself);
      expect(text).not.toMatch(NAMES_A_HOST);
    });

    it('a host named in the server prose stays in the cause line and never reaches the hint', async () => {
      await bootOn('');
      catalog = async () =>
        json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'cloud.objectos.ai is not serving' } }, 503, 'Service Unavailable');

      renderIn(lang);

      expect(await screen.findByTestId('marketplace-load-cause')).toHaveTextContent('cloud.objectos.ai is not serving');
      const text = screen.getByTestId('marketplace-load-hint').textContent ?? '';
      expect(text).toBe(packValue(lang, 'marketplace.load.failedHintSameOrigin'));
      expect(text).not.toMatch(NAMES_A_HOST);
    });
  },
);

describe('a configured plane keeps its hint, naming that plane (objectui#11726)', () => {
  beforeEach(() => {
    catalog = async () =>
      json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' } }, 503, 'Service Unavailable');
  });

  it('en', async () => {
    await bootOn('https://cloud.acme.internal');
    renderIn('en');
    expect(await screen.findByTestId('marketplace-load-hint')).toHaveTextContent(
      'This runtime reaches the marketplace through the control plane at https://cloud.acme.internal. Check that it is online and reachable from here.',
    );
  });

  it('zh', async () => {
    await bootOn('https://cloud.acme.internal');
    renderIn('zh');
    expect(await screen.findByTestId('marketplace-load-hint')).toHaveTextContent(
      '本运行时通过 https://cloud.acme.internal 上的控制面访问应用市场。请检查该地址是否在线、能否从本运行时访问。',
    );
  });
});
