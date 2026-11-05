// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * After an install into this runtime, the package page says how many sample
 * records the install loaded and offers the clear right there; the clear is
 * confirmed in the console's own dialog, with that count; and a banner
 * follows the installer to the app once they leave the page (objectstack#30323).
 *
 * Sample data stays ON by default (the maintainer's ruling on the card): every
 * case installs WITH it, and what is pinned is how it is announced and cleared.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path and
 * records every call, so the count the note draws is the one the install
 * answer's `seeded` carried, and "cleared" means a purge POST left. `t` echoes
 * the KEY and the facts it was given. `window.confirm` throws: the page must
 * not reach for the browser's dialog.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NotificationProvider } from '@object-ui/react';
import { NotificationBanners } from '@object-ui/components';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ packageId: 'pkg_crm', appName: 'setup' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => {
      const facts = ['count', 'name'].filter((k) => o?.[k] !== undefined).map((k) => `${k}=${String(o?.[k])}`);
      return facts.length > 0 ? `«${key}|${facts.join('|')}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => <div data-testid="suggested-bindings" />,
}));
vi.mock('../ConnectorCredentialsStep', () => ({
  ConnectorCredentialsStep: () => <div data-testid="credential-step" />,
}));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';
import { resetSampleDataSessionForTesting } from '../sampleDataNotice';

const LEDGER = '/api/v1/marketplace/install-local';
const PURGE = `${LEDGER}/com.acme.crm/purge-sample-data`;
const CATALOG_PACKAGE = {
  package: { id: 'pkg_crm', manifest_id: 'com.acme.crm', display_name: 'Acme CRM', latest_version: { id: 'ver_1', version: '6.0.0' } },
  versions: [{ id: 'ver_1', version: '6.0.0' }],
};
const ENTRY = { packageId: 'pkg_crm', versionId: 'ver_1', manifestId: 'com.acme.crm', version: '6.0.0', installedAt: '2026-11-05T00:00:00Z' };
const MANAGED = { manifestId: 'com.acme.crm', version: '6.0.0', versionId: 'ver_1', installedAt: '2026-11-05T00:00:00Z', upgradedFrom: null, hotLoaded: true };
const SEEDED_369 = { mode: 'inline', inserted: 369, updated: 0, skipped: 0, errors: 0 };

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls: Array<{ method: string; path: string }> = [];

/** `installed`: the ledger before the install; the install puts the entry (with sample data) in it. */
async function boot(installData: Record<string, unknown>, opts: { installed?: Record<string, unknown> } = {}) {
  resetRuntimeConfigForTesting();
  calls = [];
  let ledger: Array<Record<string, unknown>> = opts.installed ? [opts.installed] : [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path });
    if (path === '/api/v1/runtime/config') {
      return answer(200, {
        cloudUrl: '', singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      });
    }
    if (path === LEDGER && method === 'GET') return answer(200, { success: true, data: { items: ledger, total: ledger.length } });
    if (path === LEDGER && method === 'POST') {
      ledger = [{ ...ENTRY, withSampleData: true }];
      return answer(200, { success: true, data: installData });
    }
    if (path === PURGE && method === 'POST') {
      ledger = ledger.map((e) => ({ ...e, withSampleData: false }));
      return answer(200, { success: true, data: { manifestId: 'com.acme.crm', deleted: 369, skipped: 0, errors: 0, withSampleData: false } });
    }
    if (path === '/api/v1/marketplace/packages/pkg_crm/versions/latest/manifest') {
      return answer(200, { success: true, data: { manifest: { id: 'com.acme.crm', version: '6.0.0', type: 'app' }, version: '6.0.0', version_id: 'ver_1' } });
    }
    if (path === '/api/v1/marketplace/packages/pkg_crm') return answer(200, { success: true, data: CATALOG_PACKAGE });
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
  await initRuntimeConfig();
}

/** The page, and optionally the console's banner surface beside it, as `ConsoleLayout` draws it. */
function Shell({ page }: { page: boolean }) {
  return (
    <NotificationProvider>
      <NotificationBanners />
      {page ? <MarketplacePackagePage /> : <div data-testid="app-page" />}
    </NotificationProvider>
  );
}

async function install(withProvider = false) {
  const view = render(withProvider ? <Shell page /> : <MarketplacePackagePage />);
  const button = await screen.findByRole('button', { name: /«marketplace\.action\.(install|reinstall)»/ });
  await act(async () => {});
  fireEvent.click(button);
  return view;
}

const purgeCalls = () => calls.filter((c) => c.path === PURGE);

beforeEach(() => {
  navigate.mockReset();
  resetSampleDataSessionForTesting();
  vi.stubGlobal('confirm', () => { throw new Error('the browser confirm was used'); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the install note says how many sample records the install loaded (objectstack#30323)', () => {
  it('a managed install that seeded 369 records: the definite success sentence, the count and the clear', async () => {
    await boot({ ...MANAGED, seeded: SEEDED_369 });
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess|name=Acme CRM»')).toBeInTheDocument();
    const note = await screen.findByTestId('install-sample-data');
    expect(note).toHaveTextContent('«marketplace.detail.sampleDataLoaded|count=369»');
    expect(note).not.toHaveTextContent('marketplace.detail.sampleDataReloaded');
    expect(await within(note).findByTestId('install-sample-data-clear')).toHaveTextContent('«marketplace.detail.purgeSampleData»');
  });

  it('records already in place count too: an install over live sample data reports inserted + updated + skipped', async () => {
    await boot({ ...MANAGED, seeded: { mode: 'inline', inserted: 2, updated: 3, skipped: 364, errors: 0 } }, { installed: { ...ENTRY, withSampleData: true } });
    await install();

    const note = await screen.findByTestId('install-sample-data');
    expect(note).toHaveTextContent('«marketplace.detail.sampleDataLoaded|count=369»');
    // An install over an existing one says the sample data came back.
    expect(note).toHaveTextContent('«marketplace.detail.sampleDataReloaded»');
  });

  it('a reinstall after the sample data was cleared says it is loaded again', async () => {
    await boot({ ...MANAGED, seeded: SEEDED_369 }, { installed: { ...ENTRY, withSampleData: false } });
    await install();

    const note = await screen.findByTestId('install-sample-data');
    expect(note).toHaveTextContent('«marketplace.detail.sampleDataLoaded|count=369»');
    expect(note).toHaveTextContent('«marketplace.detail.sampleDataReloaded»');
  });

  it.each([
    ['a package that bundles no seed datasets', { mode: 'skipped', reason: 'no-datasets' }],
    ['a walled session with no active organization', { mode: 'refused', reason: 'no active organization' }],
    ['a seed run that left no record in place', { mode: 'inline', inserted: 0, updated: 0, skipped: 0, errors: 4 }],
  ])('CONTROL: %s draws no sample-data line', async (_label, seeded) => {
    await boot({ ...MANAGED, seeded });
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess|name=Acme CRM»')).toBeInTheDocument();
    expect(screen.queryByTestId('install-sample-data')).not.toBeInTheDocument();
  });

  it('CONTROL: an answer with no `seeded` report draws no sample-data line', async () => {
    await boot({ ...MANAGED });
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess|name=Acme CRM»')).toBeInTheDocument();
    expect(screen.queryByTestId('install-sample-data')).not.toBeInTheDocument();
  });
});

describe('the clear is confirmed in the console\'s own dialog (objectstack#30323)', () => {
  it('the note\'s clear opens the dialog with the count, and its confirm purges and drops the clear', async () => {
    await boot({ ...MANAGED, seeded: SEEDED_369 });
    await install();
    fireEvent.click(await screen.findByTestId('install-sample-data-clear'));

    const dialog = await screen.findByTestId('purge-sample-data-dialog');
    expect(dialog).toHaveTextContent('«marketplace.detail.purgeConfirmAtMost|count=369»');
    expect(dialog).toHaveTextContent('«marketplace.detail.purgeConfirm»');
    expect(purgeCalls()).toEqual([]);

    fireEvent.click(within(dialog).getByTestId('purge-sample-data-confirm'));

    expect(await screen.findByText('«marketplace.detail.purgeSuccess|count=369»')).toBeInTheDocument();
    expect(purgeCalls()).toEqual([{ method: 'POST', path: PURGE }]);
    await waitFor(() => expect(screen.queryByTestId('install-sample-data')).not.toBeInTheDocument());
  });

  it('Cancel purges nothing', async () => {
    await boot({ ...MANAGED, seeded: SEEDED_369 });
    await install();
    fireEvent.click(await screen.findByTestId('install-sample-data-clear'));

    const dialog = await screen.findByTestId('purge-sample-data-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '«common.cancel»' }));

    await waitFor(() => expect(screen.queryByTestId('purge-sample-data-dialog')).not.toBeInTheDocument());
    expect(purgeCalls()).toEqual([]);
    expect(screen.getByTestId('install-sample-data')).toBeInTheDocument();
  });

  it('the ⋯ menu\'s purge on a visit with no install this session: the dialog without a count', async () => {
    await boot({ ...MANAGED }, { installed: { ...ENTRY, withSampleData: true } });
    render(<MarketplacePackagePage />);

    fireEvent.pointerDown(await screen.findByRole('button', { name: '«marketplace.detail.moreOptions»' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: '«marketplace.detail.purgeSampleData»' }));

    const dialog = await screen.findByTestId('purge-sample-data-dialog');
    expect(dialog).toHaveTextContent('«marketplace.detail.purgeConfirm»');
    expect(dialog).not.toHaveTextContent('purgeConfirmAtMost');
    fireEvent.click(within(dialog).getByTestId('purge-sample-data-confirm'));
    await waitFor(() => expect(purgeCalls()).toEqual([{ method: 'POST', path: PURGE }]));
  });
});

describe('a banner follows the installer to the app\'s pages (objectstack#30323)', () => {
  it('no banner on the package page; leaving it raises one whose action brings the installer back to clear', async () => {
    await boot({ ...MANAGED, seeded: SEEDED_369 });
    const view = await install(true);
    await screen.findByTestId('install-sample-data');
    expect(document.querySelector('[data-notification-surface="banner"]')).toBeNull();

    // To the app: the page unmounts, the banner surface stays.
    view.rerender(<Shell page={false} />);
    const banner = await screen.findByText('«marketplace.detail.sampleDataBannerTitle|name=Acme CRM»');
    expect(banner.closest('[role="status"]')).toHaveTextContent('«marketplace.detail.sampleDataBannerMessage»');

    fireEvent.click(screen.getByRole('button', { name: '«marketplace.detail.purgeSampleData»' }));
    expect(navigate).toHaveBeenCalledWith('/apps/setup/system/marketplace/pkg_crm');

    // Back on the package page: the banner goes, and the confirm is open with the count.
    view.rerender(<Shell page />);
    const dialog = await screen.findByTestId('purge-sample-data-dialog');
    expect(dialog).toHaveTextContent('«marketplace.detail.purgeConfirmAtMost|count=369»');
    expect(screen.queryByText('«marketplace.detail.sampleDataBannerTitle|name=Acme CRM»')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId('purge-sample-data-confirm'));
    await waitFor(() => expect(purgeCalls()).toEqual([{ method: 'POST', path: PURGE }]));

    // Cleared: leaving again raises no banner.
    view.rerender(<Shell page={false} />);
    await act(async () => {});
    expect(screen.queryByText('«marketplace.detail.sampleDataBannerTitle|name=Acme CRM»')).not.toBeInTheDocument();
  });

  it('CONTROL: an install that loaded no sample data raises no banner on leaving', async () => {
    await boot({ ...MANAGED, seeded: { mode: 'skipped', reason: 'no-datasets' } });
    const view = await install(true);
    await screen.findByText('«marketplace.install.localSuccess|name=Acme CRM»');

    view.rerender(<Shell page={false} />);
    await act(async () => {});
    expect(document.querySelector('[data-notification-surface="banner"]')).toBeNull();
  });
});
