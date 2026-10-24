// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package install, upgrade or uninstall that the install door refuses under a
 * wall reaches the operator WITH the door's reason: the posture-naming sentence,
 * never a bare status (objectui#7611, item 2 of its release record).
 *
 * ## The refusal under test
 *
 * Since objectstack W2 (objectstack#22935, merge `4806b18aea`, carried by
 * `@objectstack/*` `18.0.0-next.0`), `@objectstack/cloud-connection`'s
 * install-local door refuses, below the platform-operator rung under the
 * `group` / `isolated` tenancy postures, an install or upgrade of a package that
 * declares a security catalog item, and the uninstall of such a package
 * (ADR-0131 D3: "tenant admins cannot create or edit catalog items; the
 * operator defines the catalog for every tenant"). The answer is
 * `refuseWalledCatalogPackage`'s, the sibling refusals' envelope:
 *
 *   403 { success: false, error: { code: 'FORBIDDEN', message, details: { manifestId, catalogItems } } }
 *
 * where `message` is `VERB "MANIFEST_ID" is refused: the package carries
 * security catalog items. ` followed by `walledCatalogWriteVerdict`'s sentence
 * (`@objectstack/metadata-core`), which names the posture. `VERB` is
 * `Installing` for an install AND an upgrade (one door, asked with the incoming
 * and the installed manifest), `Uninstalling` for an uninstall. The fixtures
 * below rebuild that text from those two producers at `4806b18aea`; the cases
 * assert that the page shows it as sent, so the wording stays the server's.
 *
 * ## The gestures, as the console makes them
 *
 * - install: the package page's Install (`installLocal`);
 * - upgrade: the package page's Reinstall over an installed OLDER version. On
 *   an install-local runtime that is the console's upgrade: it names no
 *   version, so the door installs `latest` over the installed one;
 * - uninstall: the package page's local menu (`uninstallLocal`); the same
 *   refusal on a Setup → Packages marketplace row, which carries the button
 *   the Installed Apps list had, is pinned in
 *   `MarketplaceRowActions.installedAppsPins.test.tsx` (objectui#12675);
 * - install from the catalog page's "Your organization" section (`installLocal`
 *   with `versionId: 'latest'`).
 *
 * ## What "with the reason" is read as
 *
 * The rendered text carries the envelope's `message` whole and the posture it
 * names, and none of the forms a dropped reason degrades into: the status text
 * (`Forbidden`, which every stubbed `Response` carries, so a reader that fell
 * back to it would show it), `HTTP_403`, or the bare code `FORBIDDEN`. Nor the
 * success sentence of the gesture.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers real `Response`
 * objects by path, so the reading under test is the helpers' own. `t` echoes
 * the KEY, as the sibling suites do.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.example.crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';
import { MarketplacePage } from '../MarketplacePage';

type Posture = 'group' | 'isolated';
type Verb = 'Installing' | 'Uninstalling';

const PKG = 'com.example.crm';
const INSTALL_PATH = '/api/v1/marketplace/install-local';
const UNINSTALL_PATH = `${INSTALL_PATH}/${PKG}`;

/**
 * `walledCatalogWriteVerdict`'s refusal sentence (`@objectstack/metadata-core`
 * at `4806b18aea`) for a permission set, the first catalog type the fixture
 * package declares.
 */
const verdictSentence = (posture: Posture) =>
  'Creating, changing or deleting a permission set requires the platform operator: this '
  + `deployment runs the '${posture}' tenancy posture, where the security catalog is shared `
  + 'by every organization (ADR-0131 D3). Holding the `manage_metadata` capability inside an '
  + "organization does not admit it. An organization's administrators assign the catalog's positions "
  + 'and permission sets to their own members instead.';

/** `refuseWalledCatalogPackage`'s message (`@objectstack/cloud-connection` at `4806b18aea`). */
const refusalMessage = (verb: Verb, posture: Posture) =>
  `${verb} "${PKG}" is refused: the package carries security catalog items. ${verdictSentence(posture)}`;

/** The whole 403 body the install-local door sends. */
const refusalBody = (verb: Verb, posture: Posture) => ({
  success: false,
  error: {
    code: 'FORBIDDEN',
    message: refusalMessage(verb, posture),
    details: { manifestId: PKG, catalogItems: [{ type: 'permission', name: 'crm_sales_rep' }] },
  },
});

const json = (status: number, body: unknown, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** The refusal, as the door puts it on the wire: a real 403 whose status text is the bare `Forbidden`. */
const refused = (verb: Verb, posture: Posture) => json(403, refusalBody(verb, posture), 'Forbidden');

const CATALOG_PACKAGE = {
  package: {
    id: PKG,
    manifest_id: PKG,
    display_name: 'Example CRM',
    latest_version: { id: 'ver_crm_4', version: '4.0.1' },
  },
  versions: [{ id: 'ver_crm_4', version: '4.0.1' }],
};

/** The installed entry an upgrade starts from: an OLDER version than the catalog's latest. */
const INSTALLED_OLDER = {
  packageId: PKG,
  versionId: 'ver_crm_3',
  manifestId: PKG,
  version: '3.2.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  withSampleData: false,
  installedBy: 'admin@objectos.ai',
};

const ORG_ROW = {
  id: 'pkg_crm',
  manifest_id: PKG,
  display_name: 'Example CRM',
  description: 'A CRM.',
  category: null,
  icon_url: null,
  visibility: 'org',
  latest_version: '4.0.1',
};

interface Runtime {
  /** The install-local ledger the listing answers. */
  installed: Array<Record<string, unknown>>;
  /** What a mutating install-local request answers. */
  refusal: () => Response;
}
let runtime: Runtime;
let writes: Array<{ method: string; path: string; body: unknown }> = [];

async function boot(next: Runtime) {
  runtime = next;
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = new URL(String(input), 'http://console.test');
      const path = url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') writes.push({ method, path, body: init?.body ? JSON.parse(init.body) : undefined });
      if (path === '/api/v1/runtime/config') {
        return json(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === INSTALL_PATH && method === 'GET') {
        return json(200, { success: true, data: { items: runtime.installed, total: runtime.installed.length } });
      }
      if (path === INSTALL_PATH && method === 'POST') return runtime.refusal();
      if (path === UNINSTALL_PATH && method === 'DELETE') return runtime.refusal();
      if (path === `/api/v1/marketplace/packages/${PKG}` && method === 'GET') {
        return json(200, { success: true, data: CATALOG_PACKAGE });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        return json(200, { success: true, data: { items: [], total: 0, limit: 100, offset: 0 } });
      }
      if (path === '/api/v1/cloud-connection/org-packages') {
        return json(200, { success: true, data: { connected: true, items: [ORG_ROW] } });
      }
      return json(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }, 'Not Found');
    }),
  );
  await initRuntimeConfig();
  writes = [];
}

