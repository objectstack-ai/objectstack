// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36371 — who may share a list's views, and the three acts that
 * share or unshare one from the view dropdown.
 *
 * The rule (the maintainer's): only an administrator makes a view everyone
 * sees. A shared view is `view` metadata, written through `PUT /meta/view/:name`,
 * which the server refuses any caller without `manage_metadata`; one of the
 * reader's own views is a `sys_personal_view` row (`./personalViews.ts`). So:
 *
 * - **who** ({@link mayShareViews}): an administrator whose session holds the
 *   capability that door asks. An organization administrator without it is not
 *   offered a control the server would answer `403`;
 * - **Create, shared** ({@link UseViewSharing.createShared}), from the add-view
 *   card: the new view is saved and published in one act
 *   (`saveAndPublishRuntimeMetadata`), so everyone sees it on their next read;
 * - **Make shared** ({@link UseViewSharing.makeShared}), on one of the reader's
 *   own views: its stored body becomes a new shared view, published, and the
 *   reader's row is then deleted;
 * - **Unshare** ({@link UseViewSharing.unshare}), on a shared view saved here
 *   (never a view a package ships, never a package view's customization): it
 *   becomes one of the reader's own views, then the shared view is deleted. A
 *   delete the server refuses takes the copy back, so nothing changes.
 *
 * Each act says what it did, and a refusal is said with the door's own words.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { formatMetadataError } from '@object-ui/data-objectstack';
import type { useObjectTranslation } from '@object-ui/i18n';
import type { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import { viewRowId } from '../utils/viewIdentity.js';
import { buildAddViewSpec, buildViewConfigSaveBody } from './objectViewTabs.js';
import { deriveViewKey, saveAndPublishRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence.js';
import type { RuntimeCreateApp, RuntimePersistCtx } from './runtime-metadata-persistence.js';
import type { PersonalView } from './personalViews.js';
import { viewSaveRefusalText } from './viewSaveRefusal.js';

type TFn = ReturnType<typeof useObjectTranslation>['t'];

/**
 * May this reader share views? An administrator (`useWorkspaceAdminStatus`)
 * whose session holds `manage_metadata` (`useCanAuthorMetadata`, the
 * capability the shared view's write door asks). The server refuses every
 * other caller regardless; this is the presentational half.
 */
export function mayShareViews(isAdmin: boolean, canAuthorMetadata: boolean): boolean {
    return isAdmin && canAuthorMetadata;
}

/**
 * The key a view made shared from one of the reader's own is saved under: the
 * key its name gives (`deriveViewKey`), numbered past every view this list
 * already serves, so the save never lands on another view's name (a publish
 * there would replace that view).
 */
export function freeViewKey(objectName: string, label: string, type: string | undefined, taken: Iterable<string>): string {
    const used = new Set<string>();
    for (const id of taken) {
        if (typeof id !== 'string' || !id) continue;
        used.add(id);
        if (id.startsWith(`${objectName}.`)) used.add(id.slice(objectName.length + 1));
    }
    const base = deriveViewKey({ label, type });
    if (!used.has(base)) return base;
    for (let i = 2; i < 10_000; i++) {
        const candidate = `${base}_${i}`;
        if (!used.has(candidate)) return candidate;
    }
    return `${base}_${Date.now().toString(36)}`;
}

/**
 * May a shared view of this list be unshared? A view saved here: one the
 * object's metadata does not author, that no read-only package ships
 * (`definitionReadonly`), that is no package view's customization
 * (`customized`) and that is not an unpublished draft. Judged from the same
 * Manage views item that decides whether Delete is offered there.
 */
export function isUnsharableView(
    item: { readonly?: boolean; definitionReadonly?: boolean; customized?: boolean },
    saved: { _draft?: unknown } | undefined,
): boolean {
    return !!saved && !item.readonly && !item.definitionReadonly && !item.customized && saved._draft !== true;
}

export interface UseViewSharing {
    /** The add-view card's door for a shared view; resolves whether it was created. */
    createShared: (config: Record<string, any>) => Promise<boolean>;
    /** 「Make shared」 on one of the reader's own views. */
    makeShared: (personalViewId: string) => Promise<void>;
    /** 「Unshare」 on a shared view saved here ({@link isUnsharableView}). */
    unshare: (viewId: string) => Promise<void>;
}

export function useViewSharing({
    objectName,
    objectDef,
    metadataClient,
    dataSource,
    app,
    personalViews,
    savedViews,
    viewIds,
    labelOf,
    activeViewId,
    routeViewId,
    navigate,
    pinnedViewId,
    setPinnedViewId,
    refresh,
    confirmHandler,
    t,
}: {
    objectName: string;
    objectDef: unknown;
    metadataClient: RuntimePersistCtx['metadataClient'];
    dataSource: any;
    /** The app the list is in, so a new shared view is saved into its package. */
    app: RuntimeCreateApp;
    personalViews: {
        views: readonly PersonalView[];
        save: (label: string, config: Record<string, unknown>) => Promise<string>;
        remove: (id: string) => Promise<void>;
    };
    savedViews: readonly unknown[];
    /** Every view id the list serves (shared and the reader's own). */
    viewIds: readonly string[];
    /** A view's name as the dropdown draws it. */
    labelOf: (viewId: string) => string;
    activeViewId: string | undefined;
    /** The route's view segment, when the address names one. */
    routeViewId: string | undefined;
    navigate: (to: string, options?: { relative?: 'path' }) => void;
    /** The view the reader pinned for this list, resolved to its id among `viewIds`. */
    pinnedViewId: string | null;
    setPinnedViewId: (viewId: string | null) => void;
    /** Read the saved views again. */
    refresh: () => void;
    confirmHandler: ReturnType<typeof useConsoleActionRuntime>['confirmHandler'];
    t: TFn;
}): UseViewSharing {
    const openView = useCallback((id: string) => {
        if (routeViewId) navigate(`../${id}`, { relative: 'path' });
        else navigate(`view/${id}`);
    }, [routeViewId, navigate]);

    /** Save and publish a new shared view; `false` when nothing was written. */
    const publishNew = useCallback(async (name: string, env: Record<string, unknown>): Promise<boolean> => {
        const outcome = await saveAndPublishRuntimeMetadata('view', name, env, { metadataClient, dataSource, objectName, app });
        if (outcome === 'pending-draft') {
            toast.error(t('form.saveError'), {
                description: t('view.switcher.shareNameTaken', {
                    defaultValue: 'An unpublished draft already uses this view’s name, so nothing was shared. Give the view another name and try again.',
                }),
            });
            return false;
        }
        return true;
    }, [metadataClient, dataSource, objectName, app, t]);

    const createShared = useCallback(async (config: Record<string, any>): Promise<boolean> => {
        if (!metadataClient) return false;
        try {
            const spec = buildAddViewSpec(config, objectDef);
            const env = viewEnvelope(objectName, spec, { name: config?.name, label: config.label });
            if (!(await publishNew(env.name, env as unknown as Record<string, unknown>))) return false;
            refresh();
            openView(env.name);
            return true;
        } catch (err) {
            console.error('[ObjectView] Failed to create a shared view:', err);
            toast.error(t('form.saveError'), {
                description: viewSaveRefusalText(err, t),
                classNames: { description: 'whitespace-pre-line' },
            });
            return false;
        }
    }, [metadataClient, objectDef, objectName, publishNew, refresh, openView, t]);

    const makeShared = useCallback(async (personalViewId: string): Promise<void> => {
        const target = personalViews.views.find((v) => v.id === personalViewId);
        if (!target || !metadataClient) return;
        const confirmed = await confirmHandler(
            t('view.switcher.makeSharedConfirm', {
                name: target.label,
                defaultValue: 'Everyone who can see this list will find “{{name}}” under Shared views. It leaves your My views.',
            }),
            {
                title: t('view.switcher.makeSharedTitle', { defaultValue: 'Share this view with everyone?' }),
                confirmText: t('view.switcher.makeShared', { defaultValue: 'Make shared' }),
                cancelText: t('console.objectView.cancel'),
            },
        );
        if (!confirmed) return;
        const type = typeof target.config.type === 'string' ? target.config.type : 'grid';
        const key = freeViewKey(objectName, target.label, type, viewIds);
        const env = viewEnvelope(objectName, { ...target.config, type }, { name: key, label: target.label });
        try {
            if (!(await publishNew(env.name, env as unknown as Record<string, unknown>))) return;
        } catch (err) {
            console.error('[ObjectView] Failed to share a view:', err);
            toast.error(t('form.saveError'), {
                description: viewSaveRefusalText(err, t),
                classNames: { description: 'whitespace-pre-line' },
            });
            return;
        }
        // The shared view exists now: the reader's own copy goes, and with it
        // their pin moves to the shared one.
        try {
            await personalViews.remove(personalViewId);
        } catch (err) {
            console.error('[ObjectView] A shared view kept its source in My views:', err);
            toast.warning(t('view.switcher.makeSharedKeptCopy', {
                defaultValue: 'The view is shared, but your own copy could not be removed from My views. You can delete it there.',
            }));
        }
        if (pinnedViewId === personalViewId) setPinnedViewId(env.name);
        refresh();
        if (personalViewId === activeViewId) openView(env.name);
        toast.success(t('view.switcher.makeSharedDone', { name: target.label, defaultValue: '“{{name}}” is now shared' }));
    }, [personalViews, metadataClient, confirmHandler, t, objectName, viewIds, publishNew, pinnedViewId, setPinnedViewId, refresh, activeViewId, openView]);

    const unshare = useCallback(async (viewId: string): Promise<void> => {
        const saved = savedViews.find((sv) => viewRowId(sv) === viewId) as Record<string, unknown> | undefined;
        if (!saved || typeof dataSource?.deleteView !== 'function') return;
        const label = labelOf(viewId);
        const confirmed = await confirmHandler(
            t('view.switcher.unshareConfirm', {
                name: label,
                defaultValue: '“{{name}}” moves to your My views. Everyone else stops seeing it, and anyone who has it open goes back to the default view.',
            }),
            {
                title: t('view.switcher.unshareTitle', { defaultValue: 'Stop sharing this view?' }),
                confirmText: t('view.switcher.unshare', { defaultValue: 'Unshare' }),
                cancelText: t('console.objectView.cancel'),
            },
        );
        if (!confirmed) return;
        const { config } = buildViewConfigSaveBody(objectName, { ...saved, id: viewId });
        let copyId: string;
        try {
            copyId = await personalViews.save(label, config as Record<string, unknown>);
        } catch (err) {
            console.error('[ObjectView] Failed to copy a view into My views:', err);
            toast.error(t('view.switcher.unshareFailed', { defaultValue: 'The view could not be unshared' }), {
                description: viewSaveRefusalText(err, t),
                classNames: { description: 'whitespace-pre-line' },
            });
            return;
        }
        try {
            const receipt = await dataSource.deleteView(objectName, viewId);
            if (receipt && receipt.deleted === false) throw new Error(t('view.switcher.unshareNotDeleted', { defaultValue: 'The server kept the shared view.' }));
        } catch (err) {
            // Nothing changed for anyone: the copy is taken back.
            try {
                await personalViews.remove(copyId);
            } catch (removeErr) {
                console.error('[ObjectView] The copy of a view that stayed shared is left in My views:', removeErr);
            }
            console.error('[ObjectView] Failed to unshare a view:', err);
            toast.error(t('view.switcher.unshareFailed', { defaultValue: 'The view could not be unshared' }), {
                description: formatMetadataError(err),
                classNames: { description: 'whitespace-pre-line' },
            });
            return;
        }
        if (pinnedViewId === viewId) setPinnedViewId(copyId);
        refresh();
        if (viewId === activeViewId) openView(copyId);
        toast.success(t('view.switcher.unshareDone', { name: label, defaultValue: '“{{name}}” is in your My views now' }));
    }, [savedViews, dataSource, labelOf, confirmHandler, t, objectName, personalViews, pinnedViewId, setPinnedViewId, refresh, activeViewId, openView]);

    return { createShared, makeShared, unshare };
}
