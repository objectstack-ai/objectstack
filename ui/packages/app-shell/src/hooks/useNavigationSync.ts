/**
 * useNavigationSync
 *
 * Synchronizes the App navigation tree when Pages or Dashboards are
 * created, deleted, or renamed.  Pure utility helpers are exported for
 * unit-testing; the React hook wires them to the adapter / metadata
 * context and shows sonner toasts with an undo action.
 *
 * @module
 */

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { NavigationItem, AppComponentSchema } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/appRoute.js';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';
import { useAfterFirstPaint } from './sharedUserFeeds.js';

// ============================================================================
// Pure utility helpers (exported for testing)
// ============================================================================

let _idCounter = 0;
/** Generate a simple unique id for a new navigation item. */
export function generateNavId(prefix = 'nav'): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

/**
 * Add a navigation item to the end of a navigation array (immutable).
 */
export function addNavigationItem(
  navigation: NavigationItem[],
  item: NavigationItem,
): NavigationItem[] {
  return [...navigation, item];
}

/**
 * The navigation entry written when a page is added to an app's navigation.
 *
 * With no author label it carries NO `label` key (objectui#9868): an absent
 * label is `@objectstack/spec` 17.5.0's "resolve at render time", so nothing is
 * frozen into the app's metadata the way `label || pageName` used to freeze the
 * machine name. (The ruling names label inheritance for views, objects and
 * dashboards; a label-less page entry renders its `pageName` —
 * `resolveNavItemLabel` in `@object-ui/layout`.) An author label is still
 * written, and renders verbatim. ⛔ Never `''` — that is a present label.
 */
export function newPageNavigationItem(pageName: string, label?: string): NavigationItem {
  return {
    id: generateNavId('nav_page'),
    type: 'page',
    ...(label ? { label } : {}),
    pageName,
    icon: 'FileText',
  };
}

/**
 * The navigation entry written when a dashboard is added to an app's
 * navigation — the same rule as {@link newPageNavigationItem}: no author label,
 * no `label` key, so the entry shows the dashboard's CURRENT label at render
 * time (objectui#9868) instead of a stored copy of `dashboardName`.
 */
export function newDashboardNavigationItem(dashboardName: string, label?: string): NavigationItem {
  return {
    id: generateNavId('nav_dash'),
    type: 'dashboard',
    ...(label ? { label } : {}),
    dashboardName,
    icon: 'LayoutDashboard',
  };
}

/**
 * Recursively remove all navigation items that match a given type and name.
 * Returns a new array (immutable).
 */
export function removeNavigationItems(
  navigation: NavigationItem[],
  type: 'page' | 'dashboard',
  name: string,
): NavigationItem[] {
  return navigation
    .filter((item) => {
      if (item.type === type) {
        if (type === 'page' && item.pageName === name) return false;
        if (type === 'dashboard' && item.dashboardName === name) return false;
      }
      return true;
    })
    .map((item) => {
      if (item.children && item.children.length > 0) {
        return {
          ...item,
          children: removeNavigationItems(item.children, type, name),
        };
      }
      return item;
    });
}

/**
 * Recursively rename all navigation items that reference the old name.
 * Returns a new array (immutable).
 */
export function renameNavigationItems(
  navigation: NavigationItem[],
  type: 'page' | 'dashboard',
  oldName: string,
  newName: string,
): NavigationItem[] {
  return navigation.map((item) => {
    let updated = item;

    if (type === 'page' && item.type === 'page' && item.pageName === oldName) {
      updated = { ...item, pageName: newName };
    } else if (type === 'dashboard' && item.type === 'dashboard' && item.dashboardName === oldName) {
      updated = { ...item, dashboardName: newName };
    }

    if (updated.children && updated.children.length > 0) {
      return {
        ...updated,
        children: renameNavigationItems(updated.children, type, oldName, newName),
      };
    }
    return updated;
  });
}

/**
 * Shallow-structural equality check for two NavigationItem arrays.
 * Works reliably because NavigationItem objects are plain serializable JSON
 * whose key ordering is deterministic (we control object creation).
 */
