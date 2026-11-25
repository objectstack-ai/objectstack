// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Packages (the Installed Apps address included) reads its list and
 * the marketplace install ledger through the console's authenticated fetch, so
 * a session held by its bearer token alone lists the installed packages as
 * every other console page reads its data. With no token stored the reads go
 * out cookie-only, as before.
 *
 * The wire is stubbed as a server with no session cookie: a request that does
 * not carry the stored bearer is refused with the REST seam's `401`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { TokenStorage } from '@object-ui/auth';
import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
// Loaded at import so their first load is not paid inside a test's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const TOKEN = 'stored-session-token';
const MARKET: InstalledPackageRow = {
  manifest: { id: 'com.example.todo', name: 'Todo', version: '1.0.0' },
  enabled: true,
  source: 'marketplace',
  writable: false,
};
const LEDGER_TODO = {
  packageId: 'com.example.todo',
  versionId: 'ver_todo_1',
  manifestId: 'com.example.todo',
  version: '1.0.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  withSampleData: false,
};
const ANONYMOUS_DENY = {
  error: 'UNAUTHENTICATED',
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required to access this endpoint.',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sent = { path: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

/** Boot the runtime config with the marketplace capability, then serve the package doors. */
async function serve({ requireBearer }: { requireBearer: boolean }) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push({ path, credentials: init?.credentials, authorization });
      if (requireBearer && authorization !== `Bearer ${TOKEN}`) return reply(401, ANONYMOUS_DENY);
      if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages: [MARKET] } });
      if (path === '/api/v1/cloud-connection/installed') return reply(200, { success: true, data: { connected: false } });
      if (path === '/api/v1/marketplace/install-local') return reply(200, { success: true, data: { items: [LEDGER_TODO] } });
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${path}` } });
    }),
  );
}

function renderInstalledApps() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/setup/component/developer/packages?source=marketplace']}>
        <PackagesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The package doors this page reads on load. */
const DOORS = ['/api/v1/packages', '/api/v1/cloud-connection/installed', '/api/v1/marketplace/install-local'];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
  TokenStorage.clear();
});

describe('Packages — the list reads carry the stored bearer token', () => {
  it('with a token stored and no session cookie, the installed package is listed', async () => {
    TokenStorage.set(TOKEN);
    await serve({ requireBearer: true });
    renderInstalledApps();

    expect(await screen.findByTestId('pkg-row-com.example.todo')).toBeInTheDocument();
    for (const door of DOORS) {
      const reads = sent.filter((r) => r.path === door);
      expect(reads.length, door).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.authorization, door).toBe(`Bearer ${TOKEN}`);
        expect(read.credentials, door).toBe('include');
      }
    }
  });

  it('with no token stored, the reads go out cookie-only, as before', async () => {
    await serve({ requireBearer: false });
    renderInstalledApps();

    expect(await screen.findByTestId('pkg-row-com.example.todo')).toBeInTheDocument();
    for (const door of DOORS) {
      const reads = sent.filter((r) => r.path === door);
      expect(reads.length, door).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.authorization, door).toBeNull();
        expect(read.credentials, door).toBe('include');
      }
    }
  });
});
