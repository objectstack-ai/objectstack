/**
 * Module-level helpers and constants of the Console `ObjectView`
 * (`./ObjectView.tsx`), moved out of that file verbatim (objectstack#25992,
 * slice 1). `ObjectView.tsx` re-exports every name it exported before.
 */

import type { ComponentType } from 'react';
import { resolveFilterPlaceholders, type FilterTokenScope } from '@object-ui/core';
import { Table as TableIcon, KanbanSquare, Calendar, LayoutGrid, Activity, GanttChart, MapPin, BarChart3 } from 'lucide-react';
import type { UIActionSchema } from '@object-ui/types';
import { actionRendersAt } from '@object-ui/types';

/** Map view types to Lucide icons (Airtable-style) */
export const VIEW_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
    grid: TableIcon,
    kanban: KanbanSquare,
    calendar: Calendar,
    gallery: LayoutGrid,
    timeline: Activity,
    gantt: GanttChart,
    map: MapPin,
    chart: BarChart3,
};

export const FALLBACK_USER = { id: 'current-user', name: 'Demo User' };

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
export function substituteFilterTokens(filter: any, scope: FilterTokenScope): any {
    return resolveFilterPlaceholders(filter, scope);
}

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
export const MOBILE_FAB_LIST_CLEARANCE = 'max-sm:[&_[data-fab-clearance]]:pb-48';
