// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Packages' Scope badge reads the server's `writable` verdict
 * (objectui#12723).
 *
 * The writable / read-only half of the badge is the row's top-level `writable`
 * (objectstack#14375), never a guess from `scope`. A marketplace install is
 * scope-less and served `writable: false`; it used to be badged Writable
 * because every scope-less row was assumed to be an authored base. `scope`
 * still names which kind of read-only package a row is (system / cloud /
 * project). A row with no verdict is refused at load, so no badge is drawn —
 * under its own name since objectui#12790, when the Source column stopped
 * reading `writable` and started reading the row's served `source`.
 *
 * The wire is stubbed (`fetch`); the runtime config is the real module booted
 * over a served body, with the install-local marketplace on so the Source
 * column can name the marketplace row beside its Scope badge.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
import type { PackageSource } from './packageSource';
import { t, tFormat } from './i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

// A row as objectstack serves it since objectstack#24010: `source` (the door
// that registered it) beside `writable` (what an org may do to it).
const row = (
  id: string,
  writable: boolean,
  source: PackageSource,
  scope?: 'system' | 'cloud' | 'project',
): InstalledPackageRow => ({
  manifest: { id, name: id, version: '1.0.0', ...(scope ? { scope } : {}) },
  enabled: true,
  source,
  writable,
});

// The marketplace-install row shape objectui#12675's tests pin: scope-less,
// served `writable: false` and `source: 'marketplace'`, and listed by the
// install-local ledger.
const MARKET = row('com.example.todo', false, 'marketplace');
const AUTHORED = row('app.b2r4', true, 'authored');
const SCOPELESS_CODE = row('com.acme.bare', false, 'code');
const SYSTEM = row('com.objectstack.system', false, 'code', 'system');
const CLOUD = row('com.objectstack.cloud', false, 'code', 'cloud');
const PROJECT_CODE = row('com.acme.code', false, 'code', 'project');
const PROJECT_BASE = row('com.acme.base', true, 'authored', 'project');

const LEDGER_TODO = {
  packageId: 'com.example.todo',
  versionId: 'ver_todo_1',
  manifestId: 'com.example.todo',
  version: '1.0.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  withSampleData: false,
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function serve(packages: unknown[]) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages } });
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: [LEDGER_TODO] } });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

function renderPackages() {
  return render(
    <MemoryRouter initialEntries={['/apps/setup/component/developer/packages']}>
      <PackagesPage />
    </MemoryRouter>,
  );
}

/** The Scope badge text each drawn row carries, keyed by package id. */
async function drawnScopes(): Promise<Record<string, string>> {
  await screen.findAllByTestId('pkg-scope');
  const out: Record<string, string> = {};
  for (const r of screen.getAllByTestId(/^pkg-row-(?!uninstall|details)/)) {
    const id = r.getAttribute('data-testid')!.slice('pkg-row-'.length);
    // A ledger install the runtime did not load has no registry row: '—'.
    out[id] = within(r).queryByTestId('pkg-scope')?.textContent ?? '—';
  }
  return out;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Packages Scope badge reads the served `writable` verdict (objectui#12723)', () => {
  it('a scope-less marketplace install (`writable: false`) is badged Read-only, never Writable', async () => {
    await serve([MARKET]);
    renderPackages();
    const r = await screen.findByTestId('pkg-row-com.example.todo');
    expect(within(r).getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.readOnly', 'en'));
    expect(within(r).getByTestId('pkg-scope')).not.toHaveTextContent(t('engine.packages.scope.writable', 'en'));
    // H5: no row reads Source "Marketplace" beside Scope "Writable".
    expect(within(r).getByTestId('pkg-source').getAttribute('data-source')).toBe('marketplace');
  });

  it('a scope-less authored base (`writable: true`) is still badged Writable', async () => {
    await serve([AUTHORED]);
    renderPackages();
    const r = await screen.findByTestId('pkg-row-app.b2r4');
    expect(within(r).getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.writable', 'en'));
  });

  it('system, cloud and project keep their badges; the writable half follows the verdict', async () => {
    await serve([SCOPELESS_CODE, SYSTEM, CLOUD, PROJECT_CODE, PROJECT_BASE]);
    renderPackages();
    // system / cloud rows sit behind the page's show-kernel switch.
    await screen.findByTestId('pkg-row-com.acme.bare');
    fireEvent.click(document.getElementById('show-kernel')!);
    expect(await drawnScopes()).toEqual({
      'com.acme.bare': t('engine.packages.scope.readOnly', 'en'),
      'com.objectstack.system': t('engine.packages.scope.system', 'en'),
      'com.objectstack.cloud': t('engine.packages.scope.cloud', 'en'),
      'com.acme.code': t('engine.packages.scope.project', 'en'),
      // A project-scoped DB base the server marks writable is not "Read-only · code".
      'com.acme.base': t('engine.packages.scope.writable', 'en'),
      'com.example.todo': '—',
    });
  });

  it('a row with no `writable` verdict is refused at load under its own name; no Scope badge is drawn for it', async () => {
    // Its `source` is served, so this refusal is the verdict's own, never a
    // Source refusal (objectui#12790: `writable` is not a Source signal).
    const { writable: _absent, ...noVerdict } = row('com.acme.unknown', false, 'code');
    await serve([noVerdict]);
    renderPackages();
    const refusal = await screen.findByTestId('packages-load-error');
    expect(refusal).toHaveTextContent(tFormat('engine.packages.scope.unknown', 'en', { id: 'com.acme.unknown' }));
    expect(refusal).not.toHaveTextContent(tFormat('engine.packages.source.unknown', 'en', { id: 'com.acme.unknown' }));
    expect(screen.queryByTestId('pkg-scope')).toBeNull();
    expect(screen.queryByTestId('pkg-row-com.acme.unknown')).toBeNull();
  });

  it('the detail sheet reads the same verdict as the list row', async () => {
    await serve([MARKET]);
    renderPackages();
    fireEvent.click(await screen.findByTestId('pkg-row-com.example.todo'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.readOnly', 'en'));
  });
});
