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

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { NavigationItem, AppComponentSchema } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/appRoute.js';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';

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
 * Whether a navigation tree holds an entry, at any depth, that opens the named
 * page or dashboard.
 */
export function navigationReferences(
  navigation: NavigationItem[],
  type: 'page' | 'dashboard',
  name: string,
): boolean {
  return navigation.some(
    (item) =>
      (item.type === type &&
        (type === 'page' ? item.pageName === name : item.dashboardName === name)) ||
      (!!item.children && navigationReferences(item.children, type, name)),
  );
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
 *
 * ADR-0131 D6: an app a managed package ships is sealed. `app` has no per-org
 * overlay channel (`allowEnvironmentOverlay: false`), so the server refuses
 * every package-less write onto a packaged app with `403 NOT_OVERRIDABLE`,
 * whatever its lock (objectstack#29182). The app read marks such an app by its
 * ADR-0010 provenance: the artifact loader stamps `_provenance: 'package'`
 * (the stock showcase serves `showcase_app` so, with no `_lock`). A stored row
 * carries no such stamp: a package-less app is served with no provenance keys,
 * and an app of a package authored at runtime with `_packageId` alone, and the
 * server takes a navigation write into either. So provenance decides, never
 * `_packageId`.
 */
export function isNavigationSyncableApp(app: unknown): boolean {
  if (!app || typeof app !== 'object') return false;
  const a = app as { _lock?: string; protection?: { lock?: string }; _provenance?: unknown };
  if (a._provenance === 'package') return false;
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
      // objectstack#28680 — an app that already references the page keeps
      // its one entry: a second create call adds no duplicate.
      if (navigationReferences(prev, 'page', pageName)) return;
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
      if (navigationReferences(prev, 'dashboard', dashboardName)) return;
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
// useNavigationWrites — the create / delete sites' one door (objectstack#28680)
// ============================================================================

/** The metadata types whose create and delete write app navigation. */
export type NavigationTargetType = 'page' | 'dashboard';

/** Whether `type` is one whose create and delete write app navigation. */
export function isNavigationTargetType(type: unknown): type is NavigationTargetType {
  return type === 'page' || type === 'dashboard';
}

/**
 * The page kinds (`PageSchema.type`) that cannot render without a record, so a
 * `type: 'page'` navigation entry, which opens `/apps/{app}/page/{name}` with
 * no record id, can never open one. Today that is `record` alone: the nav
 * target picker leaves it out for the same reason (`isStaticPageOption` in
 * `views/metadata-admin/inspectors/nav-target.ts`). `home`, `app`, `utility`
 * and `list` render without one.
 */
const RECORD_BOUND_PAGE_TYPES: ReadonlySet<string> = new Set(['record']);

/**
 * The page kind a page body states. A body that leaves `type` out is a record
 * page: `PageSchema` declares `type` with the default `PAGE_TYPE_DEFAULT`
 * (`'record'`, `@objectstack/spec` `ui/default-record-page.ts`), which judges
 * an unparsed body the same way.
 */
function pageTypeOf(body: Record<string, unknown>): unknown {
  return body.type === undefined ? 'record' : body.type;
}

/**
 * Whether a page body may be written into app navigation: a page whose kind
 * renders without a record. A page that needs one (a `record` page) is never
 * navigable on its own, so a navigation entry for it opens a page with no
 * record (objectstack#29182).
 */
export function isNavigablePage(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const type = pageTypeOf(body as Record<string, unknown>);
  return typeof type === 'string' && !RECORD_BOUND_PAGE_TYPES.has(type);
}

export interface UseNavigationWritesReturn {
  /**
   * A page or dashboard was just published for the FIRST time (it held no
   * published layer before). Adds a label-less entry for it to every app that
   * may be written and does not reference it yet.
   *
   * `item` is the published body when the caller holds one: its provenance
   * (`_packageId`, `_provenance`) decides, with the name, whether it is a
   * platform artifact, which never writes navigation. A page's `type` decides
   * whether it is navigable at all; a caller that holds no body has the page
   * read by name.
   */
  created: (type: string, name: string, item?: unknown) => Promise<void>;
  /** A page or dashboard was just deleted, leaving no baseline behind. Removes its entries from every app that may be written. */
  deleted: (type: string, name: string, item?: unknown) => Promise<void>;
}

/**
 * The navigation writes a page or dashboard create or delete makes, called by
 * the console site that made it (objectstack#28680, maintainer ruling A).
 *
 * It replaces the retired `NavigationSyncEffect`, which read the whole
 * `/meta/page` and `/meta/dashboard` lists on every app page to diff their
 * name sets. It keeps
 * that diff's rules, so the same items reach navigation from the console:
 *
 *  - only a `page` or a `dashboard`;
 *  - on create, only a page that renders without a record
 *    ({@link isNavigablePage}, objectstack#29182): a `record` page joins no
 *    app's navigation;
 *  - never a platform artifact ({@link isPlatformArtifact}): an item a package
 *    install or a CLI deploy brings carries `_packageId`, and its package ships
 *    the navigation that exposes it;
 *  - never in draft preview (ADR-0037): preview swaps the whole metadata
 *    source, so `apps` there may be draft bodies that a navigation write would
 *    save live;
 *  - only into apps that may be written ({@link isNavigationSyncableApp}).
 *
 * What it no longer covers: a package-less page or dashboard created or
 * deleted OUTSIDE this tab (a server-side agent, another tab, a raw REST
 * call). The diff noticed one only when it showed up in this tab's list
 * mid-session; now it reaches navigation only through its own writer.
 */
export function useNavigationWrites(): UseNavigationWritesReturn {
  const previewDrafts = usePreviewDrafts();
  const adapter = useAdapter();
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const { t } = useObjectTranslation();
  const {
    syncPageCreatedAllApps,
    syncDashboardCreatedAllApps,
    syncPageDeletedAllApps,
    syncDashboardDeletedAllApps,
  } = useNavigationSync();

  const writes = useCallback(
    (type: string, name: string, item: unknown): type is NavigationTargetType => {
      if (previewDrafts || !isNavigationTargetType(type) || !name) return false;
      const body = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return !isPlatformArtifact({ ...body, name });
    },
    [previewDrafts],
  );

  /**
   * The body of a page just created: the one the caller holds, else the
   * published one, read by name (a publish of every pending draft holds only
   * the draft list's rows). `undefined` when that read fails.
   */
  const createdPageBody = useCallback(
    async (name: string, item: unknown): Promise<unknown> => {
      if (item && typeof item === 'object') return item;
      try {
        const client = adapterRef.current?.getClient();
        const res = (await client?.meta.getItem('page', name)) as { item?: unknown } | undefined;
        return res?.item;
      } catch {
        return undefined;
      }
    },
    [],
  );

  const created = useCallback(
    async (type: string, name: string, item?: unknown) => {
      if (!writes(type, name, item)) return;
      // No author label: the entry inherits its target's label at render time
      // (objectui#9868), as the diff's entries did.
      if (type === 'page') {
        // objectstack#29182 — a page that needs a record joins no app.
        const body = await createdPageBody(name, item);
        if (body === undefined) {
          toast.error(t('navigationSync.updateFailed'));
          return;
        }
        if (!isNavigablePage(body)) return;
        await syncPageCreatedAllApps(name);
      } else await syncDashboardCreatedAllApps(name);
    },
    [writes, createdPageBody, t, syncPageCreatedAllApps, syncDashboardCreatedAllApps],
  );

  const deleted = useCallback(
    async (type: string, name: string, item?: unknown) => {
      if (!writes(type, name, item)) return;
      if (type === 'page') await syncPageDeletedAllApps(name);
      else await syncDashboardDeletedAllApps(name);
    },
    [writes, syncPageDeletedAllApps, syncDashboardDeletedAllApps],
  );

  return { created, deleted };
}
