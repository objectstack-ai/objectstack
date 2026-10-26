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

import { useMemo, useState, useCallback, useEffect, useRef, lazy, Suspense, createElement, type ComponentType, type ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation, useHref } from 'react-router-dom';
import { resolveFilterPlaceholders, DENSITY_MODE_TO_ROW_HEIGHT, normalizeListViewSchema, leadWithNameField, resolveAffordance, isRecordScopedAction, type FilterTokenScope, type SchemaLike } from '@object-ui/core';
import {
    parseUserFilterParams,
    applyUserFilterParams,
    parseListStateParams,
    applyListStateParams,
    userFilterParamsKey,
    type ListStatePatch,
    type ListUrlState,
} from './userFilterUrlState.js';
import { buildListFilterKey, readListFilterState, writeListFilterState } from './listFilterStorage.js';
import { useObjectListPreferences, type ListViewPreference } from '../context/ListPreferencesProvider.js';
import { VALUELESS_FILTER_OPERATORS } from './viewFilterFold.js';
import { parseUrlEqualityFilterTriples } from './drillUrlFilters.js';
import { narrowPersonalizationOverlay, formatMetadataError } from '@object-ui/data-objectstack';
const ObjectChart = lazy(() =>
  import('@object-ui/plugin-charts').then((m) => ({ default: m.ObjectChart })),
);
const ImportWizard = lazy(() =>
  import('@object-ui/plugin-grid').then((m) => ({ default: m.ImportWizard })),
);
import { ListView } from '@object-ui/plugin-list';
import { ObjectView as PluginObjectView, ViewTabBar, ManageViewsDialog, deriveRecordSurface, overlayWidthFor } from '@object-ui/plugin-view';
import type { ViewTabItem } from '@object-ui/plugin-view';
import { RECORD_DRAWER_PARAM } from '../urlParams.js';
// Plugin registration is handled by the host app (e.g. apps/console/src/main.tsx
// uses ComponentRegistry.registerLazy so heavy plugins stay code-split).
// Do NOT add eager `import '@object-ui/plugin-*'` side-effect imports here.
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyTitle,
  EmptyDescription,
  NavigationOverlay,
  isFilterValueComplete,
} from '@object-ui/components';
import { Plus, Upload, Table as TableIcon, KanbanSquare, Calendar, LayoutGrid, Activity, GanttChart, MapPin, BarChart3, Lock, MoreHorizontal, RotateCcw } from 'lucide-react';
import { FavoriteMenuItem, useObjectListFavorite } from '../layout/SidebarItemMenu.js';
import { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import { useServedViewItems } from '../hooks/useServedViewItems.js';
import { viewTabLabel } from './viewTabLabel.js';
import { getIcon } from '../utils/getIcon.js';
import type { ActionBarSchema, DataSource, UIActionSchema, ListViewSchema, TreeViewConfig, ViewNavigationConfig } from '@object-ui/types';
import { detectStatusField, isSystemManagedField } from '@object-ui/types';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { ViewConfigPanel } from './ViewConfigPanel.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { dropPublishedViewList } from './metadata-admin/viewListDrop.js';
import { persistRuntimeMetadata, createRuntimeMetadata, viewEnvelope, type ViewEnvelope } from './runtime-metadata-persistence.js';
import { buildNewViewSpec } from './newViewSpec.js';
import { ListViewSchema as SpecListViewSchema, normalizeFilterOperator, VIEW_CONSOLE_ROUND_TRIP_KEYS } from '@objectstack/spec/ui';
import { CreateViewDialog } from './CreateViewDialog.js';
import {
  usePreviewDrafts,
  PREVIEW_QUERY_FLAG,
  PREVIEW_QUERY_VALUE,
} from '../preview/PreviewModeContext.js';
import { PageHeader } from '../layout/PageHeader.js';
import { useMobileViewSwitcherRegistration } from '../layout/MobileViewSwitcherContext.js';
import type { MobileViewSwitcherItem } from '../layout/MobileViewSwitcherContext.js';
import { ManagedByBadge } from '../components/ManagedByBadge.js';
import { isSetupAppSegment } from '../console/setupApp.js';
import { RecordDetailView } from './RecordDetailView.js';
import { appRecordPath, routableObjectNames } from './RelatedRecordActionsBridge.js';
import { documentHref } from './documentHref.js';
import type { RowCrudPredicates } from '../utils/crudAffordances.js';
import { createIdentityImportDataSource, IDENTITY_IMPORT_OBJECT, IDENTITY_IMPORT_WRITE_MODES, type IdentityPasswordPolicy } from './identityImport.js';
import { IdentityImportOptions, IdentityImportResultExtra, identityImportFields } from './IdentityImportPanels.js';
import { ManagedUsersInviteLine, MANAGED_USERS_OBJECT, UnauthorizedUserMarker, UserGrantLoader, isManagedEnvironment } from './managedEnvironmentUsers.js';
import { importTargetFields } from './importTargetFields.js';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { listToolbarDrawsAction, resolveManagedByEmptyState } from '../utils/managedByEmptyState.js';
import { mayReadObject } from '../utils/navObjectReadGate.js';
import { resolveViewId } from '../utils/resolveViewId.js';
import { defaultListViewId, viewRowId, isSavedViewId, viewEntry } from '../utils/viewIdentity.js';
import { warnSuppressedListNav } from '../utils/warnSuppressedListNav.js';
import { useObjectActions } from '../hooks/useObjectActions.js';
import { useObjectTranslation, useObjectLabel, useDisplayLocale, pickLocalized } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { useRealtimeSubscription, useConflictResolution } from '@object-ui/collaboration';
import { ActionProvider, useNavigationOverlay, SchemaRenderer, useActionTextLocalizer, useRowPredicate, RelatedRecordActionsProvider, notifyDataChanged, useCapabilityGate, usePredicateScope, useMetadata } from '@object-ui/react';
import type { RelatedRecordActionsValue, RelatedRecordHandlers } from '@object-ui/react';
import { toast } from 'sonner';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import { useOfferedNavRunAction } from '../hooks/useNavRunAction.js';
import { actionRendersAt } from '@object-ui/types';
import { useEnvironmentEntitlements } from '../environment/useEnvironmentEntitlements.js';
import { EnvironmentListToolbar } from '../environment/EnvironmentListToolbar.js';

/** Map view types to Lucide icons (Airtable-style) */
const VIEW_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
    grid: TableIcon,
    kanban: KanbanSquare,
    calendar: Calendar,
    gallery: LayoutGrid,
    timeline: Activity,
    gantt: GanttChart,
    map: MapPin,
    chart: BarChart3,
};

const FALLBACK_USER = { id: 'current-user', name: 'Demo User' };

/**
 * Replace built-in placeholders (e.g. `{current_user_id}`) inside a list-view
 * filter with concrete values. Filters from platform-shipped `listViews` or
 * saved `sys_view` rows may declare context-sensitive predicates like
 * `{ field: 'submitter_id', operator: 'equals', value: '{current_user_id}' }`
 * — those need to be substituted before the query reaches the API.
 *
 * Delegates to the shared `resolveFilterPlaceholders` in `@object-ui/core`,
 * which also expands date macros and understands `{current_org_id}`.
 *
 * This used to be a local implementation that bailed on non-array input
 * (`if (!Array.isArray(filter)) return filter`) and knew exactly one token.
 * That narrowness is why it could not be reused by dashboard widgets, whose
 * filters are MongoDB-style objects — so widgets went without any resolution
 * at all and silently rendered 0 (objectstack-ai/objectstack#3574). Every surface now routes
 * through one shape-agnostic resolver.
 */
function substituteFilterTokens(filter: any, scope: FilterTokenScope): any {
    return resolveFilterPlaceholders(filter, scope);
}

/**
 * Default list columns for an object that declares no explicit list view.
 *
 * Priority: the object's name field ALWAYS leads (see below); then the
 * `highlightFields` semantic role (ADR-0085) verbatim (only dropping names with
 * no field def); otherwise the first `limit` business fields in declared order.
 * Framework-injected system / audit / ownership columns are excluded via the
 * shared `isSystemManagedField` classifier — its single source of truth is the
 * spec `system` flag stamped by `applySystemFields`, with a name-set fallback
 * covering the injected, non-hidden / non-readonly `owner_id` and
 * `organization_id`. Without this, `applySystemFields` (which spreads injected
 * fields to the FRONT of the field map) would surface `owner_id` as a leading
 * raw-id column (#2702, #2777).
 *
 * The name-field lead is `leadWithNameField` from `@object-ui/core`
 * (objectui#7245). `highlightFields` is NOT a column list — it is ADR-0085's
 * "most important fields", and its first consumer, the detail highlight strip,
 * deliberately DROPS the title field because the page H1 above it already shows
 * one. So metadata that is entirely well-authored routinely omits the name:
 * `showcase_account` declares `["status", "industry", "annual_revenue"]` and its
 * default grid rendered 14 rows a user could not tell apart. A list has no H1,
 * so the same role needs the opposite treatment here. Applied to BOTH branches:
 * the fallback walk is declaration-ordered, so an object whose name field is
 * declared late lost it off the end of the `limit` slice.
 *
 * `opts.orgAttribution` (ADR-0105 group posture): reads span every
 * organization the member belongs to, so cross-org rows need attribution —
 * append `organization_id` as a TRAILING column when the object carries the
 * field. Trailing keeps business fields leading; render-time only, never
 * persisted into saved view metadata (a saved view must not fossilize a
 * posture-dependent column set).
 */
/**
 * objectui#12705 — the list toolbar's DECLARED primary action: the one its
 * author marked `variant: 'primary'`, the lowest `order` first (unset = 0), the
 * first declared on a tie. `undefined` when no action says so; the row's order
 * alone never makes one primary.
 */
export function declaredPrimaryToolbarAction(actions: readonly UIActionSchema[]): UIActionSchema | undefined {
    let primary: UIActionSchema | undefined;
    for (const action of actions) {
        if (action.variant !== 'primary' || !actionRendersAt(action, 'list_toolbar')) continue;
        if (!primary || (action.order ?? 0) < (primary.order ?? 0)) primary = action;
    }
    return primary;
}

/**
 * The `options.timeline` config this page hands to `ListView`.
 *
 * Deliberately does NOT resolve the date axis. `ListView.resolveTimelineDateBinding`
 * is the single read-site that decides which field a timeline buckets by, and it
 * reads the calendar binding when the view carries no timeline one. This face used
 * to fabricate `startDateField: 'due_date'` for every object view — a field name
 * the view never declared and most objects do not have — which both looked like a
 * real binding downstream and, because it is always present, shadowed the calendar
 * fallback entirely. The result on a calendar-bound view was a Timeline the
 * switcher offered and the renderer bucketed wholly into "No date" (objectui#3129).
 *
 * What stays here is the view's OWN declared config, floored at `'name'`. An
 * object-level `objectDef.titleField` leg used to sit in the middle of that
 * chain; it was removed in objectui#6557 because `@objectstack/spec`'s object
 * schema is a `strictObject` that REJECTS the key with `unrecognized_keys`, so
 * no legal object metadata could ever reach it (objectui#6531 established the
 * measurement, and dropped the twin read inside `getRecordDisplayName`).
 *
 * ⚠️ WHAT THE SIBLING BRANCHES BELOW ACTUALLY DO (`5f4514f7b`). The sentence
 * above used to end "— the same two-rung shape the calendar and gantt branches
 * below already use", and for gantt that was FALSE the whole time it stood: the
 * gantt branch floored `startDateField` / `endDateField` at `'start_date'` /
 * `'end_date'`, which is precisely the one-rung fabrication this note declares
 * retired. A note is the authority the next fixer consults, so it vouched for
 * the lines that were broken. Each branch is therefore stated as MEASURED, not
 * as a family:
 *
 *   - `calendarViewOptions` below — forwards a declared block or emits no
 *     `calendar` key at all; it never floors a date axis (objectui#7029).
 *   - `ganttViewOptions` below — forwards the declared block, title floored at
 *     `'name'`, and invents neither date field. Its `'start_date'` / `'end_date'`
 *     floors were deleted by `5f4514f7b`; that is what makes `ObjectGantt`'s
 *     own "Gantt configuration required" screen reachable from this route.
 *   - the TIMELINE axis at the two SIBLING FACES — `plugin-list/ListView.tsx`
 *     and `plugin-view/ObjectView.tsx`. Both floored `startDateField` at
 *     `'created_at'`, the very literal objectui#3129 retired HERE, and
 *     `ListView` carried it as a stated DECISION ("`created_at` stays the last
 *     resort for a view that declares no date axis anywhere") — two faces
 *     holding documented and OPPOSITE postures on one field name. That is what
 *     `5f4514f7b` routed to a single ruling instead of settling per-face, and
 *     the ruling (2026-09-01, 总监批 #28) answered it as house posture:
 *     日期轴永不虚构 — a date axis is never fabricated. Its step ③ deleted both
 *     floors, so all three faces now forward a declared axis or none, and
 *     `ObjectTimeline`'s own refusal screen (step ①, objectui#7459) is reachable
 *     from every one of them. This note no longer describes only THIS face.
 *
 * Exported for the regression suite.
 */
