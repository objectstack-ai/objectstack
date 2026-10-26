/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback } from "react"
import type { KanbanCard } from "./types"

export interface UseQuickAddReorderOptions {
  /** Initial set of cards in the column */
  cards: KanbanCard[]
  /** Called when the user finishes reordering */
  onReorderComplete?: (reorderedCards: KanbanCard[]) => void
}

export interface UseQuickAddReorderReturn {
  /** Cards in their current (possibly reordered) order */
  reorderedCards: KanbanCard[]
  /** Move a card from one index to another within the list */
  onReorder: (fromIndex: number, toIndex: number) => void
  /** Whether a card is currently being dragged for reorder */
  isDragging: boolean
  /** Signal the start of a drag-to-reorder interaction */
  startDrag: () => void
  /** Signal the end of a drag-to-reorder interaction */
  endDrag: () => void
  /** Reset reordered state back to the source cards */
  reset: () => void
}

/**
 * Hook for drag-to-reorder of quick-add cards within a single column.
 * Manages local ordering state and exposes drag lifecycle helpers.
 */
export function useQuickAddReorder({
  cards,
  onReorderComplete,
}: UseQuickAddReorderOptions): UseQuickAddReorderReturn {
  const [reorderedCards, setReorderedCards] = useState<KanbanCard[]>(cards)
  const [isDragging, setIsDragging] = useState(false)

  // Keep reorderedCards in sync when the source cards change externally
  // (e.g. when a new card is added via quick-add)
  if (!cardsMatch(reorderedCards, cards) && !isDragging) {
    setReorderedCards(cards)
  }

  const reset = useCallback(() => {
    setReorderedCards(cards)
    setIsDragging(false)
  }, [cards])

  const onReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setReorderedCards(prev => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex >= prev.length
        ) {
          return prev
        }
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    },
    [],
  )

  const startDrag = useCallback(() => {
    setIsDragging(true)
  }, [])

  const endDrag = useCallback(() => {
    setIsDragging(false)
    setReorderedCards(current => {
      onReorderComplete?.(current)
      return current
    })
  }, [onReorderComplete])

  return {
    reorderedCards,
    onReorder,
    isDragging,
    startDrag,
    endDrag,
    reset,
  }
}

/** Shallow check that two card arrays contain the same IDs in the same order. */
function cardsMatch(a: KanbanCard[], b: KanbanCard[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

export default useQuickAddReorder
