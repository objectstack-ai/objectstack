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
 * objectstack#36423 — and the counts a card shows at its foot
 * (`kanban.cardFooter`): each card's open comment threads and attachments, as
 * `ObjectKanban` read them for the whole board (`useRecordCounts`,
 * `@object-ui/plugin-detail`), keyed by the card's record id. A count not
 * asked, not answered yet or refused is `null`; a card with no count draws no
 * footer item for it.
 *
 * @module
 */

import { createContext, useContext } from 'react';

export interface KanbanCardDisplay {
  /** Whether a card names each field beside its value. */
  showFieldLabels: boolean;
  /** objectstack#36423 — each card's foot counts, by record id; absent when the board shows none. */
  footerCounts?: KanbanCardFooterCounts;
}

/** The counts the board read for its cards' feet (objectstack#36423). */
export interface KanbanCardFooterCounts {
  /** Open comment threads by record id; `null` when not asked, not answered yet, or refused. */
  comments: Readonly<Record<string, number>> | null;
  /** Attachments by record id; `null` when not asked, not answered yet, or refused. */
  attachments: Readonly<Record<string, number>> | null;
}

/** A card's foot counts: only the counts above zero, or `null` when it has none to draw. */
export function cardFooterCountsOf(
  counts: KanbanCardFooterCounts | undefined,
  cardId: unknown,
): { comments?: number; attachments?: number } | null {
  if (!counts || cardId === null || cardId === undefined) return null;
  const id = String(cardId);
  const comments = counts.comments?.[id];
  const attachments = counts.attachments?.[id];
  const out: { comments?: number; attachments?: number } = {};
  if (typeof comments === 'number' && comments > 0) out.comments = comments;
  if (typeof attachments === 'number' && attachments > 0) out.attachments = attachments;
  return out.comments || out.attachments ? out : null;
}

export const KanbanCardDisplayContext = createContext<KanbanCardDisplay>({ showFieldLabels: true });

export function useKanbanCardDisplay(): KanbanCardDisplay {
  return useContext(KanbanCardDisplayContext);
}