export function navigationEqual(a: NavigationItem[], b: NavigationItem[]): boolean {
  if (a.length !== b.length) return false;
  // Fast-path: same reference
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `sys_` is the platform-reserved metadata namespace (sys_organization_detail,
 * sys_user_detail, …). Fallback signal only — see isPlatformArtifact.
 */
export function isSystemArtifactName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('sys_');
}

/**
 * Package/platform-shipped pages and dashboards are never "something the user
 * just created", so they must not trigger navigation sync no matter when they
 * appear in (or vanish from) the metadata lists — package install/uninstall
 * mid-session looks exactly like user CRUD to a name-set diff. A package that
 * ships pages also ships (or contributes to) the navigation that exposes
 * them; auto-syncing on top of that would duplicate entries at best and write
 * into apps the package never intended at worst.
 *
 * Provenance is the primary signal: ADR-0010's applyProtection stamps
 * `_packageId` + `_provenance: 'package'` on artifacts registered with
 * package coords (the engine manifest path passes them). The `sys_` name
 * prefix is only a fallback for registration paths that don't stamp
 * provenance yet — third-party plugin pages are NOT guaranteed to carry it,
 * which is why the field check comes first.
 */
export function isPlatformArtifact(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const a = item as { name?: unknown; _packageId?: unknown; _provenance?: unknown };
  if (a._packageId != null || a._provenance === 'package') return true;
  return isSystemArtifactName(a.name);
}

/**
 * Whether an app may be targeted by automatic navigation writes.
 *
 * ADR-0010 metadata protection: the loader stamps a `_lock` envelope on
 * packaged artifacts (translated from the author-facing `protection` block,
 * e.g. the `setup` app ships `protection.lock = 'full'`). Locks 'full' and
 * 'no-overlay' reject PUT with 403 — a navigation write into such an app can
 * never succeed, so don't attempt it (each attempt surfaced as a red
 * "Failed to update navigation" toast).
 */
export function isNavigationSyncableApp(app: unknown): boolean {
  if (!app || typeof app !== 'object') return false;
  const a = app as { _lock?: string; protection?: { lock?: string } };
  const lock = a._lock ?? a.protection?.lock;
  return lock !== 'full' && lock !== 'no-overlay';
}

// ============================================================================
// React Hook
// ============================================================================

export interface UseNavigationSyncReturn {
  /** Call after a new page has been created / saved for the first time. */
  syncPageCreated: (appName: string, pageName: string, label?: string) => Promise<void>;
  /** Call after a new dashboard has been created / saved for the first time. */
  syncDashboardCreated: (appName: string, dashboardName: string, label?: string) => Promise<void>;
  /** Call after a page has been deleted. */
  syncPageDeleted: (appName: string, pageName: string) => Promise<void>;
  /** Call after a dashboard has been deleted. */
  syncDashboardDeleted: (appName: string, dashboardName: string) => Promise<void>;
  /** Call after a page has been renamed. */
  syncPageRenamed: (appName: string, oldName: string, newName: string) => Promise<void>;
  /** Call after a dashboard has been renamed. */
  syncDashboardRenamed: (appName: string, oldName: string, newName: string) => Promise<void>;

  /** Convenience: add page to navigation of ALL apps. */
  syncPageCreatedAllApps: (pageName: string, label?: string) => Promise<void>;
  /** Convenience: add dashboard to navigation of ALL apps. */
  syncDashboardCreatedAllApps: (dashboardName: string, label?: string) => Promise<void>;
  /** Convenience: remove page from navigation of ALL apps. */
  syncPageDeletedAllApps: (pageName: string) => Promise<void>;
  /** Convenience: remove dashboard from navigation of ALL apps. */
  syncDashboardDeletedAllApps: (dashboardName: string) => Promise<void>;
  /** Convenience: rename page references across ALL apps. */
  syncPageRenamedAllApps: (oldName: string, newName: string) => Promise<void>;
  /** Convenience: rename dashboard references across ALL apps. */
  syncDashboardRenamedAllApps: (oldName: string, newName: string) => Promise<void>;
}

/**
 * Hook that provides methods to keep the App navigation tree in sync with
 * Page / Dashboard CRUD operations.  Each method:
 *
 * 1. Finds the target app from metadata
 * 2. Mutates the `navigation` array (immutably)
 * 3. Persists via `client.meta.saveItem`
 * 4. Refreshes metadata cache
 * 5. Shows a toast with an **Undo** action
 */
