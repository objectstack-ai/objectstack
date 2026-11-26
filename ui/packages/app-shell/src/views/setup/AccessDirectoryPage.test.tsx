// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37565 — Setup → Access control → Positions and permissions, the
 * environment directory moved out of Studio (ADR-0084, amended 2026-11-26):
 *
 *  1. Behind Studio's entry capability (`studio.access`): without it the page
 *     reads nothing and says what it needs. CONTROL: with it, the directory.
 *  2. The page mounts the metadata-admin directory and a type's list under the
 *     cross-package leg's host shape (no package, writable), rooted at the page.
 *  3. A list outside the environment scope gets it; an item, a create and a
 *     history open in Studio, on the environment scope's editor.
 *
 * The metadata-admin pages are stubs printing the host they read; the gate is
 * `usePermissions`' answer, stubbed.
 */

import '@testing-library/jest-dom/vitest';
// The page's source reach loads this lazily; pay that load during collection (check:test-source-alias).
import '@objectstack/lint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useMetadataAreaHost } from '../metadata-admin/metadataAreaHost';

function PageStub({ page }: { page: string }) {
  const host = useMetadataAreaHost();
  const { type } = useParams();
  return <div data-testid="area-page" data-page={page} data-type={type ?? ''} data-host={JSON.stringify(host)} />;
}

vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <PageStub page="directory" />,
  MetadataResourceListPage: () => <PageStub page="list" />,
}));

const held = vi.hoisted(() => ({ capabilities: new Set<string>(['studio.access']) }));
vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ hasCapabilities: (caps: string[]) => caps.every((c) => held.capabilities.has(c)) }),
}));

import { AccessDirectoryPage } from './AccessDirectoryPage';

const SETUP = '/apps/setup/component/security/access-directory';

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/apps/:appName/component/:ns/:name/*" element={<AccessDirectoryPage />} />
        <Route path="/studio/*" element={<div data-testid="studio" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
async function page() {
  const el = await screen.findByTestId('area-page');
  return { page: el.getAttribute('data-page'), type: el.getAttribute('data-type'), host: JSON.parse(el.getAttribute('data-host')!) };
}

afterEach(() => {
  cleanup();
  held.capabilities = new Set(['studio.access']);
});

describe('the gate: Studio\'s entry capability (objectstack#37565)', () => {
  it('without studio.access the page reads nothing and names the capability', () => {
    held.capabilities = new Set(['setup.access', 'manage_platform_settings']);
    mount(SETUP);
    expect(screen.getByTestId('access-directory-not-allowed')).toHaveTextContent('studio.access');
    expect(screen.queryByTestId('area-page')).toBeNull();
  });

  it('CONTROL — with it, the directory', async () => {
    mount(SETUP);
    expect((await page()).page).toBe('directory');
    expect(screen.queryByTestId('access-directory-not-allowed')).toBeNull();
  });
});

describe('the pages it mounts (objectstack#37565)', () => {
  const HOST = { packageId: null, readOnly: false, basePath: SETUP };

  it('the directory, on the cross-package leg\'s host shape, rooted at the page', async () => {
    mount(SETUP);
    expect(await page()).toEqual({ page: 'directory', type: '', host: HOST });
    expect(where()).toBe(SETUP);
  });

  it.each(['permission', 'position', 'capability', 'sharing_rule'])('a type\'s list in the environment scope: %s', async (type) => {
    mount(`${SETUP}/${type}?scope=environment`);
    expect(await page()).toEqual({ page: 'list', type, host: HOST });
    expect(where()).toBe(`${SETUP}/${type}?scope=environment`);
  });

  it('a list outside the environment scope gets it, and drops the package', async () => {
    mount(`${SETUP}/permission?package=crm`);
    expect(await page()).toMatchObject({ page: 'list', type: 'permission' });
    expect(where()).toBe(`${SETUP}/permission?scope=environment`);
  });

  it.each([
    [`${SETUP}/permission/admin?scope=environment`, '/studio/~all/metadata/permission/admin?scope=environment'],
    [`${SETUP}/permission/new?scope=environment`, '/studio/~all/metadata/permission/new?scope=environment'],
    [`${SETUP}/position/manager/history?scope=environment`, '/studio/~all/metadata/position/manager/history?scope=environment'],
    [`${SETUP}/flow`, '/studio/~all/metadata/flow'],
  ])('%s opens in Studio, in one hop: %s', async (from, to) => {
    mount(from);
    expect(await screen.findByTestId('studio')).toBeInTheDocument();
    expect(where()).toBe(to);
    expect(screen.queryByTestId('area-page')).toBeNull();
  });
});
