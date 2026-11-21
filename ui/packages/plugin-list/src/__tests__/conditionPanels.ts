/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The toolbar's Filter and Sort triggers open the shared field list
 * (objectstack#35549, objectstack#35550). The panels these suites read, every
 * row of today's `FilterBuilder` and `SortBuilder` under their 「Filter
 * Records」 / 「Sort Records」 headings, are that list's advanced step, one
 * click on its footer away. Both read the same `filterFields` / `sortFields`
 * the field list does.
 */
import { fireEvent, screen } from '@testing-library/react';

/** After the Filter trigger: step into the advanced panel and wait for it (any locale). */
export async function openAdvancedFilter(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId('filter-panel-open-advanced'));
  return screen.findByTestId('filter-panel-advanced');
}

/**
 * After the Sort trigger: the panel of every sort level (any locale). With a
 * sort in force the row's one sort chip opens it at once (objectstack#35878 on
 * objectstack#35876's `sort-chip-panel`); with none, the dashed 「Sort」 opens
 * the field list, and its footer steps into the same content.
 */
export async function openAdvancedSort(): Promise<HTMLElement> {
  const levels = screen.queryByTestId('sort-chip-panel');
  if (levels) return levels;
  fireEvent.click(await screen.findByTestId('sort-panel-open-advanced'));
  return screen.findByTestId('sort-panel-advanced');
}