export function useNavigationSync(): UseNavigationSyncReturn {
  const adapter = useAdapter();
  const { apps, refresh } = useMetadata();
  const { t } = useObjectTranslation();

  // Keep a ref so the undo closure always reads the latest adapter
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /** Persist an updated app schema and refresh metadata. */
  const saveApp = useCallback(
    async (appName: string, schema: AppComponentSchema) => {
      const client = adapterRef.current?.getClient();
      if (client) {
        await client.meta.saveItem('app', appName, schema);
      }
      await refreshRef.current?.();
    },
    [],
  );

  /** Find the current app schema from metadata by name. */
  const findApp = useCallback(
    (appName: string): AppComponentSchema | undefined =>
      matchAppBySegment(apps, appName) as AppComponentSchema | undefined,
    [apps],
  );

  // ------------------------------------------------------------------
  // Created
  // ------------------------------------------------------------------

  const syncPageCreated = useCallback(
    async (appName: string, pageName: string, label?: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const newItem = newPageNavigationItem(pageName, label);
      const updated = addNavigationItem(prev, newItem);
      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.addedPage', { name: label || pageName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  const syncDashboardCreated = useCallback(
    async (appName: string, dashboardName: string, label?: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const newItem = newDashboardNavigationItem(dashboardName, label);
      const updated = addNavigationItem(prev, newItem);
      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.addedDashboard', { name: label || dashboardName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  // ------------------------------------------------------------------
  // Deleted
  // ------------------------------------------------------------------

  const syncPageDeleted = useCallback(
    async (appName: string, pageName: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const updated = removeNavigationItems(prev, 'page', pageName);
      if (navigationEqual(updated, prev)) return; // nothing changed

      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.removedPage', { name: pageName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  const syncDashboardDeleted = useCallback(
    async (appName: string, dashboardName: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const updated = removeNavigationItems(prev, 'dashboard', dashboardName);
      if (navigationEqual(updated, prev)) return;

      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.removedDashboard', { name: dashboardName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  // ------------------------------------------------------------------
  // Renamed
  // ------------------------------------------------------------------

  const syncPageRenamed = useCallback(
    async (appName: string, oldName: string, newName: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const updated = renameNavigationItems(prev, 'page', oldName, newName);
      if (navigationEqual(updated, prev)) return;

      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.renamedPage', { oldName, newName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  const syncDashboardRenamed = useCallback(
    async (appName: string, oldName: string, newName: string) => {
      const app = findApp(appName);
      if (!app) return;

      const prev = app.navigation ?? [];
      const updated = renameNavigationItems(prev, 'dashboard', oldName, newName);
      if (navigationEqual(updated, prev)) return;

      const updatedApp: AppComponentSchema = { ...app, navigation: updated };

      try {
        await saveApp(appName, updatedApp);
        toast.success(t('navigationSync.renamedDashboard', { oldName, newName }), {
          action: {
            label: t('navigationSync.undoLabel'),
            onClick: async () => {
              try {
                await saveApp(appName, { ...app, navigation: prev });
                toast.info(t('navigationSync.undone'));
              } catch {
                toast.error(t('navigationSync.undoFailed'));
              }
            },
          },
        });
      } catch {
        toast.error(t('navigationSync.updateFailed'));
      }
    },
    [findApp, saveApp, t],
  );

  // ------------------------------------------------------------------
  // All-Apps convenience methods
  // ------------------------------------------------------------------

  /** Safely extract the app name from a metadata entry. */
  const getAppName = (app: unknown): string | undefined =>
    app && typeof app === 'object' && 'name' in app ? (app as { name: string }).name : undefined;

  /** Add a page nav item to ALL apps that don't already reference it. */
  const syncPageCreatedAllApps = useCallback(
    async (pageName: string, label?: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncPageCreated(name, pageName, label);
      }
    },
    [apps, syncPageCreated],
  );

  /** Add a dashboard nav item to ALL apps that don't already reference it. */
  const syncDashboardCreatedAllApps = useCallback(
    async (dashboardName: string, label?: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncDashboardCreated(name, dashboardName, label);
      }
    },
    [apps, syncDashboardCreated],
  );

  /** Remove a page from navigation across ALL apps. */
  const syncPageDeletedAllApps = useCallback(
    async (pageName: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncPageDeleted(name, pageName);
      }
    },
    [apps, syncPageDeleted],
  );

  /** Remove a dashboard from navigation across ALL apps. */
  const syncDashboardDeletedAllApps = useCallback(
    async (dashboardName: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncDashboardDeleted(name, dashboardName);
      }
    },
    [apps, syncDashboardDeleted],
  );

  /** Rename page references across ALL apps. */
  const syncPageRenamedAllApps = useCallback(
    async (oldName: string, newName: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncPageRenamed(name, oldName, newName);
      }
    },
    [apps, syncPageRenamed],
  );

  /** Rename dashboard references across ALL apps. */
  const syncDashboardRenamedAllApps = useCallback(
    async (oldName: string, newName: string) => {
      for (const app of apps) {
        const name = getAppName(app);
        if (!name || !isNavigationSyncableApp(app)) continue;
        await syncDashboardRenamed(name, oldName, newName);
      }
    },
    [apps, syncDashboardRenamed],
  );

  return {
    syncPageCreated,
    syncDashboardCreated,
    syncPageDeleted,
    syncDashboardDeleted,
    syncPageRenamed,
    syncDashboardRenamed,
    syncPageCreatedAllApps,
    syncDashboardCreatedAllApps,
    syncPageDeletedAllApps,
    syncDashboardDeletedAllApps,
    syncPageRenamedAllApps,
    syncDashboardRenamedAllApps,
  };
}

// ============================================================================
// NavigationSyncEffect — auto-detect page/dashboard metadata changes
// ============================================================================

/**
 * Headless component that watches the `pages` and `dashboards` metadata
 * arrays.  When items are added or removed it automatically calls the
 * matching navigation-sync methods for every app.
 *
 * Mount once inside the component tree (e.g. inside `AppContent`) where
 * both `useMetadata` and `useAdapter` are available.
 *
 * > **Rename detection** is not possible with a simple diff — callers
 * > should invoke `syncPageRenamed` / `syncDashboardRenamed` explicitly.
 */
/** What `NavigationSyncEffect` holds for a list it has not read yet. */
const NOT_READ_YET: never[] = [];

export function NavigationSyncEffect(): null {
  // objectui#12980 — `pages` and `dashboards` are LAZY getters: reading one
  // starts its `/meta/:type` read. Nothing on the first paint needs this diff,
  // so they are not read until the console has painted; the load-state guard
  // below then waits for both, as it always has.
  const painted = useAfterFirstPaint();
  const metadata = useMetadata();
  const { apps, getTypeStatus } = metadata;
  const pages = painted ? metadata.pages : NOT_READ_YET;
  const dashboards = painted ? metadata.dashboards : NOT_READ_YET;
  const adapter = useAdapter();
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  // ADR-0037 — preview is read-only by design. Entering/leaving
  // `?preview=draft` swaps the entire metadata source, so the page/dashboard
  // sets legitimately DIFFER from the previous render; diffing across that
  // swap would misread draft-only (or published-only) items as user
  // creations/deletions and WRITE navigation changes back to the real app
  // metadata from inside a preview. Disabled for the whole preview session.
  const previewDrafts = usePreviewDrafts();

  const {
    syncPageCreated,
    syncDashboardCreated,
    syncPageDeleted,
    syncDashboardDeleted,
  } = useNavigationSync();

  // Track previous page/dashboard name sets
  const prevPageNamesRef = useRef<Set<string> | null>(null);
  const prevDashNamesRef = useRef<Set<string> | null>(null);

  // Guard against circular refreshes and concurrent sync operations.
  // Incremented on each effect invocation; the async closure captures
  // its own version and bails out if a newer run has started.
  const syncVersionRef = useRef(0);
  const syncingRef = useRef(false);

  /** Safely extract the app name from a metadata entry. */
  const getAppName = (app: unknown): string | undefined =>
    app && typeof app === 'object' && 'name' in app ? (app as { name: string }).name : undefined;

  useEffect(() => {
    // Before the first paint nothing is read, so there is nothing to seed a
    // baseline from: seeding an empty one would diff the real lists, once
    // they land, as every page and dashboard "added".
    if (!painted) return;
    if (syncingRef.current) return;
    if (previewDrafts) {
      // Drop the baseline so leaving preview re-seeds instead of diffing the
      // published world against the draft world it just stopped rendering.
      prevPageNamesRef.current = null;
      prevDashNamesRef.current = null;
      return;
    }

    // `page` and `dashboard` are lazily-loaded metadata types: their arrays
    // are empty (or stale) until the fetch lands, and `invalidate()` empties
    // them again mid-session (e.g. the New-record flow reloads meta). Diffing
    // a not-ready snapshot misreads that dip as mass deletion / re-creation —
    // notably flagging system pages as "user added" once the full list
    // arrives. Only seed the baseline and diff while both types are 'ready'.
    // (Contexts without getTypeStatus — hand-rolled test values — are
    // treated as always ready.)
    if (
      getTypeStatus &&
      (getTypeStatus('page') !== 'ready' || getTypeStatus('dashboard') !== 'ready')
    ) {
      return;
    }

    // Platform/package artifacts never participate in the diff: they ship
    // with the platform or arrive via package install, not from user CRUD,
    // so their appearance must not write them into app navigation (nor
    // their disappearance delete nav entries). See isPlatformArtifact.
    const userArtifactNames = (items: any[]): Set<string> =>
      new Set(
        items
          .filter((it: any) => !isPlatformArtifact(it))
          .map((it: any) => it?.name)
          .filter((n: any): n is string => typeof n === 'string' && n.length > 0),
      );
    const currentPageNames = userArtifactNames(pages ?? []);
    const currentDashNames = userArtifactNames(dashboards ?? []);

    const prevPages = prevPageNamesRef.current;
    const prevDash = prevDashNamesRef.current;

    // First render — seed refs and exit without syncing
    if (prevPages === null || prevDash === null) {
      prevPageNamesRef.current = currentPageNames;
      prevDashNamesRef.current = currentDashNames;
      return;
    }

    // Compute diff
    const addedPages = [...currentPageNames].filter((n) => !prevPages.has(n));
    const removedPages = [...prevPages].filter((n) => !currentPageNames.has(n));
    const addedDash = [...currentDashNames].filter((n) => !prevDash.has(n));
    const removedDash = [...prevDash].filter((n) => !currentDashNames.has(n));

    if (
      addedPages.length === 0 &&
      removedPages.length === 0 &&
      addedDash.length === 0 &&
      removedDash.length === 0
    ) {
      // Nothing changed — update refs and exit
      prevPageNamesRef.current = currentPageNames;
      prevDashNamesRef.current = currentDashNames;
      return;
    }

    // Sync navigation across all apps
    const version = ++syncVersionRef.current;
    syncingRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        for (const app of apps) {
          if (cancelled || syncVersionRef.current !== version) break;
          const appName = getAppName(app);
          // Write-protected apps (ADR-0010 `_lock`) would 403 every PUT —
          // skip them instead of spraying failure toasts.
          if (!appName || !isNavigationSyncableApp(app)) continue;

          for (const pageName of addedPages) {
            if (cancelled) break;
            await syncPageCreated(appName, pageName);
          }
          for (const pageName of removedPages) {
            if (cancelled) break;
            await syncPageDeleted(appName, pageName);
          }
          for (const dashName of addedDash) {
            if (cancelled) break;
            await syncDashboardCreated(appName, dashName);
          }
          for (const dashName of removedDash) {
            if (cancelled) break;
            await syncDashboardDeleted(appName, dashName);
          }
        }
      } finally {
        // Only update refs if this is still the latest sync version
        if (syncVersionRef.current === version) {
          prevPageNamesRef.current = currentPageNames;
          prevDashNamesRef.current = currentDashNames;
          syncingRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [painted, pages, dashboards, apps, previewDrafts, getTypeStatus, syncPageCreated, syncDashboardCreated, syncPageDeleted, syncDashboardDeleted]);

  return null;
}
