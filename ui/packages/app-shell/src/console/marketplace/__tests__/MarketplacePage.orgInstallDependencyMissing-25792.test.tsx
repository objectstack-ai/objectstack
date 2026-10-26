// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog page's org install on a self-hosted runtime (`installLocal`)
 * draws the `422 DEPENDENCY_MISSING` refusal (ADR-0141 D2) in the author's
 * terms, one line per unmet entry, from the refusal's own facts
 * (objectstack#25792 item 3).
 *
 * The catalog lists are stubbed; `installLocal` is the REAL client, so the
 * facts the strip draws are the ones that crossed the wire. `t` echoes the KEY
 * and the interpolated facts: the claim is WHICH line each entry gets and that
 * it carries that entry's id, range and version.
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
      const facts = ['dependency', 'range', 'installedVersion'].filter((k) => o?.[k] !== undefined).map((k) => `${k}=${String(o?.[k])}`);
      return facts.length > 0 ? `«${key}|${facts.join('|')}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

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
const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: Install refused: a declared dependency is not satisfied in this environment.';

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

async function boot(installBody: unknown) {
  resetRuntimeConfigForTesting();
  ActiveOrganizationStorage.set('org_1');
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === INSTALL_PATH && method === 'POST') return answer(422, installBody);
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

const refusal = (details: unknown) => ({
  success: false,
  error: { code: 'DEPENDENCY_MISSING', httpStatus: 422, message: SERVER_MESSAGE, details },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the catalog page draws DEPENDENCY_MISSING from its facts (objectstack#25792)', () => {
  it('one line per unmet entry under the heading, in place of the server\'s English sentence', async () => {
    await boot(refusal({
      compatible: false,
      issues: [
        { severity: 'error', category: 'dependency_missing', message: 'not installed' },
        { severity: 'error', category: 'dependency_missing', message: 'version unreadable' },
      ],
      unmet: [
        { packageId: PKG, dependency: 'app.objectstack.hotcrm', range: '6.x', found: 'absent' },
        { packageId: PKG, dependency: 'com.acme.billing', range: '^2.1.0', found: 'unreadable-version', installedVersion: 'nightly' },
      ],
    }));
    await installFromOrgCard();

    const strip = await screen.findByText(/marketplace\.install\.dependencyMissing\.heading/);
    expect(strip.textContent!.split('\n')).toEqual([
      '«marketplace.install.dependencyMissing.heading»',
      '• «marketplace.install.dependencyMissing.absent|dependency=app.objectstack.hotcrm|range=6.x|installedVersion=—»',
      '• «marketplace.install.dependencyMissing.unreadableVersion|dependency=com.acme.billing|range=^2.1.0|installedVersion=nightly»',
    ]);
    // The lines stay lines on screen.
    expect(strip).toHaveClass('whitespace-pre-wrap');
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('CONTROL: another refusal keeps the envelope\'s own message', async () => {
    await boot({ success: false, error: { code: 'MANIFEST_CONFLICT', httpStatus: 409, message: SERVER_MESSAGE } });
    await installFromOrgCard();

    expect(await screen.findByText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/dependencyMissing/)).not.toBeInTheDocument();
  });
});
