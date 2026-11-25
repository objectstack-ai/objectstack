/**
 * The header chrome of the Console `ObjectView` (`./ObjectView.tsx`): the
 * create button, the header's actions folded into one menu for a narrow
 * header, and the list area for a view the server refused, moved out of
 * `ObjectViewInner` verbatim (objectstack#25992, slice 9). Every input is
 * passed in, except Object settings (objectstack#36487), which it reads off
 * the route the way the page bar's ⋮ does; the component reads the returned
 * values.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { Plus, Lock } from 'lucide-react';
import type { ActionBarSchema, UIActionSchema } from '@object-ui/types';
import type { useObjectTranslation } from '@object-ui/i18n';
import type { useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { useObjectSettingsGate, useObjectSettingsPath } from '../layout/SidebarItemMenu.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import type { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import type { useObjectActions } from '../hooks/useObjectActions.js';
import { declaredPrimaryToolbarAction, MOBILE_FAB_LIST_CLEARANCE } from './objectViewHelpers.js';
import { ListHeaderActionBar } from './objectViewHeaderLaunchGate.js';
import type { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';
import type { useObjectViewIdentity } from './objectViewIdentity.js';
import type { useObjectViewHeaderToolbar } from './objectViewHeaderToolbar.js';

export function useObjectViewHeaderChrome({
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
    isEnvironmentList,
    toolbarBar,
    viewAccess,
    titleSwitcher,
    createLabel,
}: {
    objectCanCreate: ReturnType<typeof useObjectViewToolbarAffordances>['objectCanCreate'];
    createVisible: ReturnType<typeof useObjectViewToolbarAffordances>['createVisible'];
    createDisabled: ReturnType<typeof useObjectViewToolbarAffordances>['createDisabled'];
    actions: ReturnType<typeof useObjectActions>;
    t: ReturnType<typeof useObjectTranslation>['t'];
    listActions: ReturnType<typeof useObjectViewToolbarAffordances>['listActions'];
    toolbarActionsWithDeepLink: ReturnType<typeof useObjectViewHeaderToolbar>['toolbarActionsWithDeepLink'];
    identityImportEnabled: ReturnType<typeof useObjectViewIdentity>['identityImportEnabled'];
    objectCanImport: ReturnType<typeof useObjectViewToolbarAffordances>['objectCanImport'];
    importVisible: ReturnType<typeof useObjectViewToolbarAffordances>['importVisible'];
    importDisabled: ReturnType<typeof useObjectViewToolbarAffordances>['importDisabled'];
    setShowImport: Dispatch<SetStateAction<boolean>>;
    listFavorite: ReturnType<typeof useObjectListFavorite>;
    isEnvironmentList: ReturnType<typeof useObjectViewToolbarAffordances>['isEnvironmentList'];
    toolbarBar: ReturnType<typeof useObjectViewHeaderToolbar>['toolbarBar'];
    viewAccess: ReturnType<typeof useMetaItemRefusal>;
    /**
     * The view switcher (objectstack#35548): it leads the list's view bar, so
     * the refused-view face, which draws no list, draws the bar's switcher
     * itself — the reader's way to another view.
     */
    titleSwitcher?: ReactNode;
    /**
     * objectstack#36113 — the create button's words, 「New Account」: the
     * object's singular name, since the button names what it creates.
     */
    createLabel: string;
}) {
    // The header's primary action, drawn the same in both of the header's
    // faces (below). [#5153] `objectCanCreate && createVisible` — the
    // object-level verdict, then the toolbar-scope `visibleWhen` layer on top
    // of it. Greyed, not gone, is the `disabledWhen` case. Same pair drives the
    // phone FAB below, so the two render points cannot disagree.
    const showCreate = objectCanCreate && createVisible;
    // objectui#13134 — the list's end-of-scroll room for the phone FAB, on the
    // list host below, exactly while the FAB is drawn (see
    // `MOBILE_FAB_LIST_CLEARANCE`).
    const listFabClearance = showCreate ? MOBILE_FAB_LIST_CLEARANCE : undefined;
    const createButton = showCreate ? (
        <Button
            size="sm"
            onClick={actions.create}
            disabled={createDisabled}
            // 28px and 13px, like every control of the list's two bars
            // (objectstack#35548).
            className="shadow-none gap-1 h-7 px-2.5 text-sm"
            data-testid="object-view-new-button"
        >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{createLabel}</span>
        </Button>
    ) : null;

    // objectui#12705 — the header's actions folded, for a header too narrow
    // for them and the description: the primary action stays labelled and
    // every other action goes into one `⋯` menu, above the page's own entries
    // (favorites). The header decides when; this decides what.
    //
    // The primary is DECLARED, never read off the row's order: the page's own
    // New when it draws one, else the toolbar action authored
    // `variant: 'primary'` (lowest `order` first) — `sys_user`'s Invite User.
    // Everything else goes through one `action:bar` with no inline slots, so
    // the menu is that bar's one overflow menu: the toolbar actions keep the
    // bar's capability, location and `visible` / `disabled` gates and its
    // execute path, as when they spill past `maxVisible` today. Import and the
    // page's own entries join it as host callbacks, the way the record page's
    // menu carries Favorite and Share.
    //
    // A `?runAction=` deep link still runs once: the arrival's render consumes
    // it before the header can fold, so no action in the folded face carries
    // `autoTrigger`. Not offered on the environment list, whose toolbar is
    // `EnvironmentListToolbar`, not this bar.
    //
    // objectstack#33988 — not offered either when the list declares no
    // primary (no New, no toolbar action authored `variant: 'primary'`): that
    // face would keep no labelled action, so a long description alone would
    // send the page's one action into the `⋯`. Without a folded face the
    // header keeps `actions` at every width and the description truncates.
    // objectstack#36487 — Object settings leads the folded menu, as it leads
    // the page bar's ⋮ More: this object in Studio, for the principal the app
    // bar's Studio entry is drawn for (`useObjectSettingsGate`); leaving asks
    // first when the page holds unsaved edits (`confirmUnsavedLeave`).
    const navigate = useNavigate();
    const { appName, objectName } = useParams();
    const objectSettingsPath = useObjectSettingsGate(useObjectSettingsPath({ appSegment: appName, objectName }));
    const toolbarRowActions: UIActionSchema[] = listActions?.some((a: { locations?: readonly string[] }) => a.locations?.includes('list_toolbar'))
        ? toolbarActionsWithDeepLink
        : [];
    const primaryToolbarAction = showCreate ? undefined : declaredPrimaryToolbarAction(toolbarRowActions);
    const importShown = identityImportEnabled || (objectCanImport && importVisible);
    const foldedMenuBar: ActionBarSchema = {
        type: 'action:bar',
        location: 'list_toolbar',
        actions: [
            ...(objectSettingsPath ? [{
                name: 'object_view_object_settings',
                label: t('console.nav.objectSettings', { defaultValue: 'Object settings' }),
                icon: 'settings-2',
                type: 'script' as const,
                locations: ['list_toolbar' as const],
                onClick: () => confirmUnsavedLeave(() => navigate(objectSettingsPath)),
            }] : []),
            ...(importShown ? [{
                name: 'object_view_import',
                label: t('console.objectView.import'),
                icon: 'upload',
                type: 'script' as const,
                locations: ['list_toolbar' as const],
                disabled: importDisabled,
                onClick: () => setShowImport(true),
            }] : []),
            ...toolbarRowActions.filter((a) => a.name !== primaryToolbarAction?.name),
        ],
        systemActions: [
            ...(listFavorite ? [{
                name: 'object_view_favorite',
                label: listFavorite.isFavorite
                    ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' })
                    : t('common.addToFavorites', { defaultValue: 'Add to favorites' }),
                icon: listFavorite.isFavorite ? 'star-off' : 'star',
                type: 'script' as const,
                onClick: listFavorite.toggle,
            }] : []),
        ],
        variant: 'ghost',
        size: 'icon',
        maxVisible: 0,
        mobileMaxVisible: 0,
    };
    const foldedHeaderActions = !isEnvironmentList && (showCreate || primaryToolbarAction) ? (
        <>
            {/* One inline slot at every width: `toolbarBar` keeps none below
                `md` (`mobileMaxVisible: 0`), which would send the primary into
                a second `⋯` beside the menu's. */}
            {primaryToolbarAction && (
                <ListHeaderActionBar schema={{ ...toolbarBar, actions: [primaryToolbarAction], maxVisible: 1, mobileMaxVisible: 1 }} />
            )}
            <ListHeaderActionBar schema={foldedMenuBar} />
            {/* New last, as in the unfolded bar (objectstack#35548). */}
            {createButton}
        </>
    ) : undefined;

    // objectui#12112 — the list area for a view the server refused: said as a
    // permission refusal, in the server's own sentence, which names the view.
    const refusedViewFace = viewAccess.refusal ? (
        <div className="flex h-full flex-col">
        {titleSwitcher && (
            <div className="flex h-10 shrink-0 items-center border-b px-4" data-testid="refused-view-bar">
                {titleSwitcher}
            </div>
        )}
        <div className="flex flex-1 items-center justify-center p-8">
            <Empty data-testid="view-access-denied">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Lock className="h-6 w-6 text-muted-foreground" />
                </div>
                <EmptyTitle>{t('list.loadErrorForbiddenTitle')}</EmptyTitle>
                {viewAccess.refusal.message && <EmptyDescription>{viewAccess.refusal.message}</EmptyDescription>}
            </Empty>
        </div>
        </div>
    ) : null;

    return { showCreate, listFabClearance, createButton, importShown, foldedHeaderActions, refusedViewFace };
}
