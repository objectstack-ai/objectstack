/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Navigation sync's rules, and the site door that applies them
 * (objectstack#28680).
 *
 * `NavigationSyncEffect` used to read the whole `page` and `dashboard` lists on
 * every app page and diff their name sets. Maintainer ruling A retired it: the
 * console's create and delete sites call `useNavigationWrites()` instead. This
 * suite pins that the effect now reads and writes nothing, and that the site
 * door keeps the diff's rules: platform artifacts (sys_ names, package
 * provenance) never write navigation, write-protected apps are skipped, draft
 * preview writes nothing, and a second create of the same page adds no second
 * entry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MetadataCtx, AdapterCtx, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';
import { useEffect } from 'react';
import {
  NavigationSyncEffect,
  useNavigationWrites,
  isSystemArtifactName,
  isPlatformArtifact,
  isNavigationSyncableApp,
  isNavigationTargetType,
  navigationReferences,
} from '../useNavigationSync';
import { __markFirstPainted } from '../sharedUserFeeds';
import { MemoryRouter } from 'react-router-dom';
import { PreviewModeProvider } from '../../preview/PreviewModeContext';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('isSystemArtifactName', () => {
  it('flags sys_-prefixed names and nothing else', () => {
    expect(isSystemArtifactName('sys_organization_detail')).toBe(true);
    expect(isSystemArtifactName('sys_user_detail')).toBe(true);
    expect(isSystemArtifactName('my_page')).toBe(false);
    expect(isSystemArtifactName('system_overview')).toBe(false); // not the sys_ prefix
    expect(isSystemArtifactName('')).toBe(false);
    expect(isSystemArtifactName(undefined)).toBe(false);
    expect(isSystemArtifactName(42)).toBe(false);
  });
});

describe('isPlatformArtifact', () => {
  it('flags package-provenance items regardless of name (ADR-0010 stamps)', () => {
    // Third-party plugin pages are NOT sys_-prefixed — provenance is the
    // primary signal, the name prefix only a fallback.
    expect(isPlatformArtifact({ name: 'crm_dashboard', _packageId: 'com.acme.crm' })).toBe(true);
    expect(isPlatformArtifact({ name: 'billing_home', _provenance: 'package' })).toBe(true);
    expect(isPlatformArtifact({ name: 'sys_user_detail' })).toBe(true); // prefix fallback
  });

  it('accepts user-authored items', () => {
    expect(isPlatformArtifact({ name: 'my_page' })).toBe(false);
    expect(isPlatformArtifact({ name: 'my_page', _provenance: 'org' })).toBe(false);
    expect(isPlatformArtifact(null)).toBe(false);
    expect(isPlatformArtifact('my_page')).toBe(false);
  });
});

describe('isNavigationSyncableApp', () => {
  it('rejects apps whose lock forbids PUT (ADR-0010)', () => {
    expect(isNavigationSyncableApp({ name: 'setup', _lock: 'full' })).toBe(false);
    expect(isNavigationSyncableApp({ name: 'studio', _lock: 'no-overlay' })).toBe(false);
    expect(isNavigationSyncableApp({ name: 'setup', protection: { lock: 'full' } })).toBe(false);
  });

  it('accepts writable apps (no lock, or locks that still allow PUT)', () => {
    expect(isNavigationSyncableApp({ name: 'crm' })).toBe(true);
    expect(isNavigationSyncableApp({ name: 'crm', _lock: 'none' })).toBe(true);
    expect(isNavigationSyncableApp({ name: 'crm', _lock: 'no-delete' })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isNavigationSyncableApp(null)).toBe(false);
    expect(isNavigationSyncableApp('crm')).toBe(false);
  });
});

describe('isNavigationTargetType', () => {
  it('names page and dashboard, and nothing else', () => {
    expect(isNavigationTargetType('page')).toBe(true);
    expect(isNavigationTargetType('dashboard')).toBe(true);
    expect(isNavigationTargetType('view')).toBe(false);
    expect(isNavigationTargetType('report')).toBe(false);
    expect(isNavigationTargetType(undefined)).toBe(false);
  });
});

