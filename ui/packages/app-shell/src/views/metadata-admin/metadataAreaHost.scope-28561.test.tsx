// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — the directory and the list under Studio's "All metadata"
 * area (ADR-0146 D1), each against the same page with no area around it,
 * which is Setup's rendering and must not move.
 *
 *  - A package's area is scoped to that package: the pages neither pick nor
 *    repair a `?package=` of their own, and a read-only package offers no
 *    create.
 *  - The cross-package leg lists the environment catalog, each type opened in
 *    the environment scope, and its permission list is the registry's whole
 *    list, as Setup's catalog is.
 *  - The datasource tile opens Setup's Datasources page.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`'s dynamic import of this exact
// specifier (see `ResourceListPage.environmentScope-7611.test.tsx`).
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const PROJECT = 'com.example.crm';
const OTHER = 'com.example.hr';
const PLATFORM = 'com.objectstack.plugin-security';

const PERMISSION_SETS = [
  { name: 'admin_full_access', label: 'Administrator', _packageId: PLATFORM, _provenance: 'package' },
  { name: 'crm_rep', label: 'CRM Rep', _packageId: PROJECT, _provenance: 'package' },
  { name: 'hr_rep', label: 'HR Rep', _packageId: OTHER, _provenance: 'package' },
  { name: 'env_authored_set', label: 'Environment Set' },
];

const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [
          { manifest: { id: OTHER, scope: 'project', name: 'HR' } },
          { manifest: { id: PROJECT, scope: 'project', name: 'CRM' } },
        ]
      : type === 'permission'
        ? PERMISSION_SETS
        : [],
};

