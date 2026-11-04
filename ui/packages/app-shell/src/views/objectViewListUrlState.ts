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
    type ListUrlFieldGate,
    type ListUrlState,
    type ListSortRule,
} from './userFilterUrlState.js';
import { buildListFilterKey, readListFilterState, clearListFilterState } from './listFilterStorage.js';
import type {
    useObjectListPreferences,
    ListFilterGroupPreference,
    ListSortPreference,
} from '../context/ListPreferencesProvider.js';
import { parseUrlEqualityFilterTriples } from './drillUrlFilters.js';
import { selectFilterParams } from './objectViewHelpers.js';
import type { buildViewTabs } from './objectViewTabs.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';
import type { ListPersonalizationPart } from './ListPersonalizedMarker.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * objectstack#28950 — the params with the reader's whole `uf_*` list state
 * removed: the Filter panel, search, sort and grouping, and every user-filter
 * chip. Through the owning module's own writers, so the family has one
 * definition. Every other param (`filter[...]` drill scope, `recordId`, ...)
 * is kept.
 */
export function withoutListStateParams(prev: URLSearchParams): URLSearchParams {
    const chips = parseUserFilterParams(prev);
    const cleared = chips
        ? applyUserFilterParams(prev, Object.fromEntries(Object.keys(chips).map(field => [field, []])))
        : new URLSearchParams(prev);
    return applyListStateParams(cleared, { filters: null, search: null, sort: null, grouping: null });
}

/**
 * objectstack#28949 — the stored sort through the seed's field gate: a level
 * naming a refused field is dropped and the levels around it keep their order.
 * An empty stored sort is a sort the user cleared, and it is kept; one whose
 * every level was dropped is no sort at all, so the view's own sort applies.
 */
export function acceptStoredSort(
    sort: readonly ListSortPreference[] | undefined,
    acceptField: ListUrlFieldGate,
): ListSortRule[] | undefined {
    if (!sort) return undefined;
    const kept = sort.filter(level => acceptField(level.field));
    return sort.length === 0 || kept.length > 0 ? kept : undefined;
}

/**
 * objectstack#28949 — the stored Filter panel group through the seed's field
 * gate, at any nesting: a condition naming a refused field is dropped, a
 * nested group left with no condition is dropped with it, and every other
 * entry is kept exactly as stored (ids included: the panel rehydrates them).
 * A group nothing was dropped from is returned as is; one left with no
 * condition at all is no filter, and the list opens unfiltered.
 */
export function acceptStoredFilters(
    group: ListFilterGroupPreference | undefined,
    acceptField: ListUrlFieldGate,
): ListFilterGroupPreference | undefined {
    if (!group || !Array.isArray(group.conditions)) return group;
    let dropped = false;
    const conditions: unknown[] = [];
    for (const entry of group.conditions) {
        if (isRecord(entry) && Array.isArray(entry.conditions)) {
            const nested = acceptStoredFilters(entry as ListFilterGroupPreference, acceptField);
            if (nested !== entry) dropped = true;
            if (nested) conditions.push(nested);
        } else if (isRecord(entry) && typeof entry.field === 'string' && entry.field && !acceptField(entry.field)) {
            dropped = true;
        } else {
            conditions.push(entry);
        }
    }
    if (!dropped) return group;
    return conditions.length > 0 ? { ...group, conditions } : undefined;
}