export function timelineViewOptions(viewDef: any): Record<string, unknown> {
    // The spec key only. objectui#6152 round 14 retired the pre-#2231
    // `timeline.dateField` rung: every list-view door refuses the alias by name,
    // and `ListView` no longer reads it either.
    const declaredStart = viewDef?.timeline?.startDateField;
    return {
        // Spread the full view-defined timeline config first so the spec fields
        // (startDateField/endDateField/groupByField/colorField/scale) survive.
        ...(viewDef?.timeline || {}),
        // Only ever restate a binding the view actually declared.
        ...(declaredStart ? { startDateField: declaredStart } : {}),
        titleField: viewDef?.timeline?.titleField || 'name',
        // objectui#6152 round 12: no `descriptionField`. The spec's timeline block
        // has no such member, the bag refuses it, and nothing drew it: it landed
        // only in the generated node's nested block, which `ObjectTimeline` never
        // reads for a description (measured on objectui#6152, report 6070437445).
    };
}

/**
 * The `options.calendar` config this page hands to `ListView` — or NOTHING.
 *
 * objectui#7029 (ruled on objectstack#13748, director batch #19, option A).
 * This face used to fabricate `startDateField: 'due_date'` and
 * `titleField: 'name'` for EVERY object view, declared or not. Downstream that
 * is indistinguishable from a real binding, and it is what made the calendar
 * renderer's own refusal screen ("Calendar configuration required…",
 * `ObjectCalendar.tsx`) unreachable from this route: the renderer decides by
 * asking whether a start-date binding is PRESENT, and this face always said
 * yes. Measured on hotcrm's `crm_leave_request` (real fields `start_date` /
 * `end_date`, no `calendar:` block): all nine records piled onto today's cell
 * with titles resolved through the display-name chain — a plausible, fully
 * wrong screen with zero signal to the author.
 *
 * The same fabrication also fed two gates that read this bag:
 * `ListView.availableViews` offered the Calendar toggle for every object view,
 * and `resolveTimelineDateBinding` accepts a calendar binding as a legitimate
 * timeline axis — so the invented name silently answered for the Timeline
 * switcher too.
 *
 * What stays is the view's OWN declared block, forwarded verbatim (spread, not
 * whitelisted, so every spec key survives), and `undefined` when the view
 * declared none. Exactly the shape the sibling faces already converged on:
 * `timelineViewOptions` above (objectui#3129 retired this very literal from the
 * timeline axis), the kanban branch's `detectStatusField` (ADR-0085, "never
 * invents a field the object doesn't have"), and `defaultCalendarFromObject`
 * in `InterfaceListPage` (a binding or `undefined`, never a guess).
 *
 * ⚠️ A view that carried no `calendar:` block and happened to sit on an object
 * with a real `due_date` field was rendering by luck; it now reaches the
 * refusal screen instead. That is the ruled loud-over-silent direction.
 *
 * Exported for the regression suite.
 */
export function calendarViewOptions(viewDef: any): Record<string, unknown> | undefined {
    const declared = viewDef?.calendar;
    if (!declared || typeof declared !== 'object') return undefined;
    // Forward what the author wrote — nothing invented, nothing floored.
    return { ...declared };
}

/**
 * The `options.gantt` config this page hands to `ListView`.
 *
 * `5f4514f7b` — the same class objectui#7029 removed from the calendar branch,
 * reported separately by PR #7062 rather than fixed alongside it. This face used
 * to floor `startDateField` at `'start_date'` and `endDateField` at `'end_date'`
 * for EVERY object view, declared or not — field names no view had written and
 * most objects do not carry. Downstream that is indistinguishable from a real
 * binding, and it is what made `ObjectGantt`'s own refusal screen ("Gantt
 * configuration required. Please specify startDateField, endDateField, and
 * titleField.") unreachable from this route: `getGanttConfig` takes its flat
 * branch as soon as BOTH date props are present, and this face always supplied
 * both. It also answered the ADR-0047 capability gate in `ListView.availableViews`
 * (`schema.options?.gantt?.startDateField`), so the Gantt toggle was live on
 * every object view in the product.
 *
 * ⚠️ MEASURED BEFORE THE DELETION, because #7029's mechanic is only correct
 * where a refusal path exists: `ObjectGantt` REFUSES an absent binding — it does
 * not render empty and does not throw. Pinned as the seam in
 * `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx`.
 *
 * What stays is the view's OWN declared block, spread whole so every spec key
 * the renderer reads survives (parentField/typeField for the summary→step
 * hierarchy, baseline*, groupByField, resourceView/assignee*, tooltipFields,
 * quickFilters, …) — a bare whitelist here once dropped every field past
 * colorField and flattened the chart. `titleField` keeps its `'name'` floor:
 * that is a display-name default, not a date axis, and it is the same rung
 * `timelineViewOptions` above carries.
 *
 * Exported for the regression suite.
 */
export function ganttViewOptions(viewDef: any): Record<string, unknown> {
    return {
        ...(viewDef?.gantt || {}),
        // Only ever restates what the view declared — no date field is floored.
        titleField: viewDef?.gantt?.titleField || 'name',
    };
}

/**
 * The `options.gallery` config this page hands to `ListView`.
 *
 * objectui#7547 — the last surviving member of the objectui#7029 / `5f4514f7b` /
 * #7500 class on this face. It floored `imageField` at `'image'` for EVERY
 * object view, declared or not: a cover binding no view had written, on a field
 * name most objects do not carry.
 *
 * ⚠️ WHAT THAT LITERAL ACTUALLY DID, which is not what it looks like. The
 * screen damage was small — `ObjectGallery` resolves the cover per record and
 * COLLAPSES the cover area when no record yields one, so an invented `'image'`
 * degraded to a gallery of coverless cards. The damage was to the GATE. This
 * bag feeds `ListView.availableViews`, whose gallery check reads
 * `schema.options?.gallery?.imageField`; a value that is always present makes
 * that check answer YES for every object view that whitelists `gallery`, so
 * ADR-0047's whitelist ∩ resolvable — the mechanism that exists to stop a
 * visualization being offered with nothing behind it — was answering about a
 * name this file wrote rather than one the author did. Gallery was offered
 * without a block, and stayed watchable only because the renderer happens to
 * degrade politely. That is a coincidence, not a design, and it is the same
 * second-order effect objectui#7029 measured for `calendar` and `5f4514f7b`
 * for `gantt`.
 *
 * ⚠️ MEASURED BEFORE THE DELETION, the discipline `5f4514f7b` wrote down:
 * #7029's mechanic — delete the literal, let the read site answer — is only
 * correct where the read site's answer is honest. `ObjectGallery` floors its
 * own `coverField` at `'image'` too, and that rung STAYS: it is the component's
 * own decision about an unconfigured record, and it is honest because the cover
 * area collapses when the guess yields nothing. What this face must not do is
 * pre-empt that decision and light the capability gate on the way past.
 *
 * What stays here is the view's OWN declared block, spread whole so every spec
 * key survives (`cardSize` / `visibleFields` / `coverFit` / …), the cover
 * binding under `coverField` BUT ONLY WHEN ONE WAS DECLARED, and the
 * `titleField` `'name'` floor — a display-name default, not a binding, exactly
 * as `ganttViewOptions` above keeps it.
 *
 * objectui#6152 round 12 (seat answer Q1 → A): the legacy `imageField` is no
 * longer written beside `coverField`. `@object-ui/types` judges this bag as the
 * spec's list overlay judges it, and that refuses `options.gallery.imageField`
 * by name. The gate the paragraph above describes learned
 * `options.gallery.coverField` in the same round, so the toggle still lights
 * from what this writes and still stays dark when the view declared no cover.
 *
 * objectui#6152 round 14: the legacy READ is retired too. The cover binding is
 * read from the spec's `coverField` alone, so a stored `gallery.imageField`
 * binds no cover here, offers no Gallery toggle, and leaves `ObjectGallery` on
 * its own `'image'` floor.
 *
 * Exported for the regression suite.
 */
export function galleryViewOptions(viewDef: any): Record<string, unknown> {
    const gallery = viewDef?.gallery;
    // The cover binding goes out under the spec's `coverField` ONLY, read from
    // `coverField` ONLY, and is never invented. objectui#6152 round 12 dropped the
    // legacy `imageField` this used to cross-fill beside it, and round 14 retired
    // the alias rung that still READ it.
    const declaredCover = gallery?.coverField;
    return {
        ...(gallery || {}),
        ...(declaredCover ? { coverField: declaredCover } : {}),
        // Spelled through `viewDef` rather than the `gallery` local above, and
        // that is load-bearing: `ObjectView.titleFieldConvergence.test.tsx`
        // (objectui#6557) pins all six `titleField` / `labelField` seams to ONE
        // expression shape — a chain of VIEW-declared rungs floored at 'name',
        // with `viewDef` as the mechanical proxy for "view-declared". Reading
        // the local here still resolves the same value but blinds that scan to
        // the thing it hunts, so the seam keeps the family spelling.
        titleField: viewDef?.gallery?.titleField || 'name',
    };
}

/**
 * The view-level KANBAN block this face forwards — the fifth member of the
 * `timelineViewOptions` / `calendarViewOptions` / `ganttViewOptions` /
 * `galleryViewOptions` family above, and the last one still inlined as an
 * anonymous IIFE inside the schema literal (objectui#8193).
 *
 * ⭐ THE LANE KEY IS `groupByField`, THE SPEC'S OWN SPELLING. This used to emit
 * the legacy `groupField` alias instead — never the canonical key, even though
 * it already READ the canonical key first. The sibling producer
 * `defaultKanbanFromObject` (`InterfaceListPage.tsx`) had migrated already and
 * left the reasoning next to itself — "that read-site now prefers the spec key,
 * so one key is enough" — but this twin twelve hundred lines away was not
 * carried along, so ONE producer surface spoke two vocabularies for one concept
 * depending on which entry point you arrived through.
 *
 * ⚠️ objectui#8193 changed only what this face WRITES; the alias READS stayed
 * until objectui#6152 round 14 retired them here and in `ListView` alike. The
 * lane is read from `groupByField` alone now, so a stored `kanban.groupField`
 * no longer names it: the lane falls to the object's declared lifecycle, as for
 * a view that names none.
 *
 * ⚠️ WRITING THE CANONICAL KEY HERE REQUIRED THE GATE TO LEARN IT, and that is
 * the half a reader will not guess from this file. `ListView.availableViews`
 * consulted the `options.<kind>` bag for the LEGACY spelling only
 * (`schema.options?.kanban?.groupField`), so emitting `groupByField` alone made
 * the Kanban capability stop resolving and the toggle vanish from every object
 * view — measured, not reasoned: `{groupBy, groupField}` offered Kanban, and
 * `{groupBy, groupByField}` did not. The gate now reads both spellings out of
 * the bag, the same one-question-two-sites repair objectui#5042 made for `map`
 * and objectui#7544 for `chart`. Pinned in `ObjectView.kanbanLane-8193` here
 * and in `ListView.kanbanOptionsBagCanonical-8193` in `plugin-list`.
 *
 * ⭐ `groupBy` IS RETIRED HERE (objectui#8213) — the THIRD spelling of the one
 * concept this expression already writes canonically. Measured against
 * `@objectstack/spec` 17.3.0's strict `KanbanConfigSchema`, which declares
 * `groupByField` / `summarizeField` / `columns` and refuses `groupBy` BY NAME,
 * on a call where one control fires (`zzzBogusKey` is refused by name) and
 * another accepts (`groupByField` alone draws no `unrecognized_keys`). Upstream
 * knows the OTHER alias by name — probing `groupField` answers "Did you mean
 * `groupField` → `groupByField`?" — and knows nothing at all about `groupBy`.
 *
 * ⚠️ THE PRODUCER CENSUS THE CARD MADE A PRECONDITION, run before the deletion.
 * A structural scan of every tracked file for a bare `groupBy` inside a
 * view-level `kanban`/`calendar`/`gallery`/`timeline`/`gantt` object literal
 * found NO runtime producer but this one; the lit control on the same
 * instrument (`groupByField` in the same position) returned 58 sites, so the
 * empty reading is a reading. The only other authors are FIXTURES: the two arms
 * of `ListView.kanbanOptionsBagCanonical-8193` that pin this very bag, and one
 * stale metadata payload in `data-objectstack`'s `updateView.draft.test.ts`.
 * The sibling producer `defaultKanbanFromObject` emits `{ groupByField }` alone
 * and always has.
 *
 * ⚠️ WHY THE ONE READER WAS UNHARMED (as measured then). `ListView`'s two
 * projection/expand collectors listed `v.groupByField, v.groupField, v.groupBy`
 * as candidates for the same lane value, so `groupBy` did contribute a field
 * NAME to the query projection — and this same expression writes that
 * identical value under `groupByField`, which those collectors read first. The
 * capability gate never read `groupBy` at all, and neither did the render
 * branch. Since objectui#6152 round 14 the collectors, the gate and the render
 * branch read `groupByField` alone.
 *
 * ⚠️ WHAT THIS CLOSED AND WHAT IT DID NOT — and what has since closed the rest.
 * `ListView`'s kanban branch destructured
 * `columns`/`groupByField`/`groupField`/`cardFields`/`titleField` out of the
 * merged config and spread the REST *after* its own `groupBy: laneField`, so a
 * surviving `groupBy` overrode the lane it had just resolved. This deletion
 * removed the only producer in this repo that fed that override; the override
 * itself stayed reachable from an author-written `kanban.groupBy` riding this
 * repo's `.passthrough()` mirror, and was carried on its own card.
 * ⭐ THAT CARD HAS LANDED (objectui#8365, maintainer ruling of 2026-09-12 —
 * decision batch #117 item 5, option B): `groupBy` is now stripped in
 * `ListView`'s destructure, so the canonical lane wins, AND the view-level
 * `KanbanConfig` mirror (`@object-ui/types`, `zod/objectql.zod.ts`) declares it
 * as an alias refusal naming `groupByField`, so the key is refused BY NAME at
 * the read door instead of riding the passthrough. ⛔ Do not re-file it.
 *
 * ⭐ THE CARD FIELDS GO OUT AS `columns`, THE SPEC'S SPELLING (objectui#6152
 * round 12, seat answer Q1 → A). This wrote the legacy `cardFields` alias, which
 * objectui#8213 left as a known residual. `@object-ui/types` now judges this bag
 * as the spec's list overlay does and refuses `options.kanban.cardFields` by
 * name, and `ListView`'s kanban branch reads `columns` for the cards when no
 * `cardFields` is present: measured on objectui#6152 (report 6070437445), the
 * generated node and the `$select` are identical under either spelling.
 * `titleField` is a member of the spec's kanban block (measured on 17.7.0). Every key this
 * expression writes is therefore a spec key, and
 * `ObjectView.kanbanGroupByRetired-8213` pins that, so an undeclared key
 * reddens instead of joining them quietly.
 *
 * ADR-0085: when the view doesn't pick a lane field, the object's declared
 * lifecycle (`stageField`) decides — including the strict `stageField: false`
 * suppression (no default lanes; the status-shaped field is declared
 * non-linear) and the shared name/type heuristic, which never invents a field
 * the object doesn't have (the old hard-coded 'status' did).
 *
 * objectui#11629: `summarizeField` (the spec's "Field to sum at top of column")
 * is relayed only when the view declares it. This block is the only kanban
 * config `ListView` receives on this page when the stored row carries no
 * `options.kanban` bag. Without the relay, the key never reached `ListView`'s
 * projection or the board's column headers, so a view that declared it
 * rendered counts with no totals. Like the lane, an absent key stays absent:
 * no default field is invented.
 *
 * Exported for the pin test.
 */
