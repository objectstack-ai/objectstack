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
 *  - objectstack#36905 — a read-only base's list offers "New similar" on the
 *    base's own rows (not on its pair's), the copy opens at its metadata
 *    address in the package the clone door names, an answer naming no
 *    package opens nothing and says so; a writable package offers none.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic `import('@objectstack/lint')`; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
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

/** Sets a case adds to the served list (a base's pair's, for "New similar"), emptied after each case. */
const EXTRA_SETS: Array<Record<string, unknown>> = [];

const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [
          { manifest: { id: OTHER, scope: 'project', name: 'HR' } },
          { manifest: { id: PROJECT, scope: 'project', name: 'CRM' } },
        ]
      : type === 'permission'
        ? [...PERMISSION_SETS, ...EXTRA_SETS]
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
import { t, tFormat } from './i18n';

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
  vi.restoreAllMocks();
  EXTRA_SETS.length = 0;
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
  // By its test id: a read-only base's row offers "New similar" (objectstack#36905), which is no
  // create, and a label query would match it.
  const createButton = () => screen.queryByTestId('metadata-list-create');

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

/**
 * objectstack#36905 (card item 2) — "New similar" on the rows of a read-only
 * base's list of sets: the row action the Access pillar's rail had, on the
 * REAL list page, over the REAL clone dialog and clone door (`fetch`).
 */
describe('"New similar" on a read-only base\'s rows (objectstack#36905)', () => {
  const PAIR = `${PROJECT}.custom`;
  const LIST_URL = `/studio/${PROJECT}/metadata/permission?package=${PROJECT}`;
  const newSimilar = (name: string) => screen.queryByTestId(`list-new-similar-${name}`);

  /** The clone door answers `data`; every other read answers as the harness does. */
  function serveClone(data: Record<string, unknown>) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        if (String(url).includes('/security/permission-sets/')) {
          calls.push(String(url));
          return json(200, { success: true, data });
        }
        if (String(url).startsWith('/api/v1/data/sys_metadata_activation')) {
          return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
        }
        return json(404, { success: false });
      }),
    );
    return calls;
  }

  async function openBaseList() {
    EXTRA_SETS.push({ name: 'crm_rep_copy', label: 'CRM Rep copy', _packageId: PAIR, _provenance: 'package' });
    const view = mount(crmArea(true), LIST_URL, <MetadataResourceListPage type="permission" />);
    await waitFor(() => expect(rowLink(view.container, 'crm_rep')).not.toBeNull());
    await waitFor(() => expect(rowLink(view.container, 'crm_rep_copy')).not.toBeNull());
    return view;
  }

  async function copyFrom(name: string) {
    fireEvent.click(newSimilar(name)!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('perm.clone.name', 'en-US')), { target: { value: 'my_rep' } });
    fireEvent.change(within(dialog).getByLabelText(t('perm.clone.label', 'en-US')), { target: { value: 'My rep' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('perm.clone.confirm', 'en-US') }));
  }

  const rowLink = (container: HTMLElement, name: string) => container.querySelector<HTMLAnchorElement>(`a[href*="/${name}?"]`);

  it("the base's own row offers it; its pair's row does not", async () => {
    serveClone({});
    await openBaseList();
    expect(newSimilar('crm_rep')).toBeInTheDocument();
    expect(newSimilar('crm_rep_copy')).toBeNull();
  });

  it('the copy opens at its metadata address in the package the clone door names', async () => {
    const calls = serveClone({ permissionSet: { name: 'my_rep', label: 'My rep' }, package: PAIR, notice: 'Saved.' });
    await openBaseList();
    await copyFrom('crm_rep');
    await waitFor(() =>
      expect(where()).toBe(`/studio/${PAIR}/metadata/permission/my_rep?package=${encodeURIComponent(PAIR)}`),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/security/permission-sets/crm_rep/clone');
  });

  it('an answer naming no package opens nothing and says so', async () => {
    const warning = vi.spyOn(toast, 'warning');
    serveClone({ permissionSet: { name: 'my_rep', label: 'My rep' }, notice: 'Saved.' });
    await openBaseList();
    await copyFrom('crm_rep');
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        tFormat('engine.studio.access.newSimilar.noPackage', 'en-US', { name: 'my_rep' }),
        expect.anything(),
      ),
    );
    expect(where()).toBe(LIST_URL);
  });

  it('CONTROL: a writable package offers no New similar, and offers create', async () => {
    serveClone({});
    const { container } = mount(crmArea(), LIST_URL, <MetadataResourceListPage type="permission" />);
    await waitFor(() => expect(rowLink(container, 'crm_rep')).not.toBeNull());
    expect(newSimilar('crm_rep')).toBeNull();
    expect(screen.getByTestId('metadata-list-create')).toBeInTheDocument();
  });
});
