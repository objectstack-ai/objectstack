/**
 * The view management handlers of the Console `ObjectView` (`./ObjectView.tsx`):
 * the view-config panel's save and create doors, the draft field update, view
 * switching, the mobile view switcher registration, and the view-tab CRUD
 * callbacks (rename, delete, pin, set default, reorder, configure, add), moved
 * out of `ObjectViewInner` verbatim (objectstack#25992, slice 11b). The panel and
 * dialog state stays in the component; every input is passed in, and the
 * component reads the returned handlers.
 */

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { useNavigate } from 'react-router-dom';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { toast } from 'sonner';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { useObjectListPreferences } from '../context/ListPreferencesProvider.js';
import { PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE } from '../preview/PreviewModeContext.js';
import type { usePreviewDrafts } from '../preview/PreviewModeContext.js';
import { useMobileViewSwitcherRegistration } from '../layout/MobileViewSwitcherContext.js';
import type { MobileViewSwitcherItem } from '../layout/MobileViewSwitcherContext.js';
import { isSavedViewId } from '../utils/viewIdentity.js';
import type { useServedViewItems } from '../hooks/useServedViewItems.js';
import type { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import type { useMetadataClient } from './metadata-admin/useMetadata.js';
import { persistRuntimeMetadata, createRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence.js';
import { VIEW_TYPE_ICONS } from './objectViewHelpers.js';
import { buildAddViewSpec, setDefaultViewPatches, buildViewConfigSaveBody } from './objectViewTabs.js';
import type { buildViewTabs } from './objectViewTabs.js';
import { dispatchViewPatches } from './objectViewOptions.js';
import { viewTabLabel } from './viewTabLabel.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewViewCrud({
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
}: {
    dataSource: ConsoleObjectViewProps['dataSource'];
    objects: ConsoleObjectViewProps['objects'];
    navigate: ReturnType<typeof useNavigate>;
    objectName: string | undefined;
    viewId: string | undefined;
    t: ReturnType<typeof useObjectTranslation>['t'];
    language: ReturnType<typeof useObjectTranslation>['language'];
    viewLabel: ReturnType<typeof useObjectLabel>['viewLabel'];
    servedViews: ReturnType<typeof useServedViewItems>;
    metadataClient: ReturnType<typeof useMetadataClient>;
    previewDrafts: ReturnType<typeof usePreviewDrafts>;
    setShowViewConfigPanel: Dispatch<SetStateAction<boolean>>;
    setViewConfigPanelMode: Dispatch<SetStateAction<'create' | 'edit'>>;
    setShowCreateViewDialog: Dispatch<SetStateAction<boolean>>;
    setViewDraft: Dispatch<SetStateAction<Partial<ReturnType<typeof buildViewTabs>[number]> | null>>;
    objectDef: ConsoleObjectViewProps['objects'][number];
    unlabelledViewText: string;
    setRefreshKey: Dispatch<SetStateAction<number>>;
    confirmHandler: ReturnType<typeof useConsoleActionRuntime>['confirmHandler'];
    savedViews: Parameters<typeof buildViewTabs>[0]['savedViews'];
    listPrefs: ReturnType<typeof useObjectListPreferences>;
    views: ReturnType<typeof buildViewTabs>;
    activeViewId: string | undefined;
    baseView: ReturnType<typeof buildViewTabs>[number];
}) {
    // objectui#12504 — no toolbar control writes the shared view. The sort and
    // the column layout (objectui#12418), the density and the Hide Fields
    // popover (objectui#12474) are the user's own list state (`listPrefs`), and
    // the shared view is written only by an explicit save
    // (`handleViewConfigSave`, below). The toolbar-to-view writer that lived
    // here, `persistViewPatch`, retired with the adapter method it was the last
    // caller of. ⛔ Do not bring one back: `ObjectView.overlayPatchOnly.test.ts`
    // pins its absence.

    /*
     * There is deliberately NO `persistViewFilter` here (objectui#4155).
     *
     * The list toolbar's filter panel is the USER's state — it belongs to the
     * session and to that user's own list state (`listPrefs`, objectui#12418),
     * not to the view's stored body. It used to persist: every `onFilterChange` the panel
     * emitted was folded and written to the view overlay, so merely opening the
     * panel and clicking `Add filter` wrote an incomplete `field equals ''`
     * condition into `sys_metadata` — which then REPLACED the source-declared
     * `filter` for every user of that view and emptied the list, unrecoverably
     * from the panel itself.
     *
     * The threshold for writing a view overlay is an EXPLICIT save:
     * `handleViewConfigSave` (the view config panel) and `handleSaveAsView`
     * (`ObjectDataPage`). `ObjectDataPage` already made this choice for the
     * sibling surface — "Deliberately NO onSortChange/onFilterChange
     * persistence hooks: this surface never writes back to any saved view"
     * (#2251) — and this surface was the outlier.
     *
     * `foldFilterGroupToSpecRules` (objectstack#5159) is still the one dialect
     * for those explicit paths — the Studio inspector's `FilterBuilderField`
     * folds through it. What is gone is the automatic write, not the fold.
     */

    /**
     * The view-config panel's edit Save. Resolves whether the draft was staged,
     * so the panel stays dirty, and announces no draft, on anything but `true`
     * (objectui#11583).
     */
    const handleViewConfigSave = useCallback(async (draft: Record<string, any>): Promise<boolean> => {
        setViewDraft(draft);
        setRefreshKey(k => k + 1);

        // ADR-0034: stage a per-item draft via the metadata seam; an explicit
        // Publish (RuntimeDraftBar) promotes it + records a version.
        const vid = draft.id;
        if (!metadataClient || !vid) {
            console.warn('[ViewConfigPanel] Cannot persist view config: missing metadataClient or viewId.');
            return false;
        }
        try {
            // `dataSource` + `objectName` let the seam drop this object's view
            // cache keys (#4373) — the adapter owns which keys those are.
            await persistRuntimeMetadata('view', vid, buildViewConfigSaveBody(objectName, draft), {
                metadataClient,
                dataSource,
                objectName,
            });
            return true;
        } catch (err) {
            console.error('[ViewConfigPanel] Failed to persist view config:', err);
            // objectui#11583: a refused save is SAID, with the door's own
            // message, as the Create View doors do (objectui#11578).
            toast.error(t('form.saveError'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
            return false;
        }
    }, [metadataClient, dataSource, objectName, t]);

    /**
     * Create a new view: the Create View dialog's door and the view-config
     * panel's create mode. Resolves whether the view was saved, so the dialog
     * closes only on `true` (objectui#11578).
     */
    const handleViewCreate = useCallback(async (config: Record<string, any>): Promise<boolean> => {
        try {
            let createdId: string | undefined;
            if (metadataClient) {
                // ADR-0005 overlay path — write the full spec under a unique
                // `name` via the metadata customization API instead of into
                // the physical `sys_view` table (whose columns no longer
                // accommodate the spec shape: arrays, nested objects, etc.).
                // The spec comes from the builder "Save as view" also uses
                // (`buildAddViewSpec` → `buildNewViewSpec`, objectui#11581):
                // this door supplies only its default business columns.
                const objectDef = objects?.find?.((o: any) => o.name === objectName);
                const spec = buildAddViewSpec(config, objectDef);
                // ADR-0034: a new view is created as an invisible per-item
                // draft via the metadata seam; an explicit Publish promotes it.
                // The auto-activation below stays here; the canonical ViewItem
                // envelope + qualified-name identity live in the seam.
                //
                // #2767 P1: the qualified name `<object>.<key>` is used as BOTH
                // the URL segment and `body.name`, so the sys_metadata row key,
                // the ViewTabBar tab id, and the body identity all agree and the
                // draft → read → publish loop resolves.
                const env = viewEnvelope(objectName, spec, {
                    name: (config as any)?.name,
                    label: config.label,
                });
                createdId = await createRuntimeMetadata('view', env.name, env, {
                    metadataClient,
                    // #4373: this flow is the second door into the same rows the
                    // adapter caches. Hand it the adapter (the `dataSource` prop
                    // IS the `ObjectStackAdapter`, via `AppContent`'s
                    // `useAdapter()`) so the seam can drop the object's view keys.
                    dataSource,
                    objectName,
                });
            }
            setShowViewConfigPanel(false);
            setViewConfigPanelMode('edit');
            setRefreshKey(k => k + 1);
            // Auto-activate the newly created view (Airtable parity), and close
            // the main-path loop (#2767 P4): a fresh view is a DRAFT, invisible
            // to a normal (published-only) read, so navigating there plainly
            // would land on "view not found". Enter draft-preview mode
            // (`?preview=draft`) instead — the DraftPreviewBar then lets the
            // user verify and Publish in one click. If already in preview, the
            // sticky provider keeps the flag, so no suffix is needed.
            if (createdId) {
                const previewSuffix = previewDrafts
                    ? ''
                    : `?${PREVIEW_QUERY_FLAG}=${PREVIEW_QUERY_VALUE}`;
                if (viewId) {
                    navigate(`../${createdId}${previewSuffix}`, { relative: 'path' });
                } else {
                    navigate(`view/${createdId}${previewSuffix}`);
                }
            }
            return true;
        } catch (err) {
            console.error('[ViewConfigPanel] Failed to create view:', err);
            // objectui#11578: a refused save is SAID, with the door's own
            // message (the field-anchored issues of a 422, or the refusal's
            // text), and reported to the dialog as unsaved so it stays open.
            toast.error(t('form.saveError'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
            return false;
        }
    }, [dataSource, objectName, objects, navigate, viewId, metadataClient, previewDrafts, t]);

    /** Real-time draft field update — propagates each toggle/input change immediately */
    const handleViewUpdate = useCallback((field: string, value: any) => {
        setViewDraft(prev => ({
            ...(prev || {}),
            id: baseView?.id,
            [field]: value,
        }));
    }, [baseView?.id]);

    const handleViewChange = (newViewId: string) => {
        // The plugin ObjectView returns the view ID directly via onViewChange
        const matchedView = views.find((v: any) => v.id === newViewId);
        if (!matchedView) return;
        // Auto-close the config panel only when actually switching to a
        // different view. Same-view clicks (e.g., bubbling from the actions
        // dropdown menu item) must not stomp on a freshly-opened panel.
        if (matchedView.id !== activeViewId) {
            setShowViewConfigPanel(false);
        }
        if (viewId) {
             navigate(`../${matchedView.id}`, { relative: "path" });
        } else {
             navigate(`view/${matchedView.id}`);
        }
    };

    // Mobile view switcher — registers our view list with the AppHeader so
    // the topbar can render a `<viewName> ▾` dropdown instead of the static
    // page label. Desktop ignores this (ViewTabBar handles switching there).
    const mobileViewSwitcherItems = useMemo<MobileViewSwitcherItem[]>(() => {
        return (views || []).map((view: any) => {
            const Icon = VIEW_TYPE_ICONS[view.type as keyof typeof VIEW_TYPE_ICONS];
            return {
                id: view.id,
                label: viewTabLabel(view, objectDef.name, servedViews, viewLabel, unlabelledViewText, language),
                icon: Icon ? <Icon className="h-4 w-4" /> : undefined,
            };
        });
    }, [views, objectDef.name, viewLabel, unlabelledViewText, servedViews, language]);
    useMobileViewSwitcherRegistration({
        views: mobileViewSwitcherItems,
        activeViewId: activeViewId ?? '',
        onChange: handleViewChange,
        enabled: mobileViewSwitcherItems.length > 0 && !!activeViewId,
    });

    // ViewSwitcher callbacks — wired to both PluginObjectView instances
    const handleCreateView = useCallback(() => {
        setShowCreateViewDialog(true);
    }, []);

    const handleViewAction = useCallback((actionType: string, viewType: string) => {
        if (actionType === 'settings') {
            // `type` is optional on a view entry until the grid-like default
            // pass fills it in, so the predicate must tolerate its absence.
            const matchedView = views.find((v: { id: string; type?: string }) => v.type === viewType);
            if (matchedView) handleViewChange(matchedView.id);
            setViewConfigPanelMode('edit');
            setShowViewConfigPanel(true);
        }
    }, [views, handleViewChange]);

    // ─── ViewTabBar CRUD callbacks (Phase 2) ────────────────────────────
    /** Returns true if the view is backed by a sys_view record (mutable). */
    const isSavedView = useCallback((vid: string) => {
        return isSavedViewId(savedViews, vid);
    }, [savedViews]);

    const handleRenameView = useCallback(async (vid: string, newName: string) => {
        if (!isSavedView(vid)) {
            toast.error(t('console.objectView.cannotEditMetaView'));
            return;
        }
        try {
            // Metadata overlay path — `vid` is the view's `name` field.
            if (typeof (dataSource as any)?.updateView === 'function') {
                await (dataSource as any).updateView(objectName, vid, { label: newName });
            }
            setRefreshKey(k => k + 1);
        } catch (err) {
            console.error('[ViewTabBar] Failed to rename view:', err);
            // objectui#12417: a refused rename is said with the door's own
            // message, through the channel objectui#11583 gave the view saves
            // and objectui#12398 gave Delete view.
            toast.error(t('objectViewActions.renameFailed'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
        }
    }, [dataSource, objectName, isSavedView, t]);

    const handleDeleteView = useCallback(async (vid: string) => {
        if (!dataSource) return;
        if (!isSavedView(vid)) {
            toast.error(t('console.objectView.cannotDeleteMetaView'));
            return;
        }
        const targetView = views.find((v: any) => v.id === vid);
        const viewLabel = targetView?.label || vid;
        const confirmed = await confirmHandler(
            t('console.objectView.deleteViewConfirm', { name: viewLabel }),
            {
                title: t('console.objectView.deleteViewTitle'),
                confirmText: t('console.objectView.delete'),
                cancelText: t('console.objectView.cancel'),
            },
        );
        if (!confirmed) return;
        try {
            if (typeof (dataSource as any)?.deleteView === 'function') {
                await (dataSource as any).deleteView(objectName, vid);
            }
            // If we deleted the active view, fall back to the first remaining view.
            if (vid === activeViewId) {
                const fallback = views.find((v: any) => v.id !== vid);
                if (fallback) navigate(viewId ? `../${fallback.id}` : `view/${fallback.id}`, viewId ? { relative: 'path' } : undefined);
            }
            setRefreshKey(k => k + 1);
        } catch (err) {
            console.error('[ViewTabBar] Failed to delete view:', err);
            // objectui#12398: a refused delete is said with the door's own
            // message, through the channel objectui#11583 gave the view saves
            // (a 409 for a view two packages hold names its remedy there).
            toast.error(t('objectViewActions.deleteFailed'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
        }
    }, [dataSource, isSavedView, activeViewId, views, viewId, navigate, t, confirmHandler]);

    const handlePinView = useCallback(async (vid: string, pinned: boolean) => {
        if (!dataSource) return;
        if (!isSavedView(vid)) {
            toast.error(t('console.objectView.cannotEditMetaView'));
            return;
        }
        try {
            if (typeof (dataSource as any)?.updateView === 'function') {
                await (dataSource as any).updateView(objectName, vid, { isPinned: pinned });
            }
            setRefreshKey(k => k + 1);
        } catch (err) {
            console.error('[ViewTabBar] Failed to pin view:', err);
            // objectui#11583: a refused pin is said, with the door's message.
            toast.error(t('form.saveError'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
        }
    }, [dataSource, objectName, isSavedView, t]);

    const handleSetDefaultView = useCallback(async (vid: string) => {
        // `objectName` is narrowed here for the same reason the override effect
        // above narrows it: the adapter keys its cache invalidation on a real
        // object name, so passing `undefined` through would write to the server
        // and then fail to invalidate what it just changed.
        if (!dataSource || !objectName) return;
        if (!isSavedView(vid)) {
            toast.error(t('console.objectView.cannotEditMetaView'));
            return;
        }
        try {
            // Clear `isDefault` on all other saved views, then set this one.
            if (typeof (dataSource as any)?.updateView !== 'function') return;
            await Promise.all(
                dispatchViewPatches(
                    dataSource,
                    objectName,
                    setDefaultViewPatches(savedViews, vid),
                ),
            );
            setRefreshKey(k => k + 1);
        } catch (err) {
            console.error('[ViewTabBar] Failed to set default view:', err);
            // objectui#11583: said like its siblings, with the door's message.
            toast.error(t('form.saveError'), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
        }
    }, [dataSource, objectName, savedViews, isSavedView, t]);

    /**
     * A drag in Manage Views reorders the tabs FOR THIS USER (objectui#12418).
     *
     * It used to write `viewOrder:<object>` to this browser and then PATCH a
     * `sortOrder` onto every saved view's shared row, "so other sessions /
     * users can pick up the order": one user's drag reordered the tabs for
     * everyone, and under a walled posture the metadata write was refused. The
     * order is now the user's preference (the `ui.list.<object>` row, through
     * `listPrefs`), and nothing here writes `/meta/view`. The authored order —
     * the declared sequence, then a stored `sortOrder` — stays every user's
     * default, and the view editor is where an author changes it.
     */
    const handleReorderViews = useCallback((orderedIds: string[]) => {
        listPrefs.setViewOrder(orderedIds);
    }, [listPrefs.setViewOrder]);

    const handleConfigView = useCallback((vid: string) => {
        // System (metadata-defined) views are read-only — opening the
        // ViewConfigPanel against one would let the user save changes that
        // never persist.
        if (!isSavedView(vid)) {
            toast.error(t('console.objectView.cannotEditMetaView'));
            return;
        }
        if (vid !== activeViewId) handleViewChange(vid);
        setViewConfigPanelMode('edit');
        setShowViewConfigPanel(true);
    }, [activeViewId, handleViewChange, isSavedView, t]);

    const handleAddView = useCallback(() => {
        setShowCreateViewDialog(true);
    }, []);

    return {
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
    };
}
