/**
 * The page header's toolbar on the Console `ObjectView` (`./ObjectView.tsx`):
 * the `list_toolbar` actions the header draws (less the record-scoped ones the
 * selection bar already carries), the nav `runAction` deep link armed on them,
 * and the `action:bar` node that renders them, moved out of `ObjectViewInner`
 * verbatim (objectstack#25992, slice 8). Every input is passed in; the
 * component reads the returned values.
 */

import { useMemo } from 'react';
import { isRecordScopedAction } from '@object-ui/core';
import { actionRendersAt, type ActionBarSchema } from '@object-ui/types';
import { useOfferedNavRunAction } from '../hooks/useNavRunAction.js';
import { bulkWiredActionNamesKey, type buildViewTabs } from './objectViewTabs.js';
import type { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';

export function useObjectViewHeaderToolbar({
    activeView,
    localizedToolbarActions,
    isEnvironmentList,
}: {
    activeView: ReturnType<typeof buildViewTabs>[number];
    localizedToolbarActions: ReturnType<typeof useObjectViewToolbarAffordances>['localizedToolbarActions'];
    isEnvironmentList: boolean;
}) {
    // objectui#12462 (ruling A-narrow) — the header does not draw a duplicate of
    // the selection bar. The bar is the list toolbar in its selection mode: a
    // `list_toolbar` action the ACTIVE view wires to it (`bulkActions`, or a
    // `bulkActionDefs` entry) is still drawn at its declared placement, on the
    // rows it acts on, so the header's permanent copy is the duplicate. Only a
    // RECORD-SCOPED action leaves (`isRecordScopedAction`: it also mounts on
    // rows or records). Launched from the header it runs on exactly one ticked
    // row, which the bar's per-record run covers. An object-level action keeps
    // its header entry, because it can run with nothing selected and the bar
    // cannot. Nothing else moves: the bar reads the same view keys itself.
    //
    // The names are the ones `ObjectGrid` folds into its bar from the keys this
    // page relays to it (see `renderListView`): every non-empty `bulkActions`
    // name except `delete`, which the grid routes to its built-in bulk delete
    // rather than to an object action, and the `name` of every `bulkActionDefs`
    // entry the grid can render. Keyed on a string of the names, not on
    // `activeView`, which is a fresh object on every render while a draft is
    // open (AGENTS.md #10).
    const bulkWiredNamesKey = bulkWiredActionNamesKey(activeView);
    const headerToolbarActions = useMemo(() => {
        const wired = new Set<string>(JSON.parse(bulkWiredNamesKey) as string[]);
        if (wired.size === 0) return localizedToolbarActions;
        return localizedToolbarActions.filter(
            (a: any) => !(typeof a?.name === 'string' && wired.has(a.name) && isRecordScopedAction(a)),
        );
    }, [localizedToolbarActions, bulkWiredNamesKey]);

    // [#5216] The DECLARED nav `runAction` slot, consumed generically.
    // An object nav entry declaring `runAction: '<name>'` resolves (via
    // `resolveHref`) to this list's href carrying `?runAction=`; landing here
    // runs that action once, through the ordinary execute path.
    //
    // Arm only on an action THIS toolbar actually renders — `list_toolbar` is
    // the slot's surface, so a name that only exists at `record_header` cannot
    // be triggered from here and must not spend the one-shot intent (#4123).
    // That is also why it reads `headerToolbarActions`: an action that left the
    // header for the selection bar (objectui#12462) is not armed either, and the
    // link stays in the URL, as for any name this header does not draw.
    // `sys_environment` is excluded because `EnvironmentListToolbar` owns the
    // arming there: it must additionally wait for entitlements to resolve, and
    // two consumers of one param would race to strip it.
    //
    // [objectui#4191] …and only on an action its author has not HIDDEN here:
    // the action's own declared `visible` outranks the deep link. A hidden
    // candidate is neither marked `autoTrigger` nor consumed, and the refusal
    // is reported — see `useOfferedNavRunAction`, which evaluates the same
    // predicate `action:button` does.
    const navRunAction = useOfferedNavRunAction(
        headerToolbarActions,
        (a: any) => actionRendersAt(a, 'list_toolbar'),
        !isEnvironmentList,
    );
    // Mark exactly the requested action `autoTrigger`, leaving every other
    // action's identity untouched so the bar's ordering/overflow is unchanged.
    const toolbarActionsWithDeepLink = useMemo(
        () =>
            navRunAction === null
                ? headerToolbarActions
                : headerToolbarActions.map((a: any) =>
                      a?.name === navRunAction ? { ...a, autoTrigger: true } : a,
                  ),
        [headerToolbarActions, navRunAction],
    );
    // The schema-driven toolbar, typed as the `action:bar` node it is
    // (objectui#11355), not as the `BaseSchema` the `schema` prop accepts: a key
    // `ActionBarSchema` does not declare is refused here. On mobile it collapses
    // all schema-driven toolbar actions into a single overflow menu, so the
    // icon-only New / Import buttons stay visible without pushing the page title
    // off-screen.
    const toolbarBar: ActionBarSchema = {
        type: 'action:bar',
        location: 'list_toolbar',
        actions: toolbarActionsWithDeepLink,
        size: 'sm',
        variant: 'outline',
        mobileMaxVisible: 0,
    };
    return { headerToolbarActions, toolbarActionsWithDeepLink, toolbarBar };
}
