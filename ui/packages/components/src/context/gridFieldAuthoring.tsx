/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GridFieldAuthoring — an ambient, opt-in affordance that lets a *design*
 * surface (Studio) add an "+ add field" control to a data-table's column
 * header without coupling the runtime table renderer to design concerns.
 *
 * The data-table reads this context via {@link useGridFieldAuthoring}. With no
 * provider it returns `null`, so every runtime table renders byte-identically —
 * the trailing "+" column only appears when a host wraps the table in
 * {@link GridFieldAuthoringProvider} (e.g. the Studio Data pillar), which owns
 * the add-field form + metadata save/publish.
 */

import React from 'react';

export interface GridFieldAuthoring {
  /** Invoked when the user clicks the trailing "+" add-column header affordance. */
  onAddColumn?: () => void;
  /** Optional tooltip/aria-label for the add-column button (defaults to "Add field"). */
  addColumnLabel?: string;
  /**
   * Invoked when the user clicks the per-column "edit field" affordance in a
   * column header (Airtable-style). Receives the column's accessorKey (= field
   * name). Omit to hide the edit affordance.
   */
  onEditColumn?: (fieldName: string) => void;
  /** Optional tooltip/aria-label for the edit-field button (defaults to "Edit field"). */
  editColumnLabel?: string;
  /**
   * Invoked when the user drag-reorders columns. Receives the new column order
   * as accessorKeys (= field names, including any non-field columns). Providing
   * this also ENABLES the table's built-in column drag-reorder (design mode), so
   * the host can persist the order to the object's field metadata. Omit to leave
   * reordering to the table's own `reorderableColumns`/`onColumnsReorder`.
   */
  onReorderFields?: (orderedFieldNames: string[]) => void;
}

const GridFieldAuthoringContext = React.createContext<GridFieldAuthoring | null>(null);

export function GridFieldAuthoringProvider({
  value,
  children,
}: {
  value: GridFieldAuthoring | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <GridFieldAuthoringContext.Provider value={value}>{children}</GridFieldAuthoringContext.Provider>
  );
}

/**
 * Read the ambient grid field-authoring affordances. Returns `null` outside a
 * provider — design surfaces opt in by wrapping the table tree in
 * {@link GridFieldAuthoringProvider}.
 */
export function useGridFieldAuthoring(): GridFieldAuthoring | null {
  return React.useContext(GridFieldAuthoringContext);
}
