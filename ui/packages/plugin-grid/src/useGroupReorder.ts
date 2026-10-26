/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useEffect } from 'react';

export interface UseGroupReorderOptions {
  /** Initial ordered list of group keys. */
  groupKeys: string[];
}

export interface UseGroupReorderResult {
  /** Current ordered list of group keys. */
  groupOrder: string[];
  /** Move a group from one index to another. */
  moveGroup: (fromIndex: number, toIndex: number) => void;
  /** Drag-start handler – stores the dragged group key. */
  onDragStart: (e: React.DragEvent, key: string) => void;
  /** Drag-over handler – must be attached to allow drop. */
  onDragOver: (e: React.DragEvent) => void;
  /** Drop handler – reorders the group under the cursor. */
  onDrop: (e: React.DragEvent, targetKey: string) => void;
  /** Drag-end handler – cleans up drag state. */
  onDragEnd: () => void;
  /** The key currently being dragged (null when idle). */
  draggingKey: string | null;
}

const DRAG_DATA_TYPE = 'text/x-group-key';

/**
 * Hook for drag-and-drop reordering of grouped sections.
 *
 * Attach the returned handlers to the group header elements to enable
 * reordering via native HTML drag-and-drop.
 */
export function useGroupReorder({ groupKeys }: UseGroupReorderOptions): UseGroupReorderResult {
  const [order, setOrder] = useState<string[]>(groupKeys);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  // Keep internal order in sync when the source list changes (new groups added/removed).
  useEffect(() => {
    setOrder((prev) => {
      const prevSet = new Set(prev);
      const nextSet = new Set(groupKeys);

      // Fast-path: identical sets in same order.
      if (
        prev.length === groupKeys.length &&
        prev.every((k, i) => k === groupKeys[i])
      ) {
        return prev;
      }

      // Preserve existing order for keys that still exist, append new keys.
      const kept = prev.filter((k) => nextSet.has(k));
      const added = groupKeys.filter((k) => !prevSet.has(k));
      return [...kept, ...added];
    });
  }, [groupKeys]);

  const moveGroup = useCallback((fromIndex: number, toIndex: number) => {
    setOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      if (fromIndex === toIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const onDragStart = useCallback((e: React.DragEvent, key: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_DATA_TYPE, key);
    setDraggingKey(key);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, targetKey: string) => {
      e.preventDefault();
      const sourceKey = e.dataTransfer.getData(DRAG_DATA_TYPE);
      if (!sourceKey || sourceKey === targetKey) return;

      setOrder((prev) => {
        const fromIndex = prev.indexOf(sourceKey);
        const toIndex = prev.indexOf(targetKey);
        if (fromIndex === -1 || toIndex === -1) return prev;

        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [],
  );

  const onDragEnd = useCallback(() => {
    setDraggingKey(null);
  }, []);

  return {
    groupOrder: order,
    moveGroup,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    draggingKey,
  };
}
