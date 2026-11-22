// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36409 — who may create a shared view from a list's view dropdown,
 * and the act that creates one.
 *
 * The rule (the maintainer's): only an administrator makes a view everyone
 * sees. A shared view is `view` metadata, written through `PUT /meta/view/:name`,
 * which the server refuses any caller without `manage_metadata`; one of the
 * reader's own views is a `sys_personal_view` row (`./personalViews.ts`). So:
 *
 * - **who** ({@link mayShareViews}): an administrator whose session holds the
 *   capability that door asks. An organization administrator without it is not
 *   offered a Shared choice the server would answer `403`;
 * - **Create, shared** ({@link UseViewSharing.createShared}), from the add-view
 *   card: the new view is saved and published in one act
 *   (`saveAndPublishRuntimeMetadata`, the maintainer's 「保存即生效」), so
 *   everyone sees it on their next read; a refused save publishes nothing.
 *
 * Sharing or unsharing an existing view is not offered (the maintainer: not
 * now).
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import type { useObjectTranslation } from '@object-ui/i18n';
import { buildAddViewSpec } from './objectViewTabs.js';
import { saveAndPublishRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence.js';
import type { RuntimeCreateApp, RuntimePersistCtx } from './runtime-metadata-persistence.js';
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

export interface UseViewSharing {
    /** The add-view card's door for a shared view; resolves whether it was created. */
    createShared: (config: Record<string, any>) => Promise<boolean>;
}

export function useViewSharing({
    objectName,
    objectDef,
    metadataClient,
    dataSource,
    app,
    routeViewId,
    navigate,
    refresh,
    t,
}: {
    objectName: string;
    objectDef: unknown;
    metadataClient: RuntimePersistCtx['metadataClient'];
    dataSource: any;
    /** The app the list is in, so a new shared view is saved into its package. */
    app: RuntimeCreateApp;
    /** The route's view segment, when the address names one. */
    routeViewId: string | undefined;
    navigate: (to: string, options?: { relative?: 'path' }) => void;
    /** Read the saved views again. */
    refresh: () => void;
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

    return { createShared };
}