export function useObjectViewListUrlState({
    objectName,
    objectDef,
    activeView,
    viewResolving,
    listPrefs,
    perms,
    user,
    searchParams,
    setSearchParams,
}: {
    objectName: string | undefined;
    objectDef: ConsoleObjectViewProps['objects'][number];
    activeView: ReturnType<typeof buildViewTabs>[number];
    /**
     * objectstack#30034 — the view the address (or the reader's pin) names is
     * still being resolved (`ObjectView`'s `awaitingPersonalViews`), so
     * `activeView` is only the view the page falls back to meanwhile.
     */
    viewResolving: boolean;
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
     * Neither seed is taken, and nothing is written, while the view the
     * address names is still being resolved (`viewResolving`, objectstack#30034):
     * the view on hand then is the fall-back, not the one asked for, and its
     * stored state written into the address would outlive it. The location
     * the router hands this page moves in a transition, so a read that lands
     * between that write and its commit renders against the old address,
     * finds nothing to change for the resolved view, and the fall-back's
     * filter and sort stay in a link that a reload or a colleague then opens.
     *
     * Both seeds pass the same field gate (`acceptField`, objectstack#28949):
     * a field stored before it was deleted, or before this user lost read on
     * it, is dropped exactly as a stale link's is, and the rest of the state
     * opens as stored.
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
    const listSeedRef = useRef<{ key: string; source: 'url' | 'storage'; state: ListUrlState; reset?: boolean } | undefined>(undefined);
    const ownListParamsRef = useRef<string | undefined>(undefined);
    // objectstack#28950 — set by "Reset to view" and taken by the next seed:
    // that list opens from the (just cleared) stored state, never from the
    // `uf_*` params, whoever wrote them, and its write-back strips them all.
    const resetPendingRef = useRef(false);
    if (listIdentityKey && listPrefs.ready && !viewResolving && listSeedRef.current?.key !== listIdentityKey) {
        // A field the object does not declare (a stale link, or a stored state
        // older than the field's deletion) or one this user cannot read is
        // dropped. Field-level permissions gate only once loaded — the same
        // gate `ListView` puts on its columns.
        const acceptField: ListUrlFieldGate = (field: string) =>
            !!objectDef.fields?.[field]
            && (!perms.isLoaded || perms.checkField(objectDef.name, field, 'read'));
        const carried = userFilterParamsKey(searchParams);
        const reset = resetPendingRef.current;
        resetPendingRef.current = false;
        if (carried && carried !== ownListParamsRef.current && !reset) {
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
                    filters: acceptStoredFilters(viewPref?.filters, acceptField) as ListUrlState['filters'],
                    search: stored?.search || undefined,
                    sort: acceptStoredSort(viewPref?.sort, acceptField),
                },
                reset,
            };
        }
    }
    useEffect(() => {
        const seed = listSeedRef.current;
        if (!seed || seed.key !== listIdentityKey) return;
        const next = applyListStateParams(seed.reset ? withoutListStateParams(searchParams) : searchParams, {
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
        // own changes, already on screen. (`listPrefs.ready` and
        // `viewResolving` because the seed is taken only once the user's own
        // state has been read and the view the address names is resolved; a
        // resolution that ends on the fall-back keeps the identity unchanged.)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }, [listIdentityKey, listPrefs.ready, viewResolving]);
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
     * objectstack#28950 — what of the reader's list differs from the view, as
     * the list reports it (`ListView`'s `onPersonalizationChange`), held with
     * the list identity it came from so a report never outlives its list. The
     * column layout is the one part only this page knows: a stored column
     * state is the reader's own.
     */
    const [reportedPersonalization, setReportedPersonalization] = useState<{
        key: string;
        parts: ReadonlyArray<ListPersonalizationPart>;
    } | undefined>(undefined);
    const handleListPersonalizationChange = useCallback(
        (key: string, parts: ReadonlyArray<ListPersonalizationPart>) => {
            setReportedPersonalization(prev =>
                prev && prev.key === key && prev.parts.join(',') === parts.join(',') ? prev : { key, parts });
        },
        [],
    );
    const listPersonalizedParts: ListPersonalizationPart[] = [
        ...(reportedPersonalization && reportedPersonalization.key === listIdentityKey
            ? reportedPersonalization.parts
            : []),
    ];
    if (activeView?.id && listPrefs.preference.perView?.[activeView.id]?.columnState
        && !listPersonalizedParts.includes('columns')) {
        listPersonalizedParts.push('columns');
    }

    /**
     * objectstack#28950 — "Reset to view", the marker's one way back: the
     * reader's whole list for the active view returns to the view's own. Their
     * stored entry goes (sort, filters, column layout, density, hidden fields,
     * objectui#12418), the cached search term with it, and the list opens
     * again from that cleared state (the identity moves, so it remounts and
     * re-seeds; a reset is the one case that WANTS the list's own state thrown
     * away). The new seed ignores the `uf_*` params and its write-back strips
     * them, chips included, so neither a reload nor Back brings the old list
     * back. The remount puts the grouping, layout, row color, row numbers,
     * inline edit and the "In a queue" toggle back to the view's.
     *
     * Not this view's list state, so untouched: the record-open preference,
     * the tab order (pinned views), favorites and a `filter[...]` scope a
     * "View all" link opened the list with.
     */
    const handleResetView = useCallback(() => {
        if (!activeView?.id) return;
        listPrefs.resetView(activeView.id);
        clearListFilterState(buildListFilterKey(user?.id, objectName, activeView.id));
        resetPendingRef.current = true;
        setListResetGeneration(g => g + 1);
    }, [activeView?.id, listPrefs.resetView, user?.id, objectName]);
    return {
        listIdentityKey,
        listSeedRef,
        ownListParamsRef,
        writeListUrlState,
        handleListPersonalizationChange,
        listPersonalizedParts,
        handleResetView,
    };
}

export function useObjectViewUrlFilters({
    searchParams,
    setSearchParams,
    listIdentityKey,
    ownListParamsRef,
    listSeedRef,
}: {
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
    listIdentityKey: ReturnType<typeof useObjectViewListUrlState>['listIdentityKey'];
    ownListParamsRef: ReturnType<typeof useObjectViewListUrlState>['ownListParamsRef'];
    listSeedRef?: ReturnType<typeof useObjectViewListUrlState>['listSeedRef'];
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
        // objectstack#28950 — the list "Reset to view" opened starts with no
        // chip selected: its seed strips their params from the address bar.
        const reset = listSeedRef?.current?.key === listIdentityKey && !!listSeedRef.current.reset;
        ufSelectionsRef.current = { key: listIdentityKey, selections: reset ? undefined : parseUserFilterParams(searchParams) };
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