describe('navigationReferences', () => {
  const tree = [
    { id: 'a', type: 'object', objectName: 'task' },
    { id: 'g', type: 'group', children: [{ id: 'p', type: 'page', pageName: 'home' }] },
    { id: 'd', type: 'dashboard', dashboardName: 'sales' },
  ] as any[];

  it('finds an entry at any depth, by type and name', () => {
    expect(navigationReferences(tree, 'page', 'home')).toBe(true);
    expect(navigationReferences(tree, 'dashboard', 'sales')).toBe(true);
  });

  it('does not match another name or the other type', () => {
    expect(navigationReferences(tree, 'page', 'sales')).toBe(false);
    expect(navigationReferences(tree, 'dashboard', 'home')).toBe(false);
    expect(navigationReferences([], 'page', 'home')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The fixtures both halves below share
// ---------------------------------------------------------------------------

interface World {
  apps: any[];
  pages?: any[];
  dashboards?: any[];
}

/** A metadata value that records every list read and serves `apps` as it is told. */
function metaValue(world: World, read: Set<string> = new Set()): MetadataContextValue {
  return {
    apps: world.apps,
    objects: [],
    get dashboards() {
      read.add('dashboard');
      return world.dashboards ?? [];
    },
    reports: [],
    get pages() {
      read.add('page');
      return world.pages ?? [];
    },
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: (): MetadataTypeStatus => 'ready',
  } as unknown as MetadataContextValue;
}

function makeAdapter(saveItem: ReturnType<typeof vi.fn>) {
  return { getClient: () => ({ meta: { saveItem } }) } as any;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const crm = { name: 'crm', label: 'CRM', navigation: [] };

// ---------------------------------------------------------------------------
// NavigationSyncEffect — retired
// ---------------------------------------------------------------------------

describe('NavigationSyncEffect is retired (objectstack#28680)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __markFirstPainted();
  });

  it('reads neither list and writes nothing, even when a page and a dashboard appear', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const read = new Set<string>();
    const tree = (world: World) => (
      <AdapterCtx.Provider value={makeAdapter(saveItem)}>
        <MetadataCtx.Provider value={metaValue(world, read)}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>
    );
    const { rerender } = render(tree({ apps: [crm], pages: [], dashboards: [] }));
    await flush();
    rerender(tree({ apps: [crm], pages: [{ name: 'my_page' }], dashboards: [{ name: 'my_dash' }] }));
    await flush();

    expect([...read]).toEqual([]);
    expect(saveItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useNavigationWrites — the create / delete sites' door
// ---------------------------------------------------------------------------

type Writes = ReturnType<typeof useNavigationWrites>;

/**
 * Mount the door over `world`, run `act` with it once, and hand back the save
 * spy. `preview` puts the tree in draft preview (ADR-0037).
 */
async function withWrites(
  world: World,
  act: (writes: Writes) => Promise<void>,
  { preview = false }: { preview?: boolean } = {},
) {
  const saveItem = vi.fn().mockResolvedValue({});
  const read = new Set<string>();
  let done = false;
  function Caller() {
    const writes = useNavigationWrites();
    useEffect(() => {
      void act(writes).then(() => {
        done = true;
      });
      // Once, on mount: the act is the case.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  render(
    <MemoryRouter>
      <PreviewModeProvider force={preview}>
        <AdapterCtx.Provider value={makeAdapter(saveItem)}>
          <MetadataCtx.Provider value={metaValue(world, read)}>
            <Caller />
          </MetadataCtx.Provider>
        </AdapterCtx.Provider>
      </PreviewModeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(done).toBe(true));
  await flush();
  return { saveItem, read };
}

describe('useNavigationWrites keeps the diff\'s rules at the site (objectstack#28680)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a created page and dashboard land label-less in every writable app, and no list is read', async () => {
    const sales = { name: 'sales', label: 'Sales', navigation: [] };
    const { saveItem, read } = await withWrites({ apps: [crm, sales] }, async (w) => {
      await w.created('page', 'my_page', { name: 'my_page', label: 'My Page' });
      await w.created('dashboard', 'my_dash');
    });

    expect(saveItem.mock.calls.map((c) => c[1])).toEqual(['crm', 'sales', 'crm', 'sales']);
    const entries = saveItem.mock.calls.map((c) => c[2].navigation.at(-1));
    expect(entries[0]).toMatchObject({ type: 'page', pageName: 'my_page' });
    expect(entries[2]).toMatchObject({ type: 'dashboard', dashboardName: 'my_dash' });
    for (const e of entries) expect(e).not.toHaveProperty('label');
    expect([...read]).toEqual([]);
  });

  it('a deleted page leaves every app that referenced it', async () => {
    const withPage = {
      name: 'crm',
      navigation: [
        { id: 'n1', type: 'page', pageName: 'my_page' },
        { id: 'n2', type: 'object', objectName: 'task' },
      ],
    };
    const { saveItem } = await withWrites({ apps: [withPage] }, (w) => w.deleted('page', 'my_page'));

    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem.mock.calls[0][2].navigation.map((i: any) => i.id)).toEqual(['n2']);
  });

  it('never writes for sys_ names or package-provenance items, in either direction', async () => {
    const withPkgPage = { name: 'crm', navigation: [{ id: 'n1', type: 'page', pageName: 'crm_home' }] };
    const { saveItem } = await withWrites({ apps: [withPkgPage] }, async (w) => {
      await w.created('page', 'sys_user_detail');
      await w.created('page', 'crm_home', { _packageId: 'com.acme.crm' });
      await w.created('dashboard', 'billing', { _provenance: 'package' });
      await w.deleted('page', 'crm_home', { _packageId: 'com.acme.crm' });
    });
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('writes nothing for a type that is not a page or a dashboard', async () => {
    const { saveItem } = await withWrites({ apps: [crm] }, async (w) => {
      await w.created('view', 'task_grid');
      await w.created('report', 'pipeline');
    });
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('writes nothing in draft preview (ADR-0037)', async () => {
    const { saveItem } = await withWrites(
      { apps: [crm] },
      async (w) => {
        await w.created('page', 'my_page');
        await w.deleted('dashboard', 'my_dash');
      },
      { preview: true },
    );
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('skips write-protected apps (ADR-0010 _lock)', async () => {
    const apps = [
      crm,
      { name: 'setup', label: 'Setup', navigation: [], _lock: 'full' },
      { name: 'studio', label: 'Studio', navigation: [], protection: { lock: 'no-overlay' } },
    ];
    const { saveItem } = await withWrites({ apps }, (w) => w.created('page', 'my_page'));

    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem.mock.calls[0][1]).toBe('crm');
    const { toast } = await import('sonner');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a second create of a page an app already references adds no second entry', async () => {
    const withPage = {
      name: 'crm',
      navigation: [{ id: 'g', type: 'group', children: [{ id: 'n1', type: 'page', pageName: 'my_page' }] }],
    };
    const withDash = { name: 'ops', navigation: [{ id: 'n2', type: 'dashboard', dashboardName: 'my_dash' }] };
    const { saveItem } = await withWrites({ apps: [withPage, withDash] }, async (w) => {
      await w.created('page', 'my_page');
      await w.created('dashboard', 'my_dash');
    });

    // `crm` already holds the page (nested), `ops` the dashboard: each app is
    // written only for the target it lacks.
    expect(saveItem.mock.calls.map((c) => [c[1], c[2].navigation.at(-1).type])).toEqual([
      ['ops', 'page'],
      ['crm', 'dashboard'],
    ]);
  });
});
