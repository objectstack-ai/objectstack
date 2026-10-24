/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * NavigationSyncEffect baseline race — the regression that motivated this
 * suite: `page` / `dashboard` metadata is lazily loaded, so the effect's
 * first baseline could be seeded from a partial (or, after `invalidate()`,
 * emptied) list. When the full list landed, platform pages
 * (sys_organization_detail, sys_user_detail, …) diffed as "user added" and
 * the effect PUT them into every app's navigation — including write-protected
 * system apps (ADR-0010 `_lock`), which 403'd into red failure toasts while
 * writable apps got polluted with sys_ nav entries (and a green toast).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MetadataCtx, AdapterCtx, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';
import {
  NavigationSyncEffect,
  isSystemArtifactName,
  isPlatformArtifact,
  isNavigationSyncableApp,
} from '../useNavigationSync';
import { __markFirstPainted } from '../sharedUserFeeds';

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

// ---------------------------------------------------------------------------
// NavigationSyncEffect
// ---------------------------------------------------------------------------

interface World {
  apps: any[];
  pages: any[];
  dashboards: any[];
  status: Partial<Record<string, MetadataTypeStatus>>;
}

function metaValue(world: World): MetadataContextValue {
  return {
    apps: world.apps,
    objects: [],
    dashboards: world.dashboards,
    reports: [],
    pages: world.pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: (type: string) => world.status[type] ?? 'ready',
  };
}

function makeAdapter(saveItem: ReturnType<typeof vi.fn>) {
  return { getClient: () => ({ meta: { saveItem } }) } as any;
}

function renderEffect(saveItem: ReturnType<typeof vi.fn>, world: World) {
  const utils = render(
    <AdapterCtx.Provider value={makeAdapter(saveItem)}>
      <MetadataCtx.Provider value={metaValue(world)}>
        <NavigationSyncEffect />
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>,
  );
  const setWorld = (next: World) =>
    utils.rerender(
      <AdapterCtx.Provider value={makeAdapter(saveItem)}>
        <MetadataCtx.Provider value={metaValue(next)}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
  return { ...utils, setWorld };
}

/** Flush the effect's fire-and-forget async sync loop. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const crm = { name: 'crm', label: 'CRM', navigation: [] };

describe('NavigationSyncEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // objectui#12980 — the effect reads nothing before the console's first
    // paint; these cases are about the diff, so they start past it.
    __markFirstPainted();
  });

  it('does not seed the baseline until page AND dashboard types are ready', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    // Lazy types still loading — pages reads as [] even though the server
    // has sys_ pages plus a user page.
    const { setWorld } = renderEffect(saveItem, {
      apps: [crm],
      pages: [],
      dashboards: [],
      status: { page: 'loading', dashboard: 'loading' },
    });

    // Full load lands. If the empty not-ready snapshot had been used as the
    // baseline, every page here would now diff as "user added".
    setWorld({
      apps: [crm],
      pages: [{ name: 'sys_organization_detail' }, { name: 'sys_user_detail' }, { name: 'home' }],
      dashboards: [{ name: 'sales' }],
      status: {},
    });
    await flush();
    expect(saveItem).not.toHaveBeenCalled();

    // A page created AFTER the ready baseline does sync.
    setWorld({
      apps: [crm],
      pages: [{ name: 'sys_organization_detail' }, { name: 'sys_user_detail' }, { name: 'home' }, { name: 'my_page' }],
      dashboards: [{ name: 'sales' }],
      status: {},
    });
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    const [type, name, schema] = saveItem.mock.calls[0];
    expect(type).toBe('app');
    expect(name).toBe('crm');
    expect(schema.navigation.map((i: any) => i.pageName)).toEqual(['my_page']);
  });

  it('ignores the invalidate dip (status leaves ready, items empty out)', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const ready: World = {
      apps: [crm],
      pages: [{ name: 'home' }],
      dashboards: [],
      status: {},
    };
    const { setWorld } = renderEffect(saveItem, ready);
    await flush();

    // invalidate('page') → status 'idle'/'loading', items []. Without the
    // ready gate this read as "home deleted" …
    setWorld({ apps: [crm], pages: [], dashboards: [], status: { page: 'loading' } });
    await flush();
    // … and the refetch landing (now including a late sys_ page) as
    // "home + sys_* created".
    setWorld({
      apps: [crm],
      pages: [{ name: 'home' }, { name: 'sys_organization_detail' }],
      dashboards: [],
      status: {},
    });
    await flush();

    expect(saveItem).not.toHaveBeenCalled();
  });

  it('never treats sys_ pages/dashboards as user creations or deletions', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const { setWorld } = renderEffect(saveItem, {
      apps: [crm],
      pages: [{ name: 'home' }],
      dashboards: [{ name: 'sys_metrics' }],
      status: {},
    });
    await flush();

    // sys_ artifacts appear and disappear (package install/uninstall) —
    // neither direction may touch app navigation.
    setWorld({
      apps: [crm],
      pages: [{ name: 'home' }, { name: 'sys_user_detail' }],
      dashboards: [],
      status: {},
    });
    await flush();
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('ignores package-provenance pages from a mid-session install (not sys_-prefixed)', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const { setWorld } = renderEffect(saveItem, {
      apps: [crm],
      pages: [{ name: 'home' }],
      dashboards: [],
      status: {},
    });
    await flush();

    // Installing a package adds its pages to the metadata list between two
    // ready snapshots — a name-set diff reads that exactly like user CRUD.
    // The package ships its own navigation; auto-sync must stay out.
    setWorld({
      apps: [crm],
      pages: [{ name: 'home' }, { name: 'crm_dashboard', _packageId: 'com.acme.crm' }],
      dashboards: [],
      status: {},
    });
    await flush();
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('skips write-protected apps (ADR-0010 _lock) when syncing', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const apps = [
      crm,
      { name: 'setup', label: 'Setup', navigation: [], _lock: 'full' },
      { name: 'studio', label: 'Studio', navigation: [], protection: { lock: 'no-overlay' } },
    ];
    const { setWorld } = renderEffect(saveItem, {
      apps,
      pages: [],
      dashboards: [],
      status: {},
    });
    await flush();

    setWorld({ apps, pages: [{ name: 'my_page' }], dashboards: [], status: {} });
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    await flush();

    // Exactly one write — to the writable app; no 403-bound PUTs attempted.
    expect(saveItem).toHaveBeenCalledTimes(1);
    expect(saveItem.mock.calls[0][1]).toBe('crm');
    const { toast } = await import('sonner');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('treats a context without getTypeStatus as always ready (back-compat)', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const base = metaValue({ apps: [crm], pages: [{ name: 'home' }], dashboards: [], status: {} });
    delete (base as any).getTypeStatus;
    const next = metaValue({
      apps: [crm],
      pages: [{ name: 'home' }, { name: 'p2' }],
      dashboards: [],
      status: {},
    });
    delete (next as any).getTypeStatus;

    const adapter = makeAdapter(saveItem);
    const utils = render(
      <AdapterCtx.Provider value={adapter}>
        <MetadataCtx.Provider value={base}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
    utils.rerender(
      <AdapterCtx.Provider value={adapter}>
        <MetadataCtx.Provider value={next}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(saveItem.mock.calls[0][1]).toBe('crm');
  });
});
