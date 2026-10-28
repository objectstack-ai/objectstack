/**
 * The list renderer of the Console `ObjectView` (`./ObjectView.tsx`):
 * `renderListView`, the callback the plugin `ObjectView` calls to draw a view
 * through `ListView` (and the `type: 'chart'` face through `ObjectChart`), with
 * the relay of the view's keys onto the list schema, the held list identity
 * refs, and the column-declaration flags only it reads, moved out of
 * `ObjectViewInner` verbatim (objectstack#25992, slice 11a). Every input is
 * passed in; the component reads the returned callback.
 */

import { useCallback, useRef, lazy, Suspense, type ReactNode } from 'react';
import { DENSITY_MODE_TO_ROW_HEIGHT, normalizeListViewSchema, type FilterTokenScope } from '@object-ui/core';
import { buildListFilterKey, writeListFilterState } from './listFilterStorage.js';
import type { useObjectListPreferences, ListViewPreference } from '../context/ListPreferencesProvider.js';
const ObjectChart = lazy(() =>
  import('@object-ui/plugin-charts').then((m) => ({ default: m.ObjectChart })),
);
import { ListView, type ListViewProps } from '@object-ui/plugin-list';
import type { ListViewSchema, TreeViewConfig } from '@object-ui/types';
import type { useAuth } from '@object-ui/auth';
import type { useActionTextLocalizer } from '@object-ui/react';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { resolveManagedByEmptyState } from '../utils/managedByEmptyState.js';
import { isSavedViewId } from '../utils/viewIdentity.js';
import { warnSuppressedListNav } from '../utils/warnSuppressedListNav.js';
import type { isSetupAppSegment } from '../console/setupApp.js';
import type { useObjectActions } from '../hooks/useObjectActions.js';
import { substituteFilterTokens } from './objectViewHelpers.js';
import type { buildViewTabs } from './objectViewTabs.js';
import {
    timelineViewOptions,
    calendarViewOptions,
    ganttViewOptions,
    galleryViewOptions,
    kanbanViewOptions,
    storedLegacyOptions,
    isSameOptionsValue,
} from './objectViewOptions.js';
import { keepInlineEditModeForTheSession } from './objectViewChrome.js';
import { OpenAsPageLink } from './objectViewOpenAsPage.js';
import type { useObjectViewIdentity } from './objectViewIdentity.js';
import type { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import type { useObjectViewToolbarAffordances } from './objectViewToolbarAffordances.js';
import type { useObjectViewListUrlState, useObjectViewUrlFilters } from './objectViewListUrlState.js';
import type { useObjectViewTabBar } from './objectViewTabBar.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewListRenderer({
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
    navOverlay,
    recordOpen,
    openAsPage,
    urlFilters,
    initialUfSelections,
    handleUserFilterSelectionsChange,
    viewTabRow,
    viewTabBar,
}: {
    objectName: string | undefined;
    inSetup: ReturnType<typeof isSetupAppSegment>;
    t: ReturnType<typeof useObjectTranslation>['t'];
    viewEmptyState: ReturnType<typeof useObjectLabel>['viewEmptyState'];
    localizeActionTexts: ReturnType<typeof useActionTextLocalizer>;
    viewDraft: Partial<ReturnType<typeof buildViewTabs>[number]> | null;
    user: ReturnType<typeof useAuth>['user'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    refreshKey: number;
    listAddRecordOpensCreate: ReturnType<typeof useObjectViewToolbarAffordances>['listAddRecordOpensCreate'];
    pageOffersCreate: ReturnType<typeof useObjectViewToolbarAffordances>['pageOffersCreate'];
    managedUsers: ReturnType<typeof useObjectViewIdentity>['managedUsers'];
    managedUserMarker: ReturnType<typeof useObjectViewIdentity>['managedUserMarker'];
    savedViews: Parameters<typeof buildViewTabs>[0]['savedViews'];
    listPrefs: ReturnType<typeof useObjectListPreferences>;
    derivedColumnViewIds: Set<string>;
    baseView: ReturnType<typeof buildViewTabs>[number];
    activeView: ReturnType<typeof buildViewTabs>[number];
    listIdentityKey: ReturnType<typeof useObjectViewListUrlState>['listIdentityKey'];
    listSeedRef: ReturnType<typeof useObjectViewListUrlState>['listSeedRef'];
    writeListUrlState: ReturnType<typeof useObjectViewListUrlState>['writeListUrlState'];
    filterScope: FilterTokenScope;
    actions: ReturnType<typeof useObjectActions>;
    handleRowClick: ReturnType<typeof useObjectViewRecordNavigation>['handleRowClick'];
    navOverlay: ReturnType<typeof useObjectViewRecordNavigation>['navOverlay'];
    /** objectstack#26681 — the Display menu's Open records section. */
    recordOpen: NonNullable<ListViewProps['recordOpen']>;
    /** objectstack#26681 — the name cell's ↗ (`./objectViewOpenAsPage.tsx`), or `null` for none. */
    openAsPage: { objectName: string; label: string } | null;
    urlFilters: ReturnType<typeof useObjectViewUrlFilters>['urlFilters'];
    initialUfSelections: ReturnType<typeof useObjectViewUrlFilters>['initialUfSelections'];
    handleUserFilterSelectionsChange: ReturnType<typeof useObjectViewUrlFilters>['handleUserFilterSelectionsChange'];
    viewTabRow: ReturnType<typeof useObjectViewTabBar>['viewTabRow'];
    viewTabBar: ReturnType<typeof useObjectViewTabBar>['viewTabBar'];
}) {
    // objectui#10694 — does the active view, as AUTHORED, declare a non-empty
    // `columns`? Booleans, so the relay keys on values and not on the memo's
    // Set (AGENTS.md #10).
    //
    // The TAB answers from its stored body: its own non-empty `columns`, never
    // the defaults the views memo drew into it.
    const activeTabDeclaresColumns = !!baseView && !derivedColumnViewIds.has(baseView.id)
        && Array.isArray(baseView.columns) && baseView.columns.length > 0;
    // A config-panel DRAFT answers only with `columns` the admin changed. The
    // panel seeds its draft from `activeView` and relays every field on every
    // edit (and again on Discard), so an untouched draft carries the tab's
    // columns verbatim — on an unprojected tab, the memo's drawn defaults.
    // Compared by content, never by identity (AGENTS.md #10).
    const draftColumnsEdited = !!viewDraft && viewDraft.id === baseView?.id && 'columns' in viewDraft
        && !isSameOptionsValue(viewDraft.columns, baseView?.columns);
    const activeViewDeclaresColumns = draftColumnsEdited
        ? Array.isArray(viewDraft!.columns) && viewDraft!.columns.length > 0
        : activeTabDeclaresColumns;
    // objectui#12505 — is the active tab a SAVED view (a row the adapter's
    // `listViews` serves), by the classifier every mutating handler asks
    // (`isSavedViewId`)? It decides where the user's own Hide Fields choice
    // applies on a tab that declares no projection (see `persistHiddenFields`).
    // A boolean, so the relay keys on a value (AGENTS.md #10).
    const activeViewIsSaved = !!baseView && isSavedViewId(savedViews, baseView.id);

    // objectui#10046 — the last `options` bag handed to `ListView`, so an
    // equal-content rebuild keeps its identity (see `isSameOptionsValue`).
    // A ref, not a `useMemo`: React may discard a memo cache and hand back a
    // fresh object (AGENTS.md #10); a ref survives every re-render, and the
    // value comparison — not the ref — is what decides a real change.
    const heldListOptions = useRef<unknown>(undefined);
    // objectui#7237 — the same hold for the resolved `filter`, same reason:
    // token substitution hands back a NEW array of identical content on every
    // call, and `ListView` names `schema.filter` by identity in its fetch
    // effect, so each host re-render re-issued the identical list query.
    const heldListFilter = useRef<unknown>(undefined);

    // Render multi-view content via ListView plugin (for kanban, calendar, etc.)
    const renderListView = useCallback(({ schema: listSchema, dataSource: ds, onEdit: editHandler, className, refreshKey: pluginRefreshKey }: any) => {
        // Combine local refreshKey with the plugin ObjectView's refreshKey for full propagation
        const combinedRefreshKey = refreshKey + (pluginRefreshKey || 0);
        // objectui#10035 — AGENTS.md #8's corollary: refresh data, don't
        // rebuild UI. The counter above is a DATA signal, and it used to ride
        // in the `key` of everything below, so every save, delete, import or
        // realtime event threw the list away — its search box, open popovers,
        // scroll, selection and in-list visualization choice with it.
        // `identityKey` is what a remount is for (another object, another
        // view), and it is the whole key: `ListView` receives the counter as
        // `refreshTrigger`, which its fetch effect names, and the
        // visualizations that query for themselves (`gantt`, `chart`) refetch
        // in place on the data-invalidation bus (see `refreshData`). ⛔ Do not
        // put the counter back in the key.
        // `listIdentityKey` is this same identity plus the "Reset view"
        // generation (objectui#12418), which is the one other remount.
        const identityKey = listIdentityKey ?? `${objectName}-${activeView.id}`;
        const viewDef = activeView;

        // Per-user, per-view search-term cache. Restored into ListView at mount
        // so leaving via a nav link and coming back keeps what the user was
        // searching — URL params alone don't survive that (the nav link has no
        // query string). Keyed on the signed-in user so two accounts on one
        // browser never share it. The Filter panel's conditions are the user's
        // list state since objectui#12418 (`listPrefs`), not this cache.
        const listFilterKey = buildListFilterKey(user?.id, objectName, activeView.id);
        // objectui#12418 — this user's own state for this view: its sort and
        // filters arrive through the seed below, its column layout here.
        const viewPref: ListViewPreference | undefined = listPrefs.preference.perView?.[viewDef.id];
        const persistListSort = (sort: Array<{ field: string; order?: string }>) => {
            listPrefs.patchView(viewDef.id, { sort });
        };
        const persistListColumnState = (state: { order?: string[]; widths?: Record<string, number> }) => {
            listPrefs.patchView(viewDef.id, { columnState: state });
        };
        // objectui#11860 — what the list opens with: the URL's state, else this
        // cache (see `listSeedRef`). Same identity as the list's `key`.
        const listSeed = listSeedRef.current?.key === identityKey ? listSeedRef.current.state : undefined;

        // Warn in dev mode if flat properties are used instead of nested spec format.
        // ⛔ Only keys some spec per-kind block DECLARES (objectui#6152 round 15).
        // This list also named `dateField`, `groupBy`, `groupField`, `imageField`,
        // `xAxisField`, `subjectField`, `endField`, `cardFields`, `subtitleField`,
        // `yAxisFields`, `aggregation` and `series`, and told an author to move
        // them into the block, where every door refuses them by name and no
        // reader reads them (objectui#6152 rounds 14 and 15).
        if (process.env.NODE_ENV === 'development') {
            const flatKeys = ['startDateField', 'endDateField', 'locationField', 'chartType',
                'dependenciesField', 'progressField', 'colorField', 'allDayField',
                'latitudeField', 'longitudeField', 'zoom', 'center', 'descriptionField'];
            const nestedConfig = (viewDef as any)[viewDef.type] || {};
            const found = flatKeys.filter(k => k in viewDef && !(k in nestedConfig));
            if (found.length > 0) {
                console.warn(
                    `[Spec Compliance] View "${viewDef.id}" uses flat properties ${JSON.stringify(found)}. ` +
                    `Move them under viewDef.${viewDef.type || '<type>'} per @objectstack/spec protocol.`
                );
            }
        }

        /**
         * objectui#7891 — this branch forwards the AUTHORED `chart:` block, and
         * `config` is NOT part of it. Do not add a `config:` rung back.
         *
         * `@objectstack/spec`'s `ListChartConfigSchema` is a `strictObject`
         * declaring exactly `chartType` / `dataset` / `dimensions` / `values`,
         * and objectui binds it BY REFERENCE (`chart` is absent from
         * `LIST_VIEW_LOCAL_OVERRIDES`), so a `config` written on this block is
         * refused BY NAME — `unrecognized_keys ["config"]` — by the same schema
         * the platform's metadata write door parses every save through
         * (`saveMetaItem` -> `getMetadataTypeSchema('view')` -> 422
         * INVALID_METADATA, draft and publish alike). No conforming author can
         * write the key, and no write path can store it.
         *
         * Why nothing ever caught the forward: `ObjectChart` is published as
         * `(props: any)`, so this literal is checked against nothing whatever.
         * The `as any` casts that used to sit on both literals were measured
         * INERT — `tsc --noEmit` is green without them — so they are gone too;
         * they read as load-bearing and were not.
         *
         * Losing the key is a DEGRADE, not a break: `ChartRenderer` generates a
         * container config from `series` plus a positional palette when none is
         * present, so any non-conforming row still renders, with series-derived
         * labels and default colours.
         *
         * Pinned by `ObjectView.chartConfigForward-7891.test.tsx`.
         */
        if (viewDef.type === 'chart') {
            const chartConfig = viewDef.chart || {};
            // objectui#13114 — this branch returns before `ListView`, the
            // carrier of the view tabs on every other face, so it draws them
            // itself (`viewTabRow`) above the chart: without them a chart view
            // is a dead end with no way back to the grid.
            const withViewTabs = (chartFace: ReactNode) => (
                <div className="h-full flex flex-col min-w-0">
                    {viewTabRow}
                    {chartFace}
                </div>
            );
            // Both chart branches below are keyed on `identityKey` alone
            // (objectui#10035): `ObjectChart` runs its own query and refetches
            // in place on the data-invalidation bus (see `refreshData`).
            //
            // ADR-0021 (objectstack-ai/objectstack#1890): dataset-bound chart — the single author-facing
            // shape. Selects dimensions/measures BY NAME and runs through the
            // governed queryDataset path (numbers consistent across surfaces).
            if (chartConfig.dataset) {
                const dims: string[] = Array.isArray(chartConfig.dimensions) ? chartConfig.dimensions : [];
                const vals: string[] = Array.isArray(chartConfig.values) ? chartConfig.values : [];
                return withViewTabs(
                    <Suspense key={identityKey} fallback={<div className="p-4 text-sm text-muted-foreground">{t('chart.loading')}</div>}>
                        <ObjectChart
                            dataSource={ds}
                            schema={{
                                type: 'object-chart',
                                dataset: chartConfig.dataset,
                                dimensions: dims,
                                values: vals,
                                chartType: chartConfig.chartType || 'bar',
                                xAxisKey: dims[0],
                                series: vals.map((v: string) => ({ dataKey: v, label: v })),
                                // no `config` rung — see the block above (#7891)
                                className: 'h-[400px] w-full',
                            }}
                        />
                    </Suspense>
                );
            }
            // ⛔ NO LEGACY INLINE AGGREGATE (objectui#6152 round 15). A block
            // that names no `dataset` used to be translated here from the
            // pre-ADR-0021 axes (`xAxisField`, `yAxisFields[0]`, `aggregation`)
            // plus a `series` and a `filter` read off the block, floored at
            // `'name'` / `'value'` when it declared none. The spec's
            // `ListChartConfigSchema` refuses all five by name at every door, so
            // the path retired with them, floors included — the same retirement
            // as `ListView`'s `case 'chart'` and `generateViewSchema`'s.
            //
            // What is left is the UNBOUND chart: an object-bound node that names
            // no category, which `ObjectChart` refuses on screen (objectui#8168,
            // `chart-missing-category-axis`) instead of aggregating on a name
            // nobody wrote. ⛔ Do not restore a floor here.
            return withViewTabs(
                <Suspense key={identityKey} fallback={<div className="p-4 text-sm text-muted-foreground">{t('chart.loading')}</div>}>
                    <ObjectChart
                        dataSource={ds}
                        schema={{
                            type: 'object-chart',
                            objectName: objectDef.name,
                            chartType: chartConfig.chartType || 'bar',
                            // no `config` rung — see the block above (#7891)
                            className: 'h-[400px] w-full',
                        }}
                    />
                </Suspense>
            );
        }

        // objectui#12418 — the list opens on the user's stored sort and
        // filters, which are read in the console's one preference read; until
        // that read has answered, there is nothing to open on yet.
        if (!listPrefs.ready) {
            return <div className="h-full w-full" aria-busy="true" data-testid="object-view-list-preferences-pending" />;
        }

        // ADR-0053 wrong-context authoring: userFilters/quickFilters on an
        // object list view are suppressed below — say so instead of letting
        // the author stare at a toolbar with nothing where their filter
        // controls should be (#2219).
        warnSuppressedListNav(objectDef.name, viewDef.id || viewDef.name || '', viewDef as any, listSchema as any);

        // objectui#7029: present only when the view actually declared one.
        const calendarOptions = calendarViewOptions(viewDef);
        // objectui#10380: the stored row's judged legacy `options` bag. See
        // `storedLegacyOptions` for how the relay below layers it.
        const legacyOptions = storedLegacyOptions(viewDef);

        /**
         * objectui#12474 — the Hide Fields popover's choice is the USER's: it
         * is stored on their own list state (`listPrefs`, beside the sort and
         * the column layout), never written into the shared view, so one
         * user's click no longer hides a column for everyone and a walled
         * tenant member is not refused. It is a SUBTRACTION from the columns
         * the view declares: the popover offers only those (and, objectui#11984,
         * only the ones the caller may read), and the list draws `columns`
         * minus this list, so it can never add a column.
         *
         * On a view that declares no projection (objectui#10694: the views
         * memo DRAWS default columns into it, and the relay applies none of
         * the VIEW's `hiddenFields` there, see `activeViewDeclaresColumns`)
         * the rule splits by the kind of view:
         *
         * - A SAVED view (objectui#12505): the choice is stored all the same,
         *   and the relay's `hiddenFields` rung applies it — this user's list
         *   only, never the view's authored key — as a subtraction from the
         *   columns the view draws by default. It never adds a column: a
         *   stored name the drawn set lacks (a field since removed, a column
         *   the view later stops drawing) matches nothing and stays inert.
         *   Another user, with no list of their own, sees the defaults.
         * - A SYSTEM view, or the console-made fallback tab: session-only,
         *   per objectui#10694's ruling 5839344270 (B), whose operative
         *   sentence names "an object-route view that declares no projection
         *   and is not a saved view". `ListView` still hides the column in its
         *   own state, and nothing is stored. The author's remedy there is to
         *   declare `columns`.
         */
        const persistHiddenFields = (hidden: string[]) => {
            if (!activeViewDeclaresColumns && !activeViewIsSaved) return;
            listPrefs.patchView(viewDef.id, { hiddenFields: hidden });
        };

        /**
         * objectui#12949 — the VIEW'S OWN density and hidden fields, before
         * this user's preference (objectui#12474) is laid over them by the
         * `rowHeight` and `hiddenFields` rungs below. `ListView` reads these
         * through its `viewDefaults` prop: the Display control's count and its
         * "Reset to view default" compare the user's list against the view's,
         * not against the user's own stored choice. On a view that declares no
         * `columns` the view's authored `hiddenFields` is never applied
         * (objectui#10694, objectui#12505), so the view hides nothing there.
         */
        const viewRowHeight: ListViewSchema['rowHeight'] =
            (normalizeListViewSchema(viewDef ?? {}) as Pick<ListViewSchema, 'rowHeight'>).rowHeight
            ?? listSchema.rowHeight;
        const viewHiddenFields: ListViewSchema['hiddenFields'] = activeViewDeclaresColumns
            ? ((viewDef as any).hiddenFields ?? listSchema.hiddenFields)
            : undefined;


        /**
         * ⚠️ THE RELAY. Every key below is a rung carrying the ACTIVE VIEW's
         * value into `ListView`; `...listSchema` carries the HOST's.
         *
         * A `ListViewSchema` member with NO rung here is invisible to tsc, to
         * lint and to the tests — `viewDef` is `Record<string, any>`, so
         * nothing REQUIRES a key to be written. That silence shipped the same
         * defect three times (objectui#7199 `description`, objectui#7218
         * `rowColor`, objectui#7516 `fieldOrder` — all three carry their rung
         * below now), and objectui#7559 ended it:
         * `ObjectView.relayRungCensus-7559.test.ts` re-derives the member set
         * from the zod mirror at test time and requires every member to have
         * either a rung here or a DECLARED absence with a reason.
         *
         * ⇒ Adding a member to `ListViewSchema` and not relaying it is fine —
         * but it must be said out loud, in that file's `ABSENCES` ledger. ⛔ The
         * ledger is not a place to record a rung you did not feel like adding:
         * the kinds carry evidence, and each one is checked.
         */
        const fullSchema: ListViewSchema = {
            ...listSchema,
            // objectui#10035 — the refresh signal, in place of the remount the
            // key used to force. The spread above carries only the plugin
            // ObjectView's counter; this page's own counter (actions, import,
            // realtime, view edits, the console's `externalRefreshKey`) reached
            // `ListView` through the key alone. Both counters only grow, so
            // their sum moves whenever either does.
            refreshTrigger: combinedRefreshKey,
            // The active view's display label (same string the ViewTabBar
            // shows) — ListView appends it to export download filenames.
            label: viewDef.label ?? listSchema.label,
            /**
             * The active view's own description — the sentence the author wrote
             * to caveat THIS view (scope, staleness, "this lens is for
             * browsing, the dashboard is authoritative"), which is exactly the
             * text a per-view description is wanted for (objectui#7199).
             *
             * It was the one key of this relay's set with no rung, so
             * `schema.description` at the `ListView` end could only ever be the
             * object-level list's description and a per-view one was
             * unreachable — authored, validated, built and served, then
             * silently dropped here. Nothing errored: the value simply never
             * arrived, and the only symptom was a sentence missing from the
             * screen.
             *
             * ⚠️ NOT the object's own `objectDef.description`, which this page
             * renders as the `PageHeader` subtitle further down. Crossing the
             * two would put a view's caveat where the object's blurb belongs.
             * Same two-rung shape as `label` above.
             */
            description: viewDef.description ?? listSchema.description,
            // Propagate appearance/view-config properties for live preview.
            // objectui#7924 (ruling A′): the view's density is read THROUGH the
            // fold, view over list, the same route as the `userActions` rung
            // below. A stored view that still spells it `densityMode` arrives
            // here as `rowHeight`, and this relay never names the retired key.
            // objectui#12474 — the density this user chose is laid over it:
            // the view's own is the default for a user who has not chosen.
            // The fold stays spelled out on this rung, where the relay census
            // (`ObjectView.relayRungCensus-7559.test.ts`) reads it for the
            // retired `densityMode`; `viewRowHeight` above is the same value.
            rowHeight:
                viewPref?.rowHeight
                ?? (normalizeListViewSchema(viewDef ?? {}) as Pick<ListViewSchema, 'rowHeight'>).rowHeight
                ?? listSchema.rowHeight,
            // Hydrate the persisted settings so they survive reload. The sort
            // and the column layout (objectui#12418), the density and the
            // hidden fields (objectui#12474) are the USER's: they are read
            // from and written to `listPrefs`, never `/meta/view`. No list
            // toolbar control writes the shared view; the view editor's
            // explicit save does.
            //
            // objectui#11860 — a sort the URL carries is applied over the
            // view's: an opened link sorts as it was sorted. Without a link,
            // the seed carries the sort this user left the view with
            // (objectui#12418). `ListView` reads this as the list's declared
            // sort too, so its "reset to default" returns to the sort the list
            // opened with; "Reset view" returns to the view's own.
            sort: listSeed?.sort ?? (viewDef as any).sort ?? listSchema.sort,
            // objectui#11860 — and a grouping the URL carries is laid over the
            // view's, which the caller composed into `listSchema` (the census
            // declares `grouping` relayed upstream; this reads no `viewDef`).
            // `ListView` seeds its toolbar grouping from this value.
            grouping: listSeed?.grouping ?? listSchema.grouping,
            // The ONE place this view's effective filter is computed (#2890).
            // It used to be computed twice — once here as `filter` for the child
            // views, once further down as `filters` for ListView — with the two
            // copies subtly different (only this one fell back to
            // `listSchema.filter`; only that one ran token substitution over the
            // URL filters). Now: base ?? listSchema, concatenated with the URL
            // filters, and substituted as a whole.
            filter: (() => {
                const base = (viewDef as any).filter ?? listSchema.filter;
                const baseArr = Array.isArray(base) ? base : base ? [base] : [];
                const combined = urlFilters.length ? [...baseArr, ...urlFilters] : base;
                const resolved = substituteFilterTokens(combined, filterScope);
                // objectui#7237 — equal content keeps the identity `ListView`
                // names (and hands the self-querying views); a real change —
                // another URL filter, another session scope, a date macro that
                // resolves differently — still hands over the new value.
                if (isSameOptionsValue(heldListFilter.current, resolved)) {
                    return heldListFilter.current;
                }
                heldListFilter.current = resolved;
                return resolved;
            })(),
            /**
             * objectui#10694 — both composition keys apply only when the view
             * declares a non-empty `columns`. The views memo draws defaults
             * into an unprojected view, and `ListViewSchema.columns` (spec
             * source at objectstack `origin/main`, objectstack#19598) says an
             * empty list "declares no projection, so neither of them applies".
             * The same gate `InterfaceListPage` puts on a source view
             * (objectui#10638), so the two routes compose a view one way. The
             * value is set to `undefined`, not omitted: `...listSchema` above
             * already carries the host's echo of the view's keys.
             */
            hiddenFields: activeViewDeclaresColumns
                // objectui#12474 — this user's own hidden fields over the
                // view's (a subtraction from the same `columns`).
                ? (viewPref?.hiddenFields ?? viewHiddenFields)
                // objectui#12505 — on an unprojected SAVED view, this user's
                // own list alone, subtracted from the drawn defaults; the
                // view's authored key stays unapplied, as above. See
                // `persistHiddenFields` for why a system view gets none.
                : activeViewIsSaved
                    ? viewPref?.hiddenFields
                    : undefined,
            /**
             * The per-view ORDERING of the field composition
             * `columns` x `hiddenFields` x `fieldOrder` (objectui#7516) —
             * objectstack#15184 ruling B kept the key and wrote the
             * composition into the contract: `columns` projects,
             * `hiddenFields` (the rung above) subtracts, `fieldOrder` sorts
             * what survives, an unlisted survivor sorting last. `ListView`'s
             * `effectiveFields` memo runs those steps on `schema.fieldOrder`;
             * this rung only delivers the view's value into that slot, the
             * one the list-node spelling fills, so the two compose alike.
             *
             * View over list node — the precedence of the `hiddenFields` rung
             * above; a view that authors no order keeps the list node's. It
             * was the one per-view half of the composition with no rung:
             * authored, served, then dropped here.
             */
            fieldOrder: activeViewDeclaresColumns
                ? (viewDef.fieldOrder ?? listSchema.fieldOrder)
                : undefined,
            // objectui#12418 — the user's column layout over the view's. `{}`
            // when neither has one: this host persists the layout, so the
            // grid's own per-browser fallback must not stand in for it (and a
            // "Reset view" must reach the grid).
            columnState: viewPref?.columnState ?? (viewDef as any).columnState ?? (listSchema as any).columnState ?? {},
            onDensityChange: (mode) => {
                // objectui#12474 — the USER's density, on their own list state,
                // never the shared view. Stored as the spec-canonical
                // `rowHeight` (#2890), the vocabulary the rung above reads.
                listPrefs.patchView(viewDef.id, {
                    rowHeight: DENSITY_MODE_TO_ROW_HEIGHT[mode],
                });
            },
            onSortChange: persistListSort,
            // NO `onFilterChange` (objectui#4155): the filter panel is session
            // state. ListView keeps it in `currentFilters` and applies it to the
            // live query; nothing about it reaches the stored view.
            onHiddenFieldsChange: persistHiddenFields,
            onColumnStateChange: persistListColumnState,
            // objectui#11013 — `inlineEdit` only. The `editRecordsInline`
            // spelling this also read has no producer: no console surface
            // writes it and the spec's view schema refuses it by name.
            inlineEdit: viewDef.inlineEdit ?? listSchema.inlineEdit,
            // ADR-0047 — spec `appearance` (incl. allowedVisualizations, the
            // runtime visualization whitelist) flows from the view metadata;
            // the legacy bare `showDescription` flag is folded in on top.
            appearance: viewDef.appearance
                ? (viewDef.showDescription != null
                    ? { ...viewDef.appearance, showDescription: viewDef.showDescription }
                    : viewDef.appearance)
                : (viewDef.showDescription != null
                    ? { showDescription: viewDef.showDescription }
                    : listSchema.appearance),
            // The author's INTENT to offer a visualization switcher: more than
            // one type whitelisted. Deliberately not the final predicate — this
            // face counts the whitelist, and the whitelist is not the offer.
            //
            // `ListView` intersects it with the capability gate and draws the
            // chrome only when the INTERSECTION has more than one entry
            // (objectui#7547, `viewSwitcherOffered`). It has to be decided
            // there: the gate that knows which types actually resolve lives in
            // that component, so a view whitelisting `['grid', 'timeline']`
            // with no timeline block reads as two here and one there. Counting
            // this number alone is what drew switcher chrome around a single
            // Grid entry.
            showViewSwitcher:
                ((viewDef.appearance ?? listSchema.appearance)?.allowedVisualizations?.length ?? 0) > 1,
            // Toolbar policy — one vocabulary (#2890). Stored views may still
            // carry the legacy bare `show*` flags, so each side is run through
            // `normalizeListViewSchema` (the single fold) and merged, view over
            // list. This relay never names a legacy key itself.
            userActions: {
                ...(normalizeListViewSchema(listSchema ?? {}) as { userActions?: object }).userActions,
                ...(normalizeListViewSchema(viewDef ?? {}) as { userActions?: object }).userActions,
            },
            // objectui#11013 — no `allowExport` rung, and `exportOptions` is no
            // longer withheld on a view's `allowExport: false`. Nothing writes
            // `allowExport` onto a view: no console surface does, and the
            // spec's view schema refuses it by name (the seat's disposition on
            // objectstack#20456: no producer, no declared spelling). The
            // export gate `ListView` keeps reading is the HOST's, carried in
            // by `...listSchema` from the object-view node.
            exportOptions: viewDef.exportOptions ?? listSchema.exportOptions,
            color: viewDef.color ?? listSchema.color,
            /**
             * The spec-canonical row-colour CONFIGURATION the author put on
             * THIS view (objectui#7218) — `ListView` seeds `rowColorConfig`
             * from it and colours whole rows from the named field's value.
             *
             * It was the one key of this relay's set with no rung, so
             * `schema.rowColor` at the `ListView` end could only ever be what
             * the host put on the list schema, and a per-view colour was
             * unreachable — authored, validated, built and served, then
             * silently dropped here. Same two-rung shape as `description`
             * above, and the same shape the interface route has shipped all
             * along (`InterfaceListPage.tsx`, `rowColor: view.rowColor`).
             *
             * The bare `color` above is the LEGACY shorthand for this same
             * feature and already had a rung; this adds the canonical one.
             *
             * NOT `userActions.rowColor`, relayed above through the toolbar
             * fold — that is a boolean permission toggle sharing this name at
             * a different nesting level ('may the user open the colour panel'
             * versus 'what the colours are').
             */
            rowColor: viewDef.rowColor ?? listSchema.rowColor,
            // objectui#11013 — the seven renderer flags this relay used to read
            // off the active view (`wrapHeaders`, `clickIntoRecordDetails`,
            // `addRecordViaForm`, `addDeleteRecordsInline`,
            // `collapseAllByDefault`, `fieldTextColor`, `prefixField`) have no
            // rung. No console surface writes one onto a view, no view in this
            // repository authors one, and the spec's view schema refuses each
            // by name, so a stored view never supplies them. What reaches
            // `ListView` is the host's value, carried by `...listSchema` from
            // the object-view node (the objectui#5097 host-composition keys).
            // The census answers each in `ObjectView.relayRungCensus-7559.test.ts`.
            //
            // ViewData source override (spec `data` key): a view authored with
            // `data: {provider:'value', items}` must survive this explicit
            // picklist, or ObjectGantt falls back to provider:'object'.
            data: (viewDef as any).data ?? (listSchema as any).data,
            // Propagate new spec properties (P0/P1/P2)
            navigation: viewDef.navigation ?? listSchema.navigation,
            selection: viewDef.selection ?? listSchema.selection,
            pagination: viewDef.pagination ?? listSchema.pagination,
            searchableFields: viewDef.searchableFields ?? listSchema.searchableFields,
            resizable: viewDef.resizable ?? listSchema.resizable,
            rowActions: viewDef.rowActions ?? listSchema.rowActions,
            /**
             * Row-context action definitions derived from `objectDef.actions`
             * filtered by `locations.includes('list_item')`. These are full
             * `ActionDef` records (with label/icon/variant/params/recordIdParam
             * /bodyShape) the row menu renders with i18n-correct labels and
             * dispatches via the action runner; legacy `rowActions: string[]`
             * remains for back-compat where the action lives elsewhere.
             */
            rowActionDefs: (Array.isArray((objectDef as any)?.actions)
                ? (objectDef as any).actions
                    .filter((a: any) =>
                      Array.isArray(a?.locations) && a.locations.includes('list_item'))
                    // Localize label / confirm / success the same way the
                    // record_header and list_toolbar paths do — through the ONE
                    // shared resolver (objectui#4265), so this surface cannot
                    // drift back to a label-only resolution. The `visible` CEL
                    // is forwarded untouched (spread inside the localizer) and
                    // evaluated per-row at render time inside RowActionMenu.
                    .map((a: any) => localizeActionTexts(objectDef.name, a))
                : []),
            /**
             * Selection-bar actions. Unlike `rowActionDefs` above, these are
             * NOT resolved here: `ObjectGrid` is the single convergence point
             * of all three list callers (this view, plugin-view's ObjectView
             * and plugin-list's ListView), so it resolves each `bulkActions`
             * name against `objectDef.actions` and promotes it into the def
             * list itself (`resolveBulkActions`, objectui#3002). What we pass
             * through is the view author's own declaration.
             */
            bulkActions: viewDef.bulkActions ?? listSchema.bulkActions,
            bulkActionDefs: (viewDef as any).bulkActionDefs ?? (listSchema as any).bulkActionDefs,
            sharing: viewDef.sharing ?? listSchema.sharing,
            // objectui#13089 — the Add button `ListView` draws from
            // `addRecord.enabled` opens the header New's create (`onAddRecord`
            // below), so it follows the New's verdict: withheld, not drawn
            // dead, for a viewer who may not create or whose create is greyed.
            addRecord: listAddRecordOpensCreate ? viewDef.addRecord ?? listSchema.addRecord : undefined,
            conditionalFormatting: viewDef.conditionalFormatting ?? listSchema.conditionalFormatting,
            // ADR-0047 (amended, objectui #2338): this is the object default
            // list = "views" mode. `dropdown` (value-chip) userFilters ARE
            // allowed here — they're the Airtable quick-filter pills. Only the
            // `tabs` preset style stays page-only (it would collide with the
            // ViewTabBar above, which owns the tab-bar role — use `listViews`
            // for named presets). `quickFilters` stays suppressed entirely.
            quickFilters: undefined,
            userFilters: (() => {
                const uf = (viewDef.userFilters ?? listSchema.userFilters) as
                    | { element?: string; tabs?: unknown }
                    | undefined;
                return uf && uf.element !== 'tabs' && uf.tabs == null ? uf : undefined;
            })(),
            showRecordCount: viewDef.showRecordCount ?? listSchema.showRecordCount,
            allowPrinting: viewDef.allowPrinting ?? listSchema.allowPrinting,
            emptyState:
                viewEmptyState(
                    objectDef.name,
                    viewDef.name || viewDef.id || '',
                    viewDef.emptyState
                        ?? listSchema.emptyState
                        ?? resolveManagedByEmptyState((objectDef as any)?.managedBy, t, objectDef.name, (objectDef as any)?.userActions, pageOffersCreate),
                ),
            aria: viewDef.aria ?? listSchema.aria,
            // (the legacy `filters` twin of the `filter` above lived here until
            // #2890 — see the note at its single remaining computation)
            //
            // objectui#11860 — and a second `sort` write lived here, the view's
            // own sort spread in AFTER the `sort` rung above. Redundant with
            // that rung while it read the view alone; once the rung put a
            // URL-carried sort first, this spread overrode it on every view
            // that declares a sort, so a link's sort reached the address bar
            // and never the query. The rung is the one `sort` write.
            // objectui#10380 — for each kind the stored row's legacy `options`
            // bag carries, the view's own top-level block goes out at the top
            // level, as `InterfaceListPage` sends it. `ListView` then lays it
            // over the bag per key: the top-level block wins where both set a
            // key, which is the precedence the spec declares for the bag. A kind
            // the bag does not carry is relayed only through `options` below,
            // exactly as before. See `storedLegacyOptions`.
            ...(legacyOptions.kanban !== undefined ? { kanban: viewDef.kanban } : {}),
            ...(legacyOptions.calendar !== undefined ? { calendar: viewDef.calendar } : {}),
            ...(legacyOptions.timeline !== undefined ? { timeline: viewDef.timeline } : {}),
            ...(legacyOptions.map !== undefined ? { map: viewDef.map } : {}),
            ...(legacyOptions.gallery !== undefined ? { gallery: viewDef.gallery } : {}),
            ...(legacyOptions.gantt !== undefined ? { gantt: viewDef.gantt } : {}),
            ...(legacyOptions.tree !== undefined ? { tree: viewDef.tree } : {}),
            ...(legacyOptions.chart !== undefined ? { chart: viewDef.chart } : {}),
            options: {
                // objectui#10380 — the stored row's judged legacy bag, forwarded
                // as the interface page forwards it. For each kind the bag
                // carries, its block REPLACES this page's synthesized block below
                // (the `mapCfg` rule of `InterfaceListPage`). Each synthesized
                // block stands in only for a kind the bag does not carry.
                ...legacyOptions,
                // The lane key is the spec's `groupByField`, not the legacy
                // `groupField` this used to write. See `kanbanViewOptions`.
                kanban: legacyOptions.kanban ?? kanbanViewOptions(viewDef, objectDef),
                // The calendar config the view DECLARED, or no calendar key at
                // all — never an invented field name (objectui#7029). With the
                // key absent, ListView's capability gate stops offering the
                // Calendar toggle for a view that configured none, and a view
                // forced onto the calendar renderer reaches its refusal screen.
                ...((legacyOptions.calendar ?? calendarOptions)
                    ? { calendar: legacyOptions.calendar ?? calendarOptions }
                    : {}),
                // The date axis is resolved once, in ListView — this face only
                // forwards what the view declared, floored at 'name'
                // (objectui#3129, objectui#6557). See `timelineViewOptions`.
                timeline: legacyOptions.timeline ?? timelineViewOptions(viewDef),
                map: legacyOptions.map ?? {
                    locationField: viewDef.map?.locationField,
                    titleField: viewDef.map?.titleField || 'name',
                    latitudeField: viewDef.map?.latitudeField,
                    longitudeField: viewDef.map?.longitudeField,
                    zoom: viewDef.map?.zoom,
                    center: viewDef.map?.center,
                },
                // The gallery config the view DECLARED, title floored at
                // 'name', and no invented cover field (objectui#7547). With no
                // cover binding to forward, ListView's capability gate stops
                // offering the Gallery toggle to a view that configured none.
                // See `galleryViewOptions`.
                gallery: legacyOptions.gallery ?? galleryViewOptions(viewDef),
                // The gantt config the view DECLARED, title floored at 'name' —
                // never an invented date field (`5f4514f7b`). With no date
                // binding to forward, ListView's capability gate stops offering
                // the Gantt toggle to a view that configured none, and a view
                // forced onto the gantt renderer reaches its refusal screen.
                // See `ganttViewOptions`.
                gantt: legacyOptions.gantt ?? ganttViewOptions(viewDef),
                tree: legacyOptions.tree ?? {
                    // Self-referencing tree-grid config (plugin-tree). Spread the
                    // full view-defined tree first so parentField/fields/
                    // defaultExpandedDepth survive; labelField is floored at
                    // 'name'. parentField auto-detects when omitted.
                    //
                    // Read AS `TreeViewConfig` (`@object-ui/types`, objectui#8253):
                    // `viewDef` is `Record<string, any>`, so the canonical rung
                    // below was an `any` property access and a misspelling was
                    // invisible. This is the half of objectui#7559 a declaration CAN
                    // close, on the one block that now has a declaration to close it
                    // with — it does NOT make a missing rung visible, which is what
                    // the census pin (`ObjectView.relayRungCensus-7559.test.ts`) is
                    // for.
                    //
                    // ⚠️ The cast is repeated per rung rather than hoisted into a
                    // local: objectui#6557's convergence pin reads these seam lines
                    // out of this file and requires each to name `viewDef` itself.
                    //
                    // ⛔ No `titleField` rung (objectui#6152 round 14). `TreeViewConfig`
                    // is the spec's `ListView.tree` block, which refuses `titleField`
                    // by name (objectui#8841); the undeclared fallback that still
                    // read it is retired here and in `ListView` alike, so a stored
                    // `tree.titleField` labels nothing and the tree falls to 'name'.
                    ...((viewDef.tree as TreeViewConfig | undefined) || {}),
                    labelField: (viewDef.tree as TreeViewConfig | undefined)?.labelField || 'name',
                },
                // The chart block the view DECLARED, forwarded WHOLE — a
                // pointer, not a copy of its key set (objectui#7823).
                //
                // This was a hand-listed projection of six keys (`chartType` /
                // `xAxisField` / `yAxisFields` / `aggregation` / `series` /
                // `config`): the PRE-ADR-0021 set, frozen. The whole ADR-0021
                // (objectstack-ai/objectstack#1890) authoring shape (`dataset` / `dimensions` / `values`)
                // and the legacy `categoryField` / `valueField` spelling had no
                // rung here, so an author who declared them reached `ListView`
                // with the binding stripped. Once objectui#7544 gave
                // `ListView.availableViews` a chart capability check, that gate
                // was handed six `undefined` keys and correctly answered
                // "nothing declared" about a view whose author declared
                // everything — the Chart toggle stayed hidden, with no
                // diagnostic, while the legacy `xAxisField` spelling (which the
                // projection did carry) went on resolving.
                //
                // ⛔ NOT widened to nine keys. A hand-listed projection is a
                // COPY of a schema's key set and copies rot silently: three more
                // keys would buy this ADR's correctness and re-arm the identical
                // trap for the next block key, with nothing to fire — `viewDef`
                // is `Record<string, any>`, so a missing rung is invisible to
                // tsc (objectui#7559 owns that mechanism and disclaims the
                // census this belongs to).
                //
                // Forwarding whole is safe because `ListView` never SPREADS this
                // block — `resolveListChartBinding` and `case 'chart'` both read
                // it BY NAME — so keys it does not consult are ignored exactly
                // as they are for the `gantt` / `timeline` / `tree` blocks above,
                // which are already relayed whole. Undeclared stays `undefined`
                // rather than the old permanently-truthy husk, which is what
                // keeps the gate from offering a chart nobody configured.
                chart: legacyOptions.chart ?? viewDef.chart,
            },
        };
        // objectui#10046 — equal content keeps the identity `ListView`'s fetch
        // effect names; a real change (any differing value) still hands over
        // the new bag and still refetches. Pinned by
        // `ObjectView.hostRerenderRefetch-10046.test.tsx`.
        if (isSameOptionsValue(heldListOptions.current, fullSchema.options)) {
            fullSchema.options = heldListOptions.current as ListViewSchema['options'];
        } else {
            heldListOptions.current = fullSchema.options;
        }

        return (
            <ListView
                key={identityKey}
                schema={fullSchema}
                // objectui#12949 — the view's own values under the user's
                // preference, for the Display control's reset and count.
                viewDefaults={{ hiddenFields: viewHiddenFields, rowHeight: viewRowHeight }}
                className={className}
                onEdit={editHandler}
                // objectui#13089 — the view's Add button is the header New:
                // `onEdit(null)`, which the host routes to the record-form
                // overlay or an `editMode: 'page'` object's create route.
                onAddRecord={listAddRecordOpensCreate ? actions.create : undefined}
                onDelete={(record: any) => {
                    if (record?.id != null) {
                        // useObjectActions.deleteRecord wraps execute() which
                        // already shows a confirmation dialog + success toast
                        // and triggers onRefresh on success.
                        // Pass the row so the confirmation names the
                        // record (objectui#11695).
                        actions.deleteRecord(String(record.id), record);
                    }
                }}
                onBulkDelete={(records: any[]) => {
                    const valid = records.filter((r: any) => r?.id != null);
                    if (valid.length === 0) return;
                    // `deleteRecords` confirms once for the whole batch, with the
                    // shared copy that counts it (objectui#11695), and the
                    // batch-aware delete handler handles refresh + toast.
                    actions.deleteRecords(valid);
                }}
                onRowClick={(record: any, event?: any) => {
                    handleRowClick(record, event);
                }}
                onSortChange={(sort: any) => {
                    // objectui#12418 — this user's sort, not the view's.
                    persistListSort(sort);
                    writeListUrlState({ sort });
                }}
                // objectui#11860 — the URL only: nothing else stores the
                // toolbar grouping, and the view's own stays as authored.
                onGroupingChange={(grouping) => writeListUrlState({ grouping: grouping ?? null })}
                onFilterChange={(filter: any) => {
                    // The USER's state (objectui#12418), never the view's
                    // stored body (objectui#4155) — the user's list state keeps
                    // the BUILDER's group verbatim, read back into
                    // `initialFilters`, which needs `conditions` (and the row
                    // ids) to rehydrate the toolbar. It follows the user to
                    // another browser, and the panel's own "Clear all" clears
                    // it: it writes an empty group through this same handler.
                    listPrefs.patchView(viewDef.id, { filters: filter });
                    // objectui#11860 — and the URL, so the list is a link.
                    writeListUrlState({ filters: filter });
                }}
                onSearchChange={(search: string) => {
                    writeListFilterState(listFilterKey, { search });
                    writeListUrlState({ search });
                }}
                onHiddenFieldsChange={persistHiddenFields}
                // objectui#5144 (ruling E): session-only, writes nothing.
                onInlineEditChange={keepInlineEditModeForTheSession}
                onColumnStateChange={persistListColumnState}
                userFilterSelections={initialUfSelections}
                onUserFilterSelectionsChange={handleUserFilterSelectionsChange}
                initialFilters={listSeed?.filters}
                initialSearchTerm={listSeed?.search}
                // objectui#12440 — the saved-view tabs, on the list's own
                // toolbar row (see `viewTabBar`). `undefined` below `sm`.
                toolbarLeading={viewTabBar ?? undefined}
                // objectui#12606 — Setup's list opens without row numbers in
                // the leading cell. A host prop, not a view key: a console
                // posture, never metadata.
                defaultRowNumbers={!inSetup}
                // objectui#13330 — on a managed environment, the Users list
                // marks a user who holds nothing beyond the baseline. A host
                // prop the grid draws beside the row's title.
                rowAdornment={managedUsers ? managedUserMarker : undefined}
                // objectstack#26681 — for a row that opens the drawer, the ↗
                // beside its record link that opens the record as the full page.
                recordLinkAdornment={openAsPage
                    ? (row: Record<string, unknown>) => {
                        const id = row?.id ?? row?._id;
                        return (typeof id === 'string' && id !== '') || typeof id === 'number'
                            ? <OpenAsPageLink objectName={openAsPage.objectName} recordId={id} label={openAsPage.label} />
                            : null;
                    }
                    : undefined}
                // objectstack#26681 — the Display menu's Open records section.
                recordOpen={recordOpen}
                dataSource={ds}
            />
        );
    }, [inSetup, activeView, activeViewDeclaresColumns, activeViewIsSaved, objectDef, objectName, refreshKey, navOverlay, actions, urlFilters, initialUfSelections, handleUserFilterSelectionsChange, writeListUrlState, user?.id, pageOffersCreate, listAddRecordOpensCreate, listIdentityKey, listPrefs.ready, listPrefs.preference, listPrefs.patchView, viewTabBar, viewTabRow, managedUsers, managedUserMarker, recordOpen, openAsPage]);

    return { renderListView };
}
