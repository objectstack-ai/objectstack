/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GridHeaderMenu — a data-table whose column header opens the column menu
 * instead of sorting, opted into by a HOST, never by metadata
 * (objectstack#35876).
 *
 * Inside a provider whose value is `true`, a click on a sortable column's
 * header (or Enter, Space or ArrowDown while the header has focus) opens the
 * column menu: sort ascending, sort descending, hide the column. The header
 * itself never changes the sort. Outside a provider (`false`, the default)
 * the header keeps its click-to-sort behaviour, so every host that does not
 * mount this keeps what it had.
 *
 * `ObjectGrid` mounts it around the table it draws when its host asks for it
 * (`ListView`, the list page, does).
 */

import React from 'react';

const GridHeaderMenuContext = React.createContext<boolean>(false);

export function GridHeaderMenuProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <GridHeaderMenuContext.Provider value={value}>{children}</GridHeaderMenuContext.Provider>;
}

/** Whether a host asked this table's column headers to open the column menu. */
export function useGridHeaderMenu(): boolean {
  return React.useContext(GridHeaderMenuContext);
}
