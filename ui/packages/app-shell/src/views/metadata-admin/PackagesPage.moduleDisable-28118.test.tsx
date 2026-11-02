// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28118 — a suite's `type: 'module'` row offers Disable / Enable
 * from the disable door's served verdict, `disableable` (objectstack#28318),
 * and nothing else it cannot author.
 *
 * A module of an installed app is served `writable: false` (read-only for
 * authoring) and `disableable: true` (the disable door accepts it). Pinned
 * through the real `PackageDetailSheet`, and through the real page in the
 * Installed Apps view (`?source=marketplace`), where a marketplace-installed
 * suite's modules are listed as their own rows:
 *   (1) a module row with the verdict shows Disable, which confirms with the
 *       existing consequence copy and sends the one `PATCH …/disable`;
 *   (2) every other write action stays hidden on it, and its read-only reason
 *       says it can be disabled;
 *   (3) a read-only row without the verdict offers no Disable (served `false`,
 *       or absent: anything but `true`);
 *   (4) a disabled module row shows Enable, which runs at once;
 *   (5) the verdict is read, never re-derived: `manifest.type` alone moves
 *       nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { PackageDetailSheet, PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const label = (key: string) => t(`engine.packages.detail.${key}`, 'en');

/** The write actions a writable base offers besides Disable. */
const OTHER_WRITES = ['edit', 'publish', 'revert', 'duplicate', 'adoptOrphans', 'deletePackage'];

const MODULE_ID = 'com.acme.suite.orders';

function moduleRow(
  extra: { enabled?: boolean; scope?: 'project'; disableable?: unknown; type?: string } = {},
): InstalledPackageRow {
  return {
    manifest: {
      id: MODULE_ID,
      name: 'Acme Suite Orders',
      version: '1.0.0',
      type: extra.type ?? 'module',
      ...(extra.scope ? { scope: extra.scope } : {}),
    },
    enabled: extra.enabled ?? true,
    source: 'marketplace',
    writable: false,
    // `disableable: undefined` stands for a row that carries no such key.
    ...(!('disableable' in extra)
      ? { disableable: true }
      : extra.disableable === undefined
        ? {}
        : { disableable: extra.disableable as boolean }),
  };
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: { path: string; method: string }[];

/** Serve the drafts read, the lifecycle doors and (for the page) the list door. */
function stubWire(packages: unknown[] = []) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path.startsWith('/api/v1/meta/_drafts')) return reply(200, { success: true, data: { drafts: [] } });
      if (path === '/api/v1/packages' && method === 'GET') return reply(200, { success: true, data: { packages } });
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: [] } });
      }
      return reply(200, { success: true, data: {} });
    }),
  );
}

