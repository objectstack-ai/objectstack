// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page's Install result says when the install door admitted the
 * package WITHOUT checking its platform protocol range: the answer's
 * `data.protocolCheckSkipped` (objectstack#30326), drawn under the success
 * sentence. Managed (loaded now, loaded at restart) and unmanaged answers all
 * carry it.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path, so the
 * notice the page draws is the one that crossed the wire. `t` echoes the KEY
 * and the notice's facts.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_psa' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => {
      const facts = ['packageId', 'protocolVersion', 'requiredRange'].filter((k) => o?.[k] !== undefined).map((k) => `${k}=${String(o?.[k])}`);
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

const INSTALL_PATH = '/api/v1/marketplace/install-local';
const MANIFEST_PATH = '/api/v1/marketplace/packages/pkg_psa/versions/latest/manifest';
const CATALOG_PACKAGE = {
  package: { id: 'pkg_psa', manifest_id: 'com.acme.psa', display_name: 'PSA', latest_version: { id: 'ver_1', version: '1.0.0' } },
  versions: [{ id: 'ver_1', version: '1.0.0' }],
};
const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: installed without a compatibility check.';
const NO_RANGE = { reason: 'no-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0', message: SERVER_MESSAGE };

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

async function boot(installData: Record<string, unknown>, installModes?: string[]) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/v1/runtime/config') {
      return answer(200, {
        cloudUrl: '', singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      });
    }
    if (path === INSTALL_PATH && method === 'GET') return answer(200, { success: true, data: { items: [], total: 0 } });
    if (path === INSTALL_PATH && method === 'POST') return answer(200, { success: true, data: installData });
    if (path === MANIFEST_PATH) {
      return answer(200, {
        success: true,
        data: { manifest: { id: 'com.acme.psa', version: '1.0.0', type: 'app', ...(installModes ? { installModes } : {}) }, version: '1.0.0', version_id: 'ver_1' },
      });
    }
    if (path === '/api/v1/marketplace/packages/pkg_psa') return answer(200, { success: true, data: CATALOG_PACKAGE });
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
  await initRuntimeConfig();
}

async function install() {
  render(<MarketplacePackagePage />);
  const button = await screen.findByRole('button', { name: '«marketplace.action.install»' });
  await act(async () => {});
  fireEvent.click(button);
}

const MANAGED = { manifestId: 'com.acme.psa', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-05T00:00:00Z', upgradedFrom: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the package page\'s Install result draws protocolCheckSkipped (objectstack#30326)', () => {
  it('a managed install the kernel loaded: the success sentence, then the unchecked-protocol line', async () => {
    await boot({ ...MANAGED, hotLoaded: true, protocolCheckSkipped: NO_RANGE });
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess»')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-check-skipped')).toHaveTextContent(
      '«marketplace.install.protocolCheckSkipped.noRange|packageId=com.acme.psa|protocolVersion=18.1.0|requiredRange=»',
    );
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('a managed install loaded at restart carries it too', async () => {
    await boot({ ...MANAGED, hotLoaded: false, protocolCheckSkipped: NO_RANGE });
    await install();

    expect(await screen.findByText('«marketplace.install.localLoadsAtRestart»')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-check-skipped')).toHaveTextContent('marketplace.install.protocolCheckSkipped.noRange');
  });

  it('an unmanaged copy with an unreadable range: the range it declared', async () => {
    await boot({
      installMode: 'unmanaged', manifestId: 'com.acme.psa', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-05T00:00:00Z',
      installedFrom: { packageId: 'com.acme.psa' }, targetPackageId: 'com.acme.psa_copy', namespace: 'psa', copiedCount: 0, copied: [], strippedLocks: [],
      protocolCheckSkipped: {
        reason: 'unparsed-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0',
        requiredRange: 'latest', rangeSource: 'engines.protocol', message: SERVER_MESSAGE,
      },
    }, ['unmanaged']);
    await install();

    expect(await screen.findByText('«marketplace.install.unmanagedSuccess»')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-check-skipped')).toHaveTextContent(
      '«marketplace.install.protocolCheckSkipped.unparsedRange|packageId=com.acme.psa|protocolVersion=18.1.0|requiredRange=latest»',
    );
  });

  it('CONTROL: an install whose range was checked draws no such line', async () => {
    await boot({ ...MANAGED, hotLoaded: true });
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess»')).toBeInTheDocument();
    expect(screen.queryByTestId('protocol-check-skipped')).not.toBeInTheDocument();
  });
});
