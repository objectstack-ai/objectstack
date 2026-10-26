// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page draws the `422 DEPENDENCY_MISSING` install refusal
 * (ADR-0141 D2) in the author's terms — 「请先安装 HotCRM 6.x」 — one line per
 * unmet entry, from the refusal's own facts (objectstack#25792 item 3).
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path, so the
 * facts the page draws are the ones that crossed the wire. `t` echoes the KEY
 * and the interpolated facts: the claim is WHICH line each entry gets and that
 * it carries that entry's id, range and version.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      const facts = ['dependency', 'range', 'installedVersion'].filter((k) => o?.[k] !== undefined).map((k) => `${k}=${String(o?.[k])}`);
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

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const INSTALL_PATH = '/api/v1/marketplace/install-local';
const MANIFEST_PATH = '/api/v1/marketplace/packages/pkg_psa/versions/latest/manifest';
const CATALOG_PACKAGE = {
  package: { id: 'pkg_psa', manifest_id: 'com.acme.psa', display_name: 'PSA', latest_version: { id: 'ver_1', version: '1.0.0' } },
  versions: [{ id: 'ver_1', version: '1.0.0' }],
};
const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: Install refused: a declared dependency is not satisfied in this environment.';

let installBody: unknown;

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
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
    if (path === INSTALL_PATH && method === 'POST') return answer(422, installBody);
    if (path === MANIFEST_PATH) {
      return answer(200, { success: true, data: { manifest: { id: 'com.acme.psa', version: '1.0.0', type: 'app' }, version: '1.0.0', version_id: 'ver_1' } });
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

const refusal = (details: unknown) => ({
  success: false,
  error: { code: 'DEPENDENCY_MISSING', httpStatus: 422, message: SERVER_MESSAGE, details },
});

beforeEach(() => { installBody = undefined; });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the package page draws DEPENDENCY_MISSING from its facts (objectstack#25792)', () => {
  it('one line per unmet entry under the heading, in place of the server\'s English sentence', async () => {
    installBody = refusal({
      compatible: false,
      issues: [
        { severity: 'error', category: 'dependency_missing', message: 'not installed' },
        { severity: 'error', category: 'dependency_missing', message: 'out of range' },
      ],
      unmet: [
        { packageId: 'com.acme.psa', dependency: 'app.objectstack.hotcrm', range: '6.x', found: 'absent' },
        { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '^2.1.0', found: 'out-of-range', installedVersion: '1.4.0' },
      ],
    });
    await boot();
    await install();

    const note = await screen.findByText(/marketplace\.install\.dependencyMissing\.heading/);
    expect(note.textContent!.split('\n')).toEqual([
      '«marketplace.install.dependencyMissing.heading»',
      '• «marketplace.install.dependencyMissing.absent|dependency=app.objectstack.hotcrm|range=6.x|installedVersion=—»',
      '• «marketplace.install.dependencyMissing.outOfRange|dependency=com.acme.billing|range=^2.1.0|installedVersion=1.4.0»',
    ]);
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('CONTROL: a refusal without facts it can read keeps the envelope\'s own message', async () => {
    installBody = refusal({ compatible: false, issues: [] });
    await boot();
    await install();

    expect(await screen.findByText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/dependencyMissing/)).not.toBeInTheDocument();
  });
});
