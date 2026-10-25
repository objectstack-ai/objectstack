/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from "react"

export interface Swimlane {
  /** Unique identifier for the swimlane row */
  id: string
  /** Display label */
  title: string
  /** Optional list of swimlane IDs this lane accepts cards from. Omit for unrestricted. */
  acceptFrom?: string[]
}

export interface CrossSwimlaneMoveEvent {
  cardId: string
  fromSwimlane: string
  toSwimlane: string
  columnId: string
}

export interface UseCrossSwimlaneOptions {
  /** Swimlane definitions */
  swimlanes: Swimlane[]
  /** Callback executed after a successful cross-swimlane move */
  onCardMove?: (event: CrossSwimlaneMoveEvent) => void
}

export interface UseCrossSwimlaneMoveReturn {
  /** Execute a cross-swimlane move. Returns true if the move was allowed. */
  handleCrossSwimlaneMove: (
    cardId: string,
    fromSwimlane: string,
    toSwimlane: string,
    columnId: string,
  ) => boolean
  /** Whether a card is currently being dragged across swimlanes */
  isDraggingAcrossSwimlanes: boolean
  /** Start tracking a cross-swimlane drag */
  startCrossSwimlaneDrag: (fromSwimlane: string) => void
  /** End the cross-swimlane drag */
  endCrossSwimlaneDrag: () => void
  /** Check whether a card may be moved into the target swimlane */
  canMoveTo: (fromSwimlane: string, toSwimlane: string) => boolean
}

/**
 * Hook for managing cross-swimlane card movements.
 * Validates movement constraints (acceptFrom rules) and tracks drag state.
 */
export function useCrossSwimlaneMove({
  swimlanes,
  onCardMove,
}: UseCrossSwimlaneOptions): UseCrossSwimlaneMoveReturn {
  const [dragSource, setDragSource] = useState<string | null>(null)

  const swimlaneMap = useMemo(() => {
    const map = new Map<string, Swimlane>()
    for (const lane of swimlanes) {
      map.set(lane.id, lane)
    }
    return map
  }, [swimlanes])

  const canMoveTo = useCallback(
    (fromSwimlane: string, toSwimlane: string): boolean => {
      if (fromSwimlane === toSwimlane) return true
      const target = swimlaneMap.get(toSwimlane)
      if (!target) return false
      // When acceptFrom is not specified the lane is unrestricted
      if (!target.acceptFrom) return true
      return target.acceptFrom.includes(fromSwimlane)
    },
    [swimlaneMap],
  )

  const handleCrossSwimlaneMove = useCallback(
    (
      cardId: string,
      fromSwimlane: string,
      toSwimlane: string,
      columnId: string,
    ): boolean => {
      if (!canMoveTo(fromSwimlane, toSwimlane)) return false
      onCardMove?.({ cardId, fromSwimlane, toSwimlane, columnId })
      setDragSource(null)
      return true
    },
    [canMoveTo, onCardMove],
  )

  const startCrossSwimlaneDrag = useCallback((fromSwimlane: string) => {
    setDragSource(fromSwimlane)
  }, [])

  const endCrossSwimlaneDrag = useCallback(() => {
    setDragSource(null)
  }, [])

  const isDraggingAcrossSwimlanes = dragSource !== null

  return {
    handleCrossSwimlaneMove,
    isDraggingAcrossSwimlanes,
    startCrossSwimlaneDrag,
    endCrossSwimlaneDrag,
    canMoveTo,
  }
}

export default useCrossSwimlaneMove
