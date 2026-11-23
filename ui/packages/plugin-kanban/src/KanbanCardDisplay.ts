/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — how a card draws its fields, as the view's kanban block
 * says (`kanban.showFieldLabels`): with each field's name beside its value
 * (the default, what every board drew before the key), or the values alone.
 *
 * A package-private channel, as `KanbanColumnSummary` is: `ObjectKanban`
 * provides it from the node `ListView` builds, and a board without a provider
 * draws the names, as before. (`kanban.hideEmptyFields` needs no channel:
 * `ObjectKanban` builds the cards' field rows itself.)
 *
 * @module
 */

import { createContext, useContext } from 'react';

export interface KanbanCardDisplay {
  /** Whether a card names each field beside its value. */
  showFieldLabels: boolean;
}

export const KanbanCardDisplayContext = createContext<KanbanCardDisplay>({ showFieldLabels: true });

export function useKanbanCardDisplay(): KanbanCardDisplay {
  return useContext(KanbanCardDisplayContext);
}
