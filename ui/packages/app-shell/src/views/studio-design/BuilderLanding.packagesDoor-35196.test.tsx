// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35196 — the served Studio's door to package management.
 *
 * Ruling 甲 (objectstack#25098) puts the unfiltered package list in Studio
 * only. The `@objectstack/studio` app whose Overview → Packages entry names it
 * is not default-loaded, so on a default boot the Studio is the console's own,
 * at `/studio`, and its landing is the door: each package card carries Manage,
 * which opens the package's detail sheet (the one the top-bar switcher's
 * "Package info & settings" opens), and the title row links to the unfiltered
 * Packages page.
 *
 * Read off the real `BuilderLanding` and the real `PackageDetailSheet`. The
 * sheet's Disable is the served `disableable` verdict and its Enable follows a
 * disabled record, so the cases hold one package of each kind, with a
 * read-only package the server does not let be disabled as the control.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

/** A code-loaded module of an installed app: the server serves `disableable: true`. */
const MODULE = { id: 'com.example.multi.orders', name: 'Multi-Package Orders' };
/** A code-loaded app: read-only, and the disable door refuses it. */
const APP = { id: 'com.example.multi.core', name: 'Multi-Package Core' };
/** A module already switched off. */
const DISABLED = { id: 'com.example.multi.extras', name: 'Multi-Package Extras' };
/** The author's own writable base. */
const OWN = { id: 'com.acme.mine', name: 'My App' };

const entries = [
  { ...MODULE, writable: false, namespace: 'crm' },
  { ...APP, writable: false, namespace: 'crm' },
  { ...DISABLED, writable: false, namespace: 'crm' },
  { ...OWN, writable: true, namespace: 'mine' },
];

/** `GET /api/v1/packages` as the wire serves it: the full rows the sheet opens on. */
const servedRows = [
  { manifest: { ...MODULE, version: '1.0.0', type: 'module' }, source: 'code', writable: false, disableable: true, enabled: true, status: 'installed' },
  { manifest: { ...APP, version: '1.0.0', type: 'app' }, source: 'code', writable: false, disableable: false, enabled: true, status: 'installed' },
  { manifest: { ...DISABLED, version: '1.0.0', type: 'module' }, source: 'code', writable: false, disableable: true, enabled: false, status: 'disabled' },
  { manifest: { ...OWN, version: '0.1.0', type: 'app' }, source: 'authored', writable: true, disableable: true, enabled: true, status: 'installed' },
];

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => entries),
    fetchListedPackageIds: vi.fn(async () => new Set(entries.map((e) => e.id))),
  };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding, STUDIO_ALL_PACKAGES_PATH } from './BuilderLanding';

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

async function renderLanding() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/v1\/packages(\?|$)/.test(url)) return json({ success: true, data: { packages: servedRows } });
      if (url.includes('/api/v1/meta/_drafts')) return json({ drafts: [] });
      return json({ features: { installLocal: false, marketplace: false } });
    }),
  );
  await initRuntimeConfig();
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText(MODULE.name);
}

/** The card for `id`, and its Manage button. */
function manageOn(id: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-package-id="${id}"]`);
  if (!card) throw new Error(`no card for ${id}`);
  return within(card).getByTestId('studio-landing-manage');
}

/** Opens `id`'s sheet from its card and answers the sheet's action names. */
async function openSheet(id: string, name: string): Promise<string[]> {
  fireEvent.click(manageOn(id));
  const sheet = await screen.findByRole('dialog');
  await within(sheet).findByText(name);
  return within(sheet)
    .getAllByRole('button')
    .map((b) => (b.textContent ?? '').trim())
    .filter(Boolean);
}

describe('the Studio landing is the served door to package management (objectstack#35196)', () => {
  it('a code-loaded module the server lets be disabled opens a sheet with Disable', async () => {
    await renderLanding();
    expect(await openSheet(MODULE.id, MODULE.name)).toContain('Disable');
  });

  it('control: a read-only app the disable door refuses opens a sheet without Disable', async () => {
    await renderLanding();
    const actions = await openSheet(APP.id, APP.name);
    expect(actions).not.toContain('Disable');
    expect(actions).not.toContain('Enable');
  });

  it('a disabled package opens a sheet with Enable, so switching it back on stays one click from the landing', async () => {
    await renderLanding();
    const actions = await openSheet(DISABLED.id, DISABLED.name);
    expect(actions).toContain('Enable');
    expect(actions).not.toContain('Disable');
  });

  it("every card carries Manage, the author's own apps included", async () => {
    await renderLanding();
    for (const { id } of entries) expect(manageOn(id)).toBeInTheDocument();
    expect(await openSheet(OWN.id, OWN.name)).toContain('Disable');
  });

  it('the title row links to the unfiltered Packages page', async () => {
    await renderLanding();
    const link = screen.getByTestId('studio-landing-all-packages');
    expect(link).toHaveAttribute('href', '/apps/setup/component/developer/packages');
    expect(STUDIO_ALL_PACKAGES_PATH).toBe('/apps/setup/component/developer/packages');
    // Unfiltered: no `source` query narrows it to the marketplace view.
    expect(link.getAttribute('href')).not.toContain('source=');
  });
});
