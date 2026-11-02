// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29566 — Studio's cross-package list (`/studio/~all/metadata/<type>`)
 * opens and stays open, through the area's real routes and the real list page.
 *
 * The list used to repair `?package=` whenever the area named no package, so
 * the cross-package leg became `?package=<first>` and the area then moved it
 * onto that package's leg (`areaLocationRedirect`). The list of a type across
 * packages could not be opened, with or without `?package=all`, which is where
 * every package-less Setup metadata URL and the Packaged automation bookmark
 * land (`setupMetadataRedirect.ts`).
 *
 * Controls: a package's area keeps its leg and lists that package's rows, and
 * Setup's list (no area) still repairs `?package=` to a project package.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PROJECT = 'com.example.crm';
const OTHER = 'com.example.hr';
const PLATFORM = 'com.objectstack.plugin-security';

/** Rows of two project packages, a platform package, and one that belongs to no package. */
const ROWS: Record<string, Array<Record<string, unknown>>> = {
  object: [
    { name: 'crm_account', label: 'Account', _packageId: PROJECT },
    { name: 'hr_employee', label: 'Employee', _packageId: OTHER },
    { name: 'sys_user', label: 'User', _packageId: PLATFORM },
    { name: 'env_note', label: 'Note' },
  ],
  flow: [
    { name: 'crm_followup', label: 'Follow up', _packageId: PROJECT },
    { name: 'hr_onboard', label: 'Onboard', _packageId: OTHER },
  ],
};

const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [
          { manifest: { id: OTHER, scope: 'project', name: 'HR' } },
          { manifest: { id: PROJECT, scope: 'project', name: 'CRM' } },
          { manifest: { id: PLATFORM, scope: 'system', name: 'Security' } },
        ]
      : (ROWS[type] ?? []),
};

const entry = (type: string, domain: string) => ({
  type,
  label: type,
  domain,
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [entry('object', 'data'), entry('flow', 'automation')] }),
}));
vi.mock('../metadata-admin/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));
/** `GET /api/v1/packages` as the area's writable probe reads it. */
vi.mock('./packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(
    async () =>
      new Map([
        [PROJECT, { id: PROJECT, name: 'CRM', writable: true, manifest: {} }],
        [OTHER, { id: OTHER, name: 'HR', writable: true, manifest: {} }],
      ]),
  ),
}));

import { StudioMetadataArea } from './StudioMetadataArea';
import { MetadataResourceListPage } from '../metadata-admin/ResourceListPage';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

// A package's list reads its customizations (`usePackageCustomizations`); this
// file pins scope, not marks, so that read answers 404 (no mark is drawn).
// One double at module scope, left up, so no late read reaches a socket.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'Content-Type': 'application/json' } })),
);

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function PackageArea() {
  const { pathname } = useLocation();
  const packageId = decodeURIComponent(pathname.split('/')[2] ?? '');
  return <StudioMetadataArea key={packageId} packageId={packageId} />;
}

/** The console's two area routes, plus Setup's list route with no area around it. */
function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/studio/~all/metadata/*" element={<StudioMetadataArea packageId={null} />} />
        <Route path="/studio/:packageId/metadata/*" element={<PackageArea />} />
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';
const row = (name: string) => screen.queryByTestId(`metadata-row-${name}`);
const rowHref = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLAnchorElement>(`a[href*="/${name}"]`)?.getAttribute('href') ?? null;
const WAIT = { timeout: 10_000 };

describe('the cross-package list stays open (objectstack#29566)', () => {
  for (const query of ['', '?package=all']) {
    it(`/studio/~all/metadata/object${query} lists every package's rows and keeps its URL`, async () => {
      const { container } = mount(`/studio/~all/metadata/object${query}`);
      await waitFor(() => expect(row('crm_account')).not.toBeNull(), WAIT);
      for (const name of ['hr_employee', 'sys_user', 'env_note']) expect(row(name)).not.toBeNull();
      // Each row opens its owning package; a package-less row opens by name.
      expect(rowHref(container, 'crm_account')).toBe(`/studio/~all/metadata/object/crm_account?package=${PROJECT}`);
      expect(rowHref(container, 'hr_employee')).toBe(`/studio/~all/metadata/object/hr_employee?package=${OTHER}`);
      expect(rowHref(container, 'env_note')).toBe('/studio/~all/metadata/object/env_note');
      // Every load has settled (the package list, the rows); nothing rewrote the URL.
      await new Promise((r) => setTimeout(r, 50));
      expect(where()).toBe(`/studio/~all/metadata/object${query}`);
    });
  }

  it('the Packaged automation landing, /studio/~all/metadata/flow, lists the flows of every package', async () => {
    mount('/studio/~all/metadata/flow');
    await waitFor(() => expect(row('crm_followup')).not.toBeNull(), WAIT);
    expect(row('hr_onboard')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(where()).toBe('/studio/~all/metadata/flow');
  });

  it('create alone picks a package, and opens that package\'s create', async () => {
    mount('/studio/~all/metadata/object');
    await waitFor(() => expect(row('crm_account')).not.toBeNull(), WAIT);
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(t('engine.list.create', 'en-US')) })[0]);
    await waitFor(() => expect(where()).toBe(`/studio/${PROJECT}/metadata/object/new?package=${PROJECT}`), WAIT);
  });
});

describe('controls: a package area and Setup keep their scope', () => {
  it('a package\'s area keeps its leg and lists its own rows', async () => {
    mount(`/studio/${PROJECT}/metadata/object?package=${PROJECT}`);
    await waitFor(() => expect(row('crm_account')).not.toBeNull(), WAIT);
    expect(row('hr_employee')).toBeNull();
    expect(row('sys_user')).toBeNull();
    expect(row('env_note')).toBeNull();
    expect(where()).toBe(`/studio/${PROJECT}/metadata/object?package=${PROJECT}`);
  });

  it('Setup\'s list (no area) still repairs `?package=` onto a project package', async () => {
    mount('/apps/setup/metadata/object');
    await waitFor(() => expect(where()).toBe(`/apps/setup/metadata/object?package=${PROJECT}`), WAIT);
    await waitFor(() => expect(row('crm_account')).not.toBeNull(), WAIT);
    expect(row('hr_employee')).toBeNull();
    expect(row('sys_user')).toBeNull();
  });
});