/**
 * The element showing the refusal, asserted to carry the door's reason whole
 * and none of the forms a dropped reason degrades into.
 */
async function expectReasonShown(verb: Verb, posture: Posture) {
  const shown = await screen.findByText(refusalMessage(verb, posture));
  expect(shown.textContent).toContain(`'${posture}' tenancy posture`);
  const page = document.body.textContent ?? '';
  expect(page).not.toContain('Forbidden');
  expect(page).not.toContain('HTTP_403');
  expect(page).not.toContain('FORBIDDEN');
  return shown;
}

beforeEach(() => {
  writes = [];
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each<Posture>(['group', 'isolated'])(
  'a walled catalog-package refusal reaches the operator with its reason, under `%s` (objectui#7611)',
  (posture) => {
    it('install: the package page\'s Install shows the door\'s `Installing` refusal', async () => {
      await boot({ installed: [], refusal: () => refused('Installing', posture) });
      render(<MarketplacePackagePage />);
      fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.install»' }));

      await expectReasonShown('Installing', posture);
      expect(writes).toEqual([{ method: 'POST', path: INSTALL_PATH, body: { packageId: PKG } }]);
      expect(screen.queryByText('«marketplace.install.localSuccess»')).not.toBeInTheDocument();
      expect(screen.queryByText('«marketplace.install.localLoadsAtRestart»')).not.toBeInTheDocument();
    });

    it('upgrade: Reinstall over an older installed version shows the same `Installing` refusal', async () => {
      await boot({ installed: [INSTALLED_OLDER], refusal: () => refused('Installing', posture) });
      render(<MarketplacePackagePage />);
      // The local install is listed (3.2.0) and the catalog's latest is 4.0.1: the
      // page's one install control now installs `latest` over it.
      fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.reinstall»' }));

      await expectReasonShown('Installing', posture);
      expect(writes).toEqual([{ method: 'POST', path: INSTALL_PATH, body: { packageId: PKG } }]);
      expect(screen.queryByText('«marketplace.install.localSuccess»')).not.toBeInTheDocument();
    });

    it('uninstall: the package page\'s local menu shows the door\'s `Uninstalling` refusal', async () => {
      await boot({ installed: [INSTALLED_OLDER], refusal: () => refused('Uninstalling', posture) });
      render(<MarketplacePackagePage />);
      const trigger = await screen.findByRole('button', { name: '«marketplace.detail.moreOptions»' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(await screen.findByRole('menuitem', { name: '«marketplace.detail.uninstallFromRuntime»' }));

      await expectReasonShown('Uninstalling', posture);
      expect(writes).toEqual([{ method: 'DELETE', path: UNINSTALL_PATH, body: undefined }]);
      expect(screen.queryByText('«marketplace.uninstall.successInDetail»')).not.toBeInTheDocument();
    });

    it('install: the catalog page\'s organization install shows the door\'s `Installing` refusal', async () => {
      await boot({ installed: [], refusal: () => refused('Installing', posture) });
      render(<MarketplacePage />);
      fireEvent.click(await screen.findByRole('button', { name: '«marketplace.org.install»' }));

      await expectReasonShown('Installing', posture);
      expect(writes).toEqual([{ method: 'POST', path: INSTALL_PATH, body: { packageId: PKG, versionId: 'latest' } }]);
      expect(screen.queryByText('«marketplace.org.installed»')).not.toBeInTheDocument();
      await act(async () => {});
    });
  },
);

describe('CONTROL: the bare forms are detectable on this harness (objectui#7611)', () => {
  /**
   * The negative half of `expectReasonShown` reads the page for `Forbidden`,
   * `HTTP_403` and `FORBIDDEN`. A 403 whose body carries no readable message
   * must put one of them on the page, or those three reads could never fail.
   */
  it('a 403 with no message in its body shows a bare form, which the pins above would refuse', async () => {
    await boot({
      installed: [],
      refusal: () => json(403, { success: false, error: { code: 'FORBIDDEN' } }, 'Forbidden'),
    });
    render(<MarketplacePackagePage />);
    fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.install»' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => {
      const page = document.body.textContent ?? '';
      expect(page.includes('Forbidden') || page.includes('HTTP_403') || page.includes('FORBIDDEN')).toBe(true);
    });
  });
});
