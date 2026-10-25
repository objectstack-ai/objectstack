/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { FilterTokenScope } from '@object-ui/core';
import { useRecordContext } from '../context/RecordContext.js';

/**
 * The session values filter placeholders resolve against — `{current_user_id}`
 * and `{current_org_id}` (objectstack-ai/objectstack#3574). The record-scoped
 * `{record_id}` is not a session value and is not provided here: see
 * {@link useFilterScope}.
 *
 * ## Why a dedicated context
 *
 * The renderer packages (`plugin-dashboard`, `plugin-charts`, `plugin-list`)
 * deliberately do not depend on `@object-ui/auth`; they receive everything
 * they need as schema or context. But a widget cannot resolve
 * `{current_user_id}` without knowing who is signed in, and the surfaces that
 * DO know (the app-shell) sit above them.
 *
 * `PredicateScopeContext` already carries `current_user` and would have
 * covered the user id, but it is the *expression* evaluation scope — it
 * carries no organization, and widening it for an unrelated consumer would
 * couple filter resolution to predicate semantics. A separate, two-field
 * context keeps the contract explicit and lets a non-console host provide
 * exactly these values without adopting the expression stack.
 *
 * When no provider is mounted this returns an empty scope. That is a safe
 * default: unresolved tokens are left intact by the resolver, so the filter
 * matches nothing rather than silently widening, and the resolver emits one
 * warning naming the token.
 */
const FilterScopeContext = createContext<FilterTokenScope>({});

/**
 * Provide the session scope used to resolve filter placeholders.
 *
 * Mount once, above any surface that renders filtered data. The console shell
 * mounts it next to `ExpressionProvider`, where both the signed-in user and
 * the active organization are already resolved.
 */
export function FilterScopeProvider({
  currentUserId,
  currentOrgId,
  children,
}: {
  currentUserId?: string | null;
  currentOrgId?: string | null;
  children: ReactNode;
}) {
  const value = useMemo<FilterTokenScope>(
    () => ({ currentUserId, currentOrgId }),
    [currentUserId, currentOrgId],
  );
  return createElement(FilterScopeContext.Provider, { value }, children);
}

/**
 * Read the scope for filter placeholder resolution: the session scope the host
 * mounted, plus the id of the record in view when there is one.
 *
 * Pass the result straight to `resolveFilterPlaceholders(filter, scope)` from
 * `@object-ui/core` — that helper expands every placeholder vocabulary in one
 * call, which is the point: resolving only some of them is the defect behind
 * objectstack-ai/objectstack#3574.
 *
 * ## `{record_id}` reads the MOUNTED record (objectui#7297)
 *
 * `recordId` comes from the nearest `RecordContextProvider` — the record a
 * `type: 'record'` page is showing, the same provider whose row a component's
 * `visibleWhen` binds as `record` — and from nowhere else: ⛔ not a URL
 * parameter, not a page variable, and not a prop of `FilterScopeProvider`,
 * which stays session-only. Every data node that already resolves its filter
 * through this hook therefore resolves `{record_id}` on a record page without
 * a line of its own, and refuses it by name everywhere else (a list view, a
 * dashboard, a page that is not a record page), because there the member is
 * simply absent.
 *
 * Outside a record context the session scope is handed back as the very
 * object the provider published, so nothing changes for a surface that shows
 * no record. Inside one, the combined scope is rebuilt only when the session
 * scope or the record id changes. A consumer that holds a resolution compares
 * the members one by one — `recordId` among them — never this object's
 * identity (AGENTS.md #10).
 */
export function useFilterScope(): FilterTokenScope {
  const session = useContext(FilterScopeContext);
  const recordId = useRecordContext()?.recordId;
  return useMemo<FilterTokenScope>(
    () => (recordId == null ? session : { ...session, recordId }),
    [session, recordId],
  );
}
