/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record drawer host's context (objectstack#26679): what a record link
 * under a drawer host — a related row, a lookup value — calls to open a record
 * in that drawer, one level down. The host and its stack live in
 * `./recordDrawerStack.tsx`; this module holds only what
 * `RelatedRecordActionsBridge` reads, so the bridge and the drawer do not
 * import each other.
 */

import { createContext, useContext } from 'react';

/** What a record link inside a drawer host calls to open a record in place. */
export interface RecordDrawerApi {
  open(
    objectName: string,
    recordId: string | number,
    options?: {
      /** The ids of the rows shown beside the record, in their order. */
      siblings?: ReadonlyArray<string | number>;
      /** The title of the record the link sits on — the level being left. */
      fromTitle?: string;
    },
  ): void;
}

export const RecordDrawerContext = createContext<RecordDrawerApi | null>(null);

/** The nearest record drawer host, or `null` where records open as pages. */
export function useRecordDrawer(): RecordDrawerApi | null {
  return useContext(RecordDrawerContext);
}

/**
 * Whether a record of this object opens in the drawer: its object's own way
 * of opening, the drawer unless it declares another (objectstack#26677 — the
 * spec's `NavigationModeSchema` defaults to `drawer`; `page`, `new_window` and
 * `none` keep the record page).
 */
export function opensInRecordDrawer(objectDef: unknown): boolean {
  const mode = (objectDef as { navigation?: { mode?: unknown } } | null | undefined)?.navigation?.mode;
  return mode == null || mode === 'drawer';
}
