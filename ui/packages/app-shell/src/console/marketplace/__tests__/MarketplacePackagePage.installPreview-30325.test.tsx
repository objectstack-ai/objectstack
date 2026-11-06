// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page's local Install opens a confirm that says what the install
 * adds before anything is installed (objectstack#30325): how many objects,
 * permission sets and sample records, and which permission sets it will
 * suggest granting to Everyone. Its Install is the one click that installs.
 *
 * The counts come from the manifest answer the page already reads for the
 * install modes (`GET /api/v1/marketplace/packages/:id/versions/latest/manifest`,
 * the body install-local installs): one read serves both.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path, so the
 * requests counted are the ones the page puts on the wire. `t` echoes the KEY
 * and the interpolated name, count and set.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => {
      const facts = ['name', 'count', 'set'].filter((k) => o?.[k] !== undefined).map((k) => `${k}=${String(o?.[k])}`);
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

const PKG = 'app.acme.crm';
const INSTALL_PATH = '/api/v1/marketplace/install-local';
const MANIFEST_PATH = '/api/v1/marketplace/packages/pkg_crm/versions/latest/manifest';
const CATALOG_PACKAGE = {
  package: { id: 'pkg_crm', manifest_id: PKG, display_name: 'Acme CRM', latest_version: { id: 'ver_6', version: '6.0.0' } },
  versions: [{ id: 'ver_6', version: '6.0.0' }],
};
const records = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));

/** A flattened marketplace bundle, the shape a published app's version serves. */
const BUNDLE = {
  manifest: { id: PKG, version: '6.0.0', type: 'app', name: 'Acme CRM' },
  objects: [{ name: 'crm_account' }, { name: 'crm_contact' }, { name: 'crm_lead' }],
  permissions: [{ name: 'crm_user', isDefault: true }, { name: 'crm_admin' }],
  data: [
    { object: 'crm_account', externalId: 'name', records: records(5) },
    { object: 'crm_contact', externalId: 'email', records: records(4) },
  ],
};

const MANAGED = { manifestId: PKG, version: '6.0.0', versionId: 'ver_6', installedAt: '2026-11-05T00:00:00Z', upgradedFrom: null, hotLoaded: true };

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls: string[] = [];

async function boot(manifest: { status: number; body?: unknown }) {
  calls = [];
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${path}`);
    if (path === '/api/v1/runtime/config') {
      return answer(200, {
        cloudUrl: '', singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      });
    }
    if (path === INSTALL_PATH && method === 'GET') return answer(200, { success: true, data: { items: [], total: 0 } });
    if (path === INSTALL_PATH && method === 'POST') return answer(200, { success: true, data: MANAGED });
    if (path === MANIFEST_PATH) {
      return manifest.status === 200
        ? answer(200, { success: true, data: { manifest: manifest.body, version: '6.0.0', version_id: 'ver_6' } })
        : answer(manifest.status, { success: false, error: { code: 'NOT_FOUND', message: 'no manifest' } });
    }
    if (path === '/api/v1/marketplace/packages/pkg_crm') return answer(200, { success: true, data: CATALOG_PACKAGE });
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
  await initRuntimeConfig();
}

const posts = () => calls.filter((c) => c === `POST ${INSTALL_PATH}`);

/** Render, settle the manifest read, and click the page's Install. */
async function openConfirm() {
  render(<MarketplacePackagePage />);
  const button = await screen.findByRole('button', { name: '«marketplace.action.install»' });
  await waitFor(() => expect(calls).toContain(`GET ${MANIFEST_PATH}`));
  await act(async () => {});
  fireEvent.click(button);
  return screen.findByTestId('install-preview-dialog');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the local Install confirms what it adds first (objectstack#30325)', () => {
  it('Install opens the confirm with the counts and the suggested grant, and installs nothing yet', async () => {
    await boot({ status: 200, body: BUNDLE });
    const dialog = await openConfirm();

    expect(within(dialog).getByText('«marketplace.install.preview.title|name=Acme CRM»')).toBeInTheDocument();
    expect(within(dialog).getByText('«marketplace.install.preview.intro»')).toBeInTheDocument();
    expect(within(dialog).getByTestId('install-preview-objects')).toHaveTextContent('3');
    expect(within(dialog).getByTestId('install-preview-permission-sets')).toHaveTextContent('2');
    expect(within(dialog).getByTestId('install-preview-sample-records')).toHaveTextContent('9');
    expect(within(dialog).getByText('«marketplace.install.preview.sampleNote»')).toBeInTheDocument();
    expect(within(dialog).getByTestId('install-preview-suggestions')).toHaveTextContent(
      '«marketplace.install.preview.suggestsEveryone|set=crm_user»',
    );
    expect(posts()).toHaveLength(0);
    // One manifest read served the modes and the counts.
    expect(calls.filter((c) => c === `GET ${MANIFEST_PATH}`)).toHaveLength(1);
  });

  it('its Install installs once, as the button did, and the result is drawn', async () => {
    await boot({ status: 200, body: BUNDLE });
    await openConfirm();
    fireEvent.click(screen.getByTestId('install-preview-confirm'));

    expect(await screen.findByText('«marketplace.install.localSuccess|name=Acme CRM»')).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(screen.queryByTestId('install-preview-dialog')).not.toBeInTheDocument();
  });

  it('Cancel installs nothing', async () => {
    await boot({ status: 200, body: BUNDLE });
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: '«common.cancel»' }));

    await waitFor(() => expect(screen.queryByTestId('install-preview-dialog')).not.toBeInTheDocument());
    await act(async () => {});
    expect(posts()).toHaveLength(0);
  });

  it('a scoped sample dataset reads as an upper bound', async () => {
    await boot({ status: 200, body: { ...BUNDLE, data: [{ object: 'crm_account', locale: ['zh-CN'], records: records(6) }] } });
    const dialog = await openConfirm();

    expect(within(dialog).getByTestId('install-preview-sample-records')).toHaveTextContent('«marketplace.install.preview.atMost|count=6»');
  });

  it('no sample records and no default set: no sample note and no suggestion line', async () => {
    await boot({ status: 200, body: { manifest: BUNDLE.manifest, objects: BUNDLE.objects, permissions: [{ name: 'crm_admin' }] } });
    const dialog = await openConfirm();

    expect(within(dialog).getByTestId('install-preview-sample-records')).toHaveTextContent('0');
    expect(within(dialog).queryByText('«marketplace.install.preview.sampleNote»')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('install-preview-suggestions')).not.toBeInTheDocument();
  });

  it('a manifest that cannot be read: the confirm says so, and its Install still installs', async () => {
    await boot({ status: 404 });
    const dialog = await openConfirm();

    expect(within(dialog).getByText('«marketplace.install.preview.unreadable»')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('install-preview')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId('install-preview-confirm'));
    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});