export function kanbanViewOptions(viewDef: any, objectDef: any): Record<string, unknown> {
    const lane =
        viewDef?.kanban?.groupByField ||
        detectStatusField(objectDef as any) ||
        undefined;
    const summarizeField = viewDef?.kanban?.summarizeField;
    return {
        ...(lane ? { groupByField: lane } : {}),
        titleField: viewDef?.kanban?.titleField || 'name',
        // The spec's own spelling of the card fields (objectui#6152 round 12): the
        // bag refuses the legacy `cardFields` this used to write, and `ListView`
        // reads `columns` for the cards, so the board is unchanged.
        columns: viewDef?.kanban?.columns,
        ...(summarizeField ? { summarizeField } : {}),
    };
}

/**
 * objectui#10380 — the stored row's legacy `options` bag, as this page hands it
 * to `ListView`. A row with no bag (or a bag that is not an object) gives `{}`.
 *
 * `@objectstack/spec`'s flattened list overlay declares this bag
 * (`ListViewOverlayOptionsSchema`). The view write door judges each
 * `options.KIND` block key by key with that kind's own block schema, refuses
 * an out-of-contract key by name, and stores what it accepts. The spec
 * describes the bag as an underlay: the top-level `KIND` block "wins per key
 * where both set one". The interface page has always forwarded the bag, so one
 * stored row rendered two ways. Ruling A on objectui#10380 (comment
 * 5824043998) keeps that forward ("what passes the door is legal"), so the
 * object page now forwards the bag too.
 *
 * The relay below does three things with it, and none of them merges keys:
 *   - `options` carries the bag. For each kind the bag carries, the bag's block
 *     REPLACES this page's synthesized block (`kanbanViewOptions` and its
 *     siblings). This is the rule `InterfaceListPage` applies to its `mapCfg`
 *     (`view.options.map ?? derived`). A synthesized block stands in only for a
 *     kind the bag does not carry, so a row with no bag is relayed exactly as
 *     before.
 *   - For each kind the bag carries, the view's own top-level block also goes
 *     out at the top level, where `InterfaceListPage` puts it as well.
 *   - `ListView` then lays the top-level block over the bag per key. That merge
 *     already exists in each render branch (`{ ...options.KIND, ...KIND }`),
 *     and it is the spec's precedence. ⛔ No second merge is written here.
 *
 * Exported for the pin test.
 */
export function storedLegacyOptions(viewDef: unknown): Record<string, any> {
    const bag = viewDef && typeof viewDef === 'object' ? (viewDef as { options?: unknown }).options : undefined;
    return bag && typeof bag === 'object' && !Array.isArray(bag) ? (bag as Record<string, unknown>) : {};
}

/**
 * objectui#10046 — is `a` the same `options` bag as `b`, compared by VALUE?
 * (objectui#7237 holds the resolved `filter` through the same comparison.)
 *
 * `renderListView` rebuilds `fullSchema.options` as a fresh object literal on
 * every call, and `plugin-view`'s `ObjectView` calls it on every one of its
 * renders. `ListView` names `schema.options` BY IDENTITY in its fetch effect's
 * dependency list (objectui#4567 ruled that dependency correct and put
 * stabilisation at the PRODUCER), so each host re-render that changed nothing
 * re-issued the identical `dataSource.find`: one extra at mount (the record
 * count landing), two on opening a record and two on closing it.
 *
 * A copy of `plugin-view`'s `isStructurallyEqual` (`stableIdentity.ts`,
 * objectui#6460), kept module-local because that one is not exported and
 * exporting it would publish a new name. Same safety invariant: every
 * uncertainty (an unmodelled type — function, `Map`, class instance —, a
 * differing key count, a structure deeper than the bound) answers "not
 * equal", which hands `ListView` a new identity and therefore a refetch. It can
 * only ever remove a REDUNDANT query; it can never withhold a needed one.
 * ⛔ Not `JSON.stringify`: that calls `{ a: undefined }` and `{}` equal (a
 * missed refetch) and throws on a cycle.
 */
function isSameOptionsValue(a: unknown, b: unknown, depth = 0): boolean {
    if (Object.is(a, b)) return true;
    if (depth >= 12) return false;
    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => isSameOptionsValue(item, b[i], depth + 1));
    }
    const isPlain = (v: unknown): v is Record<string, unknown> => {
        if (v === null || typeof v !== 'object') return false;
        const proto = Object.getPrototypeOf(v);
        return proto === Object.prototype || proto === null;
    };
    if (isPlain(a) && isPlain(b)) {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isSameOptionsValue(a[k], b[k], depth + 1));
    }
    return false;
}

/**
 * THE record-detail URL this list surface builds — one route shape, one place.
 *
 * Derived from the LIST's own pathname rather than re-assembled from route
 * params, because that is what the "open in new window" navigation action has
 * always used here: strip a trailing `/view/:viewId` and append
 * `/record/:recordId`. It therefore works wherever this page is mounted, and —
 * more to the point — every affordance that opens a record in a new tab from
 * this page addresses the SAME URL by construction.
 *
 * Since objectui#4490 it also backs the href the list's link column publishes
 * through {@link RelatedRecordActionsValue.recordHref}, so the anchor a user
 * middle-clicks and the tab the row's ⌘-click opens cannot drift apart.
 *
 * Exported for the pin test.
 */
export function listRecordDetailUrl(pathname: string, recordId: string | number): string {
    const basePath = pathname.replace(/\/view\/.*$/, '');
    return `${basePath}/record/${encodeURIComponent(String(recordId))}`;
}

/** No related-list handlers — see {@link listRecordActionsValue}. */
const NO_RELATED_HANDLERS: RelatedRecordHandlers = Object.freeze({});

/**
 * What the object LIST page publishes on `RelatedRecordActionsContext`
 * (objectui#4490).
 *
 * `RelatedRecordActionsProvider` was mounted only on the record DETAIL body
 * (by `RelatedRecordActionsBridge`), which is why PR #4489's real anchors
 * reached lookup values there and the list page's own `link: true` column was
 * left with a click-only `span role="link"`. The list host publishes the same
 * pair here, so `LinkCell` can render a real anchor without knowing anything
 * about routes — one mechanism, all three surfaces.
 *
 * One deliberate limit:
 *
 *  - **`resolve` returns no handlers.** This surface has no related lists — a
 *    list page's rows are not a child collection — so there is nothing to
 *    resolve. An empty handler set is exactly what the context documents as
 *    "capability unavailable", i.e. the same read-only outcome a consumer gets
 *    with no provider at all, so nothing that renders under this page gains an
 *    affordance it did not have.
 *
 * **Any routable object, through the record page's builder (objectui#12673).**
 * A lookup cell or a record-pointer (`referenceVia`) cell names a record of
 * ANOTHER object, and the list used to answer `null` for it, so the name was
 * readable and could not be opened. With `routes` the list now answers those
 * the way the record page's `RelatedRecordActionsBridge` does, through the
 * same builder (`appRecordPath` over `routableObjectNames`, both exported by
 * the bridge): `/apps/:app/:object/record/:id`, published as a document href
 * (`documentHref`) so a new tab or a copied link carries the router's
 * basename, and navigated by its router path on a plain click. A list page
 * has no parent record, so no `?from=` trail entry is added. An object this
 * console cannot route to still answers `null`, which consumers render as the
 * plain value, so no link points at a page that would refuse.
 *
 * The listed object itself keeps its own route: {@link listRecordDetailUrl}
 * derived from the current pathname, opened through the page's own record
 * navigation (which carries the list as the record's origin). Without
 * `routes`, only that object is addressable, as before.
 *
 * `pathname` is read at CALL time (not captured) so a view switch or a drill-in
 * cannot leave a stale base behind — the same freshness rule the bridge's
 * builder documents for its `?from=` trail.
 *
 * Exported for the pin test.
 */
export function listRecordActionsValue(
    objectName: string,
    openRecordPage: (recordId: string | number) => void,
    getPathname: () => string = () => window.location.pathname,
    routes?: ListRecordRoutes,
): RelatedRecordActionsValue {
    const hasId = (recordId: string | number) => recordId != null && recordId !== '';
    const routable = routes ? routableObjectNames(routes.objects) : null;
    /** The router path of another object's record, or `null` when unroutable. */
    const otherRecordPath = (targetObjectName: string, recordId: string | number): string | null =>
        routes && routable && targetObjectName !== objectName && hasId(recordId)
            ? appRecordPath(routes.appName, routable, targetObjectName, recordId)
            : null;
    return {
        resolve: () => NO_RELATED_HANDLERS,
        recordHref: (targetObjectName, recordId) => {
            if (targetObjectName === objectName) {
                return hasId(recordId) ? listRecordDetailUrl(getPathname(), recordId) : null;
            }
            const path = otherRecordPath(targetObjectName, recordId);
            return routes && path !== null ? documentHref(routes.routerRootHref, path) : null;
        },
        openRecord: (targetObjectName, recordId) => {
            if (targetObjectName === objectName) {
                if (hasId(recordId)) openRecordPage(recordId);
                return;
            }
            const path = otherRecordPath(targetObjectName, recordId);
            if (path !== null) routes?.navigate(path);
        },
    };
}

/**
 * What {@link listRecordActionsValue} needs to address records of objects other
 * than the listed one: the inputs the record page's bridge reads (objectui#12673).
 */
export interface ListRecordRoutes {
    /** The current app segment (`/apps/:appName/...`); no app, no route. */
    appName: string | undefined;
    /** The console's object definitions; their names are the routable set. */
    objects: ReadonlyArray<unknown>;
    /** SPA navigation by router path (the router applies its basename). */
    navigate: (to: string) => void;
    /** `useHref('/')`: the router's root href, basename included. */
    routerRootHref: string;
}

export function defaultListColumnsFromObject(
    objectDef: any,
    limit = 5,
    opts?: { orgAttribution?: boolean },
): string[] {
    const withOrgAttribution = (cols: string[]): string[] =>
        opts?.orgAttribution && objectDef?.fields?.organization_id && !cols.includes('organization_id')
            ? [...cols, 'organization_id']
            : cols;
    const curated = objectDef?.highlightFields;
    if (Array.isArray(curated) && curated.length > 0) {
        return withOrgAttribution(
            leadWithNameField(objectDef, curated.filter((n: string) => objectDef?.fields?.[n])),
        );
    }
    const fields = objectDef?.fields;
    if (fields && typeof fields === 'object') {
        return withOrgAttribution(
            // Lead BEFORE the slice: slicing first could drop the very column
            // the lead exists to guarantee, on an object that declares its name
            // field after `limit` others.
            leadWithNameField(
                objectDef,
                Object.entries(fields)
                    .filter(([name, f]: [string, any]) => f && !f.hidden && !isSystemManagedField(name, f))
                    .map(([name]) => name),
            ).slice(0, limit),
        );
    }
    return [];
}

