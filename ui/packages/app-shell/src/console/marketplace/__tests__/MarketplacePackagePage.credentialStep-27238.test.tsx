// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A local install ends on the package's credential step (ruling A on
 * objectstack#27230): once install-local answers that the running kernel
 * loaded the package, the result banner reads the credential listing for that
 * package and offers each reference it still needs.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path, so the
 * package id the step filters by is the one the install answer carried.
 *
 *   - `hotLoaded: true` → the step, with the package's references only;
 *   - the listing walled (`403`) → the install answer's `credentialNote`;
 *   - `hotLoaded: false` → no step: nothing of the package is loaded yet, so it
 *     declares no reference the door would accept.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_billing' }),
  Link: ({ to, children, ...rest }: { to: string; children: unknown }) => <a href={to} {...rest}>{children as never}</a>,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// `t` echoes the KEY: the claim is which parts the banner draws.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => <div data-testid="suggested-bindings" />,
}));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const PKG = 'com.acme.billing';
const INSTALL_PATH = '/api/v1/marketplace/install-local';
const MANIFEST_PATH = '/api/v1/marketplace/packages/pkg_billing/versions/latest/manifest';
const DOOR = '/api/v1/automation/connectors/credential-refs';
const NOTE = 'BILLING_API_TOKEN still needs a value: set it in Setup → Integrations → Connector Credentials.';
const CATALOG_PACKAGE = {
  package: { id: 'pkg_billing', manifest_id: PKG, display_name: 'Billing', latest_version: { id: 'ver_1', version: '1.0.0' } },
  versions: [{ id: 'ver_1', version: '1.0.0' }],
};

let hotLoaded = true;
let listing: { status: number; body: unknown };
let doorReads = 0;

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const ref = (name: string, packageId: string) => ({
  ref: name,
  status: 'missing',
  source: null,
  writable: true,
  declared: true,
  connectors: [{ name: `${name.toLowerCase()}_conn`, packageId, state: 'degraded' }],
});

async function boot() {
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
    if (path === INSTALL_PATH && method === 'POST') {
      return answer(200, {
        success: true,
        data: {
          manifestId: PKG, version: '1.0.0', versionId: 'ver_1', installedAt: '2026-10-30T00:00:00.000Z',
          hotLoaded, upgradedFrom: null, credentialNote: NOTE,
          credentialRefs: [{ ref: 'BILLING_API_TOKEN', status: 'missing' }],
        },
      });
    }
    if (path === MANIFEST_PATH) {
      return answer(200, { success: true, data: { manifest: { id: PKG, version: '1.0.0', type: 'app' }, version: '1.0.0', version_id: 'ver_1' } });
    }
    if (path === '/api/v1/marketplace/packages/pkg_billing') return answer(200, { success: true, data: CATALOG_PACKAGE });
    if (path === DOOR && method === 'GET') {
      doorReads++;
      return answer(listing.status, listing.body);
    }
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

beforeEach(() => {
  hotLoaded = true;
  doorReads = 0;
  listing = {
    status: 200,
    body: { success: true, data: { credentialRefs: [ref('BILLING_API_TOKEN', PKG), ref('CRM_API_KEY', 'com.acme.crm')], total: 2 } },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a local install ends on the credential step (objectstack#27238)', () => {
  it('offers the installed package\'s references, under the success line', async () => {
    await boot();
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess»')).toBeInTheDocument();
    expect(await screen.findByTestId('install-credentials-step')).toBeInTheDocument();
    expect(screen.getByTestId('install-credential-BILLING_API_TOKEN')).toBeInTheDocument();
    expect(screen.queryByTestId('install-credential-CRM_API_KEY')).toBeNull();
    expect(screen.queryByTestId('install-credentials-note')).toBeNull();
  });

  it('where the listing is walled, shows the install answer\'s credentialNote instead', async () => {
    listing = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'walled' } } };
    await boot();
    await install();

    expect(await screen.findByTestId('install-credentials-note')).toHaveTextContent(NOTE);
    expect(screen.queryByTestId('install-credentials-step')).toBeNull();
  });

  it('CONTROL: a package loaded only at the next restart gets no step', async () => {
    hotLoaded = false;
    await boot();
    await install();

    expect(await screen.findByText('«marketplace.install.localLoadsAtRestart»')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTestId('install-credentials-step')).toBeNull();
    expect(screen.queryByTestId('install-credentials-note')).toBeNull();
    await waitFor(() => expect(doorReads).toBe(0));
  });
});
