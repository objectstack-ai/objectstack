// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package Details page reads a local install the runtime refused to load
 * as NOT LOADED: in its header, and in its own Uninstall (objectui#11760).
 *
 * ## The defect
 *
 * Since objectstack#21822 (PR objectstack#21833, `@objectstack/*` 17.7.0) the
 * install-local listing marks an entry this runtime's startup rehydrate refused
 * with `notLoaded: { code, requiredRange }` IN PLACE of `withSampleData`.
 * objectui#11645 taught Installed Apps to read it. The Details page still drew
 * the green "Installed · vX" badge for such an entry, and its Uninstall still
 * confirmed and reported that the app "remains loaded … until the next
 * restart" — the opposite of what the runtime holds.
 *
 * ## What the cases pin
 *
 * - A `notLoaded` entry's header carries the installed version, the
 *   "Not loaded" badge and the reason, never the "Installed · vX" badge.
 * - Its Uninstall confirms and reports with the not-loaded texts.
 * - Controls: a loaded entry keeps the "Installed · vX" badge, no reason line,
 *   and the loaded package's confirm and `successInDetail` result.
 *
 * Both shapes that draw the local header are driven: the catalog view
 * (marketplace on) and the local view an offline boot draws (objectui#11627).
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path with the
 * listing body the server serves, over a stateful ledger. Expected text is the
 * PACK's value for its key, read from the pack and interpolated here, through
 * the real `I18nProvider`, in `en` and `zh`: the claim is which key renders.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = { packageId: 'com.example.crm' };
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

type Pack = typeof en;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** `{{name}}` interpolation, as i18next applies it to these keys (the console sets `escapeValue: false`). */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? `{{${k}}}`);

/** The refused entry as objectstack PR #21833's wire shape gives it: no `withSampleData` key, the marker in its place. */
const REFUSED = {
  packageId: 'com.example.crm',
  versionId: 'ver_crm_3',
  manifestId: 'com.example.crm',
  version: '3.2.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: '^16' },
  installedBy: 'admin@objectos.ai',
};

/** The same package, loaded: the listing as it was before #21833 (`withSampleData`, no `notLoaded` key). */
const { notLoaded: _marker, ...LOADED_BASE } = REFUSED;
const LOADED = { ...LOADED_BASE, withSampleData: true };

/** The catalog's row: its latest version (4.0.0) differs from the installed one (3.2.0), so each version badge is told apart. */
const CATALOG_PACKAGE = {
  package: {
    id: 'com.example.crm',
    manifest_id: 'com.example.crm',
    display_name: 'Example CRM',
    latest_version: { id: 'ver_crm_4', version: '4.0.0' },
  },
  versions: [],
};

interface WireCall { path: string; method: string }
let calls: WireCall[] = [];
let ledger: Array<Record<string, unknown>> = [];
let confirmed: string[] = [];

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Boot the SPA against a runtime whose install-local ledger holds `entry`; `marketplace` picks the catalog view or the offline local view. */
async function boot(marketplace: boolean, entry: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  ledger = [{ ...entry }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: ledger, total: ledger.length } });
      }
      const del = /^\/api\/v1\/marketplace\/install-local\/([^/]+)$/.exec(path);
      if (del && method === 'DELETE') {
        const manifestId = decodeURIComponent(del[1]);
        ledger = ledger.filter((e) => e.manifestId !== manifestId);
        return answer(200, { success: true, data: { manifestId, cleanups: [] } });
      }
      if (path === '/api/v1/marketplace/packages/com.example.crm' && method === 'GET') {
        return answer(200, { success: true, data: CATALOG_PACKAGE });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
  calls = [];
}

function renderPage(config: typeof EN | typeof ZH) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MarketplacePackagePage />
    </I18nProvider>,
  );
}

/**
 * Open the local menu and choose Uninstall. It waits on the menu trigger, which
 * is drawn once the listing answers, and on nothing the header draws, so the
 * Uninstall cases and the header cases each fail for their own face alone.
 */
async function uninstallFromMenu(pack: Pack) {
  const trigger = await screen.findByRole('button', { name: pack.marketplace.detail.moreOptions });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: pack.marketplace.detail.uninstallFromRuntime }));
}