const entry = (type: string, domain: string, write = true) => ({
  type,
  label: type,
  domain,
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: write,
});
const ENTRIES = [
  entry('object', 'data'),
  entry('flow', 'automation'),
  entry('translation', 'ui'),
  entry('datasource', 'system'),
  entry('permission', 'security'),
  entry('position', 'security'),
  entry('sharing_rule', 'security'),
  entry('capability', 'security', false),
];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
  // Each package contributes every type; the cross-package sweep sees them all.
  useGlobalDiagnostics: () => ({
    loading: false,
    error: null,
    summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
    byType: {},
    warnByType: {},
    countsByType: {},
    lockedByType: {},
    packagesByType: Object.fromEntries(ENTRIES.map((e) => [e.type, [OTHER, PROJECT]])),
    allPackages: [OTHER, PROJECT],
    reload: () => {},
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataDirectoryPage } from './DirectoryPage';
import { MetadataResourceListPage } from './ResourceListPage';
import { t } from './i18n';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (String(url).startsWith('/api/v1/data/sys_metadata_activation')) {
        return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
      }
      return json(404, { success: false });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const crmArea = (readOnly = false): MetadataAreaHost => ({
  packageId: PROJECT,
  readOnly,
  basePath: `/studio/${PROJECT}/metadata`,
});
const ALL_LEG: MetadataAreaHost = { packageId: null, readOnly: false, basePath: '/studio/~all/metadata' };

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

/** Mounted on its route, so the page's relative links resolve as they do in the app. */
function mount(host: MetadataAreaHost | null, url: string, node: React.ReactNode) {
  const pathname = url.split('?')[0];
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path={pathname} element={node} />
      </Routes>
    </MemoryRouter>
  );
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

/** The directory tile for one type, by the machine name it prints. */
const tile = async (type: string) =>
  (await screen.findByText(type, { selector: 'code' })).closest('a') as HTMLAnchorElement;
const where = () => screen.getByTestId('where').textContent;

describe('the directory under the area (objectstack#28561)', () => {
  it('Setup (no area) repairs `?package=` to the first project package — the control', async () => {
    mount(null, `/apps/setup/metadata?package=${OTHER}`, <MetadataDirectoryPage />);
    await tile('flow');
    // A valid `?package=` is kept; the tiles carry it, the datasource tile included.
    expect(where()).toBe(`/apps/setup/metadata?package=${OTHER}`);
    expect((await tile('datasource')).getAttribute('href')).toBe(`/apps/setup/metadata/datasource?package=${OTHER}`);
    cleanup();
    mount(null, '/apps/setup/metadata', <MetadataDirectoryPage />);
    await tile('flow');
    await waitFor(() => expect(where()).toBe(`/apps/setup/metadata?package=${PROJECT}`));
  });

  it('a package\'s area is that package\'s: no repair, every tile scoped to it', async () => {
    mount(crmArea(), `/studio/${PROJECT}/metadata?package=${PROJECT}`, <MetadataDirectoryPage />);
    expect((await tile('flow')).getAttribute('href')).toBe(`/studio/${PROJECT}/metadata/flow?package=${PROJECT}`);
    expect(where()).toBe(`/studio/${PROJECT}/metadata?package=${PROJECT}`);
    // The environment catalog types are a package's too, where it ships them.
    expect(await tile('permission')).toBeInTheDocument();
  });

  it('a package Setup\'s scope would not keep (a kernel package) stays the area\'s package', async () => {
    const kernel: MetadataAreaHost = { packageId: PLATFORM, readOnly: true, basePath: `/studio/${PLATFORM}/metadata` };
    mount(kernel, `/studio/${PLATFORM}/metadata?package=${PLATFORM}`, <MetadataDirectoryPage />);
    // Setup would repair this URL onto a project package; the area keeps its own.
    expect(await screen.findByText(t('engine.directory.noMatches', 'en-US'))).toBeInTheDocument();
    expect(where()).toBe(`/studio/${PLATFORM}/metadata?package=${PLATFORM}`);
  });

  it('the datasource tile opens Setup\'s Datasources page', async () => {
    mount(crmArea(), `/studio/${PROJECT}/metadata?package=${PROJECT}`, <MetadataDirectoryPage />);
    expect((await tile('datasource')).getAttribute('href')).toBe('/apps/setup/metadata/datasource');
  });

  it('the cross-package leg lists the environment catalog, each in the environment scope', async () => {
    mount(ALL_LEG, '/studio/~all/metadata', <MetadataDirectoryPage />);
    for (const type of ['position', 'capability', 'permission', 'sharing_rule']) {
      expect((await tile(type)).getAttribute('href')).toBe(`/studio/~all/metadata/${type}?scope=environment`);
    }
    for (const type of ['object', 'flow', 'translation', 'datasource']) {
      expect(screen.queryByText(type, { selector: 'code' })).toBeNull();
    }
    expect(where()).toBe('/studio/~all/metadata');
  });
});

describe('the list under the area', () => {
  const rowLink = (container: HTMLElement, name: string) => container.querySelector<HTMLAnchorElement>(`a[href*="/${name}"]`);
  const createButton = () => screen.queryByRole('button', { name: new RegExp(t('engine.list.create', 'en-US')) });

  it('a package\'s area lists that package\'s rows, with no repair, and offers create', async () => {
    const { container } = mount(crmArea(), `/studio/${PROJECT}/metadata/permission?package=${PROJECT}`, <MetadataResourceListPage type="permission" />);
    await waitFor(() => expect(rowLink(container, 'crm_rep')).not.toBeNull());
    expect(rowLink(container, 'hr_rep')).toBeNull();
    expect(rowLink(container, 'admin_full_access')).toBeNull();
    expect(rowLink(container, 'crm_rep')?.getAttribute('href')).toBe(
      `/studio/${PROJECT}/metadata/permission/crm_rep?package=${PROJECT}`,
    );
    expect(where()).toBe(`/studio/${PROJECT}/metadata/permission?package=${PROJECT}`);
    expect(createButton()).toBeInTheDocument();
  });

  it('a package Setup\'s scope would not keep (a kernel package) lists its own rows, unrepaired', async () => {
    const kernel: MetadataAreaHost = { packageId: PLATFORM, readOnly: true, basePath: `/studio/${PLATFORM}/metadata` };
    const { container } = mount(kernel, `/studio/${PLATFORM}/metadata/permission?package=${PLATFORM}`, <MetadataResourceListPage type="permission" />);
    await waitFor(() => expect(rowLink(container, 'admin_full_access')).not.toBeNull());
    expect(rowLink(container, 'crm_rep')).toBeNull();
    expect(where()).toBe(`/studio/${PLATFORM}/metadata/permission?package=${PLATFORM}`);
    expect(createButton()).toBeNull();
  });

  it('a read-only package offers no create', async () => {
    const { container } = mount(crmArea(true), `/studio/${PROJECT}/metadata/permission?package=${PROJECT}`, <MetadataResourceListPage type="permission" />);
    await waitFor(() => expect(rowLink(container, 'crm_rep')).not.toBeNull());
    expect(createButton()).toBeNull();
  });

  it('the cross-package leg: the environment-scope permission list is the registry\'s whole list', async () => {
    const { container } = mount(ALL_LEG, '/studio/~all/metadata/permission?scope=environment', <MetadataResourceListPage type="permission" />);
    for (const name of ['admin_full_access', 'crm_rep', 'hr_rep', 'env_authored_set']) {
      await waitFor(() => expect(rowLink(container, name)).not.toBeNull());
      expect(rowLink(container, name)?.getAttribute('href')).toBe(`/studio/~all/metadata/permission/${name}?scope=environment`);
    }
    expect(where()).toBe('/studio/~all/metadata/permission?scope=environment');
  });
});