/**
 * The action names a list view wires to its selection bar, as `ObjectGrid`
 * folds them from the two keys this page relays to it (`resolveBulkActions` in
 * `@object-ui/plugin-grid`), sorted and JSON-encoded so a memo keys on a
 * primitive (objectui#12462).
 *
 * - `bulkActions`: every non-empty name except `delete` (any case). The grid
 *   sends `delete` to its built-in bulk delete, never to an object action of
 *   that name, so the bar does not carry such an action.
 * - `bulkActionDefs`: the `name` of every entry the grid can render, which is
 *   an object with a non-empty string `name` (`isUsableBulkActionDef`).
 *
 * The legacy `batchActions` spelling is not read: this page never relays it.
 */
function bulkWiredActionNamesKey(view: unknown): string {
    const { bulkActions, bulkActionDefs } = (view ?? {}) as { bulkActions?: unknown; bulkActionDefs?: unknown };
    const names = new Set<string>();
    if (Array.isArray(bulkActions)) {
        for (const name of bulkActions) {
            if (typeof name === 'string' && name !== '' && name.toLowerCase() !== 'delete') names.add(name);
        }
    }
    if (Array.isArray(bulkActionDefs)) {
        for (const def of bulkActionDefs) {
            const name = def && typeof def === 'object' ? (def as { name?: unknown }).name : undefined;
            if (typeof name === 'string' && name !== '') names.add(name);
        }
    }
    return JSON.stringify([...names].sort());
}

/**
 * Assemble the list-view `spec` the add-view door (`handleViewCreate`: the
 * Create View dialog from the view tab bar, and the view-config panel's create
 * mode) hands to `viewEnvelope`.
 *
 * This door resolves only its own fallback columns: the object's default
 * business columns (`defaultListColumnsFromObject` keeps the framework-injected
 * `owner_id` / audit columns out of the lead, #2702 / #2777, so a new view
 * never opens on a raw id). The spec itself, with every type-specific rule
 * (the columns mirrored into `kanban.columns` and `gallery.visibleFields`), is
 * built by `buildNewViewSpec`, the one builder this door shares with "Save as
 * view" (objectui#11581).
 *
 * Exported for `CreateViewDialog.viewTypeParse-11581.test.tsx`. @internal
 */
export function buildAddViewSpec(config: Record<string, any>, objectDef: any): Record<string, any> {
    return buildNewViewSpec(config, { fallbackColumns: defaultListColumnsFromObject(objectDef, 5) });
}

/**
 * Read the persisted per-view overrides (density, column widths, sort, hidden
 * columns, inlineEdit …) for `ids`, preferring the adapter's one-request batch
 * enumeration and falling back to a per-view `getView`.
 *
 * Extracted from the effect below so the three-way branch is pinnable on its
 * own (objectui#3774) — the file's existing precedent for this is
 * {@link defaultListColumnsFromObject}.
 *
 * The batch/fallback choice hangs entirely on how `listViewOverrides` ANSWERS,
 * so the two are spelled out:
 *
 * - RESOLVES (including to an empty map) → authoritative. The adapter looked
 *   and reports what exists; an object whose views were never customized
 *   legitimately has no overrides, and we take that answer and skip N GETs.
 *   That is the whole point of the batch call — do not "helpfully" re-probe
 *   per view on an empty map, that reinstates the 404 flurry it removes.
 * - REJECTS → the adapter could not tell, which is NOT the same fact as
 *   "nothing is there". Fall through to the per-view reads.
 *
 * An adapter that swallows its own failures into `{}` collapses those two into
 * the authoritative branch and makes the fallback below unreachable code —
 * that was objectui#3774's second half, fixed in `@object-ui/data-objectstack`.
 */
/**
 * Strip conditions an overlay must never impose, and drop the `filter` key
 * entirely when nothing effective is left (objectui#4155).
 *
 * A view override is merged over the source-declared view as `{ ...source,
 * ...override }`, so its `filter` key REPLACES the view's declared filter
 * wholesale. That made two overlay bodies destructive:
 *
 *   `filter: [{ field: 'x', operator: 'equals', value: '' }]`
 *        — an incomplete filter-panel row. The live query never applied it
 *          (`convertFilterGroupToAST` skips empty values), but as a stored
 *          overlay it became the view's ENTIRE filter and returned `total: 0`:
 *          the "empty list that used to have rows" this issue reports.
 *   `filter: []`
 *        — what "Clear all" wrote. Not a poisoned filter, but still an override
 *          that silently deletes the source declaration (an archived-records
 *          exclusion, say) for everyone.
 *
 * Both are neutralized HERE, on the read path, so an install already carrying a
 * poisoned row self-heals on the next load rather than needing a `sys_metadata`
 * delete plus a service restart. The write that created them is gone too (the
 * filter panel no longer persists anything) — this is the recovery half.
 *
 * Consequence, deliberate and worth naming: an overlay can no longer express
 * "this view has NO filter" over a source view that declares one. That is the
 * strictly safer side of the trade — the shape that expressed it is the same
 * shape that silently erased source declarations, and an author who genuinely
 * wants no filter edits the view (an explicit save), which writes the view body
 * rather than an overlay.
 *
 * Filter entries are matched in both at-rest shapes: spec `ViewFilterRule`
 * objects (`{ field, operator, value }`, what the fold writes) and the legacy
 * runtime triple `[field, operator, value]` a source view may declare and which
 * the console's toolbar write (`persistViewPatch`) USED TO copy into the
 * overlay along with the rest of the view, until objectui#5233 narrowed it to
 * the patch. That write is retired (objectui#12504), so a triple can only reach
 * this pass from a row written before objectui#5233, or from a saved view's own
 * body.
 *
 * Whether a matched entry's VALUE counts as supplied is asked of the builder's
 * own {@link isFilterValueComplete}, not of a local predicate (objectstack#8815,
 * objectui#5025). This pass used to spell the question out here:
 *
 * ```ts
 * value == null || value === '' || (Array.isArray(value) && value.length === 0)
 * ```
 *
 * — right for `scalar` and `list`, blind to `pair`. A `between` carrying one
 * bound is `['2024-01-01', '']`, an array of length 2, so the recovery pass read
 * it as a real condition and handed it back. That is the one shape this pass
 * most needs to strip: `ViewFilterRuleSchema` ACCEPTS a half-filled range
 * (measured on `@objectstack/spec` 17.1.0 — it counts the two slots, not what is
 * in them), so authoring validation is green on it and it only dies at query
 * time, where the server refuses the WHOLE view (`400 INVALID_FILTER`) for every
 * user on every later read. The builder's two write paths were converted to the
 * arity-aware reading; this is the read-path half, and it was the third verbatim
 * copy of a predicate that had already been indicted twice.
 *
 * The split of duties is the helper's own: it answers the VALUE question only,
 * while which operators want no value at all stays with
 * {@link VALUELESS_FILTER_OPERATORS} above.
 *
 * That membership is asked of the row's spelling FOLDED through the spec's own
 * `normalizeFilterOperator` (objectui#9306), never of the raw spelling — the
 * same both-sides fold objectui#9302 / #9359 put on the builder's gate and the
 * live grid, and that {@link isFilterValueComplete} already applies to the
 * arity question. The set's members are protocol ids (plus `exists` /
 * `notExists`), on which the fold is the identity, so folding the row is
 * folding both sides. It became load-bearing when the builder's ids became the
 * protocol's: a row stored under the deprecated camelCase id —
 * `{ operator: 'isEmpty', value: '' }` — no longer matches the set raw, and a
 * raw lookup would hand it to the value test, which reads `''` as unfilled and
 * DROPS it, so the stored filter would lose a condition on read.
 */
export function sanitizeViewOverride(override: any): any {
    if (!override || typeof override !== 'object') return override;
    // objectui#5233 — a PERSONALIZATION overlay contributes only the keys it
    // owns (density / sort / hiddenFields / columnState / inlineEdit). Every
    // other key on such a row is a copy of the source view taken when the
    // user last dragged a column, and the merge below hands it authority over
    // the source declaration it was copied from. Narrowed FIRST and returned:
    // a narrowed row can no longer carry a `filter` at all, so the
    // recovery pass below has nothing left to do for it. The predicate is the
    // adapter's (`@object-ui/data-objectstack` owns the row's shape and stamps
    // its marker) so a saved view's OWN body — enumerated by the same batch
    // read — is returned untouched, exactly as `listViews()` classifies it.
    const narrowed = narrowPersonalizationOverlay(override);
    if (narrowed !== override) return narrowed;
    if (!Array.isArray(override.filter)) return override;

    // Folded before the lookup — see the docblock (objectui#9306).
    const isValueless = (operator: unknown): boolean =>
        VALUELESS_FILTER_OPERATORS.has(normalizeFilterOperator(String(operator)));
    const kept = override.filter.filter((entry: any) => {
        if (Array.isArray(entry)) {
            // Legacy runtime triple: [field, operator, value]
            if (entry.length < 2) return false;
            const [, operator, value] = entry;
            if (isValueless(operator)) return true;
            return isFilterValueComplete(String(operator), value);
        }
        if (!entry || typeof entry !== 'object') return false;
        if (typeof entry.field !== 'string' || entry.field === '') return false;
        if (isValueless(entry.operator)) return true;
        const value = entry.value;
        return isFilterValueComplete(String(entry.operator), value);
    });

    // The empty-array case is checked FIRST: `filter: []` (Clear all's write)
    // leaves `kept.length === override.filter.length`, so an "unchanged"
    // shortcut ahead of this would hand the destructive empty override straight
    // back.
    if (kept.length === 0) {
        // Nothing effective survives → the overlay carries no opinion about the
        // filter, so the SOURCE-declared filter must win again. Dropping the key
        // (rather than writing `[]`) is what makes the `{ ...source, ...override }`
        // merge fall through to it.
        const { filter: _dropped, ...rest } = override;
        return rest;
    }
    if (kept.length === override.filter.length) return override;
    return { ...override, filter: kept };
}

export async function loadViewOverrides(
    dataSource: any,
    objectName: string,
    ids: string[],
): Promise<Record<string, any>> {
    if (typeof dataSource?.listViewOverrides === 'function') {
        try {
            const all = await dataSource.listViewOverrides(objectName);
            if (all && typeof all === 'object') {
                const map: Record<string, any> = {};
                for (const id of ids) {
                    if (all[id]) map[id] = sanitizeViewOverride(all[id]);
                }
                return map;
            }
        } catch {
            // fall through to per-view fetch
        }
    }
    if (typeof dataSource?.getView !== 'function') return {};
    const entries = await Promise.all(
        ids.map(async (id) => {
            try {
                const v = await dataSource.getView(objectName, id);
                return [id, v] as const;
            } catch {
                return [id, null] as const;
            }
        })
    );
    const map: Record<string, any> = {};
    for (const [id, v] of entries) {
        if (v && typeof v === 'object') map[id] = sanitizeViewOverride(v);
    }
    return map;
}

/**
 * Build the switcher's tab list — the ONE place a tab's identity is decided
 * (objectui#4211).
 *
 * Views reach this function from two independent reads of the same
 * `type='view'` metadata namespace:
 *
 *   - `definedViews` — `objectDef.listViews`, keyed by the composer's runtime
 *     identity (`MetadataProvider.applyViewItem`, `<object>.<key>`);
 *   - `savedViews` — the adapter's `listViews()` overlay rows, keyed by
 *     {@link viewRowId}.
 *
 * The two must produce the SAME string for the same view, because everything
 * downstream that decides whether a view is mutable — the tab's `readonly`
 * flag, `isSavedView`, and the early return in every mutating handler — asks
 * whether the tab's id is among the overlay keys. When they disagreed, a saved
 * view was presented as a system view: its set-default / rename / delete menu
 * entries were not rendered at all, so the click the QA run reported produced
 * no adapter write because there was nothing left to click.
 *
 * They disagreed because the metadata side spelled identity `{ id: key,
 * ...body, ...override }` — `id` FIRST, so an `id` key inside the stored body
 * or the stored override silently replaced it. Both are stored documents that
 * really do carry one: the console's toolbar write (`persistViewPatch` →
 * `updateViewConfig`, both retired in objectui#12504) WROTE the whole tab
 * object, its `id` included — objectui#5233 narrowed an overlay to the patch,
 * but a saved view's own row kept the whole body, and every row written before
 * that still carries an `id` — and a duplicated view copies its
 * source artifact's `id` verbatim. `viewEntry` stamps identity LAST at all
 * three sites, so the tab id is now a property of the key the caller looked the
 * view up by, and can never be a property of the data.
 *
 * Extracted from the `views` memo so the seam is assertable without mounting
 * the view; the memo still owns the concerns that need render context (default
 * columns, labels, the per-user sort).
 *
 * @param fallbackTab - the auto-generated "all records" tab, built lazily
 *   because it needs the translated label and the object's default columns.
 *   Used only when the object declares no views at all.
 */
