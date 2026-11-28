// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38206 — the Setup access directory reads its own sub-path on
 * every address the shell serves it at. The shell serves Setup at its package
 * id (`/apps/com.objectstack.setup/...`), not at the `setup` alias the page's
 * constant spells; a prefix read on the alias left the sub-path empty there,
 * so Positions → New rendered a blank page instead of opening the editor.
 *
 * At both addresses:
 *  1. A create (`position/new`) opens in Studio, on the environment scope's
 *     editor.
 *  2. A type's list outside the environment scope gets it, and the list renders.
 *     The scoped address is spelled at the `setup` alias, as
 *     `accessDirectoryLocation` spells it (kept as is); the shell serves the
 *     alias at the package id.
 *
 * The metadata-admin pages are stubs; the gate is `usePermissions`' answer, stubbed.
 */

import '@testing-library/jest-dom/vitest';
// The page's source reach loads this lazily; pay that load during collection (check:test-source-alias).
import '@objectstack/lint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

function PageStub({ page }: { page: string }) {
  const { type } = useParams();
  return <div data-testid="area-page" data-page={page} data-type={type ?? ''} />;
}

vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <PageStub page="directory" />,
  MetadataResourceListPage: () => <PageStub page="list" />,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({
    systemPermissions: ['studio.access'],
    hasCapabilities: () => true,
  }),
}));

import { AccessDirectoryPage } from './AccessDirectoryPage';

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

afterEach(() => cleanup());

const SETUP = '/apps/setup/component/security/access-directory';

const ADDRESSES = [
  ['the package-id address the shell serves', '/apps/com.objectstack.setup/component/security/access-directory'],
  ['the setup alias', SETUP],
] as const;

describe.each(ADDRESSES)('at %s (objectstack#38206)', (_label, base) => {
  it('a create opens in Studio, on the environment scope\'s editor', async () => {
    mount(`${base}/position/new?scope=environment`);
    expect(await screen.findByTestId('studio')).toBeInTheDocument();
    expect(where()).toBe('/studio/~all/metadata/position/new?scope=environment');
  });

  it('a list outside the environment scope gets it, and the list renders', async () => {
    mount(`${base}/position`);
    const el = await screen.findByTestId('area-page');
    expect(el.getAttribute('data-page')).toBe('list');
    expect(el.getAttribute('data-type')).toBe('position');
    expect(where()).toBe(`${SETUP}/position?scope=environment`);
  });
});
