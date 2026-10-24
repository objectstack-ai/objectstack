/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DrillNavigationContext — host-provided navigation for drill "escape hatches".
 *
 * Dashboard/report drill-through opens an in-place drawer listing the records
 * behind a clicked aggregate (the mainstream "peek without losing context"
 * default). But sometimes the user wants the *full* object list page — to sort,
 * bulk-select, switch views, export, or get a shareable URL. That requires
 * console-specific URL building + SPA routing, which lives in the app shell,
 * not the renderer.
 *
 * The app shell provides `openRecordList`; the drill drawers consume it to
 * render an "Open in list →" action (and to honor `drillDown.target:
 * 'navigate'`, which skips the drawer entirely). When no provider is present
 * (e.g. an embedded/standalone renderer with no router) the affordance is
 * simply hidden — drill stays in the drawer.
 */

import React, { createContext, useContext } from 'react';

export interface DrillNavigationValue {
  /**
   * Open the full list page for `objectName`, scoped by `filter` (an object
   * FIELD name → raw stored value map). Implemented by the app shell as a
   * SPA navigation to the object's list route. Absent when no host wired it.
   *
   * ⚠️ `filter` is the widget's AUTHORED filter composed with the click
   * context, so it may still carry unresolved placeholders — `{current_user_id}`,
   * `{current_org_id}`, and the relative-date macros. **Resolving them is the
   * host implementation's job**: call `resolveFilterPlaceholders(filter, scope)`
   * from `@object-ui/core` with the session scope the host holds
   * (`useFilterScope`), exactly once, before the value reaches a query or a URL.
   *
   * A host that skips it gives ONE drill TWO scopes: the in-place drawer arm is
   * already scoped by the resolved value, because the `object-data-table` it
   * renders resolves `schema.filter` in its own fetch, so only the navigate arm
   * would carry the literal — and a literal placeholder matches no record
   * (objectui#9022).
   */
  openRecordList?: (objectName: string, filter?: Record<string, unknown>) => void;
}

export const DrillNavigationContext = createContext<DrillNavigationValue>({});

export const DrillNavigationProvider: React.FC<{
  value: DrillNavigationValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <DrillNavigationContext.Provider value={value}>{children}</DrillNavigationContext.Provider>
);

/** Consume the host-provided drill navigation handlers (empty object if none). */
export function useDrillNavigation(): DrillNavigationValue {
  return useContext(DrillNavigationContext);
}
