/**
 * The list's URL state on the Console `ObjectView` (`./ObjectView.tsx`): the
 * Filter panel, search, sort and grouping under the `uf_` family (the seed a
 * list opens with, its write-back, and "Reset view"), and the `filter[...]`
 * equality filters with the end-user filter selections restored from the URL,
 * moved out of `ObjectViewInner` verbatim (objectstack#25992, slice 8). Every
 * input is passed in; the component reads the returned values.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { useAuth } from '@object-ui/auth';
import type { usePermissions } from '@object-ui/permissions';
import {
    parseUserFilterParams,
    applyUserFilterParams,
    parseListStateParams,
    applyListStateParams,
    userFilterParamsKey,
    type ListStatePatch,
    type ListUrlState,
} from './userFilterUrlState.js';
import { buildListFilterKey, readListFilterState } from './listFilterStorage.js';
import type { useObjectListPreferences } from '../context/ListPreferencesProvider.js';
import { parseUrlEqualityFilterTriples } from './drillUrlFilters.js';
import { selectFilterParams } from './objectViewHelpers.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewListUrlState({
    objectName,
    objectDef,
    activeView,
    listPrefs,
    perms,
    user,
    searchParams,
    setSearchParams,
}: {
    objectName: string | undefined;
    objectDef: ConsoleObjectViewProps['objects'][number];
    activeView: ReturnType<typeof buildViewTabs>[number];
    listPrefs: ReturnType<typeof useObjectListPreferences>;
    perms: ReturnType<typeof usePermissions>;
    user: ReturnType<typeof useAuth>['user'];
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
}) {
    /**
     * objectui#11860 — the list's toolbar state in the URL: the Filter panel's
     * conditions, the search term, the sort and the grouping, under the `uf_`
     * family `userFilterUrlState` owns (its header names the params and their
     * shapes). Panels and dialogs stay out of it.
     *
     * The SEED — what the list opens with — is decided once per list identity
     * (object + view, the same identity `renderListView` keys the list on;
     * `ListView` reads its initial filters and search once, at mount):
     *
     * 1. The URL, when it carries any `uf_*` state this page did not write
     *    itself — an opened link, a reload, Back. It is then the WHOLE state:
     *    the per-browser cache is not consulted, so a shared link opens the
     *    same list for everyone who may read it. A piece the URL lacks is
     *    absent, not filled from storage.
     * 2. Otherwise the user's own state (objectui#12418, `listPrefs`): the
     *    Filter panel's conditions and the sort they left this view with, and
     *    the search term from the per-user cache (`listFilterStorage`); the
     *    view's own sort when they stored none, and its own grouping. The
     *    seed waits until that state has been read (`listPrefs.ready`), so a
     *    second browser opens on it rather than on an empty cache.
     *
     * Then the seed is written back into the URL (replace, never a new history
     * entry), so the address bar shows the list on screen: a restored filter
     * is in the link a user copies, and an entry dropped on load (a field the
     * object does not declare or the user cannot read, a condition the spec
     * refuses) leaves the address bar too.
     *
     * "Did this page write it" is `ownListParamsRef`: the `uf_*` params as the
     * last write by this page left them. It matters when the identity moves
     * WITHOUT a navigation — the saved views arrive after the first render and
     * the active view resolves to another one — where params this page wrote
     * for the first view would otherwise read as a link to the second. A real
     * view switch navigates to a path with no query string, so it starts from
     * the cache, and the ad-hoc params never follow the user into another view.
     */
    // objectui#12418 — "Reset view" opens the list again as the view declares
    // it: the identity moves, so the list remounts and re-seeds. A reset is the
    // one case that WANTS the list's own state thrown away (AGENTS.md #8 is
    // about refreshing data, which never does).
    const [listResetGeneration, setListResetGeneration] = useState(0);
    const listIdentityKey = activeView?.id
        ? `${objectName}-${activeView.id}${listResetGeneration ? `~${listResetGeneration}` : ''}`
        : undefined;
    const listSeedRef = useRef<{ key: string; source: 'url' | 'storage'; state: ListUrlState } | undefined>(undefined);
    const ownListParamsRef = useRef<string | undefined>(undefined);
    if (listIdentityKey && listPrefs.ready && listSeedRef.current?.key !== listIdentityKey) {
        const carried = userFilterParamsKey(searchParams);
        if (carried && carried !== ownListParamsRef.current) {
            // A field the object does not declare (a stale link) or one this
            // user cannot read is dropped. Field-level permissions gate only
            // once loaded — the same gate `ListView` puts on its columns.
            const acceptField = (field: string) =>
                !!objectDef.fields?.[field]
                && (!perms.isLoaded || perms.checkField(objectDef.name, field, 'read'));
            listSeedRef.current = {
                key: listIdentityKey,
                source: 'url',
                state: parseListStateParams(searchParams, acceptField),
            };
        } else {
            const stored = readListFilterState(buildListFilterKey(user?.id, objectName, activeView.id));
            const viewPref = listPrefs.preference.perView?.[activeView.id];
            listSeedRef.current = {
                key: listIdentityKey,
                source: 'storage',
                state: {
                    filters: (viewPref?.filters ?? undefined) as ListUrlState['filters'],
                    search: stored?.search || undefined,
                    sort: viewPref?.sort,
                },
            };
        }
    }
    useEffect(() => {
        const seed = listSeedRef.current;
        if (!seed || seed.key !== listIdentityKey) return;
        const next = applyListStateParams(searchParams, {
            filters: seed.state.filters ?? null,
            search: seed.state.search ?? null,
            sort: seed.state.sort ?? null,
            grouping: seed.state.grouping ?? null,
        });
        // Only a mirror of the CACHE is this page's own write. A link's params,
        // even rewritten, stay the link's: the identity can still move to the
        // view the link names once the saved views arrive.
        if (seed.source === 'storage') ownListParamsRef.current = userFilterParamsKey(next);
        if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
        // Once per list identity, by design: later URL writes are the list's
        // own changes, already on screen. (`listPrefs.ready` because the seed
        // is taken only once the user's own state has been read.)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }, [listIdentityKey, listPrefs.ready]);
    /** Write the list's own change into the URL — replace, never a history entry per keystroke. */
    const writeListUrlState = useCallback(
        (patch: ListStatePatch) => {
            setSearchParams(prev => {
                const next = applyListStateParams(prev, patch);
                ownListParamsRef.current = userFilterParamsKey(next);
                return next;
            }, { replace: true });
        },
        [setSearchParams],
    );

    /**
     * objectui#12418 — "Reset view": drop this user's sort, filters and column
     * layout for the active view, and open the list again as the view declares
     * it. Offered only while they have stored something for it.
     */
    const activeViewHasPreference = !!(activeView?.id && listPrefs.preference.perView?.[activeView.id]);
    const handleResetView = useCallback(() => {
        if (!activeView?.id) return;
        listPrefs.resetView(activeView.id);
        setListResetGeneration(g => g + 1);
    }, [activeView?.id, listPrefs.resetView]);
    return {
        listIdentityKey,
        listSeedRef,
        ownListParamsRef,
        writeListUrlState,
        activeViewHasPreference,
        handleResetView,
    };
}

export function useObjectViewUrlFilters({
    searchParams,
    setSearchParams,
    listIdentityKey,
    ownListParamsRef,
}: {
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
    listIdentityKey: ReturnType<typeof useObjectViewListUrlState>['listIdentityKey'];
    ownListParamsRef: ReturnType<typeof useObjectViewListUrlState>['ownListParamsRef'];
}) {
    /**
     * URL-derived equality filters in the form `?filter[<field>]=<value>`.
     * Used by related-list "View All" buttons to scope the destination list
     * to a single parent record. Emitted as ObjectQL triples (`[field, '=', value]`)
     * which matches the shape consumed by the list view's data fetcher when
     * merging base filters.
     *
     * Read through `drillUrlFilters` — the ONE module that owns this URL family
     * — rather than a private regex here (objectui#9196). This route implements
     * the EQUALITY arm only: an operator suffix it cannot execute
     * (`?filter[amount][gte]=100`) is DROPPED, never downgraded to equality and
     * never swallowed into the field name. The greedy capture this replaced did
     * the last of those, emitting a condition against a field literally named
     * `amount][gte` that no object declares — a silently wrong query, not an
     * ignored parameter. Range operators live on the ADR-0055 `/data` surface
     * (`parseUrlFilterTriples`); giving them to this route would widen an
     * addressable public surface and is deliberately not done here.
     */
    // Dep on the serialized `filter[...]` entries only — `uf_*` user-filter
    // params also live in the URL and must not invalidate this memo (a new
    // array identity here rebuilds the whole list schema and refetches).
    const filterParams = selectFilterParams(searchParams);
    const filterParamsKey = filterParams.toString();
    const urlFilters = useMemo(
        // The params object is read DIRECTLY — nothing is serialized here and
        // parsed back, so there is no round trip left for a character to be
        // lost in (objectui#9287). `filterParamsKey` is the memo's identity
        // only.
        () => parseUrlEqualityFilterTriples(filterParams),
        // Keyed on the SERIALIZED params, not on the object's identity:
        // `filterParams` is rebuilt every render, so listing it would
        // invalidate this memo on every unrelated `uf_*` write — the churn
        // this key exists to prevent. Equal keys imply equal contents, so the
        // captured object is never stale.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
        [filterParamsKey],
    );

    /**
     * End-user filter selections restored from `uf_*` URL params (ADR-0047
     * persistence), read from the CURRENT location once per list identity —
     * the identity `listSeedRef` seeds on and `renderListView` keys the list
     * on (objectui#11992). A view switch keeps this page mounted and remounts
     * the list, whose `UserFilters` read these once, at that mount. So each
     * view starts from the selections its own URL carries: none on the bare
     * path a view tab navigates to, the link's on a link, the entry's own on
     * Back. A capture once per PAGE mount restored the first view's selections
     * on every view after it, while their address bar showed none.
     *
     * Held per identity rather than re-read every render: the list's own
     * writes (below) reach the URL after the list already shows them, and a
     * new object here would rebuild the list's schema on every chip click.
     * The router's location is read, not `window.location`: it is the one this
     * page writes to and the one `listSeedRef` reads.
     */
    const ufSelectionsRef = useRef<{ key: string; selections: Record<string, string[]> | undefined } | undefined>(undefined);
    if (listIdentityKey && ufSelectionsRef.current?.key !== listIdentityKey) {
        ufSelectionsRef.current = { key: listIdentityKey, selections: parseUserFilterParams(searchParams) };
    }
    const initialUfSelections = listIdentityKey ? ufSelectionsRef.current?.selections : undefined;
    const handleUserFilterSelectionsChange = useCallback(
        (selections: Record<string, Array<string | number | boolean>>) => {
            setSearchParams(prev => {
                const next = applyUserFilterParams(prev, selections);
                // objectui#11860 — this page's own write (see `ownListParamsRef`).
                ownListParamsRef.current = userFilterParamsKey(next);
                return next;
            }, { replace: true });
        },
        [setSearchParams],
    );
    return { urlFilters, initialUfSelections, handleUserFilterSelectionsChange };
}
