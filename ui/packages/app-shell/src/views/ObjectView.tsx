/**
 * Console ObjectView
 *
 * Thin wrapper around the plugin-view ObjectView that adds:
 * - Multi-view resolution from objectDef.listViews
 * - MetadataInspector toggle
 * - Drawer for record detail preview
 * - useObjectActions for toolbar create button
 * - ListView delegation for non-grid view types (kanban, calendar, chart, etc.)
 */

import { useMemo, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation, useHref } from 'react-router-dom';
import { resolveAffordance, type FilterTokenScope, type SchemaLike } from '@object-ui/core';
import { useObjectListPreferences } from '../context/ListPreferencesProvider.js';
const ImportWizard = lazy(() =>
  import('@object-ui/plugin-grid').then((m) => ({ default: m.ImportWizard })),
);
import { ObjectView as PluginObjectView, ManageViewsDialog } from '@object-ui/plugin-view';
// Plugin registration is handled by the host app (e.g. apps/console/src/main.tsx
// uses ComponentRegistry.registerLazy so heavy plugins stay code-split).
// Do NOT add eager `import '@object-ui/plugin-*'` side-effect imports here.
import {
  NavigationOverlay,
} from '@object-ui/components';
import { Plus } from 'lucide-react';
import { useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import { useServedViewItems } from '../hooks/useServedViewItems.js';
import type { DataSource } from '@object-ui/types';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { ViewConfigPanel } from './ViewConfigPanel.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { dropPublishedViewList } from './metadata-admin/viewListDrop.js';
import { CreateViewDialog } from './CreateViewDialog.js';
import {
  usePreviewDrafts,
} from '../preview/PreviewModeContext.js';
import { isSetupAppSegment } from '../console/setupApp.js';
import { RecordDetailView } from './RecordDetailView.js';
import { IDENTITY_IMPORT_WRITE_MODES } from './identityImport.js';
import { IdentityImportOptions, IdentityImportResultExtra, identityImportFields } from './IdentityImportPanels.js';
import { ManagedUsersInviteLine } from './managedEnvironmentUsers.js';
import { importTargetFields } from './importTargetFields.js';
import { resolveViewId } from '../utils/resolveViewId.js';
import { useRecordOpenPreference } from '../utils/recordOpenPreference.js';
import type { ListViewProps } from '@object-ui/plugin-list';
import { defaultListViewId, viewRowId } from '../utils/viewIdentity.js';
import { useObjectActions } from '../hooks/useObjectActions.js';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { ActionProvider, useActionTextLocalizer, RelatedRecordActionsProvider, notifyDataChanged } from '@object-ui/react';
import { toast } from 'sonner';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import {
    VIEW_TYPE_ICONS,
    FALLBACK_USER,
} from './objectViewHelpers.js';
import {
    defaultListColumnsFromObject,
    loadViewOverrides,
    buildViewTabs,
} from './objectViewTabs.js';
import { ObjectNotFoundState } from './objectViewChrome.js';
import { useObjectViewLiveData } from './objectViewLiveData.js';
import { useObjectViewIdentity } from './objectViewIdentity.js';
import { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';
import { useObjectViewHeaderToolbar } from './objectViewHeaderToolbar.js';
import { useObjectViewListUrlState, useObjectViewUrlFilters } from './objectViewListUrlState.js';
import { useObjectViewTabBar } from './objectViewTabBar.js';
import { useObjectViewPluginSchema } from './objectViewPluginSchema.js';
import { useObjectViewHeaderChrome } from './objectViewHeaderChrome.js';
import { ObjectViewPageHeader } from './objectViewPageHeader.js';
import { ObjectViewRecordOverlay } from './objectViewRecordOverlay.js';
import { useObjectViewListRenderer } from './objectViewListRenderer.js';
import { useObjectViewViewCrud } from './objectViewViewCrud.js';

// objectstack#25992 slice 1: these module-level helpers moved to the sibling
// `objectView*.ts` modules above. Every name this file exported stays
// exported from here, so imports by path keep resolving.
export { declaredPrimaryToolbarAction, selectFilterParams } from './objectViewHelpers.js';
export { listRecordDetailUrl, listRecordActionsValue } from './objectViewRecordLinks.js';
export type { ListRecordRoutes } from './objectViewRecordLinks.js';
export {
    defaultListColumnsFromObject,
    buildAddViewSpec,
    sanitizeViewOverride,
    loadViewOverrides,
    buildViewTabs,
    setDefaultViewPatches,
    buildViewConfigSaveBody,
} from './objectViewTabs.js';

// objectstack#25992 slice 2: the view-options family and `dispatchViewPatches`
// moved to `./objectViewOptions.ts`; every name exported here before stays
// exported from here, except `storedLegacyOptions`, retired with the `options`
// bag it read (#25923).
export {
    timelineViewOptions,
    calendarViewOptions,
    ganttViewOptions,
    galleryViewOptions,
    kanbanViewOptions,
    dispatchViewPatches,
} from './objectViewOptions.js';

// objectstack#25992 slice 3: `ObjectNotFoundState` moved to `./objectViewChrome.tsx`
// and stays exported from here (`AppContent` imports it by this path).
export { ObjectNotFoundState } from './objectViewChrome.js';

/**
 * Props of the Console `ObjectView`, the route-level object surface
 * `@object-ui/app-shell` exports (objectui#7483).
 *
 * The parameter used to be a bare `any`, which erased the prop NAMES as well as
 * their values: a misspelled prop compiled clean and was silently dropped. As an
 * object type, JSX excess-property checking now refuses a name that is not here,
 * and the two required members are refused when omitted.
 *
 * Named `ConsoleObjectViewProps` rather than `ObjectViewProps` because
 * `@object-ui/plugin-view` already owns that name for its schema-driven view,
 * a different shape (objectui#6172: one authority per exported type name).
 */
export interface ConsoleObjectViewProps {
    /** The host's data adapter — the published `DataSource` contract. */
    dataSource: DataSource;
    /**
     * The app's object definitions. The view resolves the route's
     * `:objectName` against this list and renders the "object not found"
     * state when it is absent.
     */
    objects: any[];
    /** Opens a record for editing (the toolbar's and the drawer's edit action). */
    onEdit: (record: Record<string, unknown>) => void;
    /**
     * Bumped by the host to refetch the list after a change made outside this
     * view (for example a record saved in a form the host owns).
     */
    externalRefreshKey?: number;
}

export function ObjectView({ dataSource, objects, onEdit, externalRefreshKey }: ConsoleObjectViewProps) {
    const { objectName } = useParams();

    // Resolve the object definition up front. When it's missing we render the
    // "object not found" empty state *here*, before the inner component mounts.
    // This is the key to keeping the Rules of Hooks satisfied: ObjectViewInner
    // holds ~50 hooks and must call them unconditionally, so the missing-object
    // branch lives in this thin wrapper instead of as a mid-component early
    // return. The inner subtree then mounts/unmounts as a whole (object exists
    // ↔ doesn't) rather than toggling the number of hooks executed per render.
    const objectDef = objects.find((o: any) => o.name === objectName);
    if (!objectDef) return <ObjectNotFoundState objectName={objectName} />;

    return (
      <ObjectViewInner
        dataSource={dataSource}
        objects={objects}
        onEdit={onEdit}
        externalRefreshKey={externalRefreshKey}
      />
    );
}

/**
 * Inner ObjectView body. Only mounted by {@link ObjectView} once the object
 * definition is known to exist, so every hook below runs unconditionally on
 * every render of this component — no early return sits between hook calls.
 */
function ObjectViewInner({ dataSource, objects, onEdit, externalRefreshKey }: ConsoleObjectViewProps) {
    const navigate = useNavigate();
    // The router's root href, basename included: the join every console host
    // publishing `recordHref` uses (`documentHref`, objectui#12233).
    const routerRootHref = useHref('/');
    const { appName, objectName, viewId } = useParams();
    // objectui#12606 — inside the Setup app the list drops its `#` row
    // numbers (see the `ListView` below). Read off
    // the route's own `:appName`, the one signal the page header reads too.
    const inSetup = isSetupAppSegment(appName);
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const { showDebug } = useMetadataInspector();
    const { t, language } = useObjectTranslation();
    const { objectLabel, objectPluralLabel, objectDescription: objectDesc, viewLabel, viewEmptyState, actionParamText, fieldLabel, fieldOptionLabel } = useObjectLabel();
    // The views a server read served — `/meta/view`, and the object document's
    // own `listViews` — already translated: their labels are drawn as given,
    // every other view's through `viewLabel` (objectui#11295, objectui#11336).
    const servedViews = useServedViewItems();
    // label + confirmText + successMessage through ONE call (objectui#4265).
    const localizeActionTexts = useActionTextLocalizer();
    // ADR-0105: under group posture default list columns get a trailing
    // organization_id attribution column (reads span all the user's orgs).
    const orgAttribution = useTenancyPosture() === 'group';
    // ADR-0034: runtime view edits persist via the metadata draft/publish
    // model (the `sys_view` table is retired).
    const metadataClient = useMetadataClient();

    // ADR-0037: in draft-preview mode (`?preview=draft`), `listViews()` reads
    // the draft-overlaid world so a view just created via "Add View" shows up
    // in the ViewTabBar before it is published. Normal mode sees published
    // views only (the publish gate stays intact).
    const previewDrafts = usePreviewDrafts();

    // Inline view config panel state (Airtable-style right sidebar)
    const [showViewConfigPanel, setShowViewConfigPanel] = useState(false);
    const [viewConfigPanelMode, setViewConfigPanelMode] = useState<'create' | 'edit'>('edit');
    // Airtable-style "Create view" dialog (type picker + name input)
    const [showCreateViewDialog, setShowCreateViewDialog] = useState(false);
    // Manage Views dialog (vertical sortable list of all views)
    const [manageViewsOpen, setManageViewsOpen] = useState(false);
    
    // Draft state for view config edits — cached locally, saved on demand
    const [viewDraft, setViewDraft] = useState<Record<string, any> | null>(null);
    
    // Record count tracking for footer
    const [recordCount, setRecordCount] = useState<number | undefined>(undefined);
    
    // Admin users automatically get design tools (no toggle needed)
    const { user, activeOrganization } = useAuth();
    const { isAdmin } = useWorkspaceAdminStatus();
    const perms = usePermissions();
    
    // Get Object Definition. The outer ObjectView wrapper already guards the
    // missing-object case, so this always resolves while this component is
    // mounted — every hook below can therefore run unconditionally.
    const objectDef = objects.find((o: any) => o.name === objectName);

    // The page's favorites entry, in the header's overflow menu (objectui#12427):
    // it pins the app's own navigation entry for this list when the app has one,
    // and keeps an `object:` favorite only for an object the app does not list.
    // The entry the list is starred under is named with the plural the title
    // reads (objectui#11733).
    const listFavorite = useObjectListFavorite({
        appSegment: appName,
        objectName,
        label: objectPluralLabel(objectDef),
    });
    // A view stored with no `label` is named by the object's plural label, on
    // its tab and on the record page's way back alike (objectui#12774).
    const unlabelledViewText = objectPluralLabel(objectDef);

    // Refresh trigger — bumped after view CRUD or this page's own data writes.
    const [ownRefreshKey, setRefreshKey] = useState(0);
    /**
     * objectui#10572 — the page's refresh signal: its own counter plus the
     * console's `externalRefreshKey` (record-form save, undo, redo), summed IN
     * THE RENDER that receives the prop. Both only grow, so the sum moves
     * whenever either does, and every reader below sees an external bump in the
     * same commit as the prop.
     *
     * It used to be MIRRORED instead: a passive effect copied each external
     * bump into this counter one commit later. The console declares the same
     * undo / redo on the data-invalidation bus in the same tick as the bump,
     * and `ListView` reads that bus, so the mirror split one write into two
     * list reads — the bus nonce in one commit, `refreshTrigger` in the next.
     * PR objectui#10494's contract is that a writer's two notices land in one
     * render; summing here keeps this host inside it. ⛔ Do not reintroduce the
     * mirror, and do not add `externalRefreshKey` on top of a value that still
     * mirrors it — either one reaches the list twice.
     */
    const refreshKey = ownRefreshKey + (typeof externalRefreshKey === 'number' ? externalRefreshKey : 0);

    /**
     * objectui#10035 — this page learned that the object's DATA changed by a
     * path that is not a data-source write the console's
     * `useMutationInvalidationBridge` announces: a server action, flow or API
     * action (raw HTTP), an import (`importRecords` emits no `onMutation`), a
     * realtime event (another user's write), an explicit refresh action, or a
     * delete this page ran. The counter reaches `ListView`'s own rows as
     * `refreshTrigger`; the renderers that query for themselves (`ObjectGrid`,
     * `ObjectGantt`, `ObjectChart`) read the data-invalidation bus instead, so
     * the change is declared there too — AGENTS.md #8's corollary. It used to
     * reach them only by remounting the whole list.
     *
     * View CRUD (rename, pin, reorder, config save) keeps bumping the counter
     * alone: it changes the view's metadata, not the object's data, and the new
     * view config reaches every renderer as props.
     *
     * objectui#13057 — a refresh also re-reads the saved views from the server.
     * The adapter answers `listViews` from the published view list it stored
     * for this open, so the refresh drops that list first; the counter bump
     * then re-runs the saved-views read below, which asks the server again.
     */
    const refreshData = useCallback(() => {
        dropPublishedViewList(dataSource);
        setRefreshKey((k) => k + 1);
        if (objectDef.name) notifyDataChanged({ objectName: objectDef.name });
    }, [dataSource, objectDef.name]);

    // Shared console action runtime: confirm/param/result dialogs, the
    // authenticated api/flow/server-action handlers, SPA navigation, and the
    // paused screen-flow runner. The same runtime PageView mounts (#1605).
    // ObjectView additionally feeds its confirm/toast handlers into
    // useObjectActions below, so it consumes the hook directly (rather than the
    // ConsoleActionRuntimeProvider wrapper).
    const actionRuntime = useConsoleActionRuntime({
        dataSource,
        objects,
        objectName: objectDef.name,
        onRefresh: refreshData,
        // A `type: 'form'` action on the list opens its form in this app's
        // shell (objectui#13433).
        routeAppSegment: appName,
    });
    const { confirmHandler, toastHandler } = actionRuntime;

    // Resolve which generic CRUD affordances belong in the toolbar for
    // this object's lifecycle bucket (`managedBy`).  config tables show
    // New/Edit/Delete but no CSV Import; system / append-only / better-auth
    // hide the lot — those flows go through purpose-built actions on the
    // source record (e.g. "Submit for Approval" on an Opportunity creates
    // an `sys_approval_request`).  Permissions still gate the buttons.
    // [objectstack#3391] Intersect the bucket affordances with the server's effective API
    // operation set for this object (from /me/permissions apiOperations), so the
    // toolbar never offers Import/Export/New/Edit/Delete the server would 405.
    // `undefined` (unrestricted object / old backend) leaves affordances as-is.
    // objectui#12082: New and Import are the `listNew` / `listImport` rows of
    // the affordance-to-grant map (`resolveAffordance` in `@object-ui/core`),
    // which ANDs the caller's create grant onto that intersection itself and
    // surfaces the row's `userActions` predicates only when all three allow it.
    // The identity-import bypass below is independent of the `listImport` row.
    const { newVerdict, importVerdict } = useMemo(() => {
      const source = { objectSchema: objectDef as SchemaLike, objectName: objectDef.name, perms };
      return {
        newVerdict: resolveAffordance('listNew', source),
        importVerdict: resolveAffordance('listImport', source),
      };
    }, [objectDef, perms]);

    // objectstack#25992 slice 7: environment entitlements, the list actions and the
    // create and import toolbar verdicts moved to `./objectViewToolbarAffordances.ts`.
    const {
        isEnvironmentList,
        environmentEntitlements,
        listActions,
        localizedToolbarActions,
        objectCanCreate,
        createVisible,
        createDisabled,
        listAddRecordOpensCreate,
        pageOffersCreate,
        objectCanImport,
        importVisible,
        importDisabled,
    } = useObjectViewToolbarAffordances({
        objectDef,
        dataSource,
        actionRuntime,
        refreshKey,
        perms,
        localizeActionTexts,
        newVerdict,
        importVerdict,
    });

    // Externally-triggered refreshes (e.g. global ModalForm submit, undo, redo)
    // reach every `refreshKey` reader through the sum declared with the counter
    // above (objectui#10572), not through a mirroring effect.

    // Import wizard open/close state — toolbar entry triggers it.
    const [showImport, setShowImport] = useState(false);

    // objectstack#25992 slice 5: identity import and the managed-environment Users
    // marker moved to `./objectViewIdentity.tsx`.
    const {
        identityImportEnabled,
        managedUsers,
        managedUserMarker,
        identityPasswordPolicy,
        setIdentityPasswordPolicy,
        identityDataSource,
    } = useObjectViewIdentity({ objectDef, isAdmin, dataSource, refreshKey, t, actionRuntime });

    // ─── User-defined views (metadata overlay) ──────────────────────────
    // Saved views created via the ViewConfigPanel ("Add View") live in the
    // metadata overlay (`/meta/view`). We fetch them via `listViews` and merge
    // into `views` so the ViewTabBar renders them alongside metadata-defined
    // listViews.
    const [savedViews, setSavedViews] = useState<any[]>([]);

    // objectui#12418 — the signed-in user's OWN list state for this object:
    // the tab order, and per view the sort, the Filter panel's conditions and
    // the column layout. A toolbar change writes here (`sys_user_preference`
    // `ui.list.<object>`, localStorage as the cache), never into the shared
    // view: the view's authored values stay the default for every user with
    // no preference. See `ListPreferencesProvider`.
    const listPrefs = useObjectListPreferences(objectName);
    // Content keys, not identities (AGENTS.md #10): the views memo and the list
    // relay re-run when what the user stored changes, and on nothing else.
    const prefViewOrderKey = JSON.stringify(listPrefs.preference.viewOrder ?? []);
    useEffect(() => {
        let cancelled = false;
        if (!objectName) {
            setSavedViews([]);
            return;
        }
        // Read saved views from the metadata overlay (`/meta/view`) via the
        // adapter's `listViews`. Adapters without it surface no saved views.
        if (typeof (dataSource as any)?.listViews === 'function') {
            (dataSource as any).listViews(objectName, { previewDrafts })
                .then((rows: any[]) => {
                    if (cancelled) return;
                    // Normalize: ensure each view has an `id` for ViewTabBar
                    // (which is name-keyed downstream).
                    //
                    // objectui#11013 — no `objectName` is stamped here any more.
                    // It was read `sv.objectName || sv.object`, the undeclared
                    // spelling first, and no reader of this array consumed the
                    // stamp: the handlers act on the route's `objectName`. What
                    // it did do was ride a saved view's whole-body toolbar save
                    // back into the stored row, an undeclared key the console
                    // itself minted. The row's bound object is its declared
                    // `object`, which `listViews()` carries.
                    const normalized = (rows || []).map((sv: any) => ({
                        ...sv,
                        // Overlay rows are keyed by `name`. Prefer that as the
                        // tab id so a duplicate's `id` field (which may have
                        // been copied verbatim from the source artifact) does
                        // not collide with the source's view id during dedup.
                        // `viewRowId` owns that rule for every consumer of this
                        // array too, so the key written here and the key read
                        // back cannot drift apart (objectui#4211).
                        id: viewRowId(sv),
                    }));
                    setSavedViews(normalized);
                })
                .catch((err: any) => {
                    console.error('[ObjectView] Failed to load overlay views:', err);
                    if (!cancelled) setSavedViews([]);
                });
            return () => { cancelled = true; };
        }
        // No overlay API available (e.g. a minimal adapter / test mock) → no
        // saved views. The retired `sys_view` table is no longer read.
        setSavedViews([]);
        return () => { cancelled = true; };
    }, [dataSource, objectName, refreshKey, previewDrafts]);

    // Persisted per-view config overrides: the rows stored under a view's id,
    // separately from `objectDef.listViews` (the embedded definition) — an
    // explicit save's, and the personalization overlays an earlier console's
    // toolbar wrote (that write retired in objectui#12504; the rows at rest are
    // still read). Org-wide shared settings (objectstack#7494's ruling), not a
    // per-user preference. Keyed by viewId → partial view config to merge.
    //
    // Reading strategy (batch first, per-view fallback) lives in the exported
    // `loadViewOverrides` above so it can be pinned directly — see its doc for
    // why an empty batch result is authoritative but a rejected one is not.
    const [viewOverrides, setViewOverrides] = useState<Record<string, any>>({});
    useEffect(() => {
        let cancelled = false;
        if (!dataSource || !objectName) {
            setViewOverrides({});
            return;
        }
        // `listViews` is canonical (#5362; @objectstack/spec declares only camelCase). The
        // `list_views` leg is a compatibility READ for stored pre-settlement documents
        // (that stock has never been censused: objectstack#7917). Never WRITE the snake key.
        const definedViews = (objectDef.listViews || objectDef.list_views || {}) as Record<string, any>;
        const ids = Object.keys(definedViews);
        // Include the primary view id so overrides apply to it too. Its identity
        // comes from the view composer (objectui#3770) — the same id the override
        // was persisted under, since a view's stored row is named by its view id.
        const primaryId = defaultListViewId(objectDef.name, (objectDef as any).list);
        if (primaryId && !ids.includes(primaryId)) ids.unshift(primaryId);
        if (ids.length === 0) {
            setViewOverrides({});
            return;
        }

        loadViewOverrides(dataSource, objectName, ids).then((map) => {
            if (!cancelled) setViewOverrides(map);
        });
        return () => { cancelled = true; };
    }, [dataSource, objectName, objectDef.listViews, objectDef.list_views, (objectDef as any).list, refreshKey]);

    // Resolve Views from objectDef.listViews (camelCase per @objectstack/spec)
    const { list: views, derivedColumnViewIds } = useMemo(() => {
        // Default columns for the auto-generated "所有记录" view (and any saved
        // grid view with no explicit columns). `highlightFields` (ADR-0085) wins;
        // otherwise the first business fields — framework-injected system / audit
        // / ownership columns (notably the non-readonly `owner_id`) are excluded
        // by the shared classifier. #2702 applied this to ObjectGrid /
        // InterfaceListPage; this view resolves its columns here (#2777).
        const resolveDefaultColumns = (): string[] =>
            defaultListColumnsFromObject(objectDef, 5, { orgAttribution });

        const viewList = buildViewTabs({
            definedViews: objectDef.listViews || objectDef.list_views || {},
            primary: (objectDef as any).list,
            primaryId: defaultListViewId(objectDef.name, (objectDef as any).list),
            savedViews,
            viewOverrides,
            // No `columns` here: the fill below derives them, and records
            // the tab as one whose columns the author never declared.
            fallbackTab: () => ({
                id: 'all',
                label: t('console.objectView.allRecords'),
                type: 'grid',
            }),
        });

        // Apply default columns to any grid-like view that has no explicit
        // columns (e.g. saved views created via "Add View" before the user
        // configured fields). Without this, the grid renders an empty header
        // row and the data fetch omits a `select` clause.
        //
        // objectui#10694 — the fill DRAWS defaults; it does not DECLARE a
        // projection. `ListViewSchema.columns` (spec source at objectstack
        // `origin/main`, objectstack#19598): "An empty list declares no
        // projection, so neither of them applies" — `hiddenFields` and
        // `fieldOrder`. So every tab filled here is recorded, and the relay
        // applies neither key to it (see `activeViewDeclaresColumns`). An
        // ABSENT `columns` reads the same as an empty one: the spec requires
        // the key, so absence declares no projection either.
        const GRID_LIKE = new Set(['grid', 'list', 'table']);
        const derived = new Set<string>();
        for (const v of viewList) {
            if (!GRID_LIKE.has(v.type)) continue;
            if (!Array.isArray(v.columns) || v.columns.length === 0) {
                v.columns = resolveDefaultColumns();
                derived.add(v.id);
            }
        }

        // Stable sort: respect the user's own view-order preference (for both
        // metadata and saved views; objectui#12418, `listPrefs`). Falls back
        // to: metadata views first in declared order, then saved views by
        // `sortOrder` / created_at — the authored order, every user's default.
        const indexOf = new Map(viewList.map((v, i) => [v.id, i]));
        const userOrder: string[] = JSON.parse(prefViewOrderKey);
        const userOrderIndex = new Map(userOrder.map((id, i) => [id, i]));
        viewList.sort((a, b) => {
            const aUser = userOrderIndex.get(a.id);
            const bUser = userOrderIndex.get(b.id);
            if (aUser !== undefined && bUser !== undefined) return aUser - bUser;
            if (aUser !== undefined) return -1;
            if (bUser !== undefined) return 1;
            const aSaved = savedViews.find((sv: any) => viewRowId(sv) === a.id);
            const bSaved = savedViews.find((sv: any) => viewRowId(sv) === b.id);
            const aHasOrder = aSaved && typeof aSaved.sortOrder === 'number';
            const bHasOrder = bSaved && typeof bSaved.sortOrder === 'number';
            // Only an explicit user `sortOrder` should reorder views away from
            // the metadata-declared sequence. A bare overlay row (no sortOrder)
            // must not demote a metadata view: that would break primary-view
            // promotion (which relies on declared order) for objects whose
            // overlay seeded a baseline `sys_view` row without sort info.
            if (aHasOrder && bHasOrder) {
                if (aSaved.sortOrder !== bSaved.sortOrder) {
                    return aSaved.sortOrder - bSaved.sortOrder;
                }
                return (aSaved.created_at || '').localeCompare(bSaved.created_at || '');
            }
            if (aHasOrder) return -1;
            if (bHasOrder) return 1;
            return (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0);
        });

        return { list: viewList, derivedColumnViewIds: derived };
    }, [objectDef, savedViews, viewOverrides, t, orgAttribution, prefViewOrderKey]);

    // Active View State — merge saved draft if available for this view.
    // Resolution priority: URL viewId → ?view= → user-marked default → first.
    const defaultViewId = useMemo(() => {
        const def = views.find((v: any) => v.isDefault);
        return def?.id;
    }, [views]);
    // Canonical view ids are fully qualified (`<object>.<viewKind>`, see
    // MetadataProvider), but nav items emit `viewName` verbatim — usually
    // the short form — and legacy embedded listViews carry bare keys (incl.
    // the `'all'` fallback). Resolve the URL-requested name in both
    // directions, and never swallow a miss silently (#2217).
    const requestedViewId = viewId || searchParams.get('view') || undefined;
    const resolvedViewId = useMemo(
        () => resolveViewId(requestedViewId, views.map((v: any) => v.id), objectDef.name),
        [requestedViewId, views, objectDef.name],
    );
    useEffect(() => {
        if (requestedViewId && !resolvedViewId) {
            console.warn(
                `[ObjectView] Requested view "${requestedViewId}" not found on object "${objectDef.name}"; ` +
                `falling back to the default view. Known views: ${views.map((v: any) => v.id).join(', ')}`,
            );
        }
    }, [requestedViewId, resolvedViewId, objectDef.name, views]);
    // objectui#12112 — a requested view that missed may be one the server
    // refuses this caller: `/meta/view` lists only the views they may open
    // (objectstack#22731), so the switcher never carries it, while a URL still
    // can. The by-name read tells a refusal from absence. It is asked by the
    // canonical `OBJECT.KEY` name that route addresses a view item by (a short
    // name is the key), and not in draft preview, whose list is the draft
    // world while the probe reads the published one. A refusal replaces the
    // list below; any other answer keeps the fall-back to the default view.
    const missedViewName = requestedViewId && !resolvedViewId && !previewDrafts
        ? (requestedViewId.includes('.') ? requestedViewId : `${objectDef.name}.${requestedViewId}`)
        : null;
    const viewAccess = useMetaItemRefusal('view', missedViewName);
    const activeViewId = resolvedViewId || defaultViewId || views[0]?.id;
    const baseView = views.find((v: any) => v.id === activeViewId) || views[0];
    const activeView = viewDraft && viewDraft.id === baseView?.id
        ? { ...baseView, ...viewDraft }
        : baseView;

    // objectstack#25992 slice 8: the header toolbar actions, the nav `runAction` deep link
    // and the `action:bar` node moved to `./objectViewHeaderToolbar.ts`.
    const { headerToolbarActions, toolbarActionsWithDeepLink, toolbarBar } = useObjectViewHeaderToolbar({
        activeView,
        localizedToolbarActions,
        isEnvironmentList,
    });
    // objectstack#25992 slice 8: the list's toolbar state in the URL (seed, write-back,
    // "Reset view") moved to `./objectViewListUrlState.ts`.
    const {
        listIdentityKey,
        listSeedRef,
        ownListParamsRef,
        writeListUrlState,
        activeViewHasPreference,
        handleResetView,
    } = useObjectViewListUrlState({
        objectName,
        objectDef,
        activeView,
        listPrefs,
        perms,
        user,
        searchParams,
        setSearchParams,
    });

    // objectstack#25992 slice 11b: the view-config save and create handlers, view switching,
    // the mobile view switcher and the view-tab CRUD callbacks moved to `./objectViewViewCrud.tsx`.
    const {
        handleViewConfigSave,
        handleViewCreate,
        handleViewUpdate,
        handleViewChange,
        handleCreateView,
        handleViewAction,
        handleRenameView,
        handleDeleteView,
        handlePinView,
        handleSetDefaultView,
        handleReorderViews,
        handleConfigView,
        handleAddView,
    } = useObjectViewViewCrud({
        dataSource,
        objects,
        navigate,
        objectName,
        viewId,
        t,
        language,
        viewLabel,
        servedViews,
        metadataClient,
        previewDrafts,
        setShowViewConfigPanel,
        setViewConfigPanelMode,
        setShowCreateViewDialog,
        setViewDraft,
        objectDef,
        unlabelledViewText,
        setRefreshKey,
        confirmHandler,
        savedViews,
        listPrefs,
        views,
        activeViewId,
        baseView,
    });

    // Current user — also used below for `{current_user_id}` filter-token
    // substitution. The schema-action handlers (toast/navigate/api/flow/server)
    // now live in the shared `useConsoleActionRuntime` hook (declared earlier).
    const currentUser = user
        ? { id: user.id, name: user.name, avatar: user.image }
        : FALLBACK_USER;

    // Session scope for filter placeholders. Memoised so the resolved filter
    // identity is stable across renders — it feeds view schemas below.
    const filterScope = useMemo<FilterTokenScope>(
        () => ({ currentUserId: currentUser.id, currentOrgId: activeOrganization?.id ?? null }),
        [currentUser.id, activeOrganization?.id],
    );

    // Action system for toolbar operations — refreshKey moved up (declared earlier).
    // Wired to confirmHandler/toastHandler so deletes use the Shadcn AlertDialog
    // and Sonner toast instead of native window.confirm.
    const actions = useObjectActions({
        objectName: objectDef.name,
        // The label this page shows (its header and breadcrumb read the same
        // `objectLabel`), so the delete confirmation that names the record
        // (objectui#11695) and the delete toasts read it in the session's
        // language; with no translation bundle it is `objectDef.label`.
        objectLabel: objectLabel(objectDef),
        objectDef,
        dataSource,
        onEdit,
        onRefresh: refreshData,
        onConfirm: confirmHandler,
        // ToastHandler's `type` is a string-literal union — a subset of the
        // looser `{ type?: string }` useObjectActions declares; cast is sound.
        onToast: toastHandler as (message: string, options?: { type?: string }) => void,
    });

    // objectstack#25992 slice 4: the realtime refresh, conflict resolution and
    // footer record count moved to `./objectViewLiveData.ts`; the count state stays here.
    useObjectViewLiveData({ dataSource, objectDef, refreshData, refreshKey, setRecordCount });

    // objectstack#25992 slice 6: the record navigation overlay (drawer state in the
    // URL, row click, expand to page, record links) moved to `./objectViewRecordNavigation.ts`.
    // objectstack#26677 — the side-by-side pane is a READER's preference, not a
    // `navigation.mode` (`split` left the spec). Live state: the Display menu's
    // Open records section writes it (objectstack#26681) and the next row click
    // opens the new way. It applies only to a record that opens in the drawer:
    // an object that declares `page` (or `new_window` / `none`) keeps its
    // declaration.
    const [recordOpenPreference, setRecordOpenPreference] = useRecordOpenPreference();
    const { listRecordActions, navOverlay, handleDrawerClose, handleRowClick, handleExpandDrawer, drawerRoot, drawerRestore, handleListRowsChange, handleRootStep } = useObjectViewRecordNavigation({
        activeView,
        objectDef,
        objects,
        appName,
        viewId,
        searchParams,
        setSearchParams,
        location,
        navigate,
        routerRootHref,
        servedViews,
        viewLabel,
        unlabelledViewText,
        language,
    });
    // The split face draws the drawer's own record beside the list: same URL
    // state (`?recordId=`), same close, a different shell.
    const opensBesideList = recordOpenPreference === 'split' && navOverlay.mode === 'drawer';
    // objectstack#26681 — the Display menu's Open records section: the mode this
    // object and view resolved to, and the reader's preference with its setter.
    const recordOpen = useMemo<NonNullable<ListViewProps['recordOpen']>>(
        () => ({ resolvedMode: navOverlay.mode, preference: recordOpenPreference, setPreference: setRecordOpenPreference }),
        [navOverlay.mode, recordOpenPreference, setRecordOpenPreference],
    );
    // objectstack#26681 — the name cell's ↗, "open as full page", for a row that
    // opens the drawer (or the pane beside the list). A `page` object's row
    // already opens the page; a `new_window` / `none` one keeps its declaration.
    const openAsPageLabel = t('console.objectView.openAsPage', { defaultValue: 'Open as full page' });
    const openAsPage = useMemo(
        () => (navOverlay.mode === 'drawer' ? { objectName: objectDef.name, label: openAsPageLabel } : null),
        [navOverlay.mode, objectDef.name, openAsPageLabel],
    );

    // objectstack#25992 slice 8: the `filter[...]` URL equality filters and the `uf_*`
    // user-filter selections moved to `./objectViewListUrlState.ts`.
    const { urlFilters, initialUfSelections, handleUserFilterSelectionsChange } = useObjectViewUrlFilters({
        searchParams,
        setSearchParams,
        listIdentityKey,
        ownListParamsRef,
    });

    // objectstack#25992 slice 9: the view tab items, the `ViewTabBar` strip and its
    // own-row face moved to `./objectViewTabBar.tsx`.
    const { viewTabItems, viewTabBar, viewTabRow } = useObjectViewTabBar({
        views,
        savedViews,
        objectDef,
        servedViews,
        viewLabel,
        unlabelledViewText,
        language,
        t,
        viewAccess,
        activeViewId,
        handleViewChange,
        isAdmin,
        handleAddView,
        handleRenameView,
        handleDeleteView,
        handlePinView,
        handleSetDefaultView,
        handleConfigView,
        setManageViewsOpen,
    });

    // objectstack#25992 slice 11a: the column-declaration flags, the held list refs and
    // `renderListView` moved to `./objectViewListRenderer.tsx`.
    const { renderListView } = useObjectViewListRenderer({
        objectName,
        inSetup,
        t,
        viewEmptyState,
        localizeActionTexts,
        viewDraft,
        user,
        objectDef,
        refreshKey,
        listAddRecordOpensCreate,
        pageOffersCreate,
        managedUsers,
        managedUserMarker,
        savedViews,
        listPrefs,
        derivedColumnViewIds,
        baseView,
        activeView,
        listIdentityKey,
        listSeedRef,
        writeListUrlState,
        filterScope,
        actions,
        handleRowClick,
        handleListRowsChange,
        navOverlay,
        recordOpen,
        openAsPage,
        urlFilters,
        initialUfSelections,
        handleUserFilterSelectionsChange,
        viewTabRow,
        viewTabBar,
    });

    // objectstack#25992 slice 9: the merged views and the plugin's `ObjectViewSchema`
    // moved to `./objectViewPluginSchema.ts`.
    const { mergedViews, objectViewSchema } = useObjectViewPluginSchema({
        views,
        activeViewId,
        viewDraft,
        activeView,
        objectDef,
        onEdit,
        isAdmin,
        location,
        navigate,
        viewId,
        servedViews,
        viewLabel,
        unlabelledViewText,
        language,
    });

    // objectstack#25992 slice 9: the header's create button, folded actions menu and
    // the refused-view face moved to `./objectViewHeaderChrome.tsx`.
    const {
        showCreate,
        listFabClearance,
        createButton,
        importShown,
        foldedHeaderActions,
        refusedViewFace,
    } = useObjectViewHeaderChrome({
        objectCanCreate,
        createVisible,
        createDisabled,
        actions,
        t,
        listActions,
        toolbarActionsWithDeepLink,
        identityImportEnabled,
        objectCanImport,
        importVisible,
        importDisabled,
        setShowImport,
        listFavorite,
        activeViewHasPreference,
        handleResetView,
        isEnvironmentList,
        toolbarBar,
        viewAccess,
    });

    return (
        <ActionProvider {...actionRuntime.actionProviderProps}>
        <RelatedRecordActionsProvider value={listRecordActions}>
        <div className="h-full flex flex-col bg-background min-w-0 overflow-hidden">
             {/* 1. Header with breadcrumb + description.
                 The managed-by badge sits inline with the title so the
                 lifecycle bucket (system / config / append-only /
                 better-auth) is communicated at a glance to an authoring
                 caller — it draws for no one else (objectui#12194); the previous
                 full-width banner was deliberately removed because it
                 (a) leaked engine-internal terminology and (b) repeated
                 itself on list/detail/form for the same record.

                 Mobile: hide the entire PageHeader. The title is already
                 surfaced in the top bar (e.g. "线索"), so re-rendering
                 the icon-pill + title again wastes ~60px of viewport
                 chrome that real-app conventions (Gmail / Notion / Linear)
                 reclaim for content. The create / import / overflow
                 actions move to a floating action button (see below). */}
             {/* objectstack#25992 slice 10: the header moved to `./objectViewPageHeader.tsx`. */}
             <ObjectViewPageHeader
                 objectDef={objectDef}
                 objectPluralLabel={objectPluralLabel}
                 objectDesc={objectDesc}
                 createButton={createButton}
                 importShown={importShown}
                 setShowImport={setShowImport}
                 importDisabled={importDisabled}
                 t={t}
                 listActions={listActions}
                 isEnvironmentList={isEnvironmentList}
                 headerToolbarActions={headerToolbarActions}
                 environmentEntitlements={environmentEntitlements}
                 toolbarBar={toolbarBar}
                 listFavorite={listFavorite}
                 activeViewHasPreference={activeViewHasPreference}
                 handleResetView={handleResetView}
                 foldedHeaderActions={foldedHeaderActions}
             />

             {/* Floating "+" action button — phone-only counterpart to the
                 PageHeader's primary create action we just hid. Positioned
                 above the bottom mobile-nav (h-12 + safe-area) so it
                 doesn't collide with it. Hidden on tablets/desktops
                 because the inline header button is already visible.

                 [#5153] Second render point of the SAME affordance, so it
                 consumes the SAME `objectCanCreate && createVisible` /
                 `createDisabled` pair as the header button — a phone user and a
                 desktop user must not get different verdicts for one
                 `userActions.create` declaration.

                 DISABLED, on a control with no greyed form of its own: this is
                 a bare `<button>`, not the design system's `Button`, so it
                 carries none of the latter's `disabled:` treatment. Rather than
                 collapse the three states to two (which would map
                 `disabledWhen` onto "hidden" and lose the distinction the spec
                 draws between hidden and greyed), it takes the native
                 `disabled` — which is what conveys the state to assistive tech
                 — plus the same `disabled:opacity-50
                 disabled:pointer-events-none` utilities `Button` itself uses,
                 so the visual affordance matches the header button's.

                 objectui#13134 — the list it floats over leaves room at its
                 end while it is drawn (`listFabClearance`), and only then: the
                 same `showCreate` decides both. */}
             {showCreate && (
               <button
                 type="button"
                 onClick={actions.create}
                 disabled={createDisabled}
                 className="sm:hidden fixed right-4 bottom-36 z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform inline-flex items-center justify-center disabled:opacity-50 disabled:pointer-events-none"
                 aria-label={t('console.objectView.new')}
                 data-testid="mobile-fab-create"
               >
                 <Plus className="h-5 w-5" />
               </button>
             )}

             {/* CSV Import wizard (lazy-loaded) — opened from the toolbar
                 button above. On completion we bump refreshKey to re-fetch
                 the list so newly-imported rows show up. */}
             {showImport && (
               <Suspense fallback={null}>
                 <ImportWizard
                   open={showImport}
                   onOpenChange={setShowImport}
                   objectName={objectDef.name}
                   objectLabel={objectLabel(objectDef)}
                   fields={identityImportEnabled
                     // Identity import has a curated target set — the generic
                     // writable-field filter below would drop phone_number
                     // (readonly for CRUD; identity writes go through
                     // better-auth, framework#2782).
                     ? identityImportFields(objectDef.fields)
                     // Writable fields as WRITE targets + storage-backed
                     // readonly/autonumber fields as MATCH-ONLY targets (so
                     // update/upsert can match on the record number, #020) —
                     // see importTargetFields for the full derivation.
                     : importTargetFields(objectDef.name, objectDef.fields, perms)}
                   dataSource={identityDataSource ?? dataSource}
                   {...(identityImportEnabled ? {
                     // Offer only the modes the identity door accepts — the
                     // same constant its refusal reads (objectui#12697).
                     writeModes: IDENTITY_IMPORT_WRITE_MODES,
                     extraOptionsContent: (
                       <IdentityImportOptions
                         policy={identityPasswordPolicy}
                         onPolicyChange={setIdentityPasswordPolicy}
                       />
                     ),
                     renderResultExtra: (res: any) => (
                       <IdentityImportResultExtra serverResult={res?.serverResult} />
                     ),
                   } : {})}
                   onComplete={(result) => {
                     refreshData();
                     const ok = result.importedRows;
                     const skip = result.skippedRows;
                     if (skip > 0) {
                       toast.warning(t('console.objectView.importedWithSkipped', { ok, skipped: skip }));
                     } else if (ok > 0) {
                       toast.success(t('console.objectView.importedToast', { count: ok }));
                     }
                   }}
                 />
               </Suspense>
             )}

             {/* View Tabs — drawn in the list's toolbar row (`viewTabBar`,
                 objectui#12440). The one exception is a view the server
                 refused: no list is drawn, so no toolbar can carry the strip,
                 and the tabs are the way off that view — they keep a row of
                 their own there (`viewTabRow`, which a chart view draws
                 above its chart too, objectui#13114). Below `sm` the mobile
                 view switcher is
                 rendered by AppHeader via MobileViewSwitcherContext
                 (registered above). */}
             {refusedViewFace && viewTabRow}
             {isAdmin && views.length >= 1 && (
               <ManageViewsDialog
                 open={manageViewsOpen}
                 onOpenChange={setManageViewsOpen}
                 views={viewTabItems}
                 activeViewId={activeViewId}
                 viewTypeIcons={VIEW_TYPE_ICONS}
                 onRename={handleRenameView}
                 onDelete={handleDeleteView}
                 onSetDefault={handleSetDefaultView}
                 onSetPinned={handlePinView}
                 onReorder={handleReorderViews}
                 onAddView={handleAddView}
                 onConfigView={handleConfigView}
               />
             )}

             {/* objectui#13330 — where people are invited on a managed environment. */}
             {managedUsers && <ManagedUsersInviteLine t={t} />}

             {/* 2. Content — Plugin ObjectView with ViewSwitcher + Filter + Sort */}
             <div className="flex-1 overflow-hidden relative flex flex-row">
                {opensBesideList && navOverlay.isOpen ? (
                    <NavigationOverlay
                        {...navOverlay}
                        mode="split"
                        close={handleDrawerClose}
                        setIsOpen={(open: boolean) => { if (!open) handleDrawerClose(); }}
                        title={objectLabel(objectDef)}
                        onExpand={handleExpandDrawer}
                        expandLabel={t('console.objectView.expandToPage', { defaultValue: 'Open as full page' })}
                        storageKey={`drawer-width:${objectDef.name}`}
                        mainContent={
                            <div className="flex-1 min-w-0 relative h-full flex flex-col">
                                <div className="flex-1 relative overflow-hidden">
                                    <div className={['h-full overflow-auto', listFabClearance].filter(Boolean).join(' ')}>
                                        {refusedViewFace ?? (viewAccess.checking ? null : (
                                        <PluginObjectView
                                            schema={objectViewSchema}
                                            dataSource={dataSource}
                                            views={mergedViews}
                                            activeViewId={activeViewId}
                                            onViewChange={handleViewChange}
                                            onEdit={(record: any) => onEdit?.(record)}
                                            onRowClick={(record: any, event?: any) => {
                                                handleRowClick(record, event);
                                            }}
                                            renderListView={renderListView}
                                            onCreateView={handleCreateView}
                                            hideNamedViewTabs
                                            onViewAction={handleViewAction}
                                        />
                                        ))}
                                    </div>
                                </div>
                                {typeof recordCount === 'number' && (
                                    <div data-testid="record-count-footer" className="border-t px-3 sm:px-4 py-1.5 text-xs text-muted-foreground bg-muted/5 shrink-0">
                                        {/* One count family, like `ListView`'s record-count bar
                                            (objectui#11445): i18next picks the CLDR slot. */}
                                        {t('console.objectView.recordCount', { count: recordCount })}
                                    </div>
                                )}
                            </div>
                        }
                    >
                        {(record: Record<string, unknown>) => {
                            const recordId = (record.id || record._id) as string;
                            return (
                                <RecordDetailView
                                    dataSource={dataSource}
                                    objects={objects}
                                    onEdit={onEdit}
                                    objectNameOverride={objectDef.name}
                                    recordIdOverride={recordId}
                                    embedded
                                />
                            );
                        }}
                    </NavigationOverlay>
                ) : (
                <div className="flex-1 min-w-0 relative h-full flex flex-col">
                    <div className="flex-1 relative overflow-hidden">
                        {/* objectui#13134 — `listFabClearance`: room at the
                            end of the card list's scroller for the phone FAB. */}
                        <div className={['h-full overflow-auto', listFabClearance].filter(Boolean).join(' ')}>
                            {refusedViewFace ?? (viewAccess.checking ? null : (
                            <PluginObjectView
                                schema={objectViewSchema}
                                dataSource={dataSource}
                                views={mergedViews}
                                activeViewId={activeViewId}
                                onViewChange={handleViewChange}
                                onEdit={(record: any) => onEdit?.(record)}
                                onRowClick={(record: any, event?: any) => {
                                    handleRowClick(record, event);
                                }}
                                renderListView={renderListView}
                                onCreateView={handleCreateView}
                                hideNamedViewTabs
                                onViewAction={handleViewAction}
                            />
                            ))}
                        </div>
                    </div>
                    {/* Record count footer removed — ListView already renders record-count-bar */}
                </div>
                )}
                {/* Metadata panel only shows for admin users */}
                <MetadataPanel
                    open={showDebug && isAdmin}
                    sections={[
                        { title: 'View Configuration', data: activeView },
                        { title: 'Object Definition', data: objectDef },
                    ]}
                />
                {/* Inline View Config Panel — Airtable-style right sidebar with slide animation */}
                <div
                    data-testid="view-config-panel-wrapper"
                    className={`transition-[max-width,opacity] duration-300 ease-in-out overflow-hidden ${
                        showViewConfigPanel && isAdmin ? 'max-w-[280px] opacity-100' : 'max-w-0 opacity-0'
                    }`}
                >
                    <ViewConfigPanel
                        open={showViewConfigPanel && isAdmin}
                        onClose={() => { setShowViewConfigPanel(false); setViewConfigPanelMode('edit'); }}
                        mode={viewConfigPanelMode}
                        activeView={activeView}
                        objectDef={objectDef}
                        recordCount={recordCount}
                        onSave={handleViewConfigSave}
                        onViewUpdate={handleViewUpdate}
                        onCreate={handleViewCreate}
                        metadataClient={metadataClient}
                        dataSource={dataSource}
                        onAfterChange={() => setRefreshKey(k => k + 1)}
                    />
                </div>
                <CreateViewDialog
                    open={showCreateViewDialog && isAdmin}
                    onOpenChange={setShowCreateViewDialog}
                    existingLabels={views.map((v: any) => v.label).filter(Boolean)}
                    objectDef={objectDef}
                    onCreate={(cfg) => handleViewCreate(cfg)}
                />
             </div>

             {/* Record Detail Overlay — the drawer, unless the reader prefers the pane beside the list */}
             {!opensBesideList && (
             /* objectstack#25992 slice 10: the overlay moved to `./objectViewRecordOverlay.tsx`. */
             <ObjectViewRecordOverlay
                 navOverlay={navOverlay}
                 handleDrawerClose={handleDrawerClose}
                 objectDef={objectDef}
                 handleExpandDrawer={handleExpandDrawer}
                 drawerRoot={drawerRoot}
                 drawerRestore={drawerRestore}
                 handleRootStep={handleRootStep}
                 t={t}
                 dataSource={dataSource}
                 objects={objects}
                 onEdit={onEdit}
             />
             )}
        </div>
        {actionRuntime.dialogs}
        </RelatedRecordActionsProvider>
        </ActionProvider>
    );
}