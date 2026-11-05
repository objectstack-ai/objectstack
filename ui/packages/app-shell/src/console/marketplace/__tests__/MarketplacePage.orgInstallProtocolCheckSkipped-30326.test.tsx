// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog page's org install on a self-hosted runtime (`installLocal`)
 * says when the install door admitted the package WITHOUT checking its
 * platform protocol range: the answer's `data.protocolCheckSkipped`
 * (objectstack#30326), drawn under the installed sentence.
 *
 * The catalog lists are stubbed; `installLocal` is the REAL client, so the
 * notice the strip draws is the one that crossed the wire.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
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

vi.mock('../ConnectorCredentialsStep', () => ({
  ConnectorCredentialsStep: () => <div data-testid="credential-step" />,
}));
vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

const PKG = 'com.acme.psa';
const ORG_ROW = {
  id: 'pkg_psa',
  manifest_id: PKG,
  display_name: 'Acme PSA',
  description: 'A PSA.',
  category: null,
  icon_url: null,
  visibility: 'org',
  latest_version: '1.0.0',
};

vi.mock('../marketplaceApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMarketplacePackages: async () => ({ items: [] }),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ connected: true, items: [ORG_ROW] }),
  listInstalledPackages: async () => ({ connected: true, items: [] }),
}));

import { ActiveOrganizationStorage } from '@object-ui/auth';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const INSTALL_PATH = '/api/v1/marketplace/install-local';
const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: installed without a compatibility check.';
const MANAGED = { manifestId: PKG, version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-05T00:00:00Z', upgradedFrom: null };

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

async function boot(installData: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  ActiveOrganizationStorage.set('org_1');
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === INSTALL_PATH && method === 'POST') return answer(200, { success: true, data: installData });
    if (path === '/api/v1/runtime/config') {
      return answer(200, {
        cloudUrl: 'https://cloud.example', singleEnvironment: true, defaultEnvironmentId: 'env_1',
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      });
    }
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
  await initRuntimeConfig();
}

async function installFromOrgCard() {
  render(<MarketplacePage />);
  const card = await screen.findByTestId(`org-card-${PKG}`);
  fireEvent.click(within(card).getByRole('button', { name: '«marketplace.org.install»' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the catalog page\'s org install draws protocolCheckSkipped (objectstack#30326)', () => {
  it('installed, its range unchecked: the installed sentence, then the unchecked-protocol line', async () => {
    await boot({
      ...MANAGED, hotLoaded: true,
      protocolCheckSkipped: { reason: 'no-range', packageId: PKG, protocolVersion: '18.1.0', message: SERVER_MESSAGE },
    });
    await installFromOrgCard();

    const line = await screen.findByTestId('protocol-check-skipped');
    expect(line).toHaveTextContent('«marketplace.install.protocolCheckSkipped.noRange|packageId=com.acme.psa|protocolVersion=18.1.0|requiredRange=»');
    expect(screen.getByText('«marketplace.org.installed»')).toBeInTheDocument();
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('CONTROL: an install whose range was checked draws no such line', async () => {
    await boot({ ...MANAGED, hotLoaded: true });
    await installFromOrgCard();

    expect(await screen.findByText('«marketplace.org.installed»')).toBeInTheDocument();
    expect(screen.queryByTestId('protocol-check-skipped')).not.toBeInTheDocument();
  });
});