beforeEach(() => {
  calls = [];
  confirmed = [];
  vi.stubGlobal('confirm', (question: string) => {
    confirmed.push(question);
    return true;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each([
  ['en', EN, en as Pack],
  ['zh', ZH, zh as unknown as Pack],
])('Details — a refused local install reads not loaded (objectui#11760) [%s]', (_lang, config, pack) => {
  const badge = pack.marketplace.notLoaded.badge;
  const reason = fill(pack.marketplace.notLoaded.protocolIncompatible, { requiredRange: '^16' });
  const installedV = fill(pack.marketplace.detail.installedV, { version: '3.2.0' });
  const installedVersion = fill(pack.marketplace.versionBadge, { version: '3.2.0' });

  describe.each([
    ['the catalog view (marketplace on)', true],
    ['the offline local view (marketplace off, objectui#11627)', false],
  ])('%s', (_view, marketplace) => {
    it('the header carries the installed version, the not-loaded badge and the protocol reason, not "Installed"', async () => {
      await boot(marketplace, REFUSED);
      renderPage(config);

      expect(await screen.findByText(badge)).toBeInTheDocument();
      expect(screen.getByText(installedVersion)).toBeInTheDocument();
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(screen.queryByText(installedV)).toBeNull();
    });

    it('control: a loaded entry keeps "Installed · vX", with no not-loaded badge and no reason', async () => {
      await boot(marketplace, LOADED);
      renderPage(config);

      expect(await screen.findByText(installedV)).toBeInTheDocument();
      expect(screen.queryByText(badge)).toBeNull();
      // The static head of either reason sentence (the text before its placeholder).
      for (const template of [pack.marketplace.notLoaded.protocolIncompatible, pack.marketplace.notLoaded.otherReason]) {
        const head = template.split('{{')[0];
        expect(head.length).toBeGreaterThan(3);
        expect(document.body.textContent).not.toContain(head);
      }
    });

    it('Uninstall on the not-loaded entry confirms and reports in not-loaded terms', async () => {
      await boot(marketplace, REFUSED);
      renderPage(config);
      await uninstallFromMenu(pack);

      await waitFor(() =>
        expect(calls).toContainEqual({ path: '/api/v1/marketplace/install-local/com.example.crm', method: 'DELETE' }),
      );
      expect(confirmed).toEqual([
        fill(pack.marketplace.uninstall.confirmNotLoaded, { manifestId: 'com.example.crm', version: '3.2.0' }),
      ]);
      expect(
        await screen.findByText(fill(pack.marketplace.uninstall.successNotLoaded, { manifestId: 'com.example.crm' })),
      ).toBeInTheDocument();
    });

    it('control: Uninstall on a loaded entry keeps the loaded package\'s confirm and `successInDetail`', async () => {
      await boot(marketplace, LOADED);
      renderPage(config);
      await uninstallFromMenu(pack);

      await waitFor(() =>
        expect(calls).toContainEqual({ path: '/api/v1/marketplace/install-local/com.example.crm', method: 'DELETE' }),
      );
      expect(confirmed).toEqual([
        fill(pack.marketplace.uninstall.confirm, { manifestId: 'com.example.crm', version: '3.2.0' }),
      ]);
      expect(
        await screen.findByText(fill(pack.marketplace.uninstall.successInDetail, { manifestId: 'com.example.crm' })),
      ).toBeInTheDocument();
    });
  });
});

describe('Details — a refusal code the console has no sentence for (objectui#11760)', () => {
  it('still reads not loaded and names the code; the protocol sentence is not guessed', async () => {
    await boot(true, { ...REFUSED, notLoaded: { code: 'OS_SOME_LATER_REFUSAL', requiredRange: '^18' } });
    renderPage(EN);

    expect(await screen.findByText(en.marketplace.notLoaded.badge)).toBeInTheDocument();
    expect(screen.getByText(fill(en.marketplace.notLoaded.otherReason, { code: 'OS_SOME_LATER_REFUSAL' }))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('^18');
    expect(screen.queryByText(fill(en.marketplace.detail.installedV, { version: '3.2.0' }))).toBeNull();
  });
});
