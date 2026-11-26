// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36908 (epic #36890 decision 9) — bare `/studio` draws no page.
 * It opens the package the author was last in, still named by the package
 * list; otherwise the package list: Setup → Packages for a principal who may
 * open it, the "All metadata" area across packages for one who may only enter
 * Studio. The retired `/studio?new=package` bookmark lands on Setup's New
 * Package for the first, and on that same "All metadata" area for the second.
 *
 * The recent store and the list read are stubbed at their modules: what is
 * measured is where the entry SENDS the author, read off the router's
 * location.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const recent = vi.hoisted(() => ({ items: [] as Array<{ type: string; name: string }> }));
const listed = vi.hoisted(() => ({ read: async (): Promise<ReadonlySet<string>> => new Set<string>() }));

vi.mock('../../context/RecentItemsProvider.js', () => ({
  useRecentItems: () => ({ recentItems: recent.items }),
}));
vi.mock('./packages-io.js', () => ({
  fetchListedPackageIds: () => listed.read(),
}));

import { StudioEntryRedirect } from './StudioEntryRedirect';
import { newPackageDoorPath, studioEntryFallbackPath, studioNewPackageEntryPath } from './studioEntryPermissions';

const SETUP_PACKAGES = '/apps/setup/component/developer/packages?face=admin';
const ALL_METADATA = '/studio/~all/metadata';
const ADMIN = ['studio.access', 'setup.access', 'manage_platform_settings'];
/** May enter Studio and author metadata; holds neither capability Setup → Packages is shown under. */
const STUDIO_ONLY = ['studio.access', 'manage_metadata'];

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function renderEntry(url = '/studio', systemPermissions: string[] | undefined = ADMIN) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/studio"
          element={<StudioEntryRedirect systemPermissions={systemPermissions} pending={<div data-testid="pending" />} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pkg = (name: string) => ({ type: 'package', name });

afterEach(() => {
  cleanup();
  recent.items = [];
  listed.read = async () => new Set<string>();
});

describe("Studio's entry: the package last opened (objectstack#36908)", () => {
  it('opens the newest remembered package the list still names', async () => {
    recent.items = [{ type: 'object', name: 'account' }, pkg('com.acme.crm'), pkg('com.acme.hr')];
    listed.read = async () => new Set(['com.acme.crm', 'com.acme.hr']);
    renderEntry();
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/studio\/com\.acme\.crm$/);
  });

  it('passes over a remembered package the list no longer names', async () => {
    recent.items = [pkg('com.acme.gone'), pkg('com.acme.hr')];
    listed.read = async () => new Set(['com.acme.hr']);
    renderEntry();
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/studio\/com\.acme\.hr$/);
  });

  it('with no remembered package the list names, lands on the package list', async () => {
    recent.items = [pkg('com.acme.gone')];
    listed.read = async () => new Set(['com.acme.hr']);
    renderEntry();
    expect(await screen.findByTestId('where')).toHaveTextContent(SETUP_PACKAGES);
  });

  it('draws the pending element while the list is read, never a page of its own', async () => {
    recent.items = [pkg('com.acme.crm')];
    let answer!: (ids: ReadonlySet<string>) => void;
    listed.read = () => new Promise((resolve) => (answer = resolve));
    renderEntry();
    expect(screen.getByTestId('pending')).toBeInTheDocument();
    answer(new Set(['com.acme.crm']));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/studio\/com\.acme\.crm$/);
  });

  it('when the list cannot be read, opens the newest remembered package (Studio reports the read)', async () => {
    recent.items = [pkg('com.acme.crm'), pkg('com.acme.hr')];
    listed.read = async () => {
      throw new Error('503');
    };
    renderEntry();
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/studio\/com\.acme\.crm$/);
  });
});

describe("Studio's entry: the package list (objectstack#36908)", () => {
  it('with nothing remembered, an administrator lands on Setup → Packages without reading the list', async () => {
    const read = vi.fn(async () => new Set<string>());
    listed.read = read;
    renderEntry();
    expect(await screen.findByTestId('where')).toHaveTextContent(SETUP_PACKAGES);
    expect(read).not.toHaveBeenCalled();
  });

  it('a principal who may enter Studio but not Setup → Packages lands on the "All metadata" area', async () => {
    renderEntry('/studio', ['studio.access', 'setup.access']);
    expect(await screen.findByTestId('where')).toHaveTextContent(ALL_METADATA);
  });

  it('the fallback reads the two capabilities Setup → Packages is shown under, and holds nothing for no answer', () => {
    expect(studioEntryFallbackPath(ADMIN)).toBe(SETUP_PACKAGES);
    expect(studioEntryFallbackPath(['studio.access', 'manage_platform_settings'])).toBe(ALL_METADATA);
    expect(studioEntryFallbackPath(['studio.access', 'setup.access'])).toBe(ALL_METADATA);
    expect(studioEntryFallbackPath(undefined)).toBe(ALL_METADATA);
  });
});

describe('the retired `/studio?new=package` bookmark (objectstack#36908)', () => {
  it("CONTROL — an administrator lands on Setup's New Package, whatever is remembered", async () => {
    recent.items = [pkg('com.acme.crm')];
    listed.read = async () => new Set(['com.acme.crm']);
    renderEntry('/studio?new=package');
    expect(await screen.findByTestId('where')).toHaveTextContent(`${SETUP_PACKAGES}&new=package`);
  });

  it('a principal who may enter Studio but not Setup → Packages is never sent to Setup: the "All metadata" area', async () => {
    recent.items = [pkg('com.acme.crm')];
    listed.read = async () => new Set(['com.acme.crm']);
    renderEntry('/studio?new=package', STUDIO_ONLY);
    const where = await screen.findByTestId('where');
    expect(where).toHaveTextContent(new RegExp(`^${ALL_METADATA}$`));
    expect(where.textContent).not.toContain('/apps/setup');
  });

  it('the forward reads the same two capabilities as the fallback, and holds nothing for no answer', () => {
    expect(studioNewPackageEntryPath(ADMIN)).toBe(`${SETUP_PACKAGES}&new=package`);
    expect(studioNewPackageEntryPath(['studio.access', 'manage_platform_settings'])).toBe(ALL_METADATA);
    expect(studioNewPackageEntryPath(['studio.access', 'setup.access'])).toBe(ALL_METADATA);
    expect(studioNewPackageEntryPath(undefined)).toBe(ALL_METADATA);
  });

  it('the console doors outside Studio (Home, /ai, 「Add app」) make the same choice from the session\'s own answer', () => {
    expect(newPackageDoorPath(true)).toBe(`${SETUP_PACKAGES}&new=package`);
    expect(newPackageDoorPath(false)).toBe(ALL_METADATA);
  });
});