/** The lifecycle PATCHes sent: `enable` / `disable`. */
const lifecycleCalls = () =>
  calls
    .filter((c) => c.method === 'PATCH' && /\/(enable|disable)$/.test(c.path))
    .map((c) => c.path.split('/').pop());

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function renderSheet(pkg: InstalledPackageRow) {
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={pkg} open onOpenChange={() => {}} onChanged={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByTestId('pkg-scope');
  await settle();
}

const offered = (keys: string[]) => keys.filter((k) => screen.queryByRole('button', { name: label(k) }) !== null);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('PackageDetailSheet — a module row with the served verdict (objectstack#28118)', () => {
  beforeEach(() => stubWire());

  it('(1) shows Disable, which opens the confirm and sends nothing until it is confirmed', async () => {
    await renderSheet(moduleRow());
    fireEvent.click(screen.getByRole('button', { name: label('disable') }));
    const dialog = await screen.findByTestId('pkg-detail-disable-dialog');
    expect(within(dialog).getByText(/Acme Suite Orders/)).toBeInTheDocument();
    expect(within(dialog).getByText(label('disableDescription'))).toBeInTheDocument();
    expect(lifecycleCalls()).toEqual([]);

    fireEvent.click(within(dialog).getByTestId('pkg-detail-disable-confirm'));
    await vi.waitFor(() => expect(lifecycleCalls()).toEqual(['disable']));
    expect(calls.find((c) => c.method === 'PATCH')?.path).toBe(`/api/v1/packages/${MODULE_ID}/disable`);
  });

  it('(2) keeps every other write action hidden: the module stays read-only for authoring', async () => {
    await renderSheet(moduleRow());
    expect(offered(OTHER_WRITES)).toEqual([]);
    expect(screen.getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.readOnly', 'en'));
  });

  it.each([
    ['a scope-less module (installed from the marketplace)', moduleRow(), 'readOnlyDisableable'],
    ['a project-scoped module (booted from code)', moduleRow({ scope: 'project' }), 'codeReadOnlyDisableable'],
  ])('(2) %s states that it is read-only and can be disabled', async (_name, pkg, key) => {
    await renderSheet(pkg);
    expect(screen.getByTestId('pkg-detail-readonly-reason')).toHaveTextContent(label(key));
  });

  it('(4) a disabled module row shows Enable, which runs at once with no dialog', async () => {
    await renderSheet(moduleRow({ enabled: false }));
    expect(screen.queryByRole('button', { name: label('disable') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: label('enable') }));
    await vi.waitFor(() => expect(lifecycleCalls()).toEqual(['enable']));
    expect(screen.queryByTestId('pkg-detail-disable-dialog')).toBeNull();
    expect(offered(OTHER_WRITES)).toEqual([]);
  });
});

describe('PackageDetailSheet — a read-only row without the verdict (objectstack#28118)', () => {
  beforeEach(() => stubWire());

  it.each([
    ['served disableable: false', moduleRow({ disableable: false })],
    ['no disableable key at all', moduleRow({ disableable: undefined })],
  ])('(3) %s offers no Disable and keeps the plain read-only reason', async (_name, pkg) => {
    await renderSheet(pkg);
    expect(screen.queryByRole('button', { name: label('disable') })).toBeNull();
    expect(screen.queryByRole('button', { name: label('enable') })).toBeNull();
    expect(screen.getByTestId('pkg-detail-readonly-reason')).toHaveTextContent(label('readOnly'));
  });

  it('(5) the verdict decides, not manifest.type: a non-module row served disableable offers Disable', async () => {
    await renderSheet(moduleRow({ type: 'app' }));
    expect(screen.getByRole('button', { name: label('disable') })).toBeInTheDocument();
    expect(offered(OTHER_WRITES)).toEqual([]);
  });
});

describe('Installed Apps view — a marketplace suite\'s module row (objectstack#28118)', () => {
  const APP_ROW: InstalledPackageRow = {
    manifest: { id: 'com.acme.suite', name: 'Acme Suite', version: '1.0.0', type: 'app' },
    enabled: true,
    source: 'marketplace',
    writable: false,
    disableable: false,
  };

  async function renderInstalledApps() {
    resetRuntimeConfigForTesting();
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
    await initRuntimeConfig();
    stubWire([APP_ROW, moduleRow()]);
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <MemoryRouter initialEntries={['/apps/setup/component/developer/packages?source=marketplace']}>
          <PackagesPage />
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  it('lists the module as its own row, and its sheet offers Disable', async () => {
    await renderInstalledApps();
    fireEvent.click(await screen.findByTestId(`pkg-row-${MODULE_ID}`));
    expect(await screen.findByRole('button', { name: label('disable') })).toBeInTheDocument();
    expect(offered(OTHER_WRITES)).toEqual([]);
  });

  it('CONTROL: the suite\'s app row, served disableable: false, offers no Disable', async () => {
    await renderInstalledApps();
    fireEvent.click(await screen.findByTestId('pkg-row-com.acme.suite'));
    await screen.findByTestId('pkg-scope');
    await settle();
    expect(screen.queryByRole('button', { name: label('disable') })).toBeNull();
  });
});