export function buildViewTabs({
    definedViews,
    primary,
    primaryId,
    savedViews,
    viewOverrides,
    fallbackTab,
}: {
    definedViews: Record<string, any>;
    primary?: any;
    primaryId?: string;
    savedViews: readonly any[];
    viewOverrides: Record<string, any>;
    fallbackTab: () => Record<string, any> & { id: string };
}): Array<Record<string, any> & { id: string }> {
    const viewList = Object.entries(definedViews || {}).map(([key, value]: [string, any]) => {
        const override = viewOverrides[key];
        // Override wins per-key — saved overrides represent org-wide shared
        // view settings (density, column widths, etc. — objectstack#7494's
        // ruling: this store has no per-user scope, so "personal" is not an
        // accurate description of what it persists) that should shadow the
        // embedded definition — but NOT over the tab's identity.
        return viewEntry(key, value, override, {
            type: (override?.type) || value?.type || 'grid',
        });
    });

    // Honor `objectDef.list` (the primary list view, per @objectstack/spec
    // ViewSchema). MetadataProvider mirrors it into `listViews` so it's
    // already in `viewList` above; promote it to the front and mark it as
    // the default so `defaultViewId` picks it over secondary listViews.
    //
    // Its id is the composer's runtime identity (objectui#3770), which is
    // what the tab label / description / emptyState are translated under:
    // `viewLabel` reads `objects.<object>._views.<bare key>.label`, and for a
    // default list declared without a `name` that bare key is `default`.
    if (primaryId) {
        const idx = viewList.findIndex(v => v.id === primaryId);
        if (idx >= 0) {
            const [entry] = viewList.splice(idx, 1);
            viewList.unshift(viewEntry(primaryId, entry, { isDefault: true }));
        } else {
            const override = viewOverrides[primaryId];
            viewList.unshift(viewEntry(primaryId, primary, override, {
                type: (override?.type) || primary?.type || 'grid',
                isDefault: true,
            }));
        }
    }

    if (viewList.length === 0) viewList.push(fallbackTab());

    // Merge user-defined views (overlay rows) after metadata-defined views.
    // Dedup by id so a saved view that shadows a metadata view wins.
    const metaIds = new Set(viewList.map(v => v.id));
    for (const sv of savedViews) {
        const id = viewRowId(sv);
        if (!id) continue;
        // Drop undefined fields so a partial overlay (e.g. baseline row
        // with no user customization) does not stomp `isDefault`/`columns`
        // populated from the metadata view it shadows.
        const rawNormalized: Record<string, any> = {
            label: sv.label || sv.name || id,
            type: sv.type || 'grid',
            columns: sv.columns,
            filter: sv.filter,
            sort: sv.sort,
            // objectui#11013 — no `showSearch` / `showFilters` / `showSort`
            // picks: the toolbar policy's declared spelling is `userActions`,
            // which the row carries (and the spread below keeps) like any key.
            isPinned: sv.isPinned,
            isDefault: sv.isDefault,
            visibility: sv.visibility,
            sortOrder: sv.sortOrder,
            ...sv,
            id,
        };
        const normalized: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawNormalized)) {
            if (v !== undefined) normalized[k] = v;
        }
        if (metaIds.has(id)) {
            const idx = viewList.findIndex(v => v.id === id);
            viewList[idx] = viewEntry(id, viewList[idx], normalized);
        } else {
            viewList.push(viewEntry(id, normalized));
        }
    }
    return viewList;
}

/**
 * The `updateView` writes a "set this view as default" must issue
 * (objectui#4211).
 *
 * Extracted from `handleSetDefaultView` so the write set is assertable without
 * mounting the whole view: the QA symptom this issue records is *zero* adapter
 * writes, and a claim about how many writes a click produces has to be measured
 * against the code that produces them, not a replica of it.
 *
 * The list is never empty — clearing `isDefault` elsewhere is conditional, but
 * setting it here is not. So a set-default that reaches this function always
 * writes; the only way to observe no write at all is to be refused before it,
 * by the `isSavedViewId` guard in the handler (and, upstream of that, by the
 * menu entry the same predicate hides).
 */
export function setDefaultViewPatches(
    savedViews: readonly any[],
    vid: string,
): Array<{ viewId: string; patch: { isDefault: boolean } }> {
    const patches = savedViews
        .filter((sv: any) => viewRowId(sv) !== vid && sv.isDefault)
        .map((sv: any) => ({ viewId: viewRowId(sv) as string, patch: { isDefault: false } }));
    patches.push({ viewId: vid, patch: { isDefault: true } });
    return patches;
}

/**
 * Issue one `updateView` per patch — **as a method call on the adapter**
 * (objectui#4463).
 *
 * This exists to make one specific bug unwritable. `handleSetDefaultView` and
 * `handleReorderViews` both used to detach the method before calling it (the
 * reorder no longer writes a view at all since objectui#12418 — it is the
 * user's preference):
 *
 * ```ts
 * const updateView = (dataSource as any).updateView;   // detached
 * …
 * updateView(objectName, target, patch);               // `this` === undefined
 * ```
 *
 * The adapter's `updateView` opens with `await this.connect()`, so every write
 * in the list rejected with `TypeError: Cannot read properties of undefined
 * (reading 'connect')` **before any request was issued** — the user got a toast
 * and the server never heard about it. "Set as Default" was dead on every saved
 * view for exactly this reason, while rename and pin worked from the same menu:
 * `handlePinView` always called it as a method, which is the in-file convention
 * this restores.
 *
 * The call site routes through here, so there is a single place in the file
 * that calls `updateView` over a patch list — and it has no local to detach into.
 */
export function dispatchViewPatches(
    dataSource: any,
    objectName: string,
    patches: ReadonlyArray<{ viewId: string; patch: Record<string, any> }>,
): Array<Promise<unknown>> {
    return patches.map(
        ({ viewId, patch }) => dataSource.updateView(objectName, viewId, patch),
    );
}

/**
 * Item-level keys a switcher tab carries that belong to the ROW, not to the
 * view body — the ones this surface's own handlers write through `updateView`
 * (`isDefault`, `isPinned`, `sortOrder`; the adapter merges them at the row's
 * top level), the tab's `visibility`, and `columnState`, the runtime-only key
 * the spec declares on the ViewItem wire face rather than on the list-view
 * body (objectstack `d5552ca13`). A view-config save is a whole-document PUT, so
 * these are carried forward at the envelope's top level; dropping them would
 * erase the default flag, the pin and the column widths the row held.
 *
 * objectui#11013 — read off the spec, not retyped: the keys of
 * `VIEW_CONSOLE_ROUND_TRIP_KEYS` (objectstack#20456) declared on the `viewItem`
 * member, which is the member this save's envelope is judged by. `_isOverride`
 * is declared on the list overlay only, so it is not carried here. The same
 * derivation is `@object-ui/data-objectstack`'s, where `listViews()` carries
 * these keys back off the stored record.
 */
const VIEW_ROW_STATE_KEYS: readonly string[] = (
    Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS) as Array<keyof typeof VIEW_CONSOLE_ROUND_TRIP_KEYS>
).filter((key) => (VIEW_CONSOLE_ROUND_TRIP_KEYS[key] as readonly string[]).includes('viewItem'));

/**
 * The keys a list view's `config` may carry — read off the spec's own closed
 * `ListViewSchema`, never hand-listed, so the set moves with the spec.
 * Computed on first use: the schema is a lazy proxy and nothing else on this
 * module's load path needs it materialised.
 */
let listViewConfigKeys: ReadonlySet<string> | undefined;
function getListViewConfigKeys(): ReadonlySet<string> {
    listViewConfigKeys ??= new Set(Object.keys(SpecListViewSchema.shape));
    return listViewConfigKeys;
}

/**
 * The body "Edit view config → Save" persists: a canonical ViewItem envelope
 * `{ name, object, viewKind: 'list', label, config }` (objectui#10210).
 *
 * The panel hands its host the FLAT runtime tab, and this save used to persist
 * it as-is. On a code-defined view the server then inherits `viewKind: 'list'`
 * from the registry entry the row shadows (`viewIdentityPatch`), and a flat
 * row carrying `viewKind` is exactly the shape the adapter's legacy-overlay
 * net reads as a personalization overlay — so `listViews()` dropped the row,
 * the tab lost its saved-view status and was stamped read-only, and publishing
 * made that permanent. The create path never had the defect because it writes
 * through {@link viewEnvelope}; this is the same envelope, for an existing view.
 *
 * Three rules, each measured against the platform's write door:
 *
 * - **Identity is the row key.** `name` is the tab id the save is addressed
 *   to, verbatim, so the write lands on the row it always landed on and never
 *   forks a second view. `viewEnvelope` re-qualifies a name it is given; for a
 *   `<object>.<key>` id that is the same string, and pinning it here keeps that
 *   true for any id.
 * - **`config` carries only list-view keys.** The spec's list-view shape is
 *   closed: an envelope whose `config` carried the tab's own `id` / `isDefault`
 *   was refused outright (`422 INVALID_METADATA`, "Unrecognized key(s) on this
 *   list view"). The tab also carries identity (`name`, `object`, `viewKind`),
 *   read decorations (`_draft`, `_diagnostics`), registry bookkeeping and, when
 *   a toolbar overlay was merged into it, the overlay marker — none of which is
 *   view body. So `config` is the draft narrowed to the keys `ListViewSchema`
 *   declares, with the object binding stamped by `viewEnvelope`.
 * - **Row state is carried forward** at the top level — see
 *   {@link VIEW_ROW_STATE_KEYS}.
 *
 * Extracted so the persisted shape is assertable without mounting the view,
 * like {@link buildViewTabs} above.
 */
export function buildViewConfigSaveBody(
    objectName: string | undefined,
    draft: Record<string, unknown>,
): ViewEnvelope & Record<string, unknown> {
    const vid = String(draft?.id ?? '');
    const configKeys = getListViewConfigKeys();
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draft ?? {})) {
        if (value !== undefined && configKeys.has(key)) body[key] = value;
    }
    const rowState: Record<string, unknown> = {};
    for (const key of VIEW_ROW_STATE_KEYS) {
        if (draft?.[key] !== undefined) rowState[key] = draft[key];
    }
    const label = typeof draft?.label === 'string' ? draft.label : undefined;
    const env = viewEnvelope(objectName, body, { name: vid, label });
    return { ...env, ...rowState, name: vid };
}

/**
 * The `filter[...]` params of a URL, selected out of the full search params as
 * their own `URLSearchParams`. Extracted for the same reason `buildViewTabs`
 * above is: so the shape is assertable without mounting the view.
 *
 * Built by APPENDING onto a `URLSearchParams` rather than joining `key=value`
 * pairs into a string by hand (objectui#9287). `searchParams.entries()` yields
 * DECODED values, so a hand-joined key re-introduced, unescaped, the two
 * characters that are structural in a query string: `&` TRUNCATED the value at
 * its first occurrence (`Smith & Sons` reached the reader as `Smith `, plus a
 * stray empty-valued param) and `+` came back as a space (`A+B` as `A B`).
 * Neither produces an absent condition — the list renders, scoped by a silently
 * WRONG value, and nothing anywhere says the value was cut.
 *
 * `toString()` percent-encodes, so the serialized form still round-trips and
 * still ignores the unrelated `uf_*` params the memo key exists to absorb.
 */
export function selectFilterParams(searchParams: URLSearchParams): URLSearchParams {
    const filterParams = new URLSearchParams();
    searchParams.forEach((value, key) => {
        if (key.startsWith('filter[')) filterParams.append(key, value);
    });
    return filterParams;
}

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

/**
 * The "object not found" state the route draws for an object it has no
 * definition of. objectui#13052 — `packageDisabled`: the server answered that
 * the object exists and its package is disabled (`OBJECT_PACKAGE_DISABLED`),
 * so the description says that instead. The console route draws it for that
 * answer (`AppContent`); this module's `ObjectView` draws it for an absence.
 * Not part of the package entry.
 */
export function ObjectNotFoundState({ objectName, packageDisabled = false }: { objectName: string | undefined; packageDisabled?: boolean }) {
    const { t } = useObjectTranslation();
    return (
        <div className="h-full p-4 flex items-center justify-center">
          <Empty data-testid={packageDisabled ? 'object-package-disabled' : 'object-not-found'}>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <TableIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t('console.objectView.objectNotFound')}</EmptyTitle>
            <EmptyDescription>
              {packageDisabled
                ? t('console.objectView.objectPackageDisabled', { objectName })
                : t('console.objectView.objectNotFoundDescription', { objectName })}
              {' '}
              {t('console.objectView.objectNotFoundHint')}
            </EmptyDescription>
          </Empty>
        </div>
    );
}

