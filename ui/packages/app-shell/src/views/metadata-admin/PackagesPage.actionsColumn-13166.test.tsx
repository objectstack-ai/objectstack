// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Packages draws its Actions column only over rows that carry an
 * action, and the package sheet wraps its values at words (objectui#13166).
 *
 * - The Actions header used to follow the page-level capability (marketplace
 *   on and a workspace admin) while its cells followed a row fact (a
 *   marketplace row with an install entry). An install with no such row — the
 *   card's HotCRM install, code rows only — drew the header over an empty cell
 *   in every row. Header and cells now read the same answer over the rows in
 *   view, so a filter that hides every marketplace row hides the column too.
 * - The sheet's value cell was `break-all`, which broke a Description between
 *   any two letters ("marketplac / e"). Which words break where is a layout
 *   fact happy-dom cannot measure, so the wrap is pinned by its class here and
 *   the Chromium reading lives on the pull request.
 *
 * The wire is stubbed (`fetch`), the runtime config is the real module booted
 * over a served body, and `marketplaceApi` is not mocked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const admin = vi.hoisted(() => ({ value: true }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: admin.value, isResolved: true }),
}));

import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const ACTIONS = t('engine.packages.col.actions', 'en');

// The card's install: two code packages and no marketplace row.
const APP_DESCRIPTION =
  'AI-Native CRM for the ObjectStack marketplace — Accounts, Contacts, Leads, Opportunities, Cases, Knowledge, Forecasts, Campaigns, Contracts.';
const CODE_APP: InstalledPackageRow = {
  manifest: {
    id: 'app.objectstack.hotcrm',
    name: 'HotCRM',
    version: '5.1.2',
    type: 'app',
    scope: 'project',
    description: APP_DESCRIPTION,
  },
  enabled: true,
  source: 'code',
  writable: false,
};
const CODE_SERVICE: InstalledPackageRow = {
  manifest: { id: 'app.objectstack.hotcrm.service', name: 'HotCRM Service', version: '5.1.2', scope: 'project' },
  enabled: true,
  source: 'code',
  writable: false,
};
const PLATFORM: InstalledPackageRow = {
  manifest: { id: 'com.objectstack.platform-base', name: 'Platform Base', version: '18.0.0', scope: 'system' },
  enabled: true,
  source: 'code',
  writable: false,
};
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
  withSampleData: true,
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Boot the real runtime config with the marketplace on, then serve the package doors. */
async function serve(packages: unknown[], ledger: unknown[]) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages } });
      // Not cloud-bound: the marketplace slice reads the local ledger.
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: ledger } });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

function renderPackages(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/component/developer/packages${search}`]}>
      <PackagesPage />
    </MemoryRouter>,
  );
}

const actionsHeader = () => screen.queryByRole('columnheader', { name: ACTIONS });

/** Every drawn row has exactly as many cells as the header has columns. */
function expectRowsMatchHeader() {
  const columns = screen.getAllByRole('columnheader').length;
  for (const row of screen.getAllByTestId(/^pkg-row-(?!uninstall|details)/)) {
    expect(within(row).getAllByRole('cell')).toHaveLength(columns);
  }
}

afterEach(() => {
  cleanup();
  admin.value = true;
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Packages — the Actions column follows the rows that carry an action (objectui#13166)', () => {
  it('draws no Actions header when no row can hold an action, even with the platform rows shown', async () => {
    await serve([CODE_APP, CODE_SERVICE, PLATFORM], []);
    renderPackages();

    await screen.findByTestId('pkg-row-app.objectstack.hotcrm');
    expect(actionsHeader()).toBeNull();
    expectRowsMatchHeader();

    fireEvent.click(document.getElementById('show-kernel')!);
    await screen.findByTestId('pkg-row-com.objectstack.platform-base');
    expect(actionsHeader()).toBeNull();
    expectRowsMatchHeader();
  });

  it('draws no Actions header for a marketplace row the marketplace list does not hold: it has no action to act on', async () => {
    await serve([CODE_APP, MARKET], []);
    renderPackages();

    await screen.findByTestId('pkg-row-com.example.todo');
    expect(actionsHeader()).toBeNull();
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
  });

  it('CONTROL: with a marketplace row that has an install entry, the header and its row actions render, and a row click still opens the sheet', async () => {
    await serve([CODE_APP, MARKET], [LEDGER_TODO]);
    renderPackages();

    await screen.findByTestId('pkg-row-uninstall-com.example.todo');
    expect(actionsHeader()).toBeInTheDocument();
    expectRowsMatchHeader();
    expect(screen.getByTestId('pkg-row-com.example.todo')).toContainElement(
      screen.getByTestId('pkg-row-details-com.example.todo'),
    );
    // The code row sits under the header with an empty Actions cell.
    const codeCells = within(screen.getByTestId('pkg-row-app.objectstack.hotcrm')).getAllByRole('cell');
    expect(codeCells[codeCells.length - 1]).toBeEmptyDOMElement();

    fireEvent.click(screen.getByTestId('pkg-row-app.objectstack.hotcrm'));
    expect(await screen.findByRole('dialog', { name: 'HotCRM' })).toBeInTheDocument();
  });

  it('reads the rows in view: a search that hides every marketplace row hides the column, and clearing it brings the column back', async () => {
    await serve([CODE_APP, MARKET], [LEDGER_TODO]);
    renderPackages();

    await screen.findByTestId('pkg-row-uninstall-com.example.todo');
    const search = screen.getByPlaceholderText(t('engine.packages.search', 'en'));

    fireEvent.change(search, { target: { value: 'hotcrm' } });
    await waitFor(() => expect(screen.queryByTestId('pkg-row-com.example.todo')).toBeNull());
    expect(actionsHeader()).toBeNull();
    expectRowsMatchHeader();

    fireEvent.change(search, { target: { value: '' } });
    await screen.findByTestId('pkg-row-com.example.todo');
    expect(actionsHeader()).toBeInTheDocument();
    expectRowsMatchHeader();
  });

  it('reads the rows in view: `?source=code` hides the column with the marketplace rows', async () => {
    await serve([CODE_APP, MARKET], [LEDGER_TODO]);
    renderPackages('?source=code');

    await screen.findByTestId('pkg-row-app.objectstack.hotcrm');
    expect(screen.queryByTestId('pkg-row-com.example.todo')).toBeNull();
    expect(actionsHeader()).toBeNull();
    expectRowsMatchHeader();
  });

  it('a viewer who is not a workspace admin sees no Actions header, even beside a marketplace row', async () => {
    admin.value = false;
    await serve([CODE_APP, MARKET], [LEDGER_TODO]);
    renderPackages();

    await screen.findByTestId('pkg-row-com.example.todo');
    expect(actionsHeader()).toBeNull();
    expectRowsMatchHeader();
  });
});

describe('Packages — the sheet wraps its values at words (objectui#13166)', () => {
  it('a value breaks at word boundaries, and inside a token only when the token alone overflows', async () => {
    await serve([CODE_APP], []);
    renderPackages();

    fireEvent.click(await screen.findByTestId('pkg-row-app.objectstack.hotcrm'));
    const sheet = await screen.findByRole('dialog', { name: 'HotCRM' });
    for (const value of [within(sheet).getByText(APP_DESCRIPTION), within(sheet).getByText('5.1.2')]) {
      expect(value).toHaveClass('break-words', 'min-w-0');
      expect(value).not.toHaveClass('break-all');
    }
  });
});
