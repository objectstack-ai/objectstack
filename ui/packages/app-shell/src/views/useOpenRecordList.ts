/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { resolveFilterPlaceholders } from '@object-ui/core';
import { useFilterScope } from '@object-ui/react';
import { serializeDrillFilterParams } from './drillUrlFilters.js';

/**
 * The router path of an object's ADR-0055 bare data surface, scoped by
 * `filter` (`/apps/:appName/:object/data?filter[...]`). The one place that
 * route shape is spelled: {@link useOpenRecordList} navigates to it, and so
 * does a related list's "View all" (`RelatedRecordActionsBridge`,
 * objectui#12741).
 *
 * Pure: `filter` is written as handed. A caller holding AUTHORED values, which
 * may carry placeholders, resolves them first, as `useOpenRecordList` does.
 */
export function recordListPath(
  appName: string | undefined,
  objectName: string,
  filter?: Record<string, unknown>,
): string {
  // A date-bucket drill carries an ObjectQL range operator object
  // (`{ $gte, $lt }`); the shared serializer emits it as `filter[field][gte|lt]`
  // (never "[object Object]"). Equality dims stay `filter[field]=value` (objectstack-ai/objectstack#1752).
  const qs = serializeDrillFilterParams(filter).toString();
  const base = appName ? `/apps/${appName}` : '';
  // ADR-0055 bare data surface (`/:object/data`): "the URL is the view" — no
  // saved-view filter is baked in, so the scope is exactly these conditions.
  // (The object route stacks URL filters ON TOP of the default view's own
  // filter, which can silently over-narrow the list.)
  return `${base}/${objectName}/data${qs ? `?${qs}` : ''}`;
}

/**
 * `useOpenRecordList` — the console's implementation of the drill "escape
 * hatch" (`DrillNavigationContext.openRecordList`).
 *
 * Navigates to the object's ADR-0055 bare data surface, scoped by a record
 * filter, using the console's `/apps/:appName/:object/data?filter[...]` route
 * shape. Equality dims serialize to `filter[field]=value`; a date-bucket drill's
 * range serializes to `filter[field][gte]=…&filter[field][lt]=…` (objectstack-ai/objectstack#1752). Wire it
 * into a `DrillNavigationProvider` so the dashboard/report drill drawers can offer
 * "Open in list →" and honor `drillDown.target: 'navigate'`.
 *
 * ## Placeholders are resolved HERE, because this is where the scope is
 * (objectui#9022)
 *
 * Every widget composes its drill filter from the RAW authored `schema.filter`
 * — `ObjectChart`'s `drillFilter` memo and `DrillDownDrawer`'s `filter` prop
 * both do — so the value arriving here still carries whatever placeholders the
 * author wrote: `{current_user_id}`, `{current_org_id}`, and the relative-date
 * macros. Resolving it before serialization is what makes ONE drill mean ONE
 * scope regardless of `drillDown.target`:
 *
 *   - `target: 'drawer'` renders `object-data-table`, whose own fetch calls
 *     `resolveFilterPlaceholders(schema.filter, filterScope)` — so the drawer
 *     arm has always been scoped by the RESOLVED value;
 *   - `target: 'navigate'` (and the "Open in list →" button on either widget
 *     family) comes through here, and used to write the placeholder into the
 *     URL verbatim. `filter[close_date][gte]={current_quarter_start}` parses
 *     back on the READ side as an ordinary string comparand, so the list
 *     matched nothing — silently, and in disagreement with the chart bar the
 *     user had just clicked, which `ObjectChart` scopes by the resolved value.
 *
 * ⛔ Deliberately NOT inside `serializeDrillFilterParams`: that function is a
 * pure URL encoder which writes faithfully what it is handed, and the scope is
 * a React context read, so putting the resolution there would make a pure
 * function scope-dependent while leaving the callers holding the scope anyway.
 *
 * ⛔ And deliberately NOT at each widget's drill seam: `openRecordList` is the
 * single host-provided handler every drill escape hatch funnels through
 * (`ObjectChart`'s navigate arm and its own header button, `DrillDownDrawer`'s
 * navigate arm, and `OpenInListButton`), so resolving once here covers both
 * widget families and every future caller, instead of N seams the next
 * hand-rolled drill panel would forget.
 *
 * Resolution cannot change a filter that carries no placeholder: both
 * vocabularies substitute whole-string `{token}` values only and pass
 * everything else through untouched, so a placeholder-free drill produces a
 * byte-identical URL.
 */
export function useOpenRecordList(): (objectName: string, filter?: Record<string, unknown>) => void {
  const navigate = useNavigate();
  const { appName } = useParams<{ appName?: string }>();
  // Session scope for `{current_user_id}` / `{current_org_id}`. Read at hook
  // level — the returned handler is a callback, and hooks cannot be called from
  // inside it. `FilterScopeProvider` memoizes its value on the two ids, so this
  // does not churn the callback identity on unrelated renders.
  const filterScope = useFilterScope();

  return useCallback(
    (objectName: string, filter?: Record<string, unknown>) => {
      // Expand EVERY placeholder vocabulary in one call — date macros and
      // session tokens. Calling only one of the two is the defect this helper
      // exists to prevent (objectstack-ai/objectstack#3574): `{today}` would work and
      // `{current_user_id}` would silently not.
      const runtimeFilter = resolveFilterPlaceholders(filter, filterScope);
      navigate(recordListPath(appName, objectName, runtimeFilter));
    },
    [navigate, appName, filterScope],
  );
}