/**
 * The list toolbar's inline-edit toggle, as this page wires it: it writes
 * nothing (objectui#5144, triage's ruling E).
 *
 * The view's `inlineEdit` and `userActions.editInline` are the AUTHOR's
 * permission keys, and `normalizeListViewSchema` folds the first into the
 * second. `editInline` is on by default since the v18 ruling (objectstack#22605,
 * objectui#12086), so a view that declares neither key offers the toggle, and
 * `editInline: false` withdraws it. This toggle used to persist a USER's edit
 * mode into `inlineEdit` through `persistViewPatch`. After the fold, switching
 * it off stored `inlineEdit: false`, which reads as "not offered", so the
 * toggle was gone from the next load and nothing in the console could bring it
 * back.
 *
 * The edit mode is now session state. `ListView` keeps it, and seeds it from
 * the view's `inlineEdit` on each load. The callback stays wired because
 * `ListView` offers the wide toolbar toggle only to a host that wires one.
 *
 * Recorded costs: the edit mode is not remembered across loads, and an overlay
 * that already stores `inlineEdit: false` still reads off. That is existing
 * data, and the maintainer's ruling rejects migrating it. Declaring
 * `userActions.editInline: true` on such a view brings the toggle back.
 */
/**
 * Tailwind's `sm` breakpoint (px): from here up the list page draws its
 * saved-view tabs in the list toolbar; below it the app bar's mobile view
 * switcher is the page's only view control (objectui#12440).
 */
const VIEW_TABS_MIN_WIDTH = 640;

/**
 * Is the viewport at least {@link VIEW_TABS_MIN_WIDTH} wide? The matchMedia
 * idiom of `useIsMobile` / `useIsWideViewport`, except the first answer is
 * read synchronously: the tab strip is the first thing on the page's list row,
 * and resolving it in an effect would draw the row once without it and then
 * jump. objectui#12440 — this decides whether the strip is HANDED to the list
 * at all, so below `sm` nothing is passed and nothing is drawn (the CSS
 * `hidden sm:block` it replaces only hid it).
 */
function viewTabsFitNow(): boolean {
    return typeof window !== 'undefined' && window.innerWidth >= VIEW_TABS_MIN_WIDTH;
}

function useViewTabsFit(): boolean {
    const [fits, setFits] = useState<boolean>(viewTabsFitNow);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(`(min-width: ${VIEW_TABS_MIN_WIDTH}px)`);
        const onChange = () => setFits(viewTabsFitNow());
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return fits;
}

function keepInlineEditModeForTheSession(): void {
    // Deliberately empty: see the docblock.
}

/**
 * objectui#13134 — the room the list leaves at its end for the phone create
 * button (`mobile-fab-create`), so the last card can be scrolled clear of it.
 *
 * The button is `fixed`, `bottom-36` (9rem) and `h-12` (3rem): its top edge
 * stands 12rem above the bottom of the screen, so 12rem (`pb-48`) at the end
 * of a scroller that ends at or above the screen's bottom lifts the last card
 * above it. `max-sm:` is the button's own `sm:hidden`, read the other way: the
 * room exists exactly where the button is drawn.
 *
 * It lands on the scroller that marks itself `data-fab-clearance` (the card
 * list `ObjectGrid` draws at phone width): the list's own scroll box, which
 * is the only box there that scrolls. Padding a box above it would add no
 * scroll room, since every box between this page and the cards clips.
 * `ObjectView.mobileFabListClearance-13134.test.tsx` derives the 12rem from
 * the button's classes, so moving the button without this fails there.
 */
const MOBILE_FAB_LIST_CLEARANCE = 'max-sm:[&_[data-fab-clearance]]:pb-48';

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
    const { t } = useObjectTranslation();
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

    // Environment list (sys_environment) is entitlement- + state-aware: born
    // with one production env per org, its single `create_environment` action
    // means different things — "Set up your production environment", "Add
    // development environment", or a locked plan-tier mark linking to the
    // upgrade page (objectui#12190) — depending on org state.
    // Resolved org-side here; the hook is a no-op for every other object.
    const isEnvironmentList = objectDef.name === 'sys_environment';
    const environmentEntitlements = useEnvironmentEntitlements({
        enabled: isEnvironmentList,
        dataSource,
        authFetch: actionRuntime.authFetch,
        apiBase: (import.meta as any).env?.VITE_SERVER_URL || '',
        refreshKey,
    });
    // objectui#12109 — this object's list actions are drawn only for a caller
    // who may read the object. Every one of them is bound to it (an action's
    // `objectName` is what merges it into `objectDef.actions`), and a caller
    // without read gets the list's "You don't have access" under them, so a
    // drawn action could only end there. The verdict is the one the sidebar
    // prunes this object's navigation entry on (`mayReadObject`), so the entry
    // and its list actions go together. A boolean, read each render from the
    // provider's verdict, so the memo below keys on a primitive (AGENTS.md #10).
    const listActionsReadable = mayReadObject(perms.can, objectDef.name);
    const listActions = listActionsReadable ? objectDef.actions : undefined;
    // Localized `list_toolbar` actions, shared by the generic action bar and the
    // environment-aware toolbar (the action:bar renderer filters by location).
    // The header reads them through `headerToolbarActions`, which drops the
    // selection bar's duplicates once the active view is resolved (objectui#12462).
    const localizedToolbarActions = useMemo(
        () => (listActionsReadable ? objectDef.actions || [] : []).map((a: any) => localizeActionTexts(objectDef.name, a)),
        [objectDef, localizeActionTexts, listActionsReadable],
    );

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

    // Externally-triggered refreshes (e.g. global ModalForm submit, undo, redo)
    // reach every `refreshKey` reader through the sum declared with the counter
    // above (objectui#10572), not through a mirroring effect.

    /**
     * [#5153] The object-list toolbar's CREATE predicates — the `create` half
     * of the toolbar-scope pair on THIS surface. #4646 (PR #5145) gave
     * `createPredicates` a consumer on the **related list**
     * (`RelatedRecordActionsBridge`); the standalone object-list page kept
     * gating its "New" on the object-level verdict alone, so one
     * `userActions.create` object form got two different verdicts depending on
     * which surface rendered the button — honoured on a record page's related
     * list, ignored here. `visibleWhen: false` (the objectui#3492 shape) did
     * not hide this "New".
     *
     * BINDING, LAYERING and the fail-CLOSED / fail-SOFT split are the import
     * half's, immediately below, verbatim — the spec types the two toolbar keys
     * identically and binds them in one breath. See that docblock for the
     * reasoning; the only thing that differs here is which affordance is gated.
     *
     * TWO RENDER POINTS, ONE VERDICT. The affordance surfaces twice on this
     * page — the PageHeader button (desktop) and the phone-only floating "+"
     * that stands in for it once the header is hidden. They are one affordance
     * rendered twice, so both consume these SAME two values; computing the
     * predicate once here is what keeps them from disagreeing with each other.
     */
    const objectCanCreate = newVerdict.allowed;
    const createPredicates: RowCrudPredicates | undefined = newVerdict.predicates;
    /** `visibleWhen` — fails CLOSED, declared-ness by `?? true`. As Import. */
    const createVisible = useRowPredicate(createPredicates?.visibleWhen ?? true, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:create:visibleWhen',
    });
    /** `disabledWhen` — fails SOFT, `!= null` declared-ness OUTSIDE the eval. */
    const createDisabledPred = useRowPredicate(createPredicates?.disabledWhen, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:create:disabledWhen',
    });
    const createDisabled = createPredicates?.disabledWhen != null && createDisabledPred;

    /**
     * objectui#11687 — does this page offer a way to add a row? The New button
     * above, or a `list_toolbar` action the schema-driven toolbar draws (Invite
     * User, Register OAuth Application, …), each by the verdict its own control
     * renders on. The managed-by empty state reads it: a `better-auth` list
     * must not say rows are "not added by hand here" beside such a button.
     * A boolean, computed each render from the payload (`objectDef.actions`),
     * so `renderListView` depends on a primitive, not a memoised identity
     * (AGENTS.md #10).
     */
    /**
     * objectui#13089 — the view's `addRecord` Add button opens this page's own
     * create (`actions.create`, the header New's), so it is offered exactly
     * where that New is offered and live: the object-level verdict, the
     * toolbar-scope `visibleWhen`, and not greyed by `disabledWhen` (`ListView`
     * draws no greyed Add button). A boolean, so `renderListView` depends on
     * a primitive (AGENTS.md #10).
     */
    const listAddRecordOpensCreate = objectCanCreate && createVisible && !createDisabled;
    const mayInvokeToolbarAction = useCapabilityGate();
    const toolbarPredicateScope = usePredicateScope();
    const pageOffersCreate =
        (objectCanCreate && createVisible) ||
        listToolbarDrawsAction(listActions, mayInvokeToolbarAction, toolbarPredicateScope);

    /**
     * [#5142] The object-list toolbar's IMPORT predicates — the `import` half
     * of the toolbar-scope pair the spec resolver emits, mirroring what
     * `RelatedRecordActionsBridge` does for `create` (objectui#4646).
     *
     * `@objectstack/spec@17.0.0` types `userActions.create` and
     * `userActions.import` identically and `resolveCrudAffordances` emits a
     * predicate envelope for each; the docblock binds them in one breath
     * ("`importPredicates` — same binding as `createPredicates`"). #4646 gave
     * `create` a consumer and left `import` declared-and-inert: an author could
     * write `userActions.import.visibleWhen`, have the spec accept it and the
     * resolver parse it, and watch this toolbar offer the CSV wizard anyway.
     *
     * BINDING (the spec docblock's, not an invention here). Unlike the ROW
     * predicates, a toolbar predicate evaluates ONCE per toolbar against the
     * record of the scope the toolbar sits in — the host parent record on a
     * related list, and **no record at all on a standalone object list**, which
     * is what this surface is. So `null` is passed deliberately below: a
     * predicate reading `record.*` has nothing to bind, faults, and — per the
     * fail-CLOSED rule — hides the button, exactly as the spec spells out.
     * Predicates over the host scope (`os.user.*` / `features.*`) bind normally
     * and are the meaningful shape here.
     *
     * LAYERING: surfaced only when the object-level verdict already passed —
     * the same posture the related-list bridge takes, because a predicate may
     * not RE-OPEN what the bucket, the effective API operations (objectstack#3391) or the
     * principal's grant have closed. The identity-import bypass below is a
     * different affordance entirely (it does not read the `listImport` row) and
     * is deliberately left outside this layer.
     */
    const objectCanImport = importVerdict.allowed;
    const importPredicates: RowCrudPredicates | undefined = importVerdict.predicates;
    /**
     * `visibleWhen` — fails CLOSED, and counts as DECLARED by `?? true` rather
     * than by truthiness, so `visibleWhen: false` hides Import instead of
     * reading as "ungated" (the objectui#3492 invariant). The `true` default is
     * a boolean, which the evaluator short-circuits without touching the engine
     * — an object with no import predicates pays no evaluation at all.
     */
    const importVisible = useRowPredicate(importPredicates?.visibleWhen ?? true, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:import:visibleWhen',
    });
    /**
     * `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
     * button forever), with the `!= null` declared-ness gate OUTSIDE the
     * evaluation so `disabledWhen: ''` reads as "no condition" rather than as
     * "disable". Verbatim the posture of the record header (PR #4515), the
     * row kebab, and the related-list toolbar.
     */
    const importDisabledPred = useRowPredicate(importPredicates?.disabledWhen, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:import:disabledWhen',
    });
    const importDisabled = importPredicates?.disabledWhen != null && importDisabledPred;

    // Import wizard open/close state — toolbar entry triggers it.
    const [showImport, setShowImport] = useState(false);

    // ─── Identity import (framework#2782) ────────────────────────────────
    // sys_user's generic import affordance stays FALSE (a data-layer insert
    // would bypass better-auth's hashing and never create a credential), but
    // platform admins get the same wizard wired to the dedicated
    // /api/v1/auth/admin/import-users pipeline. Gated on the deployment's
    // admin surface (features.admin from /api/v1/auth/config) plus the
    // caller being a workspace admin (the server re-checks, ADR-0068).
    // objectui#13330 — and never on a managed environment
    // (`features.cloudManaged`): there the server answers `admin/import-users`
    // with 409 `RESOURCE_CONFLICT`, because people arrive from the hosting
    // organisation through its identity provider.
    const { features } = useExpressionContext();
    const isIdentityImport = objectDef.name === IDENTITY_IMPORT_OBJECT;
    const identityImportEnabled =
        isIdentityImport && features?.admin === true && isAdmin && !isManagedEnvironment(features);

    // ─── Setup → Users on a managed environment (objectui#13330) ─────────
    // The line that says where people are invited, and the marker on a user
    // who holds no permission set beyond the baseline. The marker reads the
    // grant rows through one loader per list (`managedEnvironmentUsers.tsx`),
    // rebuilt when the list refreshes, so a grant made elsewhere shows on the
    // next load. The metadata store is read through a ref: its context value is
    // rebuilt whenever any cached type settles (AGENTS.md #10).
    const managedUsers = objectDef.name === MANAGED_USERS_OBJECT && isManagedEnvironment(features);
    const metadataStore = useMetadata();
    const metadataStoreRef = useRef(metadataStore);
    metadataStoreRef.current = metadataStore;
    const grantLoaderRef = useRef<{ refreshKey: number; source: unknown; loader: UserGrantLoader } | null>(null);
    if (
        managedUsers &&
        dataSource &&
        (grantLoaderRef.current?.refreshKey !== refreshKey || grantLoaderRef.current?.source !== dataSource)
    ) {
        grantLoaderRef.current = {
            refreshKey,
            source: dataSource,
            loader: new UserGrantLoader(dataSource as any, {
                ensureType: (type: string) => metadataStoreRef.current.ensureType(type),
                getTypeStatus: (type: string) => metadataStoreRef.current.getTypeStatus?.(type) ?? 'ready',
            }),
        };
    }
    const grantLoader = managedUsers ? grantLoaderRef.current?.loader : undefined;
    const managedUserMarker = useCallback(
        (row: Record<string, unknown>) => {
            const id = row?.id ?? row?._id;
            if (!grantLoader || id === undefined || id === null || id === '') return null;
            return <UnauthorizedUserMarker loader={grantLoader} userId={String(id)} t={t} />;
        },
        [grantLoader, t],
    );
    const [identityPasswordPolicy, setIdentityPasswordPolicy] = useState<IdentityPasswordPolicy>('auto');
    const identityPolicyRef = useRef<IdentityPasswordPolicy>('auto');
    identityPolicyRef.current = identityPasswordPolicy;
    const identityDataSource = useMemo(
      () => (identityImportEnabled
        ? createIdentityImportDataSource({
            base: dataSource,
            authFetch: actionRuntime.authFetch,
            baseUrl: import.meta.env.VITE_SERVER_URL || '',
            getPasswordPolicy: () => identityPolicyRef.current,
          })
        : undefined),
      [identityImportEnabled, dataSource, actionRuntime.authFetch],
    );

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
                label: viewTabLabel(view, objectDef.name, servedViews, viewLabel, unlabelledViewText),
                icon: Icon ? <Icon className="h-4 w-4" /> : undefined,
            };
        });
    }, [views, objectDef.name, viewLabel, unlabelledViewText, servedViews]);
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

    // Real-time: auto-refresh when server reports data changes
    const { lastMessage: realtimeMessage } = useRealtimeSubscription({
        channel: `object:${objectDef.name}`,
    });

    // Conflict resolution: detect and queue conflicts on reconnection
    const conflictUserId = objectDef.name ? `user-${objectDef.name}` : 'current-user';
    const { hasConflicts, resolveAllConflicts } = useConflictResolution(conflictUserId);

    useEffect(() => {
        if (realtimeMessage) {
            // On reconnection data change, auto-resolve with server-wins strategy
            if (hasConflicts) {
                resolveAllConflicts('remote');
            }
            refreshData();
        }
    }, [realtimeMessage, hasConflicts, resolveAllConflicts, refreshData]);
    
    // Fetch record count for footer display.
    //
    // `$top: 0` IS the request: give me the total, send no rows. It was written
    // `limit: 0`, which is not a `QueryParams` key — `convertQueryParams` copies
    // exactly the `$`-prefixed keys the type declares — so the cap reached no
    // branch and was dropped, and the platform's GET list route has no default
    // page size. The effect therefore did the opposite of what it says: it
    // downloaded EVERY row of the object, on every mount and every refresh of
    // every list view, to read one integer off the envelope. The dead spelling
    // type-checked because `QueryParams` then carried `[key: string]: any` for
    // adapter-specific params; `object-ui/no-unprefixed-query-params` rejects it
    // at write time now (objectui#5458), and the index signature itself is gone
    // (objectui#7497), so `tsc` refuses it as well.
    //
    // `total` is the only field that can still answer the question, so the
    // row-counting fallbacks are gone rather than repointed. Once we ask for
    // zero rows an empty `data` means "you asked for none", not "the object is
    // empty" — counting the response would report a confident `0` for any
    // adapter that does not send a total. Leaving `recordCount` `undefined`
    // omits the footer line instead of asserting a wrong number; the render is
    // already guarded by `typeof recordCount === 'number'`.
    useEffect(() => {
        if (dataSource?.find && objectDef.name) {
            dataSource.find(objectDef.name, { $top: 0 }).then((result: any) => {
                if (typeof result?.total === 'number') {
                    setRecordCount(result.total);
                }
            }).catch(() => {
                // Silently ignore — record count is non-critical
            });
        }
    }, [dataSource, objectDef.name, refreshKey]);

    // Navigation overlay for record detail (supports drawer/modal/split/popover via config)
    // Priority: activeView.navigation > objectDef.navigation > default drawer.
    //
    // Default mode = 'drawer'. Mirrors Linear / Notion / Airtable / Jira where
    // record peek is the primary interaction and full-page is the upgrade.
    // Direct URL access (`/record/:id`) still opens as a full page because
    // RecordDetailView owns its own route — only same-page click navigation
    // is drawer-by-default. Per-view config can still override (e.g. a heavy
    // detail object can set `navigation.mode = 'page'`).
    const detailNavigation: ViewNavigationConfig = useMemo(
        () => {
            const authored = activeView?.navigation ?? objectDef.navigation;
            if (authored) {
                // Authored config wins. For an overlay, resolve the `size`
                // bucket (or 'auto') to a viewport-clamped width when no explicit
                // width was given — objectstack-ai/objectstack#2578: a pixel width can't be authored blind.
                if (authored.mode === 'page') return authored;
                return {
                    ...authored,
                    width: authored.width ?? overlayWidthFor(
                        (authored as { size?: 'auto' | 'sm' | 'md' | 'lg' | 'xl' | 'full' }).size,
                        objectDef,
                    ),
                };
            }
            // objectstack-ai/objectstack#2578: derive surface + width from FIELD COUNT. Field-heavy → full
            // page (cramped in a drawer); light → a drawer sized to the content
            // and clamped to the viewport. Mobile always pages (in deriveRecordSurface).
            return deriveRecordSurface(objectDef) === 'page'
                ? { mode: 'page' }
                : { mode: 'drawer', width: overlayWidthFor('auto', objectDef) };
        },
        [activeView?.navigation, objectDef]
    );
    const drawerRecordId = searchParams.get(RECORD_DRAWER_PARAM);

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
    // Memoize onNavigate to prevent stale closure in useNavigationOverlay's handleClick
    const handleNavOverlayNavigate = useCallback(
        (recordId: string | number, action?: string) => {
            if (action === 'new_window') {
                // Open record detail in a new browser tab with Console-correct URL.
                // Same builder the list's link column publishes as its href
                // (objectui#4490) — one record-route shape for this surface.
                window.open(listRecordDetailUrl(window.location.pathname, recordId), '_blank');
                return;
            }
            // Default: navigate to record detail page.
            // `action` is a navigation-MODE token — 'view' / 'page' / undefined
            // — and every non-`new_window` value lands on the record detail
            // route.
            //
            // ⛔ It is NOT a view name, and this comment used to say a custom
            // one could arrive here "forwarded from `navigation.view` (e.g.
            // 'detail_form')", resolved "by RecordDetailView from its own
            // config". No layer ever resolved a view by that name — which is
            // why `@objectstack/spec` 17.5.0 retired the key under ADR-0049,
            // and why `useNavigationOverlay` stopped forwarding it
            // (objectui#9874). Nothing here changes behaviour: this branch
            // already treated the name and the token identically, which is
            // exactly what made the substitution inaudible on this surface.
            const originState = {
              from: {
                pathname: location.pathname + (location.search || ''),
                label: viewTabLabel({ id: activeView?.id, name: activeView?.name, label: activeView?.label }, objectDef.name, servedViews, viewLabel, unlabelledViewText),
              },
            };
            if (viewId) {
                navigate(`../../record/${encodeURIComponent(String(recordId))}`, { relative: 'path', state: originState });
            } else {
                navigate(`record/${encodeURIComponent(String(recordId))}`, { state: originState });
            }
        },
        [navigate, viewId, location.pathname, location.search, objectDef, activeView?.id, activeView?.name, activeView?.label, viewLabel, unlabelledViewText, servedViews]
    );
    /**
     * The list surface's half of the record-link mechanism (objectui#4490):
     * publish this page's record-URL builder so the grid's `link: true` column
     * can render a real anchor instead of a click-only `span role="link"`.
     * See {@link listRecordActionsValue} for what this does and does NOT claim.
     *
     * The record drawer/overlay below mounts `RecordDetailView`, which brings
     * its own `RelatedRecordActionsBridge` around the whole detail body — that
     * nearer provider keeps owning the detail surface, exactly as before.
     */
    const listRecordActions = useMemo(
        () =>
            listRecordActionsValue(objectDef.name, handleNavOverlayNavigate, undefined, {
                appName,
                objects,
                navigate,
                routerRootHref,
            }),
        [objectDef.name, handleNavOverlayNavigate, appName, objects, navigate, routerRootHref],
    );
    const navOverlay = useNavigationOverlay({
        navigation: detailNavigation,
        objectName: objectDef.name,
        onNavigate: handleNavOverlayNavigate,
    });
    const handleDrawerClose = () => {
        navOverlay.close();
        const newParams = new URLSearchParams(searchParams);
        newParams.delete(RECORD_DRAWER_PARAM);
        setSearchParams(newParams);
    };
    /**
     * Row-click handler used by all list/grid/gallery/kanban surfaces inside
     * this object view. Wraps `navOverlay.handleClick` so that drawer-mode
     * opens are URL-driven (writes `?recordId=…`) — making the drawer state
     * shareable, refresh-safe, and respected by browser back/forward. The
     * URL→state sync effect below handles actually opening the drawer.
     */
    const handleRowClick = useCallback(
        (record: any, event?: React.MouseEvent | { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
            // Cmd/Ctrl/middle-click — let the hook open in a new tab (full page)
            // regardless of configured mode. Matches browser link convention.
            const isModifier = !!(
                event && ((event as any).metaKey || (event as any).ctrlKey || (event as any).button === 1)
            );
            if (isModifier) {
                navOverlay.handleClick(record, event as any);
                return;
            }
            // Drawer mode → URL is the source of truth. Push `?recordId=…`
            // and let the existing URL-sync effect open the overlay.
            if (navOverlay.mode === 'drawer') {
                const id = (record?.id ?? record?._id) as string | number | undefined;
                if (id != null) {
                    const next = new URLSearchParams(searchParams);
                    next.set(RECORD_DRAWER_PARAM, String(id));
                    setSearchParams(next);
                    return;
                }
            }
            // All other modes (page / modal / split / popover / new_window / none)
            // — delegate to the hook.
            navOverlay.handleClick(record, event as any);
        },
        [navOverlay, searchParams, setSearchParams]
    );
    /**
     * "Expand to full page" — invoked from the drawer header chevron. Closes
     * the drawer (which clears `?recordId=…`) and router-pushes to the
     * dedicated `/record/:id` route. Mirrors Linear/Notion peek-to-page.
     */
    const handleExpandDrawer = useCallback(() => {
        const rec = navOverlay.selectedRecord as Record<string, unknown> | null;
        const id = rec && ((rec as any).id ?? (rec as any)._id);
        if (id == null) return;
        handleDrawerClose();
        handleNavOverlayNavigate(id as string | number);
    }, [navOverlay.selectedRecord, handleNavOverlayNavigate]);
    // Sync URL-based recordId to overlay state
    useEffect(() => {
        if (drawerRecordId && !navOverlay.isOpen) {
            navOverlay.open({ id: drawerRecordId });
        } else if (!drawerRecordId && navOverlay.isOpen) {
            navOverlay.close();
        }
    }, [drawerRecordId]);

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

    /*
     * View Tabs — Airtable-style switcher with rename / delete / duplicate /
     * pin / set-default / drag-reorder. Built-in views (sourced from
     * objectDef.listViews) only support switching; mutating callbacks
     * short-circuit with a toast.
     *
     * objectui#12440 — the strip is no longer a row of its own above the list:
     * it is handed to `ListView` as its `toolbarLeading` host prop, so the tabs
     * and the list's Filter · Sort · Display · Search share one row. From
     * `sm` up only; below it nothing is handed over and the app bar's mobile
     * view switcher (registered above) stays the phone's view control.
     */
    const viewTabsFit = useViewTabsFit();
    // objectui#12528 — the view's description rides on its tab (the active
    // tab's tooltip and ▾ menu header) instead of a row above the toolbar.
    // Resolved the way `ListView` resolves the same text (`pickLocalized` on
    // the display locale), and gated on the same switch the relay below hands
    // `ListView` as `appearance.showDescription`: `false` shows it nowhere.
    const displayLocale = useDisplayLocale();
    const viewTabItems: ViewTabItem[] = views.map((view: any) => {
        const saved = savedViews.find((sv: any) => viewRowId(sv) === view.id);
        // System views (loaded from objectDef.listViews / metadata) are
        // *read-only*. Only sys_view-backed records can be mutated by
        // the user; admins must duplicate a system view to customize it.
        const isSystem = !saved;
        return {
            id: view.id,
            label: viewTabLabel(view, objectDef.name, servedViews, viewLabel, unlabelledViewText),
            type: view.type,
            hasActiveFilters: Array.isArray(view.filter) && view.filter.length > 0,
            hasActiveSort: Array.isArray(view.sort) && view.sort.length > 0,
            isDefault: !!(saved?.isDefault ?? view.isDefault),
            isPinned: !!(saved?.isPinned ?? view.isPinned),
            visibility: saved?.visibility ?? view.visibility,
            readonly: isSystem,
            readonlyReason: isSystem
                ? t('console.objectView.systemViewReadonly')
                : undefined,
            description: (view.showDescription ?? view.appearance?.showDescription) === false
                ? undefined
                : pickLocalized(view.description, displayLocale) || undefined,
        } as ViewTabItem;
    });
    const viewTabBar = viewTabsFit && views.length >= 1 ? (
        <ViewTabBar
            views={viewTabItems}
            activeViewId={viewAccess.refusal ? '' : activeViewId}
            onViewChange={handleViewChange}
            viewTypeIcons={VIEW_TYPE_ICONS}
            config={{
                reorderable: false,
                showAddButton: isAdmin,
                showPinnedSection: true,
                showVisibilityGroups: true,
            }}
            onAddView={isAdmin ? handleAddView : undefined}
            onRenameView={isAdmin ? handleRenameView : undefined}
            onDeleteView={isAdmin ? handleDeleteView : undefined}
            onPinView={isAdmin ? handlePinView : undefined}
            onSetDefaultView={isAdmin ? handleSetDefaultView : undefined}
            onConfigView={isAdmin ? handleConfigView : undefined}
            onManageViews={isAdmin ? () => setManageViewsOpen(true) : undefined}
        />
    ) : null;

    // objectui#13114 — the strip as a row of its own, for the faces that have
    // no `ListView` toolbar to carry it: a view the server refused (drawn
    // page-level below) and a `type: 'chart'` view (drawn above the chart in
    // `renderListView`'s chart branch, which returns before `ListView`). Every
    // other face gets the strip in the list's toolbar row instead, so no face
    // ever draws two. Gated on `viewTabBar`, so below `sm` it is absent too.
    const viewTabRow = viewTabBar ? (
        <div className="border-b px-3 sm:px-4 bg-background overflow-x-auto shrink-0" data-testid="view-tab-row">
            {viewTabBar}
        </div>
    ) : null;

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
                    <Suspense key={identityKey} fallback={<div className="p-4 text-sm text-muted-foreground">Loading chart…</div>}>
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
                <Suspense key={identityKey} fallback={<div className="p-4 text-sm text-muted-foreground">Loading chart…</div>}>
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
                dataSource={ds}
            />
        );
    }, [inSetup, activeView, activeViewDeclaresColumns, activeViewIsSaved, objectDef, objectName, refreshKey, navOverlay, actions, urlFilters, initialUfSelections, handleUserFilterSelectionsChange, writeListUrlState, user?.id, pageOffersCreate, listAddRecordOpensCreate, listIdentityKey, listPrefs.ready, listPrefs.preference, listPrefs.patchView, viewTabBar, viewTabRow, managedUsers, managedUserMarker]);

    // Memoize the merged views array so PluginObjectView doesn't get a new
    // reference on every render (which would trigger unnecessary data refetches).
    const mergedViews = useMemo(() =>
        views.map((v: any) =>
            v.id === activeViewId && viewDraft && viewDraft.id === v.id
                ? { ...v, ...viewDraft }
                : v
        ),
        [views, activeViewId, viewDraft]
    );

    // objectui#11013 — the active view's toolbar policy, read under its declared
    // spelling `userActions.search` / `.filter` / `.sort`. These used to be read
    // as the bare `showSearch` / `showFilters` / `showSort` flags, so a view
    // that declared `userActions: { search: false }` still got a search box
    // here. A stored view that still carries a bare flag is folded onto
    // `userActions` by `normalizeListViewSchema`, the one fold the relay's own
    // `userActions` rung already runs; this read names no legacy key. Not
    // memoised: `activeView` is a fresh object on every render while a draft is
    // open, and the schema below keys on the three booleans, not on this value.
    const activeViewUserActions = (normalizeListViewSchema(activeView ?? {}) as {
        userActions?: { search?: boolean; filter?: boolean; sort?: boolean };
    }).userActions;
    const activeViewSearch = activeViewUserActions?.search !== false;
    const activeViewFilter = activeViewUserActions?.filter !== false;
    const activeViewSort = activeViewUserActions?.sort !== false;

    // Build the ObjectViewSchema for the plugin — reads from activeView (which merges draft)
    const objectViewSchema = useMemo(() => ({
        type: 'object-view' as const,
        objectName: objectDef.name,
        layout: 'page' as const,
        showSearch: activeViewSearch,
        showFilters: activeViewFilter,
        showSort: activeViewSort,
        showCreate: false, // We render our own create button in the header
        allowCreateView: isAdmin,
        viewActions: isAdmin ? [
            { type: 'settings' as const },
            { type: 'share' as const },
            { type: 'delete' as const },
        ] : [],
        onNavigate: (recordId: string | number, mode: 'view' | 'edit') => {
            if (mode === 'edit') {
                onEdit?.({ id: recordId });
            } else if (mode === 'view') {
                const originState = {
                  from: {
                    pathname: location.pathname + (location.search || ''),
                    label: viewTabLabel({ id: activeView?.id, name: activeView?.name, label: activeView?.label }, objectDef.name, servedViews, viewLabel, unlabelledViewText),
                  },
                };
                if (viewId) {
                    navigate(`../../record/${encodeURIComponent(String(recordId))}`, { relative: 'path', state: originState });
                } else {
                    navigate(`record/${encodeURIComponent(String(recordId))}`, { state: originState });
                }
            }
        },
    }), [objectDef, onEdit, activeViewSearch, activeViewFilter, activeViewSort, activeView?.id, activeView?.name, activeView?.label, navigate, viewId, isAdmin, location.pathname, location.search, viewLabel, unlabelledViewText, servedViews]);

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
            className="shadow-none gap-1.5 sm:gap-2 h-8 sm:h-9"
            data-testid="object-view-new-button"
        >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('console.objectView.new')}</span>
        </Button>
    ) : null;

    // objectui#12705 — the header's actions folded, for a header too narrow
    // for them and the description: the primary action stays labelled and
    // every other action goes into one `⋯` menu, above the page's own entries
    // (favorites, Reset view). The header decides when; this decides what.
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
    const toolbarRowActions: UIActionSchema[] = listActions?.some((a: { locations?: readonly string[] }) => a.locations?.includes('list_toolbar'))
        ? toolbarActionsWithDeepLink
        : [];
    const primaryToolbarAction = showCreate ? undefined : declaredPrimaryToolbarAction(toolbarRowActions);
    const importShown = identityImportEnabled || (objectCanImport && importVisible);
    const foldedMenuBar: ActionBarSchema = {
        type: 'action:bar',
        location: 'list_toolbar',
        actions: [
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
            ...(activeViewHasPreference ? [{
                name: 'object_view_reset_view',
                label: t('console.objectView.resetView'),
                icon: 'rotate-ccw',
                type: 'script' as const,
                onClick: handleResetView,
            }] : []),
        ],
        variant: 'ghost',
        size: 'icon',
        maxVisible: 0,
        mobileMaxVisible: 0,
    };
    const foldedHeaderActions = !isEnvironmentList ? (
        <>
            {createButton}
            {/* One inline slot at every width: `toolbarBar` keeps none below
                `md` (`mobileMaxVisible: 0`), which would send the primary into
                a second `⋯` beside the menu's. */}
            {primaryToolbarAction && (
                <SchemaRenderer schema={{ ...toolbarBar, actions: [primaryToolbarAction], maxVisible: 1, mobileMaxVisible: 1 }} />
            )}
            <SchemaRenderer schema={foldedMenuBar} />
        </>
    ) : undefined;

    // objectui#12112 — the list area for a view the server refused: said as a
    // permission refusal, in the server's own sentence, which names the view.
    const refusedViewFace = viewAccess.refusal ? (
        <div className="h-full flex items-center justify-center p-8">
            <Empty data-testid="view-access-denied">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Lock className="h-6 w-6 text-muted-foreground" />
                </div>
                <EmptyTitle>{t('list.loadErrorForbiddenTitle')}</EmptyTitle>
                {viewAccess.refusal.message && <EmptyDescription>{viewAccess.refusal.message}</EmptyDescription>}
            </Empty>
        </div>
    ) : null;

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
             <div className="hidden sm:block">
             <PageHeader
                 // The page lists the object's records, so it is titled with
                 // the plural, as the nav entry that opens it is
                 // (objectui#11696); the record page keeps the singular.
                 title={objectPluralLabel(objectDef)}
                 // The kind chip, in the header's own slot after the title
                 // (objectui#12606).
                 badge={<ManagedByBadge managedBy={(objectDef as any)?.managedBy} />}
                 subtitle={objectDef.description ? objectDesc(objectDef) : undefined}
                 // `createElement`, not a JSX tag: the looked-up icon is a value,
                 // which react-hooks/static-components refuses in tag position
                 // (the convention ObjectDataPage set).
                 icon={createElement(getIcon((objectDef as any)?.icon), { className: 'h-4 w-4' })}
                 actions={
                   <>
                    {/* No favorite star here since objectui#12423: the one-row
                        header is icon, title, description and these actions.
                        The favorites entry is in the overflow menu at the end
                        of this row (objectui#12427). */}

                    {/* Primary action (see `createButton`). */}
                    {createButton}

                    {/* Data import — desktop only on phones. CSV imports
                        are inherently a desk/laptop workflow; the button
                        was eating header space on mobile next to the
                        primary "+" action. */}
                    {/* [#5142] `objectCanImport && importVisible` — the object-level
                        verdict, then the toolbar-scope `visibleWhen` layer on top of
                        it. Greyed, not gone, is the `disabledWhen` case below. */}
                    {importShown && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowImport(true)}
                        disabled={importDisabled}
                        className="hidden sm:inline-flex shadow-none gap-1.5 sm:gap-2 h-8 sm:h-9"
                        title={t('console.objectView.importTitle')}
                        data-testid="object-view-import-button"
                    >
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('console.objectView.import')}</span>
                    </Button>
                    )}

                    {/* Schema-driven toolbar actions */}
                    {listActions?.some((a: any) => a.locations?.includes('list_toolbar')) && (
                      isEnvironmentList ? (
                        <EnvironmentListToolbar
                          actions={headerToolbarActions}
                          entitlements={environmentEntitlements}
                        />
                      ) : (
                      <SchemaRenderer schema={toolbarBar} />
                      )
                    )}

                    {/* The page's overflow menu (objectui#12427), last in the
                        row: the favorites entry that replaced the header star.
                        Favorites is a once-and-forget act, so it lives behind
                        the ⋯ rather than in the header's most prominent slot.
                        "Reset view" (objectui#12418) is the same kind of act and
                        lives beside it, so the one-row header keeps its shape
                        as the user sorts. The ⋯ is drawn when either applies. */}
                    {(listFavorite || activeViewHasPreference) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shadow-none h-8 sm:h-9 px-2"
                            aria-label={t('detail.moreActions', { defaultValue: 'More actions' })}
                            data-testid="object-view-more-actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {listFavorite && (
                            <FavoriteMenuItem
                              isFavorite={listFavorite.isFavorite}
                              onToggle={listFavorite.toggle}
                              testId="object-view-favorite"
                            />
                          )}
                          {/* objectui#12418 — the user's own list state for
                              this view (sort, filters, column layout) back to
                              the view's. Only while they have stored some. */}
                          {activeViewHasPreference && (
                            <DropdownMenuItem
                              onSelect={handleResetView}
                              title={t('console.objectView.resetViewTitle')}
                              data-testid="object-view-reset-view-button"
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span>{t('console.objectView.resetView')}</span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {/*
                       Design Tools dropdown removed — its items were redundant:
                       - "Edit view"  → use chevron menu's "Edit view config"
                       - "Add view"   → use the `+` button on the tab bar or the "Add new view" footer in Manage Views
                       - "Metadata inspector" → still toggleable via the `?__debug` URL flag (see useMetadataInspector)
                    */}
                   </>
                 }
                 foldedActions={foldedHeaderActions}
             />
             </div>

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
                {navOverlay.mode === 'split' && navOverlay.isOpen ? (
                    <NavigationOverlay
                        {...navOverlay}
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

             {/* Record Detail Overlay — navigation mode driven by objectDef.navigation */}
             {navOverlay.mode !== 'split' && (
             <NavigationOverlay
                 {...navOverlay}
                 setIsOpen={(open: boolean) => { if (!open) handleDrawerClose(); }}
                 title={objectLabel(objectDef)}
                 onExpand={handleExpandDrawer}
                 expandLabel={t('console.objectView.expandToPage', { defaultValue: 'Open as full page' })}
                 storageKey={`drawer-width:${objectDef.name}`}
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
             )}
        </div>
        {actionRuntime.dialogs}
        </RelatedRecordActionsProvider>
        </ActionProvider>
    );
}